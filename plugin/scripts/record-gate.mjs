// 实战记录闸门（履历机制）
//
// 错题本记「栽过哪」（失败，下次派工前置）；
// 实战记录记「做成过什么」（成功，下次匹配更准）。
// 两者镜像，纪律也对称。
//
// 关键约束：成就只能由「验收通过」触发，不能由成员自述触发。
// 否则履历就是自我吹嘘 —— 刚创建的成员写第一份履历时最不可信。
//
// 「验收通过」怎么证明（契约 S7.1，缺陷 D-13）：
//   判据 = 派工台账里存在一条 `agent == verified_by` 且 `state == 'done'` 的记录。
//   为什么不是「名字不等于 agent」：那只证明没自证，不证明有人验过 ——
//     任何人填一个陌生名字就能伪造履历，而履历会被注入给 Router 当匹配依据。
//   为什么不是「在 roster.json 里」：roster 只登记专项成员，
//     验收方常常是内置 verifier（不在 roster 里），拿它当判据会漏掉真实验收。
//   台账条目由机制写入（dispatch 登记、watchdog 回收 state），不是成员随手能填的字段。
//
// 向后兼容策略（重要，改动前先读这段）：
//   本校验只发生在**写入时**（新增一条履历时），**读取时不做任何台账校验**。
//   于是历史履历里那些「verified_by 不在台账里」的名字（已被清理的验收方、
//   早期还没有台账记录的验收）照样读得出来、照样照常注入给 Router。
//   闸门不回写、不删除、不重算已有条目 —— 它只管「现在这条新记录是谁验的」。
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
import { readStdin, parseInput, readLedger } from './lib.mjs';
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

// 5b. 验收方必须真实存在（契约 S7.1 / 缺陷 D-13）
// 判据：派工台账里存在一条 agent == verified_by 且 state == 'done' 的记录。
// 这条判据之所以够硬：台账条目由 dispatch 登记、由 watchdog 回收 state，
// 成员没有权限去写台账（它不在项目 scope 内），也就无法凭空造一个 done。
// 只查「台账里有没有这个验收方跑过」，不查「跑的是不是这次活」——
// 后者是派工台账的生命周期问题，归机制 owner（见 D-10），不在本闸门范围内。
// 兼容：只拦「新增」这一条，历史条目不重算（见文件头「向后兼容策略」）。
if (verifiedBy && verifiedBy !== agent) {
  const dispatches = readLedger().dispatches || [];
  const hasDone = dispatches.some((d) =>
    String(d.agent || '') === verifiedBy && String(d.state || '') === 'done');
  if (!dispatches.length) {
    errors.push('无法核验验收方「' + verifiedBy + '」：派工台账为空或不可用（PLUGIN_DATA 未设置 / 台账文件缺失）—— 验收通过必须有台账凭据');
  } else if (!hasDone) {
    errors.push('验收方「' + verifiedBy + '」在派工台账里没有 state=done 的记录 —— 不存在「叫这个名字的验收方跑过验收」的证据，履历不可写入（验收需走一次 task 派工，由 watchdog 回收成 done）');
  }
}

// 6. 方法论文件必须存在：实战记录住在方法论里，没方法论就无处可写
const file = methodPath(agent);
let raw = '';
try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = ''; }
if (!raw) errors.push('方法论文件不存在：.superagent/methods/' + agent + '.md（先写方法论，成果才有地方沉淀）');

// 7. 上限：只增不减的履历也会变成垃圾堆
//
// 段首/段尾定位：**全程绝对索引**（契约 S7.4 / 缺陷 D-21）。
// 历史 bug：nextSection 曾返回「相对 sectionStart 的偏移」，却被
// raw.slice(sectionStart, nextSection(...)) 当绝对索引用 —— 偏移小于段首时
// slice 得到空串，existing 恒为 0，20 条上限永不触发，履历无限增长。
// 现在段尾定位只有一个函数、一种口径，计数与写入共用它 ——
// 「同一文件两套索引口径」正是 D-21 的成因，所以这里从结构上消掉。
const sectionStart = raw.indexOf(SECTION);
const countIn = (s) => (s.match(/^###\s/gm) || []).length;
const sectionEnd = sectionStart >= 0 ? nextSectionIndex(raw, sectionStart) : -1;
const sectionBody = sectionStart >= 0
  ? raw.slice(sectionStart, sectionEnd === -1 ? raw.length : sectionEnd)
  : '';
const existing = countIn(sectionBody);

// 段定位自检：口径再混一次，这里会当场露馅，而不是静默当成「0 条」。
if (sectionStart >= 0 && sectionEnd !== -1 && sectionEnd < sectionStart) {
  errors.push('段定位异常：实战记录段的结束位置早于段首（索引口径不一致）—— 拒绝写入');
}
if (sectionStart >= 0 && existing === 0 && /^###\s/m.test(sectionBody)) {
  errors.push('记录计数异常：段内有记录头却计为 0 条 —— 拒绝写入，不要静默当成 0');
}
if (existing >= MAX_RECORDS) {
  errors.push('该成员实战记录已达上限 ' + MAX_RECORDS + ' 条 —— 先合并/淘汰旧记录');
}

// 下一个二级标题的**绝对索引**；没有下一段返回 -1。
// 计数与写入共用它：两个地方各写一套索引口径，就是 D-21 的成因。
function nextSectionIndex(text, from) {
  return text.indexOf('\n## ', from + SECTION.length);
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
  // 与计数共用 nextSectionIndex —— 写入路径不再自己算一遍段尾。
  const after = nextSectionIndex(raw, sectionStart);
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
