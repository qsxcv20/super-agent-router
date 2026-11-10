// roster 辅助：交叉核对 + 登记
//
// 成员存在于两个地方，含义不同：
//   mavis_agent_list  → 是否存在（账号级全局，跨项目）
//   roster.json        → 专项元数据（项目级）
//
// 路由时两边都要读。本脚本做交叉核对与登记，避免主模型手改 JSON 出错。
// 用法：
//   node scripts/roster.mjs reconcile <agentListJson>
//   node scripts/roster.mjs register <memberJson>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readStdin, parseInput } from './lib.mjs';
import { readRecords, countEntries } from './lessons.mjs';

// 名录上限。records.mjs 用它判断「截断是否可能发生」：
// maxMembers >= MAX_ROSTER 时，名录里不可能有成员被名额挤掉。
export const MAX_ROSTER = 12;

function projectDir() {
  return process.env.MINIMAX_PROJECT_DIR || process.cwd();
}

function stateDir() {
  return path.join(projectDir(), '.superagent');
}

export function rosterPath() {
  return path.join(stateDir(), 'roster.json');
}

// 名录的规范顺序 = 名字升序。
//
// 为什么名录要有「规范顺序」而不是随便什么顺序：名录顺序曾经被 records.mjs
// 当成「优先级」用 —— 按名录顺序截断实战记录摘要（D-24），
// 于是排在第 7 位以后的成员**结构性不可见**：不是因为战绩不够，而是因为位置靠后。
// 顺序只能是登记顺序，不能是重要性顺序 —— 重要性由 owns 与战绩决定，
// 不由「排在第几」决定。所以这里把规范顺序固定成名字升序，写在名录自己的模块里，
// 让「名录顺序」这件事只有一个定义处。
export function listMembers(roster) {
  const members = roster && Array.isArray(roster.members) ? roster.members : [];
  return dedupeByName([...members].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''))));
}

// ── 重名去重（D-57）────────────────────────────────────────
//
// roster.json 里出现同名成员（手改文件绕过 register 的重名拒绝）时，
// 同一个成员会在实战记录摘要里出现两次：既重复计数，又白占一个取样名额，
// 被挤掉的其他人就此少一个可见位置 —— 正是 D-24 想消除的那类「结构性不可见」。
//
// 口径：**同名取一条**（排序后的第一条），并把重名显式报出来。
// 为什么不是「静默取一条」：静默去重会让「名录里有两个人叫同一个名字」这件事
// 从此无人知晓 —— 记录看得见但不可查，等于没去重。
// 报出的方式放在返回值里（duplicateNames），由调用方决定怎么呈现，
// 这样读端与 CLI 都能拿到同一份事实，不至于两处各判一次。
export function dedupeByName(members) {
  const list = Array.isArray(members) ? members : [];
  const seen = new Map();
  const out = [];
  for (const m of list) {
    const name = String((m && m.name) || '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.set(name, m);
    out.push(m);
  }
  return out;
}

// 名录里的重名成员名（去重时被合并掉的那些）。
export function duplicateNames(roster) {
  const members = roster && Array.isArray(roster.members) ? roster.members : [];
  const seen = new Set();
  const dup = [];
  for (const m of members) {
    const name = String((m && m.name) || '').trim();
    if (!name) continue;
    if (seen.has(name)) { if (!dup.includes(name)) dup.push(name); continue; }
    seen.add(name);
  }
  return dup;
}

export function readRoster() {
  try {
    const r = JSON.parse(fs.readFileSync(rosterPath(), 'utf8'));
    if (!Array.isArray(r.members)) r.members = [];
    return r;
  } catch {
    return { version: 1, updated: null, note: '', members: [] };
  }
}

function writeRoster(r) {
  fs.mkdirSync(stateDir(), { recursive: true });
  r.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(rosterPath(), JSON.stringify(r, null, 2) + '\n', 'utf8');
}

function appendLog(line) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.appendFileSync(path.join(stateDir(), 'changes.log'), line + '\n', 'utf8');
}

const RESERVED = ['explore', 'worker', 'verifier', 'mavis', 'general', 'coder'];
const NAME_RE = /^sa-[a-z0-9]+(?:-[a-z0-9]+)*$/;
// 泛词黑名单：这些是角色形容词不是专项，文档写了不算，代码要拦。
const BANNED_WORDS = ['analyst', 'assistant', 'expert', 'helper', 'guy', 'bot'];

function cmdReconcile(agentList) {
  const roster = readRoster();
  const names = new Set(agentList.map(a => a.name || a));
  const adopt = [];   // list 有 roster 无 → 收编
  const stale = [];   // roster 有 list 无 → 陈旧
  const reuse = [];   // 两边都有 → 复用
  for (const m of roster.members) {
    if (names.has(m.name)) reuse.push(m.name);
    else if (m.source === 'runtime') stale.push(m.name);
  }
  for (const n of names) {
    if (!roster.members.some(m => m.name === n) && !RESERVED.includes(n)) adopt.push(n);
  }
  process.stdout.write(JSON.stringify({ adopt, stale, reuse, roster_size: roster.members.length }, null, 2));
  process.exit(0);
}

function cmdRegister(member) {
  const name = String(member.name || '').trim();
  const errors = [];
  if (!NAME_RE.test(name)) errors.push('名称须匹配 sa-<领域>-<动作>，且小写 kebab-case');
  const segs = name.split('-');
  const banned = segs.filter(s => BANNED_WORDS.includes(s));
  if (banned.length) errors.push('名称含泛词 ' + banned.join(',') + '：那是角色不是专项（专项应是「领域-动作」）');
  if (RESERVED.includes(name)) errors.push('与内置/保留名冲突');
  if (!member.owns) errors.push('缺 owns（负责哪一件事）');
  if (!member.accepts) errors.push('缺 accepts（何时派给它）');
  if (!member.reject) errors.push('缺 reject（何时不派给它）');
  const roster = readRoster();
  if (roster.members.some(m => m.name === name)) errors.push('roster 已存在同名成员');
  if (roster.members.length >= MAX_ROSTER) errors.push('roster 已达上限 ' + MAX_ROSTER);
  const methodPath = member.method || ('.superagent/methods/' + name + '.md');
  const absMethod = path.join(projectDir(), methodPath);
  if (!fs.existsSync(absMethod)) errors.push('方法论文件不存在：' + methodPath + '（先写方法论，再建成员）');
  if (errors.length) {
    process.stdout.write(JSON.stringify({ ok: false, errors }, null, 2));
    process.exit(0);
  }
  const entry = {
    name,
    kind: 'specialist',
    owns: member.owns,
    accepts: member.accepts,
    reject: member.reject,
    method: methodPath,
    source: 'runtime',
    created_for: member.created_for || '',
    created_at: new Date().toISOString()
  };
  roster.members.push(entry);
  writeRoster(roster);
  appendLog(new Date().toISOString() + ' | register | ' + name + ' | ' + (member.created_for || ''));
  process.stdout.write(JSON.stringify({ ok: true, member: entry }, null, 2));
  process.exit(0);
}

// 名录一览：每个成员的登记信息 + 战绩 + 教训条数。
// 让「专项名录」可查 —— 路由依据是这份名录，它不该只能靠手改 JSON 才看得全。
function cmdList() {
  const roster = readRoster();
  const members = listMembers(roster).map((m) => {
    const recs = readRecords(m.name);
    return {
      name: m.name,
      kind: m.kind || '',
      source: m.source || '',
      owns: m.owns || '',
      accepts: m.accepts || '',
      reject: m.reject || '',
      method: m.method || '',
      records: recs.length,
      lessons: countEntries(m.name),
      lastRecord: recs.length ? recs[recs.length - 1].title : ''
    };
  });
  const dup = duplicateNames(roster);
  process.stdout.write(JSON.stringify({
    roster_size: roster.members.length,
    roster_cap: MAX_ROSTER,
    // 重名成员：同一份名录里出现多个同名成员 —— 已按名去重，这里显式报出异常
    duplicateNames: dup,
    members
  }, null, 2));
  process.exit(0);
}

// 判断是否直接运行本文件（而非被 import）。
// 与 records.mjs 同一个模式：CLI 分支只在直接运行时执行，
// 否则 import 它的进程会被 exit(0) 干掉（roster 已被 records.mjs 当库 import）。
function isMain() {
  try {
    if (!process.argv[1]) return false;
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === 'reconcile') {
    const raw = argv[1] ? JSON.parse(argv[1]) : parseInput(readStdin());
    const list = Array.isArray(raw) ? raw : (raw.agents || []);
    cmdReconcile(list);
  } else if (cmd === 'register') {
    const raw = argv[1] ? JSON.parse(argv[1]) : parseInput(readStdin());
    cmdRegister(raw);
  } else if (cmd === 'list') {
    cmdList();
  } else {
    process.stdout.write('usage: roster.mjs reconcile|register|list');
    process.exit(1);
  }
}