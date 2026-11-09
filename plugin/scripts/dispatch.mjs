// PreToolUse (task)：派工登记 + 组队闸门 + 教训前置 + 履历参考
//
// 五个职责：
//   1. 闸门一：派工必须带 SCOPE 白名单（不带就拒 —— 否则整个授权模型形同虚设）
//   2. 闸门二：SCOPE 不得与本会话仍在飞的派工重叠（两个 worker 写同一处会互相覆盖）
//   3. 闸门三：单会话派工数设上限（并发在飞 + 累计）
//   4. 记录每次派工的 scope，供 guard.mjs 做越界判定
//   5. 把目标成员的历史教训前置给 Worker，把实战记录带给 Router 参考
//
// 第 5 步是「自我进化」真正生效的位置：
// 不是事后修补，而是让 Worker 开工前就知道上次同类任务栽在哪儿。
import {
  readStdin, parseInput, readLedger, writeLedger, extractScope,
  activeDispatches, totalDispatches, scopeClash,
  MAX_ACTIVE_DISPATCHES, MAX_TOTAL_DISPATCHES
} from './lib.mjs';
import { readLessons, countEntries, readRecords } from './lessons.mjs';

const input = parseInput(readStdin());
const tool = String(input.tool_name || '');
if (tool.toLowerCase() !== 'task') process.exit(0);

const tInput = input.tool_input || {};
const prompt = String(tInput.prompt || '');
const scope = extractScope(prompt);
const agent = String(tInput.agent_name || '');

// 发起方会话 = 父会话（Router）。worker 在子会话里跑，父会话不该被 worker 的 scope 约束。
const sid = String(input.session_id || '');
const tid = String(input.turn_id || '');
const now = Date.now();

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
    'SCOPE: src/app.ts, src/util.ts（目录要写成 src/app/ 才涵盖其下所有文件）。' +
    '没有白名单就没有边界，越界拦截会失效。');
}

const ledger = readLedger();

// === 闸门 2：SCOPE 重叠检测 ===
// 同一会话里两个仍在飞的 worker 写同一处 —— 后写的会覆盖先写的，
// 而且验收时无法判断哪份改动是有效的。所以组队阶段就要拦。
const active = activeDispatches(ledger, sid, now);
for (const d of active) {
  const clash = scopeClash(d.scope, scope);
  if (clash.length) {
    deny('[super-agent-router] 组队冲突：本次派工的 SCOPE 与本会话仍在飞的 ' + d.agent +
      ' 派工重叠（冲突路径：' + clash.slice(0, 5).join(', ') + '）。' +
      '两个 worker 同时写同一处会互相覆盖，验收也无从判断谁的改动生效。' +
      '要么等它结束再派，要么把范围拆开重写 SCOPE。');
  }
}

// === 闸门 3：单会话派工数上限 ===
// 编排不是撒网。派工数失控通常意味着任务没拆干净，或者在用派工代替思考。
if (active.length >= MAX_ACTIVE_DISPATCHES) {
  deny('[super-agent-router] 派工超限：本会话同时在飞的派工已达 ' + active.length +
    ' 个（上限 ' + MAX_ACTIVE_DISPATCHES + '）。' +
    '先收拢已完成的任务再派新的 —— 如果确实需要更多并行，先把任务拆细、明确各自边界。');
}
const total = totalDispatches(ledger, sid);
if (total >= MAX_TOTAL_DISPATCHES) {
  deny('[super-agent-router] 派工超限：本会话累计派工已达 ' + total +
    ' 个（上限 ' + MAX_TOTAL_DISPATCHES + '）。' +
    '一个会话的组队规模应该收敛；新的任务组请开新会话。');
}

// 抓目标成员的错题本规则
const lessons = agent ? readLessons(agent) : [];
const lessonCount = agent ? countEntries(agent) : 0;

// 抓目标成员的实战记录（最近 3 条）
const records = agent ? readRecords(agent).slice(-3).reverse() : [];

// 写台账
// 去重键：父会话 + turn + agent
// 早期实现按 session_id 去重，会把同一 session 的前一次派工整条抹掉 ——
// 结果是连续派两个 worker 时，前一个的 scope 白名单丢失，guard 判错。
ledger.dispatches = ledger.dispatches.filter((d) => !(
  String(d.parent_session_id || '') === sid &&
  String(d.turn_id || '') === tid &&
  String(d.agent || '') === agent &&
  (d.state || 'active') === 'active'
));
const dispatchId = 'dsp_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
ledger.dispatches.push({
  dispatch_id: dispatchId,
  parent_session_id: sid,
  turn_id: tid,
  tool_use_id: String(input.tool_use_id || ''),
  agent,
  scope,
  unscoped: false,
  lessons,
  lesson_count: lessonCount,
  records: records.map((r) => r.title),
  record_count: records.length,
  state: 'active',
  at: now
});
ledger.dispatches = ledger.dispatches.slice(-200);
writeLedger(ledger);

const blocks = [];
if (lessons.length) {
  const l2 = ['[super-agent-router] ' + agent + ' 的历史教训（派工时必须写进 brief）：'];
  lessons.forEach((r, i) => l2.push((i + 1) + '. ' + r));
  blocks.push(l2.join('\n'));
}
if (records.length) {
  const l2 = ['[super-agent-router] ' + agent + ' 的实战记录（该成员此前验收通过的成果，可作方法参考）：'];
  records.forEach((r) => {
    l2.push('- ' + r.title + (r.approach ? ' —— ' + r.approach : '') + (r.evidence ? '（证据：' + r.evidence + '）' : ''));
  });
  blocks.push(l2.join('\n'));
}

if (blocks.length) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: blocks.join('\n\n')
    }
  }));
}
process.exit(0);
