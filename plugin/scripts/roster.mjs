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
import { readStdin, parseInput, accountMemberNames, accountMemberExists, rosterMemberNames, staleRosterMembers } from './lib.mjs';
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

// ── D-39 名录侧：登记前核对该成员已存在于账号 ─────────────────────
//
// 判据：**该成员必须已存在于账号成员名单** ——
//   <账号成员目录>/<name>/          专项成员
//   <账号成员目录>/.builtin/<name>/  内置成员
//
// 为什么是这条判据（而不是「名字像不像」「方法论写了没有」）：
// 账号成员是**账号级事实**（跨项目全局可见），项目名录是**项目级事实**。
// 两边不成对 ⇒ 名录里会出现账号里根本没有的成员 ⇒ 派工到它时**静默失效**
// （派工侧会拒，但名录本身已经在骗人：它声称有一个成员，其实没有）。
// D-39 的另一半（建号纳入账号级危险动作）管的是「谁能往账号里塞成员」，
// 这一半管的是「名录能不能登记一个账号里不存在的成员」—— 合起来才是「成对」。
//
// 为什么名单只从 lib.mjs 取：注入侧（session-start）与派工侧（dispatch）
// 已经共用同一份 accountMemberNames()；这里若自己再扫一遍目录，
// 两处口径迟早分叉 —— 分叉出来的「存在」判定就是猜的。
// 附带好处：内置成员（.builtin/）由那一份名单统一计入，天然不被误伤。
export function checkAccountMember(name) {
  const target = String(name || '').trim();
  const ctx = accountMemberNames();
  if (!ctx.available) {
    // 名单读不出来 = **无法核验**，不等于「成员不存在」。
    // lib.mjs 的 accountMemberNames() 对这两种情况分得很清：
    // available=false 是「读不出来 / 目录不存在」，不是「空名单」。
    // 所以这里不放行 —— 放行等于把「取不到账号事实」当成「该成员没问题」。
    return {
      ok: false,
      code: 'account_list_unavailable',
      error: '无法核验账号成员名单：' + redactAccountDir(ctx.error, ctx.dir) +
        '。名单读不出来时不能断言「该成员存在」—— 建号与登记必须成对，所以这里不放行。' +
        '请在账号运行环境里执行（PLUGIN_DATA 指向本插件的专属目录，' +
        '此时账号成员目录取 <用户主目录>/.minimax/agents/），' +
        '或用 SAR_ACCOUNT_AGENTS_DIR 显式指向账号成员目录后重试。'
    };
  }
  if (!accountMemberExists(ctx.names, target)) {
    return {
      ok: false,
      code: 'account_member_missing',
      error: '该成员在账号里不存在：' + target + '。' +
        '建号与登记必须成对（先在账号里建好该成员，再登记进项目名录）。' +
        '应检查的位置：账号成员目录下的 ' + target + '/ 与 .builtin/' + target + '/。'
    };
  }
  return { ok: true, code: 'account_member_present', error: '' };
}

// 报错里不原样印账号目录的绝对路径。
// 为什么：那串路径会被抄进 brief、错题本与变更账 —— 一旦被当成命令执行
// （或被别的机器当成自己的路径去改），就是一条「看起来能跑的账号级写动作」。
// 报错要说的是「去哪儿看」，不是「照着这串东西敲」。
function redactAccountDir(text, dir) {
  let s = String(text || '');
  const d = String(dir || '');
  if (d) s = s.split(d).join('<账号成员目录>');
  return s;
}

function cmdReconcile(agentList) {
  const roster = readRoster();

  // ── 账号侧视图（account view）：陈旧判定的**唯一**输入 ──────────────
  //
  // 为什么要有「视图」这一层：陈旧这条**规则**只能有一份实现，
  // 但「账号里有哪些成员」这个**事实**有两个来源：
  //   ① 调用方喂进来的 agent 名单（mavis_agent_list 的输出）—— reconcile 原来的用法；
  //   ② lib.mjs 的 accountMemberNames()（扫账号成员目录，含 .builtin/ 内置成员）
  //      —— 机制侧（会话注入披露、派工拒绝）用的就是它。
  //
  // 以前这两边**各算各的**：机制侧按「名录里有、账号里没有」判陈旧，
  // reconcile 却多带一层 source === 'runtime' 过滤 ——
  // 于是同一个成员，机制侧认它陈旧、reconcile 说不陈旧。
  // 结论不一致（一边拦派工、一边说没问题），迟早长歪成两套事实。
  //
  // 现在：规则只有一份（lib.mjs 的 staleRosterMembers），差别只剩
  // 「喂哪份账号名单」，而且这个差别是**显式**的：
  //   喂了名单 → 用喂的（来源 'fed-list'）；
  //   没喂名单 → 用账号目录扫的（来源 'runtime' / 'explicit' / 'none'）。
  // 不再藏在 source 过滤里 —— 那种「悄悄不同」才是真正会误导人的东西。
  //
  // 内置成员（.builtin/<name>/）在两种来源下都算「账号里存在」，
  // 所以内置成员不会被判成陈旧；这一条由 accountMemberNames() 与
  // 调用方喂的名单各自保证（mavis_agent_list 同样会列出内置成员）。
  const fed = (Array.isArray(agentList) ? agentList : [])
    .map(a => (a && typeof a === 'object' ? a.name : a))
    .filter(Boolean)
    .map(String);
  let account;
  if (fed.length) {
    account = {
      available: true,
      names: [...new Set(fed)],
      dir: '',
      error: '',
      source: 'fed-list'
    };
  } else {
    // 没喂名单 → 用账号目录这一份事实（机制侧同源）。
    account = accountMemberNames();
  }
  const names = new Set(account.names || []);

  // 名录侧的名字集合也走共享口径（去重保序）——
  // 否则这里一份、staleRosterMembers 里另一份，名录有重名时两边结论会不一致。
  const rosterNames = rosterMemberNames(roster);
  const adopt = [];   // 账号有 名录无 → 收编
  const stale = [];   // 名录有 账号无 → 陈旧（规则见 lib.mjs 的 staleRosterMembers）
  const reuse = [];   // 两边都有 → 复用
  for (const n of rosterNames) {
    if (names.has(n)) reuse.push(n);
  }
  for (const n of names) {
    if (!rosterNames.includes(n) && !RESERVED.includes(n)) adopt.push(n);
  }
  // 陈旧判定交给共享计算：注入侧披露的与派工侧拒绝的必须是同一个集合。
  stale.push(...staleRosterMembers(roster, account));
  process.stdout.write(JSON.stringify({
    adopt,
    stale,
    reuse,
    roster_size: roster.members.length,
    // 这次比对用的是哪份账号名单 —— 不让「结论从哪来」变成猜的
    account_view: {
      source: account.source || '',
      available: !!account.available,
      members: names.size,
      error: account.available ? '' : (account.error || '')
    }
  }, null, 2));
  process.exit(0);
}

function cmdRegister(member) {
  const name = String(member.name || '').trim();
  // 错误与其命中的规则一一对应（error_rules 与 errors 同序）。
  //
  // 为什么多带一个 error_rules：只给中文报错，调用方只能靠「报错文本里有没有某个词」
  // 去猜命中的是哪条规则 —— 那是猜。规则代号让「命中的就是这一条」变成可断言的事实，
  // 也让「回退某条校验 → 哪条断言转红」能被机械核对（见 docs/audit/fix-d39-roster.md）。
  const items = [];
  const fail = (rule, msg) => { items.push({ rule, message: msg }); };

  // 校验顺序 = bootstrap.md 的造人顺序：方法论 → 建成员 → 登记。
  // 顺序有意义：早一步没过，后面的步骤就没必要问（问出来的错误会让人查错地方）。
  if (!NAME_RE.test(name)) fail('name_format', '名称须匹配 sa-<领域>-<动作>，且小写 kebab-case');
  const segs = name.split('-');
  const banned = segs.filter(s => BANNED_WORDS.includes(s));
  if (banned.length) fail('banned_word', '名称含泛词 ' + banned.join(',') + '：那是角色不是专项（专项应是「领域-动作」）');
  if (RESERVED.includes(name)) fail('reserved_name', '与内置/保留名冲突');
  if (!member.owns) fail('missing_owns', '缺 owns（负责哪一件事）');
  if (!member.accepts) fail('missing_accepts', '缺 accepts（何时派给它）');
  if (!member.reject) fail('missing_reject', '缺 reject（何时不派给它）');
  const methodPath = member.method || ('.superagent/methods/' + name + '.md');
  const absMethod = path.join(projectDir(), methodPath);
  if (!fs.existsSync(absMethod)) fail('method_missing', '方法论文件不存在：' + methodPath + '（先写方法论，再建成员）');

  // D-39 名录侧：登记前核对该成员已存在于账号。
  //
  // 只在「这个名字本身站得住」时才问账号：
  //   · 命名不合规 / 含泛词 / 撞保留名 —— 这三种情况下登记必然被上面的规则拒掉，
  //     再补一条「账号里不存在」只是噪声，还会把人引到错的地方查
  //     （保留名 worker/explore 在账号里本来就有，说它「不存在」是假话）。
  //   · 一次拒绝只该给出一个要改的地方 —— 报错多了，人会去逐条试，而不是直奔真正那条。
  let accountCheck = null;
  if (!items.length) {
    accountCheck = checkAccountMember(name);
    if (!accountCheck.ok) fail(accountCheck.code, accountCheck.error);
  }
  const roster = readRoster();
  if (roster.members.some(m => m.name === name)) fail('duplicate_member', 'roster 已存在同名成员');
  if (roster.members.length >= MAX_ROSTER) fail('roster_full', 'roster 已达上限 ' + MAX_ROSTER);

  if (items.length) {
    process.stdout.write(JSON.stringify({
      ok: false,
      errors: items.map(i => i.message),
      error_rules: items.map(i => i.rule),
      account_check: accountCheck ? { ok: accountCheck.ok, code: accountCheck.code } : null
    }, null, 2));
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