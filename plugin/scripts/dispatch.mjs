// PreToolUse (task)：派工登记 + 组队闸门 + 教训前置 + 履历参考
//
// 五个职责：
//   1. 闸门一：派工必须带 SCOPE 白名单（不带就拒 —— 否则整个授权模型形同虚设）
//   2. 闸门二：SCOPE 不得与仍在飞的派工重叠（两个 worker 写同一处会互相覆盖）
//   3. 闸门三：单会话派工数设上限（并发在飞 + 累计）
//   4. 记录每次派工的 scope，供 guard.mjs 做越界判定
//   5. 把目标成员的历史教训前置给 Worker，把实战记录带给 Router 参考
//
// 第 5 步是「自我进化」真正生效的位置：
// 不是事后修补，而是让 Worker 开工前就知道上次同类任务栽在哪儿。
import {
  readStdin, parseInputStrict, readLedger, writeLedger, extractScopeDetail,
  activeDispatches, activeDispatchesAll, totalDispatches, dispatchedTotal,
  bumpDispatchCounter, scopeClash, workspaceRoot, projectRoot,
  MAX_ACTIVE_DISPATCHES, MAX_TOTAL_DISPATCHES,
  resolveAgentKey, extractBriefMarkers, reapExpiredDispatches, normScopeEntry,
  touchesSuperagentPath
} from './lib.mjs';
import { readLessons, countEntries, readRecords } from './lessons.mjs';

const rawStdin = readStdin();
const parsed = parseInputStrict(rawStdin);
if (!parsed.ok) {
  // 载荷坏了 -> 派工无法登记（台账里查不到在飞记录）-> 拒绝，不做「什么都没发生」的放行。
  if (!String(rawStdin || '').trim()) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '[super-agent-router] 派工无法登记：' + parsed.reason +
        '。载荷解析不出来 = 派工台账记不下这次派工，此处不放行。'
    }
  }));
  process.exit(0);
}
const input = parsed.value;
const tool = String(input.tool_name || '');
if (tool.toLowerCase() !== 'task') process.exit(0);

const tInput = input.tool_input || {};
const prompt = String(tInput.prompt || '');
const scopeDetail = extractScopeDetail(prompt);
const scope = scopeDetail.entries;

// 发起方会话 = 父会话（Router）。worker 在子会话里跑，父会话不该被 worker 的 scope 约束。
const sid = String(input.session_id || '');
const tid = String(input.turn_id || '');
const toolUseId = String(input.tool_use_id || '');
const now = Date.now();
const project = projectRoot();

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

// === 闸门 1：派工必须声明 scope ===
// 不带 scope 的派工会让 guard 完全失去判定依据（无白名单 = 无边界），
// 等于把授权模型整个绕开。所以这里直接拒绝。
if (!scope.length) {
  deny('[super-agent-router] 派工缺少 SCOPE 白名单，拒绝派发。' +
    'brief 必须逐条写明可改动的具体路径，例如：' +
    'SCOPE: src/app.ts, src/util.ts（目录要写成 src/app/ 才涵盖其下所有文件；只读要写成 ro: src/app/）。' +
    '没有白名单就没有边界，越界拦截会失效。');
}

// SCOPE 行里有「长得像路径却解析不出来」的条目 -> 拒绝。
// 以前这类条目被悄悄丢掉，白名单比派工意图窄，
// 窄掉的部分等于无人看管 —— 漏收即放行（D-07）。
if (scopeDetail.rejected.length) {
  deny('[super-agent-router] 派工的 SCOPE 行里有无法解析的条目：' +
    scopeDetail.rejected.slice(0, 5).join(', ') +
    '。白名单漏收 = 越界管控范围被静默缩小，请把这些条目写成规范路径后重新派工。');
}

// === 闸门 1b：SCOPE 不得越权授予「他人的私有记忆」 ===
//
// .superagent/lessons/ 与 .superagent/methods/ 装的是**每个成员自己的**记忆：
// 错题本 = 栽过哪，方法论 = 怎么做事。读模式按「目录条目所在目录树」放宽，
// 所以一旦把整个目录写进 SCOPE，worker 就能读到**兄弟成员的错题本全文**与
// **Router 私有账 _router.md**。
// 独立验收实测复现（本轮 sa-context-trace）：读兄弟成员规则全文与 _router.md 94 行，均未被拦。
// 方向是「教训被窃取而非分发」—— 用户担心的「成员互相篡位」正是这条。
//
// 而这些权限**本来就不需要写进 SCOPE**：guard 对被派工成员自己的方法论与错题本
// 按**精确文件**单独放行（guard.mjs 的 exactPaths），与 SCOPE 无关。
// 所以把整个目录写进 SCOPE 只有一个效果：越权授予他人记忆。
const PRIVATE_MEMORY_DIRS = ['.superagent/lessons', '.superagent/methods'];
for (const raw of scope) {
  const p2 = normScopeEntry(raw);
  if (!p2) continue;
  const hit = PRIVATE_MEMORY_DIRS.find((m) => p2.path === m || p2.path.startsWith(m + '/'));
  if (hit) {
    deny('[super-agent-router] 派工的 SCOPE 覆盖了成员的私有记忆目录（' + hit + '/）—— 拒绝派发。' +
      '该目录装的是每个成员自己的错题本与方法论。读模式按目录树放宽，' +
      '而文件条目的读范围是它**所在的目录** —— 所以哪怕只写某个成员的文件，' +
      '读范围也会覆盖整个目录，写进白名单等于让 worker 读到**兄弟成员的错题本全文**与 Router 私有账。' +
      '不需要写进 SCOPE：被派工成员自己的方法论与错题本由 guard 按精确文件单独放行，与 SCOPE 无关。' +
      '若确实要把某成员的记录给 worker，请走「Router 转写进 brief」这条契约通道。');
  }
}
// === 闸门 1c：SCOPE 不得覆盖 .superagent/ 下的任何条目 ===
//
// D-31 只封了 lessons/ 与 methods/ 两个目录，但**同一个漏洞在别的条目上照样成立**：
// 读模式下，文件条目的读范围 = 它**所在的目录**（inScope 的 treeRoot 规则）。
// 所以只写一条 roster.json 的只读条目，读范围也是整个 .superagent/ ——
// 能读到兄弟成员的错题本全文与方法论全文，与直接写 lessons/ 目录效果一样。
//
// 写权限更危险：.superagent/roster.json 存着成员的**权限等级（tier）**。
// worker 能改它 = 自己给自己提权 = 授权模型当场被拆掉。
//
// 所以这里按「目录树」整体封，而不是按具体文件封：
//   · 读权限：worker 不需要读 roster（路由是 Router 的事）；
//     它自己的方法论与错题本走 guard 的 exactPaths，与 SCOPE 无关。
//   · 写权限：权限等级的变更必须由父会话（管理员）执行，不在 worker 手里。
//
// 诚实边界（别写成「绝对安全」）：hook 是护栏不是沙箱 —— worker 若能执行一段
// 落盘的脚本，脚本内部的 fs 写入不受本判定约束。那一层的兜底是运行时权限 +
// 人工确认 + .superagent/changes.log 的审计留痕。
for (const raw of scope) {
  const p2 = normScopeEntry(raw);
  if (!p2) continue;
  if (!touchesSuperagentPath(p2.path)) continue;
  if (p2.isDir) {
    deny('[super-agent-router] 派工的 SCOPE 覆盖了编排层的私有状态目录（.superagent/）—— 拒绝派发。' +
      '目录条目会把整棵 .superagent/ 展开成可读范围，' +
      '于是能读到兄弟成员的错题本全文与方法论全文（这正是「成员互相篡位」的那条路）。' +
      '需要读编排层状态文件时，请逐个文件写成只读条目（ro: .superagent/roster.json），' +
      '那种写法**精确生效**、不展开目录树。');
  }
  if (!p2.readOnly) {
    deny('[super-agent-router] 派工的 SCOPE 给了编排层私有状态目录（.superagent/）的**写**权限 —— 拒绝派发。' +
      '该目录存着成员的**权限等级（tier）**，写它等于自己给自己提权 = 授权模型当场被拆掉。' +
      '只读条目（ro: ）可以，逐个文件写；写权限不行。');
  }
}

const ledger = readLedger();
if (ledger.readable === false) {
  deny('[super-agent-router] 派工登记失败：' + (ledger.error || '派工台账不可用') +
    '。台账读不出来就没法做冲突与名额判定，这里不放行。');
}

// TTL 兜底（S6.2 第 2 条）：先把超龄的 active 记录判死，再看在飞名单。
// 以前只有读取时过滤，台账里永远留着 state:'active' 的僵尸条目（D-10）。
const reaped = reapExpiredDispatches(ledger, now);
// 判死结果先落盘：下面任何一条 deny 分支都会直接 exit，
// 判死结果不能跟着进程退出一起丢掉（读时自愈必须真的写下去）。
if (reaped) writeLedger(ledger);

// === 闸门 2：SCOPE 重叠检测 ===
// 两个仍在飞的 worker 写同一处 —— 后写的会覆盖先写的，
// 而且验收时无法判断哪份改动是有效的。所以组队阶段就要拦。
//
// 比对集是「同一项目内所有在飞派工」，不只同一父会话：
// 嵌套派工与第二个 Router 会话以前完全取不到对方的在飞记录（D-09）。
const activeAll = activeDispatchesAll(ledger, now, workspaceRoot());
for (const d of activeAll) {
  const clash = scopeClash(d.scope, scope);
  if (clash.length) {
    deny('[super-agent-router] 组队冲突：本次派工的 SCOPE 与仍在飞的 ' + (d.agent_key || d.agent) +
      ' 派工重叠（冲突路径：' + clash.slice(0, 5).join(', ') + '）。' +
      '两个 worker 同时写同一处会互相覆盖，验收也无从判断谁的改动生效。' +
      '要么等它结束再派，要么把范围拆开重写 SCOPE。');
  }
}

// === 闸门 3：单会话派工数上限 ===
// 编排不是撒网。派工数失控通常意味着任务没拆干净，或者在用派工代替思考。
const active = activeDispatches(ledger, sid, now);
if (active.length >= MAX_ACTIVE_DISPATCHES) {
  deny('[super-agent-router] 派工超限：本会话同时在飞的派工已达 ' + active.length +
    ' 个（上限 ' + MAX_ACTIVE_DISPATCHES + '）。' +
    '先收拢已完成的任务再派新的 —— 如果确实需要更多并行，先把任务拆细、明确各自边界。');
}
const total = dispatchedTotal(ledger, sid);
if (total >= MAX_TOTAL_DISPATCHES) {
  deny('[super-agent-router] 派工超限：本会话累计派工已达 ' + total +
    ' 个（上限 ' + MAX_TOTAL_DISPATCHES + '）。' +
    '一个会话的组队规模应该收敛；新的任务组请开新会话。');
}

// 抓目标成员的错题本规则
const agent = String(tInput.agent_name || '');
// 成员命名（D-12）：显示名与 routing id 是两套命名空间。
// 台账写 routing id，反查也用 routing id —— 两边用同一套 key 才不会互相看不见。
const promptAgent = extractBriefMarkers(prompt).agent;
const agentKey = resolveAgentKey({
  agentType: input.agent_type,
  promptAgent,
  toolAgentName: agent
});
const lessons = agentKey ? readLessons(agentKey) : (agent ? readLessons(agent) : []);
const lessonCount = agentKey ? countEntries(agentKey) : (agent ? countEntries(agent) : 0);

// 抓目标成员的实战记录（最近 3 条）
const records = agentKey ? readRecords(agentKey).slice(-3).reverse() : (agent ? readRecords(agent).slice(-3).reverse() : []);

// 写台账
// 去重键（S6.1）：父会话 + agent + (turn_id || tool_use_id)。
// 以前只用 turn_id，载荷缺该字段时 tid 为空串，
// 「空串 === 空串」对所有历史记录成立 —— 同一父会话里前一个 worker 的整条记录
// 被抹掉，它的 scope 从台账消失，冲突检测与名额统计同时失真（D-05）。
// 两者都拿不到时不去重：宁可多一条记录，也绝不抹掉别的 agent / 别的 turn 的记录。
const turnKey = tid || toolUseId;
let dispatchId = '';
const existing = turnKey ? (ledger.dispatches || []).find((d) =>
  String(d.parent_session_id || '') === sid &&
  String(d.agent_key || d.agent || '') === agentKey &&
  String(d.turn_key || d.turn_id || '') === turnKey &&
  (d.state || 'active') === 'active') : null;
if (existing) {
  // 同名键只允许覆盖完全相同的那一条（原地覆盖，保留 dispatch_id，
  // 这样 worker 的绑定仍能反查到这条记录）
  existing.scope = scope;
  existing.agent = agent;
  existing.agent_key = agentKey;
  existing.project = project;
  existing.tool_use_id = toolUseId;
  existing.lessons = lessons;
  existing.lesson_count = lessonCount;
  existing.at = now;
  dispatchId = existing.dispatch_id;
} else {
  dispatchId = 'dsp_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  ledger.dispatches.push({
    dispatch_id: dispatchId,
    parent_session_id: sid,
    turn_id: tid,
    turn_key: turnKey,
    tool_use_id: toolUseId,
    agent,
    agent_key: agentKey,
    project,
    scope,
    lessons,
    lesson_count: lessonCount,
    state: 'active',
    at: now
  });
  // 累计派工额度用持久化计数器（D-19）：台账截断到 200 条之后，
  // 靠扫台账算出来的累计数会偏低，30 条上限就形同虚设了。
  bumpDispatchCounter(ledger, sid);
}
ledger.dispatches = ledger.dispatches.slice(-200);
writeLedger(ledger);

const blocks = [];
// 教训前置：空集合也要显式说「0 条」。
// 「没有错题本」与「错题本没送达」在下游必须能区分开（D-18）：
// 前者是没栽过跟头，后者是链路故障，处理方式完全不同。
if (lessons.length) {
  const l2 = ['[super-agent-router] ' + (agentKey || agent) + ' 的历史教训（派工时必须写进 brief）：'];
  lessons.forEach((r, i) => l2.push((i + 1) + '. ' + r));
  blocks.push(l2.join('\n'));
} else {
  blocks.push('[super-agent-router] ' + (agentKey || agent) + ' 的历史教训：0 条' +
    '（该成员暂无错题本 —— 是「还没栽过跟头」，不是传递故障）。');
}
if (records.length) {
  const l2 = ['[super-agent-router] ' + (agentKey || agent) + ' 的实战记录（该成员此前验收通过的成果，可作方法参考）：'];
  records.forEach((r) => {
    l2.push('- ' + r.title + (r.approach ? ' —— ' + r.approach : '') + (r.evidence ? '（证据：' + r.evidence + '）' : ''));
  });
  blocks.push(l2.join('\n'));
} else {
  blocks.push('[super-agent-router] ' + (agentKey || agent) + ' 的实战记录：0 条' +
    '（该成员暂无验收通过的成果）。');
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: blocks.join('\n\n')
  }
}));
process.exit(0);
