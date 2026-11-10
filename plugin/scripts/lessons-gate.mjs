// 错题本写入闸门
//
// 准入规则写在 references/review.md，但文档写的不等于拦得住的。
// 这里把四类重大错误、归因公平、规则上限 15 条变成程序校验。
//
// 用法：node scripts/lessons-gate.mjs <payloadJson>
//   payload = { agent, task, type, symptom, cause, rule, next_time, occurrence }

import fs from 'node:fs';
import path from 'node:path';
import { readStdin, parseInput } from './lib.mjs';
import { lessonsPath, countEntries } from './lessons.mjs';

const MAX_RULES = 15;
const MAJOR = ['越界', '数据错误', '交付缺失', '不可逆'];

const argv = process.argv.slice(2);
const payload = argv[0] ? JSON.parse(argv[0]) : parseInput(readStdin());

const errors = [];

const agent = String(payload.agent || '').trim();
const type = String(payload.type || '').trim();
const symptom = String(payload.symptom || '').trim();
const cause = String(payload.cause || '').trim();
const rule = String(payload.rule || '').trim();
const nextTime = String(payload.next_time || '').trim();
const task = String(payload.task || '').trim();
const occurrence = payload.occurrence || 'single';   // single | repeat

// 1. 成员名
if (!agent) errors.push('缺 agent（哪个成员的错题本）');

// 1b. 保留名：Router 自己的错题本（契约 S9）用 S1 的 7 字段模板，
// 与成员错题本的 4 字段格式不是一套 —— 成员写进去会把两种模板搅在一起。
if (agent && /^_/.test(agent)) {
  errors.push('agent 不能以「_」开头 —— 「_router」是 Router 自己的错题本（契约 S9），用 S1 的 7 字段模板，不接受成员格式');
}

// 2. 类型必须是四类重大错误之一
if (!MAJOR.includes(type)) {
  errors.push('类型须为四类之一：' + MAJOR.join(' / ') + '（一次性环境抖动不进错题本）');
}

// ── 3. 归因公平：编排层的锅不甩给成员（契约 S7.2 / S9） ──
//
// 为什么按**语序枚举**、不按词枚举：
//   按词枚举（出现 brief / 派工 / Router 就拦）拦不住语序变化 ——
//     「给错的 brief」里根本没有「brief 给错」这个子串，换个语序就漏进去；
//   而 brief / 派工 / Router 这些词在**成员认错**时同样会出现
//     （「按 brief 做了但没回显口径」），按词拦就是把认错也一起拦了。
//   所以这里把「指控编排层」的语序逐条列出来：一条语序一个正则 + 一个可读标签，
//   命中即拦，并在报错里报出漏进来的是哪条语序 —— 补词即可，不必重写整条规则。
//
// 分寸：拦的是**甩锅**，不是**认错**。成员自己承认失误、且根因确实在成员侧的条目，
//   必须仍能写进来。靠两条豁免实现：
//   (a) 宾语豁免：blame 动词的宾语是**成员自己产出的东西**（口径/数据/参数…）
//       **并且** brief/派工 处在执行语境（「按 brief 给错了口径」）时，
//       说明是执行错了，不是 brief 错了 —— 这是认错，不拦。
//       为什么必须同时要执行语境：光看宾语会把「brief 给错了口径来源」也放过去，
//       而那句话是在说 brief 本身写错了 —— 甩锅，不能放。
//   (b) 否定豁免：命中词前面紧挨着否定（不是 brief 给错 / 这不是 Router 的锅）时，
//       成员是在澄清自己背锅，不拦。
const MEMBER_ARTIFACT_RE = /^\s*(?:的\s*)?(?:口径|数据|参数|格式|数值|字段|文件名|名字|名称|日期|金额|单位|符号|样式|筛选|取值|结论|代码)/;
const EXEC_CONTEXT_RE = /(?:按|照|依照|遵照|依据|根据)\s*$/;
const NEGATION_RE = /(?:不是|并非|不全是|不算|不能算|不归|不怪|别怪|不要怪|甭怪|没有|未|非)\s*$/;
// 顺序 = 具体优先（先匹配到的先报出来），
// 这样报错里报出的是最贴切的那条语序，便于按语序补词。
const ROUTER_FAULT_PATTERNS = [
  { label: '派工 brief 有误', re: /(?:派工|派活|分派)\s*(?:的\s*)?(?:brief|任务书|内容)?\s*(?:有误|不对|是错的|错了|写错|发错)/i },
  { label: '派工给错', re: /(?:派工|派活|分派|工单)\s*(?:内容|任务书|brief|要求)?\s*(?:给|发|写)\s*错(?:了)?/i },
  { label: 'Router 给错', re: /router\s*(?:给|发|写|下)\s*错(?:了)?/i },
  { label: '给错的 brief', re: /给错(?:了)?\s*(?:的\s*)?brief/i },
  { label: 'brief 给错', re: /brief\s*(?:本身\s*)?(?:给|发|写|下)\s*错(?:了)?/i },
  { label: 'brief 有误', re: /brief\s*(?:本身\s*)?(?:有误|不对|是错的|错了|写错|发错)/i },
  { label: 'Router 的锅', re: /router\s*(?:的\s*)?锅/i },
  { label: '编排层的锅', re: /(?:编排层|编排方|派工方|上游|上级)\s*(?:的\s*)?锅/i },
  { label: '上游给错', re: /(?:上游|上游方)\s*(?:给|发)\s*错(?:了)?/i },
  { label: '需求本身自相矛盾', re: /(?:需求|要求|任务书|目标)\s*(?:本身|自身)?\s*(?:自相矛盾|相互矛盾|互相矛盾|前后矛盾|自相冲突|相矛盾|矛盾)/i }
];

// 返回命中的语序标签；没命中返回空串。
function routerFaultLabel(text) {
  for (const p of ROUTER_FAULT_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.indexOf('g') >= 0 ? p.re.flags : p.re.flags + 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      const after = text.slice(m.index + m[0].length);
      if (NEGATION_RE.test(before)) continue;   // 否定语境：成员在澄清自己背锅
      // 宾语是成员自己的产物 **且** brief/派工 在执行语境里 → 是执行失误，不是 brief 的错
      if (MEMBER_ARTIFACT_RE.test(after) && EXEC_CONTEXT_RE.test(before)) continue;
      return p.label;
    }
  }
  return '';
}

const routerFault = routerFaultLabel(cause + ' ' + rule);
if (routerFault) {
  errors.push('归因指向 Router 自身（命中语序：' + routerFault + '）—— 这是编排层的锅，不该记在成员头上；按契约 S9 应记进 .superagent/lessons/_router.md');
}

// 4. 四要素齐全
if (!symptom) errors.push('缺 symptom（现象）');
if (!cause) errors.push('缺 cause（根因）');
if (!rule) errors.push('缺 rule（规则）');
if (!nextTime) errors.push('缺 next_time（下次派工时能直接执行的一条判断）');

// 5. 规则必须可执行 —— 含动词动作，不是感想
const VAGUE = /(注意|小心|注意一下|要小心|应该注意|加强|提高意识|下次注意)/;
if (rule && VAGUE.test(rule) && !/(必须|不得|禁止|应当|一律|不予|才)/.test(rule)) {
  errors.push('规则不可执行 —— 写成「下次派工时能直接照做的一条判断」，不要写感想');
}

// 6. 上限：只增不减的错题本和只增不减的约束一样致命
const existing = countEntries(agent);
if (existing >= MAX_RULES) {
  errors.push('该成员错题本已达上限 ' + MAX_RULES + ' 条 —— 必须先合并/淘汰旧规则才能加新的');
}

// 7. 同型重复才进错题本：单次非重大错误不进
if (occurrence === 'single' && !MAJOR.includes(type)) {
  errors.push('单次且非重大错误不进错题本');
}

if (errors.length) {
  process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(0);
}

// 通过闸门 —— 追加条目
const p = lessonsPath(agent);
fs.mkdirSync(path.dirname(p), { recursive: true });
let raw = '';
try { raw = fs.readFileSync(p, 'utf8'); } catch { raw = ''; }
if (!raw.trim()) {
  raw = '# ' + agent + ' 的错题本\n\n';
}
const d = new Date().toISOString().slice(0, 10);
const entry = [
  '',
  '## ' + d + ' · 任务「' + task + '」· 类型：' + type,
  '- 现象：' + symptom,
  '- 根因：' + cause,
  '- **规则**：' + rule,
  '- 下次派工：' + nextTime,
  ''
].join('\n');
fs.writeFileSync(p, raw.replace(/\s*$/, '\n') + entry + '\n', 'utf8');
process.stdout.write(JSON.stringify({ ok: true, agent, entries: existing + 1, path: p }, null, 2));
process.exit(0);