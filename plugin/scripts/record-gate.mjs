// 实战记录闸门（履历机制）
//
// 错题本记「栽过哪」（失败，下次派工前置）；
// 实战记录记「做成过什么」（成功，下次匹配更准）。
// 两者镜像，纪律也对称。
//
// 关键约束：成就只能由「验收通过」触发，不能由成员自述触发。
// 否则履历就是自我吹嘘 —— 刚创建的成员写第一份履历时最不可信。
//
// 落地形态：写进成员的方法论文件 .superagent/methods/<成员名>.md 的
// 「实战记录」段。好处：
//   1. Worker 读方法论时自然看到上次怎么做的，不用额外通道；
//   2. 方法论与履历同生共死 —— 方法论删了，履历一起没了，不留孤儿数据；
//   3. 一处可版本控制、可 review。
//
// 用法：node scripts/record-gate.mjs <payloadJson>
//   payload = { agent, task, domain, approach, evidence, verified_by }

import fs from 'node:fs';
import { readStdin, parseInput } from './lib.mjs';
import { methodPath } from './lessons.mjs';

const MAX_RECORDS = 20;   // 单个成员实战记录上限，超了先合并淘汰旧的
const MAX_APPROACH = 300; // 单条「做法」字数上限，防写成流水账
const SECTION = '## 实战记录';

const argv = process.argv.slice(2);
const payload = argv[0] ? JSON.parse(argv[0]) : parseInput(readStdin());

const errors = [];

const agent = String(payload.agent || '').trim();
const task = String(payload.task || '').trim();
const domain = String(payload.domain || '').trim();
const approach = String(payload.approach || '').trim();
const evidence = String(payload.evidence || '').trim();
const verifiedBy = String(payload.verified_by || '').trim();

// 1. 必须指明是哪个成员
if (!agent) errors.push('缺 agent（记录谁的成果）');

// 2. 领域：这是「擅长什么」的证据，缺了就无法用来判断匹配
if (!domain) errors.push('缺 domain（这件事属于哪个专项领域）');

// 3. 做法：必须有，但是要短
if (!approach) errors.push('缺 approach（怎么做的，一两句话）');
if (approach.length > MAX_APPROACH) errors.push('approach 过长（>' + MAX_APPROACH + ' 字）—— 履历是索引不是流水账');

// 4. 证据：不可核验的成果不进履历
if (!evidence) errors.push('缺 evidence（产出在哪：文件路径 / 验证方式）');

// 5. 必须由验收方确认 —— 这是「不是自我吹嘘」的唯一保证
if (!verifiedBy) errors.push('缺 verified_by（验收人）—— 成果只能由验收通过触发，不能自述');
if (verifiedBy === agent) errors.push('验收人不能是执行人自己 —— 执行者不可自证');

// 6. 方法论文件必须存在：实战记录住在方法论里，没方法论就无处可写
const file = methodPath(agent);
let raw = '';
try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = ''; }
if (!raw) errors.push('方法论文件不存在：.superagent/methods/' + agent + '.md（先写方法论，成果才有地方沉淀）');

// 7. 上限：只增不减的履历也会变成垃圾堆
const sectionStart = raw.indexOf(SECTION);
const countIn = (s) => (s.match(/^###\s/gm) || []).length;
const existing = sectionStart >= 0
  ? countIn(raw.slice(sectionStart, nextSection(raw, sectionStart)))
  : 0;
if (existing >= MAX_RECORDS) {
  errors.push('该成员实战记录已达上限 ' + MAX_RECORDS + ' 条 —— 先合并/淘汰旧记录');
}

function nextSection(text, from) {
  const rest = text.slice(from + SECTION.length);
  const m = rest.match(/\n##\s+/);
  return m ? rest.indexOf('\n## ') : rest.length;
}

if (errors.length) {
  process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(0);
}

// 通过 —— 追加一条实战记录到方法论文件的「实战记录」段
const d = new Date().toISOString().slice(0, 10);
const entry = [
  '### ' + d + ' · ' + domain + ' · ' + task,
  '- 做法：' + approach,
  '- 证据：' + evidence,
  '- 验收：' + verifiedBy,
  ''
].join('\n');

let out;
if (sectionStart >= 0) {
  // 已有该段：插到该段末尾（下一个二级标题之前）
  const after = raw.indexOf('\n## ', sectionStart + SECTION.length);
  if (after === -1) {
    out = raw.replace(/\s*$/, '\n') + '\n' + entry + '\n';
  } else {
    out = raw.slice(0, after).replace(/\s*$/, '\n') + '\n' + entry + '\n' + raw.slice(after).replace(/^\n+/, '\n');
  }
} else {
  out = raw.replace(/\s*$/, '\n') + '\n' + SECTION + '\n\n' + entry + '\n';
}
fs.writeFileSync(file, out, 'utf8');
process.stdout.write(JSON.stringify({ ok: true, agent, records: existing + 1, file }, null, 2));
process.exit(0);
