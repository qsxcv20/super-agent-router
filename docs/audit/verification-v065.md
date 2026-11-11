# v065 独立复验报告 —— W1 / W2 / W3 三条发现的修复复验（公开前最后一轮）

- 复验对象：`install.ps1`、`uninstall.ps1`、`README.md`、`tools/install-selftest/`（6 文件）、`docs/audit/install-v057-fix3.md`
- 复验人：verifier（独立复验，不采信修复方报告里的任何数字，全部自己实跑、自己量、自己造突变体）
- 复验日期：2026-11-11（会话 `mvs_26fc11cb8e99483697531140266df940`）
- 报告路径：`docs/audit/.tmp-v055/verification-v065.md`（本文件；正式路径由父会话转写）
- 环境：win32 / Node v26.7.0 / PowerShell 5.1.26100.9711；仓库路径 `C:\Users\yang2\Documents\MiniMax\mini code的插件`（**含空格 + 含中文**）

---

## 0. 结论摘要

**VERDICT: FAIL**（范围限定如下，不是「全盘皆输」）

| ACCEPT | 结论 | 一句话依据 |
|---|---|---|
| A：两种 TEMP 形态都 5/5 全绿、0 FAIL | **PASS** | TEMP① `C:\sar-temp-v065`（纯 ASCII 无空格）与 TEMP② 仓库内 `v065-temp 空格 中文`（空格+中文，码点 31354/26684/20013/25991）**逐套件条数完全一致** 41/44/39/21/119 = 264，run-all 自身 7，合计 271 条 PASS、0 FAIL、exit 0 |
| B：W1 新场景有牙齿 | **PASS** | 我把 S18/S19 改回 `-File` 原生传参 ⇒ **恰好 6 条 S18/S19 断言转红**（含「构造有效性」这条行为断言），`RUNALL_EXIT=1`；还原后 sha256 回 `69c5a94e…`、复跑全绿 |
| C：W2 闸门 | **PASS** | 闸门在 GetFullPath **之前**（install `:250/251` → `:257`；uninstall `:173/174` → `:175`）；两脚本闸门体 **sha256 逐字相同**；实现内 Replace/-replace/Trim/Substring 计数 **全为 0**；三种输入实测见 §4 |
| D：W3 防漂有牙齿 | **FAIL** | 自检断言**能发现**漂移（红），但**红不跟随退出码**：头部+机器标记一起改成 8 时 `RUNALL_EXIT=0`，横幅还打印「5 / 5 个套件全部通过；条数对账 6 条绿」⇒ **X1**（见 §5.4） |
| E：回归未被改坏 | **PASS** | 13 套 / **836 条** / 0 FAIL（`>>> SHELL ALL PASS`）；`git diff --name-only -- plugin/` 为空；版本仍 **0.5.7**；V1 突变体对照 **恰好转红 20、EXTRA-RED 0、金丝雀仍绿**；V2/V3/V4 钉子全在 |
| F：按文档命令跑自测不留未跟踪垃圾 | **PASS** | 按 README 原文命令跑（cwd=仓库根），`git status --short` **新增行数 = 0**；TEMP 指仓库内再跑一次，仍 **新增行数 = 0**；仓库根无 `Microsoft/` |

**一句话**：产品侧（install/uninstall）三条修复都真落地、都有牙齿；**唯一红的是测试侧** —— `run-all.ps1:115` 的 `$failed = 0` 与 `$script:failed` 是同一个变量，把 run-all **自己**的红断言计数清零了，于是 W3 自检（唯一守卫「头部与机器标记一起改」这个场景的那条断言）红了却**不产生非零退出码**。修复方 fix3.md §3.2 展示的「exit=1」实际来自**另一条**断言（`check-readme-consistency.mjs` 的头部/标记一致性），不是 W3 自检本身 ⇒ 修复方对 W3 的「改错即红 ⇒ 非零退出」的举证**没有打到点上**。

---

## 1. 范围、方法与判定口径

### 1.1 口径（三轮一致）

1. 每条结论必须指到**一行代码（文件:行号）**或**一条命令的原始输出**；做不了就写「未验证」+ 原因。
2. 阴性结论必须配**金丝雀 + 时间戳 + 会话标识**；探针/夹具错必须自曝。
3. 对照必须来自**真实执行**：突变体对照用同一测试脚本、同一 cwd、同一 TEMP 的配对运行；差分标准 = 恰好转红、EXTRA-RED = 0、恒绿集合、金丝雀仍绿。
4. 改坏测试**当场还原**：字节级改动 + 事先备份 + 独立 `Get-FileHash` 复核回原值 + 复跑全绿。`git status` 抓不到未跟踪目录里的文件改动 ⇒ **哈希才是权威判据**。

### 1.2 复验时点的文件指纹（改前基线）

| 文件 | 字节 | sha256 |
|---|---|---|
| `install.ps1` | 24109 | `1F441EAA477B992B329FBCB80B4E916C526F38870AE65D39EDD688BCBEFBC8EC` |
| `uninstall.ps1` | 15461 | `4171B0E8315FA7D45623DE16FF336E9BF2F59B9ADAF9DCEB0A2ADCE9C69B8658` |
| `README.md` | 17120 | `C353D95207D40B6C3B36E9C0F00DE643ED3CA632BF734B9087AD52759E86E155` |
| `tools/install-selftest/run-all.ps1` | 6277 | `AF9DD0A535592550E54A42DF8A88141B0EB0B81BEE659E2BD884E46E5B072A3B` |
| `tools/install-selftest/sandbox-test2.ps1` | 18160 | `69C5A94E854E3CF139880DEA9E2432B17402370C46E9D87B2BD56FB1B0343837` |
| `tools/install-selftest/trailing-space-test.mjs` | 18710 | `6C8ADBDF3ABF4150D16BD4C7319CA8B2C89589E03DBFE243CAC9A18E49651E23` |
| `tools/install-selftest/check-readme-consistency.mjs` | 18324 | `2F6349AE9E00F5465FC3688D5093C60313AC8F21FC6DCB4A4FF4F7A66A5A0B86` |
| `tools/install-selftest/sandbox-test.ps1` | 12495 | （未改） |
| `tools/install-selftest/verify-seed.mjs` | 6756 | （未改） |

> 注：v063/v064 两轮**没有改动** `install.ps1`（当时 sha `711052F1…`），本轮它变了 —— 说明 fix3 确实动了安装脚本（加 W2 闸门），复核基线必须重新取（我已取）。

### 1.3 只读边界与唯一例外

- 全程只读：`install.ps1` / `uninstall.ps1` / `README.md` / `tools/install-selftest/`。
- **唯一例外**（brief 明确授权）：B 项改 S18/S19、D 项改 run-all 头部、V4 附加项改 sandbox-test2 头部 —— 每次都当场还原并留哈希证据（§3.4 / §5.5 / §6.4）。
- 所有沙箱 / 突变体 / 探针产物建在 `docs/audit/.tmp-v055/` 下；**仓库根未被写入**（收尾 `git status` 与开工逐行相同，§7.2）。
- 未 commit / 未 push / 未改可见性 / 未建 tag。
- 真实安装目录 `C:\Users\yang2\.minimax\plugins\super-agent-router` **只读复核**，收尾树哈希与开工基线逐位相同（§7.3）。

---

## 2. A —— 两种 TEMP 形态下都 5/5 全绿、0 FAIL

### 2.1 两种形态的定义（路径形态实测，不是声称）

| 形态 | TEMP 实际值 | 含空格 | 含非 ASCII |
|---|---|---|---|
| TEMP① | `C:\sar-temp-v065` | False | False |
| TEMP② | `C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v055\v065-temp 空格 中文` | True | True |

TEMP② 的目录名叶子部分码点实测：`118,48,54,53,45,116,101,109,112,32,31354,26684,32,20013,25991`（`空格` = 31354/26684，`中文` = 20013/25991）⇒ 确实是真中文，不是乱码。

### 2.2 逐套件条数（两次实测，四方口径一致）

| 套件 | 头部声明 | TEMP① 实测 | TEMP② 实测 |
|---|---|---|---|
| `sandbox-test.ps1` | 41 | 41 | 41 |
| `sandbox-test2.ps1` | 44 | 44 | 44 |
| `trailing-space-test.mjs` | 39 | 39 | 39 |
| `verify-seed.mjs` | 21 | 21 | 21 |
| `check-readme-consistency.mjs` | 119 | 119 | 119 |
| **子套件合计** | **264** | **264** | **264** |
| run-all 自身断言 | 7 | 7 | 7 |
| **PASS 行总计** | | **271** | **271** |
| **FAIL 行总计** | | **0** | **0** |
| `RUNALL_EXIT` | | **0** | **0** |

### 2.3 原始输出（TEMP① `C:\sar-temp-v065`）

```
RUNALL_EXIT=0
TEMP=C:\sar-temp-v065
PASS  套件 sandbox-test.ps1 实际断言条数 == 头部声明（声明 41 / 实际 41）
PASS  套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 44 / 实际 44）
PASS  套件 trailing-space-test.mjs 实际断言条数 == 头部声明（声明 39 / 实际 39）
PASS  套件 verify-seed.mjs 实际断言条数 == 头部声明（声明 21 / 实际 21）
PASS  套件 check-readme-consistency.mjs 实际断言条数 == 头部声明（声明 119 / 实际 119）
PASS  全部套件断言总数：声明 264 == 实际 264
PASS  run-all.ps1 自身实际断言条数 == 头部声明（7）且 == 结构性期望（子套件 5 + 2 = 7）
==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
```

### 2.4 原始输出（TEMP② 仓库内，含空格 + 含中文）

```
RUNALL_EXIT=0
TEMP=C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v055\v065-temp 空格 中文
PASS  套件 sandbox-test.ps1 实际断言条数 == 头部声明（声明 41 / 实际 41）
PASS  套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 44 / 实际 44）
PASS  套件 trailing-space-test.mjs 实际断言条数 == 头部声明（声明 39 / 实际 39）
PASS  套件 verify-seed.mjs 实际断言条数 == 头部声明（声明 21 / 实际 21）
PASS  套件 check-readme-consistency.mjs 实际断言条数 == 头部声明（声明 119 / 实际 119）
PASS  全部套件断言总数：声明 264 == 实际 264
PASS  run-all.ps1 自身实际断言条数 == 头部声明（7）且 == 结构性期望（子套件 5 + 2 = 7）
==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
```

### 2.5 v064 那 6 条红已消失（逐条点名）

v064 报告记录：TEMP 在仓库内时 `sandbox-test2.ps1` **6 条红**（S18/S19 共 6 条）、`RUNALL_EXIT=1`。本轮 TEMP② 同形态下这 6 条全绿：

```
PASS  S18 构造有效性：尾随反斜杠确实原样传到了脚本
PASS  S18 安装退出码 0（-Target 带尾随反斜杠）
PASS  S18 插件目录已建
PASS  S19 构造有效性：尾随反斜杠确实原样传到了脚本
PASS  S19 卸载退出码 0（-Target 带尾随反斜杠）
PASS  S19 插件目录已删
PASS  S19 卸载走完了内容级 manifest 核对（输出命中「删前核对通过」）
```

新增的 S20/S21（14 条）在 TEMP② 下同样全绿（含两条「夹具就绪」）。

### 2.6 A 条判定

**PASS** —— 两种 TEMP 形态都 5/5 全绿、0 FAIL、exit 0，逐套件条数逐项相同（41/44/39/21/119 = 264 + run-all 自身 7 = 271），v064 的 6 条红已全部转绿。

---
## 3. B —— W1 的新场景有牙齿

### 3.1 我自己复现「子进程命令行传的尾随反斜杠会畸形」（不引用报告）

探针：`docs/audit/.tmp-v055/v065-b-probe2.ps1`（我写的，ASCII + BOM，探针自身在 `C:\sar-temp-v065` 下建目录以**真正隔离**路径形态）。它把同一个尾随反斜杠的值用三种方式送给子进程：

- `native` = `& powershell -File <probe.ps1> -Target <值>`（PowerShell 原生 argv ⇒ 子进程命令行）
- `cmdline` = `cmd.exe /c powershell -File "<probe.ps1>" -Target "<值>"`（**真实 cmd 命令行**）
- `inlinesq` = `powershell -Command "& '<probe.ps1>' -Target '<值>'"`（**W1 的修法**：值整体留在子进程命令行里、用单引号包住）

原始输出（`-ceq` 逐字比较）：

```
=== B-1b: TRUE path-shape isolation (base C:\sar-temp-v065 = pure ASCII, no space) ===
BASE_HAS_SPACE=False BASE_HAS_CN=False
--- variant A_ASCII_NOSPACE leaf_has_space=False leaf_has_cn=False fullpath=C:\sar-temp-v065\b1probe\plain
    mode=native intact(-ceq)=True  got_len=31 sent_len=31 got_tail=[plain\] got_tail_codes=[111,98,101,92,112,108,97,105,110,92]
    mode=cmdline intact(-ceq)=False got_len=31 sent_len=31 got_tail=[plain"] got_tail_codes=[111,98,101,92,112,108,97,105,110,34]
    mode=inlinesq intact(-ceq)=True  got_len=31 sent_len=31 got_tail=[plain\] got_tail_codes=[111,98,101,92,112,108,97,105,110,92]
--- variant B_ASCII_SPACE leaf_has_space=True leaf_has_cn=False fullpath=C:\sar-temp-v065\b1probe\sub dir with space
    mode=native intact(-ceq)=False got_len=44 sent_len=44 got_tail=[space"] got_tail_codes=[105,116,104,32,115,112,97,99,101,34]
    mode=cmdline intact(-ceq)=False got_len=44 sent_len=44 got_tail=[space"] got_tail_codes=[105,116,104,32,115,112,97,99,101,34]
    mode=inlinesq intact(-ceq)=True  got_len=44 sent_len=44 got_tail=[space\] got_tail_codes=[105,116,104,32,115,112,97,99,101,92]
--- variant C_CN_NOSPACE leaf_has_space=False leaf_has_cn=True fullpath=C:\sar-temp-v065\b1probe\中文目录
    mode=native intact(-ceq)=True  got_len=30 sent_len=30 got_tail=[\中文目录\] got_tail_codes=[114,110,100,111,98,101,92,20013,25991,30446,24405,92]
    mode=cmdline intact(-ceq)=False got_len=30 sent_len=30 got_tail=[\中文目录"] got_tail_codes=[114,110,100,111,98,101,92,20013,25991,30446,24405,34]
    mode=inlinesq intact(-ceq)=True  got_len=30 sent_len=30 got_tail=[\中文目录\] got_tail_codes=[114,110,100,111,98,101,92,20013,25991,30446,24405,92]
--- variant D_CN_SPACE leaf_has_space=True leaf_has_cn=True fullpath=C:\sar-temp-v065\b1probe\中文 目录 带空格
    mode=native intact(-ceq)=False got_len=35 sent_len=35 got_tail=[录 带空格"] got_tail_codes=[20013,25991,32,30446,24405,32,24102,31354,26684,34]
    mode=cmdline intact(-ceq)=False got_len=35 sent_len=35 got_tail=[录 带空格"] got_tail_codes=[20013,25991,32,30446,24405,32,24102,31354,26684,34]
    mode=inlinesq intact(-ceq)=True  got_len=35 sent_len=35 got_tail=[录 带空格\] got_tail_codes=[20013,25991,32,30446,24405,32,24102,31354,26684,92]
```

**结论（独立测得）**：

1. 畸形事实成立：**末位反斜杠被闭引号吃掉，参数末尾变成一个字面引号**（码点 34 取代 92）。
2. 触发条件比 v064 记的更精确：**PowerShell 原生 argv 只在路径含空格时畸形**（A/C 完好、B/D 畸形）；而**真实 cmd 命令行无论路径形态一律畸形**（A/B/C/D 全部畸形）。v064 的「CN_ONLY_NOSPACE intact=False」其实是它自己的探针底座在仓库内（含空格）造成的污染（我第一版探针也踩了同一个坑，见 `9）。
3. **W1 的修法（`-Command` 单引号内联）在 4 种路径形态下全部 `intact=True`** —— 这是 W1 有效性的正面证据。

### 3.2 arg-echo 断言确实是逐字比较（`-ceq`）

- 代码：`tools/install-selftest/sandbox-test2.ps1:188` 与 `:196` —— `$echoed -ceq $slashArg` / `$echoed2 -ceq $slashArg`。
- 静态钉子：`check-readme-consistency.mjs:218-219`（`st2.includes('Get-EchoedArg') && st2.includes('-ceq $slashArg')`）。
- 语义实测（我的探针 `v065-b-probe.log` `B-2）：`ceq_case_differs=False  eq_case_differs=True` ⇒ `-ceq` 严格区分大小写，`-eq` 不区分 ⇒ 断言是**逐字**比较，不是模糊比较。

### 3.3 S20 / S21 的「夹具就绪」断言非恒真（反例对照）

断言（`sandbox-test2.ps1:216` / `:239`）：`($malGot.Length -eq ($malDir.Length + 1) -and $malGot.EndsWith('"'))`。

我的反例对照（**同一**真实 cmd 命令行，只改「末尾有没有那个反斜杠」）：

```
CF_WITH_TRAILING_BS : got=len=88 tail=[mal dir"] tail_codes=[111,98,101,92,109,97,108,32,100,105,114,34] predicate=True
CF_NO_TRAILING_BS   : got=len=87 tail=[\mal dir] tail_codes=[114,110,100,111,98,101,92,109,97,108,32,100,105,114] predicate=False
PREDICATE_DISCRIMINATES=True
```

⇒ 畸形**真发生**时为 True、**没发生**时为 False ⇒ 该断言有区分度，不是恒真。

### 3.4 把 S18/S19 改回 `-File` 原生传参 ⇒ 转红 ⇒ 还原 ⇒ 再全绿

**改动（字节级，可审计）**：把 `sandbox-test2.ps1` 的 `RunPsQuotedArg`（`:166`）与 `Get-EchoedArg`（`:179`）两个辅助函数体改成 `-File` 原生传参（= v064 修复前的形态），其余不动。

```
{"action":"backup","origSha":"69c5a94e854e3cf139880dea9e2432b17402370c46e9d87b2bd56fb1b0343837","backupSha":"69c5a94e854e3cf139880dea9e2432b17402370c46e9d87b2bd56fb1b0343837","bytes":18160}
{"action":"mutate","origSha":"69c5a94e...","mutantSha":"a6b8c90ec6c28e3ef37af72b9dc792dae28b06beee751f52779fc0d9536fe778","changedBytes":-286,"quotedReplaced":true,"echoReplaced":true}
```

**改坏后实跑**（TEMP② = 仓库内空格+中文）：

```
RUNALL_EXIT=1
FAIL  S18 构造有效性：尾随反斜杠确实原样传到了脚本   :: echo=[...\v065-temp 空格 中文\sar-selftest2-20261111-125214\plugins8"] arg=[...\v065-temp 空格 中文\sar-selftest2-20261111-125214\plugins8\]
FAIL  S18 安装退出码 0（-Target 带尾随反斜杠）   :: code=1 out=
FAIL  S18 插件目录已建   :: dest 不存在
FAIL  S19 构造有效性：尾随反斜杠确实原样传到了脚本   :: echo=[...] arg=[...]
FAIL  S19 卸载退出码 0（-Target 带尾随反斜杠）   :: code=1 out=
FAIL  S19 卸载走完了内容级 manifest 核对（输出命中「删前核对通过」）   ::
FAIL_COUNT=6
==== 自测：1 / 5 个套件未通过；条数对账 1 条红 ====
```

**恰好 6 条转红，全是 S18/S19 这一个场景**（S20/S21 的 14 条仍全绿 —— 它们走真实 cmd 命令行，不受这次改动影响）；关键点是**行为断言**「构造有效性」直接抓到了畸形（`echo` 末尾是引号而 `arg` 末尾是反斜杠）⇒ 这条场景钉得住，不是靠静态 grep 撑着的。

> 附注：这次改坏**没有**触发 `check-readme-consistency.mjs:216` 的静态钉子（那条只认字面量 `'-File',$installPs1,'-Target',$slashArg`）。也就是说：**W1 的防线是行为断言，不是静态钉子** —— 静态钉子只挡住「照抄旧写法」。

**还原 + 二次验证**：

```
{"action":"restore","nowSha":"69c5a94e854e3cf139880dea9e2432b17402370c46e9d87b2bd56fb1b0343837"}
RESTORED_SHA=69C5A94E854E3CF139880DEA9E2432B17402370C46E9D87B2BD56FB1B0343837
MATCH_ORIGINAL=True      LEN=18160      MUTANT_MARKERS_LEFT=0
--- 复跑 ---
RUNALL_EXIT=0   FAIL_COUNT=0
PASS  S18 构造有效性：尾随反斜杠确实原样传到了脚本
PASS  S19 卸载走完了内容级 manifest 核对（输出命中「删前核对通过」）
==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
```

### 3.5 B 条判定

**PASS** —— 畸形事实我自己复现了；arg-echo 是 `-ceq` 逐字比较；S20/S21 的「夹具就绪」断言有区分度（反例对照 `PREDICATE_DISCRIMINATES=True`）；把 S18/S19 改回 `-File` 恰好 6 条转红、exit 1；还原后哈希回原值、复跑全绿。

---

## 4. C —— W2 的非法字符闸门

### 4.1 闸门位置：在 GetFullPath 之前（代码行 + 源码索引双重取证）

| 脚本 | 守卫调用行 | GetFullPath 行 | 源码索引比较 |
|---|---|---|---|
| `install.ps1` | `:243`/`:244`（USERPROFILE）、`:250`/`:251`（-Target）、`:254`/`:255`（-Project） | `:257` `$TargetRoot = [System.IO.Path]::GetFullPath($Target)`（另 `:400` 是 -Project 的） | `INSTALL_GATE_IDX=8609 INSTALL_GETFULLPATH_IDX=8871 ORDER_OK=True` |
| `uninstall.ps1` | `:166`/`:167`（USERPROFILE）、`:173`/`:174`（-Target） | `:175` `$TargetRoot = [System.IO.Path]::GetFullPath($Target)` | `UNINSTALL_GATE_IDX=5998 UNINSTALL_GETFULLPATH_IDX=6074 ORDER_OK=True` |

函数体位置：`install.ps1:107` 与 `uninstall.ps1:119`（`function Assert-NoIllegalPathChars`）。

### 4.2 两个脚本的闸门逐字相同（sha256 比对，不是肉眼看）

```
IDENTICAL=True   INSTALL_LEN=1357  UNINSTALL_LEN=1357
SHA_A=151972CDB62969AAB08B63688158BD92EDC7071C3B530802F3DCD28CF7CD198A
SHA_B=151972CDB62969AAB08B63688158BD92EDC7071C3B530802F3DCD28CF7CD198A
MATCH=True
C4 GATE_IDENTICAL_INSTALL_VS_UNINSTALL=True
```

### 4.3 不静默修复（实现内零改写算子）

```
C4 GATE_HAS_Replace=0   GATE_HAS_replace=0   GATE_HAS_Trim=0
C4 GATE_HAS_TrimEnd=0   GATE_HAS_TrimStart=0  GATE_HAS_Substring=0
C4 F1_GATE_BODY_LEN=890   C4 F1_GATE_HAS_Replace=0
```

⇒ 新闸门与 F1 空白闸门**都不含任何改写用户路径的算子**；闸门只**报错**（`Fail(...)` ⇒ exit 1），不修复。

### 4.4 三种输入的实测原始输出

**① 含非法字符（真实 cmd 命令行，末尾恰好一个反斜杠）⇒ 干净报错 + 零副作用**

```
C1 CMDLINE=powershell -NoProfile -ExecutionPolicy Bypass -File "C:\...\install.ps1" -Target "C:\...\v065-c6-probe\My Plugins\"
C1 EXIT=1
C1 HAS_ILLEGAL_CHAR_MSG=True
C1 HAS_DOTNET_STACK=False
C1 TREE_UNCHANGED=True
C1 PLUGIN_DIR_CREATED=False
      [X] 路径参数 -Target 含 Windows 路径非法字符（第 92 个字符「"」）—— 已停止，未做任何改动。最可能的原因：命令行里**末尾的反斜杠被闭引号吃掉**了 —— 例如 -Target "D:\My Plugins\" 实际会被解析成 D:\My Plugins"（多出一个引号）。正确写法：去掉末尾的反斜杠（-Target "D:\My Plugins"），或者把末尾写成两个反斜杠（-Target "D:\My Plugins\\"）。
```

卸载侧同形态（`-Purge`，目标是**真实插件目录**）：

```
C1b EXIT=1
C1b HAS_ILLEGAL_CHAR_MSG=True
C1b HAS_DOTNET_STACK=False
C1b TREE_UNCHANGED=True
C1b PLUGIN_STILL_THERE=True
      [X] 路径参数 -Target 含 Windows 路径非法字符（第 94 个字符「"」）—— 已停止，未做任何改动。……
```

⇒ **没有 .NET 异常堆栈**（`Illegal characters in path` 不出现），整棵目录哈希前后逐位相同，插件目录一个字节都没删、也没建。

**② 尾随空格 ⇒ 仍由 F1 空白闸门拒（报错是空白那条，不是新闸门）**

```
C2 EXIT=1
      [X] 路径参数 -Target 含尾随空白（路径末尾；第 11 段 "sp dir "）—— 已停止，未做任何改动。尾随空格是路径身份的一部分；若被静默裁掉，脚本会作用到**另一个**目录。
C2 HAS_WHITESPACE_MSG=True     C2 HAS_ILLEGAL_CHAR_MSG=False     C2 HAS_DOTNET_STACK=False     C2 TREE_UNCHANGED=True
```

**中间段带尾随空格**（F1 的逐段判定仍然在）：

```
C2b TARGET=...\v065-c6-probe\segparent\segdir \sub
C2b EXIT=1
      [X] 路径参数 -Target 含尾随空白（第 12 段 "segdir "）—— 已停止，未做任何改动。……
C2b HAS_WHITESPACE_MSG=True     C2b TREE_UNCHANGED=True     C2b PLUGIN_DIR_CREATED=False
```

**同时含引号与尾随空格 ⇒ F1 先赢（F1 语义未被放松）**：

```
C2c VALUE_LEN=90 ends_with_space=True contains_quote=True
C2c EXIT=1
      [X] 路径参数 -Target 含尾随空白（路径末尾；第 11 段 "bot dir "）—— 已停止，未做任何改动。……
C2c F1_WHITESPACE_GATE_WON=True
C2c HAS_ILLEGAL_CHAR_MSG=False
```

**③ 合法路径 ⇒ 正常工作**

```
C3 EXIT=0        （安装）
C3 PLUGIN_DIR_CREATED=True
C3 UNINSTALL_EXIT=0   C3 PLUGIN_GONE=True
```

**报错文案里给的「正确写法」是真的**（两个末尾反斜杠 ⇒ 正常安装并可卸载）：

```
C3b CMDLINE=... -Target "C:\...\Good Dir\\"
C3b EXIT=0     C3b HAS_ILLEGAL_CHAR_MSG=False     C3b PLUGIN_DIR_CREATED=True
C3b UNINSTALL_EXIT=0     C3b PLUGIN_GONE=True
```

### 4.5 C 条判定

**PASS** —— 闸门在 GetFullPath 之前；两脚本闸门体 sha256 逐字相同；实现内零改写算子（不静默修复）；F1 空白闸门仍先执行且语义未松（尾随空格 / 中间段带空格 / 与引号并存三种情形都仍由 F1 拒）；三种输入的原始输出如上。

---

## 5. D —— W3（run-all 自身条数防漂）

### 5.1 实现确已落地

- `run-all.ps1:108-110`：`$selfM = [regex]::Match($selfSrc, 'ASSERTION-COUNT:\s*(\d+)')` → `$selfDeclared = [int]$selfM.Groups[1].Value`（**从自己头部读，不再写死常量**）。
- `run-all.ps1:111`：`$selfStructural = $suites.Count + 2`（**结构性期望交叉核对**）。
- `run-all.ps1:112`：`Check (...(($script:pass + $script:failed + 1) -eq $selfDeclared) -and (... -eq $selfStructural)) (...)`。
- 静态钉子：`check-readme-consistency.mjs:264-271` 三条（不写死常量 / 从头部读 / 有结构性期望）—— 本轮全绿。

⇒ **W3 的「自推导」这一半是真落地了**，声明值确实来自自己的头部。

### 5.2 突变体一：头部 + 机器标记**一起**改成 8（= W3 声称要堵的那个洞）

```
{"action":"mutate","changedLines":[
 {"line":4,"from":"    super-agent-router 安装 / 卸载脚本自测 —— 一条命令复跑全部套件（7 条断言）。","to":"    ……（8 条断言）。"},
 {"line":6,"from":"    机器标记：ASSERTION-COUNT: 7","to":"    机器标记：ASSERTION-COUNT: 8"}]}
```

实跑结果（TEMP② 仓库内空格+中文）：

```
RUNALL_EXIT=0                <-- 期望 1，实测 0
--- FAIL lines ---
FAIL  run-all.ps1 自身实际断言条数 == 头部声明（8）且 == 结构性期望（子套件 5 + 2 = 7）   :: 实际=7 declared=8 structural=7
FAIL_COUNT=1
--- 汇总横幅 ---
==== 自测：5 / 5 个套件全部通过；条数对账 6 条绿 ====
```

⇒ **断言确实转红了**（W3 的「发现漂移」能力成立），但**进程退出码是 0**，而且**横幅还打印「5 / 5 个套件全部通过」**并把红条数报成 6 条绿（真实是 6 绿 + 1 红）。

### 5.3 突变体二：只改机器标记（= 修复方 fix3.md `3.2 展示的形态）

```
RUNALL_EXIT=1
FAIL  run-all.ps1 头部人类可读条数与机器标记一致（8 条断言）   :: 头部没有「（8 条断言）」
FAIL  run-all.ps1 自身实际断言条数 == 头部声明（8）且 == 结构性期望（子套件 5 + 2 = 7）   :: 实际=7 declared=8 structural=7
FAIL_COUNT=2
==== 自测：1 / 5 个套件未通过；条数对账 1 条红 ====
```

⇒ 这个形态 exit=1，但**红的第一条来自 `check-readme-consistency.mjs`（另一个套件，因「头部人类可读条数与机器标记一致」失败而 exit 1）**；横幅里的「1 个套件未通过」也是它。**run-all 自身的自检（第二条）没有对退出码贡献任何东西** —— 它只是打印了一行 FAIL。

⇒ 所以修复方 fix3.md `3.2 的举证（exit=1）**没有打到 W3 自检的点上**：那个 exit=1 是别的套件给的。

### 5.4 X1（中）—— 根因：`run-all.ps1:115` 的 `$failed = 0` 把红计数清零了

机制（PS 5.1 脚本作用域语义）：在脚本顶层，`$failed` 与 `$script:failed` **是同一个变量**。

- `run-all.ps1:58-61`：`Check()` 里红时执行 `$script:failed = $script:failed + 1`。
- `run-all.ps1:112`：自检 Check 调用（红 ⇒ `script:failed = 1`）。
- `run-all.ps1:115`：`$failed = 0` —— **把上面那个计数清零**。
- `run-all.ps1:122`：`if ($failed -gt 0 -or $script:failed -gt 0) { ... exit 1 }` —— 此时两个变量都是 0 ⇒ 走绿色分支 ⇒ **exit 0**。

隔离复现（我的最小脚本 `v065-scope-iso.ps1`，纯 scratch，不动仓库）：

```
PASS  a passing one
FAIL  a failing one   :: boom
AFTER_CHECKS: script:pass=1 script:failed=1
SAME_VAR? failed -eq script:failed => True
AFTER_L115_RESET: script:pass=1 script:failed=0
SAME_VAR_NOW? failed -eq script:failed => True
WOULD EXIT 0 (GREEN banner)  <-- the defect
```

**影响范围（精确）**：

- 受影响：**run-all 自己那 7 条对账断言的红**（5 条逐套件条数核对 + 1 条总数核对 + 1 条 W3 自检）—— 它们**只打印 FAIL，不影响退出码，也不进横幅的红计数**。
- **不受影响**：任何**子套件自身 exit != 0** 的失败（`run-all.ps1:118` 在 `:115` 之后才累加 `$failed`）⇒ 那条路径的 exit=1 是好的。
- 后果最严重的正是 W3 要守的场景：「头部与机器标记一起改」⇒ **只有** run-all 自检能抓到 ⇒ 它红了但 **exit=0** ⇒ README 里那条命令在 CI/脚本里跑，**退出码检查会放行**。
- 附带：横幅「条数对账 N 条绿」里的 N 是 `$script:pass`，红条数被 `:115` 抹掉 ⇒ 横幅本身也在说谎（「全部通过」）。

**定性**：这是 W3 修复**没有闭环**的地方 —— 断言本身有牙齿（能发现漂移），但**牙齿咬不到发布闸门**（退出码）。缺陷位于**测试侧**，不在产品侧。

### 5.5 还原 + 二次验证

```
{"action":"restore","sha":"af9dd0a535592550e54a42df8a88141b0eb0b81bee659e2bd884e46e5b072a3b"}
SHA=AF9DD0A535592550E54A42DF8A88141B0EB0B81BEE659E2BD884E46E5B072A3B
MATCH=True
--- 复跑 ---
RUNALL_EXIT=0   FAIL_COUNT=0
PASS  run-all.ps1 自身实际断言条数 == 头部声明（7）且 == 结构性期望（子套件 5 + 2 = 7）
==== 自测：5 / 5 个套件全部通过；条数对账 7 条绿 ====
```

### 5.6 D 条判定

**FAIL** —— 自检断言能发现漂移（红，证据充分），但**红不产生非零退出码**，且横幅虚假报「全部通过」；brief 的 D 条要求「改错即红 **+ 非零退出**」，后半句不满足。根因见 `5.4（X1），最小修复见 `11。

---

## 6. E —— 回归没被改坏

### 6.1 仓库回归（`node tools/run-tests.mjs --all --root plugin --repo .`）

```
E1 EXIT=0
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

**13 套，断言总数 = 70+14+58+53+49+228+29+23+65+52+38+119+38 = 836**，fail 全 0，exit 0 ⇒ **与 v064 基线逐项相同**。

### 6.2 plugin/ 零改动 + 版本

```
E2 GIT_DIFF_PLUGIN=[] EMPTY=True
VERSION=0.5.7   NAME=super-agent-router   SCHEMA=1
```

### 6.3 V1（尾随空格身份）突变体对照 —— 突变体从**当前**脚本重建

> v064 的 `v064-mutant/` 是用**旧**版 install/uninstall 造的（v064 时 install.ps1 sha 还是 `711052F1…`）。本轮 install.ps1 已变（加了 W2 闸门），所以我用当前脚本重建了突变体（`v065-mutant/before-install.ps1` sha `fd184147…` / `before-uninstall.ps1` sha `1e55808a…`，共替换 3 + 2 个 `Assert-NoTrailingWhitespace` 调用点）。

```
BEFORE(mutant: Assert-NoTrailingWhitespace neutered) EXIT=1 PASS=19 FAIL=20
AFTER(current scripts)                                EXIT=0 PASS=39 FAIL=0
E3 TURNED_RED_COUNT=20
    RED: install 带尾随空格的 -Project：非零退出且命中守卫（-Project 入口）
    RED: install 带尾随空格的 -Project：目标插件目录未被创建
    RED: install 带尾随空格的 -Project：守卫只命中 -Project 这一条入口
    RED: install 带尾随空格的 -Project：输出里没有任何成功标记（只因守卫而红）
    RED: install 带尾随空格的 -Project：无空格的项目目录未被播种
    RED: install 带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）
    RED: install 带尾随空格的 -Target：守卫只命中 -Target 这一条入口
    RED: install 带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）
    RED: install 带尾随空格的 -Target：无空格的那个目录未被创建
    RED: install 家目录带尾随空格：带空格的家目录下也没建 .minimax
    RED: install 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）
    RED: install 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口
    RED: install 家目录带尾随空格：输出里没有任何成功标记（只因守卫而红）
    RED: uninstall 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）
    RED: uninstall 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口
    RED: 带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）
    RED: 带尾随空格的 -Target：守卫只命中 -Target 这一条入口
    RED: 带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）
    RED: 带尾随空格的 -Target：用户【没指定】的目录内容一字未动
    RED: 带尾随空格的 -Target：用户【没指定】的目录仍在
E3 EXTRA_RED_COUNT=0
E3 ALWAYS_GREEN_COUNT=19
E3 CANARY_STILL_GREEN=True
```

⇒ **恰好转红 20、EXTRA-RED = 0、恒绿 19、金丝雀仍绿** —— 与 v064 记录的基线（19/20 ↔ 39/0）**逐项相同** ⇒ **V1 未被改坏**。

### 6.4 V2 / V3 / V4 钉子复核

**V2（尾随分隔符归一，uninstall.ps1:103 Get-ComparablePath）** —— 功能实测（我抽真实函数跑 9 组输入）：

```
  IN=[C:\]          OUT=[C:\]          WS_PRESERVED=True
  IN=[C:]           OUT=[C:\]          WS_PRESERVED=True
  IN=[C:/]          OUT=[C:\]          WS_PRESERVED=True
  IN=[D:\plugins\] OUT=[D:\plugins]  WS_PRESERVED=True
  IN=[D:\plugins]   OUT=[D:\plugins]  WS_PRESERVED=True
  IN=[D:\plugins\ ] OUT=[D:\plugins\ ] WS_PRESERVED=True   <-- 尾随空格一个字没动
  IN=[D:\a b\]     OUT=[D:\a b]      WS_PRESERVED=True
  IN=[D:\a b ]      OUT=[D:\a b ]     WS_PRESERVED=True   <-- 尾随空格一个字没动
  IN=[D:\plugins\\] OUT=[D:\plugins] WS_PRESERVED=True
--- 实装实卸往返（都带尾随反斜杠）---
V2 INSTALL_EXIT=0    V2 PLUGIN_CREATED=True
V2 UNINSTALL_EXIT_TRAILING_BS=0    V2 PLUGIN_GONE=True
```

⇒ 空白语义一字未松（F1 语义保住了），尾随分隔符归一仍在（装得上卸得掉）。

**V3（不得再宣称「两条独立核对」）** —— 钉子在 `check-readme-consistency.mjs:161-165`（uninstall.ps1 与 README 各一条），本轮全绿。

**V4（条数三方绑定）** —— 钉子在 `check-readme-consistency.mjs:179-209`，本轮全绿；**另做突变体验牙**：把 `sandbox-test2.ps1` 的 `ASSERTION-COUNT: 44` 与 `（44 条断言）` 一起改成 45 ⇒

```
RUNALL_EXIT=1
FAIL  套件 sandbox-test2.ps1 实际断言条数 == 头部声明（声明 45 / 实际 44）   :: declared=45 actual=44
FAIL  README 自测表里 sandbox-test2.ps1 的条数与机器标记一致（45）   :: README 写的是 44
FAIL  全部套件断言总数：声明 265 == 实际 264   :: declared=265 actual=264
FAIL_COUNT=3
==== 自测：1 / 5 个套件未通过；条数对账 1 条红 ====
```

还原证据：`RESTORED_SHA=69C5A94E… MATCH_ORIGINAL=True`（随后复跑全绿，`6.6`）。

> 注意对比：这次 exit=1 来自**子套件**（`check-readme-consistency.mjs` 自己 exit 1），**不是**来自 run-all 自己那条「全部套件断言总数」红 —— 后者同样被 `:115` 抹掉（见 X1）。

### 6.5 E 条判定

**PASS** —— 13 套 / 836 条 / 0 FAIL；`plugin/` 零改动；版本仍 0.5.7；V1 突变体对照恰好转红 20、EXTRA-RED 0、金丝雀绿；V2/V3/V4 钉子全在且 V4 突变体确认有牙齿。

---

## 7. F —— 按文档命令跑自测，会不会在用户仓库留下未跟踪垃圾

### 7.1 按 README 原文命令跑（cwd = 仓库根，**不覆盖** TEMP）

README `208 的命令原文：`powershell -ExecutionPolicy Bypass -File .\tools\install-selftest\run-all.ps1`

```
TIME_BEFORE=2026-11-11T12:49:13.1056572+08:00
CWD_FOR_RUN=C:\Users\yang2\Documents\MiniMax\mini code的插件
TEMP=C:\Users\yang2\AppData\Local\Temp
LOCALAPPDATA=C:\Users\yang2\AppData\Local
README_CMD_EXIT=0
--- GIT STATUS AFTER (verbatim) ---
 M README.md
?? LICENSE
?? docs/audit/install-v057-fix.md
?? docs/audit/install-v057-fix2.md
?? docs/audit/install-v057-fix3.md
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? docs/audit/verification-v063.md
?? docs/audit/verification-v064.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1
--- untracked dirs at repo root AFTER ---
NEW_LINES_COUNT=0
```

**新增行数 = 0**（before/after 逐行相同）。

### 7.2 再来一次：TEMP 指向**仓库内**（空格+中文）⇒ 仍是 0

```
TEMP=C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v055\v065-f2-temp in repo
TEMP_IS_IN_REPO=True
README_CMD_EXIT=0
MS_DIR_BEFORE=[]      MS_DIR_AFTER=[]
NEW_LINES_COUNT=0
```

### 7.3 收尾：工作树与真实安装目录

```
=== GIT STATUS（收尾）===
 M README.md
?? LICENSE
?? docs/audit/install-v057-fix.md
?? docs/audit/install-v057-fix2.md
?? docs/audit/install-v057-fix3.md
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? docs/audit/verification-v063.md
?? docs/audit/verification-v064.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1
        （与开工基线逐行相同；仓库根无 Microsoft/、无新增未跟踪目录）
=== 真实安装目录（只读复核）===
REAL_FILES=28
REAL_TREE_HASH=79B5EB3ABE1353CC6E85B8715D05FC2252C2070C449DED1A7157D76B2CEEFC89
UNCHANGED_VS_BASELINE=True
NEWEST_MTIME=2026-11-10T21:37:23Z      （早于本轮所有写入窗口）
```

⇒ 真实安装目录与运行时台账**全程未被触碰**（28 个文件、整树哈希逐位相同、最新 mtime 停在开工前）。

### 7.4 关于 v064 那次 `Microsoft/` 残留

- v064 报告 `564 记录：仓库根出现过 `Microsoft\Windows\PowerShell\ModuleAnalysisCache`，**机制未定位**（LOCALAPPDATA 当时是正常的）。
- 本轮两次按文档跑（普通 TEMP + 仓库内 TEMP）**都未复现**，仓库根始终无 `Microsoft/`。
- 我做了**机制假设检验**：子 PS 若 `LOCALAPPDATA` 为空，`Join-Path` 会直接报参数绑定错误（而不是落成相对路径）⇒ 「LOCALAPPDATA 缺失 ⇒ 相对路径落进 cwd」这条假设**不成立**。
- 诚实边界：v064 那次残留**成因仍未定位**，我只能说「本轮两次复跑未复现」，不能断言「已彻底消除」。

### 7.5 F 条判定

**PASS** —— 按 README 原文命令跑（两种 TEMP 形态各一次）都**新增 0 行** git status、仓库根无 `Microsoft/`；收尾工作树与开工逐行相同；真实安装目录未被触碰。

---
## 8. 发现汇总（按严重度）

### X1（中）—— `run-all.ps1:115` 的 `$failed = 0` 把「run-all 自身断言的红计数」清零 ⇒ W3 自检红了但**退出码仍是 0**、横幅还报「全部通过」

| 项 | 内容 |
|---|---|
| 触发条件 | run-all 自己的 7 条对账断言（`:112` 的 W3 自检、`:101` 的总数核对、`:97` 的逐套件核对）任一为红，**而 5 个子套件自身全部 exit 0** |
| 观察到的行为 | 断言行打印 `FAIL`；`RUNALL_EXIT=0`；横幅打印「5 / 5 个套件全部通过；条数对账 6 条绿」（真实为 6 绿 + 1 红） |
| 根因（代码） | `run-all.ps1:115` `$failed = 0` 与 `:58`/`:61` 的 `$script:failed` 在脚本作用域是**同一变量** ⇒ 清零；`:122` 的退出判定因此看不到红 |
| 证据 | `docs/audit/.tmp-v055/v065-scope-iso.ps1` + `v065-scope-iso.log`（最小隔离复现）；`v065-a2b-repo-bom.log`（突变体一：RUNALL_EXIT=0 + FAIL_COUNT=1 + 绿色横幅） |
| 影响 | W3 要守的场景（**头部与机器标记一起改** ⇒ 只有 run-all 自检能抓到）**退出码不红** ⇒ README 那条命令在 CI/脚本里跑，退出码检查放行。**缺陷在测试侧，产品侧不受影响** |
| 归属 | 本轮 fix3 引入的 W3 断言把一个**既存**的作用域缺陷变成了「唯一守卫失效」；fix3.md `3.2 的 exit=1 举证来自另一条断言（`check-readme-consistency.mjs` 的头部/标记一致性），**没有打到 W3 自检的点上** |
| 建议修法 | 见 `11（3 行改动） |

### 其余：无其它新发现

- 产品侧（`install.ps1` / `uninstall.ps1`）W1/W2/W3 三条修复**全部真落地、全部有牙齿**（`2–`4）。
- 上一轮的 V1~V4 **未被改坏**（`6.3、`6.4）。
- **无回归**：836 条 0 FAIL；`plugin/` 零改动；版本仍 0.5.7。
- **无工作树污染**（`7）。

---

## 9. 探针自曝（我自己踩的 9 个坑；阴性伪装成阳性比报错更糟）

| # | 我的错误 | 怎么发现的 | 处置 |
|---|---|---|---|
| 1 | A2 首跑自写 `.ps1` **没加 BOM** ⇒ PS 5.1 按 ANSI 读，中文目录名变成乱码 `绌烘牸 涓枃` | 打印出的 TEMP 路径明显是乱码 | 改用 UTF-8 **with BOM** 重写（`v065-run-a2b.ps1`）并**重跑**（A2b），确认叶子码点 = 31354/26684/20013/25991 |
| 2 | B 探针 v1 的「ASCII_NOSPACE」变体**其实仍含空格**（仓库根本身叫 `mini code的插件`）⇒ 4 种路径形态没被真正隔离 | 探针输出里该变体的 `native` 也畸形了，与预期矛盾 | 换底座到 `C:\sar-temp-v065`（纯 ASCII 无空格）重跑（`v065-b-probe2.ps1`），得到 `v065-b-probe2.log` 的隔离数据 |
| 3 | C 探针关键词**手打错了**：漏掉 `Windows` 的尾字母 `s`，且 `径` 的码点写成 24402（应为 24452）⇒ `Contains` 对**肉眼正确**的输出报 False | 输出行肉眼可读，但 `HAS_ILLEGAL_CHAR_MSG=False` | 改为**从源码的 Fail 消息里抽取关键词**（`Get-Kw`）⇒ `KW_CODES=21547,32,87,…,32,36335,24452,38750,27861,23383,31526,65288`、`KW_INSTALL_EQ_UNINSTALL=True`，再实测得 `HAS_ILLEGAL_CHAR_MSG=True` |
| 4 | C4 的「闸门在 GetFullPath 之前」检查**搜的是路径变量**而不是源码文本 ⇒ `ORDER_OK=False` | 该结论与我读到的行号（`:251` 在 `:257` 前）矛盾 | 改为在源码文本里做 `IndexOf` 比较 ⇒ `INSTALL_GATE_IDX=8609 INSTALL_GETFULLPATH_IDX=8871 ORDER_OK=True` |
| 5 | C5 的 JS 转义把「末尾一个反斜杠」变成了**两个** ⇒ 测到的是「正确写法」路径（exit 0、建出插件目录），看起来像产品坏了 | exit=0 + `PLUGIN_DIR_CREATED=True` 与「畸形输入」预期矛盾 | 改用 `[string][char]92` 拼反斜杠并把命令行打印出来核对反斜杠个数（C6），重测 |
| 6 | F 的金丝雀我造的是**空目录** ⇒ git 不跟踪空目录 ⇒ `git status` 看不见它 ⇒ 我的 F 检测器的金丝雀**无效** | 金丝雀造出来后 `git status` 没出现 `Microsoft/`，但目录确实存在 | 承认该阴性样本无信息；改用 `MS_DIR`（目录枚举）作检测器，并说明「git 可见性需要目录里有文件」；金丝雀已用回收站通道清掉（`MS_ROOT_GONE=True`） |
| 7 | F2 的「LOCALAPPDATA 置空」实验**无效**：父进程置空 ⇒ 子进程继承为空 ⇒ `Join-Path` 直接报参数绑定错误（不是落成相对路径） | 子进程输出是异常而不是路径 | 结论改为「该假设不成立」，不据此下任何平台结论 |
| 8 | V2 探针用 `| Out-String` 抓 `uninstall.ps1` 的输出 ⇒ 得空串 ⇒ `UNINSTALL_SAW_MANIFEST_CHECK=False` 是**假阴性**（uninstall 用 `Write-Host`，不进管道） | 控制台原文明明有「manifest name=super-agent-router」 | 改以控制台原文为证据；套件自己的 S19 断言（子进程 stdout 抓取）断言同一字符串且通过 |

| 9 | 收尾复核真实安装目录时**漏了 `Sort-Object`**（基线哈希是排序后算的）⇒ 哈希输入顺序变了 ⇒ 报出 `REAL_UNCHANGED=False` 的**假警报** | 与前一次（同一方法）复核的 `UNCHANGED_VS_BASELINE=True` 矛盾，且 28 个文件数一致 | 用与基线**完全相同**的方法重算 ⇒ `SORTED_HASH=79B5EB3A… SORTED_MATCHES_BASELINE=True`、最新 mtime 仍 `2026-11-10T21:37:23Z` ⇒ 真实安装目录**确实未被触碰**（假警报，非真发现） |
> 附带一条**对修复方结论的修正**：fix3.md `1.1 把畸形触发条件记成「路径含空格**或**非 ASCII」。我独立测得：**PowerShell 原生 argv 只在含空格时畸形**（纯中文无空格是好的），**真实 cmd 命令行则一律畸形**。fix3.md `1.1 的结论方向正确但边界描述不准，**不影响**其修复的有效性（`-Command` 内联在 4 种形态下都完好）。

---

## 10. 诚实边界（哪些没验、为什么）

1. **真实安装目录没有实跑**：全程只做只读哈希复核（28 文件、整树哈希不变、最新 mtime 停在开工前）。原因：自测套件把 `USERPROFILE` 重定向到沙箱、或显式传 `-Target` 到沙箱路径；实跑真实安装目录会改动用户环境，超出只读验收边界。
2. **UNC 根（`\\server\share\`）未端到端实跑**：`Get-ComparablePath` 的 UNC 分支只做了静态阅读；未在真实 UNC 共享上验证（环境里没有可写的 UNC 目标）。
3. **`-Command` 内联传参未覆盖「路径里带单引号」**：套件的 `Quote-Single` 会把单引号成对转义，但我的 4 形态探针没造带单引号的路径 ⇒ 该分支未实测。
4. **突变体矩阵只覆盖本轮对应贡献**：V1 做了完整 BEFORE/AFTER 配对（20 红 / EXTRA-RED 0）；V4 做了单点突变（3 红）；V2 走功能实测（9 组输入 + 装卸往返）；V3 走静态钉子 + 现状复核。**未**为 V2/V3 单独造突变体。
5. **X1 的修复未实施也未验证**：本单是验收，我只给诊断与最小修法（`11）；未改仓库代码（唯一例外是 brief 授权的 B/D/V4 故意改坏，均已还原）。
6. **并发/并行运行未测**：自测为串行执行。
7. **v064 那次 `Microsoft/` 残留的成因仍未定位**：本轮两次按文档跑都未复现（`7.4），但「未复现」不等于「已消除」。

---

## 11. 给修复方的最小修复建议（X1）

问题在 `tools/install-selftest/run-all.ps1`：`:115` 的 `$failed = 0` 与 `$script:failed` 同变量。最小改法（**仅测试侧，不动产品**）：

```powershell
# 现状（:115 起）
$failed = 0
foreach ($r in $results) {
    $mark = 'PASS'
    if ($r.code -ne 0) { $mark = 'FAIL'; $failed = $failed + 1 }
    ...
}
if ($failed -gt 0 -or $script:failed -gt 0) { ... exit 1 }

# 建议：把「套件失败数」换个名字，避免与 $script:failed 撞名；横幅分两个数报
$suiteFailed = 0
foreach ($r in $results) {
    $mark = 'PASS'
    if ($r.code -ne 0) { $mark = 'FAIL'; $suiteFailed = $suiteFailed + 1 }
    ...
}
if ($suiteFailed -gt 0 -or $script:failed -gt 0) {
    Write-Host ('==== 自测：' + $suiteFailed + ' / ' + $results.Count + ' 个套件未通过；对账断言 ' + $script:failed + ' 条红 ====') -ForegroundColor Red
    exit 1
}
```

配套建议（**让 W3 的验收可被机器判定**）：

1. 把「头部与机器标记一起改」这一场景**做成一条永久断言**（在 `check-readme-consistency.mjs` 里，或在 run-all 里对自身源文本做一次**静态**交叉核对：声明值必须等于 `子套件数 + 2`），这样即使 `:115` 那类变量名冲突再次发生，也有**第二条**、且位于**独立进程**（子套件）里的守卫能报红。
2. 验收口径补一条：**「断言红 ⇒ 退出码非 0」必须作为独立断言**，不能只看断言行。

---

## 12. 附录：本轮证据文件清单（均在 `docs/audit/.tmp-v055/` 下）

| 文件 | 内容 |
|---|---|
| `v065-a1-ascii.log` | A：TEMP①（纯 ASCII 无空格）自测全量输出 |
| `v065-a2-repo-bom.log` | A：TEMP②（仓库内空格+中文）自测全量输出（多次覆写，最终一次为还原后全绿） |
| `v065-run-a1.ps1` / `v065-run-a2.ps1` / `v065-run-a2b.ps1` | A 的三个 runner（TEMP 路径写在脚本内容里，不上命令行） |
| `v065-b-probe.ps1` / `v065-b-probe.log` | B：畸形复现 v1（**有探针缺陷 #2**，保留以自曝） |
| `v065-b-probe2.ps1` / `v065-b-probe2.log` | B：**真正隔离**的 4 形态畸形复现 |
| `v065-scope-iso.ps1` | B：`-ceq` / `-eq` 语义对照 |
| `v065-c6-probe.ps1` / `v065-c6-probe.log` | C：W2 三种输入 + 闸门体/顺序/零改写的最终实测 |
| `v065-c-probe.log` / `v065-c2-probe.log` / `v065-c3-probe.log` / `v065-c4-probe.log` / `v065-c5-probe.log` | C：前几版探针（含探针缺陷 #3/#4/#5 的自曝留痕） |
| `v065-c-diag.log` | C：关键词误报的诊断记录 |
| `v065-mutate.cjs` / `v065-mutate-d.cjs` / `v065-mutate-d2.cjs` | B/D 的备份-改坏-还原工具 |
| `v065-backup-sandbox-test2.ps1` / `v065-backup-run-all.ps1` | 还原用的字节级备份 |
| `v065-build-mutant.cjs` / `v065-mutant/` | E：从**当前**脚本重建的 V1 突变体（before-install.ps1 / before-uninstall.ps1 + plugin/ + .superagent/） |
| `v065-e-regression.log` | E：836 条回归 + V1 突变体 BEFORE/AFTER 集合差分 |
| `v065-v2-probe.ps1` / `v065-v2-probe.log` | E：V2 功能实测（9 组输入 + 装卸往返） |
| `v065-f-pollution.log` / `v065-f2-pollution.log` / `v065-f3-canary-mech.log` | F：污染检测 + 金丝雀 + 机制假设检验 |
| `v065-scope-iso.log` | X1 根因的最小隔离复现输出（与 `v065-scope-iso.ps1` 同名不同扩展） |

---

## 13. 结论

**VERDICT: FAIL**

- **W1（自测在含空格/中文路径下红）**：**已修好且有牙齿**。两种 TEMP 形态逐套件条数完全一致（41/44/39/21/119 = 264 + 7 = 271 条全绿、0 FAIL、exit 0）；改回坏传参恰好 6 条转红；夹具就绪断言有区分度；arg-echo 是 `-ceq` 逐字比较；还原后哈希回原值并二次全绿。
- **W2（非法字符 ⇒ 未捕获 .NET 异常）**：**已修好且有牙齿**。闸门在 `GetFullPath` 之前、两脚本逐字相同、零静默修复算子、F1 空白语义未松；三种输入实测均为干净报错 + 零副作用/零删除。
- **W3（run-all 自身条数硬编码）**：**只修了一半**。声明值确实从头部自读、且与「子套件数 + 2」交叉核对（`:108-112`），断言**能发现**漂移；**但红不跟随退出码**（X1）—— 恰恰在它声称要堵的「头部与机器标记一起改」场景里 `RUNALL_EXIT=0`、横幅还报「全部通过」。
- **没有回归**：836 条 0 FAIL、`plugin/` 零改动、版本 0.5.7、V1~V4 未被改坏、工作树无污染、真实安装目录未被触碰。

**给发布决策的一句话**：产品可以发；**但请先把 `run-all.ps1:115` 的变量名冲突修掉**（`11，3 行），否则「自测全绿」这条发布闸门在 W3 这个洞上**形同虚设** —— 闸门不会拦住它自己。
