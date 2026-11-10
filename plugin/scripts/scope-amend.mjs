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
//   node scripts/scope-amend.mjs --grant req_xxx --approver router
//   node scripts/scope-amend.mjs --deny  req_xxx --approver router --reason "不该读"
//   node scripts/scope-amend.mjs --dispatch dsp_xxx --add src/app/ --approver router
//   node scripts/scope-amend.mjs --dispatch dsp_xxx --add src/app.ts --read --approver router
//   node scripts/scope-amend.mjs --tiers
//   node scripts/scope-amend.mjs --tier full  --agent sa-gate-integrity --approver router
//   node scripts/scope-amend.mjs --tier scoped --agent sa-gate-integrity --approver router
//
// 硬规矩：
//   1. 读请求只授读（ro: 条目），写请求才给可写条目 —— 批准读不等于批准写。
//   2. 批准必须落在**仍在飞**的派工上；派工已结束则拒绝扩权（事后再补权限没有意义）。
//   3. 每次批准都记录批准人与时间 —— 扩权必须有据可查。
//   4. 提权（tier）是**管理员动作**：写在项目级 .superagent/roster.json 里，
//      并留痕到 .superagent/changes.log。worker 无权改自己的等级
//      （派工闸门 1c 封掉了 .superagent/ 的写授权）。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  readLedger, writeLedger, grantScopeRequest, denyScopeRequest, READONLY_PREFIX,
  readRoster, projectRoot, TIER_FULL, TIER_SCOPED
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
if (parsed.list) {
  const pending = requests.filter((r) => r.state === 'pending');
  const out = {
    ok: true,
    data_dir: resolved.dir,
    pending_count: pending.length,
    pending: pending.map((r) => ({
      request_id: r.request_id,
      dispatch_id: r.dispatch_id,
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
  const approver = String(parsed.approver || 'router');
  if (parsed.grant) {
    const r = grantScopeRequest(ledger, id, approver);
    if (!r.ok) fail(r.error);
    const okWrite = writeLedger(ledger);
    if (!okWrite) fail('批准结果写回台账失败 —— 扩权可能没有生效');
    process.stdout.write(JSON.stringify({
      ok: true,
      granted: id,
      dispatch_id: r.dispatch_id,
      added: r.added,
      approved_by: approver,
      note: '读请求只授读（ro: 条目）；派工记录与子会话绑定已同步，worker 下一次访问即生效'
    }, null, 2) + '\n');
    process.exit(0);
  }
  const r = denyScopeRequest(ledger, id, approver, parsed.reason || '');
  if (!r.ok) fail(r.error);
  if (!writeLedger(ledger)) fail('拒绝结果写回台账失败');
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
  const approver = String(parsed.approver || 'router');
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
  const approver = String(parsed.approver || 'router');
  const entry = parsed.read ? (READONLY_PREFIX + ' ' + parsed.add) : String(parsed.add);
  if (!Array.isArray(d.scope)) d.scope = [];
  if (!Array.isArray(d.scope_amended)) d.scope_amended = [];
  const added = [];
  if (!d.scope.includes(entry)) { d.scope.push(entry); added.push(entry); }
  if (!d.scope_amended.includes(entry)) d.scope_amended.push(entry);
  for (const b of (ledger.bindings || [])) {
    if (b.dispatch_id && b.dispatch_id === d.dispatch_id) {
      if (!Array.isArray(b.scope)) b.scope = [];
      if (!b.scope.includes(entry)) b.scope.push(entry);
    }
  }
  if (!writeLedger(ledger)) fail('扩权写回台账失败');
  process.stdout.write(JSON.stringify({
    ok: true,
    dispatch_id: d.dispatch_id,
    added,
    approved_by: approver,
    scope: d.scope
  }, null, 2) + '\n');
  process.exit(0);
}

fail('没指定动作。可用：--list（看待审清单）/ --grant <id>（批准）/ --deny <id>（拒绝）/ --dispatch <id> --add <path>（直接加条目）');
