// ── D-97：兼容投影形态（宿主 plugin hook 真正被读的那份文件）────────────────────
//
// 事实（本机实测复核，见 docs/audit/.tmp-d97/）：
//   · 宿主把 plugin PreToolUse 的 transcript_path 指到
//     %TEMP%\minimax-plugin-hooks\transcripts\<sha256(sessionId).slice(0,32)>.compatible.jsonl
//     （**Claude 兼容投影**），不是会话库的 messages.jsonl；
//   · 投影里**没有** message.details.ptc.child_calls[]（PTC 内层调用在投影里不可见）；
//   · 投影里的 tool call 是 Claude 形态 {type:'tool_use', name, input}
//     （不是 {type:'toolCall', arguments}），且**没有**顶层 turn_id。
// ⇒ D-91 的解析器（只认 toolCall + child_calls）在投影上认不出任何调用 ⇒ 末尾连续数恒为 0
//   ⇒ 闸门在真实运行时**一次都没触发**（D-97）。
//
// 本节口径：**按文件形态择一命名空间**，绝不把两套序列混在一起数。
//   · 文件里有 child_calls / toolCall（会话库形态）⇒ 走原有内层/外层口径（逻辑逐字不变）；
//   · 文件里有 tool_use（兼容投影形态）⇒ 走本节的外层口径。
//
// ── 内层 payload ↔ 外层调用的指纹对齐规则（精确定义）─────────────────────────
//
// 前提：PTC 形态下宿主把 plugin PreToolUse 派发在**子调用**上 ⇒ 载荷是**内层**形态
//   （tool_name='bash'、tool_input={command}），而投影里只有**外层** run_code
//   （{type:'tool_use', name:'run_code', input:{code,...}}）。
//   两个命名空间的指纹**永不相等** ⇒ 必须先对齐再比（否则仍是 D-97 的静默失效）。
//
// 定义（投影口径）：
//   (1) 外层条目 E = 投影 content[] 里 type==='tool_use' 的元素，按出现顺序编号；
//       E.name = 工具名，E.args = E.input，E.code = E.input.code。
//   (2) **内层尾调用** tail(E) = E.code 里**最后一个** tools.<name>( 调用的
//       （工具名, 参数文本）。取最后一个的理由：外层 code 里的内层调用是**顺序执行**的
//       ⇒ 最后一个就是该外层调用**最后执行**的那个内层调用。
//       参数文本按花括号配平截取（跳过字符串字面量里的括号）。
//   (3) **可比性** compare(tail(E), 载荷) ∈ {match, mismatch, unknown}：
//       · tail 工具名 ≠ 载荷工具名 ⇒ mismatch（别的调用 ⇒ 打断连续段）；
//       · 载荷工具的指纹键集取自 fingerprintKeySet()：bash⇒command、read⇒path+offset+limit、
//         glob/grep⇒pattern+path、其余⇒全部参数（按全部参数取的 ⇒ 代码文本里没法逐键比
//         ⇒ unknown，打断连续段但不计入）；
//       · 从 tail 的参数文本里逐键取字面量值：键缺失 ⇒ 该调用没有这个键
//         （与载荷同缺 ⇒ 可比；与载荷有值 ⇒ mismatch）；
//         键的值是变量/表达式 ⇒ **取不出** ⇒ unknown；
//       · 取到的值与载荷的值按**同一个归一**比较（command/pattern⇒折叠空白、
//         path⇒斜杠归一+Windows 大小写不敏感、offset/limit⇒字符串相等）；
//       · 全部键相等 ⇒ match。
//   (4) **当前调用定位**：cur = 最后一个「与载荷可比且相等」的外层条目
//       （外层是 run_code 时按 (2)(3) 判；外层直接就是载荷工具时按指纹全等判）。
//       定位不到 ⇒ 无法把载荷归到任何已落盘的调用 ⇒ 放行 + stderr 留痕（不静默）。
//   (5) **计数**：prior = cur 之前的全部外层条目；末尾连续相同数 = 从 prior 末尾往前，
//       连续 compare(tail(E), 载荷) === match 的条数（mismatch 与 unknown 都打断连续段；
//       unknown 额外**不计入** ⇒ 宁可少拦不可误伤）。
//   (6) 外层条目 E 若**不是** run_code（宿主自己的其它工具，如 task_append）
//       ⇒ mismatch（打断连续段）。
//
// 为什么按「外层条目的内层尾调用」计数、而不是按外层 code 全文比较：
//   外层 code 全文相同 **不蕴含** 内层调用连续相同（同一段 code 里两个内层调用之间
//   可能夹着别的调用）⇒ 按 code 全文比会**凭空造出**连续重复 ⇒ 误伤；
//   内层尾调用口径只认「最后执行的那个内层调用」⇒ 与「连续 N 次完全相同的工具调用」对齐。

// 从一行里取出「兼容投影」形态的外层调用（Claude 形态：type='tool_use' + input）。
export function projectionCallsOf(obj) {
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
      if (item.type !== 'tool_use') continue;
      const input = (item.input && typeof item.input === 'object' && !Array.isArray(item.input)) ? item.input : {};
      out.push({
        name: String(item.name || ''),
        args: input,
        code: String(input.code === undefined ? '' : input.code),
        turnId: turnId
      });
    }
  }
  return out;
}

// 收集窗口里的全部投影外层条目（按出现顺序）。
function projectionCallsOfLines(lines) {
  const out = [];
  for (const line of lines) {
    // 便宜预筛：真实投影里绝大多数行是工具结果（大块文本），不预筛就得把整窗 JSON.parse 一遍。
    if (line.indexOf('tool_use') < 0) continue;
    let obj = null;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    for (const c of projectionCallsOf(obj)) out.push(c);
  }
  return out;
}

// 外层 code 里**最后一个**内层调用（tools.<name>(...））⇒ {tool, argsText}；没有则 null。
export function innerTailOf(code) {
  const s = String(code == null ? '' : code);
  const re = /\btools\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m = null;
  let last = null;
  while ((m = re.exec(s)) !== null) last = { tool: m[1], argsStart: re.lastIndex };
  if (!last) return null;
  let i = last.argsStart;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  if (s[i] !== '{') return { tool: last.tool, argsText: '' };
  // 花括号配平（跳过字符串字面量里的括号）。
  let depth = 0;
  let j = i;
  let quote = null;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (quote) {
      if (ch === '\\') { j += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { j += 1; break; } }
  }
  return { tool: last.tool, argsText: s.slice(i, j) };
}

// 从一段 JS 对象字面量文本里读一个键的字面量值；读不出（变量/表达式/模板插值）⇒ undefined。
function readLiteralValue(s) {
  let i = 0;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  const ch = s[i];
  if (ch === '"' || ch === "'" || ch === String.fromCharCode(96)) {
    let out = '';
    let j = i + 1;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') {
        const nx = s[j + 1];
        if (nx === 'n') out += '\n';
        else if (nx === 't') out += '\t';
        else if (nx === 'r') out += '\r';
        else if (nx === '\\') out += '\\';
        else if (nx === '"') out += '"';
        else if (nx === "'") out += "'";
        else out += nx;
        j += 1;
        continue;
      }
      if (c === ch) { j += 1; break; }
      out += c;
    }
    if (ch === String.fromCharCode(96) && out.indexOf('$' + '{') >= 0) return undefined;   // 模板插值 ⇒ 取不出
    return out;
  }
  const num = /^-?\d+(?:\.\d+)?/.exec(s.slice(i));
  if (num) return num[0];
  return undefined;
}

// 从一段对象字面量文本里逐键取字面量值。
// 返回 {values:{键:值|undefined}, dynamic:[取不出的键]}。
export function argValuesOf(argsText, keys) {
  const text = String(argsText == null ? '' : argsText);
  const values = {};
  const dynamic = [];
  for (const key of keys) {
    const re = new RegExp('(?:^|[{,\\s])[\'"]?' + key + '[\'"]?\\s*:\\s*', 'g');
    const m = re.exec(text);
    if (!m) { values[key] = undefined; continue; }
    const v = readLiteralValue(text.slice(m.index + m[0].length));
    if (v === undefined) { values[key] = undefined; dynamic.push(key); continue; }
    values[key] = v;
  }
  return { values: values, dynamic: dynamic };
}

// 按指纹键的语义归一（与 fingerprint() 的口径保持一致）。
function normByKey(key, v) {
  if (key === 'command' || key === 'pattern') return normText(v);
  if (key === 'path') return normPathKey(v);
  return String(v);
}

// 比较：外层条目的内层尾调用与载荷是否**同一次调用**。
// 返回 'match' | 'mismatch' | 'unknown'（unknown = 参数取不出 ⇒ 打断连续段但不计入）。
export function tailMatches(tail, pay) {
  if (!tail || !pay) return 'unknown';
  if (String(tail.tool) !== String(pay.tool)) return 'mismatch';
  const keySet = fingerprintKeySet(pay.tool);
  if (keySet === null) return 'unknown';   // 按全部参数取指纹的工具 ⇒ 代码文本里没法逐键比
  const payArgs = (pay.args && typeof pay.args === 'object') ? pay.args : {};
  const ext = argValuesOf(tail.argsText, keySet);
  if (ext.dynamic.length) return 'unknown';
  for (const k of keySet) {
    const got = ext.values[k];
    const want = payArgs[k];
    if (got === undefined) {
      if (want !== undefined && want !== '') return 'mismatch';
      continue;
    }
    if (want === undefined || want === '') return 'mismatch';
    if (normByKey(k, got) !== normByKey(k, want)) return 'mismatch';
  }
  return 'match';
}

// 直接形态的外层条目（投影里记的就是载荷工具本身）与载荷是否同一次调用。
function directEntryMatches(entry, pay) {
  if (String(entry.name) !== String(pay.tool)) return false;
  const recArgs = (entry.args && typeof entry.args === 'object') ? entry.args : {};
  const payArgs = (pay.args && typeof pay.args === 'object') ? pay.args : {};
  const keySet = fingerprintKeySet(pay.tool);
  if (keySet === null) {
    const rk = Object.keys(recArgs).sort();
    const pk = Object.keys(payArgs).sort();
    if (rk.length !== pk.length) return false;
    for (let i = 0; i < rk.length; i++) if (rk[i] !== pk[i]) return false;
  } else {
    for (const k of keySet) {
      if (!(k in recArgs)) return false;
      if (!(k in payArgs)) return false;
    }
  }
  return fingerprint(entry.name, recArgs) === pay.fp;
}

// 投影口径的末尾连续计数（择一：投影形态专用，绝不与内层序列混数）。
// 返回 {same, cur, prior, aligned}：cur = 当前调用所在的外层条目下标；aligned = 定位到了没有。
export function projectionTrailing(entries, pay) {
  const list = Array.isArray(entries) ? entries : [];
  let cur = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (String(e.name) === String(pay.tool)) {
      if (directEntryMatches(e, pay)) { cur = i; break; }
      continue;
    }
    if (String(e.name) === 'run_code') {
      const tail = innerTailOf(e.code);
      if (tailMatches(tail, pay) === 'match') { cur = i; break; }
      continue;
    }
  }
  if (cur < 0) return { same: 0, cur: -1, prior: 0, aligned: false };
  let same = 0;
  for (let i = cur - 1; i >= 0; i--) {
    const e = list[i];
    let verdict;
    if (String(e.name) === String(pay.tool)) {
      verdict = directEntryMatches(e, pay) ? 'match' : 'mismatch';
    } else if (String(e.name) === 'run_code') {
      verdict = tailMatches(innerTailOf(e.code), pay);
    } else {
      verdict = 'mismatch';
    }
    if (verdict !== 'match') break;
    same += 1;
  }
  return { same: same, cur: cur, prior: cur, aligned: true };
}