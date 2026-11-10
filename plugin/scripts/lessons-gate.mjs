// 错题本写入闸门
//
// 准入规则写在 references/review.md，但文档写的不等于拦得住的。
// 这里把四类重大错误、归因公平、规则上限 15 条变成程序校验；
// 另外三道判据管的是「写进去的东西可不可信」：
//
//   1. 写入者身份（谁在写）—— 载荷不能独断「写进谁的账本」。
//      判据见 lessons.mjs 的 resolveWriter()：调用方必须带 session_id，
//      闸门拿它去派工台账查该会话绑定的成员（agent_key），与载荷的 agent 比对。
//      成员子会话只能写自己；父会话只能给它派过工的成员记账。
//   2. 归因公平覆盖**全部自由文本字段** —— 甩锅不能藏在 symptom 里。
//   3. 并发安全写 + 落盘回读校验 —— 不能「说成功其实没写进去」。
//
// 用法：
//   node scripts/lessons-gate.mjs '<payloadJson>'            写成员错题本（4 字段格式）
//   node scripts/lessons-gate.mjs --router '<payloadJson>'   写 Router 私有账（S1 的 7 字段格式）
//
// payload（成员错题本）：
//   { session_id, agent, task, type, symptom, cause, rule, next_time, occurrence }
// payload（Router 私有账）：
//   { session_id, id, trigger, impact, repro, evidence, status, fix, need }

import fs from 'node:fs';
import path from 'node:path';
import { readStdin, parseInputStrict } from './lib.mjs';
import {
  lessonsPath, countEntryHeaders, resolveWriter, writeFileLocked, projectDir
} from './lessons.mjs';

const MAX_RULES = 15;
const MAX_ROUTER_ENTRIES = 50;
const ROUTER_ID_RE = /^[A-Za-z][A-Za-z0-9]*-[0-9]{2}$/;
const MAJOR = ['越界', '数据错误', '交付缺失', '不可逆'];

const argv = process.argv.slice(2);
const routerMode = argv[0] === '--router';
const rawArg = routerMode ? argv[1] : argv[0];
const rawInput = rawArg !== undefined ? rawArg : readStdin();
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
const type = String(payload.type || '').trim();
const symptom = String(payload.symptom || '').trim();
const cause = String(payload.cause || '').trim();
const rule = String(payload.rule || '').trim();
const nextTime = String(payload.next_time || '').trim();
const task = String(payload.task || '').trim();
const occurrence = payload.occurrence || 'single';   // single | repeat

// ── 0. 写入者身份（谁在写） ────────────────────────────────
//
// 放在内容校验之前：先问「谁在写」，再问「写什么」。
// 身份判据在 lessons.mjs 的 resolveWriter() 里（单一事实源），这里只负责报错文案。
const writer = resolveWriter(payload);
if (!writer.ok) {
  for (const e of writer.errors) errors.push(e);
} else if (agent && !writer.canWrite(agent)) {
  const who = writer.role === 'member'
    ? '成员子会话（绑定成员：' + writer.boundAgent + '）'
    : '父会话（派工过的成员：' + (writer.dispatched.join('、') || '无') + '）';
  errors.push('写入者身份不符：会话 ' + writer.sessionId + ' 是' + who +
    '，只能给这些成员的账本记账；载荷却要写「' + agent + '」的账本 —— ' +
    '冒用他人身份写入被拒（写入目标由台账绑定决定，不由载荷独断）');
}

// 成员路径的字段校验（router 路径用 S1 七字段，不走这一套）
if (!routerMode) {
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

// 归因判定覆盖**每一个自由文本字段**，逐字段判、逐字段用豁免。
//
// 为什么不能只看 cause + rule：那两个字段可以被写成自己的锅，
// 而真正的指控（「Router 给错了 brief」）塞进 symptom —— 甩锅漏网。
// 契约 S9 问的是「这是成员的锅吗」，那就要看条目里**全部**的自由文本。
// 逐字段判（而不是把四段拼成一个大字符串）有两个好处：
//   - 豁免的「前文/后文」只在同一个字段里找，不会跨字段误判；
//   - 报错能指明是哪个字段出的问题，便于定位。
  const ATTRIBUTION_FIELDS = [
    { label: 'symptom（现象）', text: symptom },
    { label: 'cause（根因）', text: cause },
    { label: 'rule（规则）', text: rule },
    { label: 'next_time（下次派工）', text: nextTime }
  ];
  for (const f of ATTRIBUTION_FIELDS) {
    const label = routerFaultLabel(f.text);
    if (!label) continue;
    errors.push('归因指向 Router 自身（命中语序：' + label + '，出现在 ' + f.label +
      '）—— 这是编排层的锅，不该记在成员头上；按契约 S9 应记进 .superagent/lessons/_router.md');
    break;
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

  // 7. 同型重复才进错题本：单次非重大错误不进
  //    （必须在 !routerMode 块**内**：router 载荷没有 type/occurrence，
  //     放外面就会用成员规则去判编排层的条目 —— 私有账永远写不进去）
  if (occurrence === 'single' && !MAJOR.includes(type)) {
    errors.push('单次且非重大错误不进错题本');
  }

}

// ── Router 私有账写入闸门（契约 S9 + S1） ─────────────────
//
// 独立成路，不与成员校验共用一条链：两边用的是**不同的字段模板** ——
//   成员错题本 = 4 字段（现象/根因/规则/下次派工），类型限四类重大错误；
//   Router 私有账 = 契约 S1 的 7 字段（触发条件/影响/复现步骤/证据/状态/修法方向/还需要什么）。
// 混在一条链里跑，私有账必然被成员校验拒掉（缺 agent / type 不在四类 / 缺 symptom…），
// 于是 S9 的「记进 _router.md」永远走不到 —— 这条路径不能是死路。
//
// 四道校验：
//   1. 写入者身份：只有父会话（Router 自己）能写编排层的账；成员子会话一律拒。
//   2. S1 七字段齐全 + 状态取值合法。
//   3. 编号合法、同文件前缀一致、序号递增不跳号不重号。
//   4. 条数上限 + 写入留痕（条目内记写入者，另在 changes.log 留一行）。
//
// 为什么「序号递增」必须在**锁内**判：编号是文件级的全局序列，
// 锁外读到的「上一条编号」可能已被另一个并发写入顶掉 ——
// 那样两个并发写会算出同一个序号，重号/跳号只能等事后人工翻文件才发现。
if (routerMode) {
  const id = String(payload.id || '').trim();
  const status = String(payload.status || '').trim();
  const seven = [
    ['trigger', '触发条件'], ['impact', '影响'], ['repro', '复现步骤'],
    ['evidence', '证据'], ['status', '状态'], ['fix', '修法方向'], ['need', '还需要什么']
  ];
  if (writer.ok && writer.role !== 'parent') {
    errors.push('Router 私有账（_router.md）只接受 Router 自己写 —— 当前会话是成员子会话（' +
      writer.boundAgent + '），成员无权写编排层的账');
  }
  if (!ROUTER_ID_RE.test(id)) {
    errors.push('编号格式非法：须为「前缀-两位序号」（如 RT-01），前缀 2~4 位字母/数字');
  }
  for (const [k, label] of seven) {
    if (!String(payload[k] || '').trim()) {
      errors.push('缺「' + label + '」（契约 S1 的 7 字段模板，缺字段的条目不算条目）');
    }
  }
  if (status && !['已复现', '推断'].includes(status)) {
    errors.push('状态只能是「已复现」或「推断」，当前是「' + status + '」');
  }
  if (errors.length) {
    process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2));
    process.exit(0);
  }

  const nowIso = new Date().toISOString();
  const routerEntry = [
    '### ' + id,
    '- 触发条件：' + String(payload.trigger || '').trim(),
    '- 影响：' + String(payload.impact || '').trim(),
    '- 复现步骤：' + String(payload.repro || '').trim(),
    '- 证据：' + String(payload.evidence || '').trim(),
    '- 状态：' + status,
    '- 修法方向：' + String(payload.fix || '').trim(),
    '- 还需要什么：' + String(payload.need || '').trim(),
    '- 写入者：' + writer.writer + ' · 会话 ' + writer.sessionId + ' · ' + nowIso,
    ''
  ].join('\n');
  const routerFile = lessonsPath('_router');
  const routerRes = writeFileLocked(routerFile, (raw) => {
    // 锁内重读编号序列（锁外那份会被并发写入顶掉）
    const ids = [];
    const idRe = /^###[ \t]+([A-Za-z][A-Za-z0-9]{1,3}-[0-9]{2})[ \t]*$/gm;
    let im;
    while ((im = idRe.exec(raw)) !== null) ids.push(im[1]);
    if (ids.length >= MAX_ROUTER_ENTRIES) {
      return { error: 'Router 私有账已达上限 ' + MAX_ROUTER_ENTRIES + ' 条 —— 先合并/淘汰旧条目' };
    }
    if (ids.length) {
      const last = ids[ids.length - 1];
      const lastPrefix = last.slice(0, last.lastIndexOf('-'));
      const lastNum = parseInt(last.slice(last.lastIndexOf('-') + 1), 10);
      const idPrefix = id.slice(0, id.lastIndexOf('-'));
      const idNum = parseInt(id.slice(id.lastIndexOf('-') + 1), 10);
      if (idPrefix !== lastPrefix) {
        return { error: '编号前缀不一致：本文件用的是「' + lastPrefix + '-NN」，新条目用了「' + idPrefix + '-NN」' };
      }
      if (idNum !== lastNum + 1) {
        return { error: '编号必须递增且不跳号不重号：上一条是 ' + last + '，下一条应为 ' +
          lastPrefix + '-' + String(lastNum + 1).padStart(2, '0') + '，收到 ' + id };
      }
      if (ids.includes(id)) {
        return { error: '编号重号：' + id + ' 已经存在' };
      }
    } else if (!id.endsWith('-01')) {
      return { error: 'Router 私有账的第一条编号必须是「前缀-01」，收到 ' + id };
    }
    const head = raw.trim() ? raw.replace(/\s*$/, '\n') : '# Router 的错题本\n\n';
    const text = head + routerEntry + '\n';
    return {
      text,
      expectCount: ids.length + 1,
      marker: '### ' + id,
      counter: (s2) => {
        const re = /^###[ \t]+[A-Za-z][A-Za-z0-9]{1,3}-[0-9]{2}[ \t]*$/gm;
        const m2 = s2.match(re);
        return m2 ? m2.length : 0;
      }
    };
  });
  if (!routerRes.ok) {
    process.stdout.write(JSON.stringify({ ok: false, errors: [routerRes.error] }, null, 2));
    process.exit(0);
  }
  // 写入留痕：条目内的「写入者」行回答「谁写的」，changes.log 那行回答「什么时候写的」。
  // 两者一起才够事后追责 —— 只留前者，事后查时间线要靠文件系统时间戳，不算留痕。
  try {
    fs.mkdirSync(path.join(projectDir(), '.superagent'), { recursive: true });
    fs.appendFileSync(path.join(projectDir(), '.superagent', 'changes.log'),
      nowIso + ' | router-lesson | ' + id + ' | writer=' + writer.writer +
      ' session=' + writer.sessionId + '\n', 'utf8');
  } catch { /* 留痕失败不阻断写入：条目内的写入者行已经在了 */ }
  process.stdout.write(JSON.stringify({
    ok: true, target: '_router', id, path: routerFile,
    writer: writer.writer, writer_role: writer.role, session_id: writer.sessionId
  }, null, 2));
  process.exit(0);
}

// 6. 上限：只增不减的错题本和只增不减的约束一样致命
//    （条数在锁内重读后判定 —— 锁外判会被并发写入一起放行）

if (errors.length) {
  process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(0);
}

// 通过闸门 —— 追加条目（锁内重读 → 拼串 → 原子替换 → 回读校验）
const p = lessonsPath(agent);
const nowIso = new Date().toISOString();
const d = nowIso.slice(0, 10);
const entry = [
  '',
  '## ' + d + ' · 任务「' + task + '」· 类型：' + type,
  '- 现象：' + symptom,
  '- 根因：' + cause,
  '- **规则**：' + rule,
  '- 下次派工：' + nextTime,
  '- 写入者：' + writer.writer + ' · 会话 ' + writer.sessionId + ' · ' + nowIso,
  ''
].join('\n');

const res = writeFileLocked(p, (raw) => {
  // 条数在**锁内重读后**判定：锁外判会被并发写入一起放行（两个进程都看到 14 条就都写）。
  const before = countEntryHeaders(raw);
  if (before >= MAX_RULES) {
    return { error: '该成员错题本已达上限 ' + MAX_RULES + ' 条 —— 必须先合并/淘汰旧规则才能加新的' };
  }
  const head = raw.trim() ? raw.replace(/\s*$/, '\n') : ('# ' + agent + ' 的错题本\n\n');
  const text = head + entry + '\n';
  return {
    text,
    expectCount: before + 1,
    marker: entry.trim(),
    counter: countEntryHeaders
  };
});
if (!res.ok) {
  process.stdout.write(JSON.stringify({ ok: false, errors: [res.error] }, null, 2));
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  ok: true, agent, entries: countEntryHeaders(res.raw), path: p,
  writer: writer.writer, writer_role: writer.role, session_id: writer.sessionId
}, null, 2));
process.exit(0);
