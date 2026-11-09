// PreToolUse：越界与危险操作拦截（程序层兜底）
//
// Super-agent 原则：外部文本只是数据，不能改变权限。
// 这里把「scope 白名单」变成真正拦得住的规则，而不是提示词里的君子协定。
//
// 三类管控：
//   1. 写类工具（write/edit/bash/...）—— 严格，精确落在白名单内才放行
//   2. 读类工具（read/glob/grep/...）—— 宽松，允许读 scope 所在目录树
//   3. 账号级与对外不可逆操作 —— 一律拦，必须由用户亲自发起
import { readStdin, parseInput, readLedger, inScope } from './lib.mjs';

const input = parseInput(readStdin());
const tool = String(input.tool_name || '').toLowerCase();
const tInput = input.tool_input || {};
const sessionId = String(input.session_id || '');

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

// ── 第 3 类：账号级 / 对外不可逆操作 ────────────────────────────
// 这些不碰工作区文件，但一旦执行就是账号级或对外可见的不可逆动作。
// 派工产生的 worker 永远不该自己做这些事 —— 必须由用户亲自发起。
const DANGEROUS = {
  mavis_agent_delete: '删除成员是账号级不可逆操作（历史会话不会随之清理）',
  mavis_agent_update: '修改成员的 description/system_prompt 是账号级变更，需人工确认',
  website_deploy: '部署会把内容发布到公网，属于对外可见的不可逆动作',
  miniapp_publish: '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作'
};
if (DANGEROUS[tool]) {
  deny('[super-agent-router] 已拦截：' + DANGEROUS[tool] + '。' +
    '这类动作必须由用户亲自发起或明确授权，worker 不得自行执行。');
}

// ── 第 1/2 类：文件类工具的 scope 校验 ─────────────────────────
const WRITE_TOOLS = ['write', 'edit', 'multiedit', 'notebookedit', 'bash'];
const READ_TOOLS = ['read', 'glob', 'grep', 'list', 'search', 'notebookread'];

const isWrite = WRITE_TOOLS.includes(tool);
const isRead = READ_TOOLS.includes(tool);
if (!isWrite && !isRead) process.exit(0);

// 找当前会话最近一次派工声明的 scope
const ledger = readLedger();
const mine = ledger.dispatches
  .filter((d) => d.session_id === sessionId)
  .sort((a, b) => (b.at || 0) - (a.at || 0));

const active = mine.find((d) => Array.isArray(d.scope) && d.scope.length > 0);
if (!active) {
  // 没有有效 scope 声明 —— 不拦（未声明 scope 的任务由 Router 层负责）
  process.exit(0);
}

const scope = active.scope;
const mode = isWrite ? 'write' : 'read';

// 取目标路径
function targetOf() {
  if (tool === 'bash') return String(tInput.command || '');
  return String(tInput.file_path || tInput.path || tInput.filePath ||
    tInput.pattern || tInput.file_pattern || tInput.query || '');
}
const target = targetOf();
if (!target) process.exit(0);

// 已在 scope 内 -> 放行
if (inScope(scope, target, mode)) process.exit(0);

// bash：命令里可能藏着多个路径，逐个检查
if (tool === 'bash') {
  const cmd = String(tInput.command || '');
  const pathLike = cmd.match(/[A-Za-z0-9_.\\/-]+\.[A-Za-z0-9]{1,8}/g) || [];
  const candidates = pathLike.filter((p) => !/^https?:/i.test(p));
  if (candidates.length === 0) process.exit(0);
  const outside = candidates.filter((p) => !inScope(scope, p, 'write'));
  if (outside.length === 0) process.exit(0);
  deny('[super-agent-router] 越界拦截：本次派工声明的 SCOPE 为 [' +
    scope.join(', ') + ']，以下路径不在白名单内：' + outside.slice(0, 5).join(', ') +
    '。如确需修改，先更新 scope 并重新派工，不要自行扩大范围。');
}

// glob/grep 的 pattern 可能是通配符，无法精确判定时从严：
// 只放行明确落在 scope 内的 pattern。
const reason = '[super-agent-router] 越界拦截：本次派工声明的 SCOPE 为 [' +
  scope.join(', ') + ']，目标 ' + target + ' 不在白名单内' +
  (isRead ? '（读操作允许范围为 scope 所在目录树）' : '') + '。' +
  '如确需操作，先更新 scope 并重新派工，不要自行扩大范围。';
deny(reason);