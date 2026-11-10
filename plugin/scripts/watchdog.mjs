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
import {
  readStdin, parseInput, readLedger, writeLedger,
  findBinding, markDispatchDone, markDispatchAborted, readBriefFromTranscript,
  scopeOverlaps, reapExpiredDispatches, projectRoot, absolutizePath,
  resolveAgentKey, validateEntryOutput, KNOWN_EXTENSIONS
} from './lib.mjs';

const input = parseInput(readStdin());
const lastMsg = String(input.last_assistant_message || '');

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

// ── 回收在飞名额（S6.2）────────────────────────────
// 三条回收路径：
//   1. 正常结束（SubagentStop + 交付通过校验）→ 立即回收
//   2. 超时兜底：超过 TTL 的 active 记录判死
//   3. 读时自愈：读取在飞名单时把已超龄的 active 记录判死并落盘
// 以前只有第 1 条 —— 派工被取消 / 中断 / 子会话异常退出时，名额两小时内不回收（D-10）。
function dispatchMatchesAgent(d, key) {
  if (!key) return true;
  const dk = String(d.agent_key || '');
  const da = String(d.agent || '');
  return dk === key || da === key;
}

function reclaim(ledger) {
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
    if (brief.ok && brief.scope.length && brief.parentSessionId) {
      const agentKey = resolveAgentKey({
        briefAgent: brief.agent,
        agentType: input.agent_type,
        toolAgentName: input.agent_name
      });
      const hit = (ledger.dispatches || [])
        .filter((d) => String(d.parent_session_id || '') === String(brief.parentSessionId)
          && dispatchMatchesAgent(d, agentKey)
          && (d.state || 'active') === 'active'
          && scopeOverlaps(d.scope, brief.scope))
        .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (hit) dispatchId = hit.dispatch_id || '';
    }
  }
  return dispatchId;
}

// 回收时的状态判断：只有还在 active 的派工能被标记成 done。
// 已经因 TTL 判死的派工保留原判死结论（读它的 end_reason / ended_at），
// 不复活 —— 复活等于把「这条派工没正常结束」的事实抹掉（S6.4）。
function reclaimState(ledger, dispatchId) {
  const rec = (ledger.dispatches || []).find((d) => d.dispatch_id === dispatchId);
  if (!rec) return 'unknown';
  if ((rec.state || 'active') !== 'active') {
    process.stderr.write('[super-agent-router] 派工 ' + dispatchId + ' 已判死（' +
      (rec.end_reason || 'unknown') + '，于 ' + (rec.ended_at || '?') + '），不复活。\n');
    return rec.state;
  }
  return 'active';
}

// ── 产出校验 ────────────────────────────────────────
// 从交付文本里抠出看起来像文件路径的 token。
// 盘符前缀必须保住：正则里把 "C:" 吃掉的话，后面拿到的就是 "/Users/..."，
// absolutizePath 会按根路径处理，判存在性就判到别的盘去了（D-20 的判定必须落在这条路径上）。
const PATH_TOKEN = /(?:[A-Za-z]:)?[A-Za-z0-9_@~.\\/-]*[A-Za-z0-9_]\.[A-Za-z0-9]{1,8}/g;
// 只在「声称产出」的句子里校验路径。
// 交付报告里遍布「读过 / 引用 / 核对」到的路径，那些不是声称产出。
// 把全篇每个路径 token 都当产出校验，会把正常报告逼成连续返工 —— 实测踩过两次。
const PRODUCE = /(改动|新增|新建|创建|写了|生成|产出|输出|修改|替换|删除)/;
// 「引用」与「产出」必须分开。
// 以前只按「行里有产出动词」过滤，于是一句「改动 X，参考 Y」会把 Y 也按产出校验，
// 交付说明里引用的文件被当成「声称产出但不存在」-> 合规交付被误拦。
// 被参考 / 引用 / 核对到的路径不是声称产出，不参与存在性校验。
const REFERENCE = /(引用|参考|核对|对照|依据|参见|详见|例如|比如)/;
function stripReferenceClauses(line) {
  return String(line).split(/[，,；;。]/).filter((seg) => !REFERENCE.test(seg)).join('，');
}
function claimedPaths(text) {
  const root = projectRoot();
  const seen = new Set();
  const lines = String(text).split(/[\r\n]+/).filter((l) => PRODUCE.test(l)).map(stripReferenceClauses);
  if (!lines.length) return [];
  for (const m of lines.join('\n').match(PATH_TOKEN) || []) {
    const p = m.replace(/[.,;:!?)\]}'"]+$/, '');
    if (!p || p.length < 3) continue;
    const ext = (p.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || '';
    if (!ext) continue;
    // 扩展名必须含字母：「契约 S2.2/S2.3」这种条款引用不是文件路径。
    // 以前只查「点 + 1~8 位字母数字」，条款引用被当成声称产出的文件 ->
    // 合规交付被误拦，逼 worker 反复改写交付说明（这类误拦实测踩过两次）。
    if (!/[A-Za-z]/.test(ext)) continue;
    // 纯版本号（0.4.0 / v1.2）不是文件路径
    if (/^v?\d+(\.\d+)+$/.test(p)) continue;
    // 必须像路径：含目录分隔符。
    // 裸文件名在交付文本里满天飞（plugin.json、hooks.json），
    // 当成「声称产出的文件」会把 worker 逼到反复改写交付说明 —— 实测踩过。
    if (!/[\\/]/.test(p)) continue;
    // 盘符绝对路径按绝对路径判存在；以前只认以 "/" 开头的，
    // "C:/..." 被拼成 "<工作区根>/C:/..." -> existsSync 必假 -> 真产出被误拦（D-20）
    const abs = absolutizePath(p, root);
    if (!fs.existsSync(abs)) seen.add(p);
  }
  return [...seen];
}

// 证据必须是「可核验的具体物」，不是「测试 / 运行 / 结果」这类描述词。
// 以前 hasEvidence 命中「测试」两个字就放行 ——
// 「搞定了，测试通过」能完全绕过完成度校验（D-11）。
function evidenceFound(text) {
  const src = String(text || '');
  const root = projectRoot();
  const toks = src.match(/[A-Za-z0-9_@~.\\/-]+/g) || [];
  for (const raw of toks) {
    const t = raw.replace(/[.,;:!?)\]}'"]+$/, '');
    if (!t || t.length < 3) continue;
    if (/^v?\d+(\.\d+)+$/.test(t)) continue;              // 版本号不是证据
    // 真实存在的路径最硬
    const abs = absolutizePath(t, root);
    if (abs && fs.existsSync(abs)) return 'exists:' + t;
    // 扩展名必须含字母：「契约 S2.2/S2.3」这种条款引用不是证据
    const ext = (t.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || '';
    if (!/[A-Za-z]/.test(ext)) continue;
    if (/[\\/]/.test(t)) return 'path:' + t;               // 指名了具体路径
    if (KNOWN_EXTENSIONS.test(t)) return 'file:' + t;        // 指名了具体文件
  }
  if (/\.[A-Za-z0-9]{1,8}:\d+/.test(src)) return 'lineref';           // 带行号的引用
  if (/```/.test(src)) return 'cmdout';                              // 围栏里的命令输出
  if (/(^|\n)\s*(\$\s|PASS\b|FAIL\b|✓|✔)/.test(src)) return 'cmdout';
  return '';
}

// 完全没有产出 -> 拦一次，让它继续
if (!lastMsg.trim()) {
  block('[super-agent-router] 你以空消息结束。交付必须包含：做了什么、产出在哪、如何验证。');
}

// 声称完成但没有可核验的证据 -> 拦一次
const claimsDone = /(完成|已完成|搞定|做好|done|已修复|已实现|已添加|解决了)/i.test(lastMsg);
const evidence = evidenceFound(lastMsg);
if (claimsDone && !evidence) {
  block('[super-agent-router] 你声称完成但没有给出可核验证据（具体文件路径 / 带行号的引用 / 命令输出）。' +
    '「测试通过」「运行过了」这类描述不算证据 —— 请指名你改动的文件或贴出验证输出。');
}

// 声称改动了文件，但那些文件在磁盘上不存在 -> 拦一次
const missing = claimedPaths(lastMsg);
if (missing.length) {
  block('[super-agent-router] 你声称产出了这些文件，但它们在磁盘上不存在：' +
    missing.slice(0, 5).join(', ') + '。要么真的创建它们，要么如实说明没做。');
}

// 收尾契约校验（S8）：条目型产出必须符合 S1 的 7 字段模板。
// 不合规就一次性说清缺哪一项，别让 worker 反复小修小补。
const entryCheck = validateEntryOutput(lastMsg);
if (entryCheck.checked && !entryCheck.ok) {
  block('[super-agent-router] 收尾契约不合规（S1 条目模板 / S8 校验）：\n- ' +
    entryCheck.problems.slice(0, 10).join('\n- ') +
    '\n请按 S1 的 7 字段模板一次性补齐再结束。');
}

// 判死结果先落盘（后面任何一条 block 都会直接 exit）
try {
  const ledger0 = readLedger();
  if (ledger0.readable !== false && reapExpiredDispatches(ledger0)) writeLedger(ledger0);
} catch (e) {
  process.stderr.write('[super-agent-router] 超时派工判死失败：' + (e && e.message ? e.message : String(e)) + '\n');
}

// ── 交付通过 -> 现在才回收在飞名额 ───────────────────
// 回收放在校验之后：被 block 的 worker 还在干活，名额不能提前还回去，
// 否则并发上限与写冲突检测会在它仍在写的时候失效。
try {
  const ledger = readLedger();
  if (ledger.readable !== false) {
    reapExpiredDispatches(ledger);            // 超时兜底 + 读时自愈
    const dispatchId = reclaim(ledger);
    if (dispatchId && reclaimState(ledger, dispatchId) === 'active') {
      markDispatchDone(ledger, dispatchId, 'subagent_stop');
    }
    writeLedger(ledger);
  }
} catch (e) {
  // 回收失败不能影响 watchdog 的本职判定，但必须留痕 ——
  // 静默吞掉异常等于「名额可能永久泄漏」而无人知晓（D-10）。
  process.stderr.write('[super-agent-router] 在飞名额回收失败：' + (e && e.message ? e.message : String(e)) + '\n');
}

process.exit(0);
