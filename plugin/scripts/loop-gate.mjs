// 无进展重复调用闸门（D-86）
//
// 作用：子代理在同一派工内**连续发起 N 次完全相同的工具调用、中间没有任何别的工具调用**时，
// 当场拦住（deny），要求它交付当前结论或说明卡点。
// 目标：止住「查证 → 验证 → 再查证」的无休止循环，同时**不误伤正常的迭代**。
//
// ── 这个闸门是「效率闸门」，不是「安全闸门」：读不到就放行 ──────────────
//
// 这里与 guard.mjs 的口径**故意相反**，必须写清楚，否则后人会「顺手改成 fail-closed」：
//   · guard 是安全闸门：解析不出边界 = 越界管控整段失效而且不报错 ⇒ 必须拒绝；
//   · 本闸门是效率闸门：拦错的代价是**子代理干不了活**（它被卡住、交不出东西），
//     放行的代价只是**少拦一次循环**（多烧一点 token 与时间）。
// 两个代价不对称，所以这里的取舍是 fail-open：
//   transcript 读不到 / 解析不出历史 / 载荷异常 ⇒ **放行**，并往 stderr 留痕。
// 留痕不能省：静默放行 = 机制看起来在跑、其实没跑（D-86 这一族缺陷的形态就是这样）。
//
// ── PTC 形态：外层与内层是两套命名空间（D-91 的根因）──────────────────────
//
// 实测（本客户端默认的 PTC 形态；真实 transcript 逐字）：
//   · transcript 的 message.content[] 记的是**外层**工具（本形态下只有 run_code），
//     元素形如 {type:'toolCall', id, name:'run_code', arguments:{code,description}}；
//   · **内层**调用记在 message.details.ptc.child_calls[]，元素形如
//     {child_tool_call_id, parent_tool_call_id, tool_name:'bash', input:{command}, status}；
//   · 宿主在 PTC 模式下把 plugin PreToolUse 派发在**子调用**上（宿主源码
//     ptc-tool-executor.js:507-509 的注释明写子调用准入链含 plugin PreToolUse hooks）
//     ⇒ 载荷是**内层**形态：tool_name='bash'、tool_input={command}。
// ⇒ 拿外层序列去比内层载荷 ⇒ 两个命名空间的指纹永不相等 ⇒ 末尾连续数恒为 0
//   ⇒ 闸门在真实运行时**恒不触发**（D-91）。
// 修法：**按载荷形态择一计数**，绝不把两套序列混在一起数
//   （外层与内层在 transcript 里交替出现，混数会把连续段切碎 ⇒ 反而更拦不到）。
// 非 PTC 形态（模型直接调工具）下 transcript 只有外层 content[] ⇒ 仍走外层口径，原逻辑不变。
//
// 判定规格（父会话派工单给定；契约条款由父会话落盘，本脚本只引用规则编号）：
//   R-LOOP-SAME-CALL：同一子会话内，连续 N 次工具调用的「归一化指纹」完全相同、
//                     且中间没有任何别的工具调用 ⇒ 拦第 N+1 次。N 默认 5，可环境变量覆盖。
//
// 指纹怎么算（规格第 2 条）：
//   bash / run_code → 取命令正文（去首尾空白、折叠连续空白、换行折成空格）；
//                     run_code 的命令正文在载荷里叫 code（不是 command）—— 两个键都认，
//                     否则复合工具的指纹会恒为空 ⇒ 正常形态里连着 49 次 run_code 会被整片误伤。
//   read            → 取 path（Windows 下大小写不敏感 + 斜杠归一）**并连 offset/limit**：
//                     不同 offset/limit 读的是不同的一段，是**新信息**，不能算重复。
//   glob / grep     → 取 pattern + path。
//   其余工具        → 取 arguments 的稳定 JSON（键排序）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInputStrict } from './lib.mjs';

const RULE = 'R-LOOP-SAME-CALL';

// 阈值：连续相同调用达到这一次数后，再发一次就被拦（即拦第 N+1 次）。
// 可用环境变量覆盖（调小 = 更严）：SAR_LOOP_GATE_MAX_SAME。
//
// ── 为什么默认是 5，以及什么情况下会误伤（误伤风险评估）────────────
// 实测依据（本机 431 个真实 transcript）：
//   · 最长的「连续相同调用」段是 **14 次**（run_code 轮询同一后台任务）与 **10 次**
//     （task_output 轮询）⇒ 阈值 5 抓得住真实循环，不是拍脑袋定的理论阈值。
//   · 真实 transcript 的「末尾连续相同数」**全部 = 1**（220/220）⇒ 循环发生在会话中段，
//     闸门拦的是「循环进行中」的那一刻，不是会话结束时。
// 会拦到的形态（都是「无进展」的形态）：
//   (a) 轮询同一个后台任务（task_output / run_code 里包 task_output）—— 最长连跑族就是它；
//   (b) 反复跑同一条无副作用的只读命令（bash 查同一个文件）。
// 不会误伤的情形（都有断言钉住）：
//   · 不同 offset/limit 的 read（是新信息，不是重复）；
//   · 指纹不同的调用插在中间（连续计数断开）；
//   · 父会话（无 agent_type ⇒ 永不拦）；
//   · 别的子会话的行（归属键不同 ⇒ 不计入本子会话的连续计数）。
// 仍有风险的边界（如实写出来）：
//   合法地等一个跑很久的后台任务时，若**连续用完全相同的参数**轮询 5 次，会被拦一次。
//   deny 文案要求「说明卡在哪一步」，agent 改用不同的 wait_ms 即换指纹、不再被拦。
//   嫌紧就把 SAR_LOOP_GATE_MAX_SAME 调大（调大只会少拦，不会多拦 —— 方向永远是安全的那一侧）。
const DEFAULT_MAX_SAME = 5;

// tail 读窗口（初始值）：transcript 实测最大 55 MB / 431 条消息 —— 整读会把每次 hook 拖到秒级。
// 只读尾部这一段；窗口不够时**只会少算**（fail-open 方向），不会多算；
// 少算到「少算成 0」就等于闸门静默失效 ⇒ 因此末尾连续段没被断开时要**自适应扩窗**（见 measureTrailing）。
const DEFAULT_TAIL_BYTES = 262144;

function maxSame() {
  const raw = Number(process.env.SAR_LOOP_GATE_MAX_SAME);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_MAX_SAME;
  return Math.floor(raw);
}

function tailBytes() {
  const raw = Number(process.env.SAR_LOOP_GATE_TAIL_BYTES);
  if (!Number.isFinite(raw) || raw < 4096) return DEFAULT_TAIL_BYTES;
  return Math.floor(raw);
}

// 扩读上限（初始窗口之外还能往上读多少）。
// 为什么需要扩读：真实 transcript 里**请求行与工具结果行交替**——一次大结果（实测最大行 132 KB）
// 就能把重复请求挤出固定尾窗 ⇒ 连续数被少算 ⇒ 闸门静默放行（这正是 D-86 这一族缺陷的形态）。
// 口径：尾窗里若找不到一个「指纹不同」的调用把末尾连续段断开，就说明这段可能还在窗口之外 ⇒
// 只能少算不能多算 ⇒ 按 4 倍扩窗重读，直到断开或触顶。
const DEFAULT_MAX_SCAN_BYTES = 8388608;

function maxScanBytes() {
  const raw = Number(process.env.SAR_LOOP_GATE_MAX_SCAN_BYTES);
  if (!Number.isFinite(raw) || raw < 4096) return DEFAULT_MAX_SCAN_BYTES;
  return Math.floor(raw);
}

// 放行（stdout 留空即放行，见 guard.mjs 的同一形状）。
// 为什么留痕到 stderr：机制在「读不到」时静默放行 = 看起来在跑、其实没跑。
function allow(reason) {
  if (reason) {
    try {
      process.stderr.write('[super-agent-router] [loop-gate] 放行（' + reason + '）\n');
    } catch (e) { /* 留痕失败也不能影响放行 */ }
  }
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

// ── 指纹归一 ────────────────────────────────────────────────

// 折叠连续空白：同一条命令的不同缩进/换行是同一次调用。
function normText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// 路径归一：斜杠统一 + Windows 下大小写不敏感。
function normPathKey(p) {
  let s = String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (process.platform === 'win32') s = s.toLowerCase();
  return s;
}

// 稳定 JSON：键排序 ⇒ 同内容同串，与键的书写顺序无关。
function stableJson(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') {
    const t = JSON.stringify(v);
    return t === undefined ? 'null' : t;
  }
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

// 一次工具调用的归一化指纹。
export function fingerprint(tool, args) {
  const name = String(tool || '').trim().toLowerCase();
  const a = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  if (name === 'bash' || name === 'run_code') {
    // run_code 的命令正文叫 code；bash 的叫 command。两个都认。
    const cmd = a.command !== undefined ? a.command : a.code;
    return name + '|' + normText(cmd);
  }
  if (name === 'read') {
    return name + '|' + normPathKey(a.path) + '|' + String(a.offset === undefined ? '' : a.offset) +
      '|' + String(a.limit === undefined ? '' : a.limit);
  }
  if (name === 'glob' || name === 'grep' || name === 'search' || name === 'list') {
    return name + '|' + normText(a.pattern) + '|' + normPathKey(a.path);
  }
  return name + '|' + stableJson(a);
}

// ── transcript：只读尾部，且只认 content[] 里的 toolCall ──────────────────
//
// 为什么不能整读：实测最大 55 MB / 431 条消息 ⇒ 整读会让每次 hook 变成秒级操作。
// 为什么只认 message.content[]：本机实测（239 个真实 transcript、761 行样本）的工具调用一律在
// message.content[] 里，元素形如 {type:'toolCall', id, name, arguments}；
// message.parts[] 在本机真实 transcript 里**根本不存在**（顶层键只有 message/message_id/turn_id），
// 在别的变体形态里 parts[] 装的是 thinking / image —— 两者都不能当工具调用，
// 否则会把「思考」算成「调用」⇒ 连续计数被插断 ⇒ 闸门永远不触发。
// 读尾部 winBytes 字节。
// truncated = 窗口没盖到文件头 ⇒ **可能漏掉了更早的调用** ⇒ 连续数只是下界。
function readTail(file, winBytes) {
  const st = fs.statSync(file);
  const size = st.size;
  const len = Math.min(size, winBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    let text = buf.toString('utf8');
    // 窗口切在文件中间时，第一行是残缺的 —— 丢掉它。
    let truncated = false;
    if (size > len) {
      truncated = true;
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return { lines: text.split(/\r?\n/).filter((l) => l.trim()), truncated: truncated, bytes: len };
  } finally {
    fs.closeSync(fd);
  }
}

// ── 归属键：判定「这一行是不是本子会话的」 ─────────────────────────────────
//
// 实测（本机 400+ 个真实 transcript；下列数字取自 2026-11-11 的**整读全量**普查，
// 当时 434 个文件。口径：读**顶层** turn_id，归属键的归一方式与下面 attributionKey() 完全一致 ——
// 真实行的顶层键只有 {message, message_id, turn_id}；turn_id 在普查里出现 55840 次、全在顶层，
// 嵌套层只有 1 次且在报错文本里）：
//   · **0 个** transcript 的行带 sessionId 键 ⇒ 按 sessionId 归属在这套 transcript 上
//     **根本不成立**。上一版代码里的 sessionId 比较是死代码，注释却宣称
//     「别的会话的行不参与计数」—— 注释与代码不一致，正是本仓库「静默失效」家族的形态，
//     已删掉那个比较，改用下面这个**真的会生效**的归属键。
//   · turn_id 的真实形态有四类：任务轮 turn_task_bg_bg_<uuid> / turn_task_delivery_<uuid>、
//     普通轮 <uuid> 或 turn_<uuid>、以及带 ':' 后缀的变体（如 turn_<uuid>:compaction）。
//   · 归属键分布（**两组必须分开看** —— 别把「没有键」的文件算成「有键的文件」，
//     那是上一版注释误导人的写法）：
//       - 恰好一个**非空**归属键：122 个；
//       - **完全没有顶层 turn_id**：190 个（归属键为空，同样等价于单一键）；
//       - 含多个归属键：122 个（实测样本：压缩快照把多个会话的历史并进一个文件；
//         父会话 transcript 里同时有父轮与任务轮）⇒ 跨会话的行真实存在。
//     空键计入后 312/434 满足「只有一个归属键」。
//   · 承重前提（本子会话内跨轮稳定）：由**真实活体证据**坐实，不是统计推断 ——
//     那段真实连跑 14 次同一调用的记录里 turn_id 只有 1 个（turn_task_bg_bg_<uuid>），
//     拿它当载荷 turn_id 跑真实闸门 ⇒ 命中 DENY。
// 归属键取法：turn_id 去掉 ':' 后缀后取末尾的 uuid 段；没有 uuid 就用整串小写。
//   ⇒ 同一会话的不同写法（turn_task_bg_bg_X / turn_X / 裸 X / 带 :compaction）归一到同一个键；
//   ⇒ 不同子会话 / 父会话的键不同 ⇒ 跨会话的行可以被排除。
export function attributionKey(turnId) {
  const s = String(turnId == null ? '' : turnId).trim();
  if (!s) return '';
  const base = s.split(':')[0];          // 去掉 :compaction 之类后缀
  const m = base.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/);
  return m ? m[1].toLowerCase() : base.toLowerCase();
}

// 从一行里取出工具调用（assistant 消息的 content[] 数组）。
// 兼容两种 transcript 变体：message.content[] 与 codex 风格的 payload.content[]。
function toolCallsOf(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  const holders = [];
  if (obj.message && typeof obj.message === 'object') holders.push(obj.message);
  if (obj.payload && typeof obj.payload === 'object') holders.push(obj.payload);
  const turnId = String(obj.turn_id || obj.turnId || '');
  for (const h of holders) {
    if (!Array.isArray(h.content)) continue;
    for (const item of h.content) {
      if (!item || typeof item !== 'object') continue;
      if (item.type !== 'toolCall') continue;
      out.push({
        name: String(item.name || ''),
        args: (item.arguments && typeof item.arguments === 'object') ? item.arguments : {},
        turnId: turnId
      });
    }
  }
  return out;
}

// ── 下列函数对外导出，仅为**可观测性**（判定行为逐字未变）────────────────────
// 为什么导出：D-91 收尾轮要求「三种语义破坏分别红不同的断言」（择一 / 取内层 / 可比性）。
// 这三层在**黑盒**（跑脚本看 allow/deny）上经常**同一条断言一起红** —— 端到端只看得见
// 「拦没拦」，看不见「为什么」。⇒ 单元级断言直接调这几层，才能把红点定位到具体那一层。
//
// 导出清单（与本文件里的 export function 一一对应，改动时**必须同步核对**，
//   否则又变成「注释宣称 ≠ 代码在做」——那正是 D-86 这一族缺陷的形态）：
//   fingerprint      —— 归一化指纹（D-86 起就已导出）
//   attributionKey   —— 归属键归一（白盒断言要按同一口径筛本子会话的行）
//   innerCallsOf     —— 取内层（PTC 子调用）
//   incomparableFp   —— 不可比记录的哨兵占位指纹
//   innerComparable  —— 可比性判定
//   pickNamespace    —— 择一（内层 / 外层两套命名空间）
//   callsFromLines   —— 两套序列的组装与计数
// 从一行里取出**内层**（PTC 子调用）记录。
// 真实形态：message.details.ptc.child_calls[]，元素形如
// {child_tool_call_id, parent_tool_call_id, tool_name:'bash', input:{command}, status}。
// 注意：宿主落盘的 input 是**参数的子集**（实测 bash{command} / read{path} / write{path} /
// edit{file_path} / grep{} / glob{}）—— 有的参数根本不落盘 ⇒ 可比性另判（见 innerComparable）。
export function innerCallsOf(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  const m = obj.message;
  if (!m || typeof m !== 'object') return out;
  const det = m.details;
  if (!det || typeof det !== 'object') return out;
  const ptc = det.ptc;
  if (!ptc || typeof ptc !== 'object') return out;
  const cc = ptc.child_calls;
  if (!Array.isArray(cc)) return out;
  const turnId = String(obj.turn_id || obj.turnId || '');
  for (const c of cc) {
    if (!c || typeof c !== 'object') continue;
    const name = String(c.tool_name || c.name || '');
    if (!name) continue;
    let args = c.input;
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = c.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    out.push({ name: name, args: args, turnId: turnId });
  }
  return out;
}

// 末尾连续相同指纹的条数（从后往前数，遇到不同指纹就停）。
function trailingSameCount(calls, fp) {
  let n = 0;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].fp !== fp) break;
    n++;
  }
  return n;
}

// 一个工具参与指纹的键集合（与上面 fingerprint() 的分支一一对应）。
// null = 该工具按「全部参数」取稳定 JSON 口径。
function fingerprintKeySet(tool) {
  const name = String(tool || '').trim().toLowerCase();
  if (name === 'bash') return ['command'];
  if (name === 'run_code') return ['code'];
  if (name === 'read') return ['path', 'offset', 'limit'];
  if (name === 'glob' || name === 'grep' || name === 'search' || name === 'list') return ['pattern', 'path'];
  return null;
}

// 不可比记录在计数序列里的**占位指纹**（哨兵）。
// 为什么单独成一个函数：哨兵是「不可比」这条语义**唯一的外部可见标记** ——
// 它必须与任何真实调用的指纹都不同（否则不可比记录会被误当成正常记录计入），
// 又必须稳定（同一工具名 ⇒ 同一哨兵）。
// 抽成函数是为了让回归断言能**单独**观察这一层：黑盒（跑闸门看 allow/deny）
// 看不见「哪一条记录被打成了哨兵」，端到端断言会随其它层一起红 ⇒ 无法定位。
// 判定行为逐字未变：与下面的表达式完全等价。
export function incomparableFp(rec) {
  const name = (rec && rec.name) ? String(rec.name) : '';
  return '\u0000incomparable:' + name;
}

// 内层记录与当前载荷**是否同一次调用**（可比性）。
// 为什么要有这一步：宿主落盘的 child_calls[].input 是**参数的子集**
// （实测 bash{command} / read{path} / write{path} / edit{file_path} / grep{} / glob{}）。
// 不判可比性就直接拿它算指纹 ⇒ 所有内层 grep/glob 会撞成同一指纹 ⇒ 凭空造出「连续重复」⇒ 误伤。
// 规则：
//   · 键集合固定的工具（bash/run_code/read/glob/grep/…）：**载荷与内层记录都必须带齐该键集合**
//     —— 缺一个就不可比（例：内层 read 只记 path，而载荷带 offset/limit ⇒ 不可比，
//     否则会把「读同一文件的不同段」错判成重复 ⇒ 误伤正常分段读取）。
//   · 按全部参数取指纹的工具：内层记录与载荷的键集合必须一致（否则参数没落全 ⇒ 不可比）。
// 不可比的记录**打断连续段但不计入**（宁可少拦，不可错算）。
export function innerComparable(rec, pay) {
  const recArgs = (rec && rec.args && typeof rec.args === 'object') ? rec.args : {};
  const payArgs = (pay && pay.args && typeof pay.args === 'object') ? pay.args : {};
  const keySet = fingerprintKeySet(rec.name);
  if (keySet === null) {
    const rk = Object.keys(recArgs).sort();
    const pk = Object.keys(payArgs).sort();
    if (rk.length !== pk.length) return false;
    for (let i = 0; i < rk.length; i++) if (rk[i] !== pk[i]) return false;
    return true;
  }
  for (const k of keySet) {
    if (!(k in recArgs)) return false;
    if (!(k in payArgs)) return false;
  }
  return true;
}

// 择一：决定这次该数哪套序列（**绝不把两套混在一起数**）。
// 判据（不靠猜，靠两侧的实际形状）：
//   · 载荷工具名只出现在内层序列 ⇒ 载荷是内层调用 ⇒ 数内层（PTC 形态的常态）；
//   · 载荷工具名只出现在外层序列 ⇒ 载荷是外层调用 ⇒ 数外层（非 PTC 形态，以及 PTC 下的外层工具）；
//   · 两边都有 ⇒ 取内层（PTC 常态；此时载荷多半是内层工具）；
//   · 两边都没有该名字 ⇒ 有哪套数哪套（都为空时数内层，等空序列走扩读）。
export function pickNamespace(outer, inner, payTool) {
  let outerHas = false, innerHas = false;
  for (const c of outer) if (c.name === payTool) { outerHas = true; break; }
  for (const c of inner) if (c.name === payTool) { innerHas = true; break; }
  if (innerHas && !outerHas) return 'inner';
  if (outerHas && !innerHas) return 'outer';
  if (innerHas && outerHas) return 'inner';
  if (!outer.length) return 'inner';
  if (!inner.length) return 'outer';
  return 'inner';
}

// 解析窗口里的工具调用，并筛出**本子会话**的调用。
// 归属规则（每一条都有对应断言，见 tests/loop-gate-test.mjs 的 D-86 F3 段）：
//   A1 行内没有 turn_id ⇒ 计入（没有归属信息 ⇒ 不据此排除）
//   A2 载荷没有 turn_id ⇒ 计入（没有参照键 ⇒ 不据此排除）
//   A3 行的归属键与载荷相同 ⇒ 计入
//   A4 行的归属键与载荷不同 ⇒ **不计入**（别的子会话 / 父会话的行不参与本子会话的连续计数）
// 方向性：A4 只会让连续数变少 ⇒ 少拦一次，不会误伤。
// 命名空间：按载荷形态择一（见 pickNamespace）—— 外层与内层**不混数**。
export function callsFromLines(lines, payKey, pay) {
  const outer = [];
  const inner = [];
  let excluded = 0;
  for (const line of lines) {
    // 便宜的预筛：只有含 "toolCall"（外层）或 "child_calls"（内层）的行才可能是工具调用行。
    // 真实 transcript 里绝大多数行是工具结果（大块文本），不预筛就得把整窗都 JSON.parse 一遍。
    if (line.indexOf('toolCall') < 0 && line.indexOf('child_calls') < 0) continue;
    let obj = null;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    for (const c of toolCallsOf(obj)) outer.push(c);
    for (const c of innerCallsOf(obj)) inner.push(c);
  }
  const ns = pickNamespace(outer, inner, pay.tool);
  const seq = ns === 'inner' ? inner : outer;
  const calls = [];
  for (const c of seq) {
    const rowKey = attributionKey(c.turnId);
    if (payKey && rowKey && rowKey !== payKey) { excluded += 1; continue; }   // A4
    if (ns === 'inner' && !innerComparable(c, pay)) {
      // 不可比（参数没落全）⇒ 打断连续段但不计入
      calls.push({ fp: incomparableFp(c) });
      continue;
    }
    calls.push({ fp: fingerprint(c.name, c.args) });
  }
  return { calls: calls, excluded: excluded, ns: ns };
}

// 量「末尾连续相同调用」有多少次，并说明这个数**是否精确**。
// 精确 = 找到了一个指纹不同的调用把这段断开（same < calls.length），或者已经读到文件头（!truncated）。
// 不精确 = 窗口里全是相同调用、还可能更早 ⇒ 只能少算不能多算 ⇒ 扩窗重读；触顶仍不确定就按
// 「下界」处理（少拦一次，不误伤）。
function measureTrailing(file, pay, payKey) {
  const cap = maxScanBytes();
  let win = Math.min(tailBytes(), cap);
  let scanned = 0;
  let rounds = 0;
  let excluded = 0;
  let owned = 0;
  let ns = '';
  for (;;) {
    rounds += 1;
    const r = readTail(file, win);
    scanned += r.bytes;
    const parsed = callsFromLines(r.lines, payKey, pay);
    excluded = parsed.excluded;
    owned = parsed.calls.length;
    ns = parsed.ns;
    const calls = parsed.calls;
    const same = trailingSameCount(calls, pay.fp);
    const closed = same < calls.length;
    if (closed || !r.truncated) {
      return { same: same, exact: true, scanned: scanned, rounds: rounds, window: win, excluded: excluded, owned: owned, ns: ns };
    }
    if (win >= cap) {
      return { same: same, exact: false, scanned: scanned, rounds: rounds, window: win, excluded: excluded, owned: owned, ns: ns };
    }
    win = Math.min(win * 4, cap);
  }
}

function main() {
  const raw = process.env.SAR_LOOP_GATE_RAW_STDIN !== undefined
    ? process.env.SAR_LOOP_GATE_RAW_STDIN
    : readStdin();
  const parsed = parseInputStrict(raw);
  if (!parsed.ok) return allow('载荷解析失败：' + parsed.reason);
  const input = parsed.value || {};

  // 只对子代理生效：父会话（没有 agent_type）一律放行 —— 与 guard.mjs 同口径。
  const agentType = String(input.agent_type || '').trim();
  if (!agentType) return allow('');

  const tool = String(input.tool_name || '').trim().toLowerCase();
  if (!tool) return allow('载荷里没有 tool_name');
  const args = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  // 载荷对象：指纹 + 参与指纹的键（内层记录的可比性要用）。
  const pay = { tool: tool, args: args, fp: fingerprint(tool, args) };

  const transcript = String(input.transcript_path || '').trim();
  if (!transcript) return allow('载荷里没有 transcript_path');

  // 归属键：载荷的 turn_id 是「本轮属于谁」的参照键（行侧用同名键对齐，见 attributionKey）。
  const payKey = attributionKey(input.turn_id);

  let m;
  try {
    m = measureTrailing(transcript, pay, payKey);
  } catch (e) {
    return allow('transcript 读不到或解析不了：' + (e && e.message ? e.message : 'unknown'));
  }

  const n = maxSame();
  const same = m.same;
  if (same < n) {
    // 归属键对不上：窗口里有调用，但没有一个属于本轮归属 ⇒ 本子会话的历史看不见
    //（transcript 指向的可能不是本子会话的会话库）⇒ 放行，但必须留痕：
    // 静默放行 = 机制看起来在跑、其实没跑。
    if (m.excluded > 0 && m.owned === 0) {
      return allow('窗口内 ' + m.excluded + ' 个调用都不属于本轮归属键（载荷 turn_id=' +
        (String(input.turn_id || '') || '(空)') + '）⇒ 本子会话的重复调用不可见，放行');
    }
    // 连续数不精确 = 可能还有更早的相同调用没读到（只会少算，不会多算）⇒ 少拦一次，不误伤。
    // 但必须留痕：静默放行 = 机制看起来在跑、其实没跑。
    if (!m.exact) {
      return allow('尾窗内没有能断开末尾连续段的调用，已按上限扩读到 ' + m.window +
        ' 字节（连续数是下界，可能漏拦）');
    }
    return allow('');
  }

  const thisIs = same + 1;
  deny('[super-agent-router] [规则 ' + RULE + '] 无进展重复调用闸门：' +
    '你已经连续第 ' + thisIs + ' 次发起**完全相同**的工具调用' +
    '（工具=' + tool + '，前 ' + same + ' 次的归一化指纹完全一致、中间没有任何别的工具调用）' +
    '⇒ 这一轮不会再产生新信息。请现在就交付当前结论，或说明卡在哪一步、还缺什么；' +
    '确实必须再跑同一条命令，请说明为什么前 ' + same + ' 次没有产出新证据。');
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

// 直接运行时才执行（被测试 import 时不读 stdin、不跑判定）。
const selfPath = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === selfPath;
if (invokedDirectly) main();
