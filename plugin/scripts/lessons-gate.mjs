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
if (!agent) errors.push('缺 agent（哪��个成员的错题本）');

// 2. 类型必须是四类重大错误之一
if (!MAJOR.includes(type)) {
  errors.push('类型须为四类之一：' + MAJOR.join(' / ') + '（一次性环境抖动不进错题本）');
}

// 3. 归因公平：Router 自己的锅不甩给成员
const routerFault = /(brief\s*给错|派工给错|需求本身自相矛盾|需求自相矛盾|router\s*的锅)/i.test(cause + ' ' + rule);
if (routerFault) errors.push('归因指向 Router 自身 —— 这是编排层的锅，不该记在成员头上');

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