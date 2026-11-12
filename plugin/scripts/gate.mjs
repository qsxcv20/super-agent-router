// UserPromptSubmit：程序层粗筛（Fast Path）
// 只有当 prompt 命中"值得走编排流程"的特征时才注入路由指令。
// 否则静默放行 —— 这是 Super-agent 「尽量少占用人类注意力」的落点。
//
// v0.5.1 修正（D-27）：
//   ① 判定抽到 lib.mjs 的 judgeTriggerIntent()，回归能直接 import 断言；
//      以前只能靠「跑脚本看 stdout」验 —— 而漏判的表现就是 stdout 为空，
//      和「判定为不该命中」长得一模一样，所以漏判能长期不被发现。
//   ② 扩了口语动词短语（拆一下/分头做/谁负责/各做各的…），去掉 prompt.length > 40 硬门槛；
//   ③ 信号词必须与动作词邻近同现，防「同时打开文件」「批量导入」这类伪信号误触发；
//   ④ 载荷解析失败不再静默：留痕而不是悄悄不命中。
import { readStdin, parseInputStrict, extractScope, judgeTriggerIntent, writeGateTrace } from './lib.mjs';
import { summarizeRecordsDetailed, SUMMARY_MAX_MEMBERS } from './records.mjs';

const raw = readStdin();
const parsed = parseInputStrict(raw);

// 载荷坏了 = 我们不知道用户说了什么。
// 以前这里用 parseInput（失败返回空对象），载荷一坏就变成「prompt 为空 → 不命中 → 静默」，
// 于是「永远不命中」是悄无声息的 —— 与 D-26 同族的静默失效。
if (!parsed.ok) {
  writeGateTrace('payload-parse-failed', parsed.reason);
  process.exit(0);
}

const input = parsed.value;
if (typeof input.prompt !== 'string') {
  // 载荷是合法 JSON、但 prompt 字段不在 —— 平台改字段名的话，
  // 这里就是「永远不命中」的入口，必须留痕而不是静默。
  writeGateTrace('prompt-field-missing', Object.keys(input).join(','));
  process.exit(0);
}

const prompt = input.prompt;
const verdict = judgeTriggerIntent(prompt);
const scope = extractScope(prompt);

if (!verdict.hit) {
  // 条件式兜底：只有「roster 存在 + 有专项成员 + 该成员有实战记录」时才注入一行。
  // 没有可用专项成员的工作区（单点小改）保持 0 字节输出。
  const fb = summarizeRecordsDetailed(3, SUMMARY_MAX_MEMBERS);
  if (fb.members.length) {
    process.stdout.write(
      '[super-agent-router] 本工作区有可复用的专项成员（本轮未判定为编排需求，故不展开）：' +
      '若这轮要拆分/并行/分工，先读 .superagent/roster.json 按 owns 匹配；否则直做。'
    );
  }
  process.exit(0);
}

const lines = [];
lines.push('[super-agent-router] 本轮按编排流程处理。');
lines.push('');
lines.push('按以下顺序执行：');
lines.push('1. 先判断能否直做。能直做就直做，默认 0 个成员。改 typo、查 API、单点小改一律直做。');
lines.push('2. 需要编排时，读本工作区的 .superagent/roster.json，按专项归属(owns)匹配成员，不要按角色相似度匹配。');
lines.push('3. 匹配到专精成员就复用。成员"能做"不等于"做得精"——若这事有明确专项性(高频/有方法论/有验收标准)且无人专精，才考虑新建专项成员。');
lines.push('4. 组队时保证 scope 白名单互不重叠、职责正交(实现 vs 验证、取数 vs 成稿)。');
lines.push('5. 派工后必须由独立 verifier 验收，worker 自述完成不算完成。');
lines.push('6. 派工粒度 = 一个大项目一个窗口：大项目（同一族缺陷 / 同一批交付物 / 同一个验证目标）由一个窗口从头负责到底，项目内部的步骤（探针 / 夹具 / 回放 / 取证 / 记录）由那个窗口自己做，不各自另开窗。');
if (scope.length) {
  lines.push('');
  // 措辞必须写清「这是用户文本里的路径，不是授权」：
  // 以前这里写的是「本轮 prompt 中声明的 SCOPE」，读起来像用户授权，
  // Router 就可能原样抄进 brief 当成 worker 的写边界（D-15）。
  // 真正的授权只来自 Router 自己写下的 brief，dispatch 会从那里再取一次。
  lines.push('用户文本中出现的疑似路径（未验证；是否作为派工边界由你判定，不要直接当授权抄进 brief）：' + scope.join(', '));
}

// 实战记录摘要：作为匹配参考注入。
// 只影响「你该考虑谁」，不影响「owns 归属声明是什么」——
// 后者始终以 roster.json 为准，不因战绩自动收窄，保持可审计。
// 名额口径与 records.mjs 默认值统一，并取 maxMembers >= MAX_ROSTER(12)：
// 名录上限 12 时不可能有成员被名额挤掉，
// 「排在名录后面就结构性不可见」这件事从根上消失（契约 S7.3 / D-24）。
// 取样顺序直接用 records.mjs 的口径（成果条数降序 -> 同条数按名字升序），
// 不在这里另起一套排序，否则两处口径迟早不一致。
const summary = summarizeRecordsDetailed(3, SUMMARY_MAX_MEMBERS);
const summaries = summary.members;
if (summaries.length) {
  lines.push('');
  lines.push('【实战记录（匹配参考）】以下成员过去有验收通过的成果，可作为"该派给谁"的参考：');
  for (const s of summaries) {
    lines.push('- ' + s.name + '（owns：' + s.owns + '，共 ' + s.count + ' 条）：');
    for (const r of s.records) {
      lines.push('  · ' + r.title + (r.approach ? ' —— ' + r.approach : ''));
    }
  }
  lines.push('已显示 ' + summary.shownMembers + ' / 共 ' + summary.totalMembers + ' 个有记录的成员。');
  if (summary.truncated) {
    lines.push('被名额省略的成员：' + summary.omitted.join('、') + '（名录上限 ' + summary.rosterCap + '）。');
  }
  lines.push('注意：这些只作参考。归属仍以 roster.json 的 owns 为准，不要据此自动改写归属声明。');
}
lines.push('');
lines.push('完整协议见 skill: super-agent-router。');

process.stdout.write(lines.join('\n'));
process.exit(0);
