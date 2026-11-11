# v0.5.7 公开前最后一道门 —— F1 / F6 / F2 / F3 修复的独立复验报告（v063）

- **验收方**：verifier，会话 `mvs_26fc11cb8e99483697531140266df940`
- **验收对象**：`install.ps1`、`uninstall.ps1`、根 `README.md`、`tools/install-selftest/`（6 个文件）、修复方报告 `docs/audit/install-v057-fix.md`
- **上一轮依据**：`docs/audit/verification-v062.md`（41,893 B，sha256 `3B8BD8E0D86ED0EFE29430F909A05229AAB4E6C9F7097DBB701C2D892571C79A`），判 `PASS_WITH_CONDITIONS`，第 4d 项 FAIL（F1）
- **本轮时间窗**：2026-11-11T10:41~10:52+08:00（本报告全部原始输出均出自该窗口）
- **本报告落盘**：`docs/audit/.tmp-v055/verification-v063.md`（正式路径由父会话转写，本单不写正式路径）
- **隔离声明**：全程**未写入**真实安装目录 `C:\Users\yang2\.minimax\plugins\super-agent-router`，只做只读列目录。所有安装 / 卸载 / 突变体实跑都在 `docs/audit/.tmp-v055/` 下的沙箱里完成（`TEMP`/`TMP` 已指向该目录）。
- **方法声明**：**不采信 brief 里的「修复声称」**（那 5 条一律当作待证命题），全部结论以本方实跑原始输出为准。对照结论来自**真实执行**（同一份测试脚本、同一 TEMP、同一 cwd 的配对运行），不靠读代码推断。
- **未改动声明**：仓库里的 `install.ps1` / `uninstall.ps1` / `README.md` / `tools/install-selftest/` / `plugin/**` / `tests/**` / `docs/audit/*.md` **一律只读**；本单写入只发生在 `docs/audit/.tmp-v055/`。未 commit / push / 改可见性 / 建 tag。

---

## 0. 结论速览

### 0.1 ACCEPT 逐条勾选

| # | ACCEPT | 结论 | 关键证据 |
|---|--------|------|----------|
| A1 | F1 拦截点在 `GetFullPath` 之前，且 `-Target` / `-Project` / 家目录三条入口都覆盖（含默认值） | **PASS** | `install.ps1:211/216/219` < `:221`（及 `:364`）；`uninstall.ps1:114/119` < `:120` |
| A2 | F6 的检查不再是同源自比较 —— 给出具体的「它会红」的判据 | **PASS（附 V3 残余）** | 旧 `$expected` 自比较已删；新增**内容级** manifest 核对（`uninstall.ps1:154-160`）实测会红；leaf/parent 两条仍是派生式恒真 |
| B | F2 / F3 文档口径与实际文件树一致 | **PASS** | 模板 4/4 对得上（`README.md:136-137`）；清理清单 7 项与实际 `.superagent/` 顶层 7 项一一对应（`README.md:171-177`） |
| C | 自测套件实跑 0 FAIL，且每个套件的条数已记录 | **PASS** | 5/5 套件通过，逐套件 41 / 13 / 20 / 21 / 54 = 149 条断言，0 FAIL |
| D | before / after 对照「恰好转红」，金丝雀仍绿，before 副本语法自检 PASS | **PASS（附 V1 口径说明）** | BEFORE `PASS 12 / FAIL 8`、AFTER `PASS 20 / FAIL 0`；8 条精确转红且不多红；金丝雀 4 条在 BEFORE 全绿；`ParseFile errors=0` |

### 0.2 总判定

**PASS_WITH_CONDITIONS —— 可以公开，但没有发现阻断性缺陷。**

- 本单负责的四项（F1 / F6 / F2 / F3）**全部修到位**：F1 拦截点位置正确、三条入口齐全，before/after 对照拿得到 8 条精确转红；F6 的恒真自比较已删、换成有牙齿的内容级核对；F2 / F3 文档与实际文件树一致。
- **无阻断项**。下列 4 条均非阻断：V1（中，自测断言不具区分度）、V2（低，尾随反斜杠误报）、V3（低，残余派生式恒真）、V4（低，自测头部条数与实际不符）。
- **发布门槛仍未解除**：`https://github.com/qsxcv20/super-agent-router` 本轮复验仍是 **404**（`GET https://api.github.com/repos/qsxcv20/super-agent-router` → `{"message":"Not Found","status":"404"}`，2026-11-11T10:50+08:00）。README 的一键安装第一步在公开前对外不可用 —— 公开 / push 是父会话的动作，本单不代做。
- 建议在公开前或紧随其后修 V1 与 V2（都是小改动，见 §7）。

---

## 1. 待验产物与工作树基线

```text
$ git status --short
 M README.md
?? LICENSE
?? docs/audit/install-v057-fix.md
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1

$ git log --oneline -3
746f755 chore: 把误入仓库根的 MCode 运行时参考文件移出版本控制（.gitignore 早已声明排除）
af35968 feat(mechanism): v0.5.7 —— 家目录展开下沉 + 空设备不是写目标（D-80 / D-85 闭环）
4c035ab docs(audit): v0.5.6 收口后最终复核通过（VERDICT: PASS，剩余阻塞项 0）
```

产物指纹（本轮实测）：

| 文件 | 字节 | mtime (UTC) | SHA256 |
|---|---|---|---|
| `install.ps1` | 21,627 | 2026-11-11T02:16:24Z | `711052F1B6DDB10E3A5F1EA30407EE79D7FB22BC9CDA89ADE734D85344EE939D` |
| `uninstall.ps1` | 10,913 | 2026-11-11T02:16:37Z | `938230AAA274D158D2362838A5A4CA33DC50382775177CEF51D04DBD121B6C74` |
| `README.md` | 15,373 | 2026-11-11T02:18:48Z | `548FC4A95E39FBBDB3F36B5553C6C6B2851FF898A7414A89FE4439929614E0B9` |
| `docs/audit/install-v057-fix.md` | 33,432 | 2026-11-11T02:36:28Z | `8DF54111DD76EBAA6FADE559E1B0F70D900A46A70A21FAA76F8D2F640E921437` |
| `docs/audit/verification-v062.md`（上一轮） | 41,893 | 2026-11-11T02:12:34Z | `3B8BD8E0D86ED0EFE29430F909A05229AAB4E6C9F7097DBB701C2D892571C79A` |

自测目录 6 个文件：`run-all.ps1` / `sandbox-test.ps1` / `sandbox-test2.ps1` / `trailing-space-test.mjs` / `verify-seed.mjs` / `check-readme-consistency.mjs`。

真实安装目录只读复核（本轮结束时刻）：

```text
REAL_CHECK_TIME_UTC=2026-11-11T02:45:06.5547304Z
REAL_FILE_COUNT=28
REAL_NEWEST_MTIME=2026-11-10T21:37:23.2202822Z
REAL_DIR_MTIME=2026-11-10T07:42:38.4637021Z
PLUGINS_ROOT_CHILDREN=super-agent-router
```

最新文件 mtime 仍是 `2026-11-10T21:37:23Z`（= 2026-11-11T05:37+08:00），**早于本轮任何写入**；`plugins` 根下仍只有 `super-agent-router` 一个子目录，未留下任何测试残留。

---

## 2. A —— F1 拦截点：位置、三条入口、覆盖默认值的证据

### 2.1 代码行号：拦截点 vs 规范化点

`install.ps1`：

| 行 | 内容 |
|---|---|
| `:83` | `function Assert-NoTrailingWhitespace([string]$value, [string]$label) {` |
| `:91` | `if ($value -match '[ \t]$') { $hits += '路径末尾' }` ← 整串末尾判定 |
| `:92` | `$parts = $value -split '[ \\/]'` ← 逐段判定 |
| `:95` | `$hits += ('第 ' + ($i + 1) + ' 段 "' + $parts[$i] + '')` |
| `:99` | `Fail ('路径参数 ' + $label + ' 含尾随空白（' + ($hits -join '；') + '）—— 已停止，未做任何改动。' + …)` |
| **`:211`** | `Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'` |
| `:212-214` | `if ([string]::IsNullOrEmpty($Target)) { $Target = Join-Path $env:USERPROFILE '.minimax\plugins' }` ← **默认值在此拼出** |
| **`:216`** | `Assert-NoTrailingWhitespace $Target '-Target'` |
| **`:219`** | `Assert-NoTrailingWhitespace $Project '-Project'`（在 `if (-not [string]::IsNullOrEmpty($Project)) {` 内） |
| `:221` | `$TargetRoot = [System.IO.Path]::GetFullPath($Target)` ← **规范化点，在三条守卫之后** |
| `:364` | `$stateRoot = Join-Path ([System.IO.Path]::GetFullPath($Project)) '.superagent'` ← `-Project` 的规范化点，也在守卫之后 |

`uninstall.ps1`：

| 行 | 内容 |
|---|---|
| `:76` | `function Assert-NoTrailingWhitespace([string]$value, [string]$label) {` |
| **`:114`** | `Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'` |
| **`:119`** | `Assert-NoTrailingWhitespace $Target '-Target'` |
| `:120` | `$TargetRoot = [System.IO.Path]::GetFullPath($Target)` ← **规范化点，在两条守卫之后** |
| `:121` | `$PluginDir = Join-Path $TargetRoot $Script:PluginName` |

**结论**：两个脚本里**所有** `GetFullPath` 调用（`install.ps1:221`、`:364`、`uninstall.ps1:120`）都在对应守卫调用**之后**，行号上无交叉。守卫本身也早于任何写操作（守卫在第 1 步；源包校验、安装、播种都在其后）。

### 2.2 「这条断言凭什么会红」的判据

守卫的判定条件**可枚举、与环境无关**：

- 整串末尾有空白 ⇒ `$value -match '[ \t]$'`（`install.ps1:91`）；
- **任意一段**末尾有空白 ⇒ 按 `[\/]` 切段后逐段判（`:92-97`）—— 能命中**中间段**，不是只判整串末尾；
- 命中即 `Fail(...)` → `exit 1`（`:99`），且发生在**任何目录创建 / 复制 / 移动之前**。

所以判据是：**给 `-Target` / `-Project` / `USERPROFILE` 一个含尾随空白的值，脚本必然在写任何东西之前以退出码 1 停下**。§6 用 before/after 对照对这一条做了真实执行的验证。

### 2.3 逐段判定与整串判定的实证

AFTER 实跑（`trailing-space-test.mjs` 家目录场景，`USERPROFILE` = 沙箱内 `h `）原始输出：

```text
[X] 路径参数 USERPROFILE（家目录） 含尾随空白（路径末尾；第 12 段 "h "）—— 已停止，未做任何改动。尾随空格是路径身份的一部分；若被静默裁掉，脚本会作用到**另一个**目录。
```

一条消息里同时给出**两个命中点**：「路径末尾」（整串判定，`:91`）与「第 12 段 "h "」（逐段判定，`:95`）—— 逐段判定确实在生效，不是摆设。

### 2.4 三条入口与默认值的覆盖

- **家目录**：`install.ps1:211` / `uninstall.ps1:114`，判的是 `$env:USERPROFILE` 本身，不是判拼接后的结果。
- **默认值也过判定**：`install.ps1:211` 先判 `$env:USERPROFILE`，`:212-214` 才用家目录拼出默认 `$Target`，`:216` 再判 `$Target`。因此「不传 `-Target`」这条路径上，尾随空白同样被拦住 —— 不会出现「显式传参拦得住、默认值拦不住」。`uninstall.ps1:114` → `:116-118` → `:119` 同构。
- **`-Project`**：`install.ps1:219`，在任何播种写入之前；它自己的规范化点在 `:364`，在守卫之后。
---

## 3. A —— F6：恒真自比较已消除，新的检查有没有牙齿

### 3.1 旧恒真自比较已消失

上一轮 `uninstall.ps1:105-108` 的 `$expected = Join-Path $TargetRoot $Script:PluginName` 再与 `$PluginDir` 比较是**同源恒真**（两边由同样两个量拼出，恒相等）。本轮实测：`uninstall.ps1` 全文**已无** `$expected = Join-Path $TargetRoot`，也无 `$expectedData = Join-Path $dataParent`（`check-readme-consistency.mjs` 的两条对应断言也通过）。

换成四条判据：

| 判据 | 位置 | 依赖什么 |
|---|---|---|
| 末段必须是 `super-agent-router` | `:143-144` | 路径末段 |
| 父目录必须等于安装根 | `:146-147` | 路径父段 |
| 目标必须是安装根的真子路径（无 `..`、前缀匹配） | `:149-150` | 前缀 |
| **目标必须真的是本插件目录** —— 读 `.minimax-plugin\plugin.json` 核对 `name` | `:154-160` | **目标目录的内容** |

### 3.2 新检查的「会红」判据（实测）

**判据（内容级，可复现）**：目标目录里读不到 `.minimax-plugin\plugin.json`，或读到的 `name` ≠ `super-agent-router` ⇒ 卸载脚本必须**以非零退出**，且**一个字节都不删**。

实测（`docs/audit/.tmp-v055/v063-f6-probe.log`，745 B；脚本 `v063-f6-probe.ps1`）：

```text
F6-1 INSTALL_EXIT=0
F6-1 UNINSTALL_EXIT=0
F6-1 PLUGIN_GONE=True          <- 金丝雀：name 正确时正常删除（证明不是「一律报错」）
F6-2 UNINSTALL_EXIT=1
F6-2 DIR_STILL_THERE=True
F6-2 MARKER_STILL_THERE=True
F6-3 UNINSTALL_EXIT=1
F6-3 DIR_STILL_THERE=True
F6-3 MARKER_STILL_THERE=True
```

F6-2（`plugin.json` 的 `name` 写成 `other-plugin`）与 F6-3（根本没有 `plugin.json`）的报错原文：

```text
[X] 删前核对未通过：...\f6-sandbox\wrong\super-agent-router 不是本插件目录（读不到 .minimax-plugin\plugin.json，或 name 不是 super-agent-router），已停止。
[X] 删前核对未通过：...\f6-sandbox\nomanifest\super-agent-router 不是本插件目录（读不到 .minimax-plugin\plugin.json，或 name 不是 super-agent-router），已停止。
```

⇒ **内容级核对确实有牙齿**：目标不是本插件目录 ⇒ 拒绝删除，且金丝雀（name 正确）仍然删得掉。

### 3.3 残余：leaf / parent 两条仍是派生式恒真（V3）

`uninstall.ps1:141-142` 的

```powershell
$leaf = Split-Path -Leaf $PluginDir
$parentOfTarget = Split-Path -Parent $PluginDir
```

再与 `$Script:PluginName` / `$TargetRoot` 比较 —— 而 `$PluginDir = Join-Path $TargetRoot $Script:PluginName`（`:121`）。**两边同源**，所以：

- 末段检查（`:143`）**结构上永远为真**，无法触发；
- 父目录检查（`:146`）只有一种例外会不等：`$TargetRoot` 带尾随分隔符（见 V2）—— 而那不是保护，是误报。

机制直证（同一份日志）：

```text
MECH3 LEAF_TAUTOLOGY=True
MECH4 OLD_CHECK_IS_TAUTOLOGY=True
```

以及 BEFORE 突变体的实证：误解析到 `p\super-agent-router` 时，这两条检查**全部放行**，删除照常发生（真正挡住它的是 F1 守卫，不是这两条）。

**结论**：F6 的修复实质上是「删掉一条恒真 + 新增一条真正独立的内容级核对」；中间换上的 leaf/parent 两条仍是派生式恒真，不提供额外保护。这不削弱 F1 修复的有效性（守卫是第一道闸），但「防御纵深」目前只有 manifest 那一层是真的。

---

## 4. B —— F2 / F3：文档口径 vs 实际文件树

### 4.1 F2：模板到底几个

README 现在的口径（`README.md:136-137`）：

> `-Project` 播种的是**空名录**（`roster.json` 的 `members` 是空数组，默认 0 个成员）加上**四个**模板文件：
> `methods/_TEMPLATE.md`、`lessons/_TEMPLATE.md`、`incidents/_TEMPLATE.md`、`agent-snapshots/_README.md`

实际 `.superagent/`（仓库根）实读：

| 模板 | 实际存在 |
|---|---|
| `methods/_TEMPLATE.md` | 是（886 B） |
| `lessons/_TEMPLATE.md` | 是（635 B） |
| `incidents/_TEMPLATE.md` | 是（236 B） |
| `agent-snapshots/_README.md` | 是（195 B） |

**4/4 一致 ⇒ F2 已修到位。** 脚本侧对应 `install.ps1` 的 `$templates = @(...)` 四项；`verify-seed.mjs` 与 `sandbox-test.ps1` 场景 6 实跑都播种出这 4 个模板并逐字节比对通过。

### 4.2 F3：手工复制的清理清单到底该列哪些

README 的清理表（`README.md:171-177`）列了 7 项；实际 `.superagent/` 顶层**恰好也是 7 项**：

| README 清单 | 实际文件树 |
|---|---|
| `roster.json` | `roster.json`（5,789 B）✓ |
| `STATUS.md` | `STATUS.md`（34,139 B）✓ |
| `changes.log` | `changes.log`（4,774 B）✓ |
| `methods/` 只留 `_TEMPLATE.md` | `methods/`（5 个成员方法论 + `_TEMPLATE.md`）✓ |
| `lessons/` 只留 `_TEMPLATE.md` | `lessons/`（`_router.md` 21,084 B + 2 个成员 + `_TEMPLATE.md`）✓ |
| `incidents/` 只留 `_TEMPLATE.md` | `incidents/`（只有 `_TEMPLATE.md`）✓ |
| `agent-snapshots/` 只留 `_README.md` | `agent-snapshots/`（只有 `_README.md`）✓ |

**清单 7 项 vs 实际 7 项，一一对应，无遗漏、无多余 ⇒ F3 已修到位。** 特别地，上一轮漏掉的 `roster.json`（8 名成员 + owns/accepts/reject + `tier_granted_by`）、`STATUS.md`、`changes.log` 三项现在都在表里。

---

## 5. C —— 自测实跑（逐套件条数）

命令（**仓库根**）：

```powershell
powershell -ExecutionPolicy Bypass -File tools/install-selftest/run-all.ps1
```

沙箱约束：`TEMP`/`TMP` = `docs/audit/.tmp-v055/selftest-tmp`（全在授权目录内）；套件自身再把 `$env:USERPROFILE` 重定向到沙箱内的假家目录 ⇒ 真实安装目录与真实运行时台账不被触碰。

原始输出（`v063-selftest-after.log`，11,753 B）关键片段：

```text
RUNALL_EXIT=0
[平台] Windows + PowerShell 5.1.26100.9711（本套件仅 Windows）
[目录] C:\Users\yang2\Documents\MiniMax\mini code的插件\tools\install-selftest

==== sandbox-test.ps1  (安装/卸载 沙箱实跑) ====
[沙箱] C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v055\selftest-tmp\sar-selftest-20261111-104229
[源码] C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin
[版本] 源=0.5.7  模拟旧版=0.5.6
...
==== 沙箱实跑：PASS 41 / FAIL 0 ====

==== sandbox-test2.ps1  (跨插件保护与不误伤) ====
...
==== 跨插件保护与不误伤：PASS 13 / FAIL 0 ====

==== trailing-space-test.mjs  (尾随空格路径身份（F1 钉子）) ====
...
==== 尾随空格路径身份（AFTER(修复后)）：PASS 20 / FAIL 0 ====

==== verify-seed.mjs  (播种与安装副本（node 侧）) ====
...
==== 播种与安装副本（node 侧）：PASS 21 / FAIL 0 ====

==== check-readme-consistency.mjs  (文档与实现逐字对账) ====
...
==== 文档与实现对账：PASS 54 / FAIL 0 ====

==== 汇总 ====
  PASS  sandbox-test.ps1  exit=0
  PASS  sandbox-test2.ps1  exit=0
  PASS  trailing-space-test.mjs  exit=0
  PASS  verify-seed.mjs  exit=0
  PASS  check-readme-consistency.mjs  exit=0

==== 自测：5 / 5 个套件全部通过 ====
```

**逐套件条数**（不是只看总数）：

| 套件 | PASS | FAIL |
|---|---|---|
| `sandbox-test.ps1` | 41 | 0 |
| `sandbox-test2.ps1` | 13 | 0 |
| `trailing-space-test.mjs` | 20 | 0 |
| `verify-seed.mjs` | 21 | 0 |
| `check-readme-consistency.mjs` | 54 | 0 |
| **合计** | **149** | **0** |

全日志中 `FAIL ` 行数 = 0（`grep '^FAIL '` 无命中）。
---

## 6. D —— before / after 对照（本单核心）

### 6.1 突变体怎么造的

- **位置**：`docs/audit/.tmp-v055/mutant/`（满足「副本所在目录要有 `plugin/` 兄弟目录」的要求 —— 脚本按 `$PSScriptRoot\plugin` 定位源目录）。
- **该目录内容**：`before-install.ps1` / `before-uninstall.ps1` + `plugin/`（28 个文件，与仓库源包一致）+ `.superagent/`（仓库状态层副本，保证 `-Project` 播种路径与真脚本同构）。
- **改法**：**只动 `Assert-NoTrailingWhitespace` 的调用行**（函数定义保留），按 `^\s*Assert-NoTrailingWhitespace\b` 逐行定位，整行替换为等价空操作 `$script:__mutantNoOp = $true`。**没有手改任何别的逻辑。**
- 构建脚本：`docs/audit/.tmp-v055/v063-build-mutant.cjs`（纯读仓库 + 只写 mutant 目录）。

逐行 diff（构建脚本原始输出）：

```text
install.ps1
  :211  Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'
     ->  $script:__mutantNoOp = $true
  :216  Assert-NoTrailingWhitespace $Target '-Target'
     ->  $script:__mutantNoOp = $true
  :219      Assert-NoTrailingWhitespace $Project '-Project'
     ->      $script:__mutantNoOp = $true
  callSitesReplaced=3   hadBom=true   eol="\n"

uninstall.ps1
  :114  Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'
     ->  $script:__mutantNoOp = $true
  :119  Assert-NoTrailingWhitespace $Target '-Target'
     ->  $script:__mutantNoOp = $true
  callSitesReplaced=2   hadBom=true   eol="\n"
```

### 6.2 突变体语法自检（硬要求 a）

```text
PARSEFILE before-install.ps1 errors=0 hasBom=True bytes=21546
PARSEFILE before-uninstall.ps1 errors=0 hasBom=True bytes=10851
PARSEFILE install.ps1 errors=0 hasBom=True bytes=21627
PARSEFILE uninstall.ps1 errors=0 hasBom=True bytes=10913
```

自检写法（与要求一致）：`[System.Management.Automation.Language.Parser]::ParseFile(<path>, [ref]$null, [ref]$e)`，取 `$e.Count`。
⇒ 突变体**语法合法**，且与原件同为 UTF-8 BOM + LF。

### 6.3 突变体目录能解析到插件包（硬要求 b）

```text
MUTANT_PLUGINJSON_EXISTS=True
MUTANT_PLUGIN_FILECOUNT=28
MUTANT_STATE_EXISTS=True
```

### 6.4 配对运行

同一 TEMP、同一 cwd（仓库根）、**同一份** `trailing-space-test.mjs`，只换 `SAR_PREFIX_INSTALL` / `SAR_PREFIX_UNINSTALL`：

```text
BEFORE_EXIT=1
AFTER_EXIT=0
```

### 6.5 BEFORE / AFTER 的 PASS·FAIL 集合

**BEFORE（`PASS 12 / FAIL 8`）—— 绿的 12 条：**

```text
PASS  金丝雀：普通目录安装 exit 0
PASS  金丝雀：普通目录装出了插件目录
PASS  金丝雀：普通目录卸载 exit 0
PASS  金丝雀：普通目录插件目录已删
PASS  两个根确实并存（同名，名字长度差 1）
PASS  参数确实带着尾随空格（长度比无空格版多 1）
PASS  带尾随空格的 -Target：用户【指定】的目录仍在
PASS  带尾随空格的 -Target：用户【指定】的目录内容一字未动
PASS  install 带尾随空格的 -Target：带空格的那个目录未被创建
PASS  install 带尾随空格的 -Project：带空格的项目目录未被播种
PASS  家目录带尾随空格：非零退出
PASS  家目录带尾随空格：未在无空格家目录下建插件目录
```

**红 8 条：**

```text
FAIL  带尾随空格的 -Target：非零退出
FAIL  带尾随空格的 -Target：用户【没指定】的目录仍在
FAIL  带尾随空格的 -Target：用户【没指定】的目录内容一字未动
FAIL  install 带尾随空格的 -Target：非零退出
FAIL  install 带尾随空格的 -Target：无空格的那个目录未被创建
FAIL  install 带尾随空格的 -Project：非零退出
FAIL  install 带尾随空格的 -Project：无空格的项目目录未被播种
FAIL  install 带尾随空格的 -Project：目标插件目录未被创建
```

**AFTER（`PASS 20 / FAIL 0`）**：上述 8 条全部转绿，另外 12 条本来就绿 ⇒ 差分 = **恰好这 8 条**。

- **不多红**：8 条红全部落在 F1 语义内（`-Target` 卸载 3 条 + `-Target` 安装 2 条 + `-Project` 3 条），没有任何一条与 F1 无关的断言被误伤。
- **金丝雀仍绿**：BEFORE 里 4 条金丝雀全绿 ⇒ 突变体本身没把脚本搞坏，「一律报错」不成立。
- **夹具断言仍绿**：「两个根确实并存」「参数确实带着尾随空格」在 BEFORE 也绿 ⇒ 证明 red 不是因为夹具没造出来。

### 6.6 少红的一条：家目录分支（V1）

我事先推演 BEFORE 应红 **9** 条（含家目录的「非零退出」），实测只红 **8** 条。查清了原因，**没有按「预期」粉饰**：

BEFORE 家目录场景的原始输出（`v063-ts-before.log`）：

```text
  [i] 安装目标 : ...\sar-selftest-ts-20261111024354\h \\ .minimax\plugins\super-agent-router
  [i] 已创建安装根目录：...\sar-selftest-ts-20261111024354\h \\ .minimax\plugins
  [OK] 自校验通过：28 个文件，SHA256 全部一致
Remove-Item : An object at the specified path ...\sar-selftest-ts-20261111024354\h  does not exist.
At ...\mutant\before-install.ps1:344 char:13
+             Remove-Item -LiteralPath $stagingDir -Recurse -Force -Err ...
    + CategoryInfo          : InvalidArgument: (:) [Remove-Item],PSArgumentException
```

即：BEFORE 之所以「非零退出」，是因为 `Move-Item` 搬不动带尾随空格的路径而失败（`install.ps1` 的 catch 分支），**与守卫无关**。AFTER 则是守卫直接拦下：

```text
[X] 路径参数 USERPROFILE（家目录） 含尾随空白（路径末尾；第 12 段 "h "）—— 已停止，未做任何改动。
```

**行为层面的差异是实的**：BEFORE 已经创建了安装根并写了 28 个暂存文件（**部分写入**），AFTER 一个字节都没写。所以「家目录守卫有牙齿」由**行为差异 + 代码行序**（`:211` / `:114` 早于一切 `GetFullPath` 与写入）证明，**不是**由那条断言证明。

**但那条断言本身不具区分度**（只看「非零退出」，两侧都满足）⇒ 记为 **V1（中）**。建议把该断言改成「必须命中守卫的报错文本（`含尾随空白`）」，否则将来有人删掉家目录守卫，这条断言**仍然绿**，回归会漏过去。
---

## 7. 发现清单（按严重度）

### V1（中）家目录那条断言不具区分度

- **触发条件**：有人删掉 `install.ps1:211` / `uninstall.ps1:114` 的家目录守卫调用。
- **影响**：自测套件**不会变红** ⇒ 家目录这条防线可以悄悄消失而无人察觉。
- **证据**：§6.6 —— BEFORE 家目录场景已非零退出（`Move-Item` 失败所致），与守卫无关。
- **建议修法**：把 `trailing-space-test.mjs` 的家目录断言从「非零退出」改成「输出必须包含 `含尾随空白`」；再加一条「BEFORE 语义下不应产生任何写入」（断言家目录沙箱里没有新建目录）。

### V2（低）`-Target` 带尾随反斜杠时卸载误报失败

- **触发条件**：`uninstall.ps1 -Target "C:\some\path\"`（尾随反斜杠）。
- **影响**：卸载以退出码 1 停下并报「目标的父目录 ... 不是安装根 ...」，插件删不掉；而**安装**用同一个字符串是成功的（`F6-4 INSTALL_EXIT=0`）⇒ 用户能装、不能用同一条命令卸。方向是 fail-closed（不会误删），但属于修复**新引入**的行为 —— 旧代码是恒真比较，不会误报。
- **证据**：`v063-f6-probe.log` 的 `F6-4 UNINSTALL_EXIT_TRAILING_BS=1` / `F6-4 PLUGIN_STILL_THERE=True`；报错原文「目标的父目录 `...\bs` 不是安装根 `...\bs\`」；机制直证 `MECH1 TRAILING_BS TargetRoot=[C:\x\bs\] parent_eq=False old_check_eq=False`（新检查会误报，旧检查不会）。
- **建议修法**：比较前把两侧尾随分隔符归一（例如 `TrimEnd(\ , /)` 后再比），或改用 `[System.IO.Path]::GetDirectoryName` 之外的不依赖分隔符的比较。

### V3（低）leaf / parent 两条检查仍是派生式恒真

- **定位**：`uninstall.ps1:141-147`。
- **影响**：**不提供**任何针对「解析到了别的目录」的保护 —— 因为 `$PluginDir`（`:121`）就是用同样两个量拼出来的。真正有牙齿的只有内容级 manifest 核对（`:154-160`）。
- **证据**：`MECH3 LEAF_TAUTOLOGY=True`；BEFORE 突变体误解析到 `p\super-agent-router` 时这两条全部放行、删除照常发生。
- **附带**：`check-readme-consistency.mjs` 的 F6 钉子只断言「`$expected = Join-Path $TargetRoot` 这串字样消失了」，**不检查新检查是否独立** ⇒ 同类恒真可以再回来。
- **建议修法**：要么删掉这两条（留 manifest 一条），要么把期望值改成**不依赖 `$PluginDir` 的量**（例如直接比对用户原始 `-Target` 字符串）。

### V4（低）自测套件头部的断言条数与实际不符

- **证据**：`run-all.ps1:14-17` 写 43 / 13 / 18 / 22；`sandbox-test.ps1:4` 写 43；`verify-seed.mjs:1` 写 22。实测 41 / 13 / 20 / 21。
- **影响**：与上一轮 F2 同一类（文档数字与实现不符），只是这次出在自测套件自己身上；且 `check-readme-consistency.mjs` 不覆盖 `run-all.ps1` 的头部 ⇒ 不会被自己抓到。
- **建议修法**：把这几处数字改对，并在 `check-readme-consistency.mjs` 里加一条「头部声明条数 == 实跑条数」的自检（解析各套件的 summary 行即可）。

### 已确认修好的（不计为发现）

- **F1**：拦截点位置正确、三条入口覆盖、before/after 拿得到 8 条精确转红、金丝雀仍绿。
- **F6**：恒真自比较已删；manifest 内容级核对有牙齿（实测会红，且金丝雀仍绿）。
- **F2**：模板 4/4 与实际一致。
- **F3**：清理清单 7/7 与实际一致。

---

## 8. 诚实边界

1. **没有在真实安装目录 `~/.minimax/plugins` 上实跑过安装/卸载**（只读约束）。只做了只读复核（28 文件、mtime 未变、目录下只有 `super-agent-router`）。因此「真实安装根下首次安装（根目录不存在 → 需新建）」这一形态**本单未验**。
2. **尾随空格目录只在 NTFS 本机通过 `\\?\` 扩展路径造出**。FAT32 / exFAT / 网络盘 / ReFS 上能否造出同名带尾随空格的目录，本单未验；Windows 常规 API（`New-Item` / `Directory.CreateDirectory`）确实造不出来，这正是必须用扩展路径的原因。
3. **家目录分支的断言不具区分度**（V1）。该分支守卫的有效性靠行为差异 + 代码行序证明，不是靠断言。
4. **突变体只摘掉了 5 处 F1 守卫调用**，F6 的 manifest 检查在 BEFORE 里仍在 —— 这正是 F6 能被独立证明的原因，但也意味着 BEFORE 并非「修复前的原版脚本」，而是「只摘掉 F1 守卫的脚本」。本对照因此**只检验 F1 的贡献**，不检验 F6 的贡献。
5. **`-PurgeData` 分支本单未验**：它操作真实的 `~/.minimax/v2/plugin-data/...` 路径（`uninstall.ps1:185-194` 的台账分段核对），在只读约束下不能实跑；该分支的代码结构与 F6 同型，但**未取得实测证据**。
6. **README 的 clone 地址仍 404**（本轮 10:50 复验）⇒ 公开可用性不成立 —— 属父会话动作。
7. **未对 F6 做突变对照**：F6 的结论来自「构造异常目标 → 看它是否拒绝删除」的定向实跑（§3.2），不是 from-before 对照。
8. 本报告结论只覆盖 **v0.5.7 当前这三份文件**（指纹见 §1）。若修复方在此之后又改了 `install.ps1` / `uninstall.ps1` / `README.md`，本报告的逐行结论需按新指纹重跑。

---

## 9. 我自己的探针 / 夹具错误（自曝）

- **(a) 探针函数名撞上 PowerShell 内置别名**：F6 探针里我把收集函数命名为 `H` —— 而 `H` 是 `Get-History` 的内置别名，**别名优先级高于函数**，所有 `H()` 调用都被劫持（日志文件写空，报错文本里带着我本想记录的值）。第一遍的结论不可作为正式证据；改名 `Add-Line` 后重跑取得干净日志 —— §3.2 的数字**全部**来自重跑后的 `v063-f6-probe.log`。
- **(b) 突变体 diff 的第 1 行是假阳性**：BOM 在写回时保留（`hadBom=true`），但 diff 比较时原文件首行带 BOM 字符、突变体数组首行不带 → 显示成「改动」。字节层面两者 BOM 都在（§6.2 的 `hasBom=True` 佐证）。
- **(c) 我事先推演的 BEFORE 应红 9 条，实测只红 8 条**：我没有按「预期」粉饰，而是把差的那 1 条查到底 —— 结论是**断言不具区分度**（V1），不是产品行为。报告里如实写成「少红 1 条 + 原因」。
- **(d) 自写 base64 编码器的 bug（本轮开头就撞上）**：ASCII 分支误用 `c & 0x3F`、2/3 字节分支阈值与首字节算错（`b64('ABC')` 会得到 `AQID`）。本轮在写盘前加了**编码器自检**（`QUJD` / `5Lit5paH` 两个已知值），自检不过就中止 ⇒ 未污染报告。
- **(e) 自测日志抓取的一处细节**：`uninstall.ps1` 用 `Write-Host` 输出，而 `Write-Host` **不进入管道**，所以我探针里 `$u = & $uninstall ... | Out-String` 拿到的 `OUT:` 字段是空的。证据取自控制台原始输出与结构化字段（退出码 / 目录是否还在 / 标记是否还在），没有依赖那个空字段。

---

## 10. VERDICT

**PASS_WITH_CONDITIONS —— 可以公开。**

- ACCEPT 五项全部达成：**A1 PASS**、**A2 PASS**（附 V3）、**B PASS**、**C PASS**、**D PASS**（附 V1 口径说明）。
- 本单负责的 **F1 / F6 / F2 / F3 四项全部修到位**，无阻断性缺陷；before/after 对照用**真实执行**拿到 8 条精确转红、金丝雀仍绿、突变体语法合法（`ParseFile errors=0`）。
- 非阻断发现 4 条：**V1（中，建议公开前或紧随其后修）**、V2（低，建议修）、V3（低，建议排期）、V4（低，建议排期）。
- **发布门槛仍在父会话手上**：`qsxcv20/super-agent-router` 本轮复验仍 **404** —— 公开 / push 由父会话做；本单不改可见性、不 commit、不 push、不建 tag。
- 建议公开前至少把 **V1** 改掉（否则家目录防线可以悄悄消失而自测不报），**V2** 一并改（尾随反斜杠的合法路径现在装得上、卸不掉）。

---

*验收方：verifier / `mvs_26fc11cb8e99483697531140266df940` / 2026-11-11T10:41~10:52+08:00。所有原始输出见 §2-§6；所有结论均出自本方实跑，未采信 brief 的「修复声称」。*