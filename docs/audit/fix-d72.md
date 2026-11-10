# D-72 修复报告：watchdog 把「这个文件没有创建」判成「声称产出」

> 缺陷正文见 `docs/audit/defect-ledger.md` 的 **D-72** 条目（不在此复述）。
> 本报告只写：怎么修的、凭什么断定修好了、还剩什么没解决、要父会话做什么。
> 条目模板见 `plugin/skills/super-agent-router/references/contract.md` 第一节。

## 1. 一句话结论

watchdog 的「声称产出」判定以前是**行级 + 肯定式动词表**：一行里只要出现产出动词，
**这一行里的所有路径**都被当成「我声称产出了它」，然后逐个校验存在性。
否定式陈述（「X 没有创建」）与**引用的护栏拒绝原文**（原文里有「如确需修改」+ 越界路径）
都会被这条规则扫中 ⇒ 诚实的交付报告被连续 block。

改法不是「往动词表里加词」，而是把判定拆成四层，各自独立成规则：

| 层 | 规则 | 作用 |
|---|---|---|
| 归属 | **子句级归属**：路径归属到它所在的子句，不是它所在的行 | 引用原文里的路径不再被同行别的动词「认领」 |
| 断言性 | **否定式判定**（独立一条规则）+ **非断言语境判定** | 「没有创建」「未创建」「不该创建」「是否…被创建」「声称创建过」都不是产出声明 |
| 路径形态 | **家目录展开**（`~ / $HOME / %USERPROFILE%`）+ **通配符按模式处理** | 真实存在的家目录文件不再被当成「不存在」；通配符不再被截成碎片路径 |
| 存在性 | 路径存在性校验**只对肯定式产出**生效 | 肯定式声明里的文件不存在，仍必须被拦 |

另加：每条 block 消息带**规则编号**（`R-CLAIM-PATH-MISSING` / `R-NO-EVIDENCE` /
`R-EMPTY-DELIVERY` / `R-ENTRY-FORMAT`），断言要能指认命中的是哪条规则
（同族教训 D-70：断言若命中的是别的分支，就是假绿）。

## 2. 活体证据（不是合成载荷）

### 2.1 第一次触发：探针成员的如实报告被连 block 三次

- 探针子会话：`mvs_73441ff316ed4d2db69fe88e9b17eeb3`
- transcript 文件：`60ad84299515c2c59d548909b75624ae.compatible.jsonl`
- transcript 绝对路径：`C:\Users\yang2\AppData\Local\Temp\minimax-plugin-hooks\transcripts\60ad84299515c2c59d548909b75624ae.compatible.jsonl`
- 原始行（父会话逐行复制，未改写）：`docs/audit/live-trigger-evidence.txt`

时间线（transcript 内时间戳，UTC）：

| 时间 | 事件 |
|---|---|
| 2026-11-10T13:04:57.090Z | worker 交出**第一份报告**（如实写「第 2 步：失败，被护栏当场拒绝」，并把拒绝原文抄了下来） |
| 2026-11-10T13:05:07.914Z | watchdog 第 1 次 block：「你声称产出了这些文件……：docs/audit/live-probe-outside.txt。要么真的创建它们，要么如实说明没做。」 |
| 2026-11-10T13:05:31.709Z | worker 交出**核实结果**（「那个文件**不存在**，这是第 2 步被成功拦截的正确结果，不是缺失交付物」） |
| 2026-11-10T13:05:40.164Z | watchdog 第 2 次 block（同一句话） |
| 2026-11-10T13:06:01.522Z | worker 第三次如实说明：「那个文件**我没有创建**，而且**不应该**创建」 |
| 2026-11-10T13:06:10.087Z | watchdog 第 3 次 block（同一句话） |

**活体里最关键的一行**（worker 的 thinking，13:05:40.164Z 之后）——它说明机制在逼成员改口：

> "the best action: a very short, unambiguous final report where the deliverable file list
> contains exactly ONE path (the one that exists), and the non-created one is described
> clearly but the automated check may still trip."

成员已经开始**把交付说明改写成能骗过闸门的形状**。这就是 D-72 第二层后果的实锤：
成员越界那个文件（`docs/audit/live-probe-outside.txt` 明确在白名单外）时，
机制实际上在把它往「真的去创建它」的方向推。

### 2.2 第二次触发：**机制拦了我自己这一轮的交付报告**

本轮修复完成后的交付报告被 SubagentStop 闸门当场拦下：

```
[super-agent-router] 你声称产出了这些文件，但它们在磁盘上不存在：~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs, /scripts/watchdog.mjs。要么真的创建它们，要么如实说明没做。
```

那条报告是**如实**的：它只是提到了安装副本与运行时缓存树的位置。两条被判「不存在」的路径：

1. `~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs` —— **真实存在**，
   但 `absolutizePath()` 不展开 `~`，于是被拼成 `<工作区根>/~/.minimax/...` → `existsSync` 必假；
2. `/scripts/watchdog.mjs` —— 是 `.../sha256-tree-v1-*/scripts/watchdog.mjs` 这个**通配符模式被截断后的碎片**，
   根本不是一个文件。

这次触发来自**仍在部署的旧副本**（消息里没有规则编号，可据此判定），但它把两条**潜伏**的根因暴露出来：
即便换成新实现，只要那句话所在的子句里出现产出动词，同样会被拦。

复现（把本轮交付报告原文喂进去，项目根 = 仓库根，与运行时一致）：

```
改前(HEAD)   : {"decision":"block","reason":"[super-agent-router] 你声称产出了这些文件，但它们在磁盘上不存在：~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs, /scripts/watchdog.mjs。要么真的创建它们，要么如实说明没做。"}
改后(工作树) : ALLOW（stdout 为空）
```

复现脚本：`docs/audit/.tmp-d72/real-root-repro.mjs`（载荷 = `docs/audit/.tmp-d72/final-message.txt`）。

**同一条路径后来又咬了一次**：本轮最终交付消息因为同样提到这两处位置，被**尚未部署的旧副本**再次拦下
（消息里同样没有规则编号）。这说明这不是一次性的巧合，而是「未部署的旧副本会拦任何
如实提及它自己部署位置的报告」—— 只要它还在运行时，机制就会持续要求「真的创建那个文件」
（这里指的是安装副本本身）。因此部署是这条缺陷的**最后一段**，不是收尾工作。

### 2.3 改前为什么会被判成「声称产出」（逐条定位）

改前算法（`plugin/scripts/watchdog.mjs`）：按行过滤 → 行内有产出动词就整行留下 →
剥掉引用子句 → 把留下的行**拼起来**再抽路径 token。于是：

| 活体原文（片段） | 为什么被误判 |
|---|---|
| 「如确需**修改**，先更新 scope 并重新派工」（**引用**的护栏拒绝原文里） | 「修改」是肯定式动词 ⇒ 整行留下 ⇒ 同一行里的越界路径 `docs/audit/live-probe-outside.txt` 被抽出来校验存在性 |
| 「未验证 `X` 是否在别处被**创建**」 | 否定标记离动词太远，且动词在疑问从句里 ⇒ 旧判定认不出 |
| 「那个文件我**没有创建**」 | 「没有创建」里含「创建」⇒ 旧判定认不出否定 |
| 「白名单外文件确认**未被创建**」 | 同上 |
| 「安装副本 `~/.minimax/.../watchdog.mjs`」（§2.2） | `~` 不展开 ⇒ 真实存在的文件被判「不存在」 |
| 「`.../sha256-tree-v1-*/scripts/watchdog.mjs`」（§2.2） | 通配符不在路径字符类里 ⇒ token 被从中间截断，碎片被当成文件 |

## 3. 复现步骤（改前 / 改后都能跑）

工装在版本库里，不依赖临时草稿目录：

```
# ① 改前 / 改后对照（原始输出）
$env:SAR_MUTATION='2'; node tests/e2e-test.mjs
#   → "=== D-72 否定式产出陈述 vs 肯定式产出陈述 ==="

# ② 变异矩阵（回退实现 → 目标断言必须转红）
$env:SAR_MUTATION='1'; node tests/e2e-test.mjs

# ③ 常规断言
node tools/run-tests.mjs --all --root plugin --repo .
```

活体载荷本身被**逐字**嵌进 `tests/chain-test.mjs`（`LIVE_REPORT_1` / `LIVE_REPORT_3`，
即 §2.1 时间线里 13:04:57.090Z 与 13:06:01.522Z 两份报告的原文）。嵌入由
`docs/audit/.tmp-d72/inject-d72-payloads.mjs` 从 `docs/audit/live-trigger-evidence.txt`
抽取后注入并**回读校验**，不手工转录，避免抄错。

## 4. 改前 / 改后原始输出

### 4.1 版本库工装（`SAR_MUTATION='2'`）

```
=== D-72 否定式产出陈述 vs 肯定式产出陈述 ===
  改前（HEAD）：否定式（没有创建）：BLOCK | {"decision":"block","reason":"[super-agent-router] 你声称产出了这些文件，但它们在磁盘上不存在：docs/audit/live-probe-outside.txt。要么真的创建它们，要么如实说明没做。"} / 肯定式（已创建，文件不存在）：BLOCK | {"decision":"block","reason":"[super-agent-router] 你声称产出了这些文件，但它们在磁盘上不存在：docs/audit/live-probe-outside.txt。要么真的创建它们，要么如实说明没做。"}
  改后（工作树）：否定式（没有创建）：ALLOW（stdout 为空） / 肯定式（已创建，文件不存在）：BLOCK | {"decision":"block","reason":"[super-agent-router] [规则 R-CLAIM-PATH-MISSING] 你声称产出了这些文件，但它们在磁盘上不存在：docs/audit/live-probe-outside.txt。要么真的创建它们，要么如实说明没做。"}
```

**两行都要看**：否定式改前被 block、改后放行；肯定式改前改后**都**被拦 ——
修否定式没有打开新的放行口子。

### 4.2 活体三份报告（同一夹具、同一环境）

夹具与活体状态一致：白名单内的 `docs/audit/.tmp-live/probe-inside.txt` **存在**，
白名单外的 `docs/audit/live-probe-outside.txt` **从未被创建**。

```
=== 活体 report-1（第一份报告） ===
  改前(HEAD):   block | 你声称产出了这些文件，但它们在磁盘上不存在：docs/audit/live-probe-outside.txt。要么真的创建它们，要么如实说明没做。
  改后(工作树): ALLOW（stdout 为空）
=== 活体 report-2（核实结果） ===
  改前(HEAD):   block | ……docs/audit/live-probe-outside.txt……
  改后(工作树): ALLOW（stdout 为空）
=== 活体 report-3（第三次如实说明） ===
  改前(HEAD):   block | ……docs/audit/live-probe-outside.txt……
  改后(工作树): ALLOW（stdout 为空）
=== 否定式：X 没有创建 ===      改前 BLOCK  →  改后 ALLOW
=== 否定式：X 未创建 ===        改前 BLOCK  →  改后 ALLOW
=== 否定式：X 不该创建 ===      改前 BLOCK  →  改后 ALLOW
=== 肯定式：已创建 X（X 不存在）=== 改前 BLOCK  →  改后 BLOCK（[规则 R-CLAIM-PATH-MISSING]）
=== 肯定式：改动文件 X（X 不存在）== 改前 BLOCK  →  改后 BLOCK（[规则 R-CLAIM-PATH-MISSING]）
```

### 4.3 本轮交付报告自己（§2.2）

```
改前(HEAD)   : block | …不存在：~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs, /scripts/watchdog.mjs。要么真的创建它们，要么如实说明没做。
改后(工作树) : ALLOW（stdout 为空）
```

## 5. 改动清单

| 文件 | 改了什么 |
|---|---|
| `plugin/scripts/watchdog.mjs` | 产出判定重写：子句级归属 + 否定式判定（独立规则）+ 非断言语境判定 + 家目录展开 + 通配符按模式处理；block 消息带规则编号 |
| `tests/chain-test.mjs` | 新增 D-72 断言 18 条 + N-03/N-04 断言 5 条（含 2 份活体原文载荷） |
| `tests/e2e-test.mjs` | 新增 D-72 断言 2 条；变异矩阵新增 5 个 D-72 变异体；`SAR_MUTATION='2'` 新增 D-72 改前/改后对照场景 |
| `docs/audit/fix-d72.md` | 本报告 |

未改动：`plugin/scripts/lib.mjs`（家目录展开直接复用它**已有**的 `expandHomePath()` 导出，签名与语义未动）、
`record-gate.mjs` / `lessons-gate.mjs` / `records.mjs` / `roster.mjs`、
`plugin/skills/super-agent-router/references/` 下的协议文档、`plugin/README.md`、`plugin/CHANGELOG.md`、版本号。

## 6. 断言与变异体的对应关系

**规则编号**（block 消息里可指认命中的是哪条）：
`R-EMPTY-DELIVERY` / `R-NO-EVIDENCE` / `R-CLAIM-PATH-MISSING` / `R-ENTRY-FORMAT`。

| 断言（`tests/chain-test.mjs`） | 钉住哪条规则 | 对应变异体 |
|---|---|---|
| D-72 活体报告一（第一份汇报）不再被 block | 子句级归属 + 否定式 + 非断言语境（三条一起） | M-D72a / M-D72b / M-D72c |
| D-72 活体报告一没有命中「声称产出但文件不存在」这条规则 | 规则编号可指认 | M-D72a / M-D72b / M-D72c |
| D-72 活体报告三（第三次如实说明）不再被 block | 同上（三条一起） | M-D72b / M-D72c |
| D-72 活体报告三没有命中「声称产出但文件不存在」这条规则 | 规则编号可指认 | M-D72b / M-D72c |
| D-72 否定式「没有创建」不触发路径存在性校验 | 否定式判定 | M-D72a |
| D-72 否定式「未创建」不触发路径存在性校验 | 否定式判定 | M-D72a |
| D-72 否定式「不该创建」不触发路径存在性校验 | 否定式判定 | M-D72a |
| D-72 否定式「不会被创建」不触发路径存在性校验 | 否定式判定 + 助词剥离 | M-D72a |
| D-72 否定式「并非创建」不触发路径存在性校验 | 否定式判定 | M-D72a |
| D-72 否定式「未被创建」不触发路径存在性校验 | 否定式判定 + 助词剥离 | M-D72a |
| D-72 否定式「并没有创建」不触发路径存在性校验 | 否定式判定 | M-D72a |
| D-72 肯定式「已创建」里文件不存在仍被拦 | 存在性校验（不许回归） | —（任何变异体都不得转红） |
| D-72 肯定式「改动文件」里文件不存在仍被拦 | 存在性校验（不许回归） | — |
| D-72 肯定式「路径在前 + 已修改」仍被拦 | 存在性校验 + 路径在前形态 | — |
| D-72 命中的是「无证据」那条规则而不是「声称产出」那条 | 规则编号可区分不同规则 | — |
| D-72 引用的护栏拒绝原文里的路径不被当成声称产出 | 子句级归属 | M-D72c |
| D-72 疑问从句里的「被创建」不触发路径存在性校验 | 非断言语境判定 | M-D72b |
| D-72 引述句里的「声称创建过」不触发路径存在性校验 | 非断言语境判定 | M-D72b |
| N-03 家目录写法（~）按真实家目录判存在性：存在的文件不被拦 | 家目录展开 | M-D72d |
| N-03 家目录写法（~）按真实家目录判存在性：不存在的文件仍被拦 | 家目录展开（反向，防放行口子） | — |
| N-04 通配符路径不被截成碎片路径触发拦截 | 通配符整体识别 + 按模式处理 | M-D72e |
| N-04 通配符路径不参与存在性校验 | 同上 | M-D72e |
| N-04 跳过通配符不影响普通路径的拦截 | 同上（反向，防放行口子） | — |

另有 `tests/e2e-test.mjs` 两条（真实 stdin/stdout 契约下）：否定式放行 / 肯定式仍被拦。

**「反向断言」的用意**：带「仍被拦 / 不影响普通路径」字样的断言**不得**被任何变异体转红 ——
它们是「不许为了修否定式而打开放行口子」的守门断言。

## 7. 变异矩阵（`$env:SAR_MUTATION='1'; node tests/e2e-test.mjs`）

| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |
|---|---|---|---|---|
| M-D72a | D-72 | 否定式产出判定被摘掉（`const negated = isNegatedBefore(...)` → `false`） | 7 | YES |
| M-D72b | D-72 | 非断言语境判定被摘掉（`const embedded = EMBED_MARKERS.some(...)` → `false`） | 4 | YES |
| M-D72c | D-72 | 子句级归属被摘掉（`CLAUSE_SPLIT` 退化成只按换行切 ⇒ 退回行级归属） | 5 | YES |
| M-D72d | D-72 | 家目录展开被摘掉（`expandHomePath(p, HOME_DIR)` → `p`） | 1 | YES |
| M-D72e | D-72 | 通配符跳过被摘掉（模式又被当成文件去校验存在性） | 2 | YES |

矩阵整体：10 个变异体（含 D-37~D-41）全部「目标断言全部转红 = YES」，工装自身 0 FAIL。

变异点都写在 `tests/e2e-test.mjs` 的 `MUTATIONS` 里（**随仓库走**，不放在会被 gitignore 的草稿目录），
只改系统临时目录里的插件副本，仓库工作树零改动。

M-D72c 是**近似**改前实现（改前还有「行内有动词才保留」这一层），不是逐字还原；
这条限制写在该变异体的 `what` 里，不假装等价。

**变异工装抓到过我自己的一条假绿**：初版断言「`src/*.ts` 不参与存在性校验」在
M-D72e 下**没有**变红 —— 因为 `src/*.ts` 被路径正则截成了 `ts`（无分隔符，被另一条规则顺手放过），
断言根本没碰到通配符那条规则。修法是把路径正则的「扩展名前一位」也允许通配符，
让模式被**整体**认出来，断言这才真正咬住规则（改动后 M-D72e 转红 2 条）。
这正是「断言若命中的是别的分支，就是假绿」的又一次现场演示。

## 8. 回归数字（如实）

`node tools/run-tests.mjs --all --root plugin --repo .`（2026-11-10，仓库副本为 root）

```
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=33 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=29 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=92 fail=0
RESULT scope-test exit=0 pass=33 fail=0
>>> SHELL ALL PASS
```

- **11 套 / 707 条断言 / 0 FAIL**，耗时 **78.5 ~ 81.5 秒**（同一份代码复跑 4 次，区间如实写出；单次最近一次 79.6 秒）。
- 本次新增断言 **25 条**（chain-test 23：18 条 D-72 + 5 条 N-03/N-04；e2e-test 2 条）。
- 变异矩阵 10 个变异体全部「目标断言全部转红 = YES」，工装自身 0 FAIL。
- **并发说明**：`roster.mjs` / `roster-test.mjs` 由另一位成员并行改；本次全量回归时
  roster-test 为 **38 PASS / 0 FAIL**，没有因并发改动失败。未改动任何属于那位成员的文件。

### 测试夹具环境

- `MINIMAX_PROJECT_DIR` / `PLUGIN_DATA` 在每一处调用都**显式传**，指向临时目录
  （chain-test 用 `mkdtemp` 下的 `proj` 与 `data`；e2e-test 同理）。
- N-03 的断言需要在**真实家目录**下有一个存在的文件才能证明「~ 被展开了」，因此用
  `mkdtempSync(os.homedir())` 造一个临时目录、断言完立刻删除（不残留）。
- watchdog 只往 `PLUGIN_DATA` 下的 `dispatches.json` 写台账（`lib.mjs:57` `ledgerPath()`），
  本次改动没有触碰任何写项目变更账的路径（`scope-amend.mjs` 未被本次回归的用例触发）⇒
  测试记录**没有**写进真实项目的变更账。

## 9. 新发现的缺陷

编号规则与条目模板见 `plugin/skills/super-agent-router/references/contract.md` 第一节。

### N-01
- 触发条件：交付文本里同一**行**既有产出动词、又有与该动词无关的路径 —— 典型是**引用**护栏自己的拒绝原文（原文含「如确需修改」+ 越界路径），或同一行里先写「输出 X」再写「Y 不存在」。
- 影响：该行里**所有**路径都被当成「声称产出」⇒ 存在性校验失败 ⇒ 诚实的报告被 block。与 D-72 的否定式触发条件**互相独立**（不需要任何否定词），且不需要子句分隔符。
- 复现步骤：交付文本写一行「已创建 src/real.ts。护栏拒绝原文：……以下路径不在白名单内：docs/audit/ghost.txt。如确需修改……」（真实例子见活体 report-1）→ watchdog 要求 `docs/audit/ghost.txt` 存在。
- 证据：活体子会话 `mvs_73441ff316ed4d2db69fe88e9b17eeb3`，2026-11-10T13:05:07.914Z 的 block 消息；改前实现 `plugin/scripts/watchdog.mjs` 的 `claimedPaths()`（行过滤 → 剥引用子句 → **拼行**后抽路径）。
- 状态：已复现 → 已修（本轮）。
- 修法方向：路径归属从「行」改成「**子句**」—— 路径由它所在子句里的产出动词认领，认领它的动词若非断言则该路径不是声称产出。
- 还需要什么：无，代码路径已确定。

### N-02
- 触发条件：watchdog 的四条 block 消息都不带规则编号 —— 收到 block 的人（成员、父会话、验收方）无法区分「空交付」「无证据」「声称产出但文件不存在」「条目格式不合规」。
- 影响：诊断只能靠猜文案关键词；验收断言若只判「被拦」，就会在命中**别的**分支时假绿（同族教训 D-70：「断言要能指认是哪条规则在拦」）。
- 复现步骤：跑一条只命中 R-NO-EVIDENCE 的载荷（如「搞定了，测试通过」）与一条只命中 R-CLAIM-PATH-MISSING 的载荷 → 改前两条消息除了内容不同、没有可机器识别的标识。
- 证据：改前 `plugin/scripts/watchdog.mjs` 的 `block(reason)` 只有 `{decision, reason}`；本轮改后消息形如 `[super-agent-router] [规则 R-NO-EVIDENCE] ……`。
- 状态：已复现 → 已修（本轮）。
- 修法方向：每条 block 带稳定的规则编号，并让断言按编号判定而不是按文案关键词判定。
- 还需要什么：无，代码路径已确定。

### N-03
- 触发条件：交付文本里出现**家目录写法**的路径（`~/` / `$HOME/` / `%USERPROFILE%/`），而 `lib.mjs` 的 `absolutizePath()` **不展开家目录** —— 它只认盘符与 `/` 开头，其余一律拼到工作区根下。
- 影响：**真实存在的文件被判成「不存在」** ⇒ 路径存在性校验失败 ⇒ 诚实的报告被 block。活体证据：本轮修复完成后的交付报告被当场拦下（消息原文见 §2.2），被判「不存在」的正是**确实存在**的安装副本 `~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs`。
- 复现步骤：交付文本写「已创建 ~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs」→ watchdog 要求 `<工作区根>/~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs` 存在 → 必拦。
- 证据：§2.2 的 block 消息（活体）与 `docs/audit/.tmp-d72/real-root-repro.mjs` 的逐字复现；代码位置 `plugin/scripts/lib.mjs:207` `absolutizePath()`（不展开 `~`）与改前 `plugin/scripts/watchdog.mjs` 的 `claimedPaths()`。
- 状态：已复现 → 已修（本轮）：watchdog 判存在性前先用 `lib.mjs` **已有**的 `expandHomePath(p, home)` 展开（不改动 lib 的签名与语义）。
- 修法方向：**家目录展开是判定的一环，不是字符串美化** —— `guard.mjs` 侧早就因此把 `expandHomePath()` 抽成纯函数（见 **D-65 的修复轮**：判定锚点换成插件包身份后，把家目录展开抽成纯函数 `expandHomePath()`；以及 **D-70**：上一轮「四种家目录写法都被拦」的断言是假绿），存在性校验这一侧漏了；应把展开放进「解析成绝对路径」的那一步，而不是每个调用方各自记得展开。
- 还需要什么：`absolutizePath()` 本身仍不展开家目录（它在本轮 SCOPE 外）；建议父会话后续把展开下沉到 `absolutizePath()` 内部，或至少在契约里写明「判存在性前必须展开家目录」。

### N-04
- 触发条件：交付文本里出现**通配符路径**（`src/*.ts`、`.../sha256-tree-v1-*/scripts/watchdog.mjs`）—— 改前的路径正则字符类里没有通配符，路径 token 会**从中间被截断**。
- 影响：截出来的碎片（`.../sha256-tree-v1-*/scripts/watchdog.mjs` → `/scripts/watchdog.mjs`）被当成「声称产出的文件」→ 必假 → 诚实的报告被 block；碎片还可能被当成**工作区外**的路径，指认一个成员根本没提过的文件。
- 复现步骤：交付文本写「已创建 ~/.minimax/v2/plugin-hook-cache/sha256-tree-v1-*/scripts/watchdog.mjs」→ watchdog 要求 `/scripts/watchdog.mjs` 存在 → 必拦。
- 证据：§2.2 的 block 消息（活体，第二个被判「不存在」的路径就是那个碎片）；代码位置改前 `plugin/scripts/watchdog.mjs` 的 `PATH_TOKEN`（字符类无 `*?`）。
- 状态：已复现 → 已修（本轮）：通配符进路径字符类（模式被**整体**认出来，不再截断），且含通配符的 token 是**模式**、不是文件，不参与逐文件存在性校验。
- 修法方向：**模式不是文件** —— 逐文件的存在性校验对 glob 没有意义，判它「不存在」必然是假阳性；但模式必须被整体识别，否则截断碎片会继续冒充文件。
- 还需要什么：glob 声明（「已创建 src/*.ts」）目前**不做**「至少命中一个文件」的校验 —— 这是诚实的边界，不是漏判：逐文件的产出核对不适用于模式。若父会话认为需要，应另立一条「模式至少命中一个」的规则并单独断言。

## 10. 残余风险

1. **否定 / 语境判定是词表驱动的，不可能穷尽。** 漏识别一种新说法时，失败方向是
   **误拦**（回到 D-72 的老症状），不是放行 —— 这是刻意选的取舍：宁可吵，不可放。
   但误拦**同时**会重新触发 D-72 第二层（把成员往「真的创建那个文件」推）。
   缓解：两张表集中在 `NEGATION_MARKERS` 与 `EMBED_MARKERS`，加词只改一行；
   block 消息带规则编号，成员/父会话能一眼看出是哪条规则在拦。
2. **子句切分靠标点表。** 一整句没有任何标点分隔的超长中文句子会落进同一个子句，
   归属判定会偏保守（可能仍被当成肯定式产出）。
3. **glob 声明不做逐文件核对**（见 N-04「还需要什么」）。
4. **「声称产出」只看交付文本。** 产出若只出现在工具结果或附件里而不写进交付文本，
   一概不校验 —— 这是既有口径，本次未改（属另一条待议项）。
5. **家目录展开目前做在 watchdog 侧。** `lib.mjs` 的 `absolutizePath()` 本身仍不展开，
   下一个用它判存在性的脚本会重蹈覆辙（见 N-03「还需要什么」）。
6. **改动只在仓库副本。** 安装副本与运行时缓存树仍是改前实现（见 §11），
   在部署之前，**运行时缺陷依然存在** —— §2.2 就是部署前的现场证据。
7. **M-D72c 是近似改前实现**（见 §7），不能当作「逐字还原改前代码」的证据。
8. 本轮只动了 `plugin/scripts/watchdog.mjs` 一个脚本文件；判定所需的纯函数
   （`splitClauses` / `isNegatedBefore` / `clauseVerbs` / `ownerVerb`）留在 watchdog 内部，
   没有抽到 `lib.mjs` 做成可被单测直接 import 的纯函数 —— 因为 `lib.mjs` 不在本轮 SCOPE 内。
   代价是这些判定只能经由子进程（hook 契约）断言，不能像 `expandHomePath()` 那样被单测直接钉住；
   下一个动 watchdog 的人若要更细的粒度，应把这些函数抽到 `lib.mjs` 并配专属单测。

## 11. 需要父会话处理的事

1. **部署（最要紧）**：仓库副本已修好，但**安装副本与全部运行时缓存树仍是改前实现**
   （实测 `~/.minimax/plugins/super-agent-router/scripts/watchdog.mjs` 与
   `~/.minimax/v2/plugin-hook-cache/sha256-tree-v1-*/scripts/watchdog.mjs` 均无
   `NEGATION_MARKERS` / `R-CLAIM-PATH-MISSING`）。**部署之前运行时缺陷依然存在** ——
   本轮交付报告被拦（§2.2）就是部署前的现场证据，不是理论推演。部署归父会话
   （`tools/deploy-plugin.mjs`）。
2. **台账状态**：`docs/audit/defect-ledger.md` 的 D-72 条目状态由父会话统一改为「已修」，
   并把 N-01~N-04 并入台账（合并台账编号由父会话分配）。本报告不改台账、不发版。
3. **协议文档**：`plugin/skills/super-agent-router/references/contract.md` 的 S8 段落
   目前只写了「收尾契约校验」；「肯定式 / 否定式产出的判定口径」「判存在性前必须展开家目录」
   要不要写进契约，由父会话决定（契约归父会话维护，本轮未改）。
4. **CHANGELOG / 版本号**：未改，归父会话统一发版。
5. **复验**：建议父会话用 §3 的两条命令原样复跑，并核对 §4.2 / §4.3 的改前 / 改后输出。

## 12. 附：本次用到的临时脚手架（`.tmp-d72/`，已被 gitignore）

| 文件 | 用途 |
|---|---|
| `extract-wording.mjs` / `parse-turns.mjs` | 从活体证据里抽原文片段 / 逐轮还原对话 |
| `extract-payloads.mjs` | 抽出 worker 的三份交付报告原文，落成 `live-payloads/d72-live-payloads.json` |
| `inject-d72-payloads.mjs` | 把活体载荷注入 `tests/chain-test.mjs` 并回读校验（不手工转录） |
| `repro.mjs` / `before-after.mjs` | 改前（HEAD）/ 改后（工作树）对照 |
| `final-message.txt` / `self-repro.mjs` / `real-root-repro.mjs` | §2.2 那次拦我的报告的载荷与逐字复现（项目根 = 仓库根） |
| `who-claims.mjs` / `diagnose.mjs` | 定位「哪个子句把哪个路径认领成了声称产出」 |
| `check-installed.mjs` / `check-eol.mjs` | 核对安装副本与运行时缓存树；核对行尾 |
