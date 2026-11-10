// 派工名额显式释放入口（契约 S6.2 第 5 条 / 缺陷 D-28）
//
// 为什么需要这个入口：
//   名额回收原本只有三条路 —— 正常结束（SubagentStop）、TTL 兜底（2 小时）、读时自愈。
//   没有一条能覆盖「父会话主动取消派工」：取消不触发 SubagentStop，
//   TTL 兜底要等满 2 小时，期间这条记录一直占着并发名额（MAX_ACTIVE_DISPATCHES = 6）。
//   台账条目里**没有子会话 id**，所以「自动探测子会话是否还活着」不可行；
//   能自动拿到的只有终止事件，而取消场景下没有终止事件。
//   → 结论：取消场景必须由**发起方显式释放**，入口由本脚本提供。
//
// 用法（推荐开关形式 —— 不受 shell 引号规则影响）：
//   node scripts/release-slot.mjs --dispatch dsp_xxx --reason parent_cancelled
//   node scripts/release-slot.mjs --parent mvs_xxx
//   node scripts/release-slot.mjs --data-dir <台账目录> --dispatch dsp_xxx
//
// 用法（JSON 形式，兼容旧调用）：
//   node scripts/release-slot.mjs '{"dispatch_id":"dsp_xxx","reason":"parent_cancelled"}'
//
// 为什么给开关形式（独立验收 F2）：
//   PowerShell 的原生参数解析会吃掉 JSON 里的双引号 ——
//   node release-slot.mjs '{"dispatch_id":"dsp_x"}' 在 PS 里实际收到
//   {"dispatch_id:dsp_x"}（非法 JSON）。开关形式不含引号，跨 shell 一致。
//
// 硬规矩：
//   1. 只把 state=active 的记录翻成 aborted；done / aborted 的记录一个字节都不动。
//   2. 台账读不出来 = 不释放。释放入口的作用是让名额归位，不是绕过「取不到就拒绝」。
//   3. 目标不存在或已在非 active 状态时必须报错，不许静默「成功」——
//      否则调用方以为名额放掉了，实际还在占着。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { readLedger, updateLedger, markDispatchAborted } from './lib.mjs';

const argv = process.argv.slice(2);

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + '\n');
  process.exit(1);
}

// ── 参数解析 ───────────────────────────────────────────
// 开关一律「一个 token 一个值」，值本身可以是任意字符串（不需要引号）。
const FLAGS_WITH_VALUE = ['data-dir', 'dispatch', 'parent', 'agent', 'reason'];
const parsed = { json: '', dataDir: '', dispatch: '', parent: '', agent: '', reason: '', all: false };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { rest.push(a); continue; }
  const name = a.slice(2);
  if (name === 'all') { parsed.all = true; continue; }
  if (!FLAGS_WITH_VALUE.includes(name)) {
    fail('未知参数：' + a + '（可用：--dispatch --parent --agent --reason --data-dir --all）');
  }
  const v = argv[i + 1];
  if (v === undefined) fail('--' + name + ' 缺值');
  parsed[name === 'data-dir' ? 'dataDir' : name] = v;
  i++;
}

let payload = {};
if (rest.length) {
  try {
    payload = JSON.parse(rest[0]);
  } catch (e) {
    fail('payload 不是合法 JSON：' + (e && e.message ? e.message : 'parse error') +
      '。若在 PowerShell 里被引号处理搞坏了，改用开关形式：--dispatch <id>');
  }
}

// ── 数据目录解析 ───────────────────────────────────────
// 顺序：--data-dir > PLUGIN_DATA > MINIMAX_PLUGIN_DATA > 运行时默认布局。
// 猜出来的路径必须真的存在，不存在就报错 —— 宁可拒绝，不往错的目录写。
function resolveDataDir() {
  if (parsed.dataDir) return { dir: parsed.dataDir, from: '--data-dir' };
  if (process.env.PLUGIN_DATA) return { dir: process.env.PLUGIN_DATA, from: 'PLUGIN_DATA' };
  if (process.env.MINIMAX_PLUGIN_DATA) return { dir: process.env.MINIMAX_PLUGIN_DATA, from: 'MINIMAX_PLUGIN_DATA' };
  const fallback = path.join(os.homedir(), '.minimax', 'v2', 'plugin-data', 'hooks', 'super-agent-router');
  if (fs.existsSync(fallback)) return { dir: fallback, from: 'runtime-default' };
  return { dir: '', from: '' };
}

const resolved = resolveDataDir();
if (!resolved.dir) {
  fail('找不到派工台账目录：请设置 PLUGIN_DATA（或用 --data-dir 指定），' +
    '例如 $env:PLUGIN_DATA=\'' + path.join(os.homedir(), '.minimax', 'v2', 'plugin-data', 'hooks', 'super-agent-router') + '\'');
}
// lib.mjs 的 dataDir() 只认这两个环境变量 —— 把解析结果写回去，台账路径才一致。
process.env.PLUGIN_DATA = resolved.dir;

const ledger = readLedger();
if (!ledger.readable && ledger.error) {
  fail('派工台账读不出来：' + ledger.error);
}

const reason = String(parsed.reason || payload.reason || 'parent_cancelled');
const dispatchId = String(parsed.dispatch || payload.dispatch_id || '').trim();
const parentSessionId = String(parsed.parent || payload.parent_session_id || '').trim();
const agent = String(parsed.agent || payload.agent || '').trim();

if (!dispatchId && !parentSessionId && !parsed.all) {
  fail('没指定释放目标：给 --dispatch <id>（单条）或 --parent <session_id>（该父会话的全部在飞派工）。');
}

// 释放走统一写入口（D-77）：「读台账 → 找到目标 → 标记 aborted → 写回」必须整体串行化 ——
// 否则释放与并发派工相撞时，后写的会把刚释放的结果覆盖掉（名额状态失步）。
const relRes = updateLedger((cur) => {
  const activeBefore = (cur.dispatches || []).filter((d) => (d.state || 'active') === 'active');
  const targets = (cur.dispatches || []).filter((d) => {
    if ((d.state || 'active') !== 'active') return false;
    if (dispatchId && String(d.dispatch_id || '') !== dispatchId) return false;
    if (parentSessionId && String(d.parent_session_id || '') !== parentSessionId) return false;
    if (agent && String(d.agent || '') !== agent) return false;
    return true;
  });

  const skipped = [];
  for (const d of (cur.dispatches || [])) {
    if ((d.state || 'active') === 'active') continue;
    if (dispatchId && String(d.dispatch_id || '') === dispatchId) {
      skipped.push({ dispatch_id: d.dispatch_id, state: d.state, why: '已非 active，不重复释放' });
    }
  }

  const released = [];
  for (const d of targets) {
    if (markDispatchAborted(cur, d.dispatch_id, reason)) {
      released.push({ dispatch_id: d.dispatch_id, agent: d.agent, parent_session_id: d.parent_session_id });
    }
  }
  return { result: { released, skipped, activeBefore: activeBefore.length } };
});
if (!relRes.ok) {
  fail('释放结果写回台账失败 —— 名额可能仍被占着（' + resolved.dir + '）：' + (relRes.error || '') +
    '（' + relRes.code + '）');
}
const released = relRes.result.released;
const skipped = relRes.result.skipped;
const activeBeforeCount = relRes.result.activeBefore;

if (!released.length) {
  // 没释放到任何一条 —— 必须让调用方看见，不许静默成功。
  const notFound = dispatchId
    ? !(ledger.dispatches || []).some((d) => String(d.dispatch_id || '') === dispatchId)
    : false;
  process.stdout.write(JSON.stringify({
    ok: false,
    error: notFound
      ? '台账里没有 dispatch_id=' + dispatchId + ' 这条记录 —— 释放失败，名额可能仍被占着'
      : '没有匹配到仍在飞的派工 —— 可能已经结束、已被释放，或过滤条件太窄',
    released: [],
    skipped,
    active_before: activeBeforeCount,
    active_after: activeBeforeCount,
    data_dir: resolved.dir
  }, null, 2) + '\n');
  process.exit(1);
}

const activeAfter = (relRes.ledger.dispatches || []).filter((d) => (d.state || 'active') === 'active');
process.stdout.write(JSON.stringify({
  ok: true,
  released,
  skipped,
  active_before: activeBeforeCount,
  active_after: activeAfter.length,
  reason,
  data_dir: resolved.dir,
  data_dir_from: resolved.from
}, null, 2) + '\n');
process.exit(0);
