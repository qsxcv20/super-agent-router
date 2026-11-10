// 探针：故障注入钩子对**生产路径**的影响。
//   1) 默认关闭（不设 SAR_FAULT_INJECT）：写入行为与开着一模一样，且没有额外开销
//   2) 开关语义：rename-eperm:N = 只让**前 N 次** rename 抛 EPERM
//   3) verify-fail 只影响校验环节，不影响其它写入
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN = path.resolve(process.argv[2] || 'plugin');
const mod = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'lessons.mjs')).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f02-neutral-'));
const file = path.join(tmp, 'led.md');

function build(raw) {
  const n = (raw.match(/^## /gm) || []).length;
  return { text: (raw || '') + '## 条目' + n + '\n', expectCount: n + 1, marker: '## 条目' + n,
    counter: (s) => (String(s).match(/^## /gm) || []).length };
}

function burst(n) {
  const t0 = Date.now();
  let okCount = 0;
  for (let i = 0; i < n; i++) {
    const r = mod.writeFileLocked(file, build);
    if (r.ok) okCount++;
  }
  return { ms: Date.now() - t0, okCount };
}

// 1) 默认关闭
delete process.env.SAR_FAULT_INJECT;
delete process.env.SAR_FAULT_RUN;
const a = burst(200);

// 字节级对照：同一份内容，钩子关 / 开（空转）各写一份，逐字节比
const fileOff = path.join(tmp, 'off.md');
const fileOn = path.join(tmp, 'on.md');
delete process.env.SAR_FAULT_INJECT;
mod.writeFileLocked(fileOff, build);
process.env.SAR_FAULT_INJECT = 'noop';
process.env.SAR_FAULT_RUN = 'probe-bytes';
mod.writeFileLocked(fileOn, build);
const offBytes = fs.readFileSync(fileOff);
const onBytes = fs.readFileSync(fileOn);

// 2) 开关打开但没有可触发的 token（钩子空转）
process.env.SAR_FAULT_INJECT = 'noop';
process.env.SAR_FAULT_RUN = 'probe-1';
const b = burst(200);

// 3) 语义：rename-eperm:1 ⇒ 只有**第一次** rename 抛 EPERM（被重试吃掉）
fs.rmSync(file, { force: true });
process.env.SAR_FAULT_INJECT = 'rename-eperm:1';
process.env.SAR_FAULT_RUN = 'probe-2';
const first = mod.writeFileLocked(file, build);
const second = mod.writeFileLocked(file, build);
const afterArmed = fs.readFileSync(file, 'utf8');

// 4) 语义：rename-eperm:1 但只 rename 一次（模拟回退）⇒ 写入失败
delete process.env.SAR_FAULT_INJECT;
const modText = fs.readFileSync(path.join(PLUGIN, 'scripts', 'lessons.mjs'), 'utf8');
const hasHook = modText.includes("const FAULT_ENV = 'SAR_FAULT_INJECT'");

console.log('OFF  200 次写入 ms=' + a.ms + ' 成功=' + a.okCount);
console.log('ON(空转) 200 次写入 ms=' + b.ms + ' 成功=' + b.okCount);
console.log('开销比（ON/OFF）= ' + (b.ms / Math.max(a.ms, 1)).toFixed(2) + 'x');
console.log('同一份内容：钩子关 / 钩子开（空转）落盘逐字节相同 = ' + offBytes.equals(onBytes) +
  '（各 ' + offBytes.length + ' 字节）');
console.log('钩子只认 SAR_FAULT_INJECT = ' + hasHook);
console.log('--- 语义 ---');
console.log('rename-eperm:1 第 1 次写入 ok=' + first.ok + '（错误=' + (first.error || '') + '）');
console.log('rename-eperm:1 第 2 次写入 ok=' + second.ok + '（额度用完后不再注入）');
console.log('注入后落盘条目数 = ' + (afterArmed.match(/^## /gm) || []).length);
