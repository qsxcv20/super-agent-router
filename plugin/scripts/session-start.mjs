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
import { readStdin, parseInput, readRoster, TIER_FULL } from './lib.mjs';
import { summarizeRecordsDetailed, SUMMARY_MAX_MEMBERS } from './records.mjs';
import { readRouterLessons } from './lessons.mjs';

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
lines.push('');
lines.push('你的定位是**管理层，不是干活的**。判断顺序：');
lines.push('- 先看有没有专项成员 owns 这件事 —— 有就派工，别自己上手做；');
lines.push('- 没有专精成员、但这事有明确方法论要求（要做「精」而不是「能」），先现场配置成员（写方法论文件 → 建成员 → 登记 roster）再派工；');
lines.push('- 只有单点小改（改 typo、查 API、加注释、改配置值）才自己直做。');
lines.push('');
lines.push('分工边界：**意图理解、拆解、组队、整合、给用户结论**归你；**具体实现、批量取证、独立验收**不归你 —— worker 自述完成不算完成。');
lines.push('');
lines.push('成员记忆是**共享但隔离**的：教训、履历、方法论各归各的，派工时只注入目标成员自己的历史。');
lines.push('发现串味（别人的教训出现在你的 brief 里、两个成员抢同一个 owns、有人改了别人的记录）按缺陷处理，改归属映射，别放着不管。');
lines.push('');
lines.push('');
lines.push('每个成员都有一条**权限等级**（tier，声明在 .superagent/roster.json 里）：');
lines.push('- scoped（默认）：逐路径白名单，白名单外一律拦，越界自动记账进待审清单；');
lines.push('- full：项目工作区内自由读写，不必逐路径枚举；工作区外的路径仍拦并记账，账号级不可逆动作照旧硬拦。');
lines.push('**每个成员都是平等的** —— 任何成员都可以被提权，不是某些成员的特权；');
lines.push('但提权这个动作在管理员（你）手里：');
lines.push('node scripts/scope-amend.mjs --tiers');
lines.push('node scripts/scope-amend.mjs --tier full --agent <成员名> --approver <本次派工的父会话 id = 你自己的会话 id>');
lines.push('（批准人必须是**真实会话 id**，不能写「router」这种自称；`node scripts/scope-amend.mjs --list` 的待审清单里直接给出该 id）');
lines.push('提权写进 roster.json 并留痕 .superagent/changes.log；派工期间提权对**已在飞的会话不生效**（等级按派工时快照）。');
lines.push('诚实边界：护栏是护栏不是沙箱 —— worker 若能执行一段落盘的脚本，脚本内部的写入不受判定约束；靠审计留痕与验收时复核兜底，别把「拦得住」写成「绝对不可能」。');
lines.push('');
lines.push('默认成员数 = 0（不预置成员，用时现场配置）。改 typo、查 API、单点小改一律直做，不要为了用编排而用编排。');
lines.push('（UserPromptSubmit 的粗筛可能漏判。若你判断这轮该走编排流程，直接读本 skill 的协议，不要等注入提醒。）');
lines.push('');
lines.push('完整协议见 skill: super-agent-router（references/ 下有 teams / routing / brief / bootstrap / review / records / scope）。');

// 编排层自己的教训（Router 私有账）。
// 以前只有「成员教训 → worker」一条通路，编排层的教训无处可去 ——
// 于是每份 brief 各写各的模板、编号各自从 01 开始，正是 _router.md 里 RT-02/RT-03 记的同型问题。
// 契约 S9 与 references/review.md 都写着「由 SessionStart 注入 Router 上下文」，但代码从未实现。
const routerLessons = readRouterLessons();
if (routerLessons.length) {
  lines.push('');
  lines.push('【编排层自己的历史教训（派工前先看）】');
  for (const r of routerLessons) {
    lines.push('- ' + r.id + (r.trigger ? '：' + r.trigger : '') +
      (r.fix ? ' —— 修法：' + r.fix : ''));
  }
}

// 当前被提权到 full 的成员（管理员授予，平等适用）。
// Router 需要知道谁可以在项目内自由干活 —— 否则提权了也不会被派上活。
const rosterNow = readRoster();
const fullMembers = (rosterNow.ok && rosterNow.members || [])
  .filter((m) => String((m && m.tier) || '') === TIER_FULL)
  .map((m) => String(m.name || ''));
if (fullMembers.length) {
  lines.push('');
  lines.push('【full 权限等级成员（项目内自由读写）】');
  for (const n of fullMembers) lines.push('- ' + n);
  lines.push('派工给他们时 SCOPE 仍要写（记录意图 + 冲突检测），但不必逐路径枚举白名单。');
}

// 实战记录摘要：让模型一开始就知道谁做成过什么
// 名额口径与 records.mjs 默认值统一，并取 maxMembers >= MAX_ROSTER(12)（契约 S7.3 / D-24）。
// 排序口径直接沿用 records.mjs 的取样结果，不另起一套。
const summary = summarizeRecordsDetailed(3, SUMMARY_MAX_MEMBERS);
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