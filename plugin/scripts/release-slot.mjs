// 派工名额显式释放入口（契约 S6.2 第 5 条 / 缺陷 D-28）
//
// 为什么需要这个入口：
//   名额回收原本只有三条路 —— 正常结束（SubagentStop）、TTL 兜底（2 小时）、读时自愈。
//   前三条里没有一条能覆盖「父会话主动取消派工」：
//     - 取消不会触发 SubagentStop；
//     - TTL 是 2 小时，期间这条记录一直占着并发名额；
//     - 读时自愈同样以 TTL 为准。
//   实测（本轮）：派工被 task_stop 取消后，台账 state 长时间停在 active，
//   父会话只能靠一次性脚本手工改台账才能把名额拿回来 —— 机制没有自带入口，就是纪律落不了地。
//
//   台账条目里**没有子会话 id**，所以「自动探测子会话是否还活着」这条路走不通；
//   能自动拿到的信号只有终止事件，而取消场景下没有终止事件。
//   → 结论：取消场景必须由**发起方显式释放**，入口由本脚本提供。
//
// 用法：node scripts/release-slot.mjs <payloadJson>
//   payload = { dispatch_id?, parent_session_id?, agent?, reason? }
//     dispatch_id      只释放这一条
//     parent_session_id 释放该父会话下所有仍在飞的派工
//     agent            可选，再按成员名收窄
//     reason           写进 end_reason，默认 parent_cancelled
//
// 硬规矩：
//   1. 只把 state=active 的记录翻成 aborted；done / aborted 的记录一个字节都不动。
//   2. 台账读不出来 = 不释放。释放入口的作用是让名额归位，不是绕过「取不到就拒绝」。
//   3. 目标不存在或已在非 active 状态时必须报错，不许静默「成功」——
//      否则调用方以为名额放掉了，实际还在占着。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { readLedger, writeLedger, markDispatchAborted } from './lib.mjs';

const argv = process.argv.slice(2);

// ── 数据目录解析 ───────────────────────────────────────
// 顺序：--data-dir > PLUGIN_DATA > MINIMAX_PLUGIN_DATA > 运行时默认布局。
// 猜出来的路径必须真的存在，不存在就报错 —— 宁可拒绝，不往错的目录写。
function resolveDataDir() {
  const i = argv.indexOf('--data-dir');
  if (i >= 0 && argv[i + 1]) return { dir: argv[i + 1], from: '--data-dir' };
  if (process.env.PLUGIN_DATA) return { dir: process.env.PLUGIN_DATA, from: 'PLUGIN_DATA' };
  if (process.env.MINIMAX_PLUGIN_DATA) return { dir: process.env.MINIMAX_PLUGIN_DATA, from: 'MINIMAX_PLUGIN_DATA' };
  const fallback = path.join(os.homedir(), '.minimax', 'v2', 'plugin-data', 'hooks', 'super-agent-router');
  if (fs.existsSync(fallback)) return { dir: fallback, from: 'runtime-default' };
  return { dir: '', from: '' };
}

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + '\n');
  process.exit(1);
}

let payload = {};
if (argv[0] && !argv[0].startsWith('--')) {
  try {
    payload = JSON.parse(argv[0]);
  } catch (e) {
    fail('payload 不是合法 JSON：' + (e && e.message ? e.message : 'parse error'));
  }
} else {
  // 没给 payload 时，退化成「只按 --data-dir 释放全部在飞」——
  // 但这个用法太宽，只允许显式加 --all。
  if (!argv.includes('--all')) {
    fail('缺 payload。用法：node scripts/release-slot.mjs 传入一段 JSON，' +
      '字段取 dispatch_id（单条）或 parent_session_id（该父会话全部在飞派工）。');
  }
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

const reason = String(payload.reason || 'parent_cancelled');
const dispatchId = String(payload.dispatch_id || '').trim();
const parentSessionId = String(payload.parent_session_id || '').trim();
const agent = String(payload.agent || '').trim();

if (!dispatchId && !parentSessionId && !argv.includes('--all')) {
  fail('没指定释放目标：给 dispatch_id（单条）或 parent_session_id（该父会话的全部在飞派工）。');
}

const activeBefore = (ledger.dispatches || []).filter((d) => (d.state || 'active') === 'active');
const targets = (ledger.dispatches || []).filter((d) => {
  if ((d.state || 'active') !== 'active') return false;
  if (dispatchId && String(d.dispatch_id || '') !== dispatchId) return false;
  if (parentSessionId && String(d.parent_session_id || '') !== parentSessionId) return false;
  if (agent && String(d.agent || '') !== agent) return false;
  return true;
});

const skipped = [];
for (const d of (ledger.dispatches || [])) {
  if ((d.state || 'active') === 'active') continue;
  if (dispatchId && String(d.dispatch_id || '') === dispatchId) {
    skipped.push({ dispatch_id: d.dispatch_id, state: d.state, why: '已非 active，不重复释放' });
  }
}

const released = [];
for (const d of targets) {
  if (markDispatchAborted(ledger, d.dispatch_id, reason)) {
    released.push({ dispatch_id: d.dispatch_id, agent: d.agent, parent_session_id: d.parent_session_id });
  }
}

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
    active_before: activeBefore.length,
    active_after: activeBefore.length,
    data_dir: resolved.dir
  }, null, 2) + '\n');
  process.exit(1);
}

const okWrite = writeLedger(ledger);
if (!okWrite) {
  fail('释放结果写回台账失败 —— 名额可能仍被占着（' + resolved.dir + '）');
}

const activeAfter = (ledger.dispatches || []).filter((d) => (d.state || 'active') === 'active');
process.stdout.write(JSON.stringify({
  ok: true,
  released,
  skipped,
  active_before: activeBefore.length,
  active_after: activeAfter.length,
  reason,
  data_dir: resolved.dir,
  data_dir_from: resolved.from
}, null, 2) + '\n');
process.exit(0);
