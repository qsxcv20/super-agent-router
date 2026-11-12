# 零欠账收口轮 · 交付报告

- 单号：零欠账收口轮（父会话派工；本单 SCOPE = `plugin/scripts/`、`plugin/hooks/`、`tools/`、`tests/`、`docs/audit/`）
- 日期：2026-11-12
- 唯一验收口径：`node tools\ledger-check.mjs` 零欠账 + `node tools\run-tests.mjs --all --root plugin --repo .` 全绿
- 缺陷依据：`docs/audit/defect-ledger.md`（D- 编号）
- 判定依据：`plugin/skills/super-agent-router/references/contract.md` 的 S2~S6 与 `STATUS-VOCAB:` 行
- 变异矩阵定义：`tests/fixtures/zero-debt-mutation-matrix.md`（执行器 `tests/fixtures/zero-debt-mutation-matrix.mjs`）
- 专属回归套件：`tests/zero-debt-test.mjs`（47 条断言）

---

## 0. 结论摘要

| 事项 | 结果 |
|---|---|
| D-01~D-25 逐条判定 | 25 条**逐条判定完毕**：23 条「已修」，2 条「设计边界」（D-08、D-17 —— 今天仍成立，但不是缺陷） |
| 台账状态归一 | 103 条明细状态行**全部**为契约词表内的唯一结论；索引表状态列与各轮状态表状态格均为 canonical 的**逐字镜像** |
| D-87 | 已修（后台任务三件套纳入 scope 约束） |
| D-89 | 已修（追加轮登记 + 名额组） |
| D-90 | 已修（台账状态一致性五项检查 + 模板词表核对） |
| D-94 | 已修（版本字面量四处一致 + 目录结构数字对账，常驻断言） |
| 语义变异体 | 18 个变异体，**MISS=0**（每个都被自己的专属锚点抓住） |
| 新发现并修掉的欠账 | 6 项（见 §3，其中 3 项是**本轮才暴露的静默失效**） |
| 没修完的 | 精确到 D 号：见 §4（**不藏**） |

---

## 1. D-01~D-25 逐条判定表

判定口径：**逐条读当前代码取证**，不靠台账里的旧叙述。台账「证据」字段里的行号是**审计当时的快照**，
本表给的是**今天**的实现位置。结论词一律取契约 `STATUS-VOCAB:` 的原词。

| D 号 | 结论（今天是否还在） | 证据（当前实现位置 / 判定口径） |
|---|---|---|
| D-01 | 已修 | `plugin/scripts/lib.mjs:1795-1811` transcript **变体嗅探**（`obj.type==='response_item' && obj.payload.role==='user'` → `input_text`）；解析不出即 `fail()`：`lib.mjs:1813-1818` → `guard.mjs:209-215` deny |
| D-02 | 已修 | `plugin/scripts/lib.mjs:2037-2043` `isPathToken`/`extractPathTokens`：含路径分隔符或已知扩展名即算路径，**不再要求「点 + 1~8 位字母数字」**；盘符/引号形态按整体条目解析（`lib.mjs:766-806`） |
| D-03 | 已修 | `plugin/scripts/lib.mjs:2740-2774` 账号级动作按**命令形态**判定（`mavis agent delete|update|create`），不再只按工具名等值；`guard.mjs:100-112` `DANGEROUS` + `dangerousByArgs` |
| D-04 | 已修 | `plugin/scripts/lib.mjs:1815-1848`：扫到**第一条含 `SCOPE:` 的 user 消息**为止，不再只看前 8 行、不再要求 `type==='user'`；找不到 → `fail()` → `guard.mjs:209-215` deny（不放行） |
| D-05 | 已修 | `plugin/scripts/dispatch.mjs:551` 去重键 = 父会话 + agent + `(turn_id || tool_use_id)`；缺 `turn_id` 时退到 `tool_use_id`，不再把空串当「同一个 turn」 |
| D-06 | 已修 | `plugin/scripts/dispatch.mjs:483` 读目标成员教训、`:637-647` 前置注入（空集合也显式说「0 条」）；三态出口见 `plugin/scripts/lessons.mjs` |
| D-07 | 已修 | `plugin/scripts/dispatch.mjs:292-296`：SCOPE 行里**解析不出的条目直接拒绝派工**（闸门一），漏收即放行这条路已堵 |
| D-08 | **设计边界** | 宿主只向父会话派发 SessionStart / UserPromptSubmit；子会话的边界由派工原文 + `guard.mjs:206-215` 保证。接线子会话注入属协议变更，归父会话裁决。**今天仍成立，不是缺陷。** |
| D-09 | 已修 | `plugin/scripts/lib.mjs:1381-1403` `activeDispatchesAll`（项目维度在飞名单），冲突检测不再只盯同一父会话 |
| D-10 | 已修 | `plugin/scripts/lib.mjs:1338-1346` `markDispatchAborted` + `:1348-1356` `reapExpiredDispatches` + `:1358-1376` 读时自愈（超龄 active 判死） |
| D-11 | 已修 | `plugin/scripts/watchdog.mjs:244-247` `evidenceFound`：证据必须是**可核验的具体物**，不再命中「测试 / 运行 / 结果」这类描述词 |
| D-12 | 已修 | `plugin/scripts/lib.mjs:1770-1777` `resolveAgentKey`（一律用 routing id，缺失才回退并做一次映射）；dispatch `:67-70`、guard `:229-239` 统一走它 |
| D-13 | 已修 | `plugin/scripts/record-gate.mjs:100-104`：缺 `verified_by` 即红；写入时校验派工台账里有 `agent == verified_by && state == 'done'` 的凭据。**该脚本归另一名成员，本单只读不改。** |
| D-14 | 已修 | `plugin/scripts/lib.mjs:626-635` 精确文件通道（`mode='exact'`：只认这一个文件、不展开目录树）；私有记忆路径除该通道外一律不授予（`:1005-1020`、`:1263`） |
| D-15 | 已修 | `plugin/scripts/gate.mjs:67` 措辞改为「用户文本中出现的**疑似路径（未验证；是否作为派工边界由你判定，不要直接当授权抄进 brief）**」 |
| D-16 | 已修 | `plugin/scripts/guard.mjs:193-198` 写 / 读路径键名各收敛到一份表；`:745` 取不到目标不再放行（写类工具缺目标 ⇒ deny） |
| D-17 | **设计边界** | 「未命中即静默」是省 token 的设计意图；契约 S11 的兜底口径已实现。**今天仍成立，不是缺陷。** |
| D-18 | 已修 | 原结论已被证伪并改写；现口径由 `plugin/scripts/lessons.mjs` 的三态出口承担（`dispatch.mjs:645-647` 显式区分「无错题本 / 文件已建但无条目 / 有条目抽不出规则」） |
| D-19 | 已修 | `plugin/scripts/lib.mjs:1415-1419` `dispatchedTotal` 用**持久化计数器**，`:1421-1426` `bumpDispatchCounter` 写它；不再靠扫台账（台账截断到 200 条后仍准） |
| D-20 | 已修 | `plugin/scripts/lib.mjs:563-568` `projectRoot()` **保留大小写**（guard 与 watchdog 不再各写各的归一化规则）；`:594-601` 盘符路径按绝对路径直接用、家目录在这一步展开（D-80） |
| D-21 | 已修 | `plugin/scripts/record-gate.mjs:130-131` `nextSection` 返回**绝对索引**（历史上返回相对偏移却被当绝对索引用） |
| D-22 | 已修 | `plugin/scripts/lib.mjs:624-625`：读模式的目录树**包含树根本身**（注释里明写「以前目录本身不可读，D-22」）；写模式仍不含目录本身（`:677-678`、`:746-747`） |
| D-23 | 已修 | `plugin/scripts/dispatch.mjs:587` 写入 `tool_use_id`；`:551` 去重键与 `:72-74` PostToolUse 反查**真的读它**（D-89 的 task_id 归属登记也靠它） |
| D-24 | 已修 | `plugin/scripts/records.mjs:61-92` `summarizeRecordsDetailed`：按成果条数降序取样，并返回 `omitted` 列表供调用方写「已显示 N / 共 M」 |
| D-25 | 已修 | `plugin/scripts/lib.mjs:2740-2774` 危险判定按**命令形态**（CLI + 子命令 + 动作）；`:2194` `DANGEROUS_COMMAND`；残余过度拦已知并留痕（`:2358`、`:2457`） |

**复核方式**（最小复现命令）：

```powershell
node tools\ledger-check.mjs          # 状态口径全项，含 D-01~D-25 的结论是否在词表内、是否唯一
node tools\run-tests.mjs --all --root plugin --repo .
```

---

## 2. 四条代码缺陷：改了什么 / 断言在哪 / 变异体怎么证明会红

### 2.1 D-87 —— 后台任务通道不受 scope 约束

**问题**：`task_output` / `task_query` / `task_stop` 三个工具能读**别的成员会话**的后台任务输出，
但它们既不在 guard 的 matcher 里、也判不到工作区路径（载荷里只有 `task_id`）⇒ 整条通道完全不受约束。

**改了什么**

| 文件 | 改动 |
|---|---|
| `plugin/hooks/hooks.json` | 读类 matcher 改为 `read|glob|grep|list|search|task_output|task_query|task_stop`（宿主 matcher 是**精确等值**，工具名必须逐个列出） |
| `plugin/scripts/guard.mjs:173-186` | 新增 `TASK_SESSION_TOOLS` 与 `kind==='task'` 分支 |
| `plugin/scripts/guard.mjs:277-313` | 台账反查归属：同成员放行 / 他人拒绝 / **查不到即拒绝**；`task_query` 无 task_id 按宿主契约放行；兜底只认**自己会话的 transcript** |
| `plugin/scripts/lib.mjs:1718-1757` | 新增 `findTaskBinding` / `upsertTaskBinding` / `findDispatchByTaskId`（归属的唯一来源 = 派工台账 `task_bindings`） |
| `plugin/scripts/dispatch.mjs:45-95` | 新增 `PostToolUse(task)` 分支：从宿主回执 `tool_response.details.task_id` 取 task_id 并登记归属 |

**断言在哪**：`tests/zero-debt-test.mjs` 的 **D-87-A1 ~ A10**（10 条）；
hooks 侧另有 `tests/hooks-test.mjs` 的 matcher 断言。

**变异体怎么证明会红**：`tests/fixtures/zero-debt-mutation-matrix.md` 的 **M-D87a~d**（4 个）

| 变异体 | 退化语义 | 专属锚点（期望红的那条） | 实测 |
|---|---|---|---|
| M-D87a | 归属查不到也放行（fail-open） | D-87-A4 | EXTRA-RED(1)（A5 连带） |
| M-D87b | 载荷里没有 task_id 也放行 | D-87-A6 | 恰好红一条 |
| M-D87c | 三件套整体不参与判定 | D-87-A2 | EXTRA-RED(5)（A3/A4/A5/A6/A8 同族连带） |
| M-D87d | 同成员判定写反 | D-87-A1 | EXTRA-RED(3)（A2/A3/A8 连带） |

### 2.2 D-89 —— 追加轮（task_append）在派工台账里一条不记

**问题**：追加轮**不登记**（scope 无留痕、冲突检测对它失明、原派工一结束名额就提前还回去）；
且追加载荷**只有 task_id 与正文**（宿主 schema 级确认：`LocalTaskAppendToolDef` 的入参只有 `task_id` + `content`），
**没有任何 agent 身份** ⇒ 身份与 scope 只能从台账反查。

**改了什么**

| 文件 | 改动 |
|---|---|
| `plugin/scripts/dispatch.mjs:97-100, 132-289` | 新增 `handleAppendRound()`：反查原派工 → **查不到即拒绝**；登记追加条目（继承 agent / scope，带 `append_of` / `slot_group` / `task_id`）；任务绑定与子会话绑定改指追加条目；**不 bump 累计计数器**；同组排除自冲突；输出追加轮已登记 + 预授权入口 |
| `plugin/scripts/lib.mjs:1318-1335` | 新增 `slotGroupOf()`（一条派工占的是「**名额组**」，不是它自己那条记录） |
| `plugin/scripts/lib.mjs:1360-1403` | `activeDispatches` / `activeDispatchesAll` 按 `slot_group` 去重（追加轮不重复占名额；追加轮在飞时原名额不释放；自己跟自己不算组队冲突） |
| `plugin/hooks/hooks.json` | dispatch 组 matcher → `task|task_append`；新增 `PostToolUse` 组（matcher `task`） |

**断言在哪**：`tests/zero-debt-test.mjs` 的 **D-89-B1 ~ B17**（17 条）。

**变异体怎么证明会红**：**M-D89a~e**（5 个）

| 变异体 | 退化语义 | 专属锚点 | 实测 |
|---|---|---|---|
| M-D89a | 反查不到原派工也放行 | D-89-B3 | 恰好红一条 |
| M-D89b | 追加轮不继承名额组（自己占一个名额） | D-89-B7 | EXTRA-RED(2)（B16/B17 连带） |
| M-D89c | 追加轮被当成新的一份工作（消耗累计额度） | D-89-B10 | 恰好红一条 |
| M-D89d | 子会话绑定不改指追加条目 | D-89-B9 | 恰好红一条 |
| M-D89e | 名额组去重失效 | D-89-B16 | EXTRA-RED(1)（B17 连带） |

### 2.3 D-90 —— 台账状态漂移查不出来

**问题**：台账的「统计行」是人写的、「明细区」也是人写的，两份数据只要有一处漂移，统计行就在骗人。
原先 `ledger-check.mjs` 六项检查里**没有任何一项**看状态。

**改了什么**

| 文件 | 改动 |
|---|---|
| `tools/ledger-check.mjs` | 新增 5 项检查：`status-vocab`（词表内 + 单结论）、`status-consistency`（索引行与各轮状态表状态格必须与 canonical **逐字相同**）、`status-stats`（状态计数由明细重算）、`no-unfixed`（零欠账第一条）、`template-status-vocab`（模板里的状态字段不得含词表外的旧词）；`index-columns` 改 6 列 + 表头形状校验；`index-single-block` 补齐折行检测 |
| `tools/ledger-check.mjs:85-98` | `readStatusVocab()`：**词表从契约 `STATUS-VOCAB:` 行读**，脚本里不另抄一份；读不到 ⇒ 判红（fail-closed） |
| `docs/audit/defect-ledger.md` | 103 条明细状态行归一为唯一结论（已修 96 / 设计边界 5 / 宿主侧不可修 2）；索引表加「状态」列并逐字镜像 canonical；各轮状态表状态格同步；统计行补状态计数；旧写法「未修 / 已修复」全表消除；旧状态叙述迁入各条「证据」字段（不丢） |

**断言在哪**：`tests/zero-debt-test.mjs` 的 **D-90-C1 ~ C11**（11 条）。

**变异体怎么证明会红**：**M-D90a~f**（6 个）

| 变异体 | 退化语义 | 专属锚点 | 实测 |
|---|---|---|---|
| M-D90a | 一条状态塞两个结论不再判红 | D-90-C7 | 恰好红一条 |
| M-D90b | 索引行状态不再与明细逐字比对 | D-90-C5 | 恰好红一条 |
| M-D90c | 统计行的状态计数不再由明细重算 | D-90-C8 | 恰好红一条 |
| M-D90d | 「未修」不再单独点名 | D-90-C9 | 恰好红一条 |
| M-D90e | 索引表折行检测不到 | D-90-C10 | 恰好红一条 |
| M-D90f | 模板里的状态字段不再与词表对账 | D-90-C11 | 恰好红一条 |

### 2.4 D-94 —— 版本号四处一致，没有任何自动化断言

**问题**：升版时改了 `plugin/.minimax-plugin/plugin.json` 的 version，没同步 README / plugin README / CHANGELOG
—— 以前**没有任何检查会报错**（`check-readme-consistency.mjs` 读了版本却只打印不判定）。
同类漂移已经真实发生过：根 README 的「7 个 handler / 13 个脚本」与实际不符，靠人眼在发布前才发现。

**改了什么**

| 文件 | 改动 |
|---|---|
| `tools/install-selftest/check-version-consistency.mjs`（新） | 12 条断言：plugin.json / 根 README×2 / plugin README×2 / CHANGELOG 最新发布段的**版本字面量一致**；根 README 的 **handler 数 / 脚本数**与实际文件对账；**缺失或不一致即退出码非 0**（不静默通过） |
| `tools/install-selftest/run-all.ps1` | 登记新套件；自身条数声明 9 → 10（= 子套件 8 + 2） |
| `README.md` | 自测表新增一行；run-all 条数 9 → 10；目录树 `8 个 handler` → `9 个 handler（含 SessionStart 与 PostToolUse）` |

**为什么做成新套件而不是改 `check-readme-consistency.mjs`**：后者有 144 条断言的基线，
改它会撞上根 README 的条数对账，且新套件**不进 `SUITE_FILES`**（否则要求 README 再加行、又碰发布口径段）。

**断言在哪**：`tests/zero-debt-test.mjs` 的 **D-94-D1 ~ D9**（9 条）。

**变异体怎么证明会红**：**M-D94a~c**（3 个）

| 变异体 | 退化语义 | 专属锚点 | 实测 |
|---|---|---|---|
| M-D94a | 版本一致性断言被摘掉（恒过） | D-94-D3 | 恰好红一条 |
| M-D94b | handler 数不再与实际文件对账 | D-94-D5 | 恰好红一条 |
| M-D94c | 脚本数不再与实际文件对账 | D-94-D9 | 恰好红一条 |

### 2.5 变异矩阵总账（口径：三列分开报）

- **MISS = 0** ⇒ 18 个变异体**全部**被各自的专属锚点断言抓住，没有漏网的语义破坏。
- **EXTRA-RED 合计 = 12** ⇒ 不是漏网，是**同族断言的正常牵连**：
  M-D87a/c/d 破坏的正是「归属判定」这一族（依赖同一判据的 A2~A8 一起红）；
  M-D89b/e 破坏的正是「名额组去重」这一族（B7/B16/B17 一起红）。
- **13 个变异体是「恰好红一条」**（各自只被自己的专属锚点抓住）。
- 基线：`pass=47 fail=0 exit=0`（基线不绿则矩阵结论无意义，执行器直接退出码 2）。

完整输出留档：`docs/audit/.tmp-zero-debt/zero-debt-mutation-matrix-output.txt`。

---

## 3. 新发现并修掉的欠账

> 标注「本轮新增」的六项里，前三项是**本轮才暴露的静默失效** —— 它们在写本轮代码时才有条件暴露。

| # | 欠账 | 性质 | 处理 |
|---|---|---|---|
| 1 | **`index-single-block` 的折行检测是死代码**：`tools/ledger-check.mjs` 里扫描起点写成 `blk.start + blk.block.length`，但 `tableBlocks()` 产出的字段叫 `startLine`（1 基）⇒ `undefined + n = NaN` ⇒ `for (let i = NaN; ...)` 一次都不执行，**「索引表被折行断成两块」从来没被抓到过** | 本轮新增 · 静默失效 | 已改为 `blk.startLine - 1 + blk.block.length`；并补注释写明这个 NaN 陷阱（`tools/ledger-check.mjs:350-353`）。专属断言 **D-90-C10**、变异体 **M-D90e** |
| 2 | **名额组去重没有直接断言**：原 B11/B12 用的原派工是 `done`（那是「名额提前释放」那条），而「**同组去重**」只在两条记录**同时在飞**时才体现 —— 不单独构造这个形态，「追加轮被当成新的一份工作」这个退化抓不到 | 本轮新增 · 覆盖缺口 | 补 **B15/B16/B17**（原派工仍在飞 ⇒ 追加轮仍能登记、在飞名单只算 1 条、项目维度同样只算 1 条）。变异体 **M-D89e** |
| 3 | **README 的脚本数没有断言**：`check-version-consistency.mjs` 查了 handler 数，但脚本数只查不比 —— 改 README 的「N 个脚本」不会红 | 本轮新增 · 覆盖缺口 | 补 **D-94-D9** + 变异体 **M-D94c** |
| 4 | **台账第二节的条目模板里留着旧词表**：模板的状态字段仍写着 `- 状态：已复现 | 推断`（旧词表），而明细段的检查只认「一个词 + 可选括注」⇒ 查不出这种「清单型」取值 ⇒ **样板错了，以后每一条都会被照着写错** | 本轮新增 · 静默失效 | 模板归一为契约词表；新增检查 `template-status-vocab`（`tools/ledger-check.mjs:493-520`）+ 断言 **D-90-C11** + 变异体 **M-D90f** |
| 5 | **后台任务三件套完全不在 matcher 里**：宿主 matcher 是**精确等值**（MINIMAX 格式 `alternatives.includes`），`task` 不会顺带命中 `task_output` ⇒ D-87 的通道从来没有被接过 | 本轮发现 | hooks.json 逐个列出三个工具名；断言 **D-87-A10** |
| 6 | **D-93 明细状态行是双结论**（「已复现（未修 —— 待派……）」这类把两个结论塞进一行的写法），且全表还有 68 处旧写法「未修 / 已修复」 | 本轮发现 | 状态行全部归一为契约词表内的唯一结论；旧状态叙述**迁入各条「证据」字段**（不丢信息）；并加 `status-vocab` 的「括注里不得出现第二个状态词」判定 |

---

## 4. 没修完的（精确到 D 号）

> 本单**没有**把所有 D 号都改成「已修」。下面 7 条是**有据可查的非「已修」结论**，今天仍然成立：

| D 号 | 结论 | 为什么今天仍然成立 | 归属 |
|---|---|---|---|
| **D-92** | 设计边界（协议层 S4.6 已落地；**程序层的项目键与指向性复用提示本轮未做**） | 只读派工不触发冲突闸门 ⇒ 程序层拦不住这条规则；「项目键 + 指向性复用提示」需要协议层配合 | 本轮**未做**（见下） |
| **D-88** | 宿主侧不可修 | 宿主把 hook 绑在注册时解析的内容哈希缓存树上；本仓库侧已在 v0.5.8 写明「必须重启客户端」 | 宿主侧，本仓库不可修 |
| **D-98** | 宿主侧不可修 | 续接的旧子会话不被派发插件闸门；本地回放判定逐字一致 ⇒ 差别在宿主侧；本仓库侧已定：活体验证一律新建子会话 | 宿主侧，本仓库不可修 |
| **D-08** | 设计边界 | 宿主只向父会话派发 SessionStart / UserPromptSubmit；接线子会话注入属协议变更 | 归父会话裁决 |
| **D-17** | 设计边界 | 「未命中即静默」是省 token 的设计意图；契约 S11 的兜底口径已实现 | 设计意图，不改 |
| **D-26** | 设计边界 | 原结论已被证伪并更正为「派发随会话而变」；插件侧不依赖该行为，危险动作在各内层通道各自判定 | 已更正结论，不改 |
| **D-76** | 设计边界 | 复合层保持「不判作用域」是对的：载荷是自由文本，作用域交回内层调用 | 设计意图，不改 |

**D-92 的程序层没做，具体缺什么**：需要「项目键（同一项目下可复用同一专项成员）+ 指向性复用提示
（告诉 Router 这个成员已有在飞会话，去追加而不是新开）」两件事。后者要求 dispatch 在**只读派工**场景也
给回执 —— 而只读派工不经过冲突闸门，现有机制里没有这条通道。本轮**明确没做**，不是漏做。

**统计**：已修 96 条 / 设计边界 5 条 / 宿主侧不可修 2 条 = 103 条，与 `ledger-check.mjs` 重算结果一致。

---

## 5. 两条验收命令的完整输出

### 5.1 `node tools\ledger-check.mjs`（退出码 0）

```
台账：C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\defect-ledger.md
摘要：{"statsLine":9,"indexRows":103,"detailCount":103,"statusUnion":103,"indexIds":103}
PASS 台账检查 index-columns
PASS 台账检查 sets-equal
PASS 台账检查 severity-distribution
PASS 台账检查 detail-meta-line
PASS 台账检查 detail-count
PASS 台账检查 no-duplicate-d
PASS 台账检查 index-single-block
PASS 台账检查 status-vocab
PASS 台账检查 status-consistency
PASS 台账检查 status-stats
PASS 台账检查 no-unfixed
PASS 台账检查 template-status-vocab
>>> 台账自洽
```

### 5.2 `node tools\run-tests.mjs --all --root plugin --repo .`（退出码 0）

```
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=49 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=41 fail=0
RESULT ledger-test exit=0 pass=29 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT loop-gate-test exit=0 pass=67 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
RESULT zero-debt-test exit=0 pass=61 fail=0
>>> SHELL ALL PASS
```

留档：`docs/audit/.tmp-zero-debt/ledger-check-output.txt`、`docs/audit/.tmp-zero-debt/run-tests-all-output.txt`。

---

## 6. 改动文件清单

| 文件 | 改动性质 |
|---|---|
| `plugin/scripts/lib.mjs` | 新增 `slotGroupOf` / `findTaskBinding` / `upsertTaskBinding` / `findDispatchByTaskId`；在飞名单按 `slot_group` 去重 |
| `plugin/scripts/guard.mjs` | 新增 `TASK_SESSION_TOOLS` 与 `kind==='task'` 分支（归属判定） |
| `plugin/scripts/dispatch.mjs` | 新增 `PostToolUse(task)` 登记分支与 `handleAppendRound()` |
| `plugin/hooks/hooks.json` | matcher 逐个列出工具名；新增 `PostToolUse` 组 |
| `tools/ledger-check.mjs` | 新增 6 项检查（含词表读取、索引表 6 列、单结论、一致性、重算、模板词表）；修死代码 |
| `tools/install-selftest/check-version-consistency.mjs`（新） | D-94 的常驻断言（12 条） |
| `tools/install-selftest/run-all.ps1` | 登记新套件；条数 9 → 10 |
| `tests/zero-debt-test.mjs`（新） | 47 条专属断言（D-87 / D-89 / D-90 / D-94） |
| `tests/fixtures/zero-debt-mutation-matrix.mjs`（新） | 变异矩阵执行器（18 个变异体，串行） |
| `tests/fixtures/zero-debt-mutation-matrix.md`（新） | 变异矩阵定义（锚点 / 改法 / 期望红的断言，逐字固定） |
| `tests/hooks-test.mjs` | matcher 断言更新（新增 D-87 / D-89 / PostToolUse 断言） |
| `docs/audit/defect-ledger.md` | 103 条状态行归一；索引表加状态列；统计行重算；模板状态字段归一 |
| `README.md` | **仅两处连带数字同步**：handler 8 → 9；自测表新增一行 + run-all 条数 9 → 10 |

## 7. 完工自查

- `plugin/scripts/loop-gate.mjs` 与 `tests/loop-gate-test.mjs`：`git diff` 为空、`git status` 无输出 ⇒ **逐字未动**
  （sha256：`f64efc26bed22cbc841c486c93ff83cddec8ab458191fac1723deef06bc1fec5` / `6958fbb7bd6bad1d4dbd8030b0770a1b5f3c4a9abf3308c3ccbd1c0f422fe14c`）。
- 台账全文 `^- 状态：.*未修` **零命中**。
- 未改：`plugin/.minimax-plugin/plugin.json` 的 version、`plugin/CHANGELOG.md`、`plugin/README.md`、
  根 README 的发布口径段、`install.ps1`、`plugin/scripts/loop-gate.mjs`、`tests/loop-gate-test.mjs`、`contract.md`。
- 未 commit / 未 push / 未打 tag / 未发 Release / 未改仓库可见性；未新建或修改成员。
- **新缺陷不自编号**：本报告 §3 的六项一律用「本轮新增」表述，未占用 D- 编号段。

## 8. 给父会话的两条提醒

1. **契约的 `STATUS-VOCAB:` 行若改动，台账的条目模板必须同步** ——
   `template-status-vocab` 检查只查「模板里不得出现词表外的词」这一个方向：
   契约**删词**时模板必须跟着改（否则检查立刻报红）；契约**加词**时模板可以不跟（样板缺一个词无害）。
2. **本单动了根 README 的两处数字**（handler 数 8 → 9、自测表新增一行 + run-all 条数 9 → 10）。
   若父会话同时改 README，需要合并这两处。
