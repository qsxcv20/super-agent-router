// PreToolUse (task)：派工登记 + 教训前置 + 履历参考
//
// 三个职责：
//   1. 记录每次派工的 scope，供 guard.mjs 做越界判定
//   2. 把目标成员的历史教训（错题本的「规则」段）前置给 Worker
//   3. 把目标成员的实战记录带给 Router 参考（这人做成过什么）
//
// 第 2 步是「自我进化」真正生效的位置：
// 不是事后修补，而是让 Worker 开工前就知道上次同类任务栽在哪儿。
// 第 3 步是「履历」生效的位置：匹配时能看出这人到底行不行。
import { readStdin, parseInput, readLedger, writeLedger, extractScope } from './lib.mjs';
import { readLessons, countEntries } from './lessons.mjs';
import { readRecords } from './lessons.mjs';

const input = parseInput(readStdin());
const tool = String(input.tool_name || '');
if (tool.toLowerCase() !== 'task') process.exit(0);

const tInput = input.tool_input || {};
const prompt = String(tInput.prompt || '');
const scope = extractScope(prompt);
const agent = String(tInput.agent_name || '');

// 抓目标成员的错题本规则
const lessons = agent ? readLessons(agent) : [];
const lessonCount = agent ? countEntries(agent) : 0;

// 抓目标成员的实战记录（最近 3 条）
const records = agent ? readRecords(agent).slice(-3).reverse() : [];

const ledger = readLedger();
ledger.dispatches = ledger.dispatches.filter((d) => d.session_id !== String(input.session_id || ''));
ledger.dispatches.push({
  session_id: String(input.session_id || ''),
  turn_id: String(input.turn_id || ''),
  agent,
  scope,
  unscoped: scope.length === 0,
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
  const lines = ['[super-agent-router] ' + agent + ' 的历史教训（派工时必须写进 brief）：'];
  lessons.forEach((r, i) => lines.push((i + 1) + '. ' + r));
  blocks.push(lines.join('\n'));
}
if (records.length) {
  const lines = ['[super-agent-router] ' + agent + ' 的实战记录（该成员此前验收通过的成果，可作方法参考）：'];
  records.forEach((r) => {
    lines.push('- ' + r.title + (r.approach ? ' —— ' + r.approach : '') + (r.evidence ? '（证据：' + r.evidence + '）' : ''));
  });
  blocks.push(lines.join('\n'));
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
