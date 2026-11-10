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
import path from 'node:path';

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

export function readLedger() {
  const empty = { dispatches: [], bindings: [], counters: {}, readable: true, error: '' };
  const p = ledgerPath();
  if (!p) return { ...empty, readable: false, error: '没有 PLUGIN_DATA，台账不可用' };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed.dispatches)) parsed.dispatches = [];
    if (!Array.isArray(parsed.bindings)) parsed.bindings = [];
    if (!parsed.counters || typeof parsed.counters !== 'object') parsed.counters = {};
    // 迁移：旧版台账记的是「发起方会话」，语义与新版不一致。
    // 旧记录一律落到 done —— 否则一次历史派工会把会话永久锁死。
    for (const d of parsed.dispatches) {
      if (!d.parent_session_id) {
        d.parent_session_id = String(d.session_id || '');
        d.state = 'done';
        d.legacy = true;
      }
      if (!d.state) d.state = 'active';
    }
    parsed.readable = true;
    parsed.error = '';
    return parsed;
  } catch (e) {
    // 台账存在却读不出来 = 派工记录不可信。
    // 以前这里直接返回空台账，等于「记录丢了 -> 视同没有在飞派工」-> 并发与冲突检测全盲。
    const exists = fs.existsSync(p);
    return {
      ...empty,
      readable: !exists,
      error: exists ? ('台账读不出来：' + p + '（' + (e && e.message ? e.message : 'unknown') + '）') : ''
    };
  }
}

export function writeLedger(ledger) {
  const p = ledgerPath();
  if (!p) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(ledger, null, 2), 'utf8');
    return true;
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
  if (!PATH_LIKE.test(t)) return false;
  const body = splitScopeEntry(t) ? splitScopeEntry(t).path : t;
  if (!/[\\/.]/.test(body)) return false;
  return true;
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
    const prefix = isDir ? e.replace(/\/+$/, '') : e;
    const exact = (rel === e || abs === e);
    if (mode === 'write') {
      // ro: 条目永不授予写权限 —— 以前 ro: 前缀被整条丢弃，白名单变小等于放行。
      if (parsed.readOnly) continue;
      if (exact) return true;
      // 目录条目只覆盖其「之下」的内容，不含目录本身（删掉整个目录超出授权范围）
      if (isDir && (rel.startsWith(prefix + '/') || abs.startsWith(prefix + '/'))) return true;
      continue;
    }
    if (mode === 'read') {
      if (exact) return true;
      if (isDir) {
        // 目录条目：树根就是它自己，读它等于读它的树（S2.1）
        if (rel === prefix || abs === prefix) return true;
        if (rel.startsWith(prefix + '/') || abs.startsWith(prefix + '/')) return true;
        continue;
      }
      // 文件条目：树根 = 它所在的目录
      const treeRoot = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      if (treeRoot && (rel === treeRoot || abs === treeRoot ||
        rel.startsWith(treeRoot + '/') || abs.startsWith(treeRoot + '/'))) return true;
      continue;
    }
    if (mode === 'exact') {
      if (exact) return true;
      continue;
    }
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

function tokenizeScopeText(text) {
  const out = [];
  const parts = String(text || '').split(/[,\uff0c\s]+/).filter(Boolean);
  let pendingReadOnly = false;
  for (const part of parts) {
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
    if (isPathLike(tok.value)) {
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

// ── 派工记录 ──────────────────────────────────────────
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
    if (p && d.project) {
      // 记录所属项目不同 -> 不是同一个工作区的并发写
      if (String(d.project).toLowerCase() !== p) return false;
    }
    return true;
  });
}

export function totalDispatches(ledger, parentSessionId) {
  const key = String(parentSessionId || '');
  return (ledger.dispatches || []).filter((d) => String(d.parent_session_id || '') === key).length;
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
//   平台不对 run_code 容器派发 PreToolUse（实测：全库 1640 次 run_code 调用
//   0 次被护栏直接拒答，同期内层子调用被拒 153 次）——
//   危险操作的拦截必须在内层调用各自判定这一层做到位。
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
        if (act !== 'delete' && act !== 'update') continue;
        return act === 'delete'
          ? {
            matched: 'mavis agent delete',
            reason: '删除账号级成员是账号级不可逆操作（历史会话不会随之清理）'
          }
          : {
            matched: 'mavis agent update',
            reason: '改写账号级成员是账号级变更，需人工确认'
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
