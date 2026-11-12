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
import os from 'node:os';
import {
  readStdin, parseInput, updateLedger,
  findBinding, markDispatchDone, markDispatchAborted, readBriefFromTranscript,
  scopeOverlaps, reapExpiredDispatches, projectRoot, absolutizePath,
  resolveAgentKey, validateEntryOutput, KNOWN_EXTENSIONS, expandHomePath
} from './lib.mjs';

const input = parseInput(readStdin());
const lastMsg = String(input.last_assistant_message || '');

// 每条 block 都带一个规则编号：断言要能指认「命中的是哪条规则」，
// 否则命中别的分支时断言会假绿（同族教训：D-70 —— 断言要能指认是哪条规则在拦）。
function block(rule, reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: '[super-agent-router] [规则 ' + rule + '] ' + reason
  }));
  process.exit(0);
}

// ── 回收在飞名额（S6.2）────────────────────────────
// 三条回收路径：
//   1. 正常结束（SubagentStop + 交付通过校验）→ 立即回收
//   2. 超时兜底：超过 TTL 的 active 记录判死
//      （只判**台账记录** —— 不终止子代理，见契约 S6.2 第 2 条）
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
// 通配符（* ?）也收进路径 token：**模式必须整体被认出来**。
// 以前通配符不在字符类里，路径 token 会从中间被截断，截出来的碎片
// （"~/.minimax/v2/.../sha256-tree-v1-*/scripts/watchdog.mjs" -> "/scripts/watchdog.mjs"）
// 被当成「声称产出的文件」-> 必假 -> 又一次误拦（N-04）。
const PATH_TOKEN = /(?:[A-Za-z]:)?[A-Za-z0-9_@~.*?\\/-]*[A-Za-z0-9_*?]\.[A-Za-z0-9]{1,8}/g;
// 家目录写法（~ / $HOME / %USERPROFILE%）必须展开后再判存在性。
// 不展开的话 "~/.minimax/plugins/..." 会被拼成 "<工作区根>/~/.minimax/..."
// -> existsSync 必假 -> **真实存在的文件被当成「不存在」** -> 诚实的报告被拦（N-03）。
// 展开规则在 lib.mjs 的 expandHomePath()（纯函数，guard 侧已在用）。
const HOME_DIR = (() => { try { return String(os.homedir() || ''); } catch (e) { return ''; } })();
// 只在「声称产出」的句子里校验路径。
// 交付报告里遍布「读过 / 引用 / 核对」到的路径，那些不是声称产出。
// 把全篇每个路径 token 都当产出校验，会把正常报告逼成连续返工 —— 实测踩过两次。
//
// ── D-72：肯定式产出与否定式产出必须分开判 ──────────────────
// 「X 没有创建」**不是**「声称产出 X」。
// 以前这里只有一列肯定式动词逐行扫 ⇒「没有创建」里的「创建」被当成产出声明 ⇒
// 路径存在性校验失败 ⇒ 连续 block 诚实的交付报告。
// 活体实测：子会话 mvs_73441ff316ed4d2db69fe88e9b17eeb3，
// 2026-11-10T13:05:07Z 起被连 block 三次（原文见 docs/audit/live-trigger-evidence.txt）。
//
// 后果有两层，第二层更严重：block 文案写着「要么真的创建它们，要么如实说明没做」——
// 成员已经在如实说明，闸门却仍在要求那个文件存在 ⇒ **机制把成员往「真的去创建那个文件」
// 的方向推**；那个文件若越界，就是机制把成员推过了边界。
//
// 所以否定判定是**独立一条规则**，不是往动词表里加词：
// 加词只挡得住「没有」，挡不住「未」「不该」「不会」「并非」……
// 同族教训（D-70）：断言若命中的是别的分支就是假绿 ⇒ 每条规则带编号，消息里写明命中哪条。
// 产出动词表（只用来定位动词，判定不在这张表上）
const PRODUCE_VERBS = '改动|新增|新建|创建|写了|生成|产出|输出|修改|替换|删除';
// 否定标记：紧挨在产出动词前面时，该动词**不算**声称产出（长的排前面，「没有」要先于「没」被试到）。
const NEGATION_MARKERS = [
  '并没有', '没有', '并非', '并未', '尚未', '不曾', '从未', '未能', '没法', '无法',
  '不能', '不会', '不该', '不应', '不再', '不是', '未', '没', '不', '无'
];
// 否定标记与产出动词之间允许夹的连接词 / 助词（只允许这些）。
// 「未被创建」的「被」、「没有创建」的「没有」要先剥掉才看得到标记本身。
// 「不小心创建了 X」里的「心」不在表里 ⇒ 仍是肯定式产出（它确实创建了，那个文件该存在）。
const NEG_CONNECTORS = '去来能会得着过再也就才将要想敢肯和与并们被曾予';
// 非断言语境标记：这些词引出的是「引述 / 打算 / 疑问」，不是「我已产出」的断言。
// 例：「未验证 X 是否在别处被创建」里的「创建」在疑问从句里，不是产出声明 ——
// 把它当成声明，成员如实说明「没做」就会被反过来要求那个文件存在。
const EMBED_MARKERS = [
  '是否', '有没有', '是不是', '会不会', '能否', '可否',
  '声称', '宣称', '试图', '尝试', '打算', '计划', '准备', '想要', '需要', '应该'
];
// 子句分隔符：路径必须归属到**它所在的子句**，不是它所在的行。
// 以前是行级判定：行里有产出动词 ⇒ 这一行里**所有**路径都被当成声称产出。
// 于是「引用的护栏拒绝原文」那一行（原文里有「如确需修改」+ 越界路径）
// 会把那个路径变成「声称产出」—— 活体实测里连续 block 的直接原因之一。
const CLAUSE_SPLIT = /[，,；;。！？!?、（）()「」『』\r\n]+/;
// 「引用」与「产出」必须分开。
// 以前只按「行里有产出动词」过滤，于是一句「改动 X，参考 Y」会把 Y 也按产出校验，
// 交付说明里引用的文件被当成「声称产出但不存在」-> 合规交付被误拦。
// 被参考 / 引用 / 核对到的路径不是声称产出，不参与存在性校验。
const REFERENCE = /(引用|参考|核对|对照|依据|参见|详见|例如|比如)/;

// 切成子句
function splitClauses(text) {
  return String(text).split(CLAUSE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

// 动词位置 i 前面是否紧挨着否定标记（中间只允许连接词）。
function isNegatedBefore(clause, i) {
  let core = clause.slice(0, i);
  for (;;) {
    if (NEGATION_MARKERS.some((m) => core.endsWith(m))) return true;
    if (!core.length) return false;
    const last = core[core.length - 1];
    if (NEG_CONNECTORS.indexOf(last) < 0) return false;
    core = core.slice(0, core.length - 1);
  }
}

// 一个子句里有哪些产出动词，各自算不算「断言产出」
function clauseVerbs(clause) {
  const re = new RegExp(PRODUCE_VERBS, 'g');
  const out = [];
  let m;
  let segStart = 0;
  while ((m = re.exec(clause)) !== null) {
    const seg = clause.slice(segStart, m.index);
    // 非断言语境：这一段里出现过引述 / 打算 / 疑问标记 ⇒ 这里的动词不是产出声明
    const embedded = EMBED_MARKERS.some((k) => seg.indexOf(k) >= 0);
    // 否定式：否定标记紧挨在动词前面
    const negated = isNegatedBefore(clause, m.index);
    out.push({ index: m.index, length: m[0].length, assertive: !embedded && !negated });
    segStart = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

// 路径由哪个动词「认领」：前面最近的动词；前面没有动词就用后面最近的。
function ownerVerb(verbs, at) {
  let before = null;
  let after = null;
  for (const v of verbs) {
    if (v.index + v.length <= at) before = v;
    else if (after === null) after = v;
  }
  return before || after || null;
}
function claimedPaths(text) {
  const root = projectRoot();
  const seen = new Set();
  for (const clause of splitClauses(text)) {
    // 被参考 / 引用 / 核对到的路径不是声称产出，不参与存在性校验
    if (REFERENCE.test(clause)) continue;
    const verbs = clauseVerbs(clause);
    if (!verbs.length) continue;
    for (const m of clause.matchAll(PATH_TOKEN)) {
      const p = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
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
      // 通配符路径是**模式**，不是一个文件 —— 逐文件的存在性校验对它没有意义。
      // 收进 PATH_TOKEN 是为了让模式整体被认出来（不再被截成碎片路径），
      // 但模式本身不参与存在性校验：判它「不存在」必然是假阳性。
      if (/[*?]/.test(p)) continue;
      // 认领：路径由它前面最近的产出动词认领；前面没有动词就用后面最近的。
      // 认领它的动词若是非断言（否定式 / 非断言语境），这个路径就**不是**「声称产出」
      // —— 成员如实说明「没做」时，不该反过来要求那个文件存在（D-72）。
      const owner = ownerVerb(verbs, m.index);
      if (!owner || !owner.assertive) continue;
      // 盘符绝对路径按绝对路径判存在；以前只认以 "/" 开头的，
      // "C:/..." 被拼成 "<工作区根>/C:/..." -> existsSync 必假 -> 真产出被误拦（D-20）
      // 家目录写法（~ / $HOME / %USERPROFILE%）先展开： 不展开的话
      // "~/.minimax/plugins/..." 会被拼成 "<工作区根>/~/.minimax/..." -> existsSync 必假
      // -> **真实存在的文件被当成「不存在」** -> 诚实的报告被拦（N-03）。
      const abs = absolutizePath(expandHomePath(p, HOME_DIR), root);
      if (!fs.existsSync(abs)) seen.add(p);
    }
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
    // 真实存在的路径最硬（家目录写法同样先展开，否则 "~/.minimax/..." 会被拼到工作区根下 -> 判假）
    const abs = absolutizePath(expandHomePath(t, HOME_DIR), root);
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
  block('R-EMPTY-DELIVERY', '你以空消息结束。交付必须包含：做了什么、产出在哪、如何验证。');
}

// 声称完成但没有可核验的证据 -> 拦一次
const claimsDone = /(完成|已完成|搞定|做好|done|已修复|已实现|已添加|解决了)/i.test(lastMsg);
const evidence = evidenceFound(lastMsg);
if (claimsDone && !evidence) {
  block('R-NO-EVIDENCE', '你声称完成但没有给出可核验证据（具体文件路径 / 带行号的引用 / 命令输出）。' +
    '「测试通过」「运行过了」这类描述不算证据 —— 请指名你改动的文件或贴出验证输出。');
}

// 声称改动了文件，但那些文件在磁盘上不存在 -> 拦一次
const missing = claimedPaths(lastMsg);
if (missing.length) {
  block('R-CLAIM-PATH-MISSING', '你声称产出了这些文件，但它们在磁盘上不存在：' +
    missing.slice(0, 5).join(', ') + '。要么真的创建它们，要么如实说明没做。');
}

// 收尾契约校验（S8）：条目型产出必须符合 S1 的 7 字段模板。
// 不合规就一次性说清缺哪一项，别让 worker 反复小修小补。
const entryCheck = validateEntryOutput(lastMsg);
if (entryCheck.checked && !entryCheck.ok) {
  block('R-ENTRY-FORMAT', '收尾契约不合规（S1 条目模板 / S8 校验）：\n- ' +
    entryCheck.problems.slice(0, 10).join('\n- ') +
    '\n请按 S1 的 7 字段模板一次性补齐再结束。');
}

// 判死结果先落盘（后面任何一条 block 都会直接 exit）
try {
  // 判死走统一写入口（D-77）：整个「读-改-写」串行化 ——
  // 否则与并发派工相撞时会把对方的记录整条覆盖掉（静默丢记录）。
  const reapRes = updateLedger((cur) => { reapExpiredDispatches(cur); });
  if (!reapRes.ok) {
    process.stderr.write('[super-agent-router] 超时派工判死失败：' + (reapRes.error || '') +
      '（' + reapRes.code + '）\n');
  }
} catch (e) {
  process.stderr.write('[super-agent-router] 超时派工判死失败：' + (e && e.message ? e.message : String(e)) + '\n');
}

// ── 交付通过 -> 现在才回收在飞名额 ───────────────────
// 回收放在校验之后：被 block 的 worker 还在干活，名额不能提前还回去，
// 否则并发上限与写冲突检测会在它仍在写的时候失效。
try {
  // 回收走统一写入口（D-77）：判定与写回收结果必须原子 ——
  // 否则「回收」会覆盖并发登记的新派工，那条派工就凭空消失了。
  const recRes = updateLedger((cur) => {
    reapExpiredDispatches(cur);            // 超时兜底 + 读时自愈
    const dispatchId = reclaim(cur);
    if (dispatchId && reclaimState(cur, dispatchId) === 'active') {
      markDispatchDone(cur, dispatchId, 'subagent_stop');
    }
  });
  if (!recRes.ok) {
    process.stderr.write('[super-agent-router] 在飞名额回收失败：' + (recRes.error || '') +
      '（' + recRes.code + '）\n');
  }
} catch (e) {
  // 回收失败不能影响 watchdog 的本职判定，但必须留痕 ——
  // 静默吞掉异常等于「名额可能永久泄漏」而无人知晓（D-10）。
  process.stderr.write('[super-agent-router] 在飞名额回收失败：' + (e && e.message ? e.message : String(e)) + '\n');
}

process.exit(0);
