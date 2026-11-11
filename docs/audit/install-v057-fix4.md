# v0.5.7 公开前收尾 —— fix4：X1「run-all.ps1 撞名 ⇒ 断言报红、退出码却说通过」

> 交付：`docs/audit/.tmp-release/install-v057-fix4.md`（gitignore 覆盖；正式路径由父会话转写到 `docs/audit/`）
> 上一单：fix3 的 W1 / W2 / W3 已被独立验收方复验通过（`docs/audit/verification-v065.md`，sha256 f05a6b99…），产品侧 A/B/C/E/F 全 PASS。
> 本单只动**测试侧**：`tools/install-selftest/` 与 `README.md`。`plugin/**` 零改动；`install.ps1` / `uninstall.ps1` **未动**（X1 在测试侧）。

## 0. 一句话结论

X1 已修：三个计数各给各的名字 ⇒ **自检的红会传到退出码**。
用验收方的触发方式（**头部声明 + 机器标记一起改**）复验 ⇒ **`RUNALL_EXIT=1`**，且**链自己的横幅不含「全部通过」**。
另加一个**行为级**永久断言套件（真跑一份 run-all.ps1 副本、把它逼红），并用「**撞名改回去**」的变异体证明这条断言有牙齿。

## 1. X1 是什么（自己复现，不抄验收方的转述）

### 1.1 撞名链路（改前的行号）

| 改前位置 | 原文 | 作用 |
|---|---|---|
| `run-all.ps1:57` | `$script:pass = 0` | 断言通过数 |
| `run-all.ps1:58` | `$script:failed = 0` | 断言红数 |
| `run-all.ps1:61` | `$script:failed = $script:failed + 1` | 断言红 ⇒ 红计数 +1，并打印 `FAIL` |
| `run-all.ps1:115` | `$failed = 0` | **套件退出码非 0 的个数**的初始化 |
| `run-all.ps1:122` | `if ($failed -gt 0 -or $script:failed -gt 0)` | 退出判定 |

（改前的行号不是推算的：把本单的改动**反向还原**回原文件后实测得到 ——
还原出的文件 sha16 = `af9dd0a535592550` / **6,277 B**，与 fix3 报告里记录的指纹**逐字一致** ⇒ 还原保真。）

PowerShell 的脚本作用域里，`$failed` 与 `$script:failed` **是同一个变量**
⇒ `:115` 的 `$failed = 0` 把 `Check` 刚记下的红计数**清零**
⇒ `:122` 的退出判定两个条件都看不到红
⇒ **断言打印 FAIL、进程却 exit 0、横幅还说「全部通过」**。

### 1.2 复现（改前的真实输出）

跑法：把真实 `run-all.ps1` 的**头部声明与机器标记一起**改成 8（当时真实条数 7 + 1）→ 跑 → 按字节还原（sha256 核对一致）：

````
TRIGGER_HEAD=8 (headSlotsPatched=1)
EXIT=0
HAS_ALL_PASS_BANNER=true
FAIL_LINES=[
 "FAIL  run-all.ps1 自身实际断言条数 == 头部声明（8）且 == 结构性期望（子套件 5 + 2 = 7）   :: 实际=7 declared=8 structural=7"
]
BANNER=["==== 自测：5 / 5 个套件全部通过；条数对账 6 条绿 ===="]
SHA_BEFORE=af9dd0a535592550e54a42df8a88141b0eb0b81bee659e2bd884e46e5b072a3b
SHA_AFTER_RESTORE=af9dd0a535592550e54a42df8a88141b0eb0b81bee659e2bd884e46e5b072a3b
RESTORE_OK=true
````

（`SHA_BEFORE` 与 `SHA_AFTER_RESTORE` 逐字相同 ⇒ 篡改确实被完整还原。）

⇒ 与验收方 `verification-v065.md` 的描述**一致**：断言报红、退出码 0、横幅说谎。

### 1.3 验收方对 fix3 的两点纠正，本单的处理

- 验收方指出：fix3 报告 §3.2 那个「exit=1」的举证其实来自 `check-readme-consistency.mjs` 那条断言，**W3 自检本身对退出码零贡献**。
  **本单不翻案**：改前 W3 自检红时退出码确实是 0（§1.2 就是它）；本单修完 ⇒ W3 自检红 ⇒ 退出码 1（§5.1 的实测）。
- 验收方给的最小隔离复现 `failed -eq script:failed => True` —— 本单用「三个计数各给各的名字」消掉这个等式，并用静态断言钉住（§3.4）。

## 2. 修法：三个计数各给各的名字 + 横幅不许说谎

| 计数 | 改前 | 改后 | 行号（改后） |
|---|---|---|---|
| 断言通过数 | `$script:pass` | `$script:assertPass` | `run-all.ps1:64` |
| 断言红数 | `$script:failed` | `$script:assertFail` | `run-all.ps1:65` |
| 套件退出码非 0 的个数 | `$failed` | `$suiteFailed` | `run-all.ps1:123` |

- 退出判定（`run-all.ps1:133`）：
  `if ($suiteFailed -gt 0 -or $script:assertFail -gt 0) {`
  两个计数各用各的名字，谁也碰不到谁。
- 横幅（红 `:134` / 绿 `:137`）：
  - 红 ⇒ `==== 自测：未通过 —— 套件未通过 X / M；断言红 N 条 ====` —— **不含「全部通过」字样**
  - 绿 ⇒ `==== 自测：M / M 个套件全部通过；条数对账 P 条绿 ====`
- **为什么不用「数组当权威信号」那类更花哨的方案**：变异对照要能**逐字复现**原缺陷，纯改名最容易对照（§3.3）；
  抗"重置"改用静态断言兜（赋值次数恰好 2 次，§3.4）。

## 3. 永久断言：行为级的新套件

### 3.1 它是什么

`tools/install-selftest/run-all-exit-code-test.mjs`（18 条断言，机器标记 `ASSERTION-COUNT: 18`）。

**不是**静态比对源码文字，而是**真跑**：把真 `run-all.ps1` 复制一份，配一组桩套件（每个桩只打 1 条 PASS、退出 0），跑三遍：

| 变体 | 怎么造 | 期望 |
|---|---|---|
| 基线 | 原样副本（头部对齐结构真值） | exit 0、横幅含「全部通过」 |
| 触发红 | **头部声明 + 机器标记一起**改成「真实条数 + 1」 | exit ≠ 0（且 = 1）、横幅**不含**「全部通过」、横幅含「未通过」、输出里**真的有 FAIL 行** |
| 撞名变体 | 触发红 + 把三个计数**改回撞名的旧名** | exit 0、横幅**又**说「全部通过」 ⇒ 证明撞名确实会吃红 |

三个变体各放**各自的目录**（`run-all-exit-code-test.mjs:103` 的 `makeVariant`）：
`run-all.ps1` 读自己的头部走的是 `Join-Path $here 'run-all.ps1'`（**固定文件名**），
放同一个目录会读到别人的头部 —— 这是实现时踩到并记下来的坑（§8 第 3 条）。

### 3.2 三个变体的实测输出（原文）

````
[变体] 基线    exit=0  bannerHasAllPass=true  bannerHasNotPass=false
[变体] 触发红  exit=1  bannerHasAllPass=false bannerHasNotPass=true
[变体] 触发红的 FAIL 行: ["FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8"]
[变体] 撞名变体 exit=0  bannerHasAllPass=true  bannerHasNotPass=false
[变体] 撞名变体的 FAIL 行: ["FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8"]
…
PASS  夹具就绪：基线副本与真实 run-all.ps1 的差异只在头部两处数字
PASS  夹具就绪：真实条数声明 == 结构性期望（子套件 6 + 2 = 8）
PASS  夹具就绪：每个套件条目都有对应的桩文件（一个不缺）
PASS  夹具就绪：每个桩只打 1 条 PASS、不打 FAIL
PASS  夹具就绪：桩的机器标记都写着 1 条（条数对账不会自己先红）
PASS  触发组改的正是「头部声明 + 机器标记」两处，且都改成了新数字 9
PASS  触发红：退出码非 0
PASS  触发红：退出码恰好 1
PASS  触发红：横幅不含「全部通过」
PASS  触发红：横幅含「未通过」
PASS  触发红：横幅写明了断言红的条数（>= 1）
PASS  触发红：输出里真的有 FAIL 行（红是真的，不是「因为别的原因退出 1」）
PASS  阳性对照：未篡改的副本退出码 0
PASS  阳性对照：未篡改的副本横幅含「全部通过」
PASS  变异对照：撞名改回去的副本确实含「$failed = 0」（变异生效了）
PASS  变异对照：撞名改回去 + 同样触发 ⇒ 退出码 0（撞名把红吃掉了）
PASS  变异对照：撞名改回去 + 同样触发 ⇒ 横幅含「全部通过」（横幅说谎）
PASS  变异对照：撞名改回去 + 同样触发 ⇒ 输出里**有** FAIL 行（红是真的，只是被吃了）

==== 自检红 ⇒ 退出码与横幅：PASS 18 / FAIL 0 ====
````

### 3.3 变异对照 = 这条断言的牙齿

「撞名变体」不是摆设：它证明**同一份触发方式在撞名版本上是绿的**（exit 0 + 横幅说「全部通过」）。
所以：
- 撞名一旦改回来，第 3 组（触发红）的 5 条断言**立刻转红**；
- 而「基线变体是绿的」保证这些断言**不是恒真** —— 否则「副本根本跑不起来」会被误当成「红传不到退出码」。

### 3.4 静态对账组（8 条）

`check-readme-consistency.mjs:273-300`（X1 组）：
- 代码（**去掉注释行**，免得被注释里的字样带偏）里不再有裸 `$failed` / `$script:failed` / `$script:pass`；
- 套件失败计数与断言红计数是两个**不同的名字**；
- `$script:assertFail` 的**赋值恰好 2 次**（初始化 + Check 自增，`:288`）—— 再加一次「重置为 0」就会被这条抓住；
- 退出判定同时看两者；
- 红分支横幅不含「全部通过」、绿分支含；
- 行为级套件存在、且含「撞名改回去」的变异对照。

## 4. 条数四方一致（V4 没破）

| 套件 | 头部声明 | 机器标记 | README 表格 | 实测 |
|---|---|---|---|---|
| `sandbox-test.ps1` | 41 | 41 | 41 | 41 |
| `sandbox-test2.ps1` | 44 | 44 | 44 | 44 |
| `trailing-space-test.mjs` | 39 | 39 | 39 | 39 |
| `verify-seed.mjs` | 21 | 21 | 21 | 21 |
| `check-readme-consistency.mjs` | 131 | 131 | 131 | 131 |
| **`run-all-exit-code-test.mjs`（新增）** | 18 | 18 | 18 | 18 |
| **`run-all.ps1`（入口）** | 8 | 8 | 8 | 8 |

合计 **294**（41+44+39+21+131+18+8）；
`PASS 全部套件断言总数：声明 294 == 实际 294`、
`PASS run-all.ps1 自身实际断言条数 == 头部声明（8）且 == 结构性期望（子套件 6 + 2 = 8）`。

**为什么 run-all 自己的条数从 7 变成 8**：新增了一个套件 ⇒ 子套件 6 个 ⇒ 结构性期望 = 6 + 2 = 8。
W3 的「从自己头部读 + 结构性交叉核对」照旧成立。

## 5. 验收触发复验（验收方的触发方式）

### 5.1 头部声明 + 机器标记**一起**改成 9（= 新真实条数 8 + 1）

````
MODE=head TARGET=9
EXIT=1
CHAIN_BANNER="==== 自测：未通过 —— 套件未通过 1 / 6；断言红 1 条 ===="
ALL_BANNERS=["==== 自测：未通过 —— 套件未通过 1 / 6；断言红 1 条 ===="]
FAIL_LINES=[
 "FAIL  夹具就绪：真实条数声明 == 结构性期望（子套件 6 + 2 = 8）   :: declared=9 structural=8",
 "FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8"
]
SUITE_SUMMARY=["  PASS  sandbox-test.ps1  exit=0","  PASS  sandbox-test2.ps1  exit=0","  PASS  trailing-space-test.mjs  exit=0","  PASS  verify-seed.mjs  exit=0","  PASS  check-readme-consistency.mjs  exit=0","  FAIL  run-all-exit-code-test.mjs  exit=1"]
RESTORE_OK=true  sha16=d6bde61645573d86
````

⇒ **`EXIT=1`**；**链自己的横幅**（唯一一条 `==== 自测：` 开头的行）不含「全部通过」；
改完当场还原（`RESTORE_OK=true`，sha16 回到 `d6bde61645573d86`）。

### 5.2 字面数 8 现在是**正确**条数 ⇒ 绿（条数重编号的说明）

验收方的触发方式写的是「改成 8」，那是**当时**的真实条数 7 + 1。本单新增了一个套件，
真实条数变成 8 ⇒ 等价触发是 9（§5.1）。为免歧义，**字面 8 也实测了一遍**：

````
MODE=head TARGET=8
EXIT=0
CHAIN_BANNER="==== 自测：6 / 6 个套件全部通过；条数对账 8 条绿 ===="
FAIL_LINES=[]
SUITE_SUMMARY=["  PASS  sandbox-test.ps1  exit=0", … ,"  PASS  run-all-exit-code-test.mjs  exit=0"]
RESTORE_OK=true  sha16=d6bde61645573d86
````

这是**条数重编号**的结果（8 现在是对的），不是回归 —— 触发机制由 §5.1 的 9 覆盖。

### 5.3 读数陷阱（自曝）：整个输出里仍有 5 处「全部通过」

````
ALL_PASS_PHRASE_COUNT_IN_OUTPUT=5
PHRASE_LINES=[
 "PASS  run-all.ps1 的红分支横幅不含「全部通过」（X1）",
 "PASS  run-all.ps1 的绿分支横幅含「全部通过」（X1）",
 "PASS  触发红：横幅不含「全部通过」",
 "PASS  阳性对照：未篡改的副本横幅含「全部通过」",
 "PASS  变异对照：撞名改回去 + 同样触发 ⇒ 横幅含「全部通过」（横幅说谎）"
]
````

**这 5 处全部是断言名字**（断言在声明它钉的是什么），**没有一处是横幅** ——
`ALL_BANNERS` 里只有 1 条，就是链自己的横幅。
评审若直接 `grep 整个输出` 找「全部通过」会被误导，所以：
1. 新套件的「变体证据行」只打**布尔量**（`bannerHasAllPass=…`），不再原样打印变体横幅；
2. 本报告把「链自己的横幅」与「断言名字」分层呈现。

### 5.4 「改坏即红」端到端：把改名回退（撞名复活）

````
MODE=revert
EXIT=1
CHAIN_BANNER="==== 自测：未通过 —— 套件未通过 2 / 6；断言红 2 条 ===="
FAIL_LINES=[
 "FAIL  run-all.ps1 的代码里不再有裸 $failed / $script:failed / $script:pass（X1：撞名已消除）   :: code lines still contain an old name",
 "FAIL  run-all.ps1 的套件失败计数与断言红计数是两个不同的名字（X1）   :: missing",
 "FAIL  run-all.ps1 里 $script:assertFail 只被赋值 2 次（初始化 + Check 自增）—— 再加一次重置就被这条抓住（X1）   :: assignments=0",
 "FAIL  run-all.ps1 的退出判定同时看套件退出码与断言红计数（X1）   :: missing",
 "FAIL  触发红：退出码非 0   :: code=0",
 "FAIL  触发红：退出码恰好 1   :: code=0",
 "FAIL  触发红：横幅不含「全部通过」   :: banner===== 自测：6 / 6 个套件全部通过；条数对账 7 条绿 ====",
 "FAIL  触发红：横幅含「未通过」   :: banner===== 自测：6 / 6 个套件全部通过；条数对账 7 条绿 ===="
]
SUITE_SUMMARY=[…, "  FAIL  check-readme-consistency.mjs  exit=1","  FAIL  run-all-exit-code-test.mjs  exit=1"]
RESTORE_OK=true  sha16=d6bde61645573d86
````

⇒ 撞名一复活，**静态对账组与行为组同时转红**，链的退出码 = 1、横幅说「未通过」。
注意失败详情里那两行：`code=0` 与 `banner===== … 全部通过 …` ——
**验收方看到的症状在套件内部被逐字复现**了（红是真的，只是被撞名吃掉）。

## 6. 正常路径 / 两种 TEMP / 回归

| 场景 | 结果 |
|---|---|
| 默认 TEMP，整链 | 6/6 套件 PASS；294 条 0 FAIL；`RUNALL_EXIT=0`；横幅「6 / 6 个套件全部通过；条数对账 8 条绿」 |
| TEMP ① 纯 ASCII 无空格（`C:\sar-temp-ascii`） | 6/6；294 条 0 FAIL；`RUNALL_EXIT=0` |
| TEMP ② 含空格 + 含中文（`…\mini code的插件\docs\audit\.tmp-selftest-temp`） | 6/6；294 条 0 FAIL；`RUNALL_EXIT=0` |
| 仓库回归 `node tools/run-tests.mjs --all --root plugin --repo .` | 13 套 / **836 条 0 FAIL** / `>>> SHELL ALL PASS` / exit 0 |
| `git diff --name-only -- plugin/` | 空 |
| `plugin.json` version | **0.5.7**（未动） |

## 7. 改动的文件与指纹（sha256 前 16）

| 文件 | 字节 | sha16 | 本单改动 |
|---|---|---|---|
| `tools/install-selftest/run-all.ps1` | 7,346 | `d6bde61645573d86` | **X1 核心**：三个计数改名（`:64/:65/:123`）+ 退出判定（`:133`）+ 横幅（`:134/:137`）+ 新增套件条目（`:56`）+ 头部 7→8（`:4/:6`） |
| `tools/install-selftest/run-all-exit-code-test.mjs` | 11,057 | `cb8317f7df00e23b` | **新增**：行为级永久断言套件（18 条） |
| `tools/install-selftest/check-readme-consistency.mjs` | 20,932 | `28838bfb4266d437` | 新增 **X1 对账组 8 条**（`:273-300`）+ 套件清单加新套件（`:181`）+ 头部 119→131（`:3`） |
| `README.md` | 17,667 | `35ee15bf986685f8` | 自测表：加新套件行（18）与 run-all 行（8）、对账脚本 119→131（`:217-219`）+ 「退出码可信」说明（`:221-222`） |

**未改**（指纹与 fix3 一致，可对照）：`sandbox-test.ps1` 12,495 `e7de581eaa97bfd6` /
`sandbox-test2.ps1` 18,160 `69c5a94e854e3cf1` / `trailing-space-test.mjs` 18,710 `6c8adbdf3abf4150` /
`verify-seed.mjs` 6,756 `07b9d4c9b295445f` / `install.ps1` 24,109 `1f441eaa477b992b` /
`uninstall.ps1` 15,461 `4171b0e8315fa7d4` / `plugin/**` 零改动。

## 8. 探针自曝（我自己的错、夹具的问题、读数的坑）

1. **V4 当场抓住我一处错**：新套件源码里 `ASSERTION-COUNT` 字面量出现 **4 次**
   （桩模板里 2 次 + 一处 `includes` + 头部 1 次）⇒ 「有且只有一个机器标记」红了。
   改法：桩文件的标记是**运行时生成**的 ⇒ 源码里用拼接（`const MARK = 'ASSERTION' + '-COUNT:'`），
   并把**断言名字**里那处字面量也改掉（名字里跟数字连着写同样会被 V4 的正则命中）。
   这条自曝是 V4 自己抓到的，不是我看出来的。
2. **条数我第一次也写错了**：以为对账套件会变成 131（119 + 4 + 8），实测 **128** ——
   因为 V4 循环在新套件上只加了 1 条（其余 3 条被 `continue` 跳过）。
   **这恰恰证明 V4 的「声明 == 实测」是真的在跑**，不是我写个数字就过。
3. **实现时踩到的坑**：`run-all.ps1` 读自己的头部走 `Join-Path $here 'run-all.ps1'`（固定文件名）
   ⇒ 三个变体如果放同一个目录，篡改版会读到基线版的头部，触发方式直接失效。
   ⇒ 三个变体各建各的目录（`makeVariant`）。
4. **读数陷阱**（§5.3）：整个输出里 grep「全部通过」会命中 5 处**断言名字**，
   一开始我以为横幅还在说谎。已把变体证据改成布尔量，并在报告里分层呈现。
5. **报告原稿的两处错，都是回读时才发现并改正的**：
   (a) §1.2 的 `SHA_AFTER_RESTORE` 我转写时打错一位（写成 `af9dd0a535992550…`，真实是 `af9dd0a535592550…`）；
   (b) §1.1 的「改前行号」我第一版是**推算**的，回读时用「把本单改动反向还原回原文件」重算，
   发现 `$script:pass` 实际在 **:57**（不是 :56）、自增在 **:61**（不是 :59）。
   **还原出的原文件 sha16=`af9dd0a535592550` / 6,277 B，与 fix3 报告记录的指纹逐字一致** ⇒ 还原保真、行号可信。
   这两条说明：**报告里的行号不能靠推**，必须实测。
6. 我第一版把新套件的「变体横幅」原样打印出来，会让评审把变体横幅误当成链自己的横幅（§5.3）——已修。

## 9. 诚实边界（哪些没验、为什么）

- **没验**：非 Windows 平台上本单新套件的行为。它依赖 `powershell`（PS 5.1），
  与仓库其它 4 个套件一样只在 Windows 上跑（`run-all.ps1` 开头对非 Windows 直接跳过）。
  套件里没有「非 Windows 就跳过」的分支，因此**在非 Windows 上直接跑它会失败**——
  这与现有 `sandbox-test.ps1` / `trailing-space-test.mjs` 的约定一致（整条自测链本来就只在 Windows 跑）。
- **没验**：`install.ps1` / `uninstall.ps1` 在本单**一个字没动**（X1 在测试侧）；
  产品侧 A/B/C/E/F 是上一轮验收方复验的结论，本单不重复验也不改写。
- **没做**：不 commit / 不 push / 不改仓库可见性 / 不建 tag（由父会话统一做）；
  报告的正式路径也由父会话转写。
- **不是本单产物**：`LICENSE`、`docs/audit/*.md`（含父会话已转写的 `verification-v065.md` 与 `install-v057-fix3.md`）。
- **本单没有新增任何"平台行为"结论**：X1 是**这个仓库里这个脚本**的缺陷，
  不是 PowerShell 的通病；PowerShell 侧我只用到"脚本作用域下 `$x` 与 `$script:x` 同名"这一条，
  且这条是**在本机实测复现**的（改前 §1.2 退出码 0 ⇒ 撞名确实存在）。

## 10. 结论

X1 已修且**双路钉住**：
- 修法侧：三个计数各给各的名字（`run-all.ps1:64/:65/:123`），退出判定同时看两者（`:133`），
  红横幅不再说「全部通过」（`:134`）。
- 回归侧：新增**行为级**套件 `run-all-exit-code-test.mjs`（18 条），真跑副本把它逼红；
  并用「撞名改回去」的变异体证明这条断言能区分「修好」与「撞名改回来」。

验收方的触发方式（头部声明 + 机器标记一起改）复验：**`RUNALL_EXIT=1`**、链自己的横幅不含「全部通过」、
当场还原后二次验证全绿（`RESTORE_OK=true` + sha16 不变）。
正常路径 6/6、294 条 0 FAIL、exit 0，两种 TEMP 形态同样全绿；仓库回归 13 套 / 836 条 / 0 FAIL；
`plugin/` 零改动、版本仍 `0.5.7`。

---

## 11. 可复跑清单（都在 gitignore 覆盖的 `docs/audit/.tmp-release/` 里）

| 脚本 | 干什么 | 怎么跑 |
|---|---|---|
| `_x1-probe.mjs` | **改前复现**：把头部声明 + 机器标记一起改成 N，跑整链，抓退出码 / 横幅 / FAIL 行，**按字节还原并核对 sha256** | `node docs/audit/.tmp-release/_x1-probe.mjs 9` |
| `_x1-mutate.mjs` | 两种模式：`head <N>`（触发红）/ `revert`（撞名改回去）；同样跑整链、还原、核对 sha256 | `node docs/audit/.tmp-release/_x1-mutate.mjs head 9` / `… revert` |
| `_x1-revert-orig.mjs` | 把本单对 run-all.ps1 的改动**反向还原**回原文件（用于**实测**「改前」行号，不是推算） | `node docs/audit/.tmp-release/_x1-revert-orig.mjs tools/install-selftest/run-all.ps1 <out>` |
| `_fix4-report-fix.mjs` / `_fix4-unbacktick.mjs` | 报告落盘工具（长 markdown 用「双 @ 字符对」占位反引号；兼做正文修正） | `node docs/audit/.tmp-release/_fix4-report-fix.mjs <报告路径>` |

本单临时脚本跑完后已删：`_rm-left.mjs` / `_rm2.mjs`（上一单清理用）。
