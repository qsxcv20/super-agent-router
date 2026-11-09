// SubagentStop：Watchdog 卡死检测
// Super-agent 的 Watchdog 判断 worker 是「真有进展」还是「陷入无效循环」。
// 这里做程序层能判的部分：停下来的 worker 是否留下了可核验的产出。
//
// 设计要点（v0.3.2 修正）：
//   早期版本只做字面关键词匹配 —— 「搞定了」这种话能蒙混过关，
//   而且「已完成，改动文件 src/app.ts」即使文件根本不存在也算通过。
//   现在改为：先判声明，再把声明里提到的文件路径真实校验一遍。
import fs from 'node:fs';
import path from 'node:path';
import { readStdin, parseInput } from './lib.mjs';

const input = parseInput(readStdin());
const lastMsg = String(input.last_assistant_message || '');

function workspaceRoot() {
  return String(process.env.MINIMAX_PROJECT_DIR || process.cwd()).replace(/\\/g, '/').replace(/\/+$/, '');
}

// 从交付文本里抠出看起来像文件路径的 token
const PATH_TOKEN = /[A-Za-z0-9_@~.\\/-]*[A-Za-z0-9_]\.[A-Za-z0-9]{1,8}/g;
function claimedPaths(text) {
  const root = workspaceRoot();
  const seen = new Set();
  for (const m of text.match(PATH_TOKEN) || []) {
    const p = m.replace(/[.,;:!?)\]}'"]+$/, '');
    if (!p || p.length < 3) continue;
    if (!/\.[A-Za-z0-9]{1,8}$/.test(p)) continue;
    const norm = p.replace(/\\/g, '/');
    const abs = norm.startsWith('/') ? norm : root + '/' + norm;
    if (!fs.existsSync(abs)) seen.add(p);
  }
  return [...seen];
}

// 完全没有产出 -> 拦一次，让它继续
if (!lastMsg.trim()) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[super-agent-router] 你以空消息结束。交付必须包含：做了什么、产出在哪、如何验证。'
  }));
  process.exit(0);
}

// 声称完成但没有任何产出证据 -> 拦一次
const claimsDone = /(完成|已完成|搞定|做好|done|已修复|已实现|已添加|解决了)/i.test(lastMsg);
const hasEvidence = /(文件|路径|\.(ts|js|py|md|json|txt|yaml|yml)\b|行\s*\d+|验收|测试|验证|运行|输出|结果)/i.test(lastMsg);
if (claimsDone && !hasEvidence) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[super-agent-router] 你声称完成但没有给出可核验证据（文件路径 / 命令 / 验证方式）。补上证据再结束。'
  }));
  process.exit(0);
}

// 声称改动了文件，但那些文件在磁盘上不存在 -> 拦一次
const missing = claimedPaths(lastMsg);
if (missing.length) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[super-agent-router] 你声称产出了这些文件，但它们在磁盘上不存在：' +
      missing.slice(0, 5).join(', ') + '。要么真的创建它们，要么如实说明没做。'
  }));
  process.exit(0);
}

process.exit(0);