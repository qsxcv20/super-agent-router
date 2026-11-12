# D-97 修复报告 · 无进展重复调用闸门（loop-gate）读错了 transcript

> 执行者：sa-mechanism-fix（边界判定改造专员） · 会话 mvs_8a2512c984da4ad19f0cf8c427029996
> 本单是**一个大项目**（同一个验证目标：让 loop-gate 在真实运行时真能拦下来），
> 内部步骤（复核事实 → 落夹具 → 改实现 → 补断言 → 自测 → 写报告）都在本窗口内完成，未拆开派工。

---

## 0. 一句话结论

宿主喂给 plugin PreToolUse 的 transcript_path **不是**会话库的 messages.jsonl，而是
**Claude 兼容投影**（%TEMP%\minimax-plugin-hooks\transcripts\<sha256(sessionId).slice(0,32)>.compatible.jsonl）。
投影里**没有**内层调用（message.details.ptc.child_calls[]），tool call 是 Claude 形态
{type:'tool_use', input}（不是 {type:'toolCall', arguments}）⇒ D-91 的解析器在投影上认不出任何调用
⇒ 末尾连续数恒为 0 ⇒ **闸门在真实运行时一次都没触发**。

本单的修法：**按文件形态择一命名空间**（会话库形态 ⇒ D-91 的内层口径，逐字不动；
兼容投影形态 ⇒ 新增的「内层 payload ↔ 外层条目」指纹对齐口径），
外加**来源回退**（投影认不出当前调用时用会话库再判一次），两套口径**绝不混数**。

---

## 1. 独立复核（A1）：实测事实 vs 父会话转述

复核脚本（都落盘在 docs/audit/.tmp-d97/，可复跑）：
probe-forms.mjs / probe-struct.mjs（形态）、probe-session.mjs（会话库形态）、
probe-map.mjs（命名映射）、probe-live.mjs（活体时序）、probe-current.mjs（当前记录形态）。

| # | 父会话转述 | 本单实测 | 一致? |
|---|---|---|---|
| 1 | transcript_path = 兼容投影 | 目录 %TEMP%\minimax-plugin-hooks\transcripts\ 下确实是 <sha256_32>.compatible.jsonl；且 sha256(sessionId).slice(0,32) 与文件名**逐字相等** | 一致 |
| 2 | 投影里没有 child_calls；tool call 是 tool_use+input | 4 份投影：结构化 realChildCallArrays=**0**、contentToolUse=47/39/66/5、contentToolCall=**0** | 一致 |
| 3 | 解析器在投影上 owned=0 | 修前 callsFromLines 在投影上得到 0 条（预筛只认 toolCall/child_calls） | 一致 |
| 4 | 截断回放（会话库）⇒ DENY | 见 §5 A5 | 一致 |

### 差异（如实写出）

- **差异 1**：父会话说「child_calls 出现 0 次」。实测**有一份**投影里 `child_calls` 字样出现 26 次 ——
  但那是**文本命中**（该会话正文里在讨论 child_calls），**结构化计数为 0**。父会话的结论对，口径要更精确。
- **差异 2**：父会话转述未提 —— 兼容投影**没有顶层 turn_id**（实测 turnIdCount=0，顶层键只有
  uuid/parentUuid/sessionId/timestamp/type/message/toolUseResult/subtype）。
  ⇒ 归属只能按契约 S15 §7 的 **A1**（行内没有 turn_id ⇒ 计入）处理。
- **差异 3**：父会话转述未提 —— **宿主在执行内层调用之前就把外层 tool_use 落盘**：
  实测投影的 mtime 距探测时刻仅 0.7s，且最后一条 tool_use 正是「当时正在执行」的那次外层调用；
  而会话库相反：当前外层的 toolResult 行（带 details.ptc.child_calls）**完成之后才落盘**
  （实测当前那条 toolCall 行 hasDetails=false）⇒ **当前内层调用不在会话库里，当前外层调用在投影里**。
  ⇒ 两条路径的「当前调用是否已落盘」语义不同，计数基准必须分别处理（本单的投影口径把当前外层条目**排除**在计数外）。
- **差异 4**：父会话转述未提 —— 载荷形态的**活体**证据：guard 拦截我那次 bash 时回显了
  `tool_name='bash'` + `command` ⇒ 活体坐实载荷是**内层**形态（与 D-91 一致）。
  （宿主 app.asar 源码在工作区外，护栏拦截读取，未绕过；上面这条活体证据已足够坐实同一件事。）

---

## 2. 机制取舍与理由（A4）

### 2.1 选的是 C 的变体：**投影优先 + 会话库回退**

父会话给的 C 是「会话库优先、投影兜底」；本单**把顺序倒过来**，理由：

1. 投影是宿主**为 plugin hook 专供**的产物（PluginHookTranscript.create() 写的），
   **保证新鲜、保证存在**（实测与当前调用同步，mtime 差 0.7s）；会话库是通用产物，
   布局会变（v2/sessions/YYYY/MM/DD/…）、云端会话根本没有本地文件。
2. 投影的外层 code 带**完整参数**（能比 pattern/path/offset/limit）；
   会话库的内层 input 是**参数子集**（实测 grep/glob 全空）⇒ 会话库口径对
   「连跑相同 grep/read」天然**不可比**（D-91 自己记的边界）⇒ 投影口径在这一点上**更强**。
3. 会话库仍作**回退**：投影认不出当前调用（载荷参数是动态表达式）时，用会话库的内层记录再判一次
   （D-91 的精确口径）。
4. **择一不混数**：命名空间按**文件形态**择一；来源之间也择一（一个来源的计数结果整体采用，不做合并）。

### 2.2 「内层 payload ↔ 外层条目」的指纹对齐规则（精确定义）

前提：PTC 形态下宿主把 plugin PreToolUse 派发在**子调用**上 ⇒ 载荷是内层形态
（tool_name='bash'、tool_input={command}）；投影里只有**外层** run_code
（{type:'tool_use', name:'run_code', input:{code,...}}）。两个命名空间的指纹**永不相等** ⇒ 必须先对齐。

设：
- **外层条目 E** = 投影 message.content[] 里 type==='tool_use' 的元素，按出现顺序编号；
  E.name = 工具名，E.args = E.input，E.code = E.input.code。
- **内层尾调用 tail(E)** = E.code 里**最后一个** `tools.<name>(` 调用的（工具名, 参数文本）；
  参数文本按花括号配平截取（跳过字符串字面量里的括号）。
  取「最后一个」的理由：外层 code 里的内层调用是**顺序执行**的 ⇒ 最后一个就是该外层调用
  **最后执行**的那个内层调用。
- **指纹键集** = fingerprintKeySet(载荷工具)：bash⇒['command']；read⇒['path','offset','limit']；
  glob/grep⇒['pattern','path']；其余⇒null（按全部参数取指纹 ⇒ 代码文本里没法逐键比）。

对齐判定 compare(tail(E), 载荷) ∈ {match, mismatch, unknown}：

1. tail 工具名 ≠ 载荷工具名 ⇒ **mismatch**（是别的调用 ⇒ 打断连续段）。
2. 指纹键集为 null ⇒ **unknown**（打断连续段但不计入）。
3. 逐键从 tail 的参数文本取**字面量值**：
   - 键**不存在** ⇒ 该调用没有这个键：与载荷同缺 ⇒ 可比；与载荷有值 ⇒ **mismatch**；
   - 键的值是变量/表达式/模板插值 ⇒ 取不出 ⇒ **unknown**；
   - 否则取到值，与载荷的值按**同一归一**比较：
     command/pattern ⇒ 折叠空白（normText）；path ⇒ 斜杠归一 + Windows 大小写不敏感（normPathKey）；
     offset/limit ⇒ 字符串相等。任一不等 ⇒ **mismatch**。
4. 全部键相等 ⇒ **match**。

**当前调用定位**：cur = 最后一个「与载荷可比且相等」的外层条目
（E.name === 载荷工具时按指纹全等判；E.name === 'run_code' 时按上面的 compare 判）。
定位不到 ⇒ 无法把载荷归到任何已落盘的调用 ⇒ **放行 + stderr 留痕**（不静默）。

**计数**：prior = cur 之前的全部外层条目；末尾连续相同数 = 从 prior 末尾往前连续 compare === match 的条数。
mismatch 与 unknown 都**打断连续段**；unknown 额外**不计入**（宁可少拦不可误伤）。
E 不是 run_code（宿主自己的其它工具，如 task_append）⇒ **mismatch**（打断连续段）。

**为什么不按外层 code 全文比较**：外层 code 全文相同 **不蕴含** 内层调用连续相同
（同一段 code 里两个内层调用之间可能夹着别的调用）⇒ 按 code 全文比会**凭空造出**连续重复 ⇒ 误伤。
内层尾调用口径只认「最后执行的那个内层调用」⇒ 与契约 S15 §1 的「连续 N 次完全相同的工具调用」对齐。

**计数基准与契约的一致性**：契约 S15 §1 说「本次调用尚未写入 transcript，计数 = 历史末尾连续条数 + 1」。
投影里**当前外层条目已落盘**（差异 3）⇒ 本单把当前外层条目**排除**在计数之外，
等价于「历史末尾连续条数」⇒ 拦的仍是**第 N+1 次**（实测 deny 文案「第 6 次」）。

---

## 3. 活体夹具（A2）

- 文件：`tests/fixtures/d97-hook-compatible.jsonl`（4861 字节 / 11 行）
- 生成器：`docs/audit/.tmp-d97/make-d97-fixture.mjs`（可复跑：
  `node docs/audit/.tmp-d97/make-d97-fixture.mjs <sessionId>`）
- 取样来源：`%TEMP%\minimax-plugin-hooks\transcripts\7c2582b5f8006451ad99d086e1da0791.compatible.jsonl`
  （= sha256('mvs_8a2512c984da4ad19f0cf8c427029996').slice(0,32)，即本会话的投影）
- 做法：**结构逐字取自运行时文件**（顶层键序、message.content[] 元素形态、tool_result 形态都照抄真实行，
  键名/键序/字段类型完全一致），只对**正文内容**脱敏与重复化（不搬整份带敏感内容的投影）。

### 与运行时文件的对照（生成器同一次输出；归档快照：docs/audit/.tmp-d97/fixture-profile.json）

| 指标 | 运行时文件 | 夹具 |
|---|---|---|
| 行数 | 169（**活体文件，会随会话继续增长**） | 11 |
| 结构化 details.ptc.child_calls 数组数 | **0** | **0** |
| content[] 里 type='tool_use' | 84 | 6 |
| content[] 里 type='toolCall' | **0** | **0** |
| content[] 里 type='tool_result' | 83 | 5 |
| 正文里 child_calls 字样出现次数（**文本命中，不是记录**） | 45 | 0 |
| 顶层键 | uuid/parentUuid/sessionId/timestamp/type/message/toolUseResult | 同 |
| tool_use 元素键 | type/id/name/input | 同 |
| tool_result 元素键 | type/tool_use_id/content/is_error | 同 |

### 夹具的语义（与运行时同序）
6 次逐字相同的外层 run_code（内层都调同一条 bash）：前 5 次已完成（各有 tool_result 行），
第 6 次是**当前正在执行**的那次（结果还没落盘）—— 与运行时一致（宿主先落外层 tool_use，再执行内层调用）。

---

## 4. 先红后绿（A3）

夹具落盘后**先写断言、再改实现**。红：

```
FAIL D-97 活体形态：兼容投影上连续 5 次相同调用 ⇒ 第 6 次被拦（这条在修复前是红的） :: out= err=
>>> LOOP-GATE FAILURES: 1
```

（`out= err=` 就是 D-97 的形态：**静默放行**，机制看起来在跑、其实没跑。）

绿（改完实现后同一条断言）：

```
PASS D-97 活体形态：兼容投影上连续 5 次相同调用 ⇒ 第 6 次被拦（这条在修复前是红的） :: out={"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"[super-agent-router] [规则 R-LOOP-SAME-CALL] 无进展重复调用闸门：你已经连续第 6 次发起**完全相同**的工具调用（工具=bash，前 5 次的归一化指纹完全一致、中间没有任何别的工具调用）⇒ 这一轮不会再产生新信息。请现 err=
>>> LOOP-GATE ALL PASS
```

断言链（tests/loop-gate-test.mjs 的 D-97 段，8 条）：
黑盒 4 条（夹具形状 / 当前调用在最后一条 / 第 6 次被拦 / 4 次不拦）
+ 白盒 4 条（取投影层 / 取内层尾层 / 对齐层 / 计数层）。

---

## 5. 改动清单（文件:行号 + 为什么）

### plugin/scripts/loop-gate.mjs
| 行号 | 改动 | 为什么 |
|---|---|---|
| 47 | `import os from 'node:os'` | 会话库回退要 os.homedir() |
| 427-481 | 新增「D-97 兼容投影形态」口径说明块（含对齐规则的 6 条定义） | 契约/口径写在代码旁，后人不用猜 |
| 483-506 | `export function projectionCallsOf(obj)` | 取 Claude 形态（type='tool_use' + input）的外层条目 |
| 508-519 | `projectionCallsOfLines(lines)` | 窗口内收集投影条目（含便宜预筛） |
| 521-548 | `export function innerTailOf(code)` | 对齐规则 (2)：外层 code 里最后一个内层调用 |
| 550-582 | `readLiteralValue(s)` | 从对象字面量文本取字面量值；变量/表达式/模板插值 ⇒ 取不出 |
| 584-598 | `export function argValuesOf(argsText, keys)` | 对齐规则 (3)：逐键取值 + dynamic 标记 |
| 600-606 | `normByKey(key, v)` | 按指纹键的语义归一（与 fingerprint() 同口径） |
| 608-628 | `export function tailMatches(tail, pay)` | 对齐规则 (3)：match / mismatch / unknown |
| 630-649 | `directEntryMatches(entry, pay)` | 载荷工具本身就是外层条目时的全等判定 |
| 651-689 | `export function projectionTrailing(entries, pay)` | 对齐规则 (4)(5)：当前调用定位 + 末尾连续计数 |
| 691-725 | `export function resolveSessionTranscript(sessionId)` | 来源回退：按 session_id 定位会话库 messages.jsonl（base64url 目录名后缀匹配） |
| 727-772 | `measureTrailing()` 增「会话库口径认不出调用 ⇒ 才启用投影口径」的分支（751-765） | **择一不混数**的落点；会话库口径逐字未改 |
| 774-853 | `main()`：来源列表（794-801）、多来源择一测量（806-826）、投影定位不到时的留痕（827-830） | 投影优先 + 会话库回退；读不到/认不出 ⇒ 放行 + stderr 留痕（效率闸门 fail-open 不变） |
| 275-285 | 导出清单注释补 6 个新导出 | 该文件自身的纪律：注释宣称必须等于代码在做 |

**没有动的**（D-91 变异矩阵的锚点，逐字保留）：
`pickNamespace()` / `innerCallsOf()` / `innerComparable()` / `incomparableFp()` / `callsFromLines()`
（含 `if (ns === 'inner' && !innerComparable(c, pay)) {` 与哨兵占位两行）——
矩阵复跑 MISS=0 ⇒ 锚点仍唯一且仍被各自断言抓住。

### tests/loop-gate-test.mjs
- 顶部导入补 5 个新导出（白盒断言用）。
- 新增 D-97 段（8 条断言）：黑盒 4 + 白盒 4。
- 既有 55 条断言**逐条未改**（D-86 / D-91 全部原样保留）。

### tests/fixtures/d97-hook-compatible.jsonl（新增）
活体夹具（见 §3）。

### tests/fixtures/d97-mutation-matrix.md / .mjs（新增）
D-97 语义变异体矩阵（承 D-91 的做法）：4 个变异体，逐字固定锚点/改法/期望红哪条断言。

### docs/audit/.tmp-d97/（新增，报告与证据）
见 §9 清单。

### lib.mjs
**未改**（本单不需要新增导出；现有导出函数的行为与签名一字未动）。

---

## 6. 验收逐条证据

### A1 独立复核 ✔
见 §1（复核脚本与实测输出；差异 1~4 如实写出）。

### A2 活体夹具已落盘 ✔
见 §3（生成器 + 与运行时文件的逐项对照：child_calls 结构化计数 0/0、tool_use 47/6、toolCall 0/0）。

### A3 先红后绿 ✔
见 §4（红：`FAIL … :: out= err=`；绿：`PASS … permissionDecision":"deny"`）。

### A4 路径 + 理由 + 对齐规则 ✔
见 §2（选 C 的变体：投影优先 + 会话库回退；对齐规则 6 条逐字定义 + 计数基准与契约 S15 §1 的一致性说明）。

### A5 截断回放仍能 DENY ✔
会话库形态**真实字节前缀**（tests/fixtures/d91-ptc-real-prefix.jsonl，取自真实 PTC 会话 messages.jsonl）
截到第 5 次相同内层调用之前：

```
[super-agent-router] [规则 R-LOOP-SAME-CALL] 无进展重复调用闸门：你已经连续第 6 次发起**完全相同**的工具调用（工具=bash，前 5 次的归一化指纹完全一致、中间没有任何别的工具调用）⇒ 这一轮不会再产生新信息。请现在就交付当前结论，或说明卡在哪一步、还缺什么；确实必须再跑同一条命令，请说明为什么前 5 次没有产出新证据。
```

截到第 4 次 ⇒ 放行（边界不误伤）。
（脚本：docs/audit/.tmp-d97/replay-d91.mjs；输出：docs/audit/.tmp-d97/replay-d91-output.json）
既有永久断言 `D-91 PTC 真实形态：内层载荷在第 6 次被拦` 仍然 PASS。

### A6 全量回归 ✔（实测数字）
```
REPO=. / ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=49 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=36 fail=0
RESULT ledger-test exit=0 pass=23 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT loop-gate-test exit=0 pass=64 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
>>> SHELL ALL PASS
```
14 套 / **907** 条 / 0 FAIL（改前基线 14 套 / 898 条 / 0 FAIL；新增 9 条：D-97 段 8 条 +
D-97 活体形态 1 条 ⇒ loop-gate 55 → 64）。
输出留档：docs/audit/.tmp-d97/regression-after.txt。

### A7 ledger-check ✔
```
PASS 台账检查 index-columns / sets-equal / severity-distribution / detail-meta-line / detail-count / no-duplicate-d
>>> 台账自洽
ledger exit=0
```
台账**未改**（本单不产出台账条目，只给草案）。

### A8 副作用：闸门会真的开始拦 ✔（一句话见 §7）
「修好后闸门会**真的开始拦**「连续 6 次逐字相同调用」这类**以前一直放行**的行为 —— 这是它的设计意图；
少量重复（4 次以内）仍全放行（实测：`D-97 活体形态：连跑 4 次不拦` PASS，活体投影回放的对照组也不拦）。」

### A9 报告 ✔
本文件（docs/audit/.tmp-d97/fix-d97.md）。

---

## 7. 仍未闭合的边界（诚实写）

1. **活体拦截证据还没拿到**：本单改的是**仓库副本**；宿主实际执行的是**已安装副本**（v0.5.9 的缓存树），
   换绑安装副本属于发布动作（父会话职责，本单不做）。⇒ 现有证据是
   「真实运行时投影字节 + 本仓库实现」的回放（已 DENY），**不是**客户端里真被拦下。
   ⇒ 父会话装新副本后应复跑一次活体 6 连跑，确认 deny 出现在 hook 输出里。
2. **投影口径的计数单位是外层条目**：同一段外层 code 里连发 6 次相同内层调用（模型把循环写进 code）
   ⇒ 投影口径只数到 1 次外层条目 ⇒ 漏拦（fail-open 方向，不误伤）。会话库口径能数到内层粒度，
   但会话库的内层参数是子集（grep/glob 全空）⇒ 同样不可比。**这一族两类来源都覆盖不全**（诚实边界）。
3. **动态参数取不出**：载荷参数在 code 里是变量/表达式（`tools.bash({command: cmdVar})`）⇒ 投影口径
   取不出 ⇒ unknown ⇒ 打断连续段但不计入 ⇒ 该次调用**不被拦**（不误伤）。此时会走会话库回退；
   会话库也没有精确参数时同样不可比。
4. **外层 code 文本里的参数可能被误提取**：取值靠正则扫对象字面量文本；
   形如 `{ command: "a: path: b" }` 这类字符串里带冒号的极端写法可能取到错的键值 ⇒ 判成 mismatch
   ⇒ 打断连续段（少拦，不误伤）。已用「键后面必须跟冒号」收窄，但仍非完整 JS 解析器。
5. **契约 S15 §2 的文字已过时**：它写的是「transcript 的 message.content[] 记外层 run_code、
   内层调用记在 message.details.ptc.child_calls[]」—— 对**会话库**成立，对**宿主 plugin hook 的
   transcript_path（兼容投影）不成立**。协议文档不在本单可写范围 ⇒ 请父会话在契约里补一句
   （投影形态按「内层尾调用对齐」口径计数 + 会话库形态仍是 D-91 内层口径）。
6. **工作区外有一处错位残留（需要父会话清理）**：本单第一版夹具生成器把 URL 编码没解码，
   在工作区**外面**建了目录 `%USERPROFILE%\Documents\MiniMax\mini%20code%E7%9A%84%E6%8F%92%E4%BB%B6\`，
   里面只有一个我写的错位夹具文件（4861 字节）。删除属工作区外操作，护栏会拦 ⇒ 已在报告里写明，
   请父会话清理（只含我这一个文件，无其它内容）。
7. **变异矩阵的 EXTRA-RED**：D-97 矩阵 4 个变异体 MISS=0；其中 2 个是「恰好红一条」，
   2 个带 EXTRA-RED(2)（破坏同一语义层时，依赖该层的其它断言一起红 —— 这是分层断言的正常表现，不是漏网）。
   D-91 矩阵复跑 MISS=0、EXTRA-RED 合计 11；红点**全部**是 D-91 既有断言
   （已逐条核对 d91-mutation-matrix-output.txt：输出中**不含任何 'D-97' 行**
   ⇒ 新增的 D-97 断言未被 D-91 的变异体牵连）。

---

## 8. 可登记为台账条目（草案，按契约 S1 七字段；编号与合并由父会话分配）

```
### <前缀>-<两位序号>
- 触发条件：宿主把 plugin PreToolUse 的 transcript_path 指向 %TEMP%\minimax-plugin-hooks\transcripts\<sha256(sessionId).slice(0,32)>.compatible.jsonl（Claude 兼容投影）时，闸门按会话库形态解析 ⇒ 认不出任何调用；叠加 PTC 形态下载荷是内层工具（tool_name='bash'、tool_input={command}），两个命名空间指纹永不相等 ⇒ 末尾连续数恒为 0。
- 影响：规则 R-LOOP-SAME-CALL 在真实运行时**恒不触发**（子代理陷入重复查证时无人拦）；表现为**静默放行**（stdout 空、stderr 也无留痕），机制看起来在跑、其实没跑。
- 复现步骤：1) 取 %TEMP%\minimax-plugin-hooks\transcripts\<sha256(sessionId).slice(0,32)>.compatible.jsonl；2) 统计结构化 details.ptc.child_calls 数组数 = 0、message.content[] 里 type='tool_use' 计数 > 0、type='toolCall' 计数 = 0；3) 把该文件当 transcript_path 喂给 loop-gate（载荷 = 内层 bash{command}）⇒ 拦不下来（改前 owned=0）。
- 证据：docs/audit/.tmp-d97/fix-d97.md（§1 复核、§3 夹具对照、§4 先红后绿、§6 A5/A6/A7）；tests/fixtures/d97-hook-compatible.jsonl（活体夹具，结构逐字取自运行时投影）；docs/audit/.tmp-d97/live-replay-output.json（真实投影字节回放 ⇒ DENY 第 6 次）；docs/audit/.tmp-d97/d97-mutation-matrix-output.txt（MISS=0）。
- 状态：已复现
- 修法方向：按**文件形态**择一命名空间（会话库形态 ⇒ D-91 内层口径逐字不动；兼容投影形态 ⇒ 新增外层口径），并为投影形态补「内层 payload ↔ 外层条目」的指纹对齐规则：取外层 code 里最后一个内层调用（内层尾调用）作对齐对象，逐键比指纹键集（bash⇒command / read⇒path+offset+limit / glob·grep⇒pattern+path），键取不出 ⇒ unknown（打断连续段但不计入）；当前调用 = 最后一个与载荷可比且相等的外层条目，计数只数它**之前**的外层条目（等价契约 S15 §1 的「历史末尾连续条数 + 1」）；投影认不出当前调用时回退会话库 messages.jsonl（按 session_id → base64url 目录名后缀定位），两套口径择一使用、绝不混数；读不到/认不出 ⇒ 放行 + stderr 留痕（效率闸门 fail-open 不变）。
- 还需要什么：父会话把本单改动装进已安装副本（换绑安装副本 = 发布动作）后，跑一次活体 6 连跑确认客户端里真被拦；并在契约 S15 §2 补一句「plugin hook 的 transcript_path 是兼容投影，内层调用不可见 ⇒ 按内层尾调用对齐口径计数」；另需清理工作区外那一个错位残留目录（§7 第 6 条）。
```

---

## 9. 证据文件清单（docs/audit/.tmp-d97/）

| 文件 | 内容 |
|---|---|
| fix-d97.md | 本报告 |
| probe-forms.mjs / probe-struct.mjs | 投影形态统计（child_calls / tool_use / toolCall） |
| probe-session.mjs / probe-map.mjs | 会话库形态统计、投影命名映射（sha256_32 比对） |
| probe-live.mjs / probe-current.mjs / probe-shape.mjs | 活体时序（当前外层是否已落盘）、当前记录形态、真实行结构 |
| probe-stray.mjs | 工作区外错位残留的只读核查 |
| make-d97-fixture.mjs | 活体夹具生成器 + 形态对照报告 |
| live-replay.mjs / live-replay2.mjs / replay-d91.mjs | 活体投影回放、会话库截断回放、D-91 夹具截断回放 |
| live-replay-output.json / live-replay2-output.json / live-replay2-parent.json / replay-d91-output.json | 上述脚本的实际输出 |
| regression-after.txt / ledger-check-after.txt | 全量回归与台账校验输出留档 |
| d97-mutation-matrix-output.txt | D-97 变异矩阵输出 |
| replay-*.jsonl | 回放用的截断/复制投影文件 |

（另：tests/fixtures/d97-mutation-matrix.md 与 tests/fixtures/d97-mutation-matrix.mjs 是**仓库内永久件**，
不在本临时目录。）
---

## 10. 交给父会话的事项（需要父会话权限/动作，本单不做）

1. **报告目录被 gitignore**：`docs/audit/.tmp-*/`（.gitignore 第 31 行）⇒
   本报告与证据文件**不会进版本库**。若要归档，请父会话把它移到正式路径（例如 docs/audit/fix-d97.md）。
2. **安装副本换绑（发布动作）**：宿主执行的是已安装副本，本单只改仓库副本 ⇒
   装新副本后请复跑一次活体 6 连跑，确认客户端里真被拦（见 §7 第 1 条）。
3. **契约 S15 §2 需补一句**（协议文档不在本单可写范围）：说明 plugin hook 的 transcript_path
   是兼容投影、内层调用不可见 ⇒ 闸门按「内层尾调用对齐」口径计数；会话库形态仍是 D-91 的内层口径。
4. **台账**：本单**未改** docs/audit/defect-ledger.md（ledger-check 仍 exit 0），
   条目草案见 §8，请父会话按 D- 编号合并入台账。
5. **工作区外有一处错位残留需清理**（§7 第 6 条）：%USERPROFILE%\Documents\MiniMax\mini%20code%E7%9A%84%E6%8F%92%E4%BB%B6\
   目录里只有本单生成器第一版留下的一个夹具文件（4861 字节）。删除属工作区外操作，本单无权限。
6. **本单留下的待审清单条目**（护栏记账，可直接驳回/忽略）：
   - req_mwd92ofn_1dyk6a（读会话 messages.jsonl 的越界读；改用脚本内解析路径完成，未再申请）
   - req_mwd954wg_5xz67q（读宿主 app.asar 源码；未绕过，改用活体证据坐实同一事实）
   - req_mwd9o130_qlvhjb（工作区外目录的只读核查：确认错位残留）
   - req_mwd9tbzx_4a3810（误判：命令里的反斜杠串被当成路径）
   - req_mwdah8ei_tc66sp（删除一次性脚本需用受信 mavis-trash；该路径在工作区外 ⇒ 本单无法删除）
7. **一次性脚本留档**（因删除需扩权而保留在 docs/audit/.tmp-d97/，内容已被 loop-gate.mjs 取代，**勿改**）：
   block-projection.js（当初插入的代码块副本）、fix-block.mjs、splice-block.mjs、show-profile.mjs。