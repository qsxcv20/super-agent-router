# v066 独立验收报告 —— X1 修复复验（公开前最后一道）

> 独立验收方：不采信修复方报告里的任何数字，全部自己实跑、自己造突变体。
> 范围：只做本单 A–E 五项；不重查其它条目。

---

## 0. 结论先行

**VERDICT：PASS**

**现在能不能公开？—— 能。**

理由一句话：X1 的**三个失效环节**（变量撞名、退出码判定、横幅文案）我逐个用突变体攻击过，
攻击全部被挡住；修复后的真实脚本在两种 TEMP 形态下 6/6 全绿、0 FAIL、exit 0；
仓库回归 13 套 / 836 条 / 0 FAIL；被验文件哈希全部回原值；`git status` 与开工基线逐行相同。

本轮**未发现任何阻塞公开的缺陷**。范围限定说明见第 9 节。

---

## 1. 被验对象与开工基线

### 1.1 文件指纹（开工基线 = 收尾实测值，两者逐位相同）

| 文件 | 字节 | sha256 |
|---|---|---|
| `install.ps1` | 24109 | `1F441EAA477B992B329FBCB80B4E916C526F38870AE65D39EDD688BCBEFBC8EC` |
| `uninstall.ps1` | 15461 | `4171B0E8315FA7D45623DE16FF336E9BF2F59B9ADAF9DCEB0A2ADCE9C69B8658` |
| `README.md` | 17667 | `35EE15BF986685F8431CCF78773A32FA1D7E64D01CF9149289384F34A01618D8` |
| `tools/install-selftest/run-all.ps1` | 7346 | `D6BDE61645573D86DF4993BE3A33D8A55AE749BD82507D0D9290A0C182FBF61E` |
| `tools/install-selftest/run-all-exit-code-test.mjs`（新增） | 11057 | `CB8317F7DF00E23BA237BE063B4EBAC93C3EDE89456375D2C2F4D68D6799D251` |
| `tools/install-selftest/check-readme-consistency.mjs` | 20932 | `28838BFB4266D437045DE8E6DD84AC846F70CB91FC13D0E84E574F1C956AC0B7` |
| `tools/install-selftest/sandbox-test.ps1` | 12495 | `E7DE581EAA97BFD68E17DBFF2D606012FFC60EB8E8F9FA2542A9F3FDCB785E94` |
| `tools/install-selftest/sandbox-test2.ps1` | 18160 | `69C5A94E854E3CF139880DEA9E2432B17402370C46E9D87B2BD56FB1B0343837` |
| `tools/install-selftest/trailing-space-test.mjs` | 18710 | `6C8ADBDF3ABF4150D16BD4C7319CA8B2C89589E03DBFE243CAC9A18E49651E23` |
| `tools/install-selftest/verify-seed.mjs` | 6756 | `07B9D4C9B295445FE102198A7621414104AD3F802FDCC49BA7DF3BB74E89EF15` |
| `docs/audit/install-v057-fix4.md`（修复方报告） | 21606 | `6993EE269B0BF0C6CE1A35411A93B8E37AFB1425158C39E1EAF3D2CE711086A4` |

### 1.2 开工 `git status --short`（基线，逐行保留）

```
 M README.md
?? LICENSE
?? docs/audit/install-v057-fix.md
?? docs/audit/install-v057-fix2.md
?? docs/audit/install-v057-fix3.md
?? docs/audit/install-v057-fix4.md
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? docs/audit/verification-v063.md
?? docs/audit/verification-v064.md
?? docs/audit/verification-v065.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1
```

> 注：`docs/audit/.tmp-*/` 已在 `.gitignore` 内 ⇒ 本轮所有临时产物不会污染工作树。

---

## 2. 修复实现的逐行复核（读码，不是采信报告）

### 2.1 撞名已消除 —— 三个计数各有一个名字

`tools/install-selftest/run-all.ps1`：

| 行号 | 代码 | 作用 |
|---|---|---|
| `:64` | `$script:assertPass = 0` | 绿计数 |
| `:65` | `$script:assertFail = 0` | **断言红计数**（旧名 `$script:failed`） |
| `:123` | `$suiteFailed = 0` | **套件退出码非 0 的计数**（旧名 `$failed`） |
| `:133` | `if ($suiteFailed -gt 0 -or $script:assertFail -gt 0) {` | 退出判定同时看两者 |
| `:134` | 红横幅：`==== 自测：未通过 —— 套件未通过 X / M；断言红 N 条 ====` | **不含**「全部通过」 |
| `:137` | 绿横幅：`==== 自测：M / M 个套件全部通过；条数对账 P 条绿 ====` | 含「全部通过」 |

关键点：`$script:assertFail` 与 `$suiteFailed` **同名不可能** ⇒ 旧 bug 的
「`$failed = 0` 把断言红计数清零」这条链路在语法上已不存在。

### 2.2 横幅是**结构性**分支，不是靠文案约定

红/绿横幅是两个**互斥的分支**，退出码 1 / 0 也在同一分支里 ⇒
「红的时候说全部通过」在代码结构上不可达。

### 2.3 声明条数自推导（W3）

- `:115-116`：`$selfDeclared` 从**自己头部**用 `ASSERTION-COUNT:\s*(\d+)` 读出，不写死常量。
- `:117`：`$selfStructural = $suites.Count + 2`（子套件数 + 2）。
- `:119`：`Check(... (($script:assertPass + $script:assertFail + 1) -eq $selfDeclared) -and (... -eq $selfStructural))`
  ⇒ **头部与机器标记一起改也躲不掉**（declared 与 structural 双交叉）。

### 2.4 静态对账组（`check-readme-consistency.mjs:273-300`）

8 条，覆盖：无裸旧名 ⇒ 两计数异名 ⇒ `$script:assertFail` 只赋值 2 次 ⇒ 退出判定同看两者
⇒ 红横幅不含「全部通过」⇒ 绿横幅含 ⇒ 存在行为级套件 ⇒ 该套件含撞名变异对照。

---

## 3. A 项 —— 触发红：头部声明与机器标记一起改成 ≠ 真实条数的值

### 3.1 读数陷阱（先说清楚，否则下面的数字会被误读）

> **「8 现在是正确值」，触发必须用 9。**
>
> 因为修复后的 `run-all.ps1` 真实断言数就是 8：
> `6`（逐套件条数对账）+ `1`（总数对账）+ `1`（自身结构性对账）= `8`。
> 我自己独立数过（`v066-owncount.cjs`）：
>
> ```json
> {
>   "runAllOwnPerSuiteChecks": 6,
>   "runAllOwnTotalRecon": 1,
>   "runAllOwnSelfStructural": 1,
>   "runAllOwnTotal": 8,
>   "selfStructuralLine": ["PASS  run-all.ps1 自身实际断言条数 == 头部声明（8）且 == 结构性期望（子套件 6 + 2 = 8）"],
>   "banner": ["==== 自测：6 / 6 个套件全部通过；条数对账 8 条绿 ===="]
> }
> ```
>
> 所以改成 8 = 改成正确值（必绿）；改成 **9** 才是触发值。

### 3.2 第二个读数陷阱：整份输出里有 6 处「全部通过」，只有 1 处是链自己的横幅

基线绿跑（`v066-final-green.log`）里「全部通过」出现 **6** 次：

| 行 | 内容 | 是不是链自己的横幅 |
|---|---|---|
| 384 | `PASS  run-all.ps1 的红分支横幅不含「全部通过」（X1）` | 否（断言名字） |
| 385 | `PASS  run-all.ps1 的绿分支横幅含「全部通过」（X1）` | 否（断言名字） |
| 414 | `PASS  触发红：横幅不含「全部通过」` | 否（断言名字） |
| 419 | `PASS  阳性对照：未篡改的副本横幅含「全部通过」` | 否（断言名字） |
| 422 | `PASS  变异对照：撞名改回去 + 同样触发 ⇒ 横幅含「全部通过」（横幅说谎）` | 否（断言名字） |
| 438 | `==== 自测：6 / 6 个套件全部通过；条数对账 8 条绿 ====` | **是（唯一的横幅行）** |

⇒ **判定只认 `==== 自测：` 开头的那一行**，直接 grep 整个输出会误判。
我的分析器 `v066-analyze.cjs` 就是按「行首 `==== 自测：`」精确取的，不做全文 grep。

### 3.3 突变（只动 2 行）

```json
{
  "mode": "head9", "headHits": 1, "markHits": 1,
  "diff": [
    { "line": 4, "from": "...（8 条断言）。", "to": "...（9 条断言）。" },
    { "line": 6, "from": "机器标记：ASSERTION-COUNT: 8", "to": "机器标记：ASSERTION-COUNT: 9" }
  ]
}
```

### 3.4 触发结果（原始输出）

```
RUNALL_EXIT=1
==== 自测：未通过 —— 套件未通过 1 / 6；断言红 1 条 ====
FAIL  夹具就绪：真实条数声明 == 结构性期望（子套件 6 + 2 = 8）   :: declared=9 structural=8
FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8
  PASS  sandbox-test.ps1  exit=0
  PASS  sandbox-test2.ps1  exit=0
  PASS  trailing-space-test.mjs  exit=0
  PASS  verify-seed.mjs  exit=0
  PASS  check-readme-consistency.mjs  exit=0
  FAIL  run-all-exit-code-test.mjs  exit=1
==== 自测：未通过 —— 套件未通过 1 / 6；断言红 1 条 ====
```

判定（机器读数，`v066-analyze.cjs`）：

| 指标 | 值 | 要求 | 结果 |
|---|---|---|---|
| `exitCode` | `1` | ≠ 0 | PASS |
| `bannerCount`（行首 `==== 自测：`） | 1 | 唯一 | PASS |
| `bannerHasAllPass` | `false` | 不含「全部通过」 | **PASS** |
| `bannerHasNotPass` | `true` | 含「未通过」 | PASS |
| `bannerAllPassOccurrences` | `0` | 0 | PASS |
| `wholeOutputAllPassOccurrences` | 5 | （其余 5 处是断言名字，不是横幅） | 已核实 |
| `failLineCount` | 2 | ≥ 1（红是真的） | PASS |

### 3.5 还原 + 复跑全绿

```json
{ "mode": "restore", "targetSha": "d6bde61645573d86df4993be3a33d8a55ae749bd82507d0d9290a0c182fbf61e",
  "backupSha": "d6bde61645573d86df4993be3a33d8a55ae749bd82507d0d9290a0c182fbf61e", "match": true, "bytes": 7346 }
{ "mode": "verify",  "targetSha": "d6bde61645573d86df4993be3a33d8a55ae749bd82507d0d9290a0c182fbf61e", "match": true }
```

还原后复跑：`RUNALL_EXIT=0`，`==== 自测：6 / 6 个套件全部通过；条数对账 8 条绿 ====`，`failLineCount=0`。

**A 项判定：PASS。**

---

## 4. B 项 —— 新套件是行为级的钉子，且真有牙齿

### 4.1 它**真跑三份副本**，不是静态检查（读码 + 实测双证）

读码（`run-all-exit-code-test.mjs`）：

- `runVariant()` 用 `spawnSync('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-File', p], {encoding:'utf8'})`
  ⇒ **真的起子进程跑 PowerShell**，拿 `r.status` 当退出码。
- `makeVariant()` 为三个变体**各建各的目录**（`base` / `tampered` / `mutant`）——
  因为 `run-all.ps1` 读自己的头部走的是 `Join-Path $here 'run-all.ps1'`（固定文件名），
  放同一目录会互相读到对方的头。
- 夹具是**真 run-all.ps1 的逐字节副本** + 每套件一个**桩**（只打 1 条 PASS、exit 0、机器标记 1）。

实测（基线单独跑，`v066-suite.log`）：`RUNALL_EXIT=0`，18 条 PASS / 0 FAIL，
且日志里有真实变体运行痕迹：

```
[变体] 基线    exit=0  bannerHasAllPass=true  bannerHasNotPass=false
[变体] 触发红  exit=1  bannerHasAllPass=false bannerHasNotPass=true
[变体] 触发红的 FAIL 行: ["FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8"]
[变体] 撞名变体 exit=0  bannerHasAllPass=true  bannerHasNotPass=false
[变体] 撞名变体的 FAIL 行: ["FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8"]
```

⇒ 三个变体的 `exit` **各不相同**（0 / 1 / 0）⇒ 只可能来自真实进程执行，静态比对做不到。

### 4.2 「撞名变体」那一条能区分「修好」与「撞名复活」——**分层要说清**

| 层 | 跑的是什么 | 期望 | 作用 |
|---|---|---|---|
| **触发组** | 真 run-all.ps1 副本，头部改成 9 | exit ≠ 0、横幅不含「全部通过」、**确有 FAIL 行** | **真正的防线**：撞名复活时它立刻转红 |
| 变异对照组 | **合成 mutant 副本**（撞名改回去） | 恒绿（exit 0 + 横幅说谎 + 仍有 FAIL 行） | **证伪件**：证明「撞名会把红吃掉」这件事本身可复现 |
| 阳性对照 | 未篡改副本 | exit 0 + 横幅含「全部通过」 | **金丝雀**：证明副本能跑起来（否则「红传不到退出码」会误判） |

> 变异对照组是**合成**的（恒绿），它本身不是防线；**能抓住撞名复活的是触发组**。
> 下面的 4.3 就是触发组被激活的实证。

### 4.3 **亲自把撞名改回真实脚本** —— 新套件转红（要求的核心动作）

我把 `$script:assertPass`→`$script:pass`、`$script:assertFail`→`$script:failed`、
`$suiteFailed`→`$failed` 写回**真实的** `tools/install-selftest/run-all.ps1`
（7 + 9 + 6 = 22 处替换，11 行变更，含 `:123` `$failed = 0`），
然后**只跑新套件**：

```
RUNALL_EXIT=1
[变体] 基线    exit=0  bannerHasAllPass=true
[变体] 触发红  exit=0  bannerHasAllPass=true      ← 撞名把红吃掉了
[变体] 触发红的 FAIL 行: ["FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8"]
[变体] 撞名变体 exit=0  bannerHasAllPass=true
PASS  夹具就绪：基线副本与真实 run-all.ps1 的差异只在头部两处数字
PASS  夹具就绪：真实条数声明 == 结构性期望（子套件 6 + 2 = 8）
PASS  夹具就绪：每个套件条目都有对应的桩文件（一个不缺）
PASS  夹具就绪：每个桩只打 1 条 PASS、不打 FAIL
PASS  夹具就绪：桩的机器标记都写着 1 条（条数对账不会自己先红）
PASS  触发组改的正是「头部声明 + 机器标记」两处，且都改成了新数字 9
FAIL  触发红：退出码非 0   :: code=0
FAIL  触发红：退出码恰好 1   :: code=0
FAIL  触发红：横幅不含「全部通过」   :: banner===== 自测：6 / 6 个套件全部通过；条数对账 7 条绿 ====
FAIL  触发红：横幅含「未通过」   :: banner===== 自测：6 / 6 个套件全部通过；条数对账 7 条绿 ====
FAIL  触发红：横幅写明了断言红的条数（>= 1）   :: banner===== 自测：6 / 6 个套件全部通过；条数对账 7 条绿 ====
PASS  触发红：输出里真的有 FAIL 行（红是真的，不是「因为别的原因退出 1」）
PASS  阳性对照：未篡改的副本退出码 0
PASS  阳性对照：未篡改的副本横幅含「全部通过」
PASS  变异对照：撞名改回去的副本确实含「$failed = 0」（变异生效了）
PASS  变异对照：撞名改回去 + 同样触发 ⇒ 退出码 0（撞名把红吃掉了）
PASS  变异对照：撞名改回去 + 同样触发 ⇒ 横幅含「全部通过」（横幅说谎）
PASS  变异对照：撞名改回去 + 同样触发 ⇒ 输出里**有** FAIL 行（红是真的，只是被吃了）
```

**新套件转红了：5 条 FAIL，exit 1。** 且转红位置**正好落在触发组**（5 条触发红断言里的 5 条）
⇒ 证明它能区分「修好」与「撞名复活」，不是只会一直绿。

同时静态对账组也转红（**双层防线**都失效）：

```
FAIL  run-all.ps1 的代码里不再有裸 $failed / $script:failed / $script:pass（X1：撞名已消除）   :: code lines still contain an old name
FAIL  run-all.ps1 的套件失败计数与断言红计数是两个不同的名字（X1）   :: missing
FAIL  run-all.ps1 里 $script:assertFail 只被赋值 2 次（初始化 + Check 自增）—— 再加一次重置就被这条抓住（X1）   :: assignments=0
FAIL  run-all.ps1 的退出判定同时看套件退出码与断言红计数（X1）   :: missing
  FAIL  check-readme-consistency.mjs  exit=1
  FAIL  run-all-exit-code-test.mjs  exit=1
==== 自测：未通过 —— 套件未通过 2 / 6；断言红 2 条 ====
```

### 4.4 附带复现了原始 X1 的签名（撞名 + 头部 9）

在同一撞名态下再把头部改成 9，链自己打出 **FAIL 行**，
而（撞名后的）退出判定仍说「全部通过」：

```
FAIL  run-all.ps1 自身实际断言条数 == 头部声明（9）且 == 结构性期望（子套件 6 + 2 = 8）   :: 实际=8 declared=9 structural=8
[变体] 触发红  exit=0  bannerHasAllPass=true      ← FAIL 已打印，退出码仍是 0，横幅仍说全部通过
```

⇒ **X1 的原始症状在撞名态下被完整复现**，在修复态下不可能复现（A 项 exit=1 / 横幅不含「全部通过」）。
这坐实了「撞名 ⇒ 断言报红但退出码说通过」这条因果链，也证明修复不是碰巧。

### 4.5 还原

```json
{ "mode": "restore", "targetSha": "d6bde61645573d86df4993be3a33d8a55ae749bd82507d0d9290a0c182fbf61e", "match": true, "bytes": 7346 }
{ "mode": "verify",  "targetSha": "d6bde61645573d86df4993be3a33d8a55ae749bd82507d0d9290a0c182fbf61e", "match": true }
```

**B 项判定：PASS。**

---

## 5. C 项 —— 仓库回归 + plugin/ 零改动 + 版本

```
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=49 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=29 fail=0
RESULT ledger-test exit=0 pass=23 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
>>> SHELL ALL PASS
```

我自己写的计数脚本独立数（不采信上表加总）：

```json
{ "suites": 13, "totalPass": 836, "totalFail": 0, "badSuites": 0, "shellLine": [">>> SHELL ALL PASS"] }
```

| 检查 | 结果 |
|---|---|
| 13 套 / 836 条 / 0 FAIL | PASS（自数） |
| `git diff --name-only -- plugin/` | 空 ⇒ PASS |
| `git status --short -- plugin/` | 空 ⇒ PASS |
| 版本 | `plugin/.minimax-plugin/plugin.json` → `"version": "0.5.7"` ⇒ PASS |

**C 项判定：PASS。**

---

## 6. D 项 —— 两种 TEMP 形态各跑一次

| TEMP | 形态 | RUNALL_EXIT | 横幅 | FAIL 行 |
|---|---|---|---|---|
| `C:\sar-temp-v066` | 纯 ASCII、无空格（仓库外） | **0** | `==== 自测：6 / 6 个套件全部通过；条数对账 8 条绿 ====` | 0 |
| `docs/audit/.tmp-v055/v066-temp 空格 中文` | 含空格 + 中文（仓库内） | **0** | `==== 自测：6 / 6 个套件全部通过；条数对账 8 条绿 ====` | 0 |

两次都是 **6/6 套件 exit=0、0 FAIL、0 条断言红**，条数对账 294 == 294、8 == 8。

> TEMP① 必须放仓库外 —— 仓库根本身叫 `mini code的插件`（含空格 + 中文），
> 放在仓库内就测不出「纯 ASCII 无空格」这一形态（v065 探针错误 #2 同源）。
> TEMP② 用码点拼接（`[char]0x7A7A` 等）构造，避免脚本编码问题。

**D 项判定：PASS。**

---

## 7. E 项 —— 收尾：工作树与哈希

### 7.1 `git status --short`（收尾）

```
 M README.md
?? LICENSE
?? docs/audit/install-v057-fix.md
?? docs/audit/install-v057-fix2.md
?? docs/audit/install-v057-fix3.md
?? docs/audit/install-v057-fix4.md
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? docs/audit/verification-v063.md
?? docs/audit/verification-v064.md
?? docs/audit/verification-v065.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1
```

**与开工基线逐行相同**（14 行，顺序、字符完全一致）⇒ 未留未跟踪垃圾。
仓库根无 `Microsoft/` 残留（`Microsoft_EXISTS=False`）。

### 7.2 被验文件哈希 —— 11 个全部回原值

```json
{ "allHashesMatchBaseline": true, "mismatches": [], "rowCount": 11 }
```

### 7.3 真实安装目录（只读复核）

| 指标 | 值 |
|---|---|
| 条目数 | 34（28 文件 + 6 目录） |
| **本轮窗口内被改动的条目数** | **0** |
| 最新 mtime | `2026-11-10T21:37:23Z` |
| v065 记录的 `NEWEST_MTIME` | `2026-11-10T21:37:23Z` ⇒ **逐位一致** |

⇒ 真实安装目录**全程未被触碰**（最新 mtime 停在 8.4 小时前，且与上一轮验收记录一致）。

### 7.4 临时产物清理

- `C:\sar-temp-v066` → 已回收（`gone=True`）
- `docs/audit/.tmp-v055/v066-temp 空格 中文` → 已回收（`gone=True`）
- `docs/audit/.tmp-v055/_v066_wtest.txt` → 已回收
- 本轮所有脚本 / 日志 / 备份保留在 `docs/audit/.tmp-v055/`（被 `.gitignore` 排除，不污染工作树）

---

## 8. 发现汇总（按严重度）

**本轮未发现任何缺陷。** A–E 五项全部 PASS。

唯一的「异常读数」已定位为**方法问题**而非产品问题，见第 10 节探针自曝 #5。

---

## 9. 诚实边界（哪些没验、为什么）

1. **本轮范围限定**：只验本单 A–E 五项（X1 修复复验 + 回归 + TEMP + 收尾）。
   v065 报告里的其它条目（W1/W2/W3/V2/V3/V4/F 项等）本轮**未重查**，
   本报告**不能**用来推翻或确认那些结论。
2. **真实安装目录没有实跑**：全程只做只读复核（mtime + 文件数 + 内容哈希）。
   原因：自测套件把 `USERPROFILE` 重定向到沙箱、或显式传 `-Target` 到沙箱路径；
   实跑真实安装目录会改动用户环境，超出只读验收边界。
3. **真实安装目录的整树哈希无法与 v065 逐位对比**：v065 用的拼接算法脚本**未留存**
   （我在 `v065-e-regression.ps1` / `v065-f-pollution.ps1` / `v065-f3-canary-mech.ps1`
   及 `v065-*.ps1` 全量里都没找到产出 `REAL_TREE_HASH` 的那段），
   我穷举了 **525 种**（排序方式 × 行格式 × 分隔符 × 编码）组合**全部不匹配**。
   ⇒ 这不是「内容变了」的证据，而是「算法不可复现」；我改用**方法无关**的 mtime + 条目数证据（见 7.3）。
   诚实表述：**真实安装目录未被触碰**（mtime 逐位一致 + 0 条目在本轮窗口被改），
   而不是「整树哈希与 v065 逐位相同」（这句话我**证不出来**）。
4. **新套件的 PowerShell 子进程只在本机 PS 5.1 上验过**：跨 Windows 版本 / 非 Windows 未验。
5. **没有做「修好的实现」与「更隐蔽的撞名变体」的穷举搜索**：我只测了
   `$script:assertPass/$script:assertFail/$suiteFailed` 三组旧名回改这一种撞名。
   其它潜在的重名组合（如未来新增的局部变量与 `$script:` 作用域变量撞名）**未穷举**。
6. **未验安装/卸载脚本在真实 `%USERPROFILE%` 下的行为**（同上，只读边界）。
7. **未 commit / 未 push / 未改可见性 / 未建 tag** —— 本单明写的约束。

---

## 10. 探针自曝（我自己踩的 5 个坑；阴性伪装成阳性比报错更糟）

| # | 我犯的错 | 当时看到的现象 | 怎么发现的 | 怎么修的 |
|---|---|---|---|---|
| 1 | 用 PS `Get-Content -Raw`（默认 ANSI）读 UTF-8 日志 | 「全部通过」出现 **0** 次 | node 按 UTF-8 读同一文件是 **6** 次 | 后续所有文本分析一律走 node（`v066-analyze.cjs` / `v066-hits.cjs`） |
| 2 | 用 `Tee-Object` 存回归日志 | 计数脚本报 `suites: 0`（PS 5.1 的 `Tee-Object` 写 UTF-16） | 控制台明明有 13 行 `RESULT` | 改 `Out-File -Encoding utf8` → 13 套 / 836 条 / 0 FAIL |
| 3 | 用 `Get-Content` 读 `plugin.json` | 中文 description 全是乱码（`缂栨帓`…） | 同一个文件的 `"version": "0.5.7"` 正常，node 读却是正常中文 | 改用 node + `JSON.parse` → description 正常 |
| 4 | 用 `[System.IO.Path]::GetRelativePath`（.NET Core API） | PS 5.1 报「不包含名为 GetRelativePath 的方法」×28 | 报错原文直说 | 改用 `$_.FullName.Substring($d.Length+1)` |
| 5 | 拿 node 的小写 digest 直接比 v065 的大写基线串 | 11 个文件全部 `match: false`（**看起来像全盘被改**） | 逐位比对发现**只有大小写不同** | 改大小写无关比较 ⇒ 11/11 `match: true` |
| 6 | 真实安装目录整树哈希用我自己拼的格式 | `REAL_MATCHES_V065_BASELINE=False`（**假警报**） | 文件数 28 一致 + 最新 mtime 与 v065 记录逐位一致 ⇒ 不可能是真改动 | 穷举 525 种格式仍不匹配 ⇒ 判定「算法不可复现」（v065 脚本未留存），改用 mtime + 条目数作权威证据，并在 9.3 明确写出这条**证不出来** |

> 第 5、6 条与 v065 的探针错误 #9 是**同一个坑的两次复发**：
> 「换了一种哈希算法就以为内容变了」。我把它写进报告而不是悄悄改掉口径。

---

## 11. 本轮证据清单（`docs/audit/.tmp-v055/`）

| 文件 | 字节 | 内容 |
|---|---|---|
| `v066-final-green.log` | 25463 | 基线绿跑（A/D 复跑全绿的原始日志） |
| `v066-run-repo.log` | 26037 | 含空格+中文 TEMP 的绿跑 |
| `v066-run-ascii.log` | 25463 | 纯 ASCII TEMP 的绿跑 |
| `v066-suite.log` | 2585 | 新套件单独跑（18 条全绿） |
| `v066-b-collide-chain.log` | 25828 | **撞名态**下整链跑（双层防线转红） |
| `v066-b-collide9-chain.log` | 25895 | **撞名 + 头部 9**（复现原始 X1 签名） |
| `v066-c-regression.log` | 608 | 仓库回归 13 套 / 836 条 |
| `v066-backup-run-all.ps1` | 7346 | `run-all.ps1` 的原始字节备份 |
| `v066-mutate.cjs` | 3374 | 突变 harness（backup / head9 / collide / collide9 / restore / verify） |
| `v066-analyze.cjs` | 1591 | 日志分析器（精确取横幅行） |
| `v066-hits.cjs` | 634 | 「全部通过」逐行定位 |
| `v066-owncount.cjs` | 869 | run-all 自身断言条数独立计数 |
| `v066-count.cjs` | 711 | 回归条数独立计数 |
| `v066-final.cjs` | 1897 | 11 文件哈希基线复核 |
| `v066-realhash*.cjs` | 2075 / 2013 / 2366 | 真实安装目录哈希格式穷举（525 组合） |
| `v066-run.ps1` | 1732 | 两种 TEMP + 单套件 runner |
| `v066-cleanup.ps1` / `.log` | 1816 / 1452 | 临时产物清理 |

---

## 12. 最终判定

| 项 | 判定 | 关键证据 |
|---|---|---|
| A 触发红（头部+标记改成 9） | **PASS** | `RUNALL_EXIT=1`；链自己的横幅 `==== 自测：未通过 —— 套件未通过 1 / 6；断言红 1 条 ====`，**不含**「全部通过」；还原后哈希回原值、复跑 6/6 全绿 |
| B 新套件行为级 + 牙齿 | **PASS** | 真起 PS 子进程跑三份副本（变体 exit 0/1/0 各不相同）；亲自把撞名改回真实脚本 → 新套件 **5 条 FAIL / exit 1**；撞名+头 9 复现原始 X1 签名；已还原 |
| C 回归 + plugin/ 零改动 + 版本 | **PASS** | 13 套 / 836 条 / 0 FAIL（自数）、`SHELL ALL PASS`；`git diff --name-only -- plugin/` 空；版本 0.5.7 |
| D 两种 TEMP | **PASS** | ASCII 无空格 与 空格+中文 各一次，均 6/6 全绿、0 FAIL、exit 0 |
| E 收尾 | **PASS** | `git status` 与基线逐行相同；11 个文件哈希全回原值；真实安装目录 0 条目被改、mtime 与 v065 逐位一致 |

# VERDICT: PASS

**现在能不能公开？—— 能。**

本轮 A–E 五项全部通过，未发现阻塞公开的缺陷，仓库无未跟踪垃圾，被验文件与真实安装目录均未被改动。
（范围限定：本结论只覆盖本单 A–E 五项；v065 其它条目本轮未重查。）
