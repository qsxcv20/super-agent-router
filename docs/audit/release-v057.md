# v0.5.7 发布说明

> 产物落点：`docs/audit/.tmp-release/release-v057.md`（本单边界内）。
> 正式路径 `docs/audit/release-v057.md` 由**父会话**转写 —— 不在本单边界内，本单不写。
> 本单负责的包内产出：`plugin/.minimax-plugin/plugin.json`、`plugin/CHANGELOG.md`、`plugin/README.md`。

## 1. 版本

| 项 | 值 |
|---|---|
| 版本号 | **0.5.7**（语义化 patch：修复 + 文档口径收口，无破坏性变更） |
| 版本号落点 | `plugin/.minimax-plugin/plugin.json` 的 `version` |
| CHANGELOG 顶部条目 | `plugin/CHANGELOG.md` 的 `## [0.5.7] - 2026-11-11` |
| 一致性 | 两者一致（自洽检查 B 组断言） |
| 破坏性变更 | **无** |

## 2. 这一版交付了什么

闭环台账里最后两条**已登记未修**项（**D-80** / **D-85**），并把三处「说反了」的文档口径改成新事实。

一句话：**家目录展开下沉到 lib 层**（消除潜在复发口，**不是翻转症状**），
**空设备不再被当成写目标**（待审清单不再混进用不上的请求）。

## 3. 改了什么 / 为什么

完整条目见 `plugin/CHANGELOG.md` 的 v0.5.7 段（每条含「改了什么 / 为什么 / 怎么验证」）。
此处按「权限/判定/文档」三组列要点。

### 3.1 D-80：家目录展开下沉到 `lib.mjs` 的 `absolutizePath()` 内部

| 项 | 内容 |
|---|---|
| 改了什么 | `lib.mjs` 新增 `homeDir()`；`absolutizePath(p, root)` 内部改为**先展开家目录、再拼工作区根** |
| 展开位置 | 发生在「拼工作区根」**之前** ⇒ 家目录下的路径展开后**仍被当成工作区外**的真实路径（不会被拼进工作区根、不会被当成白名单内的路径） |
| 兼容性 | `expandHomePath(p, home)` 的**签名与语义未变**（仍是纯函数，家目录由参数给） |
| 为什么 | 以前的口径是「**每个调用方各自记得展开**」：watchdog 侧展开了、lib 侧没有 ⇒ 台账原话「下一个拿 `absolutizePath()` 判存在性的脚本会重蹈覆辙」。把展开放进「解析成绝对路径」这一步，口径才只有一处 |
| 修的是 | **lib 层的潜在复发口** —— 不是症状翻转（见第 5 节） |

### 3.2 D-85：空设备不再被当成写目标

| 项 | 内容 |
|---|---|
| 改了什么 | `lib.mjs` 新增 `isNullDevicePath()` / `isNullDeviceToken()` / `hasAssetWriteVerb()`；`extractWriteTargets()` 与重定向目标提取**两处**都剔掉空设备；`guard.mjs` 的 bash 判定对象过滤空设备 token |
| 收进来的形态 | POSIX：`/dev/null` `/dev/zero` `/dev/stdout` `/dev/stderr` `/dev/stdin`；Windows：`NUL`（大小写不敏感）/ `NUL:` / `\\.\NUL`；PowerShell：`$null` |
| 为什么不收 | `/dev/urandom`、`/dev/random` 是**真实设备**（不是丢弃口）；`> null` 在 bash 里会真的建一个叫 `null` 的文件 ⇒ **真实写目标** |
| 为什么 | 空设备既不在工作区也不是任何人的产出。把它当写目标会同时坏掉三件事：① 台账多一条**用不上的越界请求**（噪声，把真请求淹掉）；② 拦截文案给出**批准了也没意义**的批准命令；③ `node build.js 2>/dev/null` 这种极常见写法被整条拦下 —— 护栏一旦变成噪音，worker 只会绕开它 |
| 没变的部分 | 真实路径越界**照常**记账并拦；真实写动词（`rm`/`cp`/`mv`…）**仍然**算写操作；重定向目标**解析不出**时**仍然**兜底拒绝 |

### 3.3 文档口径收口（本单最关键的约束）

| 文件 | 处理方式 | 原因 |
|---|---|---|
| `plugin/.minimax-plugin/plugin.json` 的 `description` | **直接改写** | 它是当前状态的声明，不是历史记录 |
| `plugin/README.md` 的「诚实边界」节 | **直接改写**（三行） | README 面向使用者，讲的是**现在**是什么样 |
| `plugin/CHANGELOG.md` 的 **v0.5.6 段** | **原文一个字未删改**，只在段末**追加一句**指向 v0.5.7 | CHANGELOG 是**历史记录** —— v0.5.6 当时写「只修了一半」是准确的，改掉它等于篡改历史 |
| `plugin/CHANGELOG.md` 的新 v0.5.7 段 | 新增 | 记录本版变更 |

> 另有一处由**父会话**改、本单未动：`plugin/skills/super-agent-router/references/contract.md` S8.1 第 3 条，
> 以及 `docs/audit/defect-ledger.md` 的 D-80 / D-85 状态行（两条均记「已修（v0.5.7，待独立复验）」）。

## 4. 怎么验证（原始输出）

### 4.1 全量回归

```powershell
node tools/run-tests.mjs --all --root plugin --repo .
```

```text
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

**十三套 / 836 条断言 / 0 FAIL**（v0.5.6 是**十二套 787 条** —— 含 `ledger-test` 23 条，那是 v0.5.6 内新增的第 12 套；本版多一套：新增 `fix-d80-d85-test`（49 条））。

### 4.2 变异自检：6 个变异体**恰好转红**

```powershell
$env:SAR_MUTATION_D80D85='1'; node tests/fix-d80-d85-test.mjs
```

```text
| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言恰好转红 |
|---|---|---|---|---|
| M-D80 | D-80 | 回退「家目录展开下沉」：absolutizePath 内部不再展开家目录 | 9 | YES |
| M-D85 | D-85 | 回退「空设备不是写目标」：空设备重新进入判定对象与写目标 | 12 | YES |
| M-F1 | D-80（F-1） | 回退「取不到家目录就不展开」：取不到时造一个假家目录出来 | 2 | YES |
| M-F1b | D-80（F-1） | 回退「取真实家目录」：homeDir() 恒返回假家目录（验收方原变异） | 10 | YES |
| M-F1c | D-80（F-1） | 回退「取不到家目录就不展开」：改用 os.userInfo().homedir 兜底 | 4 | YES |
| M-F2 | D-85（F-2） | 回退「真实设备不是空设备」：把 /dev/urandom 与 /dev/random 收进空设备集合 | 5 | YES |
>>> D80D85 MUTATION MATRIX OK
```

「**恰好转红**」是矩阵的判定口径：每个变异体回退**一处**，对应断言**恰好**那一组转红、其余仍绿。
M-F1 只改「取不到」这一支 ⇒ 只该让 F-1 那组转红，D-80 组（家目录取得到时）必须仍绿 —— 矩阵据此自证。
M-F1b 是**验收方原先的变异**（原为 41/41 全绿），单列它是为了证明那个变异**现在会红**。

### 4.3 包内自洽性

```powershell
node docs/audit/.tmp-release/selfcheck-v057.mjs --root .
```

五组共 **35 条断言，0 FAIL**：

| 组 | 检查什么 |
|---|---|
| A | `hooks.json` 引用的 **5 个脚本**逐个存在（`session-start` / `gate` / `dispatch` / `guard` / `watchdog`） |
| B | `plugin.json` 的 version 与 CHANGELOG 顶部版本号一致（版本号从 manifest 读，不硬编码） |
| C | D-80 / D-85 的**三处口径一致**（9 条断言，含「不夸大」「不笼统」「历史段不被删改」） |
| D | README 里出现的脚本与 `--flag` 开关与脚本源码对得上 |
| E | manifest 声明的 skills / hooks / 图标文件存在 |

**改前基线**：同一脚本在文档未改时跑出 **6 条 FAIL**（正是本单要改的六处），
说明 C 组断言**不是恒绿空断言** —— 改完才转绿。

## 5. 诚实边界（本版**没有**做的事 / 不要误读的地方）

### 5.1 D-80 **不是**症状翻转 —— 这一点最容易被读错

验收方做过**改前 / 改后端到端对照**：

> **watchdog 链路改前改后行为完全相同** —— 存在的家目录文件两边都放行、
> 不存在的两边都被 `R-CLAIM-PATH-MISSING` 拦。

用户可见症状在 **v0.5.6** 就已经解决了；
**v0.5.7 修的是 lib 层的潜在复发口**（台账原话：「下一个拿 `absolutizePath()` 判存在性的脚本会重蹈覆辙」）。

⇒ **不许**把它写成「此前家目录写法会被误拦」/「修复了家目录路径被误判不存在」。
本说明与 CHANGELOG 均按「消除复发口」表述，自洽检查 C4 断言会拦住夸大写法。

### 5.2 D-80 的边界：取不到家目录时**不造路径**

`os.homedir()` 抛错或返回空时，展开**退回「不展开」**，**不会凭空造一个家目录出来** ——
造出来的路径必然判不存在 = 误拦诚实的交付。
这一条有独立断言（**F-1**）与三个专属变异体（M-F1 / M-F1b / M-F1c）钉住。

### 5.3 D-85 的两条用户可观测变化（**不要**笼统写成「空设备一律放行」）

| 命令 | 改前 | 改后 |
|---|---|---|
| `tee /dev/null` | **DENY** | **ALLOW** |
| `dd of=/dev/null` | DENY | **仍然 DENY** |

第二条是**刻意留的保守项**，不是漏判：`of=` 是参数形态，护栏对它的识别保守，宁可多判不可漏判。

### 5.4 D-85 **只堵产生侧** —— 历史待审项要人工拒绝

台账里**已经记着**的历史 `/dev/null` 待审项，`--grant` **仍会**把它写进 scope
（批准它没有意义 —— 那不是项目资产）。
⇒ 需要人工在待审清单里**拒绝**它们：

```powershell
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --list
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --deny req_xxx --approver <父会话 id> --reason "空设备不是写目标"
```

### 5.5 沿用前几版的诚实边界

1. **D-76 是设计边界，不是缺陷**：复合层载荷把命令放进变量时判不了（取不到命令文本）。
2. **hook 是护栏不是沙箱**：worker 若能执行一段落盘的脚本，脚本内部的写入不受判定约束。
3. **D-80 / D-85 的代码在本单交付时仍在工作树**（父会话统一 commit），本说明按「已落地、待独立复验」表述。

## 6. 怎么用（本版对使用者的实际影响）

### 6.1 如果你之前被 `> /dev/null` 拦过

现在不会再拦。台账里那条**用不上的**越界请求需要你在待审清单里**拒绝**（见 5.4）。

### 6.2 如果你写过家目录路径的产出

`~/...` 这类写法在底层就会被展开，**不必再自己写绝对路径**；
但注意：家目录下的路径是**工作区外**的真实路径 —— 它仍然需要被 SCOPE 覆盖才能写。

### 6.3 如果你依赖「`dd of=...` 不被拦」

本版**没有**改这个：参数形态保守不认，`dd of=/dev/null` 仍被拦。
这是刻意留的保守项（宁可多判不可漏判），不是漏判。

## 7. 本单改动文件清单

| 文件 | 改动 |
|---|---|
| `plugin/.minimax-plugin/plugin.json` | version 0.5.6 → **0.5.7**；description 的 D-80 段改写为新事实 + 补 D-85 的两条用户可观测变化 |
| `plugin/CHANGELOG.md` | 顶部新增 `## [0.5.7] - 2026-11-11`（4 个变更块 + 总体验证 + 已知边界）；**v0.5.6 段原文未删改**，仅段末追加指向 0.5.7 的一句 |
| `plugin/README.md` | 「诚实边界」节的 D-80 三行**直接改写**；新增「空设备：`> /dev/null` 不再被当成写目标（v0.5.7）」一节（含两条用户可观测变化对照表 + 历史待审项拒绝方法） |
| `docs/audit/.tmp-release/release-v057.md` | 本文件 |
| `docs/audit/.tmp-release/selfcheck-v057.mjs` | 包内自洽性检查脚本（A~E 五组，35 条断言） |

**未改动**（本单边界外）：`plugin/scripts/**`、`plugin/hooks/**`、`plugin/skills/**`、`tests/**`、
`docs/audit/defect-ledger.md`、`docs/audit/verification-*.md`、`docs/audit/release-v056.md`、
`docs/audit/delivery-v056.md`、`.superagent/**`。

## 8. 需要父会话处理

1. **转写发布说明**：把本文件转写为 `docs/audit/release-v057.md`（正式路径不在本单边界内）。
2. **commit**：`plugin/scripts/**`、`tests/**` 与本单的三个包内文件的提交，由父会话统一执行。
3. **部署**：安装副本 `C:/Users/yang2/.minimax/plugins/super-agent-router/` 仍是旧版 ——
   本单**不部署**（部署不在职责边界内），同步由父会话按部署流程执行。
4. **台账状态**：D-80 / D-85 的状态行父会话已改为「已修（v0.5.7，待独立复验）」 ——
   独立复验通过后可更新为已复验。
5. **CHANGELOG 记录**：v0.5.7 段已含本版变更；若需要把 F-08（危险工具表口径收口）也记进版本记录，
   需另派一轮（改 CHANGELOG 不在本单边界内）。


## 9. 仓库级发布（公开 + 一键安装 + MIT）—— 父会话补记，2026-11-11

本节由**父会话**补记：v0.5.7 同时是**本仓库的第一次公开发布**。

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/qsxcv20/super-agent-router` —— 由 private 改为 **public** |
| 许可 | **MIT**（新增 `LICENSE`，Copyright (c) 2026 yang2） |
| 一键安装 | 仓库根 `install.ps1`（`-Target` / `-Project` / `-VerifyOnly`） |
| 卸载 | 仓库根 `uninstall.ps1`（`-Purge` / `-PurgeData`；默认移到 `.trash\`，可恢复） |
| 安装脚本自测 | `tools/install-selftest/` —— 6 套件 **294 条断言** + 8 条条数对账，一条命令复跑 |
| Release | GitHub Release `v0.5.7`，附仓库 zip |

### 9.1 插件包之外的五轮独立验收（安装脚本线）

v0.5.7 的**插件包本体**在 `af35968` 就已闭环（D-80 / D-85，见 §3）。本节记录**仓库级**（插件包之外）的公开准备过程：

| 轮 | 独立验收报告 | 结论 | 这一轮钉住 / 发现的是什么 |
|---|---|---|---|
| 1 | `verification-v062.md` | PASS_WITH_CONDITIONS | **F1**（`GetFullPath` 裁掉尾随空白 ⇒ 误删用户**没指定**的目录）、**F6**（恒真自比较）、F2 / F3（文档口径） |
| 2 | `verification-v063.md` | PASS_WITH_CONDITIONS | 上述四项确认到位；新发现 **V1**（断言不具区分度）/ **V2**（尾随反斜杠误报）/ **V3**（仍是派生式恒真）/ **V4**（条数漂移） |
| 3 | `verification-v064.md` | PASS_WITH_CONDITIONS | V1~V4 确认到位；新发现 **W1**（自测在含空格 / 中文路径下红）/ **W2**（未捕获的 .NET 异常）/ **W3**（自身条数硬编码） |
| 4 | `verification-v065.md` | **FAIL（范围限定）** | 产品侧 A/B/C/E/F 全通过；唯一 FAIL 是测试侧 **X1**（失败计数撞名 ⇒ 断言报红但退出码仍说通过） |
| 5 | `verification-v066.md` | **PASS** | X1 修复确认到位：触发红 ⇒ 退出码非 0 且横幅不说谎；行为级永久断言**能被证伪**（撞名复活即转红） |

### 9.2 这一版守住的边界（不因公开而放松）

1. **D-80 没有翻转用户可见症状**（见 §3.1）—— 公开版发布说明**不追加**任何夸大表述。
2. **D-85 只堵产生侧**（见 §3.2）—— 历史 `/dev/null` 待审项仍需人工拒绝。
3. **安装 / 卸载脚本未在真实安装目录实跑过** —— 全程 `%TEMP%` 沙箱；真实目录只读复核（28 文件、mtime 未变）。
   尾随空格目录只能在 NTFS 用 `\\?\` 造出；FAT32 / 网络盘未验。
4. **路径参数含尾随空白或 Windows 路径非法字符 ⇒ 一律报错退出、零改动**（保守失败）。
   非法字符最常见的成因是命令行里**末尾反斜杠被闭引号吃掉**（`-Target "D:\My Plugins\"` 实际会被解析成 `D:\My Plugins"`），
   脚本会直接点名这个原因并给出两种正确写法。
