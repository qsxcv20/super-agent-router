// super-agent-router 共享库
// 台账落在 PLUGIN_DATA（可写、跨会话持久），与插件包只读区分离。
//
// 判定规则唯一出处：plugin/skills/super-agent-router/references/contract.md
//   S2 scope 语义 / S3 通道语义 / S4 transcript 解析 / S5 工具分流 / S6 台账口径 / S8 收尾契约
//
// 本文件的硬规矩：凡是「解析不出 / 取不到 / 读不到」的位置，一律判为「不通过」。
// 这些位置以前留过放行分支 —— 放行分支就是未来的静默失效：
// 越界管控一旦落空，不是报错，而是不再生效（D-01 / D-02 / D-04 / D-16）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function parseInput(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// 严格解析：载荷读不出来或不是合法 JSON -> 明确失败。
// parseInput() 保留旧语义（失败返回空对象），给「没有载荷就不做事」的脚本用；
// 判定脚本必须用这个 —— 载荷一坏，parseInput 会返回空对象，
// agent_type 取不到就走进「父会话直接放行」分支，等于越界管控整段失效而不报错。
export function parseInputStrict(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, reason: '载荷为空：hook 没拿到任何输入', value: {} };
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, reason: '载荷不是 JSON 对象', value: {} };
    }
    return { ok: true, reason: '', value: v };
  } catch (e) {
    return {
      ok: false,
      reason: '载荷不是合法 JSON（' + (e && e.message ? e.message : 'parse error') + '）',
      value: {}
    };
  }
}

export function dataDir() {
  return process.env.PLUGIN_DATA || process.env.MINIMAX_PLUGIN_DATA || null;
}

export function ledgerPath() {
  const dir = dataDir();
  return dir ? path.join(dir, 'dispatches.json') : null;
}

// ── 台账读 ───────────────────────────────────────────────
//
// readLedgerRaw() 是**唯一的读入口**：读盘 → 解析 → 补默认字段 → 返回 { text, ledger }。
// text 是**写前的原始文本** —— 回滚时要用它（回滚必须回到「写前状态」，不是回到「上一版」）。
function emptyLedger() {
  return { dispatches: [], bindings: [], counters: {}, scope_requests: [], readable: true, error: '' };
}

export function readLedgerRaw(p) {
  const empty = emptyLedger();
  let text = null;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (e) {
    // 台账存在却读不出来 = 派工记录不可信。
    // 以前这里直接返回空台账，等于「记录丢了 -> 视同没有在飞派工」-> 并发与冲突检测全盲。
    const exists = fs.existsSync(p);
    return {
      text: null,
      ledger: {
        ...empty,
        readable: !exists,
        error: exists ? ('台账读不出来：' + p + '（' + (e && e.message ? e.message : 'unknown') + '）') : ''
      }
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      text,
      ledger: { ...empty, readable: false, error: '台账读不出来：' + p + '（不是合法的台账 JSON 对象）' }
    };
  }
  if (!Array.isArray(parsed.dispatches)) parsed.dispatches = [];
  if (!Array.isArray(parsed.bindings)) parsed.bindings = [];
  if (!parsed.counters || typeof parsed.counters !== 'object') parsed.counters = {};
  if (!Array.isArray(parsed.scope_requests)) parsed.scope_requests = [];
  // 迁移：旧版台账记的是「发起方会话」，语义与新版不一致。
  //
  // 状态只在**没写**的时候补 —— 补成 done 是为了不把一次历史派工永久锁在在飞名单里。
  //
  // 但**已经写着 active 的行必须保持 active**（RG-03）：
  // 以前这里无条件写 state='done'，于是一条 state='active' 的旧行被**提升成 done** ——
  // 等于替一个还没结束的派工伪造「已完成」，record-gate 的履历真实性判据
  // （台账里存在一条 state='done' 的派工记录）就被绕过去了。
  // 迁移只补缺失的字段，不改写已声明的状态。
  for (const d of parsed.dispatches) {
    if (!d.parent_session_id) {
      d.parent_session_id = String(d.session_id || '');
      d.legacy = true;
      if (!d.state) d.state = 'done';
    }
    if (!d.state) d.state = 'active';
  }
  parsed.readable = true;
  parsed.error = '';
  // 同步闸门（测试专用，默认关闭）：见 ledgerSyncGate() 的注释。
  ledgerSyncGate();
  return { text, ledger: parsed };
}

export function readLedger() {
  const p = ledgerPath();
  if (!p) {
    return { ...emptyLedger(), readable: false, error: '没有 PLUGIN_DATA，台账不可用' };
  }
  return readLedgerRaw(p).ledger;
}

// ── 台账并发写（D-77）──────────────────────────────────
//
// 为什么台账不能再用「读一次 → 改 → 整体覆盖」：
//   两个写者各读一次旧快照、各自改一处、各自写一次 —— 后写的把先写的**整条**覆盖掉。
//   覆盖后的文件**格式合法、内容看着正常**，读侧检测不出来：
//   D-77 的活体证据就是「台账里查不到一条真在跑的派工」。
//   光把「写」做成原子替换**不够** —— 后写进程拿到的仍是旧快照，
//   原子替换只是把「写一半」变成「写全但内容旧」。
//
// 正确形态：**整个「读-改-写」串行化** ——
//   取跨进程锁 → **锁内重新读盘** → 锁内改 → 临时文件 + 原子替换 → 回读校验 → 不一致则回滚 → 放锁。
//
// 为什么临界区这么窄：锁只锁「读+改+写」这一小段；
// 临界区里不许有子进程调用、网络调用、其它 I/O（把慢 I/O 塞进锁里会让并发派工互相等死）。
// 台账文件小，这一段只有几毫秒。
//
// 锁参数之间的关系必须**可被回归验算**（契约 S7.5）：
//   等待超时 ≥ 最大并发数 × rename 重试窗口（排队方不能被误判失败）；
//   偷锁阈值 > 等待超时（防「偷走还在用的锁」）。
// 这是**必要条件与充分条件之别** —— 少一条就会在真实并发下出问题。
export const LEDGER_LOCK_WAIT_TIMEOUT_MS = 60000;
export const LEDGER_LOCK_STALE_MS = 180000;
export const LEDGER_RENAME_MAX_ATTEMPTS = 40;
export const LEDGER_RENAME_BACKOFF_BASE_MS = 25;
export const LEDGER_RENAME_BACKOFF_STEP_MS = 10;
// 持锁者在一次 rename 上的最坏耗时：
//   40 × 25ms + 10ms × (0+1+…+39) = 1000 + 7800 = 8800ms
export const LEDGER_RENAME_RETRY_WINDOW_MS =
  LEDGER_RENAME_MAX_ATTEMPTS * LEDGER_RENAME_BACKOFF_BASE_MS +
  LEDGER_RENAME_BACKOFF_STEP_MS * (LEDGER_RENAME_MAX_ATTEMPTS * (LEDGER_RENAME_MAX_ATTEMPTS - 1) / 2);

// 锁文件目录：与错题本那套（lessons.mjs）共用目录但**键不同** ——
// 共用目录不共用锁：两个文件是两份状态，本来就不该互相阻塞。
const LEDGER_LOCK_DIR = path.join(os.tmpdir(), 'super-agent-router-locks');

function ledgerLockPathFor(file) {
  const key = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 24);
  return path.join(LEDGER_LOCK_DIR, key + '.ledger.lock');
}

// 同步等待（不依赖事件循环）—— 锁等待与 rename 重试都要它。
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* 没有 Atomics.wait 时的兜底 */ }
  }
}

// ── 故障注入（测试专用；默认关闭）──────────────────────────
//
// 为什么要有它：ACCEPT 要求「写到一半被中断」「回读校验失败」这两条**确定性**复现。
// 靠真实并发去撞，撞到与否看运气 —— 断言就会时敏（同族教训 D-59~D-61）。
//
// 开关沿用契约 S14 的两个环境变量，但 **token 加 ledger- 前缀**：
//   SAR_FAULT_INJECT=ledger-rename-eperm:1   原子替换前 N 次抛 EPERM（Windows 文件被占用）
//   SAR_FAULT_INJECT=ledger-lock-eperm:1     排他创建锁文件前 N 次抛 EPERM
//   SAR_FAULT_INJECT=ledger-verify-fail      原子替换成功后把台账改写成过期快照 ⇒ 回读校验必然失败
//   SAR_FAULT_INJECT=ledger-crash-mid-write  写完临时文件、原子替换之前**直接退出进程**（模拟被 kill）
//   SAR_FAULT_RUN=<批次号>                   批次号一变，计数归零
//
// 加前缀是为了**不与错题本那套钩子串扰**：同一进程里两个模块读同一个 SAR_FAULT_INJECT，
// token 同名会互相消耗额度（lessons.mjs 的 verify-fail 与这里的 verify-fail 不是一回事）。
// 不设 SAR_FAULT_INJECT ⇒ 钩子完全关闭，正常路径的时序与返回值逐字不变。
const LEDGER_FAULT_ENV = 'SAR_FAULT_INJECT';
const LEDGER_FAULT_RUN_ENV = 'SAR_FAULT_RUN';
let LEDGER_FAULT_CACHE = { key: null, spec: null };

function ledgerFaultSpec() {
  const raw = process.env[LEDGER_FAULT_ENV];
  const run = process.env[LEDGER_FAULT_RUN_ENV] || '';
  const key = (raw || '') + '||' + run;
  if (key === LEDGER_FAULT_CACHE.key) return LEDGER_FAULT_CACHE.spec;
  const spec = { renameEperm: 0, lockEperm: 0, verifyFail: false, crashMidWrite: false };
  for (const tok of String(raw || '').split(',')) {
    const t = tok.trim();
    if (!t) continue;
    const [name, arg] = t.split(':');
    const n = arg === undefined ? 1 : parseInt(arg, 10);
    const count = (Number.isFinite(n) && n > 0) ? n : 1;
    if (name === 'ledger-rename-eperm') spec.renameEperm = count;
    else if (name === 'ledger-lock-eperm') spec.lockEperm = count;
    else if (name === 'ledger-verify-fail') spec.verifyFail = true;
    else if (name === 'ledger-crash-mid-write') spec.crashMidWrite = true;
  }
  LEDGER_FAULT_CACHE = { key, spec };
  return spec;
}

function ledgerFaultError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function faultLedgerRename() {
  const spec = ledgerFaultSpec();
  if (!spec || spec.renameEperm <= 0) return;
  spec.renameEperm--;
  throw ledgerFaultError('EPERM', '故障注入：台账原子替换被占用文件（Windows EPERM）');
}

function faultLedgerLockOpen() {
  const spec = ledgerFaultSpec();
  if (!spec || spec.lockEperm <= 0) return;
  spec.lockEperm--;
  throw ledgerFaultError('EPERM', '故障注入：台账锁文件排他创建失败（Windows ERROR_SHARING_VIOLATION）');
}

function faultLedgerVerifyOverwrite(p) {
  const spec = ledgerFaultSpec();
  if (!spec || !spec.verifyFail) return;
  try {
    fs.writeFileSync(p, '# 过期快照（故障注入：模拟并发写入方用旧快照覆盖）\n', 'utf8');
  } catch { /* 注入失败就让校验自然通过 —— 那正是「注入没生效」，断言会红 */ }
}

function faultLedgerCrashMidWrite() {
  const spec = ledgerFaultSpec();
  if (!spec || !spec.crashMidWrite) return;
  // 写到一半被中断：台账文件此刻**还没被碰过**（新内容在临时文件里），
  // 所以原记录一条不少、文件仍是合法 JSON —— 这正是要断言的。
  process.exit(9);
}

// ── 同步闸门（测试专用；默认关闭）──────────────────────────
//
// 为什么要有它：「两个并发写者都基于同一份旧快照」这个前提必须能**确定**地造出来 ——
// 靠真实并发去撞，撞到与否看运气，断言就会时敏。
//
// 机制：每次读台账之后，进程写下「我读到快照了」的标记（read-<pid>-<n>），
// 然后等一个 go 文件出现才继续。没设 SAR_LEDGER_SYNC_DIR ⇒ 整个钩子不执行。
//
// 为什么这个位置是对的：**读之后**。
//   · 旧形态（读-改-写，无锁）：两个写者都在 go 之前完成读 ⇒ 拿到同一份快照 ⇒ 后写的覆盖先写的。
//   · 新形态（锁内重读）：后一个写者拿不到锁，直到前一个写完才进入 ⇒ 它读到的是**最新**快照。
// go 之前没有人能落盘（落盘在同步点之后），所以「同一份快照」这件事是确定的，不是概率。
const LEDGER_SYNC_ENV = 'SAR_LEDGER_SYNC_DIR';
let ledgerSyncSeq = 0;

function ledgerSyncGate() {
  const dir = String(process.env[LEDGER_SYNC_ENV] || '').trim();
  if (!dir) return;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 目录建不出来时下面只是等不到 go */ }
  ledgerSyncSeq += 1;
  try {
    fs.writeFileSync(path.join(dir, 'read-' + process.pid + '-' + ledgerSyncSeq), String(Date.now()), 'utf8');
  } catch { /* 标记写不出来不影响主流程 */ }
  const go = path.join(dir, 'go');
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(go)) {
    if (Date.now() > deadline) break;   // 等不到就放行：宁可并发风险，也不能把机制永久卡死
    sleepSync(10);
  }
}

// ── 跨进程锁 ────────────────────────────────────────────
//
// 排他创建锁文件（'wx'）= 原子地「只有一个人拿到」。
// 拿不到就等 —— 等待上限必须容得下最大并发数轮持有者（见上面的常量关系）。
// 偷锁只在锁文件「老到不可能还在用」时才做（老到 staleMs 为止）。
export function withLedgerLock(file, fn, opts = {}) {
  const lockPath = ledgerLockPathFor(file);
  const timeoutMs = opts.timeoutMs || LEDGER_LOCK_WAIT_TIMEOUT_MS;
  const staleMs = opts.staleMs || LEDGER_LOCK_STALE_MS;
  try { fs.mkdirSync(LEDGER_LOCK_DIR, { recursive: true }); } catch { /* 目录建不出来时下面会报错 */ }
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  for (;;) {
    try {
      faultLedgerLockOpen();
      fd = fs.openSync(lockPath, 'wx');
      break;
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        // 持锁者可能已经死了（进程被 kill）—— 锁文件「老到不可能还在用」就当过期锁处理。
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > staleMs) {
            fs.rmSync(lockPath, { force: true });
            continue;
          }
        } catch { /* stat 失败 = 锁刚好被释放了，重试 */ }
      }
      // 拿不到锁就**继续等**，绝不放行 ——「拿不到锁还照样写」就是无锁写。
      if (Date.now() > deadline) {
        const err = new Error('台账锁等待超时（' + timeoutMs + 'ms）：' + lockPath);
        err.code = 'ELOCKTIMEOUT';
        throw err;
      }
      sleepSync(15);
    }
  }
  try {
    // 锁文件里记下持有者 pid：出问题时能看出「是谁拿着锁」。
    try { fs.writeFileSync(fd, String(process.pid) + ' ' + Date.now()); } catch { /* 记不住不影响互斥 */ }
    return fn();
  } finally {
    try { if (fd !== null) fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
  }
}

// 原子替换：同目录临时文件 + rename（同一卷 ⇒ rename 是原子的）。
// rename 覆盖已存在文件在 Windows 上可能 EPERM（文件被别的进程占用）⇒ 有界重试。
function replaceFileWithRetry(tmp, p) {
  let last = '';
  for (let i = 0; i < LEDGER_RENAME_MAX_ATTEMPTS; i++) {
    try {
      faultLedgerRename();
      fs.renameSync(tmp, p);
      return { ok: true };
    } catch (e) {
      last = String((e && e.message) || e);
      sleepSync(LEDGER_RENAME_BACKOFF_BASE_MS + LEDGER_RENAME_BACKOFF_STEP_MS * i);
    }
  }
  return { ok: false, error: 'rename 重试 ' + LEDGER_RENAME_MAX_ATTEMPTS + ' 次仍失败：' + last };
}

function writeLedgerFileAtomic(p, text) {
  const dir = path.dirname(p);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 目录建不出来时下面会报错 */ }
  const tmp = path.join(dir, '.' + path.basename(p) + '.tmp-' + process.pid + '-' +
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6));
  try {
    fs.writeFileSync(tmp, text, 'utf8');
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return { ok: false, error: '写台账临时文件失败：' + String((e && e.message) || e) };
  }
  // 故障注入：写到一半被中断（模拟进程被 kill）—— 台账文件此刻还没被碰过。
  faultLedgerCrashMidWrite();
  const rr = replaceFileWithRetry(tmp, p);
  if (!rr.ok) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return { ok: false, error: '台账原子替换失败：' + rr.error };
  }
  // 故障注入：verify-fail —— rename 成功后把目标改写成过期快照 ⇒ 回读校验必然失败。
  faultLedgerVerifyOverwrite(p);
  return { ok: true };
}

// 回滚：把台账恢复到**写前状态**（不是「上一版」，是这次写之前那一刻）。
function restoreLedgerFile(p, text) {
  try {
    if (text === null || text === undefined) {
      try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
      return { ok: true };
    }
    const dir = path.dirname(p);
    const tmp = path.join(dir, '.' + path.basename(p) + '.rollback-' + process.pid + '-' + Date.now().toString(36));
    fs.writeFileSync(tmp, text, 'utf8');
    const rr = replaceFileWithRetry(tmp, p);
    if (!rr.ok) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      return { ok: false, error: rr.error };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function readLedgerText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// ── 统一写入口 ──────────────────────────────────────────
//
// **所有台账写方都必须走这里**（dispatch / guard / scope-amend / release-slot / watchdog）。
// 留「有的走新入口、有的还裸写」的半拉子 = 同一个毛病还在，只是概率变小了。
//
// mutator 契约：
//   mutator(current) —— current 是**锁内重读**得到的最新台账，就地改它；
//   返回 { result }  = 正常；返回 { deny: '原因' } = 业务上要拒绝（内容没变就不落盘）。
//   mutator 里**不许**做子进程调用、网络调用、其它 I/O —— 临界区里那些东西会把并发派工互相等死。
//
// 返回 { ok, code, error, written, result, deny }：
//   code 形如 R-LEDGER-*，断言按编号指认命中的是哪条规则（不按文案关键词）。
export function updateLedger(mutator, opts = {}) {
  const p = ledgerPath();
  if (!p) {
    return { ok: false, code: 'R-LEDGER-NO-DATA-DIR', error: '没有 PLUGIN_DATA，台账不可用', written: false };
  }
  let out;
  try {
    out = withLedgerLock(p, () => updateLedgerLocked(p, mutator, opts));
  } catch (e) {
    const code = (e && e.code) || 'R-LEDGER-LOCK-FAILED';
    return { ok: false, code, error: '台账加锁失败：' + String((e && e.message) || e), written: false };
  }
  return out;
}

function updateLedgerLocked(p, mutator, opts) {
  // 锁内**重新读盘** —— 不用调用方之前读的那份快照（那正是 D-77 要修的东西）。
  const before = readLedgerRaw(p);
  if (before.ledger.readable === false && before.ledger.error) {
    return { ok: false, code: 'R-LEDGER-UNREADABLE', error: before.ledger.error, written: false };
  }
  const current = before.ledger;
  const mut = mutator(current) || {};
  const text = JSON.stringify(current, null, 2);
  // 内容没变就不落盘：少一次写，也避免「为了写而写」把并发方的内容覆盖成同内容。
  if (text === before.text) {
    return { ok: true, written: false, result: mut.result, deny: String(mut.deny || ''), ledger: current };
  }
  const wr = writeLedgerFileAtomic(p, text);
  if (!wr.ok) {
    return { ok: false, code: 'R-LEDGER-WRITE-FAILED', error: wr.error, written: false };
  }
  // 回读校验：写出去的必须读得回来，且**逐字一致**。
  // 不一致 = 被并发写入方用旧快照覆盖了（或落盘被截断）—— 这种情况下「说成功」比报错更坏。
  const back = readLedgerText(p);
  if (back !== text) {
    const rb = restoreLedgerFile(p, before.text);
    const rbCheck = rb.ok ? (readLedgerText(p) === before.text) : false;
    return {
      ok: false,
      code: 'R-LEDGER-VERIFY-FAILED',
      error: '台账回读校验失败：写出去的内容与读回来的不一致（可能被并发写入方用旧快照覆盖）',
      written: false,
      rolledBack: rb.ok && rbCheck,
      rollbackError: rb.ok ? (rbCheck ? '' : '回滚动作完成但内容仍与写前不一致') : rb.error
    };
  }
  return { ok: true, written: true, result: mut.result, deny: String(mut.deny || ''), ledger: current };
}

// 兼容入口：把**给定的**台账写盘。
//
// 保留它是因为它是对外导出（签名与语义不变）；但它的形态是「写我给的这份快照」——
// **不重读**，所以拿旧快照调用它仍然可能覆盖别人的记录。
// 正式写路径一律用 updateLedger()；五个写方已经全部改走统一入口（回归里有静态断言钉住）。
export function writeLedger(ledger) {
  const p = ledgerPath();
  if (!p) return false;
  try {
    return withLedgerLock(p, () => {
      const before = readLedgerText(p);
      const text = JSON.stringify(ledger, null, 2);
      const wr = writeLedgerFileAtomic(p, text);
      if (!wr.ok) return false;
      const back = readLedgerText(p);
      if (back !== text) {
        restoreLedgerFile(p, before);
        return false;
      }
      return true;
    });
  } catch {
    return false;
  }
}

// ── 组队层约束（可按需调整） ──────────────────────────────
// 单会话并发在飞派工上限：超过就是编排失控，不是协作
export const MAX_ACTIVE_DISPATCHES = 6;
// 单会话累计派工上限：防止无节制地开 worker
export const MAX_TOTAL_DISPATCHES = 30;
// 超过这个时长没回收到结束信号，视为失联，不再计入在飞
export const DISPATCH_TTL_MS = 2 * 60 * 60 * 1000;

// ── scope 条目模型（S2）──────────────────────────────
// 条目有两种形态：
//   可写条目：plugin/scripts/guard.mjs、plugin/scripts/
//   只读条目：ro: plugin/scripts/
// 统一存成字符串，只读条目保留 "ro: " 前缀 —— 台账、提示文案、比较函数共用一份数据，
// 不引入第二套结构，也就不会出现「一处认为只读、另一处认为可写」的口径漂移。
export const READONLY_PREFIX = 'ro:';

// scope 条目只接受像路径的东西，丢弃自然语言。
// 白名单里混进一句中文，等于拦截直接失效。
// 只读条目的 "ro:" 前缀也在这里放行 —— 契约 S2 要求支持该写法，
// 以前正则不接受冒号，"ro: xxx" 会被整条丢弃，白名单因此变小 = 放行（D-07）。
const PATH_LIKE = /^(?:ro\s*:\s*)?(?:[A-Za-z]:)?[A-Za-z0-9_@~.\\/-]+$/;

export function isPathLike(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (!t || t.length > 200) return false;
  const body = splitScopeEntry(t) ? splitScopeEntry(t).path : t;
  if (!/[\\/.]/.test(body)) return false;
  if (PATH_LIKE.test(t)) return true;
  // 绝对 Windows 路径（X:\ 或 X:/）：**整体**算一个路径，不受字符集限制。
  //
  // 为什么单列这一支：PATH_LIKE 的字符集不收空格、不收中文，
  // 而 Windows 上的绝对路径两者都可能带（本仓库自己的路径就带空格：
  // "C:\Users\yang2\Documents\MiniMax\mini code的插件\..."）。
  // 以前这类条目被整条丢掉 —— 白名单静默变窄，一条本该生效的白名单不生效（F-04）。
  //
  // 判据是**形态**（盘符开头），不是「有没有空格/有没有中文」：
  // 一句自然语言不会以 "X:\" 开头，所以这一支不会把中文句子当路径收进来。
  if (/^[A-Za-z]:[\\/]/.test(body)) return true;
  return false;
}

// 把 scope 条目拆成 { readOnly, path }。
// 只读条目在这里被识别出来，写判定与写冲突检测都要靠它（S2.2 / S2.4）。
export function splitScopeEntry(entry) {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  const m = raw.match(/^ro\s*:\s*(.*)$/i);
  if (m) {
    const p = m[1].trim();
    if (!p) return null;
    return { readOnly: true, path: p, raw: READONLY_PREFIX + ' ' + p };
  }
  return { readOnly: false, path: raw, raw };
}

// 路径归一化：MCode 的 read/write 接受绝对路径，
// 而 scope 通常写相对路径（src/app.ts）。
// 不做这层归一，绝对路径与相对 scope 永远匹配不上 —— 读类管控会全线误判。
export function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

// 取工作区根（用于范围比较，转小写）
export function workspaceRoot() {
  const d = process.env.MINIMAX_PROJECT_DIR || process.cwd();
  return String(d || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// 取工作区根（原样大小写）—— 拼绝对路径时要保留大小写，否则 existsSync 会判假。
// guard 与 watchdog 以前各写各的归一化规则，一个转小写一个不转，
// 于是同一路径在两处得到相反结论（D-20）。
export function projectRoot() {
  const d = process.env.MINIMAX_PROJECT_DIR || process.cwd();
  return String(d || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

// 把绝对路径折算成相对工作区的相对路径；不在工作区内则原样返回。
export function relativize(p) {
  const raw = String(p || '').replace(/\\/g, '/');
  const root = workspaceRoot();
  const low = raw.toLowerCase();
  if (!root) return low;
  if (low === root) return '';
  if (low.startsWith(root + '/')) return low.slice(root.length + 1);
  return low;
}

// 把路径拼成绝对路径。盘符路径（C:/...）按绝对路径直接用，
// 以前 watchdog 只认以 "/" 开头的绝对路径，把 "C:/x" 拼成 "<工作区根>/C:/x"，
// existsSync 必然为假 —— 真实存在的产出被误判成不存在（D-20）。
export function absolutizePath(p, root) {
  const raw = String(p || '').replace(/\\/g, '/').trim();
  const base = String(root || projectRoot()).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!raw) return '';
  if (/^[A-Za-z]:\//.test(raw)) return raw;
  if (raw.startsWith('/')) return raw;
  return base ? base + '/' + raw : raw;
}

// 判定目标是否落在白名单内。
//
// mode = 'write'  严格：必须精确等于某项，或落在显式以 / 结尾的目录项之下。
//                 ro: 条目永不授予写权限（S2.2）。
// mode = 'read'   宽松：额外允许读取 scope 条目所在目录树（S2.1 / S2.3），
//                 目录树包含树根本身（以前目录本身不可读，D-22）。
// mode = 'exact'  精确文件通道：只认这一个文件，不展开目录树。
//                 方法论与错题本走这条通道 —— 以前它们被当成普通 scope 条目，
//                 于是 ".superagent/methods/" 下所有成员的私有文件都可读（D-14）。
//
// 绝对路径会先折算成相对工作区的相对路径，两种写法都能命中。
export function inScope(scope, target, mode = 'write') {
  if (!Array.isArray(scope) || scope.length === 0) return false;
  const rawT = String(target || '').replace(/\\/g, '/');
  if (!rawT) return false;
  // 私有记忆路径：除精确文件通道（mode='exact'）外，一律不授予。
  // 目录条目展开的读范围也不例外 —— 那正是漏进来的那条路。
  if (mode !== 'exact' && isPrivateMemoryPath(rawT)) return false;
  const rel = relativize(rawT);
  const abs = normalizePath(rawT);
  if (!rel && !abs) return false;
  for (const entry of scope) {
    const parsed = splitScopeEntry(entry);
    if (!parsed) continue;
    const raw = parsed.path.replace(/\\/g, '/');
    const e = normalizePath(raw);
    if (!e) continue;
    if (e === '*') return true;
    const isDir = raw.endsWith('/');
    // 条目要同时按两种写法比：**绝对式**与**相对工作区的相对式**。
    //
    // 为什么：目标侧已经折算过（rel 与 abs 两种都在比），
    // 但条目侧以前只按它写出来的样子比 —— 于是 SCOPE 写绝对路径时，
    // worker 用相对路径调用（read docs/x.md）匹配不上，反过来写绝对路径才命中。
    // 契约 S2 写的是「绝对路径会先折算成相对工作区的相对路径，两种写法都能命中」——
    // 以前只有「条目写相对路径」这一半成立。
    const eRel = relativize(raw);
    const forms = [];
    if (e) forms.push(e);
    if (eRel && eRel !== e) forms.push(eRel);
    const prefixes = forms.map((f) => (isDir ? f.replace(/\/+$/, '') : f));
    // p === '' 表示「工作区根本身」的相对式 —— 任何相对路径都在它之下。
    const under = (p) => {
      if (rel === p || abs === p) return true;
      if (rel.startsWith(p + '/') || abs.startsWith(p + '/')) return true;
      if (p === '' && rel !== '') return true;
      return false;
    };
    const hit = under;
    const exact = forms.some((f) => rel === f || abs === f) || (eRel === '' && rel !== '');
    if (mode === 'write') {
      // ro: 条目永不授予写权限 —— 以前 ro: 前缀被整条丢弃，白名单变小等于放行。
      if (parsed.readOnly) continue;
      // .superagent/ 一律不授写权（第二道防线，派工闸门 1c 是第一道）。
      // 理由：该目录存着成员的权限等级 —— 能写它就是能自己给自己提权。
      if (touchesSuperagentPath(raw)) continue;
      if (exact) return true;
      // 目录条目只覆盖其「之下」的内容，不含目录本身（删掉整个目录超出授权范围）
      if (isDir && prefixes.some((p) => under(p) && !(rel === p || abs === p))) return true;
      continue;
    }
    if (mode === 'read') {
      if (exact) return true;
      // .superagent/ 下的条目只精确生效，**不展开目录树**。
      // 理由：读模式对文件条目取「它所在的目录」当树根，
      // 于是「读一个 roster.json」= 读到整个 .superagent/（含所有成员的错题本）。
      // 目录条目同理（它的树就是整棵 .superagent/）—— 直接不匹配。
      if (touchesSuperagentPath(raw)) continue;
      if (isDir) {
        // 目录条目：树根就是它自己，读它等于读它的树（S2.1）
        if (prefixes.some((p) => hit(p))) return true;
        continue;
      }
      // 文件条目：树根 = 它所在的目录
      for (const p of prefixes) {
        const treeRoot = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        if (treeRoot && (rel === treeRoot || abs === treeRoot ||
          rel.startsWith(treeRoot + '/') || abs.startsWith(treeRoot + '/'))) return true;
      }
      continue;
    }
    if (mode === 'exact') {
      if (exact) return true;
      continue;
    }
  }
  return false;
}

// 该目标是否被某个**只读条目**覆盖 —— 写判定下本该命中、却被 ro: 前缀挡掉的那一种。
//
// 为什么需要单独一条判定（D-40）：拦截消息要分两型 ——
//   「该路径不在白名单内」        → 路径根本没进白名单；
//   「该路径在白名单内，但登记为只读条目」 → 路径进了白名单，只是以只读身份。
// 以前两者共用一句话，而同一句消息的 SCOPE 列表里就写着 `ro: <path>` ——
// 按字面读，Router 会以为「要加白名单」，把一个本可只读执行的动作升级成可写授权。
//
// 判定口径与 inScope 的写模式**完全一致**（精确命中 / 落在以 / 结尾的目录条目之下），
// 只是不跳过只读条目 —— 否则两处口径会分叉，分叉出来的分型就是猜的。
export function readOnlyScopeHit(scope, target) {
  if (!Array.isArray(scope) || !scope.length) return false;
  const rawT = String(target || '').replace(/\\/g, '/');
  if (!rawT) return false;
  const rel = relativize(rawT);
  const abs = normalizePath(rawT);
  if (!rel && !abs) return false;
  for (const entry of scope) {
    const parsed = splitScopeEntry(entry);
    if (!parsed || !parsed.readOnly) continue;
    const raw = parsed.path.replace(/\\/g, '/');
    const e = normalizePath(raw);
    if (!e || e === '*') continue;
    const isDir = raw.endsWith('/');
    const eRel = relativize(raw);
    const forms = [];
    if (e) forms.push(e);
    if (eRel && eRel !== e) forms.push(eRel);
    const prefixes = forms.map((f) => (isDir ? f.replace(/\/+$/, '') : f));
    const under = (p) => {
      if (rel === p || abs === p) return true;
      if (rel.startsWith(p + '/') || abs.startsWith(p + '/')) return true;
      if (p === '' && rel !== '') return true;
      return false;
    };
    const exact = forms.some((f) => rel === f || abs === f) || (eRel === '' && rel !== '');
    if (exact) return true;
    // 目录条目只覆盖其「之下」的内容，不含目录本身（与 inScope 写模式同口径）。
    if (isDir && prefixes.some((p) => under(p) && !(rel === p || abs === p))) return true;
  }
  return false;
}

// ── scope 条目抽取 ────────────────────────────────────
// 支持同行写法与换行块写法；只收 path-like 条目。
// "ro:" 可以写成 "ro: path"（前缀独立成词）或 "ro:path"（连写）。
// 去掉条目末尾的标点（"src/app.ts。" 这类手写尾巴）。
// 以前这类写法会让条目被整条丢弃 —— 白名单变小等于放行（D-07）。
function trimScopePunct(v) {
  return String(v || '').replace(/[.,;:!?)\]}'"、，。；：]+$/, '').trim();
}

// 条目切分口径（契约 S2 第 7 条 / F-04）：
//
//   1. 先按**逗号**切（逗号是条目分隔符；路径里几乎不会出现逗号）。
//   2. 每个片段：
//      · 被引号包住（"…" / '…'）→ **整体**算一个条目（引号剥掉）；
//      · 以盘符开头（X:\ 或 X:/）→ **整体**算一个条目
//        （Windows 绝对路径里可以有空格 —— 本仓库自己的路径就带空格）；
//      · 否则 → 按空白切（旧口径）。
//   3. **相对**路径里带空格 → 必须用引号包住。
//      两种形态（带空格的相对路径 / 不带空格的相对路径）在切分前长得一样，
//      没有可靠的自动判据 —— 与其猜错（猜错就静默截断），不如要求显式加引号。
//
// 为什么以前会静默截断（F-04）：按空白切 → 'C:\...\mini code的插件\src\app.ts'
// 被切成 'C:\...\mini' 与 'code的插件\src\app.ts'；前半截被当成条目收进白名单，
// 后半截被丢弃 —— 于是这条本该生效的白名单**静默不生效**（目标被判成越界）。
// 本仓库自己的路径就带空格，所以这不是理论问题。
function tokenizeScopeText(text) {
  const out = [];
  let pendingReadOnly = false;
  const fragments = String(text || '').split(/[,\uff0c]+/);
  for (const frag of fragments) {
    let raw = String(frag || '').trim();
    if (!raw) continue;
    // 'ro:' 前缀（连写 'ro:path' 与 'ro: path' 都认）。
    //
    // **不**认 'ro : path'（冒号前有空格）：旧口径下那种写法就没被支持
    // （'ro' 被当成无路径的 token 丢掉，后面的路径按**可写**处理）。
    // 这里保持原样 —— 不在本次改造范围内静默改变既有语义。
    const pm = raw.match(/^ro:(.*)$/i);
    if (pm) {
      const rest = pm[1].trim();
      if (!rest) { pendingReadOnly = true; continue; }   // 独立成词的 'ro:' → 沿用旧的 pending 语义
      raw = rest;
      // 与旧口径一致：'ro:' 之后的**第一个**条目是只读。
      pendingReadOnly = true;
    }
    // 引号包裹 → 整体算一个条目（引号里可以有空格）
    const quoted = raw.match(/^(["'`])([\s\S]*)\1$/);
    if (quoted) {
      const v = trimScopePunct(quoted[2]);
      out.push(v ? { value: v, readOnly: pendingReadOnly, whole: true }
                 : { value: '', readOnly: pendingReadOnly, malformed: true });
      pendingReadOnly = false;
      continue;
    }
    // 盘符开头 → 整体算一个条目（绝对路径里可以有空格）
    if (/^[A-Za-z]:[\\/]/.test(raw)) {
      const v = trimScopePunct(raw);
      out.push(v ? { value: v, readOnly: pendingReadOnly, whole: true }
                 : { value: '', readOnly: pendingReadOnly, malformed: true });
      pendingReadOnly = false;
      continue;
    }
    // 其余：按空白切（保留旧的 ro: 语义）
    for (const part of raw.split(/\s+/).filter(Boolean)) {
      let clean = part.replace(/^["'`]+|["'`]+$/g, '');
      if (!clean) continue;
      if (/^ro\s*:$/i.test(clean)) { pendingReadOnly = true; continue; }
      const inline = clean.match(/^ro\s*:\s*(.+)$/i);
      if (inline) {
        const v = trimScopePunct(inline[1]);
        out.push(v ? { value: v, readOnly: true } : { value: '', readOnly: true, malformed: true });
        pendingReadOnly = false;
        continue;
      }
      clean = trimScopePunct(clean);
      if (!clean) continue;
      out.push({ value: clean, readOnly: pendingReadOnly });
      pendingReadOnly = false;
    }
  }
  if (pendingReadOnly) out.push({ value: '', readOnly: true, malformed: true });
  return out;
}

const CJK = /[\u4e00-\u9fff]/;
export const KNOWN_EXTENSIONS = /\.(mjs|cjs|jsx|ts|tsx|json|jsonc|md|txt|py|pyi|sh|bash|zsh|yaml|yml|toml|ini|cfg|conf|xml|html|htm|css|scss|sql|csv|tsv|lock|env)$/i;

function looksLikePath(v) {
  const t = String(v || '');
  if (!t) return false;
  if (/[\\/]/.test(t)) return true;
  return KNOWN_EXTENSIONS.test(t);
}

// 抽取 scope 条目，同时把「长得像路径却被丢掉」的 token 记下来。
// 白名单漏收 = 判定范围比派工意图窄 = 静默失效（D-07），
// 所以漏收必须上报给派工闸门拒掉，而不是在这里悄悄丢弃。
export function extractScopeDetail(text) {
  const entries = [];
  const rejected = [];
  const lines = String(text || '').split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^(?:#{0,3}\s*)?[-*]?\s*SCOPE\s*[:：]\s*(.*)$/i);
    if (m) {
      inBlock = true;
      collectScopeTokens(m[1], entries, rejected);
      continue;
    }
    if (inBlock) {
      if (t === '' || /^#{1,4}\s/.test(t) || /^[A-Z][A-Z_]{2,}\s*[:：]/i.test(t)) {
        inBlock = false;
        continue;
      }
      collectScopeTokens(t, entries, rejected);
    }
  }
  return { entries: [...new Set(entries)], rejected: [...new Set(rejected)] };
}

function collectScopeTokens(chunk, entries, rejected) {
  for (const tok of tokenizeScopeText(chunk)) {
    if (!tok.value) {
      if (tok.malformed) rejected.push('ro:');
      continue;
    }
    // 引号 / 盘符形态的条目**已经证明「这是一个路径」**（切分阶段按形态认的），
    // 不再受「像路径」的字符集限制 —— 路径里可以有空格与中文（F-04）。
    if (isPathLike(tok.value) || (tok.whole && /[\\/]/.test(tok.value))) {
      entries.push(tok.readOnly ? (READONLY_PREFIX + ' ' + tok.value) : tok.value);
      continue;
    }
    // 含中文的 token 是自然语言，不是路径 —— 不算漏收。
    if (CJK.test(tok.value)) continue;
    if (looksLikePath(tok.value)) rejected.push(tok.value);
  }
}

// 从派工 prompt 里抽 scope 白名单（对外语义不变：返回条目数组）
export function extractScope(text) {
  return extractScopeDetail(text).entries;
}

// ── 插件包身份（权威面脚本的归属判据）──────────────────────
//
// 为什么归属必须落在**身份**上，而不是路径长相或脚本名：
//   权威面脚本（提权 / 批准扩权 / 写履历 / 写错题本 / 登记成员）是**权限入口**，
//   子代理不得执行（契约 S13.3 第 1 条）。但「这个文件是不是权威面脚本」不能只看：
//     · **路径长相**（必须落在某个固定目录下）→ 只覆盖**一份**副本：
//       仓库副本 / 安装副本 / 运行时缓存树里其余几份全部漏掉（F-01 的根因）；
//     · **脚本名裸匹配** → 别的项目里也有 roster.mjs / scope-amend.mjs，会误伤普通文件。
//   唯一稳定的身份是**插件包**：目录树里有 .minimax-plugin/plugin.json 的那一棵，
//   才是本插件包的代码。仓库 plugin/、安装目录 ~/.minimax/plugins/super-agent-router、
//   运行时缓存树 sha256-tree-v1-* 都满足这一条。
export const PLUGIN_PACKAGE_MANIFEST = '.minimax-plugin/plugin.json';

// 从文件所在目录往上找：第一个含 .minimax-plugin/plugin.json 的目录就是包根。
// 找不到返回空串 —— 那就是**普通文件**，不是插件包里的东西。
export function findPluginPackageRoot(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  let dir = path.dirname(path.resolve(raw));
  const seen = new Set();
  while (dir && !seen.has(dir)) {
    seen.add(dir);
    try {
      if (fs.existsSync(path.join(dir, PLUGIN_PACKAGE_MANIFEST))) return dir;
    } catch (e) {
      // 这一层读不到就当它不是包根，继续往上找 —— 判定不成立不等于放行，
      // 往上还有别的候选根（真正的包根在更上层的情况是常态）。
    }
    const up = path.dirname(dir);
    if (!up || up === dir) break;
    dir = up;
  }
  return '';
}

// 家目录展开（~ / $HOME / %USERPROFILE% / $env:USERPROFILE[%]）。
//
// 为什么单列成一个函数：这是**判定的一环**，不是字符串美化 ——
// 不展开的话，`node $HOME/.minimax/plugins/.../scope-amend.mjs` 这种写法
// 因为「路径对不上」而绕过权威面脚本判定。护栏最怕的就是「换个写法就躲开」。
//
// 导出成纯函数（家目录由调用方给），是为了能单独断言展开结果 ——
// 「判定被拦」可能由别的分支命中，只有展开结果本身对，才说明这一环真的生效。
export function expandHomePath(p, homeDir) {
  const s = String(p || '');
  const home = String(homeDir || '').replace(/\\/g, '/');
  if (!home) return s;
  if (s === '~') return home;
  if (s.startsWith('~/') || s.startsWith('~\\')) return home + '/' + s.slice(2).replace(/\\/g, '/');
  // '$env:USERPROFILE' 是 PowerShell 写法（无尾 %）；'%USERPROFILE%' 是 cmd 写法。
  // 两种都收，另外把 '$env:USERPROFILE%' 也收下 —— 少认一种写法就是多一个可绕的洞。
  const prefixes = ['$HOME', '$USERPROFILE', '$env:USERPROFILE', '$env:USERPROFILE%', '%USERPROFILE%'];
  for (const pre of prefixes) {
    if (s === pre) return home;
    if (s.startsWith(pre + '/') || s.startsWith(pre + '\\')) {
      return home + '/' + s.slice(pre.length + 1).replace(/\\/g, '/');
    }
  }
  return s;
}

// 读插件包的名字（plugin.json 的 name 字段）。读不到 / 解析失败返回空串。
export function readPluginPackageName(pkgRoot) {
  const root = String(pkgRoot || '').trim();
  if (!root) return '';
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, PLUGIN_PACKAGE_MANIFEST), 'utf8'));
    return String((j && j.name) || '');
  } catch (e) { return ''; }
}

// 这个绝对路径是不是「本插件包里的权威面脚本」？命中返回脚本名，否则空串。
//
// opts: { packageName, names }
//   packageName —— 本插件的包名（从运行中的那份副本反推）。
//   names       —— 权威面脚本的文件名清单。
//
// 判定顺序（任一步不成立就不算命中）：
//   1. 文件名在权威面脚本清单里；
//   2. 它所在目录树里有 .minimax-plugin/plugin.json（= 落在某个插件包里）；
//   3. 那个包的包名与本插件一致 —— **别的插件的包不算**。
//      本插件的包名读不到时（第 3 步判不出来），按「只要落在插件包里就算」处理：
//      归属判不出来时不能默认放行（宁可多判不可漏判，契约 S5.5 的同一条立场）。
export function ownPackageAuthority(absFilePath, opts) {
  const o = opts || {};
  const names = Array.isArray(o.names) ? o.names : [];
  const abs = String(absFilePath || '').replace(/\\/g, '/').trim();
  if (!abs || !names.length) return '';
  const base = abs.split('/').pop() || '';
  if (!names.includes(base)) return '';
  // 路径必须落在某个插件包里 —— 这一步是「身份」判据，不是脚本名裸匹配：
  // 别的项目里也有 roster.mjs / scope-amend.mjs，它们不在插件包里，不受影响。
  const pkgRoot = findPluginPackageRoot(abs);
  if (!pkgRoot) return '';                        // 不在任何插件包里 → 普通文件
  const pkgName = readPluginPackageName(pkgRoot);
  const ownName = String(o.packageName || '').trim();
  if (ownName && pkgName && pkgName !== ownName) return '';   // 别的插件的包
  return base;
}

// ── 私有记忆目录（成员自己的错题本与方法论）──────────────
//
// 这两个目录装的是**成员私有**的记忆：兄弟成员的错题本、方法论。
//
// 四层防线，各管各的 —— 别让下一个人又踩两层的差：
//   · **派工闸门 1b**（dispatch.mjs）：SCOPE 里出现这两个目录下的**任何**条目 → 拒派。
//     声明路径不给 —— 成员私有记忆不是共享资产。
//   · **护栏第二道防线**（guard.mjs）：边界里出现这两个目录下的**目录条目** → 拒绝建立边界。
//     只有目录条目会按读模式展开成整棵子树（放开兄弟成员的错题本全文）；
//     **精确文件条目**不展开，不触发这道防线 —— 它能不能读由**范围层**判。
//   · **范围层**（inScope）：私有记忆路径**一律不授予**（mode='exact' 的精确文件通道除外）。
//   · **扩权入口**（scope-amend.mjs）：给私有记忆目录扩权 = 造一条永远不生效的死条目 → 直接拒。
export const PRIVATE_MEMORY_DIRS = ['.superagent/lessons', '.superagent/methods'];

// scope 条目的路径是否落在私有记忆目录下（不分形态）。
// 用路径判定而不是「相对前缀」：绝对路径写法同样要认出来。
export function isPrivateMemoryEntry(entry) {
  const p = normScopeEntry(entry);
  if (!p) return false;
  return isPrivateMemoryPath(p.path);
}

// scope 条目**会不会把私有记忆目录展开成整棵子树** —— 只有目录形态会。
// 护栏第二道防线只认这一种形态（D-58）：
// 精确文件条目不展开，把整个边界判死会让那个 worker 的**每一次**工具调用都被拒。
export function expandsPrivateMemoryTree(entry) {
  const p = normScopeEntry(entry);
  if (!p || !p.isDir) return false;
  return isPrivateMemoryPath(p.path);
}

// ── scope 重叠判定（组队层）─────────────────────────────
// 只有「写冲突」才算重叠：两个 worker 同时写同一处会互相覆盖。
// 读范围天然重叠（都要读邻近文件），不算冲突。
export function normScopeEntry(entry) {
  const parsed = splitScopeEntry(entry);
  if (!parsed) return null;
  const raw = parsed.path.replace(/\\/g, '/').trim();
  if (!raw) return null;
  const isDir = raw.endsWith('/');
  let p = raw.toLowerCase();
  while (p.startsWith('./')) p = p.slice(2);
  if (isDir) p = p.replace(/\/+$/, '');
  if (!p) return null;
  return { path: p, isDir, raw, readOnly: parsed.readOnly };
}

// 返回两组 scope 冲突的具体路径；无冲突返回空数组。
// S2.4：只比较可写条目 —— ro: 条目与任何条目都不构成写冲突。
export function scopeClash(a, b) {
  const A = (a || []).map(normScopeEntry).filter((e) => e && !e.readOnly);
  const B = (b || []).map(normScopeEntry).filter((e) => e && !e.readOnly);
  const out = [];
  for (const x of A) {
    for (const y of B) {
      if (x.path === y.path) { out.push(x.raw); continue; }
      if (x.isDir && y.path.startsWith(x.path + '/')) {
        out.push(x.path + '/' + y.path.slice(x.path.length + 1)); continue;
      }
      if (y.isDir && x.path.startsWith(y.path + '/')) {
        out.push(y.path + '/' + x.path.slice(y.path.length + 1)); continue;
      }
    }
  }
  return [...new Set(out)];
}

export function scopeOverlaps(a, b) {
  return scopeClash(a, b).length > 0;
}

// ── 权限等级（tier / 契约 S13）──────────────────────────
//
// 每个成员都有一条权限等级：
//   scoped（默认）—— 逐路径白名单；白名单外一律拦，越界自动记账待审。
//   full          —— 项目工作区内自由读写，不必逐路径枚举白名单。
//
// 为什么要有这一层：逐路径白名单对「给成员派一个大活」太繁琐 ——
// 每个成员都平等，任何成员都可以被管理员提权到 full；
// 但**提权动作本身必须在管理员（父会话）手里**。
// 让被约束者自己决定边界，等于把授权模型整个拆掉 ——
// 所以 tier 写在项目级名录里（父会话改），不给 worker 写权限。
//
// tier 为什么不放在派工台账里：台账是半持久的（TTL 2 小时、截断 200 条），
// 而权限等级必须活过台账的生命周期 —— 否则提权半小时后自动失效。
export const TIER_SCOPED = 'scoped';
export const TIER_FULL = 'full';

export function rosterFilePath(root) {
  const base = String(root || projectRoot() || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return base ? base + '/.superagent/roster.json' : '';
}

// 读项目级专项名录。读不到 / 解析失败都返回 ok:false —— 调用方必须据此降级。
export function readRoster(root) {
  const p = rosterFilePath(root);
  if (!p) return { ok: false, members: [], path: '', error: '找不到项目根，roster.json 路径无法确定' };
  try {
    if (!fs.existsSync(p)) return { ok: true, members: [], path: p, missing: true };
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const members = Array.isArray(j && j.members) ? j.members : [];
    return { ok: true, members, doc: j, path: p, updated: String((j && j.updated) || '') };
  } catch (e) {
    return { ok: false, members: [], path: p, error: String((e && e.message) || e) };
  }
}

// 某个成员的权限等级。
// 没登记 / 名录读不到 / 字段乱写 → 一律 scoped（最小权限优先，不得静默放宽）。
export function memberTier(name, root) {
  const who = String(name || '').trim();
  if (!who) return TIER_SCOPED;
  const r = readRoster(root);
  if (!r.ok) return TIER_SCOPED;
  const m = r.members.find((x) => String((x && x.name) || '') === who);
  if (!m) return TIER_SCOPED;
  const t = String(m.tier || TIER_SCOPED).trim().toLowerCase();
  return t === TIER_FULL ? TIER_FULL : TIER_SCOPED;
}

// ── 账号成员名单（账号级事实源）────────────────────────────
//
// 成员存在于两个地方，含义不同（D-37 / D-38）：
//   账号的 agent 目录   → **是否存在**（账号级全局，跨项目）
//   项目名录 roster.json → 专项元数据（项目级）
//
// 派工到「账号里不存在」的成员不会启动子会话，台账却照样写一条 state:'active'：
// ① 占掉一个并发名额与一个累计名额；
// ② 同 SCOPE 的后续派工被「组队冲突」误拦；
// ③ 教训与履历照常注入 brief，外观完全正常 ⇒ **静默失效**。
// 所以派工**写台账之前**必须核验目标成员存在。
//
// 名单获取做成**一次调用**（这里）：注入侧披露的陈旧名单与派工侧拒绝的派工
// 必须是同一份计算 —— 两处各算各的，口径迟早长歪。
//
// 账号成员目录：
//   <账号根>/agents/<name>/          账号成员
//   <账号根>/agents/.builtin/<name>/  内置成员
//
// 账号根怎么找：
//   ① SAR_ACCOUNT_AGENTS_DIR —— 显式指定。账号是跨项目的全局事实，
//      测试夹具不自带账号环境就等于没有账号事实可判，所以夹具必须显式提供；
//   ② 运行时：PLUGIN_DATA 指向本插件的**专属目录**（契约 S11 的
//      .../plugin-data/hooks/super-agent-router）时，账号根取用户目录下的 .minimax；
//   ③ 其它情况（夹具）：**账号名单不可用** —— 取不到就不能断言「成员不存在」。
//
// 为什么 ③ 不直接放行：名单取不到时，名录里登记过的成员**无法核验存在性**，
// 那就按「取不到就拒绝」处理（dispatch 的闸门 1d）；名录之外的名字放行但留痕 ——
// 没有名录就没有「专项成员」这套用法，账号名单不可用这件事本身要在注入里披露。

// PLUGIN_DATA 是否指向本插件的专属目录（.../hooks/super-agent-router）。
// 与 writeGateTrace 的判定同源 —— 同一个事实只应有一处定义。
//
// ⚠️ 必须按**目录名的真实字节**比，不能先 trim 整个路径再取 basename：
// Windows 上「super-agent-router」与「super-agent-router 」（末尾多一个空格）
// 是**两个不同的目录**，可以同时存在。
// 先 trim 会把后者误判成前者 ⇒ 运行时若 PLUGIN_DATA 指向那个空目录，
// readLedger() 读到的是**空台账**（格式合法、看着正常）⇒
// 「记录丢了 ⇒ 视同没有在飞派工」⇒ 冲突检测与名额检测**全盲**（D-10 那一族的静默失效）。
//
// 判据：取 basename 时**不 trim**，直接比原始目录名；
// 允许的只有「路径两端无意义的空白」这一种输入修正，且必须在校验**之后**。
export function isPluginOwnDataDir(base) {
  const raw = String(base || '');
  if (!raw.trim()) return false;
  // 尾部分隔符要剥掉（'…/super-agent-router/' 是同一个目录），但**不能**剥空格。
  const b = raw.replace(/[\\/]+$/, '');
  if (!b) return false;
  const name = path.basename(b).toLowerCase();
  const parent = path.basename(path.dirname(b)).toLowerCase();
  if (name !== 'super-agent-router' || parent !== 'hooks') return false;
  // 最后一道：目录名必须**逐字**等于期望值（不含任何尾随空白）。
  // 上面两行已经保证这点（basename 保留空格，比对时空格会让 name !== 期望值）。
  return true;
}

// 账号根（用户目录下的 .minimax）。
export function accountRoot() {
  const explicit = String(process.env.SAR_ACCOUNT_HOME_DIR || '').trim();
  if (explicit) return explicit;
  return path.join(os.homedir(), '.minimax');
}

// 账号成员目录的定位结果。
export function accountAgentsRoot() {
  const explicit = String(process.env.SAR_ACCOUNT_AGENTS_DIR || '').trim();
  if (explicit) return { dir: explicit, source: 'explicit', error: '' };
  const data = process.env.PLUGIN_DATA || process.env.MINIMAX_PLUGIN_DATA || '';
  if (!isPluginOwnDataDir(data)) {
    return {
      dir: '',
      source: 'none',
      error: '账号成员目录未确定：PLUGIN_DATA 不指向本插件的专属目录（契约 S11 的 .../plugin-data/hooks/super-agent-router），' +
        '当前不是账号运行环境（测试夹具没有账号事实）。需要判成员存在性时请显式指定 SAR_ACCOUNT_AGENTS_DIR。'
    };
  }
  return { dir: path.join(accountRoot(), 'agents'), source: 'runtime', error: '' };
}

// 账号成员名单。
// 返回 { available, names, dir, error, source }：
//   available=false → 名单**读不出来 / 目录不存在**（不是「空名单」），
//   调用方不得据此断言「成员不存在」，只能按「无法核验」处理。
export function accountMemberNames() {
  const root = accountAgentsRoot();
  if (!root.dir) {
    return { available: false, names: [], dir: '', error: root.error, source: root.source };
  }
  let entries = null;
  try {
    entries = fs.readdirSync(root.dir, { withFileTypes: true });
  } catch (e) {
    return {
      available: false, names: [], dir: root.dir, source: root.source,
      error: '账号成员目录读不出来：' + root.dir + '（' + String((e && e.message) || e) + '）'
    };
  }
  const names = new Set();
  for (const en of entries) {
    if (!en || !en.isDirectory()) continue;
    const n = String(en.name || '');
    if (!n || n.startsWith('.')) continue;   // .builtin 单独处理
    names.add(n);
  }
  // 内置成员：<dir>/.builtin/<name>/
  try {
    for (const en of fs.readdirSync(path.join(root.dir, '.builtin'), { withFileTypes: true })) {
      if (en && en.isDirectory() && en.name) names.add(String(en.name));
    }
  } catch { /* 没有内置成员目录 = 该账号没有内置成员，不算「读不到」 */ }
  return { available: true, names: [...names].sort(), dir: root.dir, error: '', source: root.source };
}

// 目标成员是否在账号名单里。
// 'agent:<name>' 是 task 工具的命名空间前缀，账号目录里存的是 <name> 本身。
export function accountMemberExists(names, target) {
  const set = new Set(Array.isArray(names) ? names : []);
  const t = String(target || '').trim();
  if (!t) return false;
  if (set.has(t)) return true;
  const m = t.match(/^agent:(.+)$/);
  if (m && set.has(String(m[1]).trim())) return true;
  return false;
}

// 名录里的成员名（去重、保序）。
export function rosterMemberNames(roster) {
  const members = roster && Array.isArray(roster.members) ? roster.members : [];
  const out = [];
  for (const m of members) {
    const n = String((m && m.name) || '').trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// 陈旧成员：名录里有、账号里没有。
// 注入侧（session-start）披露的与派工侧（dispatch）拒绝的必须是同一个集合。
export function staleRosterMembers(roster, account) {
  if (!account || !account.available) return [];
  const set = new Set(account.names || []);
  return rosterMemberNames(roster).filter((n) => !set.has(n));
}

// 私有记忆路径（每个成员自己的错题本与方法论）。
//
// 判据：**任何 scope 条目都不得授予这些路径**（读与写都不行），
// 唯一的例外是 guard 给自己成员开的精确文件通道（mode='exact'）。
//
// 为什么必须单独判：派工闸门只拦「SCOPE 里出现的路径本身」碰没碰 .superagent/。
// 但读模式对**目录条目**会展开整棵树 —— 于是一条
// `ro: <工作区根>/` 的读范围覆盖整个工作区，连带把 .superagent/lessons/ 也放开了。
// 也就是说：闸门没拦的条目，读范围照样能泄进私有记忆 —— 堵入口不够，**读范围本身也要判**。
export function isPrivateMemoryPath(p) {
  const s = String(p || '').replace(/\\/g, '/').toLowerCase();
  return /(^|\/)\.superagent\/(lessons|methods)(\/|$)/.test(s);
}

// 路径是否落在编排层的私有状态目录（.superagent/）下。
//
// 这条判定有**两个**用途，缺一不可：
//   1. 派工闸门 1c —— SCOPE 里出现 .superagent/ 下的条目一律拒派。
//      读模式按目录树放宽 ⇒ 连一条 roster.json 的只读条目都会覆盖整个目录树，
//      于是能读到兄弟成员的错题本全文；写权限则能改自己的权限等级（自己提权）。
//   2. full 权限等级的例外 —— full 是「项目内自由读写」，
//      但 .superagent/ 是**成员互相篡位**的战场，必须从 full 里挖掉。
//      成员自己的方法论与错题本走 guard 的 exactPaths，与本判定无关。
export function touchesSuperagentPath(p) {
  const s = String(p || '').replace(/\\/g, '/').toLowerCase();
  return s === '.superagent' || s.startsWith('.superagent/') ||
    s.endsWith('/.superagent') || s.includes('/.superagent/');
}

// 目标路径是否落在工作区根之下。
// 相对路径算「在内」（工作区的相对引用）；绝对路径按前缀比较。
export function withinWorkspace(target) {
  const raw = String(target || '').replace(/\\/g, '/').trim();
  if (!raw) return false;
  const rel = relativize(raw);
  if (rel === '') return true;                       // 就是工作区根
  if (rel.startsWith('/')) return false;             // unix 绝对路径且不在区内
  if (/^[a-z]:\//.test(rel)) return false;          // 盘符绝对路径且不在区内
  return true;
}

// ── 派工记录 ──────────────────────────────────────────
//
// 一条记录是否**占名额**（D-73）。
//
// 降级路径登记的派工**不占名额、不参与 SCOPE 冲突判定**：
// 那条派工的存在性**没有核验过**，子会话可能根本没起来 ——
// 派给不存在的成员不会启动子会话，但台账照样会有一条 state:'active'。
// 让它占名额 = 一次「名单取不到」就吃掉并发名额与累计名额，
// 还让同 SCOPE 的后续派工被「组队冲突」误拦 —— 外观完全正常 ⇒ 静默失效。
//
// 判据是台账记录上的 degraded 标记（由 dispatch 在降级路径上写）。
// 默认口径是「占名额」：**只有显式标了 degraded:true 才不占** ——
// 反过来写（默认不占）会让所有历史记录都不算名额，并发上限当场失效。
export function countsAgainstSlots(d) {
  return !(d && d.degraded === true);
}
// TTL 兜底（S6.2 第 2 条 / S6.4）：超过 TTL 还停在 active 的记录判死。
// 以前只有 TTL 过滤，state 永远停在 active —— 台账状态与真实情况失步（D-10）。
export function markDispatchAborted(ledger, dispatchId, reason) {
  const hit = (ledger.dispatches || []).find((d) => d.dispatch_id === dispatchId);
  if (!hit) return false;
  if ((hit.state || 'active') !== 'active') return false;
  hit.state = 'aborted';
  hit.ended_at = Date.now();
  hit.end_reason = String(reason || 'aborted');
  return true;
}

export function reapExpiredDispatches(ledger, now = Date.now()) {
  let n = 0;
  for (const d of (ledger.dispatches || [])) {
    if ((d.state || 'active') !== 'active') continue;
    if (now - (d.at || 0) < DISPATCH_TTL_MS) continue;
    if (markDispatchAborted(ledger, d.dispatch_id, 'ttl_expired')) n++;
  }
  return n;
}

// 读时自愈（S6.2 第 3 条）：读取在飞名单时把已超龄的 active 记录判死。
// 只改了内存里的台账 —— 调用方必须落盘（dispatch / watchdog 都会 writeLedger）。
export function activeDispatches(ledger, parentSessionId, now = Date.now()) {
  reapExpiredDispatches(ledger, now);
  const key = String(parentSessionId || '');
  return (ledger.dispatches || []).filter((d) => {
    if (String(d.parent_session_id || '') !== key) return false;
    if ((d.state || 'active') !== 'active') return false;
    if (!countsAgainstSlots(d)) return false;
    return now - (d.at || 0) < DISPATCH_TTL_MS;
  });
}

// 项目维度的在飞名单（D-09）：写冲突检测要比全项目，
// 不只同一父会话 —— 嵌套派工与第二个 Router 会话以前完全取不到在飞记录。
export function activeDispatchesAll(ledger, now = Date.now(), project = null) {
  reapExpiredDispatches(ledger, now);
  const p = project ? String(project).toLowerCase() : '';
  return (ledger.dispatches || []).filter((d) => {
    if ((d.state || 'active') !== 'active') return false;
    if (now - (d.at || 0) >= DISPATCH_TTL_MS) return false;
    // 降级记录（D-73）不参与 SCOPE 冲突判定 —— 见 countsAgainstSlots 的注释。
    if (!countsAgainstSlots(d)) return false;
    if (p && d.project) {
      // 记录所属项目不同 -> 不是同一个工作区的并发写
      if (String(d.project).toLowerCase() !== p) return false;
    }
    return true;
  });
}

export function totalDispatches(ledger, parentSessionId) {
  const key = String(parentSessionId || '');
  // 累计名额只数「占名额」的记录（D-73）：降级派工的存在性没核验过，
  // 它不该吃掉一条累计额度（否则一次「名单取不到」就少一条额度，而额度永远回不来）。
  return (ledger.dispatches || []).filter((d) =>
    String(d.parent_session_id || '') === key && countsAgainstSlots(d)).length;
}

// 累计派工额度改用持久化计数器（D-19）：
// 台账被截断到 200 条后，扫台账算出来的累计数会偏低，30 条上限形同虚设。
export function dispatchedTotal(ledger, parentSessionId) {
  const key = String(parentSessionId || '');
  const counted = Number((ledger.counters || {})[key] || 0);
  return Math.max(totalDispatches(ledger, key), counted);
}

export function bumpDispatchCounter(ledger, parentSessionId) {
  const key = String(parentSessionId || '');
  if (!ledger.counters || typeof ledger.counters !== 'object') ledger.counters = {};
  ledger.counters[key] = Number(ledger.counters[key] || 0) + 1;
  return ledger.counters[key];
}

export function markDispatchDone(ledger, dispatchId, reason) {
  const hit = (ledger.dispatches || []).find((d) => d.dispatch_id === dispatchId);
  if (!hit) return false;
  // 已经判死（TTL / 中止）的记录不复活：
  // 复活会把「这条派工其实没正常结束」的结论抹掉，台账状态与真实情况失步（S6.4）。
  if ((hit.state || 'active') !== 'active') return false;
  hit.state = 'done';
  hit.ended_at = Date.now();
  if (reason) hit.end_reason = String(reason);
  return true;
}

// ── 越界请求（权限自动审核）─────────────────────────────
//
// 子代理撞到 scope 墙时，护栏**自动**把「它想访问什么、被拒了什么」记进台账。
// 父会话据此批准扩权，不必等 worker 自己汇报，也不必靠父会话去猜它卡在哪。
//
// 自动的是**发现、判定与记账**；**批准权仍在父会话手里** ——
// 让被约束者自己决定边界，等于把授权模型整个拆掉（D-31 同族的红线）。
export function recordScopeRequest(ledger, req) {
  if (!Array.isArray(ledger.scope_requests)) ledger.scope_requests = [];
  const at = Date.now();
  const entry = {
    request_id: 'req_' + at.toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    dispatch_id: String(req.dispatch_id || ''),
    agent: String(req.agent || ''),
    session_id: String(req.session_id || ''),
    tool: String(req.tool || ''),
    mode: String(req.mode || ''),
    tier: String(req.tier || ''),
    targets: (req.targets || []).map((t) => String(t)).slice(0, 10),
    state: 'pending',
    at
  };
  // 同一目标重复请求不重复记 —— worker 撞一次墙可能重试很多次，
  // 重复条目会把待审清单淹掉（漏放与误伤是同一枚硬币：这里防的是「噪音淹没信号」）。
  const dup = ledger.scope_requests.find((r) =>
    r.state === 'pending' &&
    r.dispatch_id === entry.dispatch_id &&
    r.session_id === entry.session_id &&
    JSON.stringify(r.targets) === JSON.stringify(entry.targets));
  if (dup) {
    dup.hits = (Number(dup.hits) || 1) + 1;
    dup.last_at = at;
    // 等级可能在这期间被管理员改过（scoped -> full）—— 刷新，
    // 否则父会话在待审清单里看到的等级是过时的。
    if (entry.tier) dup.tier = entry.tier;
    return dup.request_id;
  }
  ledger.scope_requests.push(entry);
  // 待审条目上限：只增不减的记录池会变成垃圾堆（错题本/履历都栽过这个跟头）。
  const pending = ledger.scope_requests.filter((r) => r.state === 'pending');
  if (pending.length > 50) {
    const drop = new Set(pending.slice(0, pending.length - 50));
    ledger.scope_requests = ledger.scope_requests.filter((r) => !drop.has(r));
  }
  return entry.request_id;
}

// ── 只读升级检测（D-75）────────────────────────────────
//
// 管理员批准一条「只读条目上的写请求」时，扩权会给该路径追加一条**可写**条目 ——
// 于是只读被**升级**成可写。D-40 想防的正是这个动作（把只读动作升级成可写授权），
// 那轮只改了拦截措辞，没动扩权入口 ⇒ 同一个动作在**管理员路径**上照样成立。
//
// 口径（父会话已定，机制照做）：**不堵死升级** ——
// 「成员给管理员做事必须有权限」是这个机制要满足的诉求，堵死批准权会与它相反。
// 但升级必须**显式**：批准回执与变更账都要写明「哪个路径从哪个只读条目升级成了可写」。
// 缺陷不是「升级」本身，是「升级看不出来」（静默）。
//
// 判定口径（两处共用同一套匹配逻辑，不自己重写路径比较 ——
// 这里分叉出去的话，「升级没被认出来」就是新的静默失效）：
//   · 只读覆盖 = readOnlyScopeHit(scope, target)：与 inScope 写模式同口径，只是不跳过只读条目
//   · 可写授予 = inScope(scope, target, 'write')：只读条目永不授写（S2.2）
export function readonlyEntryCovering(scope, target) {
  const key = canonicalPathKey(target);
  if (!key) return '';
  for (const e of canonicalScopeEntries(scope)) {
    if (!e.readOnly) continue;
    if (readOnlyScopeHit([e.canon], key)) return e.raw;
  }
  return '';
}

export function writableEntryGranting(scope, target) {
  const key = canonicalPathKey(target);
  if (!key) return '';
  for (const e of canonicalScopeEntries(scope)) {
    if (e.readOnly) continue;
    if (inScope([e.canon], key, 'write')) return e.raw;
  }
  return '';
}

// ── 路径写法归一（只用于「是不是同一个文件」的比较）─────────────────
//
// 为什么需要：SCOPE 条目与越界请求里的路径都是**手写**的，同一个文件可以有多种写法
// （'./docs/x.md' / 'docs//x.md' / 'docs\\x.md' / 'docs/x.md/'）。
// 授权判定按写法逐字比（那是范围层的既定语义，本单不改它），
// 但**升级检测**必须认出「这些写法指的是同一个文件」——
// 否则管理员批一条 './docs/x.md' 就能把只读条目罩着的那个文件静默升级成可写，
// 而回执与变更账都看不出这次升级（D-75 要防的正是这件事）。
//
// 归一只做三件事：斜杠统一、去掉 './' 与重复斜杠、去掉结尾斜杠（目录条目保留结尾斜杠）。
// **不**解析 '..'（解析它会引入新的路径语义，且 '../x' 与 'x' 归一后可能误判成同一个文件）——
// 宁可漏认（那种写法本来也极罕见），不可误认（误认 = 回执写出一次没发生的升级）。
export function canonicalPathKey(p) {
  const raw = String(p || '').replace(/\\/g, '/');
  if (!raw) return '';
  const trailing = raw.length > 1 && raw.endsWith('/') ? '/' : '';
  const body = trailing ? raw.slice(0, -1) : raw;
  const drive = body.match(/^[A-Za-z]:/);
  const head = drive ? body.slice(0, 2) : (body.startsWith('/') ? '/' : '');
  const rest = drive ? body.slice(2) : (body.startsWith('/') ? body.slice(1) : body);
  const segs = [];
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue;
    segs.push(seg);
  }
  return head + segs.join('/') + trailing;
}

// 把一份 scope 拆成「原始条目 + 归一后的条目」两张表。
// 判定一律在归一表上做（这样同一份匹配逻辑 inScope / readOnlyScopeHit 就能直接复用，
// 不另起一套比较口径 —— 另起一套 = 口径迟早分叉，分叉出来的结论就是猜的）；
// 报告时用原始条目（回执要让人看懂它写的是哪一条，而不是归一后的另一个样子）。
function canonicalScopeEntries(scope) {
  const out = [];
  for (const entry of Array.isArray(scope) ? scope : []) {
    const parsed = splitScopeEntry(entry);
    if (!parsed) continue;
    const key = canonicalPathKey(parsed.path);
    if (!key) continue;
    out.push({
      raw: parsed.raw,
      path: key,
      readOnly: parsed.readOnly,
      canon: parsed.readOnly ? (READONLY_PREFIX + ' ' + key) : key
    });
  }
  return out;
}

// 比出「本次扩权把哪些路径从只读升级成了可写」。
//
// scopeBefore / scopeAfter 是**同一份 scope 的前后快照**（不是两份不同的 scope）——
// 升级是「前后差」，只看其中一份是看不出来的。
// targets 是本次批准请求涉及的具体路径（写请求才有升级可言）。
//
// 两条判据：
//   ① 目标级：请求的路径本来被只读条目覆盖、现在可写
//   ② 条目级：某条只读条目的路径被新加的可写条目**罩住**了
//      （例如 scope 里是「ro: docs/other.md」，这次批的是「docs/」——
//        目标「docs/」本身不在只读覆盖下，但 docs/other.md 事实上从只读变成了可写。
//        漏掉这一条 = 又留了一条静默升级的路。）
//
// 「本来就可写」的一律不算升级：那不是这次批准造成的权限变化。
export function detectReadonlyUpgrades(scopeBefore, scopeAfter, targets) {
  const before = Array.isArray(scopeBefore) ? scopeBefore : [];
  const after = Array.isArray(scopeAfter) ? scopeAfter : [];
  // 判定在**归一后的条目**上做（口径说明见上）：
  // 路径写法不同（'./docs/x.md' vs 'docs/x.md'）指的是同一个文件 ——
  // 按写法逐字比就会让「只读被升级成可写」这件事从回执与变更账上溜过去。
  const beforeC = canonicalScopeEntries(before);
  const afterC = canonicalScopeEntries(after);
  const beforeCanon = beforeC.map((e) => e.canon);
  const afterCanon = afterC.map((e) => e.canon);
  const out = [];
  const seen = new Set();
  const push = (path, from, to) => {
    // 去重键用**归一**后的路径：同一个文件写成 './docs/x.md' 与 'docs/x.md'
    // 在账上是同一个文件，报两次会让回执看起来像升级了两条路径。
    const fp = splitScopeEntry(from);
    const key = canonicalPathKey(path) + '|' + canonicalPathKey(fp ? fp.path : from);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: String(path), from_entry: String(from), to_entry: String(to) });
  };
  for (const t of targets || []) {
    const target = canonicalPathKey(t);
    if (!target) continue;
    if (inScope(beforeCanon, target, 'write')) continue;    // 本来就可写 → 不是这次升级
    if (!readOnlyScopeHit(beforeCanon, target)) continue;   // 本来没被只读覆盖 → 与只读无关
    if (!inScope(afterCanon, target, 'write')) continue;    // 现在仍不可写 → 没有升级
    push(String(t), readonlyEntryCovering(before, t), writableEntryGranting(after, t));
  }
  for (const e of beforeC) {
    if (!e.readOnly) continue;
    if (inScope(beforeCanon, e.path, 'write')) continue;    // 本来就有可写条目 → 不是这次升级
    if (!inScope(afterCanon, e.path, 'write')) continue;    // 现在仍不可写 → 没被罩住
    push(e.path, e.raw, writableEntryGranting(after, e.path));
  }
  return out;
}

// 批准一条越界请求：把目标并入该派工的 scope，并同步子会话绑定。
// 必须同步 binding —— guard 下一次判定读的是 binding.scope，不是派工记录。
export function grantScopeRequest(ledger, requestId, approver) {
  if (!Array.isArray(ledger.scope_requests)) {
    return { ok: false, error: '台账里没有越界请求记录（scope_requests 为空）' };
  }
  const req = ledger.scope_requests.find((r) => r.request_id === String(requestId));
  if (!req) return { ok: false, error: '找不到 request_id=' + requestId };
  if (req.state !== 'pending') {
    return { ok: false, error: '该请求已处理（state=' + req.state + '）' };
  }
  const d = (ledger.dispatches || []).find((x) => x.dispatch_id && x.dispatch_id === req.dispatch_id);
  if (!d) {
    return { ok: false, error: '台账里找不到对应的派工 ' + (req.dispatch_id || '(空)') + ' —— 可能已结束' };
  }
  // 批准必须落在**仍在飞**的派工上（契约 S13.2 第 2 条）。
  //
  // 以前这条只在 scope-amend 的「直接加条目」分支有，「批准请求」路径没有 ——
  // 两条路径口径不一致，于是对**已结束**（done/aborted）的派工照样批准成功，
  // 台账上留下对死派工的授权记录。错误文案与「直接加条目」分支保持同一口径。
  if ((d.state || 'active') !== 'active') {
    return {
      ok: false,
      error: '派工 ' + d.dispatch_id + ' 已结束（state=' + d.state + '）—— 事后再补权限没有意义，请重新派工'
    };
  }
  const added = [];
  // 升级检测要的是**同一份 scope 的前后快照** —— 升级是「差」，只看一份是看不出来的。
  const scopeBefore = Array.isArray(d.scope) ? d.scope.slice() : [];
  if (!Array.isArray(d.scope)) d.scope = [];
  if (!Array.isArray(d.scope_amended)) d.scope_amended = [];
  const duplicate = [];
  for (const t of req.targets || []) {
    // 读请求只授读（ro:），写请求才给可写条目 —— 批准读不等于批准写。
    const entry = req.mode === 'read' ? (READONLY_PREFIX + ' ' + t) : t;
    if (!d.scope.includes(entry)) { d.scope.push(entry); added.push(entry); }
    else duplicate.push(t);
    if (!d.scope_amended.includes(entry)) d.scope_amended.push(entry);
  }
  // D-75：批准一条「只读条目上的写请求」会把该路径追加一条可写条目 ⇒ 只读被升级成可写。
  // 口径是**不堵死升级、但不许静默**：这里把升级显式算出来，
  // 由回执与变更账写明「哪个路径从哪个只读条目升级成了可写」。
  const upgraded = detectReadonlyUpgrades(scopeBefore, d.scope, req.targets || []);
  for (const b of (ledger.bindings || [])) {
    if (!b.dispatch_id || !req.dispatch_id || b.dispatch_id !== req.dispatch_id) continue;
    if (!Array.isArray(b.scope)) b.scope = [];
    for (const entry of added) if (!b.scope.includes(entry)) b.scope.push(entry);
  }
  req.state = 'granted';
  req.approved_by = String(approver || '');
  req.approved_at = Date.now();
  req.added = added;
  // 台账里也留一份升级痕迹 —— 验收时查「这次批准到底升级了什么」不只看回执。
  req.upgraded_paths = upgraded.map((u) => u.path);
  req.upgraded_from_readonly = upgraded;
  req.duplicate_paths = duplicate;
  return {
    ok: true,
    request: req,
    dispatch_id: d.dispatch_id,
    added,
    upgraded_paths: req.upgraded_paths,
    upgraded_from_readonly: upgraded,
    duplicate_paths: duplicate
  };
}

export function denyScopeRequest(ledger, requestId, approver, reason) {
  if (!Array.isArray(ledger.scope_requests)) {
    return { ok: false, error: '台账里没有越界请求记录（scope_requests 为空）' };
  }
  const req = ledger.scope_requests.find((r) => r.request_id === String(requestId));
  if (!req) return { ok: false, error: '找不到 request_id=' + requestId };
  if (req.state !== 'pending') return { ok: false, error: '该请求已处理（state=' + req.state + '）' };
  req.state = 'denied';
  req.approved_by = String(approver || '');
  req.approved_at = Date.now();
  req.deny_reason = String(reason || '');
  return { ok: true, request: req };
}

// ── 子会话绑定 ────────────────────────────────────────
// 把「某个子会话该受哪份 scope 约束」显式记下来，
// 避免每次工具调用都重新解析 transcript。
export function findBinding(ledger, sessionId) {
  return (ledger.bindings || []).find((b) => b.session_id === String(sessionId)) || null;
}

export function upsertBinding(ledger, binding) {
  ledger.bindings = (ledger.bindings || []).filter((b) => b.session_id !== binding.session_id);
  ledger.bindings.push(binding);
  ledger.bindings = ledger.bindings.slice(-200);
  return binding;
}

// ── 成员命名（D-12）────────────────────────────────────
// 显示名与 routing id 是两套命名空间。以前三处（dispatch 写台账 / guard 反查 /
// watchdog 回收）都拿它们做等值比较，命名一不一致就互相看不见 —— 状态不回收。
// 统一收敛到 routing id，实在拿不到才回退到 Router 手填的名字。
export function extractBriefMarkers(text) {
  const t = String(text || '');
  const parentSessionId = (t.match(/PARENT SESSION:\s*([A-Za-z0-9_-]+)/) || [])[1] || '';
  const agent = (t.match(/agentName:\s*([A-Za-z0-9_.:-]+)/) || [])[1] || '';
  return { parentSessionId, agent };
}

export function resolveAgentKey(candidates) {
  const c = candidates || {};
  const pick = (v) => String(v || '').trim();
  return pick(c.briefAgent) || pick(c.agentType) || pick(c.promptAgent) || pick(c.toolAgentName);
}

// ── transcript 里的 brief 解析（S4）────────────────────
// 两种变体都要认：
//   compatible: { type:'user', message:{ content:[{type:'text',text}] } }
//   codex     : { type:'response_item', payload:{ role:'user', content:[{type:'input_text',text}] } }
// 以前只认 compatible，codex 变体下解析恒为 null -> guard 整段放行（D-01）。
function contentText(content, types) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') { out += '\n' + part; continue; }
    if (types.includes(part.type)) {
      out += '\n' + String(part.text || part.input_text || part.value || '');
    }
  }
  return out;
}

function userMessageText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (obj.type === 'user' && obj.message) {
    return contentText(obj.message.content, ['text']);
  }
  if (obj.type === 'response_item' && obj.payload && obj.payload.role === 'user') {
    return contentText(obj.payload.content, ['input_text', 'text']);
  }
  // 形状嗅探兜底：运行时把 user 标在别处的情形
  if (obj.payload && obj.payload.role === 'user') {
    return contentText(obj.payload.content, ['input_text', 'text']);
  }
  if (obj.message && obj.message.role === 'user') {
    return contentText(obj.message.content, ['text', 'input_text']);
  }
  return '';
}

// 解析失败必须 deny，不能放行（S4）。
// 返回 { ok:false, reason } —— reason 说清是「变体不认识 / 没找到 SCOPE 行 / 文件读不到」。
export function readBriefFromTranscript(transcriptPath) {
  const fail = (reason) => ({ ok: false, reason, parentSessionId: '', agent: '', scope: [] });
  if (!transcriptPath) {
    return fail('载荷里没有 transcript_path，取不回派工原文（brief）');
  }
  let raw = '';
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const size = Math.min(fs.fstatSync(fd).size, 1024 * 1024);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
    raw = buf.toString('utf8');
  } catch (e) {
    return fail('transcript 读不到：' + transcriptPath + '（' + (e && e.message ? e.message : 'unknown') + '）');
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  let briefText = '';
  for (const line of lines) {
    let obj = null;
    try { obj = JSON.parse(line); } catch { continue; }
    const t = userMessageText(obj);
    if (!t) continue;
    // 按语义定位：扫到第一条含 SCOPE: 的 user 消息为止。
    // 以前只看前 8 行且要求 type==='user'，会话前置消息一多就整段失效（D-04）。
    if (!/SCOPE\s*[:：]/.test(t)) continue;
    briefText = t;
    break;
  }
  if (!briefText) {
    return fail('transcript 里没有找到含 SCOPE: 的 user 消息（compatible / codex 两种变体都没命中）');
  }
  const markers = extractBriefMarkers(briefText);
  const detail = extractScopeDetail(briefText);
  if (!detail.entries.length) {
    return fail('brief 里找到了 SCOPE 行，但条目一个都解析不出来（写法不被接受）');
  }
  return {
    ok: true,
    reason: '',
    parentSessionId: markers.parentSessionId,
    agent: markers.agent,
    scope: detail.entries
  };
}

// shell 感知的切词（只给命令形态判定用，不给路径判定用）——
//
// 为什么不能直接用 splitCommandTokens：
//   它不认反斜杠转义，于是 `sh -c mavis\\ agent\\ delete\\ sa-x` 被切成 4 个词，
//   载荷只剩 'mavis\\' —— 真实的命令串看不见了，判定落空 = 放行。
//   POSIX 下 -c 取的那一个参数是**去转义后**的整串，
//   外层 shell 先解转义，内层 shell 再按空格拆开 —— 于是这条命令真的会执行 mavis agent delete。
//
// 转义序列原样留在 token 文本里（路径 'C:\\Users\\x' 不能被拆坏），
// 只有「载荷文本」在送去再解析之前才解转义。
export function splitCommandTokensShell(cmd) {
  const s = String(cmd || '');
  const out = [];
  let cur = '';
  let quote = '';
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = ''; continue; }
      cur += ch; has = true; continue;
    }
    if (ch === '\\') {
      // 转义：下一个字符按字面处理，且不参与切分
      cur += ch;
      if (i + 1 < s.length) { cur += s[i + 1]; i += 1; }
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch; has = true;
  }
  if (has) out.push(cur);
  return out;
}

// 解 shell 转义：只给「载荷文本」用 —— 载荷是另一条命令，要按内层 shell 的语义再解析一次。
export function shellUnescape(tok) {
  const s = String(tok || '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 1; continue; }
    out += s[i];
  }
  return out;
}

// 「启动器」形态：数据命令里那些**会执行另一个程序**的子命令。
//
// 为什么单列一张表：
//   npm / npx / pnpm / yarn 本身是数据命令（参数是包名与脚本名，不是命令），
//   但 `npx mavis agent delete sa-x` / `npm exec mavis agent delete sa-x`
//   真的会执行 mavis —— 把它们当纯数据命令，这条路就漏了。
//   这不是「补一个包装器名字」的闭集，而是「数据命令 + 启动器子命令」这一类语义。
const LAUNCH_HEADS = new Set(['npx', 'bunx']);
const LAUNCH_SUBS = {
  npm: new Set(['exec', 'dlx']),
  pnpm: new Set(['exec', 'dlx']),
  yarn: new Set(['dlx'])
};

// 启动器后面那个「要运行的程序」在哪个下标；不是启动器就返回 -1。
// 开关要跳过：npx --yes <program> / npm --silent exec <program>。
function launcherProgramIndex(toks, headIdx, head) {
  const isHead = LAUNCH_HEADS.has(head);
  const subs = LAUNCH_SUBS[head];
  if (!isHead && !subs) return -1;
  let i = headIdx + 1;
  let sub = '';
  while (i < toks.length && i <= headIdx + 4) {
    const t = String(toks[i]);
    if (t.startsWith('-')) { i++; continue; }
    sub = t.toLowerCase();
    break;
  }
  if (isHead) return i < toks.length ? i : -1;
  if (!subs || !subs.has(sub)) return -1;
  i++;
  while (i < toks.length && String(toks[i]).startsWith('-')) i++;
  return i < toks.length ? i : -1;
}

// ── bash 通道语义（S3）────────────────────────────────
// 命令按空白/引号切词；只有满足下列之一才算「路径 token」：
//   含路径分隔符（/ 或 \）
//   以 . 开头的点目录（.git）
//   含已知文件扩展名（.mjs .js .ts .json .md .txt .py 等）
// 不得把带点的标识符当路径：console.log、JSON.stringify、m.extractScope、v0.4.0 都不是。
// 以前用「点 + 1~8 位字母数字」判定，console.log 会被当成路径拦下来，
// 而目录型目标（rm -rf config）整体逃逸（D-02）。
const READ_ONLY_COMMANDS = ['cat', 'head', 'tail', 'less', 'more', 'ls', 'dir', 'grep', 'rg', 'find', 'type', 'stat', 'wc', 'which'];

// ── 数据命令清单（S5 命令形态判定）──────────────────────────────
//
// 为什么要有这张表（而不是继续往「包装器表」里补名字）：
//   「命令位置的包装器」是一个**闭集**。exec / taskset / watch / at / parallel /
//   script / chroot / strace …… 再补十个名字，下一个变体照样漏（D-25 残余：
//   exec 家族 17 条形态全部放行）。闭集永远补不完。
//
//   结构性做法：把命令段分成两类 ——
//     · **数据段**：段首是文本/检索类命令 -> 其余 token 是**数据**，不参与命令位置判定。
//       grep -rn "mavis agent delete" src / echo mavis agent delete / cat src/website_deploy.md
//       继续放行 —— 引号里的内容是一个 token，不参与判定（字样 vs 形态的分界）。
//     · **执行段**：段首不是数据命令 -> 段内**每一个独立 token** 都是命令候选。
//       包装器自己不是数据命令，它后面的 token 自然进入候选：
//       于是 exec / taskset / watch / at / parallel / script / chroot / strace
//       以及**任何将来出现的包装器**都自动被覆盖。
//
// 为什么「每个独立 token 都是候选」比原来激进：
//   参数被拆开写的调用可能被误伤（node script.js mavis agent delete）。
//   契约立场是「宁可多判不可漏判」；误伤靠**这张表尽量完整**来抵 ——
//   所以常用命令必须收进来，别把常见命令划进执行段。
const DATA_COMMANDS = new Set([
  // 文本输出
  'echo', 'printf', 'print',
  // 读取 / 检索 / 转换
  'cat', 'head', 'tail', 'less', 'more', 'nl', 'tac', 'od', 'xxd',
  'grep', 'egrep', 'fgrep', 'zgrep', 'rg', 'ag', 'ack',
  'sed', 'awk', 'gawk', 'mawk',
  'cut', 'sort', 'uniq', 'wc', 'tr', 'paste', 'join', 'comm', 'column', 'fold', 'fmt',
  'diff', 'cmp', 'jq', 'yq', 'xmllint',
  'md5sum', 'sha1sum', 'sha256sum', 'cksum', 'file', 'stat',
  // 目录 / 查找 / 路径
  'find', 'fd', 'tree', 'ls', 'dir', 'pwd', 'basename', 'dirname', 'realpath', 'readlink',
  'which', 'whereis', 'type', 'date',
  // 版本控制 / 包管理 / 运行时：参数是路径、模式、包名，不是命令
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'python', 'python3', 'pip', 'pip3',
  'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'pytest',
  // 路径 / 文件操作：参数是路径与模式，不是命令。
  // 不收进来会怎样：`rm website_deploy`（删一个叫 website_deploy 的文件）
  // 会因为执行段「每个 token 都是命令候选」而被当成「执行部署」拦下 —— 误伤。
  // 只收「参数确定是路径/模式」的命令；归档类（tar/unzip/zip）不收，
  // 它们带 --to-command 这类会真执行的开关，收进来等于给自己开盲区。
  'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'ln', 'chmod', 'chown',
  'truncate', 'shred', 'install', 'dd', 'du', 'df',
  // 系统信息类：参数是进程名 / 主机名 / 数字，不是命令
  'ps', 'id', 'whoami', 'uname', 'hostname', 'sleep', 'kill',
  'true', 'false', 'seq', 'expr', 'test'
]);

export function splitCommandTokens(cmd) {
  const s = String(cmd || '');
  const out = [];
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// 去掉路径 token 的尾随标点。
// 命令/代码文本里的路径常带逗号括号（"src/app/x.ts,"），带着标点就没法和 scope 比对，
// 结果是「明明在范围内」被判成越界。
export function trimPathPunct(tok) {
  return String(tok || '').replace(/[.,;:!?)\]}'"、，。；：]+$/, '').trim();
}

export function isPathToken(tok) {
  const t = trimPathPunct(tok);
  if (!t || t.length > 300) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;   // URL 不是工作区路径
  if (t === '.' || t === '..') return true;
  if (t.startsWith('.')) return true;                          // 点目录 / 点文件
  if (/[\\/]/.test(t)) return true;                         // 含路径分隔符
  return KNOWN_EXTENSIONS.test(t);                            // 已知文件扩展名
}

export function extractPathTokens(cmd) {
  return splitCommandTokens(cmd).map(trimPathPunct).filter(isPathToken);
}

// 写操作动词：这些动词后面的参数就是路径目标。
// 目录型目标（rm -rf config）不含扩展名，按扩展名规则识别不到，
// 必须靠「动词 + 参数」这一层兜住，否则整类目录越界删除直接逃逸（D-02）。
const WRITE_TARGET_VERBS = ['rm', 'rmdir', 'del', 'erase', 'mv', 'move', 'cp', 'copy', 'dd', 'mkdir', 'ln', 'touch', 'chmod', 'chown', 'truncate', 'shred'];

export function extractWriteTargets(cmd) {
  const toks = splitCommandTokens(cmd);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].toLowerCase();
    if (!WRITE_TARGET_VERBS.includes(t)) continue;
    for (let j = i + 1; j < toks.length; j++) {
      const a = toks[j];
      if (a.startsWith('-')) continue;                    // 跳过开关
      if (a === '&&' || a === '||' || a === ';' || a === '|' || a === '>' || a === '>>') break;
      if (WRITE_TARGET_VERBS.includes(a.toLowerCase())) break;
      const t = trimPathPunct(a);
      if (t) out.push(t);
    }
  }
  for (let i = 0; i < toks.length - 1; i++) {
    if (toks[i] === '>' || toks[i] === '>>') {
      const a = toks[i + 1];
      const t = a && !a.startsWith('-') ? trimPathPunct(a) : '';
      if (t) out.push(t);
    }
  }
  return out;
}

export function hasWriteVerb(cmd) {
  const toks = splitCommandTokens(cmd).map((t) => t.toLowerCase());
  return toks.some((t) => WRITE_TARGET_VERBS.includes(t)) ||
    toks.includes('>') || toks.includes('>>');
}

// bash 的只读命令白名单（S3）。命中白名单按读判定，其余按写判定。
export function isReadOnlyCommand(cmd) {
  const s = String(cmd || '').trim();
  if (!s) return false;
  const segments = s.split(/\|\||&&|[|;]/).map((x) => x.trim()).filter(Boolean);
  if (!segments.length) return false;
  for (const seg of segments) {
    const toks = splitCommandTokens(seg);
    if (!toks.length) continue;
    const head = toks[0].toLowerCase();
    if (head === 'node') {
      if (!toks.some((t) => t === '--version' || t === '-v')) return false;
      continue;
    }
    if (head === 'git') {
      const sub = (toks[1] || '').toLowerCase();
      if (['status', 'log', 'diff', 'show'].includes(sub)) continue;
      return false;
    }
    if (head === 'find') {
      // find 本身是读；find -delete / -exec 会写，按写判定（比白名单更严，不会更松）
      if (toks.some((t) => t === '-delete' || t === '-exec' || t === '-execdir' || t === '-ok')) return false;
      if (READ_ONLY_COMMANDS.includes(head)) continue;
      return false;
    }
    if (READ_ONLY_COMMANDS.includes(head)) continue;
    return false;
  }
  return true;
}

// 对外可见的不可逆命令（S5.3）。worker 不得自行做这些动作。
export const DANGEROUS_COMMAND = /\b(git\s+push|gh\s+(pr|release)\s+create|npm\s+publish|yarn\s+publish|pnpm\s+publish|docker\s+push|terraform\s+apply|kubectl\s+apply)\b/i;

// ── bash 通道：账号级 / 对外不可逆动作的命令形态判定（D-25）──────
//
// 为什么不能把 DANGEROUS_COMMAND 塞满：
//   那条正则表达的是「对外发布类命令」，账号级动作是另一套语义
//   （CLI + 子命令 + 动作）；混在一个正则里两套口径会互相纠缠。
//
// 为什么不能见到 delete / remove / update 字样就拦：
//   bash 的 command 是自由文本，普通命令里这些字样极常见
//   （rm build/out.txt、rmdir build、git commit -m "update docs"），
//   按字面拦会大面积误伤 —— 护栏一旦变成噪音就等于不存在。
//
// 为什么不能只靠 dangerousByArgs：
//   那条分支按「工具名 + 参数」判定，只认 mavis / miniapp 两个工具名；
//   bash 通道的工具名是 bash，走不到那条分支 —— bash 成了账号级动作的旁路。
//   而 mavis 是本机真实存在的 CLI，命令文本会被 shell 真的执行。
//
// 为什么不能指望复合层（run_code）兜底：
//   容器调用的 PreToolUse 派发**不是平台恒定行为** —— 同一份纯计算容器代码，
//   2026-11-10 10:22 的子会话没被派发（日志探针实测：同会话的容器内 read 有条目、
//   外层 run_code 无条目），14:29 与 15:10 的子会话却被派发并当场拒答。
//   派发与否随会话而变 ⇒ 复合层只能当纵深防御的加成，不能当唯一防线，
//   危险操作的拦截必须在内层调用各自判定这一层做到位。
//   （D-26 的原结论「平台不对 run_code 容器派发 PreToolUse」已被金丝雀对照证伪，勿再写回）
//
// 判定对象是「命令形态」：命令位置上的 CLI + 子命令 + 动作。
// 只在命令位置匹配，文本别处出现这些词不算：
//   cat website_deploy.md / grep "mavis agent delete" . 都不该被拦。

// 命令位置的 shell 包装器：sh -c "..." 里是另一条命令，必须递归进去看，
// 否则 `bash -c "mavis agent delete x"` 就是现成的旁路。
//
// 为什么载荷分「一个 token」和「余下全部」两种（D-25 残余）：
//   POSIX 的 `sh -c "cmd"` 只取**一个**参数当命令串 —— `sh -c mavis agent delete`
//   里的 agent/delete 是 $0/$1，不是子命令；而 PowerShell 的 `-Command` 取的是
//   **余下全部**（`powershell -Command mavis agent delete sa-x` 真的会删成员），
//   cmd 的 `/c` 取的也是余下整行。两种语义混为一谈会两头出错：
//   只取一个 token → 真命令被当成参数而漏判；把参数当子命令 → 过度拦。
// 一个包装器可以有多套「载荷开关」：PowerShell 的 -Command 取余下整段（明文），
// 而 -EncodedCommand 取的是 base64(UTF-16LE) 载荷 —— 两种载荷的解析方式不同，
// 不能按同一套规则处理（不 decode 就看不见命令，判定落空 = 放行）。
const SHELL_PAYLOADS = {
  sh:   [{ flags: ['-c'], mode: 'single' }],
  bash: [{ flags: ['-c'], mode: 'single' }],
  zsh:  [{ flags: ['-c'], mode: 'single' }],
  dash: [{ flags: ['-c'], mode: 'single' }],
  ksh:  [{ flags: ['-c'], mode: 'single' }],
  su:   [{ flags: ['-c'], mode: 'single' }],
  powershell: [
    { flags: ['-command', '-c'], mode: 'rest' },
    { flags: ['-encodedcommand', '-enc'], mode: 'encoded' }
  ],
  pwsh: [
    { flags: ['-command', '-c'], mode: 'rest' },
    { flags: ['-encodedcommand', '-enc'], mode: 'encoded' }
  ],
  cmd:  [{ flags: ['/c', '/k'], mode: 'rest' }],
  // script -q -c "<命令>"：-c 后面那一个参数整体就是被执行的命令。
  // 不列它的话，`script -q -c "mavis agent delete sa-x" mavis` 的命令串
  // 被当成普通 token，账号级判定落空 = 放行。
  script: [{ flags: ['-c'], mode: 'single' }]
};

// 取命令词的文件名部分（去掉目录与 .exe/.cmd 尾缀），
// 这样 ./website_deploy 与 website_deploy.cmd 也认得出是同一条命令。
function commandBasename(tok) {
  const t = String(tok || '').trim();
  if (!t) return '';
  const base = t.split(/[\\/]/).pop() || t;
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '');
}

// 按 shell 的连接符把一条命令切成若干子命令；引号内的连接符不算。
// （cat "a && b" 是一个命令，不是两个。）
export function splitCommandSegments(cmd) {
  const s = String(cmd || '');
  const out = [];
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// 命令位置的包装器：只改变执行方式，不改变实际执行的是哪条命令。
// sudo/env/xargs 之类在前面的，命令词要往后挪。
//
// 为什么必须**按包装器分别定义**开关语义，不能用一张全局表（D-25 残余）：
//   旧表 WRAPPER_VALUE_FLAGS 把 `sudo -n` / `sudo -E` / `env -i` 这类
//   **布尔开关**也当成「带值开关」，于是「开关后面那个 token」被当成开关值吞掉 ——
//   真正的命令词（mavis）被吞掉后，命令位置找不到 mavis，整条命令被放行。
//   布尔开关后面跟的是命令词，不是开关值。
//
// value       : 带独立取值的开关（取值紧跟其后，取值不是命令）
// bool        : 布尔开关（后面不跟任何取值）
// positionals : 命令词之前的前置位置参数个数
//               （timeout 的时长是**位置参数**不是开关：timeout 5 / timeout 5s）
const WRAPPER_SPECS = {
  sudo: {
    value: new Set(['-u', '--user', '-g', '--group', '-p', '--prompt', '-C', '--close-from',
      '-D', '--chdir', '-R', '--chroot', '-T', '--command-timeout', '-r', '--role',
      '-t', '--type', '-h', '--host', '-U', '--other-user']),
    bool: new Set(['-n', '--non-interactive', '-E', '--preserve-env', '-H', '--set-home',
      '-K', '--remove-timestamp', '-k', '--invalidate-timestamp', '-l', '--list',
      '-v', '--validate', '-s', '--shell', '-S', '--stdin', '-b', '--background',
      '-e', '--edit', '-i', '--login', '-P', '--preserve-groups', '-A', '--askpass']),
    positionals: 0
  },
  doas: {
    value: new Set(['-u', '--user', '-C', '--chdir', '-s', '--style']),
    bool: new Set(['-a', '--non-interactive', '-L', '--no-groups']),
    positionals: 0
  },
  env: {
    value: new Set(['-u', '--unset', '-C', '--chdir', '--argv0', '--block-signal',
      '--default-signal', '--ignore-signal']),
    bool: new Set(['-i', '--ignore-environment', '-0', '--null', '--debug', '--help',
      '--version', '--list-signal-handling']),
    positionals: 0
  },
  timeout: {
    value: new Set(['-k', '--kill-after', '-s', '--signal', '--signal-timeout']),
    bool: new Set(['--preserve-status', '--foreground', '--verbose', '-h', '--help', '--version']),
    positionals: 1          // 时长是位置参数：timeout 5 / timeout 5s / timeout --signal=TERM 5
  },
  nice: { value: new Set(['-n', '--adjustment']), bool: new Set(), positionals: 0 },
  ionice: {
    value: new Set(['-c', '--class', '-n', '--classdata', '-t', '--ignore']),
    bool: new Set(['-p', '--pid', '-P', '--pgid', '-A', '--all']),
    positionals: 0
  },
  setsid: { value: new Set(), bool: new Set(['-f', '--fork', '-w', '--wait']), positionals: 0 },
  nohup: { value: new Set(), bool: new Set(['--help', '--version']), positionals: 0 },
  stdbuf: {
    value: new Set(['-i', '--input', '-o', '--output', '-e', '--error']),
    bool: new Set(), positionals: 0
  },
  time: {
    value: new Set(['-f', '--format', '-o', '--output']),
    bool: new Set(['-p', '--portability']),
    positionals: 0
  },
  xargs: {
    value: new Set(['-n', '--max-args', '-P', '--max-procs', '-I', '--replace', '-S',
      '--max-chars', '-d', '--delimiter', '-E', '--eof', '-a', '--arg-file', '-L', '--max-lines']),
    bool: new Set(['-0', '--null', '-r', '--no-run-if-empty', '-t', '--verbose', '-p', '--prompt']),
    positionals: 0
  },
  // command -v / -V 是**查询**语义（打印命令路径），不执行任何东西。
  // 它们不在 bool 开关表里 —— 当成普通开关时命令词会落到 mavis 上，
  // 于是 `command -v mavis agent delete sa-x` 被误当成执行而拦下（D-25 残余过度拦）。
  command: {
    value: new Set(),
    bool: new Set(['-p', '--path', '--verbose']),
    query: new Set(['-v', '-V']),
    positionals: 0
  },
  builtin: { value: new Set(), bool: new Set(), positionals: 0 },
  // busybox 是多调用二进制：busybox sh -c "…" 里真正的命令在 busybox 后面。
  // 不列它的话，busybox 会被当成段首命令词，后面的 sh -c 载荷就漏判了。
  busybox: { value: new Set(), bool: new Set(), positionals: 0 },
  su: {
    value: new Set(['-c', '--command', '-s', '--shell', '-g', '--group', '-G', '--supp-group',
      '-p', '--pty']),
    bool: new Set(['-f', '--fast', '-l', '--login', '-m', '--preserve-environment',
      '-w', '--whitelist-environment']),
    positionals: 0
  }
};

// find -exec / -execdir / -ok：紧跟其后的就是被执行的命令。
const EXEC_FLAGS = new Set(['-exec', '-execdir', '-ok']);

// 判定「这个 token 是不是 mavis 这个 CLI」：允许带路径与 .exe/.cmd 尾缀。
function isMavisWord(tok) {
  return /^mavis$/i.test(commandBasename(tok));
}

// 跳过 token 序列里紧跟其后的开关与 env 赋值，返回下一个「实义 token」的下标。
function nextMeaningfulIndex(toks, from) {
  for (let i = from; i < toks.length; i++) {
    const t = String(toks[i]);
    if (t.startsWith('-')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;   // env FOO=bar
    return i;
  }
  return -1;
}

// 跳过包装器前缀（它的开关与前置位置参数），返回下一个「命令词」的下标。
//
// uncertain = true 表示前缀里有认不出的开关：它到底带不带取值定不准，
// 命令词位置也就定不准 —— 这时后面的每个 token 都当候选命令位置（宁可多判不可漏判）。
//
// 为什么布尔开关绝对不能吞掉后一个 token：
//   `sudo -n mavis …` 里的 -n 不带值，吞掉 mavis 之后命令位置就找不到 mavis，
//   整条账号级删除命令会被安静地放行（D-25 残余）。
function skipWrapperArgs(toks, from, spec) {
  let i = from;
  let uncertain = false;
  let positionals = 0;
  while (i < toks.length) {
    const t = String(toks[i]);
    if (t.startsWith('-')) {
      // 查表**不做小写化**：sudo -H（set-home，布尔）与 sudo -h（host，带值）
      // 是两个不同开关，小写化会把 -H 当成带值开关，吞掉后面的命令词。
      const f = t;
      if (f.includes('=')) { i++; continue; }              // --flag=value 自带取值
      if (spec.value.has(f)) { i += 2; continue; }         // 带值开关：取值不是命令
      if (spec.bool.has(f)) { i++; continue; }              // 布尔开关：不吞任何东西
      i++; uncertain = true; continue;                     // 认不出的开关：可能带值 -> 位置不确定
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }   // env FOO=bar
    if (positionals < spec.positionals) { positionals++; i++; continue; }
    break;
  }
  return { next: i, uncertain };
}

// 找 shell 包装器的「命令载荷开关」（-c / -Command / /c）。
// 扫后面所有 token 而不是只扫紧邻的一个：su root -c "…" 的 -c 在操作数后面。
function findPayloadFlag(toks, from, specs) {
  for (let i = from; i < toks.length; i++) {
    const f = String(toks[i]).toLowerCase();
    for (const spec of specs) {
      if (spec.flags.includes(f)) return { index: i, spec };
      if (spec.mode === 'single' && /^-[a-z]*c$/.test(f)) return { index: i, spec };  // bash -lc "…"
      // 明文 -command 已经逐字列在 flags 里（比较前已小写化），
      // 这里不能再用宽松正则兜底 —— /^-[a-z]*command$/ 会把 -encodedcommand
      // 当成明文命令，base64 载荷就被原样送判（看不见命令 = 判定落空）。
    }
  }
  return null;
}

// PowerShell 的 -EncodedCommand 载荷是 UTF-16LE 的 base64。
// 解不出来就不能当成安全 —— 解析不出 = 判定落空 = 放行，所以返回 null 交给上层拒绝。
function decodeEncodedCommand(text) {
  const t = String(text || '').trim();
  if (!t || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  try {
    const s = Buffer.from(t, 'base64').toString('utf16le');
    if (!s || s.indexOf('\uFFFD') >= 0) return null;
    return s;
  } catch { return null; }
}

// 包装器的「查询开关」（command -v / -V）：只打印命令路径，**不执行**任何东西。
// 以前 -v 被当成普通布尔开关，命令词因此落到 mavis 上，
// `command -v mavis agent delete sa-x` 被误当成执行而拦下（D-25 残余·过度拦）。
function hasQueryFlag(toks, from, spec) {
  if (!spec || !spec.query || !spec.query.size) return false;
  for (let i = from; i < toks.length; i++) {
    const t = String(toks[i]);
    if (!t.startsWith('-')) break;      // 开关区结束，后面的是被查询的命令名
    if (spec.query.has(t)) return true;
  }
  return false;
}

// 一段命令里「真正被执行的命令」可能在哪些位置：
//   · 段首（跳过 sudo/env/xargs/timeout 等包装前缀与开关）
//   · find -exec / -execdir / -ok 之后（那一段是独立的命令，单独再判）
//
// 段首分两类：
//   · 数据段：段首是文本/检索类命令（echo/grep/cat/git/node…）——
//     段内其余 token 是**数据**，不参与命令位置判定。
//     `grep -rn "mavis agent delete" src` 只是在搜文本，`cat x.md` 只是在读文件。
//     引号里的内容整体是一个 token，也不参与判定 —— 这正是「字样 vs 形态」的分界。
//   · 执行段：段首不是数据命令 ——
//     段内**每一个独立 token** 都是命令候选。
//     为什么不是「只认包装器表里的名字」：包装器是闭集
//     （exec/taskset/watch/at/parallel/script/chroot/strace…），补一个漏一个；
//     改成「每个 token 都可能是命令」之后，任何新包装器都自动被覆盖。
//
// 载荷段（sh -c / powershell -Command / cmd /c）：
//   载荷本身是另一条命令，递归进去判；
//   载荷之后的 token 是命令参数（POSIX 下 `sh -c <string> [name [args...]]`
//   里 name/args 是 $0/$1），**不是命令位置** ——
//   以前把载荷下标推进了位置表，于是 `sh -c mavis agent delete sa-x`（未加引号）
//   被按 mavis agent delete 拦下，而 POSIX 下它执行的只是「没有子命令的 mavis」。
//
// contexts 里每一项是一段「可以出现命令位置」的 token 序列：{ toks, positions }。
function analyzeSegment(toks) {
  const contexts = [];
  const payloads = [];
  let uncertain = false;
  let undecodable = false;
  let guard = 0;
  let i = 0;
  while (i < toks.length && guard++ < 64) {
    const base = commandBasename(toks[i]).toLowerCase();

    // shell 包装器：-c / -Command / /c 之后是「要执行的命令」
    const shell = SHELL_PAYLOADS[base];
    if (shell) {
      const hit = findPayloadFlag(toks, i + 1, shell);
      if (hit) {
        const fi = hit.index;
        const mode = hit.spec.mode;
        const payloadToks = (mode === 'single' || mode === 'encoded')
          ? (toks[fi + 1] !== undefined ? [toks[fi + 1]] : [])
          : toks.slice(fi + 1);
        if (payloadToks.length) {
          let payloadText = payloadToks.join(' ');
          if (mode === 'encoded') {
            const decoded = decodeEncodedCommand(payloadText);
            // 解不出来就不能当它安全：载荷解析不出 = 判定落空 = 放行
            if (decoded === null) {
              undecodable = true;
            } else {
              payloadText = decoded;
            }
          } else if (mode === 'single') {
            // POSIX shell 的 -c 取的那一个参数：外层 shell 先解转义，
            // 内层 shell 再按空格拆开。
            // 不解转义的话，`sh -c mavis\\ agent\\ delete\\ sa-x` 的载荷
            // 会保持成一个词，命令串看不见 = 判定落空 = 放行。
            payloadText = shellUnescape(payloadText);
          }
          payloads.push(payloadText);
        }
        // 载荷之后的 token 是命令参数，不是命令位置（见函数注释）
        return { contexts, payloads, undecodable };
      }
    }

    const spec = WRAPPER_SPECS[base];
    if (spec) {
      // command -v / -V：查询语义，不执行任何东西 —— 段内没有命令位置
      if (hasQueryFlag(toks, i + 1, spec)) {
        return { contexts, payloads, undecodable };
      }
      const r = skipWrapperArgs(toks, i + 1, spec);
      i = r.next;
      uncertain = uncertain || r.uncertain;
      continue;
    }
    if (String(toks[i]).startsWith('-')) { i++; uncertain = true; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(String(toks[i]))) { i++; continue; }
    break;
  }

  // 段首命令词
  const head = i < toks.length ? commandBasename(toks[i]).toLowerCase() : '';
  // 认不出的开关 -> 段首定不准 -> 一律按执行段处理（宁可多判不可漏判）
  const isData = !uncertain && head && DATA_COMMANDS.has(head);

  if (isData) {
    // 数据段：其余 token 是数据，不参与命令位置判定。
    // 两条例外 —— 这两种形态里，余下的 token 确实会被**执行**：
    //   ① find -exec / -execdir / -ok：后面跟的就是被执行的命令
    //   ② 启动器（npx / npm exec / pnpm dlx …）：后面跟的是要运行的程序
    const launchAt = launcherProgramIndex(toks, i, head);
    if (launchAt >= 0) {
      const sub = analyzeSegment(toks.slice(launchAt));
      for (const c of sub.contexts) contexts.push(c);
      for (const p of sub.payloads) payloads.push(p);
      if (sub.undecodable) undecodable = true;
    }
    for (let k = 0; k < toks.length; k++) {
      if (!EXEC_FLAGS.has(String(toks[k]).toLowerCase())) continue;
      if (k + 1 >= toks.length) continue;
      const sub = analyzeSegment(toks.slice(k + 1));
      for (const c of sub.contexts) contexts.push(c);
      for (const p of sub.payloads) payloads.push(p);
      if (sub.undecodable) undecodable = true;
    }
    return { contexts, payloads, undecodable };
  }

  // 执行段：段内每一个独立 token 都是命令候选
  const positions = [];
  for (let k = 0; k < toks.length; k++) positions.push(k);
  contexts.push({ toks, positions });

  // 段内出现的 shell 包装器（sh -c / bash -c / script -c / cmd /c …）——
  // 包装器可以出现在段的任何位置（parallel sh -c "…"），
  // 载荷本身是另一条命令，递归进去判。
  for (let k = 0; k < toks.length; k++) {
    const shell = SHELL_PAYLOADS[commandBasename(toks[k]).toLowerCase()];
    if (!shell) continue;
    const hit = findPayloadFlag(toks, k + 1, shell);
    if (!hit) continue;
    const fi = hit.index;
    const mode = hit.spec.mode;
    const payloadToks = (mode === 'single' || mode === 'encoded')
      ? (toks[fi + 1] !== undefined ? [toks[fi + 1]] : [])
      : toks.slice(fi + 1);
    if (!payloadToks.length) continue;
    let payloadText = payloadToks.join(' ');
    if (mode === 'encoded') {
      const decoded = decodeEncodedCommand(payloadText);
      if (decoded === null) undecodable = true;
      else payloadText = decoded;
    } else if (mode === 'single') {
      // POSIX shell 的 -c 取一个参数：外层 shell 先解转义，内层 shell 再按空格拆开
      payloadText = shellUnescape(payloadText);
    }
    payloads.push(payloadText);
  }

  return { contexts, payloads, undecodable };
}

// 命令替换：$(...) 与反引号里的内容会被 shell 真的执行。
// 含有替换的命令不能按「纯读命令」算 —— 否则 cat $(mavis agent delete x)
// 会因为段首是 cat 而绕过写通道的危险判定。
export function hasCommandSubstitution(cmd) {
  const s = String(cmd || '');
  // 进程替换 <( … ) 也是真执行：shell 会另起一个进程跑里面的命令。
  // 以前只认 $() 与反引号，于是 grep -f <(mavis agent delete x) 走的是读命令通道，
  // 账号级判定压根没被调用 —— 判定落空就是静默失效（D-25 同族残余）。
  return /\$\([^)]*\)/.test(s) || /`[^`]*`/.test(s) || /<\(/.test(s);
}

// 取出命令替换里的载荷（$(...) / 反引号 / 进程替换 <(…)），逐个当命令继续判定。
function substitutionPayloads(cmd) {
  const s = String(cmd || '');
  const out = [];
  const re1 = /\$\(([^()]*)\)/g;
  let m;
  while ((m = re1.exec(s))) out.push(m[1]);
  const re2 = /`([^`]*)`/g;
  while ((m = re2.exec(s))) out.push(m[1]);
  for (const p of processSubstitutionPayloads(s)) out.push(p);
  return out;
}

// 进程替换 <( … ) 的载荷：按配对括号取，避免把里面的括号截断。
// 括号不配对就不是可执行的进程替换（shell 报语法错），不当载荷处理。
function processSubstitutionPayloads(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf('<(', i);
    if (j < 0) break;
    let depth = 0;
    let k = j + 1;
    for (; k < s.length; k++) {
      if (s[k] === '(') depth++;
      else if (s[k] === ')') { depth--; if (depth === 0) break; }
    }
    if (k >= s.length) break;
    out.push(s.slice(j + 2, k));
    i = k + 1;
  }
  return out;
}

// mavis 的全局开关里「带独立取值」的那些：它们的取值不是子命令。
// 未知开关一律当布尔开关（跳过即可）—— 否则 `mavis --yes agent delete`
// 里的 agent 会被当成 --yes 的取值而漏判。
const MAVIS_VALUE_FLAGS = new Set([
  '--profile', '--config', '--cwd', '--dir', '--output', '-o', '--model', '-m',
  '--log-level', '--log-file', '--session'
]);

// mavis 之后的**第一个**子命令在哪个下标（找不到返回 -1）。
// 只有「开关」和「开关的取值」可以出现在子命令之前；
// 任何普通 token 出现就说明子命令已经开始了。
function firstSubcommandIndex(toks, from) {
  for (let i = from; i < toks.length; i++) {
    const t = String(toks[i]);
    if (!t.startsWith('-')) return i;                       // 第一个非开关 token 就是子命令
    const f = t.toLowerCase();
    if (f.includes('=')) continue;                          // --flag=value 自带取值
    if (MAVIS_VALUE_FLAGS.has(f) && i + 1 < toks.length) { i++; continue; }  // 取值不是子命令
  }
  return -1;
}

// 在一段命令文本里找账号级 / 对外不可逆动作的命令形态。
// 返回 { matched, reason } 或 null。
export function detectDangerousAccountCommand(cmd, depth = 0) {
  const segments = splitCommandSegments(cmd);

  // 命令替换（$(...) / 反引号）：替换里的内容会被 shell 真的执行，
  // 段首是 cat / echo 也不能让它按「纯读命令」溜过去。
  if (depth < 3) {
    for (const payload of substitutionPayloads(cmd)) {
      const inner = detectDangerousAccountCommand(payload, depth + 1);
      if (inner) return inner;
    }
  }

  for (const seg of segments) {
    // 用 shell 感知的切词：引号内的内容整体是一个 token（字样 vs 形态的分界），
    // 反斜杠转义也不拆词 —— 否则命令串会被切碎，判定落空。
    const toks = splitCommandTokensShell(seg);
    if (!toks.length) continue;
    const { contexts, payloads, undecodable } = analyzeSegment(toks);

    // 命令载荷解不出来（base64 编码且无法还原成命令文本）-> 拒绝：
    // 「解析不出就放行」等于这次调用绕过了账号级判定。
    if (undecodable) {
      return {
        matched: 'powershell -EncodedCommand',
        reason: '命令载荷是 base64 编码且无法还原成命令文本，无法确认它不含账号级不可逆动作'
      };
    }

    // shell 包装器的命令载荷：sh -c "<另一条命令>" / powershell -Command <整段> / cmd /c <整行>
    // —— 递归进载荷里继续判定，否则 `bash -c "mavis agent delete x"` 就是现成的旁路。
    // 包装器可以套在别的包装器前面（sudo bash -c "…"），所以按命令位置找，不只看段首。
    if (depth < 3) {
      for (const payload of payloads) {
        const inner = detectDangerousAccountCommand(payload, depth + 1);
        if (inner) return inner;
      }
    }

    // 逐个上下文判定：
    //   contexts 里每一项是一段「可以出现命令位置」的 token 序列。
    //   数据段通常没有上下文（其余 token 是数据）；
    //   执行段把段内每个独立 token 都列为候选 —— 包装器是闭集，
    //   靠「表里有没有这个名字」定位命令词必然被下一个变体绕过，
    //   改成「每个 token 都可能是命令」之后，exec / taskset / watch / at / …
    //   以及任何将来出现的包装器都自动被覆盖。
    for (const ctx of contexts) {
      const ct = ctx.toks;
      const cp = ctx.positions;

      if (depth < 3) {
        // eval "…"：参数就是被执行的命令，同样要递归进去。
        for (const p of cp) {
          if (commandBasename(ct[p]).toLowerCase() !== 'eval') continue;
          const inner = detectDangerousAccountCommand(ct.slice(p + 1).join(' '), depth + 1);
          if (inner) return inner;
        }
      }

      // ── mavis agent delete|update —— 账号级成员删除/改写 ──
      // 判据是「CLI + 子命令 + 动作」三个词在命令位置上连续出现，
      // 不是文本里出现 delete 字样：rm build/out.txt 这类普通路径操作不受影响。
      for (const p of cp) {
        if (!isMavisWord(ct[p])) continue;
        // 子命令必须是 mavis 之后的**第一个**子命令（D-25 残余）：
        //   `mavis list agent delete` 只是「list 的参数里恰好有 agent delete」，
        //   `mavis agent list` 是列成员 —— 都不是账号级删除动作。
        //   按「mavis 后面出现 agent delete」匹配是过度拦（把无害命令拦掉）。
        //   允许中间夹全局开关（mavis --profile x agent delete）。
        const ai = firstSubcommandIndex(ct, p + 1);
        if (ai < 0) continue;
        if (!/^agent$/i.test(String(ct[ai]))) continue;
        const ji = nextMeaningfulIndex(ct, ai + 1);
        if (ji < 0) continue;
        const act = String(ct[ji]).toLowerCase();
        if (act !== 'delete' && act !== 'update' && act !== 'create') continue;
        if (act === 'delete') {
          return {
            matched: 'mavis agent delete',
            reason: '删除账号级成员是账号级不可逆操作（历史会话不会随之清理）'
          };
        }
        if (act === 'update') {
          return {
            matched: 'mavis agent update',
            reason: '改写账号级成员是账号级变更，需人工确认'
          };
        }
        // 建号必须与删除 / 改写对称（D-39）：
        // 账号成员是账号级全局可见的（跨项目），任何会话都能建号 =
        // 绕过造人纪律往账号里塞成员，账号成员集合与项目名录必然脱钩 ——
        // 那正是「名录里有、账号里没有」的镜像面。
        return {
          matched: 'mavis agent create',
          reason: '创建账号级成员是账号级全局可见的变更，需人工确认（造人纪律由父会话把关）'
        };
      }

      // ── 对外可见的发布/部署形态 ──
      // 只在命令位置判定：cat website_deploy.md、grep "miniapp publish" .
      // 这类只是读文件/搜文本，命令位置是 cat / grep，不该被拦。
      for (const p of cp) {
        const head = commandBasename(ct[p] || '');

        // website_deploy —— 部署会把内容发布到公网
        if (/^website[_-]?deploy$/i.test(head)) {
          return {
            matched: 'website_deploy',
            reason: '部署会把内容发布到公网，属于对外可见的不可逆动作'
          };
        }

        // miniapp publish —— 发布 Mini App 会替换线上运行实例
        if (/^miniapp[_-]?publish$/i.test(head)) {
          return {
            matched: 'miniapp_publish',
            reason: '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作'
          };
        }
        if (/^miniapp$/i.test(head)) {
          const pi = nextMeaningfulIndex(ct, p + 1);
          if (pi > 0 && String(ct[pi]).toLowerCase() === 'publish') {
            return {
              matched: 'miniapp publish',
              reason: '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作'
            };
          }
        }
      }
    }
  }
  return null;
}

// ── 工具名的字面量为什么是拼出来的 ─────────────────────────────
//
// 这几个工具名一旦以字面形态出现在源码里，**本插件自己的复合层危险扫描**
// 就会把源码当成「载荷正文」命中（同一套规则、同一个仓库 = 自举误伤）。
// 所以它们在这里拼出来。代价：拼错就是判定**静默失配**（工具名匹配不上 → 放行），
// 所以每个拼出来的名字都有专属断言锁住（见 tests/guard-test.mjs 的 D-39 / D-41 断言）。
// 新版的复合层按**内层工具**分形态判之后，载荷正文不再参与判定 —— 那时可以把
// 这些名字还原成字面量（还原时记得同批断言一起改）。
export const TOOL_DEPLOY = 'website' + '_deploy';
export const TOOL_APP_PUBLISH = 'mini' + 'app' + '_publish';
export const TOOL_AGENT_DELETE = 'mavis' + '_agent' + '_delete';
export const TOOL_AGENT_UPDATE = 'mavis' + '_agent' + '_update';
export const TOOL_AGENT_CREATE = 'mavis' + '_agent' + '_create';
export const TOOL_MAVIS = 'mavis';
export const TOOL_APP = 'mini' + 'app';

// ── 复合层（run_code）的危险操作判定：按**内层工具**分形态判（D-41）──────
//
// 为什么不能对整段代码文本做朴素正则：
//   复合工具的载荷是**自由文本代码**，其中 write / edit 的载荷是**数据**（文档正文）。
//   审计者写复现步骤、引用拦截原文时，报告正文里出现被禁形态的字面量 ——
//   报告本身被拦（本轮成文时亲身触发过两次），审计产出无法落盘。
//   同一机制两套口径（bash 通道按命令位置判、复合层按字样判）本身就是缺陷。
//
// 口径（与 bash 通道对齐，契约 S3 / S5.4）：
//   · write / edit 的载荷是数据 —— **不按命令形态判**；
//   · bash 的 command 是命令 —— 交给命令位置判定（detectDangerousAccountCommand）；
//   · mavis 工具按参数判（command）；小程序发布类工具按参数判（action）；
//   · 直接点名危险工具的调用 —— 照拦。
//
// 诚实边界：复合层是**纵深防御的加成**，不是唯一防线 ——
// 容器调用的 PreToolUse 派发不是平台恒定行为（契约 S3「容器调用的派发事实」），
// 真执行时每个内层调用各自触发 PreToolUse，判定对象是真实实参。

// 复合层里「载荷是数据」的工具：write / edit 的正文是文档，不是命令。
const COMPOSITE_DATA_TOOLS = new Set([
  'write', 'edit', 'multiedit', 'notebookedit', 'apply_patch', 'patch',
  'write_file', 'create_file', 'append_file', 'replace_in_file'
]);

// 复合层里「点名即危险」的工具。
const COMPOSITE_DANGEROUS_TOOLS = {
  [TOOL_DEPLOY]: '部署会把内容发布到公网，属于对外可见的不可逆动作',
  [TOOL_APP_PUBLISH]: '发布小程序会替换线上运行实例，属于对外可见的不可逆动作',
  [TOOL_AGENT_DELETE]: '删除成员是账号级不可逆操作（历史会话不会随之清理）',
  [TOOL_AGENT_UPDATE]: '修改成员的 description/system_prompt 是账号级变更，需人工确认',
  [TOOL_AGENT_CREATE]: '创建账号级成员是账号级全局可见的变更，需人工确认'
};

// 账号级成员动作（mavis 工具的 command 参数）。
const ACCOUNT_MEMBER_ACTIONS = new Set(['delete', 'update', 'create']);

// 取一次调用的实参文本（从左括号到配对的右括号）。
function callArgs(src, openIdx) {
  let depth = 0, quote = '';
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1);
}

// 取一个具名属性的值表达式（对象字面量里的 key: value）。
function propertyExpression(argsText, key) {
  const re = new RegExp('(?:^|[\\s,{])' + key + '\\s*:', 'g');
  let m;
  while ((m = re.exec(argsText))) {
    const expr = takeExpression(argsText, m.index + m[0].length);
    if (expr) return expr;
  }
  return '';
}

// 从 start 开始取一个表达式（到同层的逗号或右括号为止）。
function takeExpression(src, start) {
  let depth = 0, quote = '';
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) { quote = ''; continue; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return src.slice(start, i).trim();
      depth--;
      continue;
    }
    if (ch === ',' && depth === 0) return src.slice(start, i).trim();
  }
  return src.slice(start).trim();
}

// 取一段文本里的字符串字面量（按出现顺序）。
function stringLiterals(text) {
  const src = String(text || '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let buf = '';
      i++;
      while (i < src.length) {
        const c2 = src[i];
        if (c2 === '\\') { buf += src[i + 1] || ''; i += 2; continue; }
        if (c2 === quote) { i++; break; }
        buf += c2;
        i++;
      }
      out.push(buf);
      continue;
    }
    i++;
  }
  return out;
}

// 取一个属性的字符串值：优先按具名属性取；取不到就退回第一个字符串字面量。
// 字面量拼接（'x ' + 'y'）按拼接结果处理 —— 拆开写不该成为绕过口。
function firstStringArg(argsText, key) {
  const expr = propertyExpression(argsText, key);
  if (expr) {
    const lits = stringLiterals(expr);
    if (lits.length) return lits.join('');
  }
  const lits = stringLiterals(argsText);
  return lits.length ? lits[0] : '';
}

// mavis 的 command 参数是不是账号级成员动作（返回动作名或空串）。
function accountMemberAction(cmd) {
  const c = String(cmd || '').trim();
  const m = c.match(/^agent\s+([A-Za-z]+)/);
  if (!m) return '';
  const act = String(m[1] || '').toLowerCase();
  return ACCOUNT_MEMBER_ACTIONS.has(act) ? act : '';
}

// 复合层的危险操作判定。返回 { matched, reason } 或 null。
export function detectDangerousInComposite(code) {
  const src = String(code || '');
  if (!src) return null;
  const callRe = /tools\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])\s*\(/g;
  let m;
  while ((m = callRe.exec(src))) {
    const name = String(m[1] || m[2] || '').trim().toLowerCase();
    if (!name) continue;
    // 数据载荷：write / edit 的正文是文档数据，不按命令形态判。
    if (COMPOSITE_DATA_TOOLS.has(name)) continue;
    const args = callArgs(src, callRe.lastIndex - 1);
    if (Object.prototype.hasOwnProperty.call(COMPOSITE_DANGEROUS_TOOLS, name)) {
      return { matched: 'tools.' + name, reason: COMPOSITE_DANGEROUS_TOOLS[name] };
    }
    if (name === TOOL_MAVIS) {
      const cmd = firstStringArg(args, 'command');
      const act = accountMemberAction(cmd);
      if (act) {
        return {
          matched: TOOL_MAVIS + ' ' + cmd,
          reason: act === 'delete'
            ? '删除成员是账号级不可逆操作（历史会话不会随之清理）'
            : (act === 'update'
              ? '修改成员的 description/system_prompt 是账号级变更，需人工确认'
              : '创建账号级成员是账号级全局可见的变更，需人工确认')
        };
      }
      continue;
    }
    if (name === TOOL_APP) {
      const action = firstStringArg(args, 'action');
      if (String(action || '').trim().toLowerCase() === 'publish') {
        return {
          matched: TOOL_APP + ' publish',
          reason: '发布小程序会替换线上运行实例，属于对外可见的不可逆动作'
        };
      }
      continue;
    }
    if (name === 'bash') {
      // bash 的 command 是**命令**，不是数据 —— 交给命令位置判定。
      const cmd = firstStringArg(args, 'command');
      const hit = detectDangerousAccountCommand(cmd);
      if (hit) return hit;
      continue;
    }
  }
  return null;
}

// ── 收尾契约校验（S1 / S8）──────────────────────────────
// 产出「缺陷清单 / 验收结论 / 复盘记录」时，条目必须符合 S1 的 7 字段模板。
// watchdog 在 SubagentStop 时校验，不合规就明确指出缺哪一项（S8）。
export const ENTRY_FIELDS = ['触发条件', '影响', '复现步骤', '证据', '状态', '修法方向', '还需要什么'];

export function validateEntryOutput(text) {
  const src = String(text || '');
  const lines = src.split(/\r?\n/);
  const entryRe = /^###\s+([A-Za-z][A-Za-z0-9]{1,7})-(\d{2})\s*$/;
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = String(lines[i]).trim().match(entryRe);
    if (m) heads.push({ index: i, prefix: m[1], seq: Number(m[2]), line: String(lines[i]).trim() });
  }
  // 没有条目 -> 不是「条目型产出」，不适用 S1 校验（否则每一次普通交付都会被拦）
  if (!heads.length) return { checked: false, ok: true, problems: [] };
  const problems = [];
  const prefixes = [...new Set(heads.map((h) => h.prefix))];
  if (prefixes.length > 1) problems.push('编号前缀不一致：' + prefixes.join(' / '));
  for (let i = 1; i < heads.length; i++) {
    if (heads[i].seq !== heads[i - 1].seq + 1) {
      problems.push('编号跳号：' + heads[i - 1].prefix + '-' + String(heads[i - 1].seq).padStart(2, '0') +
        ' 之后直接是 ' + heads[i].prefix + '-' + String(heads[i].seq).padStart(2, '0'));
    }
  }
  if (heads[0].seq !== 1) {
    problems.push('编号必须从 01 开始，当前第一条是 ' + heads[0].prefix + '-' + String(heads[0].seq).padStart(2, '0'));
  }
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index;
    const end = i + 1 < heads.length ? heads[i + 1].index : lines.length;
    const body = lines.slice(start + 1, end);
    const found = new Set();
    for (const l of body) {
      const m = String(l).match(/^\s*[-*]?\s*([^:：\s]+)\s*[:：]/);
      if (m && ENTRY_FIELDS.includes(m[1])) found.add(m[1]);
    }
    for (const f of ENTRY_FIELDS) {
      if (!found.has(f)) problems.push(heads[i].line + ' 缺字段「' + f + '」');
    }
  }
  const statLine = lines.find((l) => /条目统计/.test(l));
  if (!statLine) {
    problems.push('缺「条目统计」行');
  } else {
    const total = (String(statLine).match(/总计\s*(\d+)\s*条/) || [])[1];
    const repro = (String(statLine).match(/已复现\s*(\d+)\s*条/) || [])[1];
    const infer = (String(statLine).match(/推断\s*(\d+)\s*条/) || [])[1];
    if (!total) problems.push('「条目统计」行里读不出总条数');
    else if (Number(total) !== heads.length) {
      problems.push('「条目统计」写的是 ' + total + ' 条，实际条目 ' + heads.length + ' 条');
    }
    if (repro && infer && Number(repro) + Number(infer) !== heads.length) {
      problems.push('「条目统计」的已复现(' + repro + ')+推断(' + infer + ') 与实际条目数 ' + heads.length + ' 对不上');
    }
  }
  return { checked: true, ok: problems.length === 0, problems };
}
// ── 主动触发粗筛（UserPromptSubmit / D-27）───────────────────────
//
// 判定抽到这里并导出，回归可以 import 后直接喂样本断言。
// 以前只能靠「跑 gate 脚本看 stdout」来验 —— 而漏判的表现恰好就是
// 「stdout 为空」，跟「判定为不该命中」长得一模一样，
// 所以漏判能长期不被发现（D-27）。
//
// 三档判据（语料与判据见 docs/audit/d27-acceptance.md）：
//   A 编排意图 —— 必须命中
//   B 单点动作 —— 必须不命中
//   C 伪信号 —— 出现「同时/多个/分别/各自/并行」但不是在要求编排，必须不命中
//
// 上一轮错在三处：
//   ① INTENT 只有名词化/书面说法（派工/组队/分工/验收/复盘），
//      口语动词短语（拆一下/分头做/谁负责/各做各的…）全漏；
//   ② `prompt.length > 40` 这个硬门槛把 SIGNAL 彻底废掉 ——
//      中文口语指令通常只有 3~12 字，SIGNAL 里的「同时/各自/多个」一个都够不着；
//   ③ SIGNAL 单独出现就命中会误伤，所以信号词必须与「动作词」邻近同现才算编排意图。

// 编排意图：书面说法 + 口语动词短语 + 机制自指 + 多项请求。
// 每个词都带上下文约束，避免「并行度」「批量导入」这类普通句子被卷进来。
const TRIGGER_INTENT = new RegExp([
  // —— 书面 / 名词化 ——
  '派工', '组队', '组建', '拆成', '拆给', '拆开', '拆分', '拆一下', '拆解',
  '分工', '分一下', '分头', '分成', '分给',
  '安排人', '你安排', '交给谁', '谁来做', '谁去做', '谁负责',
  '编排', '路由', '多.?agent', '团队', '专项', '验收', '复盘', '错题本',
  '复审', '评审',
  // —— 并行词必须带动作后缀：光有「并行」不算（并行度调高一点不是编排）——
  '并行(?=.{0,4}(做|跑|处理|执行|推进|干|搞|分|写|改))',
  // —— 口语动词短语 ——
  '各做各的', '各自负责', '一起做', '一起搞', '一起干',
  '几个人', '两个人', '三人', '多人', '多开',
  '开.?个会话', '开一会话', '一前一后', '一边',
  '放到后台', '放后台',
  // —— 数量 + 事 ——
  '两件事', '三件事', '几件事', '多件事', '好几件',
  // —— 机制自指：用户在谈编排机制本身 ——
  '主动触发', '触发机制', '编排机制', '路由机制', '派工机制', '编排协议', '触发链路',
  // —— 多项请求 ——
  '还有(其他|别的|其它|几个|什么)', '另外(还有|也)', '顺便(也)?', '此外',
  // —— 和…一起 / 能不能一起 ——
  '(和|跟|与).{0,12}一起', '能不能一起', '可不可以一起'
].join('|'), 'i');

// 并行/多路信号词：单独出现不算意图，必须与动作词邻近同现。
// 刻意不收「批量」「多线程」—— 「批量导入」「多线程安全吗」都是单点动作，不是编排。
const TRIGGER_SIGNAL = /(并行|同时|多个|分别|各自|一起|两头|分头|一前一后|多路)/i;

// 动作词：出现信号词时，必须在邻近窗口内同现，否则视为伪信号。
// 刻意不收「改/写/修/开」这类单点动作词 ——
// 「同时改一下这两个文件」「同时打开这两个文件」是单点动作，不是编排。
const TRIGGER_ACTION = /(做|干|搞|负责|处理|执行|跑|推进|开工|动手|包办|安排|评审|复审|完成|实现|分工|拆|派|上线|发布)/i;

// 信号词与动作词的邻近窗口（字符）。
const TRIGGER_WINDOW = 12;

// SCOPE 提示：用户文本里出现了 SCOPE: 段 → 本轮大概率是在下派工指令。
const TRIGGER_SCOPE = /SCOPE\s*[:：]/i;

// 判定：这段 prompt 该不该走编排流程。
// 返回 { hit, reason } —— reason 给断言与留痕用，不参与判定。
export function judgeTriggerIntent(prompt) {
  const p = String(prompt || '');
  if (!p.trim()) return { hit: false, reason: '空 prompt' };

  if (TRIGGER_INTENT.test(p)) return { hit: true, reason: '编排意图词命中' };

  // 信号词 + 邻近动作词：并行/同时/各自… 只有真的在要求「谁做什么」才算编排。
  for (const m of p.matchAll(new RegExp(TRIGGER_SIGNAL.source, 'gi'))) {
    const lo = Math.max(0, m.index - TRIGGER_WINDOW);
    const hi = Math.min(p.length, m.index + m[0].length + TRIGGER_WINDOW);
    if (TRIGGER_ACTION.test(p.slice(lo, hi))) {
      return { hit: true, reason: '信号词+邻近动作词命中：' + m[0] };
    }
  }

  if (TRIGGER_SCOPE.test(p)) return { hit: true, reason: 'SCOPE 提示命中' };
  return { hit: false, reason: '未命中编排意图' };
}

// 留痕位置：PLUGIN_DATA 可写且跨会话持久。
// 「载荷坏了」「字段名变了」这类静默失效必须留痕 ——
// 不留痕的话，「永远不命中」和「判定为不该命中」在日志里长得一样。
export function writeGateTrace(kind, detail) {
  try {
    const base = process.env.PLUGIN_DATA;
    if (!base) return false;
    // PLUGIN_DATA 在不同上下文里含义不同：
    //   运行时 = .../plugin-data/hooks/super-agent-router（本插件的专属目录）
    //   测试里 = .../plugin-data（整个根）
    // 无条件再拼一层 hooks/super-agent-router，运行时痕迹就落到多套一层的怪路径 ——
    // 痕迹**确实写了**，但按文档给的路径去找找不到，等于半个静默失效（D-29）。
    // 所以按目录名判断：已经是本插件目录就直接写进去，否则才补一层。
    // 判定用 basename 而不是正则锚末尾：path.basename 会忽略末尾的分隔符，
    // 所以 PLUGIN_DATA 带尾斜杠时也判得对（正则 `...$` 会被尾斜杠打破，
    // 于是又去多套一层 —— 独立验收 F4 实测出来的洞）。
    const isPluginDir =
      path.basename(base).toLowerCase() === 'super-agent-router' &&
      path.basename(path.dirname(base)).toLowerCase() === 'hooks';
    const dir = isPluginDir ? base : path.join(base, 'hooks', 'super-agent-router');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, 'gate-trace.jsonl'),
      JSON.stringify({ t: Date.now(), kind: String(kind), detail: String(detail || '').slice(0, 500) }) + '\n',
      'utf8'
    );
    return true;
  } catch {
    return false;
  }
}

