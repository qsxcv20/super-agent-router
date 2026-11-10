// 越界请求审核与扩权入口（契约 S13 / 缺陷 D-34）
//
// 为什么需要这个入口：
//   子代理撞到 scope 墙时，护栏会自动把「它想访问什么、被拒了什么」记进台账的
//   scope_requests（见 guard.mjs 的 denyOutOfScope）。
//   以前父会话只有两个选择：改 brief **重新派工**（重开一次派工、浪费名额与上下文），
//   或者靠 worker 自己汇报才知道它卡在哪（本轮实测：验收方与两名专项成员都撞过这堵墙，
//   父会话要靠 task_append 人工补口径才救回来）。
//
//   本脚本把「批准扩权」变成**一条命令**：把目标并入该派工的 scope，同步子会话绑定，落盘留痕。
//
// 自动的是**发现、判定与记账**；**批准权明确在父会话手里** ——
// 让被约束者自己决定边界，等于把授权模型整个拆掉。所以这里没有「自动批准」，
// 只有「自动记账 + 一键批准」。
//
// 用法（开关形式，不受 shell 引号规则影响）：
//   node scripts/scope-amend.mjs --list
//   node scripts/scope-amend.mjs --grant req_xxx --approver <父会话 id>
//   node scripts/scope-amend.mjs --deny  req_xxx --approver <父会话 id> --reason "不该读"
//   node scripts/scope-amend.mjs --dispatch dsp_xxx --add src/app/ --approver <父会话 id>
//   node scripts/scope-amend.mjs --dispatch dsp_xxx --add src/app.ts --read --approver <父会话 id>
//   node scripts/scope-amend.mjs --tiers
//   node scripts/scope-amend.mjs --tier full  --agent sa-gate-integrity --approver <父会话 id>
//   node scripts/scope-amend.mjs --tier scoped --agent sa-gate-integrity --approver <父会话 id>
//
// <父会话 id> = 该派工记录里的 parent_session_id（父会话自己的 session id）。
// --list 的待审清单里会直接给出这个值，照抄即可。
//
// 硬规矩：
//   1. 读请求只授读（ro: 条目），写请求才给可写条目 —— 批准读不等于批准写。
//   2. 批准必须落在**仍在飞**的派工上；派工已结束则拒绝扩权（事后再补权限没有意义）。
//   3. 每次批准都记录批准人与时间 —— 扩权必须有据可查。
//   4. 提权（tier）是**管理员动作**：写在项目级 .superagent/roster.json 里，
//      并留痕到 .superagent/changes.log。
//   5. 批准人必须是**真实的父会话 id**：--grant 要等于该派工的 parent_session_id，
//      --tier 必须是台账里存在过的父会话 id。这是**纵深防御**，不是主防线 ——
//      worker 的派工原文里就带着 PARENT SESSION:，所以它挡不住蓄意自提权。
//      主防线在 guard.mjs：权威面脚本（提权 / 批准 / 写履历 / 写错题本 / 登记成员）
//      是**父会话专属**，worker 执行即被拒。
//   6. 诚实边界（契约 S13.5）：hook 是护栏不是沙箱 —— worker 若能执行一段落盘的脚本，
//      脚本内部的写入不受判定约束。机制能做的是：把权威面脚本列为父会话专属（降低误用）、
//      把提权与批准记进审计留痕；真正的防线是运行时权限 + 审计留痕 + 验收时复核
//      （references/review.md 的扩权复核清单）。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  readLedger, updateLedger, grantScopeRequest, denyScopeRequest, READONLY_PREFIX,
  detectReadonlyUpgrades,
  readRoster, projectRoot, TIER_FULL, TIER_SCOPED, isPrivateMemoryPath
} from './lib.mjs';

const argv = process.argv.slice(2);

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + '\n');
  process.exit(1);
}

const FLAGS_WITH_VALUE = ['grant', 'deny', 'dispatch', 'add', 'approver', 'reason', 'data-dir', 'tier', 'agent', 'roster'];
const parsed = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { rest.push(a); continue; }
  const name = a.slice(2);
  if (name === 'read' || name === 'write' || name === 'list' || name === 'tiers') { parsed[name] = true; continue; }
  if (!FLAGS_WITH_VALUE.includes(name)) {
    fail('未知参数：' + a + '（可用：--list --grant --deny --dispatch --add --read --write --approver --reason --data-dir）');
  }
  const v = argv[i + 1];
  if (v === undefined) fail('--' + name + ' 缺值');
  parsed[name] = v;
  i++;
}

function resolveDataDir() {
  if (parsed['data-dir']) return { dir: parsed['data-dir'], from: '--data-dir' };
  if (process.env.PLUGIN_DATA) return { dir: process.env.PLUGIN_DATA, from: 'PLUGIN_DATA' };
  if (process.env.MINIMAX_PLUGIN_DATA) return { dir: process.env.MINIMAX_PLUGIN_DATA, from: 'MINIMAX_PLUGIN_DATA' };
  const fallback = path.join(os.homedir(), '.minimax', 'v2', 'plugin-data', 'hooks', 'super-agent-router');
  if (fs.existsSync(fallback)) return { dir: fallback, from: 'runtime-default' };
  return { dir: '', from: '' };
}

const resolved = resolveDataDir();
if (!resolved.dir) {
  fail('找不到派工台账目录：请设置 PLUGIN_DATA（或用 --data-dir 指定）');
}
process.env.PLUGIN_DATA = resolved.dir;

const ledger = readLedger();
if (!ledger.readable && ledger.error) fail('派工台账读不出来：' + ledger.error);

const requests = Array.isArray(ledger.scope_requests) ? ledger.scope_requests : [];

// ── 列表 ───────────────────────────────────────────────
//
// 待审清单里直接给出**父会话 id**：批准时 --approver 要的就是它，
// 父会话照抄即可，不必去猜自己的 session id。
function parentOf(dispatchId) {
  const d = (ledger.dispatches || []).find((x) => x.dispatch_id && x.dispatch_id === dispatchId);
  return d ? String(d.parent_session_id || '') : '';
}
if (parsed.list) {
  const pending = requests.filter((r) => r.state === 'pending');
  const out = {
    ok: true,
    data_dir: resolved.dir,
    pending_count: pending.length,
    pending: pending.map((r) => ({
      request_id: r.request_id,
      dispatch_id: r.dispatch_id,
      parent_session_id: parentOf(r.dispatch_id),
      agent: r.agent,
      tool: r.tool,
      mode: r.mode,
      tier: r.tier || '',
      targets: r.targets,
      hits: r.hits || 1,
      at: r.at
    })),
    recent: requests.filter((r) => r.state !== 'pending').slice(-10)
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

// ── 批准 / 拒绝一条待审请求 ──────────────────────────────
if (parsed.grant || parsed.deny) {
  const id = String(parsed.grant || parsed.deny || '');
  const approver = String(parsed.approver || '');
  if (!approver) {
    fail('--grant / --deny 必须带 --approver <父会话 id>（该派工的 parent_session_id）');
  }
  // 批准人校验（**纵深防御**，不是主防线）。
  //
  // 以前 --approver 只是命令行上的一个字符串，谁执行都算「管理员」——
  // 于是 worker 能给自己提权、能自批准自己的越界请求（F1）。
  // 这里只认**该派工的父会话 id**：自称是管理员的字符串不算数。
  //
  // 诚实边界：worker 的派工原文里就带着 PARENT SESSION: ——
  // 所以这一层挡不住**蓄意**自提权，它挡的是「随手写个名字就过」与台账里凭空出现的批准人。
  // 主防线在 guard.mjs：权威面脚本是父会话专属，worker 执行即被拒。
  //
  // --deny 是收紧方向，判不到派工时放行（清理动作不该被卡住）。
  const reqRow = (ledger.scope_requests || []).find((r) => r.request_id === id);
  const dRow = reqRow
    ? (ledger.dispatches || []).find((d) => d.dispatch_id && d.dispatch_id === reqRow.dispatch_id)
    : null;
  if (dRow) {
    const parent = String(dRow.parent_session_id || '');
    if (approver !== parent) {
      fail('批准人 ' + approver + ' 不是该派工的父会话（' + parent + '）—— ' +
        '批准必须由派工这一侧的父会话执行（--approver ' + parent + '）');
    }
  }
  if (parsed.grant) {
    // 私有记忆目录的扩权 = 造一条**永远不生效**的死条目 → 当场拒（D-58）。
    // 范围层对私有记忆路径一律不授予（契约 S13.4），批了也不会放行；
    // 与其让父会话以为「批了就有效」，不如当场说清，并指出契约通道。
    const reqTargets = (reqRow && Array.isArray(reqRow.targets)) ? reqRow.targets : [];
    const hitMem = reqTargets.map((t) => String(t || '')).find((t) => isPrivateMemoryPath(t));
    if (hitMem) {
      fail('该目标在成员的私有记忆目录下（' + hitMem + '）—— 扩权**不会生效**：' +
        '范围层对私有记忆路径一律不授予（契约 S13.4），只有「成员自己那份」的精确文件通道例外。' +
        '需要它的内容，请让 Router 转写进 brief（契约通道），不要走扩权。');
    }
    // 批准写回走统一写入口（D-77）：整个「读-改-写」串行化 ——
    // 否则与并发批准/并发派工相撞时，后写的会把对方的改动整条覆盖掉（静默丢记录）。
    const gres = updateLedger((cur) => {
      const rr = grantScopeRequest(cur, id, approver);
      if (!rr.ok) return { deny: rr.error };
      return { result: rr };
    });
    if (!gres.ok) fail('批准结果写回台账失败 —— 扩权可能没有生效（' + gres.code + '）：' + gres.error);
    if (gres.deny) fail(gres.deny);
    const r = gres.result;
    // D-75：这次批准可能把某条路径从**只读条目**升级成了**可写条目**。
    // 口径（父会话已定）：升级能力**保留**（管理员批准即授权升级），
    // 但升级必须**显式** —— 回执与变更账都要写明「哪个路径从哪个只读条目升级而来」。
    // 以前这里只写「+ <条目名>」，只读被升级成可写在回执与账上**都看不出来**。
    const upgrades = Array.isArray(r.upgraded_from_readonly) ? r.upgraded_from_readonly : [];
    const upgradePaths = Array.isArray(r.upgraded_paths) ? r.upgraded_paths : [];
    const duplicates = Array.isArray(r.duplicate_paths) ? r.duplicate_paths : [];
    const upgradeNotice = upgrades.length
      ? '本次批准把 ' + upgradePaths.join(', ') +
        ' 从只读条目升级为可写（来源只读条目：' +
        upgrades.map((u) => u.from_entry).join(', ') + '）'
      : '';
    // 审计留痕：批准与提权同口径进 .superagent/changes.log（批准人与时间）。
    // 台账里也有 approved_by / approved_at，但那是**台账**，不是项目的变更账 ——
    // 验收时查「谁批的」查的是 changes.log。
    const logged = appendChangeLog(
      new Date().toISOString() + ' | scope | ' + (r.dispatch_id || '') +
      ' | grant ' + id + ' | by ' + approver +
      ' | + ' + (Array.isArray(r.added) ? r.added.join(', ') : '') +
      (upgrades.length
        ? ' | upgrade readonly -> writable: ' +
          upgrades.map((u) => u.path + ' (from: ' + u.from_entry + ')').join('; ')
        : '') +
      (duplicates.length ? ' | already-present: ' + duplicates.join(', ') : ''));
    process.stdout.write(JSON.stringify({
      ok: true,
      granted: id,
      dispatch_id: r.dispatch_id,
      added: r.added,
      approved_by: approver,
      // 新增字段：只读 → 可写的升级显式化（D-75）。既有字段语义不变。
      upgraded_paths: upgradePaths,
      upgraded_from_readonly: upgrades,
      upgrade_notice: upgradeNotice,
      duplicate_paths: duplicates,
      // 变更账写成功没有 —— 回执必须说出来（追加写失败会被静默吞掉，
      // 于是「升级已记入变更账」这句话就变成了一句没人验证过的断言）。
      audit_logged: !!logged,
      // 既有字段的语义**一个字都不改**（口径：回执是 JSON 输出，加字段，不改既有字段语义）。
      // 升级信息全部走新增字段（upgrade_notice / upgraded_paths / upgraded_from_readonly），
      // 不去改写 note —— 改写既有字段会让「字段语义不变」这条口径无法被机械核对。
      note: '读请求只授读（ro: 条目）；派工记录与子会话绑定已同步，worker 下一次访问即生效'
    }, null, 2) + '\n');
    process.exit(0);
  }
  const dres = updateLedger((cur) => {
    const rr = denyScopeRequest(cur, id, approver, parsed.reason || '');
    if (!rr.ok) return { deny: rr.error };
    return { result: rr };
  });
  if (!dres.ok) fail('拒绝结果写回台账失败（' + dres.code + '）：' + dres.error);
  if (dres.deny) fail(dres.deny);
  appendChangeLog(
    new Date().toISOString() + ' | scope | ' + (reqRow && reqRow.dispatch_id ? reqRow.dispatch_id : '') +
    ' | deny ' + id + ' | by ' + approver +
    ' | ' + (parsed.reason || ''));
  process.stdout.write(JSON.stringify({ ok: true, denied: id, approved_by: approver, reason: parsed.reason || '' }, null, 2) + '\n');
  process.exit(0);
}


// ── 权限等级（tier）────────────────────────────────
//
// 两个等级：
//   scoped（默认）—— 逐路径白名单，白名单外一律拦。
//   full          —— 项目工作区内自由读写，不必逐路径枚举。
//
// **每个成员都平等**：任何成员都可以被管理员提权到 full，不是某些成员特权。
// 但提权动作本身在管理员手里 —— 让被约束者自己决定边界 = 授权模型被拆掉。
//
// tier 写在项目级 roster.json 而不是派工台账：台账是半持久的
//（TTL 2 小时、截断 200 条），权限等级必须活过台账的生命周期。

function rosterPath() {
  if (parsed.roster) return String(parsed.roster);
  return readRoster(projectRoot()).path || '';
}

function appendChangeLog(line) {
  try {
    const p = path.join(projectRoot(), '.superagent', 'changes.log');
    fs.appendFileSync(p, line + '\n', 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

if (parsed.tiers) {
  const r = readRoster(projectRoot());
  if (!r.ok) fail('读不到专项名录：' + r.error);
  const rows = (r.members || []).map((m) => ({
    name: String(m.name || ''),
    kind: String(m.kind || ''),
    tier: String(m.tier || TIER_SCOPED),
    granted_by: String(m.tier_granted_by || ''),
    granted_at: String(m.tier_granted_at || '')
  }));
  process.stdout.write(JSON.stringify({
    ok: true, roster: r.path, updated: r.updated, count: rows.length, tiers: rows
  }, null, 2) + '\n');
  process.exit(0);
}

if (parsed.tier) {
  const tier = String(parsed.tier).trim().toLowerCase();
  if (tier !== TIER_FULL && tier !== TIER_SCOPED) {
    fail('--tier 只能是 ' + TIER_FULL + ' 或 ' + TIER_SCOPED + '（收到：' + parsed.tier + '）');
  }
  const agent = String(parsed.agent || '').trim();
  if (!agent) fail('--tier 必须配 --agent <成员名>');
  const approver = String(parsed.approver || '');
  if (!approver) fail('--tier 必须带 --approver <父会话 id>');
  // 批准人必须是台账里**存在过的父会话 id**（纵深防御，不是主防线）。
  // 以前这里是任意字符串 —— 谁执行都算管理员，worker 能给自己提权（F1）。
  const knownParents = Array.from(new Set(
    (ledger.dispatches || []).map((d) => String(d.parent_session_id || '')).filter(Boolean)));
  if (knownParents.indexOf(approver) === -1) {
    fail('批准人 ' + approver + ' 不是台账里存在过的父会话 id' +
      (knownParents.length
        ? '（已知：' + knownParents.slice(0, 5).join(', ') + '）'
        : '（台账里还没有任何派工记录）') +
      ' —— 提权是管理员动作，批准人必须是真实的父会话');
  }
  const rp = rosterPath();
  const r = readRoster(projectRoot());
  if (!r.ok) fail('读不到专项名录：' + r.error);
  if (!r.members.length) fail('专项名录里没有成员（' + rp + '）—— 先登记成员再谈提权');
  const m = r.members.find((x) => String((x && x.name) || '') === agent);
  if (!m) {
    fail('专项名录里没有成员 ' + agent + '（名录：' + r.members.map((x) => x.name).join(', ') +
      '）。先登记再提权 —— 提权是管理员对**已登记成员**的动作。');
  }
  const before = String(m.tier || TIER_SCOPED);
  if (before === tier) {
    process.stdout.write(JSON.stringify({ ok: true, agent, tier, changed: false,
      note: '等级未变（本来就是 ' + tier + '）' }, null, 2) + '\n');
    process.exit(0);
  }
  m.tier = tier;
  m.tier_granted_by = approver;
  m.tier_granted_at = new Date().toISOString();
  r.doc.updated = new Date().toISOString().slice(0, 10);
  try {
    fs.writeFileSync(rp, JSON.stringify(r.doc, null, 2) + '\n', 'utf8');
  } catch (e) {
    fail('写回专项名录失败：' + String((e && e.message) || e));
  }
  const logged = appendChangeLog(
    new Date().toISOString() + ' | tier | ' + agent + ' | ' + before + ' -> ' + tier + ' | by ' + approver);
  process.stdout.write(JSON.stringify({
    ok: true, agent, tier, changed: true, before, roster: rp,
    approved_by: approver, audit_logged: logged,
    note: tier === TIER_FULL
      ? '该成员现在在项目工作区内自由读写；工作区外的路径仍会被拦并自动记账待审；账号级不可逆动作照旧硬拦。'
      : '已收回该成员的全权等级，回到逐路径白名单。'
  }, null, 2) + '\n');
  process.exit(0);
}

// ── 直接给某个派工加 scope 条目 ──────────────────────────
if (parsed.dispatch && parsed.add) {
  const d = (ledger.dispatches || []).find((x) => x.dispatch_id === String(parsed.dispatch));
  if (!d) fail('台账里找不到派工 ' + parsed.dispatch);
  if ((d.state || 'active') !== 'active') {
    fail('派工 ' + parsed.dispatch + ' 已结束（state=' + d.state + '）—— 事后再补权限没有意义，请重新派工');
  }
  const approver = String(parsed.approver || '');
  if (!approver) fail('--dispatch --add 必须带 --approver <父会话 id>');
  // 批准人校验（同 --grant）：必须是该派工的父会话。
  // 这一条与「批准请求」是同一类动作 —— 直接加条目同样是在扩权，
  // 以前 --approver 是任意字符串，worker 能给自己加白名单条目（F1）。
  const parent = String(d.parent_session_id || '');
  if (approver !== parent) {
    fail('批准人 ' + approver + ' 不是该派工的父会话（' + parent + '）—— ' +
      '扩权必须由派工这一侧的父会话执行（--approver ' + parent + '）');
  }
  const entry = parsed.read ? (READONLY_PREFIX + ' ' + parsed.add) : String(parsed.add);
  // 同上：私有记忆目录的条目不造死条目（D-58）
  if (isPrivateMemoryPath(String(parsed.add))) {
    fail('该路径在成员的私有记忆目录下（' + String(parsed.add) + '）—— 扩权**不会生效**：' +
      '范围层对私有记忆路径一律不授予（契约 S13.4），只有「成员自己那份」的精确文件通道例外。' +
      '需要它的内容，请让 Router 转写进 brief（契约通道），不要走扩权。');
  }
  // 升级检测要的是**同一份 scope 的前后快照** —— 升级是「差」，只看一份是看不出来的。
  // 扩权写回走统一写入口（D-77）：整个「读-改-写」串行化 ——
  // 锁外只做**校验**（派工在不在、是不是还在飞、批准人对不对），
  // 真正的改动在锁内对着**最新**台账做，否则会覆盖并发写方的改动（静默丢记录）。
  const ares = updateLedger((cur) => {
    const dd = (cur.dispatches || []).find((x) => x.dispatch_id === String(parsed.dispatch));
    if (!dd) return { deny: '台账里找不到派工 ' + parsed.dispatch };
    if ((dd.state || 'active') !== 'active') {
      return { deny: '派工 ' + parsed.dispatch + ' 已结束（state=' + dd.state + '）—— 事后再补权限没有意义，请重新派工' };
    }
    // 升级检测要的是**同一份 scope 的前后快照** —— 升级是「差」，只看一份是看不出来的。
    const scopeBefore2 = Array.isArray(dd.scope) ? dd.scope.slice() : [];
    if (!Array.isArray(dd.scope)) dd.scope = [];
    if (!Array.isArray(dd.scope_amended)) dd.scope_amended = [];
    const added2 = [];
    const duplicate2 = [];
    if (!dd.scope.includes(entry)) { dd.scope.push(entry); added2.push(entry); }
    else duplicate2.push(String(parsed.add));
    if (!dd.scope_amended.includes(entry)) dd.scope_amended.push(entry);
    // D-75：这条「直接加条目」的路与 --grant 是同一类动作 ——
    // 加一条可写条目、而 scope 里已经有覆盖同一路径的只读条目 ⇒ 只读被升级成可写。
    // 口径同 --grant：**不堵死升级、但不许静默**（回执与变更账都要写明升级了什么）。
    const upgrades2 = detectReadonlyUpgrades(scopeBefore2, dd.scope, [String(parsed.add)]);
    for (const b of (cur.bindings || [])) {
      if (b.dispatch_id && b.dispatch_id === dd.dispatch_id) {
        if (!Array.isArray(b.scope)) b.scope = [];
        if (!b.scope.includes(entry)) b.scope.push(entry);
      }
    }
    return { result: { dispatch_id: dd.dispatch_id, added: added2, duplicate: duplicate2, upgrades: upgrades2 } };
  });
  if (!ares.ok) fail('扩权写回台账失败（' + ares.code + '）：' + ares.error);
  if (ares.deny) fail(ares.deny);
  const added = ares.result.added;
  const duplicate = ares.result.duplicate;
  const upgrades = ares.result.upgrades;
  const upgradeNotice = upgrades.length
    ? '本次加条目把 ' + upgrades.map((u) => u.path).join(', ') +
      ' 从只读条目升级为可写（来源只读条目：' +
      upgrades.map((u) => u.from_entry).join(', ') + '）'
    : '';
  const logged = appendChangeLog(
    new Date().toISOString() + ' | scope | ' + d.dispatch_id +
    ' | add-entry | by ' + approver + ' | + ' + added.join(', ') +
    (upgrades.length
      ? ' | upgrade readonly -> writable: ' +
        upgrades.map((u) => u.path + ' (from: ' + u.from_entry + ')').join('; ')
      : '') +
    (duplicate.length ? ' | already-present: ' + duplicate.join(', ') : ''));
  process.stdout.write(JSON.stringify({
    ok: true,
    dispatch_id: d.dispatch_id,
    added,
    approved_by: approver,
    // 新增字段：只读 → 可写的升级显式化（D-75）。既有字段语义不变。
    upgraded_paths: upgrades.map((u) => u.path),
    upgraded_from_readonly: upgrades,
    upgrade_notice: upgradeNotice,
    duplicate_paths: duplicate,
    // 同上：变更账写成功没有，回执必须说出来。
    audit_logged: !!logged,
    scope: d.scope
  }, null, 2) + '\n');
  process.exit(0);
}

fail('没指定动作。可用：--list（看待审清单）/ --grant <id>（批准）/ --deny <id>（拒绝）/ --dispatch <id> --add <path>（直接加条目）');
