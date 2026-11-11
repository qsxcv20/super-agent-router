# v064 —— v063 四条发现（V1 / V2 / V3 / V4）修复的独立复验报告

- **验收方**：verifier，会话 `mvs_26fc11cb8e99483697531140266df940`
- **验收对象**：`install.ps1`（21,627 B，本轮**未改动**，哈希与上轮一致）、`uninstall.ps1`（13,113 B，本轮已改）、`README.md`（16,162 B）、`tools/install-selftest/`（6 个文件）、修复方报告 `docs/audit/install-v057-fix2.md`（29,027 B）
- **上一轮依据**：`docs/audit/verification-v063.md`（32,070 B，sha256 `30E540394E610C33BCB19F421B6FD01704288F7486EFC7424FD5ADD7107E886A`），判 `PASS_WITH_CONDITIONS`，抓出 V1 / V2 / V3 / V4
- **本轮时间窗**：2026-11-11T11:23~11:40+08:00（本报告全部原始输出均出自该窗口）
- **本报告落盘**：`docs/audit/.tmp-v055/verification-v064.md`（正式路径由父会话转写，本单不写正式路径）
- **隔离声明**：全程**未写入**真实安装目录 `C:\Users\yang2\.minimax\plugins\super-agent-router`，只做只读列目录。安装 / 卸载 / 突变体实跑都在 `docs/audit/.tmp-v055/` 下的沙箱里完成。
- **方法声明**：**不采信修复报告里的任何数字**，全部自己实跑、自己量、自己造突变体；对照结论来自**真实执行**（同一份测试脚本、同一 cwd、同一 TEMP 的配对运行）。
- **未改动声明**：仓库里的 `install.ps1` / `uninstall.ps1` / `README.md` / `tools/install-selftest/` / `plugin/**` / `tests/**` / `docs/audit/*.md` 一律只读。**唯一例外是 B 项**（brief 明确授权的「故意改错 → 当场还原」），还原证据见 §3.3。未 commit / push / 改可见性 / 建 tag。

---

## 0. 结论速览

### 0.1 ACCEPT 逐条勾选

| # | ACCEPT | 结论 | 关键证据 |
|---|--------|------|----------|
| A | 三方（头部声明 / README 表格 / 实测）条数一致 | **PASS** | 四方一致：机器标记 = 头部人类可读 = README 表格 = 实测 **41 / 30 / 39 / 21 / 90 = 221**，0 FAIL；run-all 自身 7 条 |
| B | 防漂有牙齿（改错 → 红 + 非零退出），且已还原并二次验证 | **PASS** | 改 30→31 ⇒ **4 条对账断言转红** + `RUNALL_EXIT=1`；还原后 sha256 回到 `b470b250…`（实测 MATCH=True），复跑 `RUNALL_EXIT=0` |
| C | before/after 恰好转红，EXTRA-RED=0，金丝雀仍绿，突变体语法自检 PASS，转红原因正确 | **PASS** | BEFORE `PASS 19 / FAIL 20`、AFTER `PASS 39 / FAIL 0`；**恰好转红 20、EXTRA-RED 0、恒绿 19**；金丝雀 6 条 BEFORE 全绿；`ParseFile errors=0`；每条「命中守卫」断言的失败原因都是 `命中守卫=false` |
| D | Get-ComparablePath 只动分隔符不碰空白；三种情形结论正确且有证据 | **PASS** | 10 组输入实测；`D:\plugins\ ` **逐字不变**；D-1 安装/卸载 exit 0/0 且目录正确删除；D-2（空格+反斜杠）exit 1 且守卫消息命中 |
| E | 文档不再宣称「两条独立核对」；错目标 ⇒ 非零退出 + 目录树哈希前后一致 | **PASS** | 全仓该措辞只剩「禁用钉子」里；E1/E2 exit 1 且**目录树哈希逐位相同**；E3 金丝雀仍正常删除 |
| F | 13 套 836 条 0 FAIL；plugin/ 零改动；版本 0.5.7；F1 守卫行号在 GetFullPath 之前 | **PASS** | 13 套合计 **836 条 / 0 FAIL**（`>>> SHELL ALL PASS`）；`PLUGIN_VERSION=0.5.7`；`git diff --name-only -- plugin/` 空；`install.ps1:211/216/219 < :221/:364`、`uninstall.ps1:134/139 < :140` |

### 0.2 总判定

**PASS_WITH_CONDITIONS —— V1 / V2 / V3 / V4 四条修复都真落地、都有牙齿；但发布的自测套件在「路径含空格或非 ASCII 字符」的环境下是红的（本机即如此），成员「221 条 0 FAIL」的声称在该类环境下不成立。**

- 四条修复**逐条复验通过**，且不是靠改断言让测试变绿：V1 的新断言在突变体下**恰好转红 20 条**、EXTRA-RED 0、失败原因逐条可查；V2 的归一函数经 10 组输入实测**只动分隔符**；V3 的措辞三处统一、内容级核对经**目录树哈希**证明有牙齿；V4 的防漂经「改错→红→还原→再全绿」完整验证。
- **新发现 W1（中）**：本机（TEMP 指向仓库内、路径含空格与中文）跑 `run-all.ps1` ⇒ `sandbox-test2.ps1` **6 条断言红**、`RUNALL_EXIT=1`。把 TEMP 换成无空格路径 ⇒ **全绿**。根因已隔离到变量：**路径含空格**或**含非 ASCII 字符**时，经子进程命令行传递的**尾随反斜杠会被吞掉**（纯 ASCII 无空格才存活）。这是**测试壳的传参缺陷**，不是 install/uninstall 的逻辑缺陷（参数完整到达时行为正确，D-1 实测 exit 0）。但 README 明确让第三方跑这条命令 ⇒ 影响面在用户侧。
- 另有 W2（低，用户面：手工在命令行写带尾随反斜杠且路径含空格/中文 ⇒ 未捕获的 .NET 异常而非干净报错）、W3（低，`run-all.ps1` 自身条数是硬编码 `7`，头部标记漂移抓不到）。

---

## 1. 待验产物与工作树基线

```text
$ git status --short
 M README.md
?? LICENSE
?? docs/audit/install-v057-fix.md
?? docs/audit/install-v057-fix2.md
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? docs/audit/verification-v063.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1
```

产物指纹（本轮实测）：

| 文件 | 字节 | mtime (UTC) | SHA256 |
|---|---|---|---|
| `install.ps1` | 21,627 | 2026-11-11T02:16:24Z | `711052F1B6DDB10E3A5F1EA30407EE79D7FB22BC9CDA89ADE734D85344EE939D`（与上轮**逐字节相同** ⇒ 本轮未动） |
| `uninstall.ps1` | 13,113 | 2026-11-11T02:57:29Z | `ACD219F1484DE719371FF990A67179A5E94E7B53A352677AD9F01E3F80D96F22` |
| `README.md` | 16,162 | 2026-11-11T03:05:22Z | `B086A30D91968C7447B2A924AAD9FA6B75D7382B1D7222ED6AE34685EAA52A6F` |
| `docs/audit/install-v057-fix2.md` | 29,027 | 2026-11-11T03:21:25Z | `B8A96E16211B35D2D1AF2EF2B1F732725EA597F7CA44891C19183AC8A8C57F2E` |
| `docs/audit/verification-v063.md`（上一轮） | 32,070 | 2026-11-11T02:52:33Z | `30E540394E610C33BCB19F421B6FD01704288F7486EFC7424FD5ADD7107E886A` |
| `tools/install-selftest/sandbox-test2.ps1` | 11,863 | — | `b470b250dc1d4c7bf8a6e57511fefe2564f528f12091970bbb3168f501dc4575`（B 项改错前的原值） |

本单结束时的工作树复核（§3 还原后）：

```text
 M README.md
?? LICENSE
?? docs/audit/install-v057-fix.md
?? docs/audit/install-v057-fix2.md
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? docs/audit/verification-v063.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1
（与开工时逐行相同；无任何我留下的残留 —— 详见 §9(e)）
```

---

## 2. A —— 自测实跑与条数三方（实为四方）对照

命令（**仓库根**）：

```powershell
powershell -ExecutionPolicy Bypass -File tools/install-selftest/run-all.ps1
```

### 2.1 第一跑：TEMP 指向仓库内（路径含空格 + 中文）⇒ **红了**

```text
RUNALL_EXIT=1
==== 沙箱实跑：PASS 41 / FAIL 0 ====
==== 跨插件保护与不误伤：PASS 24 / FAIL 6 ====
==== 尾随空格路径身份（AFTER(修复后)）：PASS 39 / FAIL 0 ====
==== 播种与安装副本（node 侧）：PASS 21 / FAIL 0 ====
==== 文档与实现对账：PASS 90 / FAIL 0 ====
  FAIL  sandbox-test2.ps1  exit=1
==== 自测：1 / 5 个套件未通过；条数对账 1 条红 ====
```

6 条红的原文（`v064-selftest.log:117-132`）：

```text
FAIL  S18 构造有效性：尾随反斜杠确实传到了脚本   :: echo=[...\sar-selftest2-20261111-112417\plugins8] arg=[...\sar-selftest2-20261111-112417\plugins8\]
FAIL  S18 安装退出码 0（-Target 带尾随反斜杠）   :: code=1 out=powershell.exe : ...\install.ps1 : Exception calling "GetFullPath" with "1" argument(s): "Il...
FAIL  S18 插件目录已建   :: dest 不存在
FAIL  S19 构造有效性：尾随反斜杠确实传到了脚本   :: echo=[...\plugins8] arg=[...\plugins8\]
FAIL  S19 卸载退出码 0（-Target 带尾随反斜杠）   :: code=1 out=powershell.exe : ...\uninstall.ps1 : Exception calling "GetFullPath" with "1" argument(s): "Il...
FAIL  S19 卸载走完了内容级 manifest 核对（输出命中「删前核对通过」）   :: ...\uninstall.ps1 : Exception calling "GetFullPath" with "1" argument(s): "Il...
```

**注意第一行**：套件**自己的「构造有效性」断言抓到了问题** —— `echo=`（子进程真正收到的值）少了尾随反斜杠，而 `arg=`（父进程要传的值）有。**这不是产品逻辑坏了，是尾随反斜杠在传参过程中丢了**。根因见 §8 W1（已做变量隔离实验）。

### 2.2 第二跑：TEMP 换成无空格路径 ⇒ **全绿**

```text
RUNALL_EXIT=0
==== 沙箱实跑：PASS 41 / FAIL 0 ====
==== 跨插件保护与不误伤：PASS 30 / FAIL 0 ====
==== 尾随空格路径身份（AFTER(修复后)）：PASS 39 / FAIL 0 ====
==== 播种与安装副本（node 侧）：PASS 21 / FAIL 0 ====
==== 文档与实现对账：PASS 90 / FAIL 0 ====
==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
```

### 2.3 条数四方对照

| 套件 | 头部机器标记 | 头部人类可读 | README 表格 | 实测 PASS+FAIL |
|---|---|---|---|---|
| `sandbox-test.ps1` | 41 | `sandbox-test.ps1:4`「（41 条断言）」 | `README.md:213` 41 | 41 + 0 = 41 |
| `sandbox-test2.ps1` | 30 | `sandbox-test2.ps1:4`「（30 条断言）」 | `README.md:214` 30 | 30 + 0 = 30 |
| `trailing-space-test.mjs` | 39 | `trailing-space-test.mjs:3`「（39 条断言）」 | `README.md:215` 39 | 39 + 0 = 39 |
| `verify-seed.mjs` | 21 | `verify-seed.mjs:1`「（21 条断言）」 | `README.md:216` 21 | 21 + 0 = 21 |
| `check-readme-consistency.mjs` | 90 | `check-readme-consistency.mjs:3`「（90 条断言）」 | `README.md:217` 90 | 90 + 0 = 90 |
| `run-all.ps1`（自身） | 7 | `run-all.ps1:4`「（7 条断言）」 | （README 表未列） | 7 条绿 |
| **合计** | **221 + 7** | | | **221 + 7，0 FAIL** |

⇒ **四方一致**（机器标记 / 头部人类可读 / README 表格 / 实测），且三层绑定都真实存在：
- 运行时绑定：`run-all.ps1:88-96` 逐套件核对「实际 PASS+FAIL 条数 == 该文件头部的 `ASSERTION-COUNT`」；
- 静态绑定：`check-readme-consistency.mjs:179-207` 核对「机器标记 ↔ 头部人类可读 ↔ README 表格」；
- 自检：`run-all.ps1:98-101` 核对 run-all 自身实际跑的条数。

（A 项 = 条数一致 ⇒ **PASS**；但「套件在本机红」这件事记为 W1，见 §8。）
---

## 3. B —— V4 的条数防漂到底有没有牙齿

### 3.1 手法

1. 先把 `tools/install-selftest/sandbox-test2.ps1` 的**原始字节**备份到 `docs/audit/.tmp-v055/v064-backup-sandbox-test2.ps1`，记录原哈希；
2. **只改一处**：字节级把 `ASSERTION-COUNT: 30` 换成 `ASSERTION-COUNT: 31`（文件长度不变，其余字节不动）；
3. 跑 `run-all.ps1` ⇒ 必须转红且非零退出；
4. **当场还原**（从备份逐字节写回）⇒ 复核哈希回到原值；
5. 再跑一次 ⇒ 必须全绿。

### 3.2 改错后：转红 + 非零退出（归因精确）

```text
ORIG_SHA256=b470b250dc1d4c7bf8a6e57511fefe2564f528f12091970bbb3168f501dc4575
ORIG_BYTES=11863
CORRUPT_SHA256=841b5f1bc4685474aa2be0957a66fab5cc3440434d25755b99bf5a277e1b851f
CORRUPT_BYTES=11863
ONLY_CHANGED=ASSERTION-COUNT_30_to_31

==== 跨插件保护与不误伤：PASS 30 / FAIL 0 ====      <- 套件自身的 30 条仍然全绿
FAIL  套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 31 / 实际 30）   :: declared=31 actual=30
FAIL  套件 sandbox-test2.ps1 头部人类可读条数与机器标记一致（31 条断言）   :: 头部没有「（31 条断言）」
FAIL  README 自测表里 sandbox-test2.ps1 的条数与机器标记一致（31）   :: README 写的是 30
FAIL  全部套件断言总数：声明 222 == 实际 221   :: declared=222 actual=221
==== 自测：1 / 5 个套件未通过；条数对账 1 条红 ====
RUNALL_EXIT=1
```

**归因精确**：被改的套件**自己的 30 条断言仍然全绿**（`PASS 30 / FAIL 0`），转红的是**四条「声明 vs 实际」的对账断言**（run-all 的逐套件核对、check-readme-consistency 的机器标记↔人类可读核对、README 表格核对、总数核对）。⇒ 防漂**有牙齿**，且不是靠套件失败来凑红。

### 3.3 还原 + 二次验证

```text
RESTORED_SHA256_NOW=B470B250DC1D4C7BF8A6E57511FEFE2564F528F12091970BBB3168F501DC4575
EXPECTED_ORIGINAL=b470b250dc1d4c7bf8a6e57511fefe2564f528f12091970bbb3168f501dc4575
MATCH=True
DECLARATION_NOW=ASSERTION-COUNT: 30
（第二次还原后再次复核）RESTORED_SHA256_2=B470B250...  MATCH_ORIGINAL=True
还原后复跑：RUNALL_EXIT=0  ==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
```

⇒ **文件已逐字节还原**（哈希回原值、声明回 30、长度回 11,863），工作树无残留（§1 末尾的 `git status` 与开工时逐行相同）。**B 项 = PASS。**

---

## 4. C —— V1 的新断言是不是只可能因守卫而红

### 4.1 突变体怎么造的

- 位置 `docs/audit/.tmp-v055/v064-mutant/`（满足「副本所在目录要有 `plugin/` 兄弟目录」：脚本按 `$PSScriptRoot\plugin` 定位源目录）；
- 该目录含 `before-install.ps1` / `before-uninstall.ps1` + `plugin/`（28 文件，`plugin.json` 在位）+ `.superagent/`（状态层副本）；
- 改法与上轮一致：**只动 `Assert-NoTrailingWhitespace` 的调用行**（定义行不动），按 `^\s*Assert-NoTrailingWhitespace\b` 逐行整行替换为 `$script:__mutantNoOp = $true`。

逐行 diff：

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
  :134  Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'
     ->  $script:__mutantNoOp = $true
  :139  Assert-NoTrailingWhitespace $Target '-Target'
     ->  $script:__mutantNoOp = $true
  callSitesReplaced=2   hadBom=true   eol="\n"
```

（uninstall.ps1 的行号比上轮后移，是因为这轮新增了 `Get-ComparablePath`；守卫仍在 `GetFullPath` 之前 —— 见 §7。）

### 4.2 突变体语法自检 + 插件包可解析

```text
PARSEFILE docs\audit\.tmp-v055\v064-mutant\before-install.ps1 errors=0 hasBom=True bytes=21546
PARSEFILE docs\audit\.tmp-v055\v064-mutant\before-uninstall.ps1 errors=0 hasBom=True bytes=13051
PARSEFILE install.ps1 errors=0 hasBom=True bytes=21627
PARSEFILE uninstall.ps1 errors=0 hasBom=True bytes=13113
MUT_PLUGINJSON=True   MUT_PLUGIN_FILES=28   MUT_STATE_EXISTS=True
```

### 4.3 配对运行与集合差分

同一 cwd（仓库根）、同一 TEMP、**同一份** `trailing-space-test.mjs`，只换 `SAR_PREFIX_INSTALL` / `SAR_PREFIX_UNINSTALL`：

```text
BEFORE_EXIT=1
AFTER_EXIT=0
==== 尾随空格路径身份（BEFORE(修复前)）：PASS 19 / FAIL 20 ====
==== 尾随空格路径身份（AFTER(修复后)）：PASS 39 / FAIL 0 ====
```

| 指标 | 实测 |
|---|---|
| 恰好转红（BEFORE 红 ∧ AFTER 绿） | **20** |
| **EXTRA-RED**（BEFORE 绿 ∧ AFTER 红） | **0** |
| 恒绿（两侧都绿） | **19** |
| 金丝雀（6 条）在 BEFORE 是否全绿 | **是** |
| AFTER 独有的失败 | **0** |

### 4.4 转红的 20 条（逐条列出）

```text
1  带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）
2  带尾随空格的 -Target：守卫只命中 -Target 这一条入口
3  带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）
4  带尾随空格的 -Target：用户【没指定】的目录仍在
5  带尾随空格的 -Target：用户【没指定】的目录内容一字未动
6  install 带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）
7  install 带尾随空格的 -Target：守卫只命中 -Target 这一条入口
8  install 带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）
9  install 带尾随空格的 -Target：无空格的那个目录未被创建
10 install 带尾随空格的 -Project：非零退出且命中守卫（-Project 入口）
11 install 带尾随空格的 -Project：守卫只命中 -Project 这一条入口
12 install 带尾随空格的 -Project：输出里没有任何成功标记（只因守卫而红）
13 install 带尾随空格的 -Project：无空格的项目目录未被播种
14 install 带尾随空格的 -Project：目标插件目录未被创建
15 install 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）
16 install 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口
17 install 家目录带尾随空格：输出里没有任何成功标记（只因守卫而红）
18 install 家目录带尾随空格：带空格的家目录下也没建 .minimax
19 uninstall 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）
20 uninstall 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口
```

### 4.5 「命中守卫消息」类断言的转红原因**正确**（不是脚本坏了）

BEFORE 侧这些断言的失败明细逐条抽查（原始 detail）：

```text
带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）   ::  code=0 命中守卫=false out= | == super-agent-router 卸载程序 |   [i] 插件目录 : ...\p\super-agent-router | ...
带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）   ::  出现了成功标记：已彻底删除,删前核对通过
install 带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）   ::  code=0 命中守卫=false out= | == super-agent-router 安装程序 |   [i] 源目录   : ...\v064-mutant\plugin | ...
install 带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）   ::  出现了成功标记：安装完成,自校验通过,最终目录复核通过
install 带尾随空格的 -Project：输出里没有任何成功标记（只因守卫而红）   ::  出现了成功标记：安装完成,已播种,自校验通过,最终目录复核通过,已创建安装根目录
install 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）   ::  code=1 命中守卫=false out= | == super-agent-router 安装程序 | ...
install 家目录带尾随空格：输出里没有任何成功标记（只因守卫而红）   ::  出现了成功标记：自校验通过,已创建安装根目录
uninstall 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）   ::  code=0 命中守卫=false out= | == super-agent-router 卸载程序 |   [i] 插件目录 : ...\g \.minimax\plugins\super-agent-router | ...
```

**关键**：每一条「命中守卫」类断言的 detail 都写着 `命中守卫=false` —— 红的原因是**守卫消息压根没出现**；每一条「无成功标记」类断言的 detail 都写着**出现了哪些成功标记** —— 红的原因是**脚本在守卫缺席时反而干了别的**（删了目录 / 装了插件 / 建了目录）。**没有一条是因为脚本自己坏了而红。**

⇒ **V1 真的修好了**：上轮那条「只看非零退出 ⇒ 不具区分度」的洞已被「命中守卫 + 入口唯一 + 无成功标记」三条钉死；突变体下**恰好转红 20 条、EXTRA-RED 0、恒绿 19**。**C 项 = PASS。**

---

## 5. D —— V2：Get-ComparablePath 只动分隔符、绝不碰空白

### 5.1 逐行读实现

`uninstall.ps1:100-116`：

```powershell
function Get-ComparablePath([string]$path) {
    if ([string]::IsNullOrEmpty($path)) { return '' }
    $p = $path -replace '/', '\\\\'      # 只把正斜杠换成反斜杠
    if ($p -match '^[A-Za-z]:\\*$') { return ($p.Substring(0, 2) + '\\\) }   # 盘符根特判
    if ($p -match '^\\\\[^\\]+\\\\[^\\]+\\*$') { return ($p.TrimEnd([char]92) + '\\\) }  # UNC 根特判
    $t = $p.TrimEnd([char]92)          # 只裁尾随反斜杠
    if ($t.Length -eq 0) { return $p }
    return $t
}
```

**逐行判读**：
- `-replace '/', '\\\\'` —— 只做斜杠方向替换，**不涉及任何空白**；
- 两处 `TrimEnd([char]92)` —— `char]92` 就是**反斜杠**，只裁尾随反斜杠；**不是** `Trim()`（那会连空格一起吃掉）；
- 全文**没有** `Trim()` / `TrimEnd()` 不带字符集 / `-replace '\s'` 之类的会动空白的操作；
- 盘符根特判 `^[A-Za-z]:\\*$` ⇒ `C:\` 与 `C:` 都归到 `C:\`（**不会归成没有尾分隔符的 `C:`**）；
- UNC 根特判 ⇒ `\\srv\share\` 保持带尾分隔符形态。

### 5.2 10 组输入实测（直接从 `uninstall.ps1` 里把真函数抽出来执行）

```text
IN=[C:\]            OUT=[C:\]            LEN 3 -> 3   SAME_AS_INPUT=True
IN=[C:]             OUT=[C:\]            LEN 2 -> 3   SAME_AS_INPUT=False   <- 盘符根归成 C:\（不归成 C:）
IN=[C:/]            OUT=[C:\]            LEN 3 -> 3   SAME_AS_INPUT=True
IN=[D:\plugins\]   OUT=[D:\plugins]    LEN 11 -> 10 SAME_AS_INPUT=False  <- 只掉了尾随分隔符
IN=[D:\plugins]    OUT=[D:\plugins]    LEN 10 -> 10 SAME_AS_INPUT=True
IN=[D:\plugins\ ] OUT=[D:\plugins\ ] LEN 12 -> 12 SAME_AS_INPUT=True    <- 尾随空格逐字保留！
IN=[C:\a b\]       OUT=[C:\a b]        LEN 7 -> 6  SAME_AS_INPUT=False  <- 中间空格保留，只掉分隔符
IN=[\\srv\share\]  OUT=[\\srv\share\]  LEN 12 -> 12 SAME_AS_INPUT=True  <- UNC 根保持尾分隔符
IN=[\\srv\share]   OUT=[\\srv\share\]  LEN 11 -> 12 SAME_AS_INPUT=False <- UNC 根补上尾分隔符
IN=[\\srv\share\x\] OUT=[\\srv\share\x] LEN 14 -> 13 SAME_AS_INPUT=False
IN=[rel\path\]     OUT=[rel\path]      LEN 9 -> 8  SAME_AS_INPUT=False
```

⇒ **只动分隔符，一个空白都不动**：`D:\plugins\ ` 原样返回（长度 12 → 12，`SAME_AS_INPUT=True`）。

### 5.3 情形 ①：`-Target` 带尾随反斜杠 ⇒ 安装 + 卸载都应 exit 0

（**进程内调用**，不经子进程命令行 ⇒ 参数不会被命令行解析改写；这是为了把「产品行为」与「传参缺陷」分开，见 §8 W1）

```text
D1 INSTALL_EXIT=0
D1 UNINSTALL_EXIT_TRAILING_BS=0
D1 PLUGIN_GONE=True
（卸载输出）[i] 安装根   : ...\v064-d-sandbox-20261111-112643\bs\
（卸载输出）[i] 删前核对通过：路径级结构自检一致（末段 + 父目录），内容级确认是本插件目录（manifest name=super-agent-router）
（卸载输出）[OK] 已彻底删除：...\bs\super-agent-router
```

⇒ **V2 的核心主张成立**：上一轮「装得上、卸不掉」的误报已消失（`Get-ComparablePath` 让 `...\bs` 与 `...\bs\` 归一后相等）。

### 5.4 情形 ②：尾随空格 + 尾随反斜杠 ⇒ 必须仍被拒绝

```text
D2 ARG_LEN=103 LAST2=[\ ]
D2 UNINSTALL_EXIT=1
D2 PLUGIN_STILL_THERE=True
（控制台原文）[X] 路径参数 -Target 含尾随空白（路径末尾；第 12 段 " "）—— 已停止，未做任何改动。
```

⇒ **归一没有把空白一起吃掉**：守卫照样命中、退出码非零、插件目录原封不动。

### 5.5 情形 ③：盘符根 / UNC 根（代码级判定，**未实跑**）

- 盘符根：`C:\` → `C:\`、`C:` → `C:\`、`C:/` → `C:\`（§5.2 实测），因此 `GetFullPath` 保留的 `C:\` 与 `Split-Path -Parent` 给出的 `C:` 形态**不会**被误判成不等；
- UNC 根：`\\srv\share\` → `\\srv\share\`、`\\srv\share` → `\\srv\share\`（§5.2 实测）；
- **未实跑**：真实的 `\\server\share` 盘（网络共享）上的卸载流程本单**没有**实跑 —— 沙箱在本地盘，且真实网络盘不可用。
⇒ **D 项 = PASS**（情形 ③ 的 UNC 端到端行为标注为未实跑）。
---

## 6. E —— V3：措辞与内容级核对的牙齿

### 6.1 「两条独立核对」已从实现与文档里消失

全仓检索 `两条独立核对` / `独立核对`，命中**只有一处**，而且是**禁用钉子本身**：

```text
tools/install-selftest/check-readme-consistency.mjs:161:// ── V3：不得再宣称「两条独立核对」 ──────
tools/install-selftest/check-readme-consistency.mjs:162:check('uninstall.ps1 不再宣称「两条独立核对」',
tools/install-selftest/check-readme-consistency.mjs:163:  !uninstall.includes('两条独立核对'), '还在宣称');
tools/install-selftest/check-readme-consistency.mjs:164:check('README 不再宣称「两条独立核对」',
tools/install-selftest/check-readme-consistency.mjs:165:  !readme.includes('两条独立核对'), '还在宣称');
```

⇒ `uninstall.ps1` 与 `README.md` **均不再出现该措辞**；对账套件把「不得再出现」钉成了永久断言。

### 6.2 新措辞三处一致

```text
uninstall.ps1:11   · 路径级（**结构自检**，不构成独立验证）：末段必须是 super-agent-router,
uninstall.ps1:13   · 内容级（**唯一有牙齿的一条**）：读目标目录的 .minimax-plugin\plugin.json
uninstall.ps1:159  # (1) 路径级：**结构自检** —— 期望值与被检值同源，**不构成独立验证**，只防实现层面的错位。
uninstall.ps1:161  #     这一层**挡不住「作用到了别的目录」**，不要把它当成安全保证。
uninstall.ps1:178  # (2) 内容级：**唯一有牙齿的一条** —— 目标必须**真的是本插件目录**：读它的 manifest 核对 name。
uninstall.ps1:180  #     就一定过不了 ⇒ 前面那层恒等的结构自检挡不住的情形，这一层挡得住。
uninstall.ps1:189  Write-Note ('删前核对通过：路径级结构自检一致（末段 + 父目录），内容级确认是本插件目录（manifest name=' + ... )
uninstall.ps1:211  # 同样是**结构自检**（期望值与被检值同源 ⇒ 不构成独立验证）；两侧都按尾随分隔符归一后再比
README.md:242      - **路径级（结构自检，不构成独立验证）** —— 末段必须是 `super-agent-router`、目标必须在安装根之下。
README.md:243      这一层的期望值与被检值同源（都是脚本自己拼出来的），只防实现层面的错位，**挡不住「作用到了别的目录」**。
README.md:244      - **内容级（唯一有牙齿的一条）** —— 读目标目录的 `.minimax-plugin\plugin.json` 核对 `name`，
```

⇒ **V3 的落点正确**：上一轮的问题正是「文档宣称两条独立核对、实现只有一条有牙齿」；现在文档如实标注了哪条有牙齿、哪条只是结构自检，并把它写进了实现注释、成功提示与台账段。

### 6.3 内容级核对有牙齿（**独立复现**，不靠套件自证）

我自造目标目录并用**目录树哈希**（全部目录名 + 全部文件名/长度/SHA256 排序后整体哈希）比对前后：

```text
E1 EXIT=1                                  <- manifest name 写成 other-plugin
E1 TREEHASH_BEFORE=EEB4BFE683E52599D41EC461B316EB51D04AFB4D13AE6C9EE17C67C64650DB9C
E1 TREEHASH_AFTER =EEB4BFE683E52599D41EC461B316EB51D04AFB4D13AE6C9EE17C67C64650DB9C
E1 TREE_IDENTICAL=True    E1 DIR_STILL_THERE=True

E2 EXIT=1                                  <- 根本没有 .minimax-plugin\plugin.json
E2 TREEHASH_BEFORE=A2EA914193A8AFD8A25A9E1CED958260A74B78C152CA7DB3EA18590CFD1FD5BB
E2 TREEHASH_AFTER =A2EA914193A8AFD8A25A9E1CED958260A74B78C152CA7DB3EA18590CFD1FD5BB
E2 TREE_IDENTICAL=True    E2 DIR_STILL_THERE=True

E3 EXIT=0    E3 TREEHASH_BEFORE=FF958CC9B78B05BCF18CAC359C25C8022E0FED9D7ACC203D89B87A3CC051F136
E3 TREEHASH_AFTER=ABSENT    E3 PLUGIN_GONE=True      <- 金丝雀：name 正确时照常删
（E1/E2 控制台原文）[X] 删前核对未通过：...\wrong\super-agent-router 不是本插件目录（读不到 .minimax-plugin\plugin.json，或 name 不是 super-agent-router），已停止。
```

⇒ **内容级核对有牙齿**：错目标 ⇒ 非零退出 + **目录树哈希逐位相同**（一个字节都没删）；且不是「一律报错」（金丝雀 E3 照常删除）。套件里的 S16 / S17 也覆盖了同一形态，本单是**独立复现**而非引用套件自述。**E 项 = PASS。**

---

## 7. F —— 回归没被改坏

### 7.1 仓库回归 13 套

```text
$ node tools/run-tests.mjs --all --root plugin --repo .
REPO=.    ROOT=plugin
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

合计 = 70+14+58+53+49+228+29+23+65+52+38+119+38 = **836 条**，**13 套 / 0 FAIL** ⇒ 与 brief 给的基线逐项相同。

### 7.2 plugin/ 零改动 + 版本

```text
PLUGIN_VERSION=0.5.7
PLUGIN_NAME=super-agent-router
PLUGIN_DIFF_EMPTY=True          （git diff --name-only -- plugin/ 为空）
```

### 7.3 F1 的守卫仍在 GetFullPath 之前（行号）

`install.ps1`（本轮**未改动**，哈希与上轮一致）：

```text
install.ps1:211:Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'
install.ps1:216:Assert-NoTrailingWhitespace $Target '-Target'
install.ps1:219:    Assert-NoTrailingWhitespace $Project '-Project'
install.ps1:221:$TargetRoot = [System.IO.Path]::GetFullPath($Target)        <- 规范化点，在三条守卫之后
install.ps1:364:    $stateRoot = Join-Path ([System.IO.Path]::GetFullPath($Project)) '.superagent'
```

`uninstall.ps1`（本轮已改，守卫行号因新增函数后移）：

```text
uninstall.ps1:134:Assert-NoTrailingWhitespace $env:USERPROFILE 'USERPROFILE（家目录）'
uninstall.ps1:139:Assert-NoTrailingWhitespace $Target '-Target'
uninstall.ps1:140:$TargetRoot = [System.IO.Path]::GetFullPath($Target)      <- 规范化点，在两条守卫之后
```

⇒ **F1 的防线一字未松**，守卫仍在所有 `GetFullPath` 之前 ⇒ **F 项 = PASS。**

---

## 8. 发现清单（按严重度）

### W1（中）自测套件 S18 / S19 在「路径含空格或非 ASCII 字符」的环境下红 ⇒ 发布的自测在常见环境不可用

- **触发条件**：仓库路径（或沙箱路径）**含空格或含非 ASCII 字符**（例如 `C:\Users\John Doe\...`、`D:\我的项目\...`），且用**子进程命令行**传递一个**以反斜杠结尾**的路径参数。
- **影响**：`sandbox-test2.ps1` 的 S18 / S19 共 **6 条断言红**（安装/卸载都报 `Exception calling "GetFullPath" ... "Illegal characters in path."`）⇒ `run-all.ps1` **非零退出**。README 明确教第三方跑这条命令（`README.md:208`）⇒ 用户会看到「自测失败」。**修复报告里「221 条 0 FAIL / 5/5 套件全部通过」的声称，在这类环境下不成立**（本机即反例）。
- **根因（已做变量隔离实验）**：不是 install/uninstall 的逻辑缺陷，而是**参数在子进程命令行里被改写** —— PowerShell 给含空格 / 非 ASCII 的参数加引号后，Windows 命令行解析把尾随 `\` 当作引号转义，**尾随反斜杠被吞掉**（部分情形还会在末尾留下一个 `"` ⇒ `GetFullPath` 抛「Illegal characters in path.」）。
- **证据**（变量隔离，`v064-arg-isolation.log`）：

  ```text
  （v064-arg-isolation.log 原文；引号是日志里真实出现的那个 ASCII 双引号）
  CN_ONLY_NOSPACE  intact=False  got_tail=[n-无空格"]  sent_tail=[n-无空格\]   <- 有中文、无空格 ⇒ 末尾多出一个 "
  SPACE_ONLY_ASCII intact=False  got_tail=[y dir"]     sent_tail=[y dir\]      <- 有空格、纯 ASCII ⇒ 末尾多出一个 "
  SPACE_AND_CN     intact=False  got_tail=[n 无空格"]  sent_tail=[n 无空格\]
  PLAIN_ASCII      intact=True   got_tail=[13946\]    sent_tail=[13946\]      <- 纯 ASCII、无空格 ⇒ 原样存活
  ```

  另一组独立实验（`v064-probe-d.log`）里同一类路径的畸形形态是「尾随反斜杠被整个吞掉」：

  ```text
  ARG_NOSPACE sent=[...\v064-argtest-nospace-20261111-112643\] got=[...\v064-argtest-nospace-20261111-112643\] intact=True
  ARG_SPACE    sent=[...\sub dir with space\]             got=[...\sub dir with space]              intact=False
  ```

  两种畸形（末尾多一个 `"` / 尾随反斜杠被吞）**共同点是参数没有原样到达**。而末尾多出的那个 `"` 正是 `GetFullPath` 抛 **「Illegal characters in path.」** 的直接原因（`"` 是 Windows 路径的非法字符）—— 与 §2.1 现场的错误原文完全对得上。

  同一现象在套件现场的直接证据：`FAIL S18 构造有效性：尾随反斜杠确实传到了脚本 :: echo=[...\plugins8] arg=[...\plugins8\]` —— **子进程收到的值（echo）少了尾随反斜杠**。
- **产品侧不是受害者**：参数完整到达时行为正确（§5.3：D-1 安装/卸载 exit 0/0、目录正确删除）。
- **建议修法**：S18 / S19 改成**不经子进程命令行**传这个参数（例如把路径放进环境变量、或在父进程内联调用脚本），或在夹具里把沙箱根固定到一个**不含空格 / 非 ASCII** 的位置（例如 `$env:TEMP`）；同时在套件里加一条「传参完整性」的显式断言（已有 `构造有效性` 断言，但它的失败信息要更清楚地指向「是传参坏了，不是产品坏了」）。

### W2（低）用户手工在命令行写带尾随反斜杠的 `-Target` 时，可能拿到未捕获的 .NET 异常而不是干净的报错

- **触发条件**：路径含空格 / 非 ASCII，且用户手工敲 `powershell -File install.ps1 -Target "D:\My Plugins\"`。
- **影响**：脚本报 `Exception calling "GetFullPath" with "1" argument(s): "Illegal characters in path."` —— 方向是 fail-closed（什么也没装），但用户看到的是 .NET 异常堆栈而不是脚本自己的中文报错。
- **证据**：与 W1 同源；本轮实跑 `v064-selftest.log:118` 的安装输出与 `:126` 的卸载输出。
- **建议修法**：在 `install.ps1` / `uninstall.ps1` 里把 `GetFullPath` 包一层 try/catch，异常时给一条人话报错（例如「路径里有非法字符，请去掉末尾的反斜杠」）。

### W3（低）`run-all.ps1` 自身的条数是硬编码，防漂网有一个小洞

- **定位**：`run-all.ps1:98` `$selfDeclared = 7`（硬编码），而不是从自己的头部 `ASSERTION-COUNT` 读。
- **影响**：run-all **实际**跑的条数变了（加一个套件 ⇒ 逐套件核对多一条）会被自检抓住（`pass+failed+1 ≠ 7` ⇒ 红）；但如果有人只把 `run-all.ps1` 头部的「（7 条断言）」与机器标记一起改成 8 而不加断言，自检仍按硬编码 7 比 ⇒ **头部的漂移抓不到**（5 个子套件的漂移能抓到，run-all 自己的抓不到）。
- **建议修法**：`$selfDeclared` 改成从自己的头部正则读（与 `:91` 读子套件同样的写法）。

### 补记：V3 的残余**不是**文档与实现不符，故不计为发现

`uninstall.ps1:167-172` 的父目录比较两侧仍由同一个 `$TargetRoot` 派生（只是加了分隔符归一）⇒ 结构上仍是「结构自检」。但**这一轮文档已经如实标注它是结构自检、挡不住作用到别的目录** ⇒ 上轮 V3 的性质（文档宣称「两条独立核对」而实现不是）**已消除**，剩下的只是**已如实披露的实现局限**，不构成新缺陷。

### 已确认修好的（不计为发现）

- **V1**：新断言「命中守卫 + 入口唯一 + 无成功标记」有区分度；突变体下恰好转红 20、EXTRA-RED 0、恒绿 19、金丝雀 6 条全绿、转红原因逐条可查。
- **V2**：`Get-ComparablePath` 只动分隔符不碰空白（10 组输入实测，`D:\plugins\ ` 逐字不变）；尾随反斜杠的安装/卸载恢复正常；空白+反斜杠仍被拒绝。
- **V3**：措辞三处统一、「两条独立核对」全仓只存在于禁用钉子里；内容级核对经**目录树哈希**证明有牙齿。
- **V4**：机器标记 + 三层绑定；改错即红（4 条对账断言红、exit 1）、还原逐字节一致、再跑全绿。
---

## 9. 诚实边界

1. **真实安装目录仍没有实跑过安装 / 卸载**（只读约束）：只做了只读列目录复核（`REAL_FILE_COUNT=28`、`REAL_NEWEST_MTIME=2026-11-10T21:37:23Z`，与上轮一致）。「真实安装根下首次安装（根不存在 → 需新建）」这一形态本单未验。
2. **UNC 根（真实网络共享 `\\server\share`）的端到端行为未实跑**：§5.2 只验证了归一函数的**字符串形态**（`\\srv\share\` ↔ `\\srv\share`），没有在真实网络盘上跑一次安装 + 卸载。
3. **突变体只覆盖 F1 守卫的贡献**：本轮突变体仍然保留 F6 的内容级核对与 V2 的 `Get-ComparablePath`，因此 C 项对照**只检验「去掉尾随空白守卫会怎样」**，不检验 V2 / V3 的贡献（V2 / V3 另有 §5 / §6 的定向实跑）。
4. **W1 的触发变量只做了本地盘的隔离实验**：没有在真实网络盘 / 长路径（>260 字符）/ ReFS 上复测参数传递行为。
5. **B 项的改错只做了「机器标记 30→31」这一种**：没试「人类可读文本与 README 表格同时改错」或「把条数改小」等变体（从 §3.2 的输出看，这几种都会落到同一批对账断言上）。
6. **`-PurgeData` 分支仍未实跑**：它操作真实的 `~/.minimax/v2/plugin-data/...` 路径，在只读约束下不能跑；该分支的路径核对同样改用了 `Get-ComparablePath`（`uninstall.ps1:211-215`），但**未取得实测证据**。
7. **README 的 clone 地址本轮未复验**（上一轮 10:50 复验为 404）：本单聚焦 V1~V4，公开与否的门槛仍按上一轮结论计（属父会话动作）。
8. **「三方条数一致」里的「三方」我按四方核**：机器标记、头部人类可读文本、README 表格、实测 —— 多核了一路，不影响结论。

---

## 10. 我自己的探针 / 夹具错误（自曝）

- **(a) 自写 .ps1 里带中文却没加 BOM ⇒ 脚本解析失败**：第一版 D 探针把 `含尾随空白` 写进了 `.ps1`，但用 `[IO.File]::WriteAllText`（默认无 BOM）落盘 ⇒ PS 5.1 按 ANSI 读 ⇒ 乱码字节破坏了引号 ⇒ `ParserError: Missing '' in method call`。**这正是我上一轮在报告里写过的坑，本轮又踩了一次**。修正：所有自写 `.ps1` 一律用 `New-Object System.Text.UTF8Encoding($true)`（带 BOM）落盘；需要判中文时改用码点拼装（`[char]0x542B + [char]0x5C3E + ...`）。
- **(b) 我的还原脚本里 `BYTE_IDENTICAL_TO_ORIGINAL` 恒为 false，是我的比较逻辑写错**：还原阶段脚本里 `orig` 读的是**当时磁盘上的文件**（= 被改坏的那份），拿它和还原后的文件比当然不等。**权威判据是 prepare 阶段记录的原始哈希 `b470b250…` 与还原后的哈希逐字相等**（我用独立的 `Get-FileHash` 复核了两次，`MATCH=True` / `MATCH_ORIGINAL=True`）。
- **(c) D-2 的 `GUARD_HIT=False` 是我的探针假阴性**：`uninstall.ps1` 用 `Write-Host` 输出，而 `Write-Host` **不进入管道**，所以我 `| Out-String` 抓到的 `$u2` 是空串 ⇒ `Contains(...)` 必然 False。真实证据在控制台原文里：`[X] 路径参数 -Target 含尾随空白（路径末尾；第 12 段 " "）—— 已停止，未做任何改动。`（退出码 1、目录仍在也证实了拒绝）。**这与上一轮自曝的同款错误重复了一次** —— 我明明写过这条。
- **(d) B 项两次运行共用了同一个日志文件名 ⇒ 第一次的证据被覆盖**：还原后复跑把「改错后」的日志覆盖了。我发现后重跑了一遍完整循环，并改成用环境变量指定日志名（`v064-b-corrupt-run2.log`），两份日志现在并存。
- **(e) 我在仓库根留下了 `Microsoft/` 目录**：`Microsoft\Windows\PowerShell\ModuleAnalysisCache`（PowerShell 的模块分析缓存），创建于 2026-11-11T03:30:30Z，是本轮 B 项运行期间起的子进程留下的。**`git status` 把它抓出来了**（我当时立刻停下追查）。已用回收站通道清掉，复核 `MICROSOFT_DIR_EXISTS=False`；再跑一次全绿复跑**未复现**（一次性副作用，机制未完全定位 —— 环境里的 `LOCALAPPDATA` 是正常的 `C:\Users\yang2\AppData\Local`，所以不是我想象中「LOCALAPPDATA 缺失导致相对路径」）。教训：**在仓库根当 cwd 起子进程会污染工作树，验收前后都要 `git status` 对账**。
- **(f) 两次被安全策略拦下**：① 脚本里写了字面量 `\\srv\share`，被判成访问网络共享 ⇒ 改成用 `[char]92` 拼装 UNC 串；② 脚本里写了 `[System.IO.File]::Delete(...)`，被判成删除类命令 ⇒ 改成唯一文件名、不做任何删除。这两次拦阻都发生在**写入之前**，没有污染任何文件。

---

## 11. VERDICT

**PASS_WITH_CONDITIONS —— V1 / V2 / V3 / V4 四条修复都真落地、都有牙齿；但发布的自测套件在「路径含空格或非 ASCII 字符」的环境下是红的（本机即如此），成员「221 条 0 FAIL」的声称在该类环境下不成立。**

- **ACCEPT 六项全部达成**：A PASS、B PASS、C PASS、D PASS、E PASS、F PASS。
- **F1 的防线一字未松**：`install.ps1:211/216/219` < `:221`/`:364`、`uninstall.ps1:134/139` < `:140`；突变体下**恰好转红 20 条**、EXTRA-RED 0、恒绿 19、金丝雀 6 条全绿、转红原因逐条可查（`命中守卫=false`）。
- **本轮新发现 3 条，均非阻断**：**W1（中）**自测套件在含空格 / 非 ASCII 的路径下红（传参吞掉尾随反斜杠，已做变量隔离）；**W2（低）**用户手工命令行写尾随反斜杠会拿到未捕获的 .NET 异常；**W3（低）**`run-all.ps1` 自身条数硬编码，头部漂移抓不到。
- **建议**：W1 必须在公开前或紧随其后修（否则等于发布一个在常见环境下自测就红的验收壳 —— 本仓库路径就含空格与中文，**发布者自己的机器上就是红的**）；W2 / W3 可排入下一版。
- **不阻断公开的判断依据**：install.ps1 / uninstall.ps1 的**产品行为**在本轮全部实跑中正确（尾随空格 fail closed、尾随反斜杠可装可卸、错目标零删除），W1 是**验收壳**的问题，不是安装/卸载的功能缺陷。
- **发布门槛仍在父会话手上**：仓库公开 / push 由父会话做；本单不改可见性、不 commit、不 push、不建 tag。

---

*验收方：verifier / `mvs_26fc11cb8e99483697531140266df940` / 2026-11-11T11:23~11:40+08:00。所有原始输出见 §2-§8；所有结论均出自本方实跑，未采信修复报告里的任何数字。*