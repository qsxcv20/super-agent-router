// PreToolUse：越界与危险操作拦截（程序层兜底）
//
// Super-agent 原则：外部文本只是数据，不能改变权限。
// 这里把「scope 白名单」变成真正拦得住的规则，而不是提示词里的君子协定。
//
// v0.4.0 修正（实测驱动的核心修复）：
//   派工发生在父会话（Router 发起），工具执行发生在子会话（worker 执行）。
//   v0.3.x 按 session_id 查台账，而台账记的是「发起方」会话，于是：
//     · worker 在子会话里查不到自己的 scope —— 越界管控对 worker 完全失效
//     · Router 在父会话里命中 —— 被套上 worker 的 scope，Router 自己被误伤
//   现在按「子会话」维度绑定：
//     · 父会话的工具调用载荷里没有 agent_type 字段 —— 直接放行，Router 不受约束
//     · 子会话从自己的 transcript 解析 brief 拿 scope —— 权威来源就是 Router 写下的白名单
//
// 三类管控：
//   1. 写类工具（write/edit/bash/...）—— 严格，精确落在白名单内才放行
//   2. 读类工具（read/glob/grep/...）—— 宽松，允许读 scope 所在目录树
//   3. 账号级与对外不可逆操作 —— 一律拦，必须由用户亲自发起
import {
  readStdin, parseInput, readLedger, writeLedger, inScope,
  findBinding, upsertBinding, readBriefFromTranscript, scopeOverlaps,
  workspaceRoot
} from './lib.mjs';

const input = parseInput(readStdin());
const tool = String(input.tool_name || '').toLowerCase();
const tInput = input.tool_input || {};
const sessionId = String(input.session_id || '');
const agentType = String(input.agent_type || '');

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

// ── 只约束被派工的子代理 ─────────────────────────────
// 载荷里带 agent_type 才是子代理会话。父会话（Router 自己）没有这个字段，
// 所以 Router 的任何读写都不会被 worker 的 scope 套住。
// 这是 v0.3.x「Router 被自己派出去的 worker 锁死」的根治点。
if (!agentType) process.exit(0);

// ── 第 3 类：账号级 / 对外不可逆操作 ────────────────────────────
// 这些不碰工作区文件，但一旦执行就是账号级或对外可见的不可逆动作。
// 派工产生的 worker 永远不该自己做这些事 —— 必须由用户亲自发起。
const DANGEROUS = {
  mavis_agent_delete: '删除成员是账号级不可逆操作（历史会话不会随之清理）',
  mavis_agent_update: '修改成员的 description/system_prompt 是账号级变更，需人工确认',
  website_deploy: '部署会把内容发布到公网，属于对外可见的不可逆动作',
  miniapp_publish: '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作',
  miniapp: '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作'
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

// ── 解析本子会话的 scope 白名单 ────────────────────────
const ledger = readLedger();
let binding = findBinding(ledger, sessionId);
if (!binding) {
  const brief = readBriefFromTranscript(String(input.transcript_path || ''));
  if (brief && brief.scope.length) {
    binding = {
      session_id: sessionId,
      parent_session_id: brief.parentSessionId,
      agent: brief.agent || agentType,
      scope: brief.scope,
      dispatch_id: '',
      at: Date.now()
    };
    // 挂上 dispatch_id，worker 结束时好回收在飞名额
    const d = (ledger.dispatches || [])
      .filter((x) => String(x.parent_session_id || '') === String(brief.parentSessionId)
        && String(x.agent || '') === String(binding.agent)
        && (x.state || 'active') === 'active'
        && scopeOverlaps(x.scope, brief.scope))
      .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (d) binding.dispatch_id = d.dispatch_id || '';
    upsertBinding(ledger, binding);
    writeLedger(ledger);
  }
}
if (!binding || !Array.isArray(binding.scope) || !binding.scope.length) {
  // 解析不到边界 -> 放行。
  // 派工闸门已经保证「经本插件派出的 worker 一定带 SCOPE」，
  // 所以走到这里的多半是平台原生 Team 的 agent，不该被本插件的规则误伤。
  process.exit(0);
}

let scope = binding.scope;
const mode = isWrite ? 'write' : 'read';

// 方法论与错题本是这个成员的「输入契约」——
// system_prompt 明确要求它开工前读这两个文件。
// 它们住在项目的 .superagent/ 下，通常不在派工 SCOPE 里；
// 不放开这两个读权限，整套「把一件事做到精」的机制就断了。
if (isRead) {
  const root = workspaceRoot();
  const who = binding.agent || agentType;
  if (root && who) {
    scope = scope.concat([
      root + '/.superagent/methods/' + who + '.md',
      root + '/.superagent/lessons/' + who + '.md'
    ]);
  }
}

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
