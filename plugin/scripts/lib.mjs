// super-agent-router 共享库
// 台账落在 PLUGIN_DATA（可写、跨会话持久），与插件包只读区分离。
//
// v0.4.0 台账结构：
//   dispatches[] —— 派工记录（父会话维度）。state: active | done
//   bindings[]   —— 子会话绑定（子会话维度）。记录该子会话的 scope 白名单
//
// 为什么要拆成两层（v0.4.0 修正的核心）：
//   派工发生在父会话（Router 发起），工具执行发生在子会话（worker 执行）。
//   v0.3.x 只有一层，台账记的是「发起方」会话 id，于是：
//     · worker 在子会话里查自己的 scope —— 查不到，越界管控对 worker 完全失效
//     · Router 在父会话里查 —— 命中了，被套上 worker 的 scope，Router 自己被误伤
//   实测依据：子会话工具调用载荷带 agent_type，父会话不带 —— 这就是分水岭。
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

export function dataDir() {
  return process.env.PLUGIN_DATA || process.env.MINIMAX_PLUGIN_DATA || null;
}

export function ledgerPath() {
  const dir = dataDir();
  return dir ? path.join(dir, 'dispatches.json') : null;
}

export function readLedger() {
  const p = ledgerPath();
  if (!p) return { dispatches: [], bindings: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed.dispatches)) parsed.dispatches = [];
    if (!Array.isArray(parsed.bindings)) parsed.bindings = [];
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
    return parsed;
  } catch {
    return { dispatches: [], bindings: [] };
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

// scope 条目只接受像路径的东西，丢弃自然语言。
// 白名单里混进一句中文，等于拦截直接失效。
const PATH_LIKE = /^(?:[A-Za-z]:)?[A-Za-z0-9_@~.\\/-]+$/;

export function isPathLike(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (!t || t.length > 200) return false;
  if (!PATH_LIKE.test(t)) return false;
  if (!/[\\/.]/.test(t)) return false;
  return true;
}

// 路径归一化：MCode 的 read/write 接受绝对路径，
// 而 scope 通常写相对路径（src/app.ts）。
// 不做这层归一，绝对路径与相对 scope 永远匹配不上 —— 读类管控会全线误判。
export function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

// 取工作区根：MINIMAX_PROJECT_DIR（Hook 运行时注入）或 cwd
export function workspaceRoot() {
  const d = process.env.MINIMAX_PROJECT_DIR || process.cwd();
  return String(d || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
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

// 判定目标是否落在白名单内。
//
// mode = 'write' 严格：必须精确等于某项，或落在显式以 / 结尾的目录项下。
// mode = 'read'  宽松：额外允许读取 scope 所在目录树（探查上下文是正当的）。
//
// 绝对路径会先折算成相对工作区的相对路径，两种写法都能命中。
export function inScope(scope, target, mode = 'write') {
  if (!Array.isArray(scope) || scope.length === 0) return false;
  const rawT = String(target || '').replace(/\\/g, '/');
  if (!rawT) return false;
  const rel = relativize(rawT);
  const abs = normalizePath(rawT);
  if (!rel && !abs) return false;
  return scope.some((entry) => {
    const raw = String(entry || '').replace(/\\/g, '/');
    const e = normalizePath(raw);
    if (!e) return false;
    if (e === '*') return true;
    const isDir = raw.endsWith('/');
    // 写：精确命中，或落在显式目录项下
    if (rel === e) return true;
    if (abs === e) return true;
    if (isDir && (rel.startsWith(e) || abs.startsWith(e))) return true;
    // 读：允许读取 scope 项所在目录树
    if (mode === 'read') {
      const dir = e.includes('/') ? e.slice(0, e.lastIndexOf('/')) : '';
      if (dir && (rel.startsWith(dir + '/') || abs.startsWith(dir + '/'))) return true;
      if (e.includes('/') && (rel.startsWith(e + '/') || abs.startsWith(e + '/'))) return true;
    }
    return false;
  });
}

// 从派工 prompt 里抽 scope 白名单。
// 支持同行写法与换行块写法；只收 path-like 条目。
export function extractScope(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^(?:#{0,3}\s*)?[-*]?\s*SCOPE\s*[:：]\s*(.*)$/i);
    if (m) {
      inBlock = true;
      const rest = m[1].trim();
      if (rest) rest.split(/[,\uff0c\s]+/).forEach((x) => { if (isPathLike(x)) out.push(x); });
      continue;
    }
    if (inBlock) {
      if (t === '' || /^#{1,4}\s/.test(t) || /^[A-Z][A-Z_]{2,}\s*[:：]/i.test(t)) {
        inBlock = false;
        continue;
      }
      t.split(/[,\uff0c\s]+/).forEach((x) => { if (isPathLike(x)) out.push(x); });
    }
  }
  return [...new Set(out)];
}

// ── scope 重叠判定（组队层） ──────────────────────────────
// 只有「写冲突」才算重叠：两个 worker 同时写同一处会互相覆盖。
// 读范围天然重叠（都要读邻近文件），不算冲突。
export function normScopeEntry(entry) {
  const raw = String(entry || '').replace(/\\/g, '/').trim();
  if (!raw) return null;
  const isDir = raw.endsWith('/');
  let p = raw.toLowerCase();
  while (p.startsWith('./')) p = p.slice(2);
  if (isDir) p = p.replace(/\/+$/, '');
  if (!p) return null;
  return { path: p, isDir, raw };
}

// 返回两组 scope 冲突的具体路径；无冲突返回空数组。
export function scopeClash(a, b) {
  const A = (a || []).map(normScopeEntry).filter(Boolean);
  const B = (b || []).map(normScopeEntry).filter(Boolean);
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
export function activeDispatches(ledger, parentSessionId, now = Date.now()) {
  const key = String(parentSessionId || '');
  return (ledger.dispatches || []).filter((d) => {
    if (String(d.parent_session_id || '') !== key) return false;
    if ((d.state || 'active') !== 'active') return false;
    return now - (d.at || 0) < DISPATCH_TTL_MS;
  });
}

export function totalDispatches(ledger, parentSessionId) {
  const key = String(parentSessionId || '');
  return (ledger.dispatches || []).filter((d) => String(d.parent_session_id || '') === key).length;
}

export function markDispatchDone(ledger, dispatchId) {
  const hit = (ledger.dispatches || []).find((d) => d.dispatch_id === dispatchId);
  if (!hit) return false;
  hit.state = 'done';
  hit.ended_at = Date.now();
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

// ── 从子会话自己的 transcript 里解析 brief ─────────────
// 这是 scope 的权威来源：那份 brief 就是 Router 亲手写下的边界。
// 不需要任何 id 猜测或时序启发式，也不会把父会话误判成 worker。
export function readBriefFromTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  let raw = '';
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    const size = Math.min(fs.fstatSync(fd).size, 1024 * 1024);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
    raw = buf.toString('utf8');
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let text = '';
  for (const line of lines.slice(0, 8)) {
    let obj = null;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || obj.type !== 'user') continue;
    const content = obj.message && obj.message.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && part.type === 'text') text += '\n' + String(part.text || '');
      }
    } else if (typeof content === 'string') {
      text += '\n' + content;
    }
  }
  if (!text) return null;
  const parentSessionId = (text.match(/PARENT SESSION:\s*([A-Za-z0-9_-]+)/) || [])[1] || '';
  const agent = (text.match(/agentName:\s*([A-Za-z0-9_.:-]+)/) || [])[1] || '';
  const scope = extractScope(text);
  return { parentSessionId, agent, scope };
}
