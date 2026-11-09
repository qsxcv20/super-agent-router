// PreToolUse (task)：派工登记 + 教训前置 + 履历参考
//
// 四个职责：
//   1. 校验派工必须带 SCOPE 白名单（不带就拒 —— 否则整个授权模型形同虚设）
//   2. 记录每次派工的 scope，供 guard.mjs 做越界判定
//   3. 把目标成员的历史教训（错题本的「规则」段）前置给 Worker
//   4. 把目标成员的实战记录带给 Router 参考（这人做成过什么）
//
// 第 3 步是「自我进化」真正生效的位置：
// 不是事后修补，而是让 Worker 开工前就知道上次同类任务栽在哪儿。
// 第 4 步是「履历」生效的位置：匹配时能看出这人到底行不行。
import { readStdin, parseInput, readLedger, writeLedger, extractScope } from './lib.mjs';
import { readLessons, countEntries, readRecords } from './lessons.mjs';

const input = parseInput(readStdin());
const tool = String(input.tool_name || '');
if (tool.toLowerCase() !== 'task') process.exit(0);

const tInput = input.tool_input || {};
const prompt = String(tInput.prompt || '');
const scope = extractScope(prompt);
const agent = String(tInput.agent_name || '');

const sid = String(input.session_id || '');
const tid = String(input.turn_id || '');

// === 闸门 1：派工必须声明 scope ===
// 不带 scope 的派工会让 guard 完全失去判定依据（无白名单 = 无边界），
// 等于把授权模型整个绕开。所以这里直接拒绝。
if (!scope.length) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        '[super-agent-router] 派工缺少 SCOPE 白名单，拒绝派发。' +
        'brief 必须逐条写明可改动的具体路径，例如：' +
        'SCOPE: src/app.ts, src/util.ts（目录要写成 src/app/ 才涵盖其下所有文件）。' +
        '没有白名单就没有边界，越界拦截会失效。'
    }
  }));
  process.exit(0);
}

// 抓目标成员的错题本规则
const lessons = agent ? readLessons(agent) : [];
const lessonCount = agent ? countEntries(agent) : 0;

// 抓目标成员的实战记录（最近 3 条）
const records = agent ? readRecords(agent).slice(-3).reverse() : [];

const ledger = readLedger();

// 去重键：session + turn + agent
// 早期实现按 session_id 去重，会把同一 session 的前一次派工整条抹掉 ——
// 结果是连续派两个 worker 时，前一个的 scope 白名单丢失，guard 判错。
ledger.dispatches = ledger.dispatches.filter((d) => !(
  String(d.session_id || '') === sid &&
  String(d.turn_id || '') === tid &&
  String(d.agent || '') === agent
));
ledger.dispatches.push({
  session_id: sid,
  turn_id: tid,
  agent,
  scope,
  unscoped: false,
  lessons,
  lesson_count: lessonCount,
  records: records.map(r => r.title),
  record_count: records.length,
  at: Date.now()
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