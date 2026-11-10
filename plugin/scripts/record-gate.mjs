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
import { readStdin, parseInputStrict, readLedger } from './lib.mjs';
import {
  methodPath, locateRecordsSection, countRecordsInSection,
  appendRecordsEntry, resolveWriter, writeFileLocked
} from './lessons.mjs';

const MAX_RECORDS = 20;   // 单个成员实战记录上限，超了先合并淘汰旧的
const MAX_APPROACH = 300; // 单条「做法」字数上限，防写成流水账

const argv = process.argv.slice(2);
const rawInput = argv[0] !== undefined ? argv[0] : readStdin();
const parsed = parseInputStrict(rawInput);
if (!parsed.ok) {
  process.stdout.write(JSON.stringify({
    ok: false,
    errors: ['载荷解析失败：' + parsed.reason + ' —— 写入闸门在载荷读不出来时一律拒绝（放行即等于闸门整段失效）']
  }, null, 2));
  process.exit(0);
}
const payload = parsed.value;

const errors = [];

const agent = String(payload.agent || '').trim();
const task = String(payload.task || '').trim();
const domain = String(payload.domain || '').trim();
const approach = String(payload.approach || '').trim();
const evidence = String(payload.evidence || '').trim();
const verifiedBy = String(payload.verified_by || '').trim();

// ── 0. 写入者身份（谁在写） ────────────────────────────────
//
// 判据在 lessons.mjs 的 resolveWriter()（单一事实源）：调用方必须带 session_id，
// 闸门拿它去派工台账查该会话绑定的成员（agent_key），再与载荷里的 agent 比对。
// 成员子会话只能写**绑定成员自己**的账本；父会话可以给本项目任何成员记账，
// 但每一条都会把写入者写进条目本身，以便事后追责。
//
// 为什么履历也要查身份：履历是 Router 匹配成员时的依据（D-24）。
// 若任何成员都能往兄弟成员的方法论文件里塞「成果」，
// 那份文件就成了可伪造的匹配依据 —— 写进去的东西必须可信、可查、不能被伪造。
const writer = resolveWriter(payload);
if (!writer.ok) {
  for (const e of writer.errors) errors.push(e);
} else if (agent && !writer.canWrite(agent)) {
  const who = writer.role === 'member'
    ? '成员子会话（绑定成员：' + writer.boundAgent + '）'
    : '父会话（派工过的成员：' + (writer.dispatched.join('、') || '无') + '）';
  errors.push('写入者身份不符：会话 ' + writer.sessionId + ' 是' + who +
    '，只能给这些成员的履历记账；载荷却要写「' + agent + '」的履历 —— ' +
    '冒用他人身份写入被拒（写入目标由台账绑定决定，不由载荷独断）');
}

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
// 段首/段尾定位：**与读取端共用 lessons.mjs 的 locateRecordsSection**（D-51）。
//
// 历史 bug：这里曾用 indexOf('## 实战记录')（**子串**匹配），
// 而读取端 readRecords 按**行首**匹配 —— 同一份文件两套口径。
// 方法论文件正文里只要出现一次字面串（引用、说明、模板片段），
// 写入端就定位到前一个段去 → 新履历落进「归属」段 → 读取端读不到（静默丢失），
// 而且那个段里的其它「###」被当成履历条数 → 20 条上限被提前触顶。
//
// 现在定位、计数、插入三件事都走同一个函数（lessons.mjs），口径只有一份。
// 条数上限在**锁外**先判一次（快速失败，不为明显超限的写入排队），
// 但真正判定在锁内重读后再做一次 —— 锁外那份只是预判，可能已被并发写入改变。
const sectionPreview = locateRecordsSection(raw);
const existingPreview = sectionPreview.found ? countRecordsInSection(sectionPreview.body) : 0;
if (existingPreview >= MAX_RECORDS) {
  errors.push('该成员实战记录已达上限 ' + MAX_RECORDS + ' 条 —— 先合并/淘汰旧记录');
}

if (errors.length) {
  process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(0);
}

// 通过 —— 追加一条实战记录到方法论文件的「实战记录」段
//
// 走 lessons.mjs 的 writeFileLocked：跨进程锁 + 锁内重读 + 临时文件原子替换 + 回读校验。
// 为什么履历也要这样：同一成员的方法论文件可能被并发写（验收与复盘撞车），
// 读-改-写整体覆盖会让先写的那条**静默消失**，而两次写入都返回 ok:true（D-52 同族）。
//
// 条数上限也必须在锁内判：锁外判会被并发写入一起放行。
const nowIso = new Date().toISOString();
const d = nowIso.slice(0, 10);
const entry = [
  '### ' + d + ' · ' + domain + ' · ' + task,
  '- 做法：' + approach,
  '- 证据：' + evidence,
  '- 验收：' + verifiedBy,
  '- 写入者：' + writer.writer + ' · 会话 ' + writer.sessionId + ' · ' + nowIso,
  ''
].join('\n');

const res = writeFileLocked(file, (cur) => {
  const sec = locateRecordsSection(cur);
  const before = sec.found ? countRecordsInSection(sec.body) : 0;
  if (before >= MAX_RECORDS) {
    return { error: '该成员实战记录已达上限 ' + MAX_RECORDS + ' 条 —— 先合并/淘汰旧记录' };
  }
  const text = appendRecordsEntry(cur, entry);
  return {
    text,
    expectCount: before + 1,
    marker: entry.trim(),
    counter: (s2) => {
      const x = locateRecordsSection(s2);
      return x.found ? countRecordsInSection(x.body) : 0;
    }
  };
});
if (!res.ok) {
  process.stdout.write(JSON.stringify({ ok: false, errors: [res.error] }, null, 2));
  process.exit(0);
}
// 条数按**落盘后**的文件数（锁内重读的结果），不是锁外预判值。
const secFinal = locateRecordsSection(res.raw);
const existing = secFinal.found ? countRecordsInSection(secFinal.body) : 0;
process.stdout.write(JSON.stringify({
  ok: true, agent, records: existing, file,
  writer: writer.writer, writer_role: writer.role, session_id: writer.sessionId
}, null, 2));
process.exit(0);
