// SubagentStop：Watchdog 卡死检测 + 派工在飞名额回收
//
// Super-agent 的 Watchdog 判断 worker 是「真有进展」还是「陷入无效循环」。
// 这里做程序层能判的部分：停下来的 worker 是否留下了可核验的产出。
//
// v0.4.0：worker 停下来了，它占用的「在飞派工」名额必须还回来。
// 否则「并发上限」和「scope 重叠」永远只增不减，会把会话自己锁死。
//
// 设计要点（v0.3.2 修正）：
//   早期版本只做字面关键词匹配 —— 「搞定了」这种话能蒙混过关，
//   而且「已完成，改动文件 src/app.ts」即使文件根本不存在也算通过。
//   现在改为：先判声明，再把声明里提到的文件路径真实校验一遍。
import fs from 'node:fs';
import path from 'node:path';
import {
  readStdin, parseInput, readLedger, writeLedger,
  findBinding, markDispatchDone, readBriefFromTranscript, scopeOverlaps
} from './lib.mjs';

const input = parseInput(readStdin());
const lastMsg = String(input.last_assistant_message || '');

function workspaceRoot() {
  return String(process.env.MINIMAX_PROJECT_DIR || process.cwd()).replace(/\\/g, '/').replace(/\/+$/, '');
}

// ── 回收在飞名额 ────────────────────────────────────
try {
  const ledger = readLedger();
  const sessionId = String(input.session_id || '');
  let dispatchId = '';
  const binding = findBinding(ledger, sessionId);
  if (binding && binding.dispatch_id) {
    dispatchId = binding.dispatch_id;
  } else {
    // 兜底：worker 若一次工具调用都没发生过，就没有绑定记录。
    // 这时从它自己的 transcript 里把 brief 捞出来反查派工记录。
    const brief = readBriefFromTranscript(
      String(input.agent_transcript_path || input.transcript_path || '')
    );
    if (brief && brief.scope.length && brief.parentSessionId) {
      const hit = (ledger.dispatches || [])
        .filter((d) => String(d.parent_session_id || '') === String(brief.parentSessionId)
          && String(d.agent || '') === String(brief.agent || input.agent_type || '')
          && (d.state || 'active') === 'active'
          && scopeOverlaps(d.scope, brief.scope))
        .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (hit) dispatchId = hit.dispatch_id || '';
    }
  }
  if (dispatchId && markDispatchDone(ledger, dispatchId)) writeLedger(ledger);
} catch (e) {
  // 回收失败不能影响 watchdog 的本职判定
}

// 从交付文本里抠出看起来像文件路径的 token
const PATH_TOKEN = /[A-Za-z0-9_@~.\\/-]*[A-Za-z0-9_]\.[A-Za-z0-9]{1,8}/g;
// 只在「声称产出」的句子里校验路径。
// 交付报告里遍布「读过 / 引用 / 核对」到的路径，那些不是声称产出。
// 把全篇每个路径 token 都当产出校验，会把正常报告逼成连续返工 —— 实测踩过两次。
const PRODUCE = /(改动|新增|新建|创建|写了|生成|产出|输出|修改|替换|删除)/;
function claimedPaths(text) {
  const root = workspaceRoot();
  const seen = new Set();
  const lines = String(text).split(/[\r\n]+/).filter((l) => PRODUCE.test(l));
  if (!lines.length) return [];
  for (const m of lines.join('\n').match(PATH_TOKEN) || []) {
    const p = m.replace(/[.,;:!?)\]}'"]+$/, '');
    if (!p || p.length < 3) continue;
    if (!/\.[A-Za-z0-9]{1,8}$/.test(p)) continue;
    // 纯版本号（0.4.0 / v1.2）不是文件路径
    if (/^v?\d+(\.\d+)+$/.test(p)) continue;
    // 必须像路径：含目录分隔符。
    // 裸文件名在交付文本里满天飞（plugin.json、hooks.json），
    // 当成「声称产出的文件」会把 worker 逼到反复改写交付说明 —— 实测踩过。
    if (!/[\\/]/.test(p)) continue;
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
