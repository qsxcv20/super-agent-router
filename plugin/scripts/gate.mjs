// UserPromptSubmit：程序层粗筛（Fast Path）
// 只有当 prompt 命中"值得走编排流程"的特征时才注入路由指令。
// 否则静默放行 —— 这是 Super-agent「尽量少占用人类注意力」的落点。
import { readStdin, parseInput, extractScope } from './lib.mjs';
import { summarizeRecords } from './records.mjs';

const input = parseInput(readStdin());
const prompt = String(input.prompt || '');

// 粗筛特征：编排意图词 + 显式请求信号
const INTENT = /(派工|组队|组建|拆成|拆给|分工|并行|安排人|交给谁|谁来做|编排|路由|多.?agent|团队|专项|验收|复盘|错题本)/i;
const SIGNAL = /(并行|同时|多个|分别|各自|多线程|批量)/i;
const SCOPE_HINT = /SCOPE\s*[:：]/i;

let hit = INTENT.test(prompt);
if (!hit && SIGNAL.test(prompt) && prompt.length > 40) hit = true;
if (!hit && SCOPE_HINT.test(prompt)) hit = true;

if (!hit) {
  // 静默放行：不写 stdout，不注入任何上下文
  process.exit(0);
}

const scope = extractScope(prompt);
const lines = [];
lines.push('[super-agent-router] 本轮按编排流程处理。');
lines.push('');
lines.push('按以下顺序执行：');
lines.push('1. 先判断能否直做。能直做就直做，默认 0 个成员。改 typo、查 API、单点小改一律直做。');
lines.push('2. 需要编排时，读本工作区的 .superagent/roster.json，按专项归属(owns)匹配成员，不要按角色相似度匹配。');
lines.push('3. 匹配到专精成员就复用。成员"能做"不等于"做得精"——若这事有明确专项性(高频/有方法论/有验收标准)且无人专精，才考虑新建专项成员。');
lines.push('4. 组队时保证 scope 白名单互不重叠、职责正交(实现 vs 验证、取数 vs 成稿)。');
lines.push('5. 派工后必须由独立 verifier 验收，worker 自述完成不算完成。');
if (scope.length) {
  lines.push('');
  lines.push('本轮 prompt 中声明的 SCOPE：' + scope.join(', '));
}

// 实战记录摘要：作为匹配参考注入。
// 只影响「你该考虑谁」，不影响「owns 归属声明是什么」——
// 后者始终以 roster.json 为准，不因战绩自动收窄，保持可审计。
const summaries = summarizeRecords(3, 6);
if (summaries.length) {
  lines.push('');
  lines.push('【实战记录（匹配参考）】以下成员过去有验收通过的成果，可作为"该派给谁"的参考：');
  for (const s of summaries) {
    lines.push('- ' + s.name + '（owns：' + s.owns + '，共 ' + s.count + ' 条）：');
    for (const r of s.records) {
      lines.push('  · ' + r.title + (r.approach ? ' —— ' + r.approach : ''));
    }
  }
  lines.push('注意：这些只作参考。归属仍以 roster.json 的 owns 为准，不要据此自动改写归属声明。');
}
lines.push('');
lines.push('完整协议见 skill: super-agent-router。');

process.stdout.write(lines.join('\n'));
process.exit(0);
