# v0.5.7 公开前最后一轮收尾（fix3）—— 修 v064 复验的 W1 / W2 / W3

| 项 | 内容 |
|---|---|
| 依据 | `docs/audit/verification-v064.md`（复验方原文，父会话按字节转写，sha256 `365a8ff59fa1e41a79fb8544ddabe856a08c4aad125d9a86f775270c3ef74ef6`） |
| 要修的 | **W1（中，必须公开前修）** / W2（低）/ W3（低） |
| v064 的四条既有修复 | V1 / V2 / V3 / V4 **不推翻** —— 本单末尾用突变体对照 + 回归证明它们没被改坏（§5） |
| 不做 | 不升版、不改 `plugin/`、不动 `.superagent/`、不碰 `docs/audit/*.md`（正式路径由父会话转写）、不 commit / push / 改可见性 / 建 tag |

**核心结论先说**：本单修完之后，**整套自测在「纯 ASCII 无空格 TEMP」与「含空格 + 含中文 TEMP」下都是 5/5 全绿、exit 0**
（264 条断言 0 FAIL）—— 也就是说，**「221 条 0 FAIL」这个声称，现在在发布者自己的机器上成立了**。

---

## 1. W1（中）—— 自测在「路径含空格或非 ASCII」下红

### 1.1 先把根因测准（不是抄 v064，是自己从 PowerShell 侧复现）

关键前提：**畸形只发生在「PowerShell 自己发起原生进程」这条通道上**。
node 的 `spawnSync` 会正确转义参数，所以用 node 驱动时**三种传参方式全部完好** —— 测不出来。
必须从 PowerShell 侧测（探针 `docs/audit/.tmp-release/ps-arg-probe.ps1`，纯 ASCII + UTF-8 BOM）：

```
=== ASCII_NOSPACE ===
  [-File native]  intact=True  gotLen=49 gotTail=probe-ascii\
  [-Command quote] intact=True  gotLen=49 gotTail=probe-ascii\

=== ASCII_SPACE ===
  [-File native]  intact=False gotLen=44 gotTail=p\arg probe"      <- 末尾多出一个 "
  [-Command quote] intact=True  gotLen=44 gotTail=p\arg probe\      <- 完好

=== CN_SPACE ===（路径含中文 + 空格）
  [-File native]  intact=False gotLen=83 gotTail=N SPACE dir"      <- 末尾多出一个 "
  [-Command quote] intact=True  gotLen=83 gotTail=N SPACE dir\      <- 完好
```

⇒ 与 v064 一致：**含空格、或含非 ASCII，各自独立地**会让 `-File` + 原生命令行传递的尾随反斜杠畸形；
**`-Command` 把「脚本 + 参数」整体留在子进程里、参数值用单引号包住 ⇒ 三种形态全部完好**。

同一个探针还测出了**真实用户写法**的畸形形态：

```
=== malformed: real cmd command line (space + trailing backslash) ===
  cmdline=powershell -NoProfile -ExecutionPolicy Bypass -File "C:\...\mini code的插件\...\argprobe.ps1" -Target "C:\...\mal dir\"
  [cmd /c]        intact=False got=C:\...\mal dir"     <- 末尾多出一个 "
```

那个多出来的 `"` 正是 `GetFullPath` 抛「Illegal characters in path.」的直接原因（W2 的触发形态）。

### 1.2 改法：S18 / S19 换成「参数能完整到达」的调用方式

采用**方案 A**（`-Command` 单引号内联）。`tools/install-selftest/sandbox-test2.ps1`：

| 位置 | 改了什么 |
|---|---|
| `:162-164` | 新增 `Quote-Single()`：单引号串里的单引号要写成两个（PowerShell 单引号串里 `'` 要转义） |
| `:166-172` | 新增 `RunPsQuotedArg()`：`-Command "& '<脚本>' -Target '<值>'"` —— 参数整体留在子进程的命令行里，末尾反斜杠不被闭引号吃掉；子进程的 exit code 仍可观测（`$LASTEXITCODE`） |
| `:179-186` | `Get-EchoedArg()` 改成**与被测脚本同一种**的传参方式（`-Command` 内联）⇒ echo 与实际到达值同源 |
| `:188` | S18 的构造有效性断言改成逐字比较（`-ceq`，大小写敏感） |
| `:190-191` / `:196-200` | S18 / S19 的实跑调用改用 `RunPsQuotedArg` |

**arg-echo 逐字断言**（W1-1 的硬证据，实测输出）：

```
PASS  S18 构造有效性：尾随反斜杠确实原样传到了脚本
PASS  S19 构造有效性：尾随反斜杠确实原样传到了脚本
```

（断言名里的「原样传到了脚本」是刻意改的 —— 上一版叫「确实传到了脚本」，
而 v064 的现场恰恰是「传到了，但被改了」。措辞改成「原样」，钉的就是这件事。）

### 1.3 新增场景（W1-2）：命令行畸形参数 ⇒ 干净报错 + 零副作用

`tools/install-selftest/sandbox-test2.ps1:203-245`，两个新场景：

| 场景 | 构造 | 断言 |
|---|---|---|
| **S20**（8 条，`:216-224`） | **真实 cmd 命令行**：`cmd /c powershell -File "<install.ps1>" -Target "<含空格路径>\"` ⇒ 子进程收到末尾多一个引号的值 | 夹具有效性（同一个命令行打给 arg-echo 探针，**必须**看到末尾那个引号）/ 非零退出 / 报错点名「含 Windows 路径非法字符」/ 点名最可能原因 / 给出正确写法 / **没有 .NET 异常堆栈** / 零副作用（用户想指的目录整棵哈希前后相同）/ 没建出插件目录 |
| **S21**（6 条，`:239-245`） | 同上，但打给 `uninstall.ps1 -Purge`，目标是一个**真实的插件目录** | 夹具有效性 / 非零退出 / 报错点名 / 点名原因 / 没有 .NET 堆栈 / **零删除**（整棵目录哈希前后相同） |

两个场景的「夹具就绪」断言都是**实测值**，不是假定：

```
PASS  S20 夹具就绪：真实命令行确实把末尾反斜杠变成了一个引号
PASS  S21 夹具就绪：真实命令行确实把末尾反斜杠变成了一个引号
```

### 1.4 W1-3 核心验收：两种 TEMP 下都要 0 FAIL

跑法（`docs/audit/.tmp-release/run-with-temp.ps1`，把 `$env:TEMP` / `$env:TMP` 指过去再跑 `run-all.ps1`）：

```
# ① 纯 ASCII 无空格
$ powershell -NoProfile -ExecutionPolicy Bypass -File "docs/audit/.tmp-release/run-with-temp.ps1" -TempDir "C:\sar-temp-ascii"
[TEMP] C:\sar-temp-ascii
==== 沙箱实跑：PASS 41 / FAIL 0 ====
==== 跨插件保护与不误伤：PASS 44 / FAIL 0 ====
==== 尾随空格路径身份（AFTER(修复后)）：PASS 39 / FAIL 0 ====
==== 播种与安装副本（node 侧）：PASS 21 / FAIL 0 ====
==== 文档与实现对账：PASS 119 / FAIL 0 ====
PASS  全部套件断言总数：声明 264 == 实际 264
==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
RUNALL_EXIT=0

# ② 仓库内（路径含空格 + 含中文）—— 就是发布者自己的机器
$ powershell -NoProfile -ExecutionPolicy Bypass -File "docs/audit/.tmp-release/run-with-temp.ps1" -TempDir "C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-selftest-temp"
[TEMP] C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-selftest-temp
==== 沙箱实跑：PASS 41 / FAIL 0 ====
==== 跨插件保护与不误伤：PASS 44 / FAIL 0 ====
==== 尾随空格路径身份（AFTER(修复后)）：PASS 39 / FAIL 0 ====
==== 播种与安装副本（node 侧）：PASS 21 / FAIL 0 ====
==== 文档与实现对账：PASS 119 / FAIL 0 ====
PASS  全部套件断言总数：声明 264 == 实际 264
==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
RUNALL_EXIT=0
```

两种 TEMP 下**逐套件条数完全一致**（41 / 44 / 39 / 21 / 119 = 264），0 FAIL，exit 0。

---

## 2. W2（低）—— 用户手工写 `-Target "D:\My Plugins\"` 会拿到未捕获的 .NET 异常

### 2.1 改法：加一道**独立的**非法字符闸门（在 GetFullPath 之前）

新增函数 `Assert-NoIllegalPathChars()`，**两个脚本里逐字相同**：

| 文件 | 函数定义 | 调用点 | 规范化点 |
|---|---|---|---|
| `install.ps1` | `:107-136` | `:244`（USERPROFILE）、`:251`（-Target）、`:255`（-Project） | `GetFullPath` 在 `:257`（-Target）与 `:400`（-Project） |
| `uninstall.ps1` | `:119-148` | `:167`（USERPROFILE）、`:174`（-Target） | `GetFullPath` 在 `:175` |

⇒ **闸门全部在 GetFullPath 之前**（这一条被对账断言按**行号顺序**钉住，见 §4）。

闸门判定的字符集：`"` `<` `>` `|` `*` `?` 与控制字符（0x00-0x1F）。
其中前 5 个 + 控制字符正是 .NET `Path.GetInvalidPathChars()` —— **GetFullPath 碰到它们必抛异常**；
`*` / `?` 在 Windows **目录名**里其实合法、`GetFullPath` 也收，
本单按契约**一并拒绝**（fail closed），代价是这类极少见路径会被挡下并给出可读提示 —— 这是刻意从严，§7 已如实交代。

**两条硬约束都守住了**：

- **绝不静默修复**：闸门只报错、不改写用户给的路径。
  对账断言 `check-readme-consistency.mjs:257` 直接检查闸门实现里**不含** `Replace` / `-replace` / `.Trim` ——
  「把那个多余的引号悄悄去掉再继续跑」在实现层面被禁掉了。
- **不放松 F1 的空白判定**：空白闸门仍然**先于**非法字符闸门执行（`install.ps1:243→244`、`uninstall.ps1:166→167`），
  尾随空格仍然由 `Assert-NoTrailingWhitespace` fail closed。
  对账断言 `check-readme-consistency.mjs:259` 钉住两个脚本里 `Assert-NoTrailingWhitespace` 仍在。

### 2.2 报错原文（真实 cmd 命令行，两个脚本逐字相同）

```
CMD: powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\yang2\Documents\MiniMax\mini code的插件\install.ps1" -Target "C:\Users\yang2\AppData\Local\Temp\mal dir\"
EXIT=1

  [X] 路径参数 -Target 含 Windows 路径非法字符（第 42 个字符「"」）—— 已停止，未做任何改动。
      最可能的原因：命令行里**末尾的反斜杠被闭引号吃掉**了 —— 例如 -Target "D:\My Plugins\" 实际会被解析成 D:\My Plugins"（多出一个引号）。
      正确写法：去掉末尾的反斜杠（-Target "D:\My Plugins"），或者把末尾写成两个反斜杠（-Target "D:\My Plugins\\"）。
```

对照 —— **修复前**用户拿到的是（实测复现，`docs/audit/.tmp-release/gfp-probe.ps1`）：

```
EXCEPTION: Exception calling "GetFullPath" with "1" argument(s): "Illegal characters in path."
```

现在：点名了**哪条参数**、**第几个字符**、**最可能的原因**、**正确写法**，并且**没有 .NET 堆栈**
（S20 / S21 各有一条断言专门盯「输出里不许出现 Illegal characters in path」）。

### 2.3 报错文案被逐字钉住

`tools/install-selftest/check-readme-consistency.mjs:227-262` 共 **20 条** W2 断言：

- 两个脚本都有闸门（`:228` / `:230`）；
- 闸门在 `GetFullPath` 之前（按**行号顺序**比，`:232`）；
- 覆盖 `-Project` 与家目录（`:236` / `:237`）；
- 五个关键短语在**两个脚本**里都逐字存在（`:239-248`，各 2 条）；
- **两个脚本的闸门实现逐字相同**（`:255`，用提取函数体比对）；
- 闸门**不改写**用户给的路径（`:257`）；
- F1 的空白判定仍在（`:259`）；
- README 写明正确写法（`:261`）。

---

## 3. W3（低）—— run-all.ps1 自身条数硬编码 7

### 3.1 改法：声明值从自己头部读 + 结构性期望交叉核对

`tools/install-selftest/run-all.ps1:107-112`：

```powershell
$selfSrc = [System.IO.File]::ReadAllText((Join-Path $here 'run-all.ps1'), [System.Text.Encoding]::UTF8)
$selfM = [regex]::Match($selfSrc, 'ASSERTION-COUNT:\s*(\d+)')
$selfDeclared = -1
if ($selfM.Success) { $selfDeclared = [int]$selfM.Groups[1].Value }
$selfStructural = $suites.Count + 2
Check ('run-all.ps1 自身实际断言条数 == 头部声明（' + $selfDeclared + '）且 == 结构性期望（子套件 ' + $suites.Count + ' + 2 = ' + $selfStructural + '）') ...
```

- **声明值不再写死**：从自己的头部正则读 ⇒ v064 说的「头部和机器标记一起改成 8 而不加断言」这条洞被堵死。
- **再与结构性期望交叉核对**（子套件数 + 2 = 5 + 2 = 7）：即便头部与机器标记被一起改，
  实际条数 7 ≠ 声明 8 ⇒ 仍然红。
- run-all 自身的断言**条数不变（7）**，所以 V4 的三方绑定与 README 表格都不用改。

### 3.2 这条断言**有牙齿**（改错即红）

把 `run-all.ps1` 头部的机器标记 `7` 改成 `8`（**不加任何断言**）再跑：

```
=== run-all 头部条数被改成 8（不加断言）之后 ===
exit=1
FAIL  run-all.ps1 头部人类可读条数与机器标记一致（8 条断言）   :: 头部没有「（8 条断言）」
FAIL  run-all.ps1 自身实际断言条数 == 头部声明（8）且 == 结构性期望（子套件 5 + 2 = 7）   :: 实际=7 declared=8 structural=7
==== 自测：1 / 5 个套件未通过；条数对账 1 条红 ====

已还原；还原后标记行：机器标记：ASSERTION-COUNT: 7
```

（**改前**这个场景是绿的 —— 那正是 W3 说的洞。现在红了。）

对账断言 `check-readme-consistency.mjs:264-270`（3 条）把这三条性质钉成永久断言：
不写死常量 / 从自己头部读 / 有结构性期望交叉核对。

---

## 4. ACCEPT 逐条核对

| # | ACCEPT | 结论 | 证据 |
|---|---|---|---|
| W1-1 | 尾随反斜杠场景改成参数能完整到达的调用方式，且有 arg-echo 逐字断言证明 | **PASS** | §1.1（三形态实测表）、§1.2（`sandbox-test2.ps1:162-200`）、arg-echo 断言 `:188` / `:196` 实测 PASS |
| W1-2 | 命令行畸形参数场景 ⇒ 干净可读的错误 + 零副作用 | **PASS** | §1.3（S20 8 条 + S21 6 条，`:203-245`）；§2.2 报错原文；零副作用 = 整棵目录哈希前后相同 |
| W1-3 | 整套自测在「纯 ASCII 无空格 TEMP」与「含空格含中文 TEMP」下都 0 FAIL | **PASS** | §1.4 两组原始输出：各 5/5、264 条 0 FAIL、RUNALL_EXIT=0 |
| W2 | 两个脚本都有非法字符闸门，报错文案点名原因与正确写法；不静默修复；不放松空白判定；有对账断言钉住文案 | **PASS** | §2.1（闸门位置与字符集）、§2.2（报错原文）、§2.3（20 条对账断言） |
| W3 | run-all 自身条数自推导 | **PASS** | §3.1（头部读 + 结构性期望）、§3.2（改错即红，已还原） |
| 回归 | 13 套 / 836 条 / 0 FAIL；`git diff --name-only -- plugin/` 为空；版本仍 0.5.7 | **PASS** | §5 |
| 上一轮 V1/V2/V3/V4 没被改坏 | 突变体对照仍恰好转红、金丝雀仍绿 | **PASS** | §5.1（AFTER 39/0、BEFORE 19/20、恰好转红 20、恒绿 19、金丝雀 6 条在 BEFORE 全绿、EXTRA-RED 0） |
| V4 的机器标记仍在工作 | 头部声明条数 == 实测条数 | **PASS** | 两种 TEMP 下逐套件「声明 == 实际」全绿；总数 264 == 264 |

---

## 5. 关键命令与原始输出

### 5.1 上一轮的 V1 没被改坏（突变体对照，夹具先验有效性）

```
FIXTURE mutant/plugin exists      = true
FIXTURE mutant/plugin file count  = 28
FIXTURE mutant/plugin.json exists = true
FIXTURE mutant plugin.json name   = super-agent-router
FIXTURE mutant/.superagent exists = true
FIXTURE mutant/install.ps1 替换调用行=3 保留函数定义=1 BOM=true
FIXTURE mutant/uninstall.ps1 替换调用行=2 保留函数定义=2 BOM=true
FIXTURE ParseFile: PARSE_OK ...\mutant\install.ps1 | PARSE_OK ...\mutant\uninstall.ps1

AFTER : PASS 39 / FAIL 0  exit=0
BEFORE: PASS 19 / FAIL 20  exit=1
恰好转红 = 20 条
恒绿 = 19 条
金丝雀 6 条在 BEFORE 是否全绿 = true
EXTRA-RED（AFTER 红）= 0
```

与 v064 §4 的基线**逐项相同**（20 / 19 / 金丝雀全绿 / EXTRA-RED 0）⇒ V1 的牙齿没被本单碰掉。
（本单给 mutant 加了 `Assert-NoIllegalPathChars` 调用行，但突变体只摘 `Assert-NoTrailingWhitespace` 的调用行，
非法字符闸门在突变体里仍在 —— 它对尾随空格场景无影响，故对照结论不变。）

### 5.2 仓库回归

```
$ node tools/run-tests.mjs --all --root plugin --repo .
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
>>> SHELL ALL PASS          # 13 套 / 836 条 / 0 FAIL（与基线逐项相同）
```

### 5.3 工作树与包内自洽

```
$ git diff --name-only -- plugin/
  （空）                      # plugin/ 零改动
$ node -e "console.log(require('./plugin/.minimax-plugin/plugin.json').version)"
  0.5.7
$ git status --short
   M README.md
  ?? LICENSE
  ?? docs/audit/install-v057-fix.md
  ?? docs/audit/install-v057-fix2.md
  ?? docs/audit/install-v057.md
  ?? docs/audit/verification-v062.md
  ?? docs/audit/verification-v063.md
  ?? docs/audit/verification-v064.md
  ?? install.ps1
  ?? tools/install-selftest/
  ?? uninstall.ps1
```

（`LICENSE` 与 `docs/audit/*.md` 不是本单产物 —— 是别人/父会话的。）

### 5.4 文件指纹（改前 → 改后）

| 文件 | 字节 | BOM / 行尾 | sha256 前 16 |
|---|---|---|---|
| `install.ps1` | 21,627 → **24,109** | BOM=Y / CRLF=n | `1f441eaa477b992b` |
| `uninstall.ps1` | 13,113 → **15,461** | BOM=Y / CRLF=n | `4171b0e8315fa7d4` |
| `README.md` | 16,162 → **17,120** | BOM=n / CRLF=n | `c353d95207d40b6c` |
| `tools/install-selftest/sandbox-test2.ps1` | 11,863 → **18,160** | BOM=Y / CRLF=n | `69c5a94e854e3cf1` |
| `tools/install-selftest/run-all.ps1` | 5,473 → **6,277** | BOM=Y / CRLF=n | `af9dd0a535592550` |
| `tools/install-selftest/check-readme-consistency.mjs` | 13,802 → **18,324** | BOM=n / CRLF=n | `2f6349ae9e00f546` |
| `tools/install-selftest/trailing-space-test.mjs` | 18,710（**未改**） | BOM=n / CRLF=n | `6c8adbdf3abf4150` |
| `tools/install-selftest/verify-seed.mjs` | 6,756（**未改**） | BOM=n / CRLF=n | `07b9d4c9b295445f` |
| `tools/install-selftest/sandbox-test.ps1` | 12,495（**未改**） | BOM=Y / CRLF=n | `e7de581eaa97bfd6` |

---

## 6. 改动文件清单（全部在 SCOPE 内）

| 文件 | 改了什么 |
|---|---|
| `install.ps1` | **W2**：新增 `Assert-NoIllegalPathChars`（`:107-136`）+ 三处调用（`:244` / `:251` / `:255`，全在 `GetFullPath` 之前）；`.DESCRIPTION` 补第 7 条 |
| `uninstall.ps1` | **W2**：新增**逐字相同**的 `Assert-NoIllegalPathChars`（`:119-148`）+ 两处调用（`:167` / `:174`，全在 `GetFullPath` 之前）；`.DESCRIPTION` 补一条 |
| `tools/install-selftest/sandbox-test2.ps1` | **W1-1**：`RunPsQuotedArg` / `RunPsCmdLine` / `Quote-Single` / `Get-EchoedArg` 改写；S18 / S19 改用内联传参。**W1-2**：新增 S20（8 条）与 S21（6 条）。断言 30 → **44** |
| `tools/install-selftest/run-all.ps1` | **W3**：自身条数改为从自己头部读 + 结构性期望交叉核对（`:107-112`）；自身断言数不变（7） |
| `tools/install-selftest/check-readme-consistency.mjs` | 新增 **W1（6 条）/ W2（20 条）/ W3（3 条）** 对账断言。断言 90 → **119** |
| `README.md` | 卸载节补「末尾反斜杠被闭引号吃掉」+ 两种正确写法（`:253-258`）；自测节补「路径形态无要求」（`:220`）；自测表条数更新 |
| `docs/audit/.tmp-release/install-v057-fix3.md` | 本报告（父会话转写正式路径） |

**没动**：`plugin/`（零改动）、`.superagent/`、`docs/audit/*.md`、`LICENSE`、
`tools/install-selftest/trailing-space-test.mjs`、`verify-seed.mjs`、`sandbox-test.ps1`、`tests/`。

---

## 7. 边界与未覆盖（不夸大）

1. **真实安装目录仍未实跑**（只读约束）：`C:\Users\yang2\.minimax\plugins\super-agent-router` 全程只读、未被写入；
   真实运行时台账 `~/.minimax/v2/plugin-data/hooks/super-agent-router` 也没被碰。
   所有安装 / 卸载都在 `%TEMP%` 沙箱里、`%USERPROFILE%` 被重定向到假家目录。
2. **UNC 根（真实网络共享）仍未端到端实跑**：本单也没建共享。
3. **`-PurgeData` 分支仍未实跑**（操作真实台账路径，只读约束下不能跑）；本单没碰它。
4. **W2 闸门把 `*` / `?` 也拒了**（按契约）。这两个字符在 Windows **目录名**里其实合法、`GetFullPath` 也收 ——
   这是**刻意从严**（fail closed），代价是这类极少见路径会被挡下并给出可读提示。
   如果验收方认为应当只挡 `GetInvalidPathChars()` 那 6 类，需要放宽的话改一处字符集即可（两侧同步）。
5. **突变体只摘 F1 守卫**（install 3 处 / uninstall 2 处），**不检验 W2 闸门的贡献**。
   W2 的贡献由 S20 / S21 **直接实测**（真实 cmd 命令行 ⇒ 干净报错 + 零副作用），但**没有**做
   「摘掉 W2 闸门 ⇒ 哪几条转红」的突变体对照。
6. **未在 FAT32 / exFAT / 网络盘 / 长路径（>260 字符）复测传参行为**；本单只在本机 NTFS + 本地盘上验证。
7. **`-Command` 内联法对脚本路径里的 `&` 没有处理**（`&` 在 Windows 文件名里合法）。
   单引号 `'` 已做转义（`Quote-Single`，`sandbox-test2.ps1:162-164`）。本仓库路径不含 `&`。
8. **命令行畸形参数的复现依赖 cmd.exe**（`cmd /c`）：这是**真实用户写法**的形态；
   PowerShell 用户在同一写法下也会得到同样的畸形（同样的引号规则）。
9. **README 的 clone 地址本单未复验**（上一轮复验为 404）—— 属父会话的发布门槛。
10. **未改仓库可见性 / 未 commit / 未 push / 未建 tag** —— 按协议由父会话统一做。

---

## 8. 探针自曝（本单自己踩的坑 / 无效探针 / 被污染的对照）

1. **我的突变体夹具坏了 —— 对照组被污染，金丝雀被无关原因带红。**
   `docs/audit/.tmp-release/mutant-compare.mjs` 的第二版**丢了** `fs.cpSync(plugin/)`；
   上一轮我把突变体目录清理掉之后重跑，突变体目录里**没有 `plugin/`** ⇒ mutant 的 install 栽在
   「源目录不存在」⇒ **金丝雀 2 条被带红**（BEFORE 变成 24/15，恰好转红 15 条而不是 20 条）。
   **这是我的探针夹具无效，不是产品或断言的问题。**
   修法：恢复 cpSync，并**新增夹具有效性断言**（plugin 存在 / 28 个文件 / plugin.json name 正确 /
   `.superagent` 存在 / ParseFile OK）—— **先证明对照组本身没问题，再看对照结果**。
   修正后：AFTER 39/0、BEFORE 19/20、恰好转红 20、恒绿 19、金丝雀 6 条在 BEFORE 全绿、EXTRA-RED 0。
2. **node 复现「真实 cmd 命令行」不忠实。** 我用 node 的 `spawnSync` 调 `cmd.exe` 时，
   cmd 把 **`-File` 路径本身**弄坏了（`Processing -File '"C:\Users\yang2\Documents\MiniMax\mini' failed`），
   根本轮不到 `-Target`。⇒ 我改用**与套件同一条 PowerShell 路径**（`& cmd.exe /c $cmdLine`）去抓原文，
   抓到的才是用户真正会遇到的形态。**node 只适合驱动 powershell.exe 直接传参**（node 的转义是对的）。
3. **我的头部条数又写错一次**：`sandbox-test2.ps1` 我先声明 43、实跑 **44** ——
   被 V4 的防漂当场抓住（`FAIL 套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 43 / 实际 44）`），
   回填后一致。
4. **`powershell -File` 不接受路径中间带 `..`**：我的 runner 脚本第一次用
   `Join-Path $PSScriptRoot '..\..\tools\...'` 拼路径，子进程直接报「参数不存在」、exit=`-196608`。
   改成用 `Split-Path -Parent` 逐级解析仓库根。
5. **我的第一版探针把「环境变量法」误判为失败**：`-Command "& 'probe.ps1' -Target $env:SAR_ARG_TARGET"` 里的
   `$env:` 被**外层** PowerShell 先插值成空串 ⇒ got=`<none>`。那是我的写法问题，不是环境变量法的问题。
   本单最终采用方案 A（`-Command` 单引号内联），已实测三种形态均完好。
6. **报错文案里的三连引号我改掉了**：初版把「引号字符」再用引号包一层，打印出来是
   `第 42 个字符 """` —— 容易误读。改成 `第 42 个字符「"」`（两个脚本同步改，闸门实现仍逐字相同）。
7. **`mavis-trash` 删不掉带尾随空格子目录的沙箱**（`C:\sar-temp-ascii` 报 failed）——
   要用 `\?\` 扩展路径 + node 的 `fs.rmSync` 才删得掉（RT-08 同类）。已清干净（复查为 0）。
   **本单没有去修宿主侧**，只如实记录。
8. **我自写的 `.ps1` 探针一律 UTF-8 with BOM**（验收方上一轮栽过「无 BOM 的 .ps1 写中文被 PS 5.1 读坏」）；
   探针内容尽量纯 ASCII。

---

## 9. 结论

W1 / W2 / W3 三条全部落地，且每条都有「改前会红 / 改后全绿」的机器证据。
**W1 的核心验收点达成：整套自测在「纯 ASCII 无空格 TEMP」与「含空格 + 含中文 TEMP」下都 5/5 全绿、exit 0**
（各 264 条 0 FAIL）—— 上一轮那句「221 条 0 FAIL」在发布者自己的机器上现在成立了。
上一轮的 V1 / V2 / V3 / V4 **没有被改坏**（突变体对照 20 / 19 / 金丝雀全绿 / EXTRA-RED 0）；
`plugin/` 零改动、版本仍 `0.5.7`；仓库回归 **13 套 / 836 条 / 0 FAIL**。
本单**未 commit / 未 push / 未改可见性 / 未建 tag** —— 正式路径的转写与发布动作留给父会话。

---

## 10. 收尾清理与清理后复验（清理发生在本报告落盘之后，故补记）

删除一律走 `mavis-trash.js`（`Remove-Item` 被拦）；带尾随空格的目录名 `mavis-trash` 删不掉（§8 第 7 条），
改用 `\\?\` 扩展路径 + node `fs.rmSync` 兜底。

| 对象 | 判定 | 方式 | 复查 |
|---|---|---|---|
| `docs/audit/.tmp-release/mutant/` | 突变体夹具（可由 `mutant-compare.mjs` 重建） | mavis-trash.js | GONE |
| `docs/audit/.tmp-release/fixmd3.mjs` | 报告落盘用的一次性脚本 | mavis-trash.js | GONE |
| `docs/audit/.tmp-release/CN SPACE dir/` | 探针残留目录 | mavis-trash.js | GONE |
| `docs/audit/.tmp-release/_rm-left.mjs` / `_rm2.mjs` | 清理用的一次性脚本 | mavis-trash.js | GONE |
| `C:\sar-temp-ascii` | TEMP ① ASCII 沙箱 | mavis-trash.js | GONE |
| `%TEMP%\sar-selftest-ts-20261111041326` | 早一轮残留沙箱（含带尾随空格子目录） | `\\?\` + `fs.rmSync` | GONE |
| `docs/audit/.tmp-selftest-temp` | TEMP ② CN+空格 沙箱 | `\\?\` + `fs.rmSync` | GONE |
| 仓库根 `Microsoft/` | PowerShell 运行时缓存目录（见下方诚实边界） | mavis-trash.js | GONE（`git status` 已无此项） |

**保留**（本报告 §1 / §2 / §5 / §8 引用，删了评审就复跑不了）：`ps-arg-probe.ps1`、`run-with-temp.ps1`、
`gfp-probe.ps1`、`mutant-compare.mjs`、`argprobe.ps1`、`argprobe/`、`w3-teeth-check.mjs`、`raw-malformed.ps1`、
`parse-check.ps1`、`cleanup-tmp.mjs`、`cleanup-ascii.mjs`。

**清理后复验（全部实跑，发生在清理之后；复验用的沙箱跑完再次删除）**：

- TEMP ① `C:\sar-temp-ascii`（纯 ASCII 无空格）：5/5 套件全绿，**264 条 0 FAIL**，`RUNALL_EXIT=0`
- TEMP ② `…\mini code的插件\docs\audit\.tmp-selftest-temp`（含空格 + 含中文）：5/5 套件全绿，**264 条 0 FAIL**，`RUNALL_EXIT=0`
- 仓库回归 `node tools/run-tests.mjs --all --root plugin --repo .`：13 套件 / **836 条 0 FAIL** / `>>> SHELL ALL PASS` / exit 0
- 交付文件指纹（sha256 前 16）与清理前**逐字一致**：`install.ps1` 1f441eaa477b992b / `uninstall.ps1` 4171b0e8315fa7d4 /
  `README.md` c353d95207d40b6c / `sandbox-test2.ps1` 69c5a94e854e3cf1 / `run-all.ps1` af9dd0a535592550 /
  `check-readme-consistency.mjs` 2f6349ae9e00f546 / `trailing-space-test.mjs` 6c8adbdf3abf4150 /
  `verify-seed.mjs` 07b9d4c9b295445f / `sandbox-test.ps1` e7de581eaa97bfd6 —— 清理没碰到任何交付物
- `git diff --name-only -- plugin/` 空；`plugin.json` version 仍 `0.5.7`；4 个自写 `.ps1` 全部 BOM=Y / CRLF=0

**诚实边界**：仓库根那个 `Microsoft/` 目录**不是本单的功能产物**。它的形态
`Microsoft\Windows\PowerShell\ModuleAnalysisCache` 与 PowerShell 模块分析缓存的默认位置
（`$env:LOCALAPPDATA\Microsoft\Windows\PowerShell\ModuleAnalysisCache`）一致；**本次未直接抓取该子进程的
`LOCALAPPDATA` 取值**，故只按「形态一致」记录，不断言成因。它会污染 `git status`，所以本单删掉了它 ——
但它**不构成 install.ps1 / uninstall.ps1 的行为证据**，本单也没有去改 PowerShell 侧的这个行为。



