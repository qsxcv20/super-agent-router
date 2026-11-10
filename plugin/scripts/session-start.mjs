// SessionStart：会话激活时注入编排协议
//
// 为什么必须有这个：
// UserPromptSubmit 只在「用户提问时」注入，且需要命中粗筛特征。
// 但真正的诉求是「任务来了自己分配给团队」——
// 模型得在会话一开始就知道有这个编排机制存在，才可能主动调用 task 派工。
//
// SessionStart 在新会话/恢复会话的首次模型处理前触发，
// 是唯一能保证「模型从第一轮就知道编排协议存在」的位置。
//
// 注入内容必须短。只放「什么时候该编排 + 怎么开始」，
// 详细的协议放在 skill 里，让模型按需加载。
import { readStdin, parseInput } from './lib.mjs';
import { summarizeRecordsDetailed } from './records.mjs';

const input = parseInput(readStdin());

const lines = [];
lines.push('[super-agent-router] 本会话已启用 Super-agent 编排机制。');
lines.push('');
lines.push('当用户的需求满足下列任一条时，主动走编排流程，不要只做单点执行：');
lines.push('- 需要同时做多件不同性质的事（如实现 + 验证、取数 + 成稿）');
lines.push('- 某个任务有明确的方法论要求，需要做到「精」而不是「能」');
lines.push('- 用户说「拆」「分工」「并行」「谁来做」「组队」「复盘」「验收」');
lines.push('');
lines.push('开始方式：');
lines.push('1. 读 .superagent/roster.json（专项名录，路由的唯一依据）');
lines.push('2. 跑 mavis agent list 核对成员是否存在（账号级事实源）');
lines.push('3. 按 owns 匹配该归谁；没有专精成员才现场配置（先写方法论文件，再建成员）');
lines.push('4. 派工时 brief 必须写 SCOPE 具体路径白名单 + 可勾选的 ACCEPT + EVIDENCE');
lines.push('5. 派工后必须由独立 verifier 验收，worker 自述完成不算完成');
lines.push('6. 验收通过后用 record-gate.mjs 给该成员记一条实战记录');
lines.push('');
lines.push('默认成员数 = 0。改 typo、查 API、单点小改一律直做，不要为了用编排而用编排。');
lines.push('（UserPromptSubmit 的粗筛可能漏判。若你判断这轮该走编排流程，直接读本 skill 的协议，不要等注入提醒。）');
lines.push('');
lines.push('完整协议见 skill: super-agent-router（references/ 下有 teams / routing / brief / bootstrap / review / records / scope）。');

// 实战记录摘要：让模型一开始就知道谁做成过什么
// 名额口径与 records.mjs 默认值统一，并取 maxMembers >= MAX_ROSTER(12)（契约 S7.3 / D-24）。
// 排序口径直接沿用 records.mjs 的取样结果，不另起一套。
const summary = summarizeRecordsDetailed(3, 12);
const summaries = summary.members;
if (summaries.length) {
  lines.push('');
  lines.push('【当前专项成员的实战记录（匹配参考）】');
  for (const s of summaries) {
    lines.push('- ' + s.name + '（owns：' + s.owns + '）：');
    for (const r of s.records) {
      lines.push('  · ' + r.title + (r.approach ? ' —— ' + r.approach : ''));
    }
  }
  lines.push('已显示 ' + summary.shownMembers + ' / 共 ' + summary.totalMembers + ' 个有记录的成员。');
  if (summary.truncated) {
    lines.push('被名额省略的成员：' + summary.omitted.join('、') + '（名录上限 ' + summary.rosterCap + '）。');
  }
  lines.push('注意：这些只作参考。归属仍以 roster.json 的 owns 为准。');
}

// SessionStart 支持 hookSpecificOutput.additionalContext；
// 这里用 plain-text stdout（exit 0 即可被注入为模型上下文）
process.stdout.write(lines.join('\n'));
process.exit(0);