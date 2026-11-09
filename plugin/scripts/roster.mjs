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
import { readStdin, parseInput } from './lib.mjs';

const MAX_ROSTER = 12;

function projectDir() {
  return process.env.MINIMAX_PROJECT_DIR || process.cwd();
}

function stateDir() {
  return path.join(projectDir(), '.superagent');
}

function rosterPath() {
  return path.join(stateDir(), 'roster.json');
}

function readRoster() {
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

const argv = process.argv.slice(2);
const cmd = argv[0];
if (cmd === 'reconcile') {
  const raw = argv[1] ? JSON.parse(argv[1]) : parseInput(readStdin());
  const list = Array.isArray(raw) ? raw : (raw.agents || []);
  cmdReconcile(list);
} else if (cmd === 'register') {
  const raw = argv[1] ? JSON.parse(argv[1]) : parseInput(readStdin());
  cmdRegister(raw);
} else {
  process.stdout.write('usage: roster.mjs reconcile|register');
  process.exit(1);
}