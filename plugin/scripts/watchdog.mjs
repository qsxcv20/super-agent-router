// SubagentStop：Watchdog 卡死检测
// Super-agent 的 Watchdog 判断 worker 是「真有进展」还是「陷入无效循环」。
// 这里做程序层能判的部分：停下来的 worker 是否留下了可核验的产出。
import { readStdin, parseInput } from './lib.mjs';

const input = parseInput(readStdin());
const lastMsg = String(input.last_assistant_message || '');

// 完全没有产出 -> 拦一次，让它继续
if (!lastMsg.trim()) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[super-agent-router] 你以空消息结束。交付必须包含：做了什么、产出在哪、如何验证。'
  }));
  process.exit(0);
}

// 声称完成但没有任何产出证据 -> 拦一次
const claimsDone = /(完成|已完成|done|已修复|已实现|已添加)/i.test(lastMsg);
const hasEvidence = /(文件|路径|\.(ts|js|py|md|json|txt|yaml|yml)\b|行\s*\d+|验收|测试|验证|运行|输出|结果)/i.test(lastMsg);
if (claimsDone && !hasEvidence) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[super-agent-router] 你声称完成但没有给出可核验证据（文件路径 / 命令 / 验证方式）。补上证据再结束。'
  }));
  process.exit(0);
}

process.exit(0);