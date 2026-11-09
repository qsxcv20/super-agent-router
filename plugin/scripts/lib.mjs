// super-agent-router 共享库
// 台账落在 PLUGIN_DATA（可写、跨会话持久），与插件包只读区分离。
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
  if (!p) return { dispatches: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed.dispatches)) parsed.dispatches = [];
    return parsed;
  } catch {
    return { dispatches: [] };
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

// scope 条目只接受像路径的东西，丢弃自然语言。
// 白名单里混进一句中文，等于拦截直接失效。
const PATH_LIKE = /^[A-Za-z0-9_@~.\\/-]+$/;

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
    const m = t.match(/^(?:#{0,3}\s*)?SCOPE\s*[:：]\s*(.*)$/i);
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