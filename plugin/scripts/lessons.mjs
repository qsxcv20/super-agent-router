// 错题本与实战记录：读取 + 记录闸门的共享判据
//
// 为什么这些判据住在这个文件里：写入端（lessons-gate / record-gate）与
// 读取端（dispatch / records / roster）必须用**同一套**判据。
// 「写进去却读不出来」「两处口径不同」「冒用别人身份无人拦」这三类缺陷，
// 根因都是同一个：**判据有两份**。
//
//   - 段首定位：写入端曾用 indexOf('## 实战记录')（子串），读取端用行首匹配
//     → 正文里只要出现一次字面串，写入端就定位到前一个段去，
//       新履历落进「归属」段，读取端只认真正的段 → 写进去却读不出来。
//   - 错题本状态：文件存在但规则抽不出，被说成「还没栽过跟头」
//     → 把「抽不出」谎报成「真空态」。
//   - 写入者身份：载荷写谁的账本就写进谁的账本 → 冒用他人身份无人拦。
//   - 并发写入：读-改-写无锁 → 后写者用旧快照覆盖先写者，条目静默丢失。
//
// 插件包是只读的，教训与履历数据永远在项目里 —— 跨项目各看各的。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readLedger, findBinding } from './lib.mjs';

export function projectDir() {
  return process.env.MINIMAX_PROJECT_DIR || process.cwd();
}

export function lessonsDir() {
  return path.join(projectDir(), '.superagent', 'lessons');
}

export function lessonsPath(name) {
  const safe = String(name || '').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(lessonsDir(), safe + '.md');
}

export function methodsDir() {
  return path.join(projectDir(), '.superagent', 'methods');
}

export function methodPath(name) {
  const safe = String(name || '').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(methodsDir(), safe + '.md');
}

// ── 段首定位（写入端与读取端共用一套口径） ──────────────────
//
// 口径：**行首锚定**。只认真正的一级段首行（行首的「## 」+ 标题里含「实战记录」），
// 不看正文里有没有出现「## 实战记录」这个字面串。
//
// 为什么必须是行首：以前 record-gate 用 indexOf('## 实战记录')（子串匹配），
// lessons.mjs 的读取端用行首匹配 —— 同一份文件里两套口径。
// 方法论文件正文里只要出现一次字面串（引用、模板片段、说明文字），
// 写入端就定位到前一个段去 → 新履历写进「归属」段 → 读取端读不到（静默丢失），
// 而且那个段里的其它「###」被当成履历条数 → 上限被提前触顶。
//
// 口径定义（三个量都从这里出，避免各写一套）：
//   start = 第一个标题里含「实战记录」的「## 」行所在的绝对偏移
//   end   = 下一个「## 」行的绝对偏移（没有则到文件末尾）
//   body  = [start, end) 的正文
//
// 多个「实战记录」段时取**第一个**：写入口与读入口必须指向同一段，
// 否则计数与读回又会分成两套口径。代价是「两个实战记录段」这种畸形文件
// 的第二段不再被计入 —— 这是有意的取舍，写在这里让后来者知道。
export const RECORDS_SECTION = '实战记录';

// 段首标题行：写入端新建该段时用它。
// 为什么由 RECORDS_SECTION 拼出来而不是各写一份字面串：
// 段名与标题行是同一件事的两种写法 —— 写入端另写一份就等于又多了一个口径，
// 而 D-51（段首定位两套口径）的根因正是「同一件事写了两遍」。
export const RECORDS_HEADING = '## ' + RECORDS_SECTION;

export function locateRecordsSection(raw) {
  const text = String(raw || '');
  const heads = [];
  const re = /^##[ \t]+[^\n]*/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    heads.push({ title: m[0], start: m.index });
  }
  for (let i = 0; i < heads.length; i++) {
    if (heads[i].title.indexOf(RECORDS_SECTION) === -1) continue;
    const start = heads[i].start;
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    return { found: true, start, end, title: heads[i].title, body: text.slice(start, end) };
  }
  return { found: false, start: -1, end: -1, title: '', body: '' };
}

// 段内履历条数：只数三级标题（条目的头）。
export function countRecordsInSection(body) {
  return (String(body || '').match(/^###[ \t]+/gm) || []).length;
}

// 文件里「实战记录」段的条目数：段定位与段内计数两步都走同一套口径。
export function countRecordsInFile(raw) {
  const sec = locateRecordsSection(raw);
  return sec.found ? countRecordsInSection(sec.body) : 0;
}

// 把一条履历写进「实战记录」段 —— 写入口径与读入口径同源。
//
// 为什么抽到这里：写入端（record-gate）原来自己算段首（子串 indexOf），
// 读取端（readRecords）按行首匹配 —— 同一份文件两套口径（D-51）。
// 现在定位、计数、插入三件事共用 locateRecordsSection 一个事实源。
//
// 段不存在时在文末新建该段；段存在时插到段末（下一个二级标题之前），
// 该段之后的内容原样保留。
export function appendRecordsEntry(raw, entryText) {
  const text = String(raw || '');
  const entry = String(entryText || '');
  const sec = locateRecordsSection(text);
  if (!sec.found) {
    return text.replace(/\s*$/, '\n') + '\n' + RECORDS_HEADING + '\n\n' + entry + '\n';
  }
  const before = text.slice(0, sec.end).replace(/\s*$/, '\n');
  const after = text.slice(sec.end).replace(/^\n+/, '\n');
  return before + '\n' + entry + '\n' + after;
}

// 只取「规则」段 —— 那是下次派工能直接执行的一条判断。
// 现象/根因是背景，对派工无用，只占上下文。
export function extractRules(raw) {
  const rules = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const m = line.match(/^-\s*\*\*规则\*\*[：:]\s*(.+)$/);
    if (m) rules.push(m[1].trim());
  }
  return rules;
}

export function readLessons(name) {
  let raw;
  try { raw = fs.readFileSync(lessonsPath(name), 'utf8'); } catch { return []; }
  return extractRules(raw);
}

// 错题本条目数：条目头形如「## 2026-11-10 · 任务「…」· 类型：…」。
export function countEntryHeaders(raw) {
  const m = String(raw || '').match(/^##\s+\d{4}-\d{2}-\d{2}\s+·/gm);
  return m ? m.length : 0;
}

export function countEntries(name) {
  let raw;
  try { raw = fs.readFileSync(lessonsPath(name), 'utf8'); } catch { return 0; }
  return countEntryHeaders(raw);
}

// ── 错题本状态三态 ───────────────────────────────────────
//
// 「0 条」不是一个状态，是三个：
//   no-file     —— 没有错题本文件（真空态：还没栽过跟头）
//   empty       —— 文件在，但没有条目（真空态：还没栽过跟头）
//   unreadable  —— 文件在、有条目，却一条规则都抽不出来（**异常**：格式不匹配 / 通道故障）
//   entries     —— 有条目且抽得出规则
//
// 以前只分「抽得出 / 抽不出」两种，抽不出就一律说成「还没栽过跟头」——
// 把「抽不出」谎报成「没栽过跟头」，Router/Worker 据此以为该成员是干净的。
export const LESSONS_STATE = {
  NO_FILE: 'no-file',
  EMPTY: 'empty',
  UNREADABLE: 'unreadable',
  ENTRIES: 'entries'
};

export function readLessonsStatus(name) {
  const p = lessonsPath(name);
  let raw = null;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { raw = null; }
  if (raw === null) {
    return { state: LESSONS_STATE.NO_FILE, fileExists: false, entries: 0, rules: [], path: p };
  }
  const rules = extractRules(raw);
  const entries = countEntryHeaders(raw);
  if (rules.length) {
    return { state: LESSONS_STATE.ENTRIES, fileExists: true, entries, rules, path: p };
  }
  if (entries > 0) {
    // 有条目却抽不出规则 —— 这是异常，不是「还没栽过跟头」。
    return { state: LESSONS_STATE.UNREADABLE, fileExists: true, entries, rules: [], path: p };
  }
  return { state: LESSONS_STATE.EMPTY, fileExists: true, entries: 0, rules: [], path: p };
}

// 三态各说一句人话。注入层（dispatch.mjs）用这一句，别再自己拼文案。
export function lessonsStatusLine(name) {
  const s = readLessonsStatus(name);
  const head = '[super-agent-router] ' + name + ' 的历史教训：0 条';
  if (s.state === LESSONS_STATE.NO_FILE) {
    return head + '（该成员暂无错题本 —— 是「还没栽过跟头」，不是传递故障）。';
  }
  if (s.state === LESSONS_STATE.EMPTY) {
    return head + '（错题本文件已建、尚无条目 —— 真空态，是「还没栽过跟头」，不是传递故障）。';
  }
  return head + '（错题本文件存在（' + s.entries + ' 条记录），但一条规则都抽不出来 —— ' +
    '这是格式/通道异常，**不是**「还没栽过跟头」，待查：' + s.path + '）。';
}

// Router 私有账（.superagent/lessons/_router.md）的条目用的是**契约 S1 的 7 字段模板**
// （触发条件 / 影响 / 复现步骤 / 证据 / 状态 / 修法方向 / 还需要什么），
// 不是成员错题本那套 4 字段格式 —— 所以 readLessons() 的「- **规则**：」正则对它**一条都抽不出来**。
// 编排层的教训因此一直零回流：SessionStart 从没注入过它，父会话每份 brief 各写各的模板。
// 这里按 S1 模板抽「编号 + 修法方向」—— 修法方向是能直接执行的一句判断。
export function readRouterLessons() {
  let raw;
  try { raw = fs.readFileSync(lessonsPath('_router'), 'utf8'); } catch { return []; }
  const out = [];
  for (const b of raw.split(/^###\s+/m).slice(1)) {
    const id = (b.match(/^([A-Za-z0-9_-]+)/) || [])[1] || '';
    if (!id) continue;
    const fix = (b.match(/^- 修法方向：\s*(.+)$/m) || [])[1] || '';
    const trigger = (b.match(/^- 触发条件：\s*(.+)$/m) || [])[1] || '';
    out.push({
      id,
      fix: fix.slice(0, 240),
      trigger: trigger.slice(0, 160)
    });
  }
  return out;
}

// 实战记录（履历）：写在方法论文件的「实战记录」段里。
// 镜像关系：错题本记「栽过哪」（失败，下次前置），
//           实战记录记「做成过什么」（成功，下次匹配更准）。
//
// 读取端与写入端共用 locateRecordsSection —— 口径只有这一份。
export function readRecords(name) {
  let raw;
  try { raw = fs.readFileSync(methodPath(name), 'utf8'); } catch { return []; }
  const sec = locateRecordsSection(raw);
  if (!sec.found) return [];
  const out = [];
  let cur = null;
  for (const line of sec.body.split(/\r?\n/)) {
    // 三级标题（###）是段内条目；二级标题是段落边界（已由 locate 切好）
    const h = line.match(/^###[ \t]+(.+)$/);
    if (h) { cur = { title: h[1].trim(), approach: '', evidence: '', verified: '' }; out.push(cur); continue; }
    const a = line.match(/^-\s*做法[：:]\s*(.+)$/);
    if (a && cur) { cur.approach = a[1].trim(); continue; }
    const e = line.match(/^-\s*证据[：:]\s*(.+)$/);
    if (e && cur) { cur.evidence = e[1].trim(); continue; }
    const v = line.match(/^-\s*验收[：:]\s*(.+)$/);
    if (v && cur) { cur.verified = v[1].trim(); continue; }
  }
  return out;
}

// ── 写入者身份（谁在写） ───────────────────────────────────
//
// 判据：**派工台账的子会话绑定**。
//   调用方必须带 session_id；闸门用 findBinding(ledger, session_id) 查到
//   该子会话绑定的成员（agent_key），再与载荷里的 agent 比对 ——
//   不一致即拒。写入目标不再由载荷独断。
//
// 为什么绑定比「载荷自称」可信：绑定由 guard 在 worker 第一次用工具时写进台账，
// 台账不在成员的 scope 内，成员改不了（契约 S2/S6）。
//
// 两种合法调用方：
//   1. **成员子会话**：台账里 session_id 有绑定 → 只能写**绑定成员自己**的账本。
//   2. **父会话（Router）**：父会话没有子会话绑定，它在台账里以
//      「派工记录的 parent_session_id」出现 → 只能给它**派过工**的成员记账。
//
// 找不到绑定、又不是任何派工的父会话 → 身份无法核对 → 不放行（fail-closed）。
// 旧调用方没带 session_id 时同样不放行，并给出明确文案（不静默放行）。
export function resolveWriter(payload) {
  const p = payload || {};
  const sessionId = String(p.session_id || p.sessionId || '').trim();
  const out = {
    ok: false, role: '', writer: '', sessionId,
    members: [], dispatched: [], boundAgent: '', errors: [],
    // canWrite(target)：这个写入者能不能写 target 的账本。
    // 放在判据里而不是让各闸门自己判断 —— 否则又会出现「两个闸门两套身份口径」。
    canWrite: () => false
  };
  if (!sessionId) {
    out.errors.push('缺 session_id —— 写入必须声明「谁在写」：闸门拿它去派工台账查该会话绑定的成员，' +
      '再与载荷里的 agent 比对；没有会话 id 就无法核对写入者，不放行（旧调用方请补 session_id）');
    return out;
  }
  const ledger = readLedger();
  if (!ledger.readable) {
    out.errors.push('派工台账不可用（' + (ledger.error || '未知原因') + '）—— 无法核对写入者身份，不放行');
    return out;
  }
  const binding = findBinding(ledger, sessionId);
  if (binding) {
    const bound = String(binding.agent_key || binding.agent || '').trim();
    if (!bound) {
      out.errors.push('台账里会话 ' + sessionId + ' 的绑定没有成员身份（agent_key / agent 都空）—— 无法核对写入者，不放行');
      return out;
    }
    // 绑定成员的两个名字（routing id / 显示名）是同一个成员（D-12），都算数
    const aliases = Array.from(new Set([
      String(binding.agent_key || '').trim(),
      String(binding.agent || '').trim(),
      bound
    ].filter(Boolean)));
    out.ok = true;
    out.role = 'member';
    out.writer = bound;
    out.boundAgent = bound;
    out.members = aliases;
    // 成员只能写**自己**的账本：目标由台账绑定决定，不由载荷独断（D-49）。
    out.canWrite = (target) => aliases.includes(String(target || '').trim());
    return out;
  }
  // 父会话路径：父会话在台账里以派工记录的 parent_session_id 出现
  const dispatches = (ledger.dispatches || []).filter(
    (d) => String(d.parent_session_id || '') === sessionId);
  // 父会话身份也认「绑定表里的父会话 id」：guard 建绑定时会记 parent_session_id，
  // 那条记录同样能证明「这个会话是发号施令的那一方」。
  const isParent = dispatches.length > 0 ||
    (ledger.bindings || []).some((b) => String(b.parent_session_id || '') === sessionId);
  if (!isParent) {
    out.errors.push('会话 ' + sessionId + ' 在派工台账里既没有子会话绑定，也不是任何派工的父会话 —— ' +
      '写入者身份无法核对，不放行');
    return out;
  }
  const members = new Set();
  for (const d of dispatches) {
    for (const k of [d.agent_key, d.agent]) {
      const v = String(k || '').trim();
      if (v) members.add(v);
    }
  }
  members.add('_router');
  out.ok = true;
  out.role = 'parent';
  out.writer = 'parent:' + sessionId;
  out.members = Array.from(members);
  out.dispatched = Array.from(members).filter((m) => m !== '_router');
  // 父会话可以给本项目任何成员记账 —— 目标由它自己负责，每条都留写入者痕迹可追。
  // 为什么父会话不按「派工名单」限死：派工台账只保留最近 200 条，
  // 换会话接手的老成员会从名单里消失 —— 按名单限死等于让「补记一条旧履历」不可用。
  // 真正要挡的是**成员冒名写兄弟成员的账**，那由上面的成员分支挡住。
  out.canWrite = (target) => {
    const t = String(target || '').trim();
    // 父会话可以给本项目任何成员记账 —— 目标不再被载荷里的成员名限死，
    // 但每一次写入都把写入者写进条目本身，事后可查、可追责。
    // 「_router」保留名由各闸门自己的保留名校验拦（那是另一条规则、另一条文案）。
    return t.length > 0;
  };
  return out;
}

// ── 并发安全写（锁 + 原子替换 + 回读校验） ──────────────────
//
// 为什么不能是「读全文 → 拼串 → 整体覆盖」：
//   两个写入方同时读到同一份旧快照 → 各自拼出「旧 + 自己那条」→ 后写的覆盖先写的，
//   先写的那条**静默消失**，而两次写入都返回 ok:true。
//   实测 8 次并发只落 5~8 条。
//
// 三步：① 跨进程互斥锁 ② 锁内**重读**再拼（读到的永远是最新快照）
//       ③ 写同目录临时文件 + 原子 rename（不出现「写了一半」的文件）。
// 落盘后**回读校验**：条数或标记对不上就判失败 ——
// 「说成功其实没写进去」比报错更坏（调用方会以为已经记上了）。
const LOCK_DIR = path.join(os.tmpdir(), 'super-agent-router-locks');

function lockFileFor(file) {
  const key = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 24);
  return path.join(LOCK_DIR, key + '.lock');
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* 没有 Atomics.wait 时的兜底 */ }
  }
}

// ── 锁与 rename 的参数（导出：回归要能直接断言它们之间的关系）────
//
// 为什么导出成常量而不是写在函数体里：D-62 的正确性条件是**常量之间的关系**
// （偷锁阈值 > 等待超时 > 持有者最坏临界区）。关系只写在注释里就只能「读起来对」，
// 导出成常量才能被回归**验算** —— 少了断言，这些数字随时会被改小。
export const LOCK_WAIT_TIMEOUT_MS = 60000;
export const LOCK_STALE_MS = 180000;

// rename 重试：次数与退避步长。窗口由这两个常量**算出**，不另写一份数字 ——
// 另写一份就等于多了一个口径（同一个坑的另一个变体）。
export const RENAME_MAX_ATTEMPTS = 40;
export const RENAME_BACKOFF_BASE_MS = 25;
export const RENAME_BACKOFF_STEP_MS = 10;
// 持有者在一个临界区里最坏要待的时长：
//   40 × 25ms + 10ms × (0+1+…+39) = 1000 + 7800 = 8800ms
export const RENAME_RETRY_WINDOW_MS =
  RENAME_MAX_ATTEMPTS * RENAME_BACKOFF_BASE_MS +
  RENAME_BACKOFF_STEP_MS * (RENAME_MAX_ATTEMPTS * (RENAME_MAX_ATTEMPTS - 1) / 2);

// ── 故障注入钩子（仅测试可见；默认关闭）──────────────────────
//
// 为什么要有它：D-59 / D-60 / D-61 都是 **Windows 上偶发**的文件系统错误
// （rename 覆盖被占用文件报 EPERM、抢锁被拒报 EPERM、回读校验被并发覆盖）。
// 靠真实并发去撞，撞到与否看运气 —— 上一轮的变异检验就是这么「时敏」的：
// 同一个变异体一次跑出 2 条红、另一次跑出 0 条红。
// 断言要确定性，就得能**指定**错误，而不是等它自己冒出来。
//
// 开关：环境变量 SAR_FAULT_INJECT（逗号分隔的 token）+ SAR_FAULT_RUN（批次号）。
//   · 不设 SAR_FAULT_INJECT ⇒ 钩子**完全关闭**（见 faultSpec 的 null 短路）：
//     不加 sleep、不改返回值、不改变正常路径的任何行为。
//   · SAR_FAULT_RUN 变化 ⇒ 计数归零（同一组 token 在同一批次里只触发 N 次）。
//     回归里每个用例用不同批次号，避免上一条用例把额度用光。
//
// 语义（每个 token 只影响对应的那一个系统调用，互不串扰）：
//   rename-eperm[:N]  writeFileLocked 的 renameSync 前 N 次抛 EPERM
//                     （Windows 上目标文件被占用时的真实错误码）。默认 N=1。
//   lock-eperm[:N]    withFileLock 的 openSync(lock,'wx') 前 N 次抛 EPERM
//                     （Windows ERROR_SHARING_VIOLATION 的 Node 映射）。默认 N=1。
//   verify-fail       rename 成功后把目标文件改写成一份**过期快照**（不含前序条目），
//                     模拟另一个写入方用旧快照覆盖 ⇒ 回读校验必然失败，
//                     此时必须回滚，否则前序条目被这一次失败写入抹掉（D-60）。
//
// 生产路径的保证：三个 token 都不设时，钩子函数体只剩一次 env 比较；
// 正常写入的时序、返回值与文件内容与「没有钩子」时逐字一致。
const FAULT_ENV = 'SAR_FAULT_INJECT';
const FAULT_RUN_ENV = 'SAR_FAULT_RUN';
let FAULT_CACHE = { key: null, spec: null };

function parseFaultSpec(raw) {
  if (!raw) return null;
  const spec = { renameEperm: 0, lockEperm: 0, verifyFail: false };
  for (const tok of String(raw).split(',')) {
    const t = tok.trim();
    if (!t) continue;
    const [name, arg] = t.split(':');
    const n = arg === undefined ? 1 : parseInt(arg, 10);
    const count = (Number.isFinite(n) && n > 0) ? n : 1;
    if (name === 'rename-eperm') spec.renameEperm = count;
    else if (name === 'lock-eperm') spec.lockEperm = count;
    else if (name === 'verify-fail') spec.verifyFail = true;
  }
  return spec;
}

// 当前生效的故障规格。开关或批次号一变就重新解析（计数随之归零）。
function faultSpec() {
  const raw = process.env[FAULT_ENV];
  const run = process.env[FAULT_RUN_ENV] || '';
  const key = (raw || '') + '||' + run;
  if (key === FAULT_CACHE.key) return FAULT_CACHE.spec;
  const spec = parseFaultSpec(raw);
  FAULT_CACHE = { key, spec };
  return spec;
}

function faultError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// rename 故障：只在开关指定 rename-eperm 且额度未用完时抛错。
function faultRename() {
  const spec = faultSpec();
  if (!spec || spec.renameEperm <= 0) return;
  spec.renameEperm--;
  throw faultError('EPERM', '故障注入：rename 覆盖被占用文件（Windows EPERM）');
}

// 抢锁故障：模拟 Windows 上「锁文件已存在且正被别的进程打开」时的 EPERM。
function faultLockOpen() {
  const spec = faultSpec();
  if (!spec || spec.lockEperm <= 0) return;
  spec.lockEperm--;
  throw faultError('EPERM', '故障注入：排他创建锁文件被拒（Windows ERROR_SHARING_VIOLATION）');
}

// 回读校验故障：模拟「另一个写入方用过期快照覆盖了文件」——
// 校验必然失败，且失败时文件里已不含前序条目 ⇒ 必须回滚，否则前序条目被抹掉。
function faultVerifyOverwrite(file) {
  const spec = faultSpec();
  if (!spec || !spec.verifyFail) return;
  try {
    fs.writeFileSync(file, '# 过期快照（故障注入：模拟并发写入方用旧快照覆盖）\n', 'utf8');
  } catch { /* 注入失败就当没注入 */ }
}

export function withFileLock(file, fn, opts = {}) {
  const lock = lockFileFor(file);
  // 等待超时 LOCK_WAIT_TIMEOUT_MS(60s)、偷锁阈值 LOCK_STALE_MS(180s)：
  // 拿不到锁就判失败（不放行、不强抢），但必须给持有者留够时间 ——
  // 持有者遇到 Windows rename EPERM 时会在临界区里重试最多 ~9s（见 writeFileLocked），
  // 16 个写入方排队时，最后一个要等 15 × 9s —— 15s 超时会把它们**误判成失败**。
  // 偷锁阈值必须**大于**等待超时，否则会把「还在用的锁」当成陈旧锁偷走，两个写入方同时进临界区。
  const timeoutMs = opts.timeoutMs || LOCK_WAIT_TIMEOUT_MS;
  const staleMs = opts.staleMs || LOCK_STALE_MS;
  const deadline = Date.now() + timeoutMs;
  try { fs.mkdirSync(LOCK_DIR, { recursive: true }); } catch { /* 目录建不出来时下面会报错 */ }
  let fd = null;
  for (;;) {
    try {
      faultLockOpen();   // 故障注入（默认关闭；生产路径是 no-op）
      fd = fs.openSync(lock, 'wx');
      break;
    } catch (e) {
      // Windows 上并发 open 同一个 'wx' 文件，错误码**不是 EEXIST**：
      // 锁文件已存在**且正被别的进程打开**时，CreateFile 报 ERROR_SHARING_VIOLATION，
      // Node 把它映射成 EPERM。只认 EEXIST 的话，并发写同一份账本会随机报
      // 「获取写锁失败：EPERM」—— 锁机制本身是对的，却被误判成失败。
      //
      // **EPERM 一律当作「暂时拿不到」，不再用 existsSync 去区分**：
      // 实测还有一种更隐蔽的情况 —— **杀毒软件正在扫描/清理锁文件**：
      // 文件被标记 delete-pending 时路径在目录里已经解析不到，existsSync 返回 false，
      // 而 openSync 报 EPERM。用 existsSync 判「占用 vs 权限问题」在这里就是判错。
      // 统一继续等：真的权限问题（目录不可写）也会走到超时，
      // 超时文案说清了「拿不到锁」，不会把原因谎报成别的。
      const code = e && e.code;
      const taken = code === 'EEXIST' || code === 'EPERM';
      if (!taken) {
        return { ok: false, error: '获取写锁失败：' + (e && e.message ? e.message : String(e)) };
      }
      // 写进程崩了会留下锁文件 —— 超龄的锁可以偷，否则每次写入都超时。
      try {
        const st = fs.statSync(lock);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch { /* 锁刚被别人拿走 */ }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          error: '获取写锁超时（' + timeoutMs + 'ms）：' + path.basename(file) +
            ' 正被另一个写入占用 —— 不放行，避免写进去又被覆盖'
        };
      }
      sleepSync(20);
    }
  }
  try {
    try { fs.writeSync(fd, String(process.pid) + ' ' + Date.now() + '\n'); } catch { /* 锁内容不重要 */ }
    try { fs.closeSync(fd); } catch { /* ignore */ }
    fd = null;
    return fn();
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.rmSync(lock, { force: true }); } catch { /* ignore */ }
  }
}

// build(raw) -> { text, expectCount?, marker?, counter? } | { error }
// 写完回读校验：marker 必须在文件里，条数必须等于 expectCount。
export function writeFileLocked(file, build) {
  return withFileLock(file, () => {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = ''; }
    const built = build(raw);
    if (!built || built.error) {
      return { ok: false, error: (built && built.error) || '写入内容构造失败' };
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
    // 原子替换（写同目录临时文件 → rename）。
    // rename 是原子的：读者要么看到旧文件，要么看到新文件，不会看到「写了一半」。
    //
    // 为什么必须重试：Windows 上 rename 覆盖一个**正被其它进程打开**的目标文件会 EPERM
    // （读句柄未共享删除）—— 并发写同一份记录文件时这不是理论风险，是实测到的：
    // 16 个并发写有 2 次直接 EPERM 失败，那两条记录根本没落盘。
    // Linux 上 rename 覆盖总是成功，所以这个坑只在 Windows 显形 ——
    // 不重试就等于「并发写在 Windows 上会静默少条目」。
    let renamed = false;
    let lastErr = null;
    // 临时文件只写一次，重试只做 rename。
    // 为什么分开写：每次重试都重写临时文件 = 多一次 I/O，也多一次
    // 杀毒软件扫描触发（Windows 上 Defender 扫描新文件正是 rename EPERM 的常见来源）。
    try {
      fs.writeFileSync(tmp, built.text, 'utf8');
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      return { ok: false, error: '写入临时文件失败：' + (e && e.message ? e.message : String(e)) };
    }
    // 重试窗口：RENAME_MAX_ATTEMPTS(40) 次 × (25ms + 10ms/次) ≈ 8.8s
    // （RENAME_RETRY_WINDOW_MS 由同一组常量算出，不另写一份数字）。
    // 为什么窗口要这么长：**Windows Defender / 索引服务会扫描刚写入的文件**，
    // 扫描期间目标文件被外部进程打开 → rename 覆盖报 EPERM。
    // 实测：全量回归刚跑完十几套、Defender 正在扫临时目录时，
    // 1.15s 的旧窗口不够用，会偶发写失败 —— 那一条记录**根本没落盘**。
    // Linux 上 rename 覆盖总是成功，所以这个坑只在 Windows 显形。
    for (let attempt = 0; attempt < RENAME_MAX_ATTEMPTS; attempt++) {
      try {
        faultRename();    // 故障注入（默认关闭；生产路径是 no-op）
        fs.renameSync(tmp, file);
        renamed = true;
        break;
      } catch (e) {
        lastErr = e;
        // EPERM/EBUSY = 目标文件正被占用（Windows 常见）；EACCES = 权限问题。
        const code = e && e.code;
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break;
        sleepSync(RENAME_BACKOFF_BASE_MS + attempt * RENAME_BACKOFF_STEP_MS);
      }
    }
    if (!renamed) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      return { ok: false, error: '写入失败：' + (lastErr && lastErr.message ? lastErr.message : String(lastErr)) };
    }
    // 故障注入：模拟「另一个写入方用过期快照覆盖了文件」（默认关闭；生产路径是 no-op）
    faultVerifyOverwrite(file);
    let after = '';
    try { after = fs.readFileSync(file, 'utf8'); } catch { after = ''; }
    // 落盘后回读校验：不一致就判失败，不返回「成功」。
    //
    // 关键在校验不过时要**回滚**到写入前的内容。
    // 为什么不回滚就不行：此刻文件已经被这一份快照覆盖了 ——
    // 校验失败只是「发现覆盖」，不是「避免覆盖」。不回滚的话，
    // 那一次失败写入就把前面所有条目一起抹掉了（实测 16 并发丢到 15 条）。
    // 回滚之后，失败的那次写入对文件没有副作用，
    // 调用方看到 ok:false 就知道这条没记上，可以重试 —— 记录不会静默少一条。
    const rollback = () => {
      try {
        const rb = file + '.rollback-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
        fs.writeFileSync(rb, raw, 'utf8');
        fs.renameSync(rb, file);
      } catch { /* 回滚失败：至少没有谎报成功 */ }
    };
    if (built.marker && after.indexOf(built.marker) === -1) {
      rollback();
      return { ok: false, error: '写入后回读校验失败：新条目没有出现在文件里 —— 已回滚，判失败，不返回「成功」' };
    }
    if (typeof built.expectCount === 'number') {
      const counter = built.counter || ((s) => countRecordsInSection(s));
      const c = counter(after);
      if (c !== built.expectCount) {
        rollback();
        return {
          ok: false,
          error: '写入后回读校验失败：期望 ' + built.expectCount + ' 条，实际 ' + c +
            ' 条 —— 已回滚，判失败，不返回「成功」'
        };
      }
    }
    return { ok: true, raw: after };
  });
}
