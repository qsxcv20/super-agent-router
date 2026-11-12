# v0.5.10 打包发布报告（发布侧）

- 日期：2026-11-12
- 版本：**0.5.9 → 0.5.10**（patch）
- 专项：sa-plugin-release —— 插件包版本发布：版本号与描述同步、CHANGELOG 与面向使用者的 README 产出、包内自洽性校验
- 本单 SCOPE（**且只动了这些**）：`install.ps1`、`tools/install-selftest/`、`plugin/.minimax-plugin/plugin.json`、`plugin/CHANGELOG.md`、`plugin/README.md`、`README.md`、`docs/audit/release-v0510.md`、`docs/audit/.tmp-release-v0510/`
- 本单**未碰**：`plugin/scripts/**`、`plugin/hooks/**`、`plugin/skills/**`、`tests/**`、`docs/audit/defect-ledger.md`、`.superagent/STATUS.md`、`docs/audit/d97-live-evidence.md`、`docs/audit/fix-d97-verification.md`

---

## 0. 给使用者（这一段可直接作为 Release body）

### 一句话

**重复调用闸门以前在真实运行时整条没跑，现在真的拦得住人了**（活体证据已取到）；
**安装器以前会说「已是最新 —— 不重装」却一个字节都没写，现在按内容判定**。

### 为什么你该升这一版

**v0.5.9 在本机默认的 PTC 形态下，那道「子代理连着跑同一条命令就拦下」的闸门其实一次都没生效过。**
v0.5.9 的说明写着「PTC 形态下闸门恒不触发，已修」——**那只对会话库形态成立**。
宿主真正喂给 Hook 的 transcript 是一份 **Claude 兼容投影**（不是会话库的 `messages.jsonl`），
解析器在活体文件上识别到 **0** 个调用 ⇒ 末尾连续数恒为 0 ⇒ 闸门在真实运行时**一次都不触发**
（静默失效：不报错、也不留痕）。

⇒ **从 0.5.9 升到 0.5.10 是必要的，不是可选的。**

### 这一版改了什么

**1. 重复调用闸门修好了（D-97），而且活体证据已取到**

- 改为**按文件形态择一命名空间 + 来源择一**（兼容投影优先、会话库回退，两套口径绝不混数），
  并为投影形态补上「内层 payload ↔ 外层条目」的指纹对齐规则。
- **活体证据（2026-11-12 18:16）**：全新子会话里 4 次同参金丝雀全放行 → 1 次不同参打断 →
  6 次逐字相同的内层 `bash` 调用，**第 6 次在真实运行时被拦下**（错误码 `PTC_TOOL_BLOCKED`）：

  > [super-agent-router] [规则 R-LOOP-SAME-CALL] 无进展重复调用闸门：你已经连续第 6 次发起**完全相同**的工具调用（工具=bash，前 5 次的归一化指纹完全一致、中间没有任何别的工具调用）⇒ 这一轮不会再产生新信息。请现在就交付当前结论，或说明卡在哪一步、还缺什么；确实必须再跑同一条命令，请说明为什么前 5 次没有产出新证据。

**2. 安装器不再「嘴上说装上了」（D-99）**

- 幂等判断从「版本号相等」改成「**内容相等**」（逐文件 SHA256 比对）：
  同一个版本号内改了代码再跑安装，现在会**照常重装**并说明「同版本但内容不同」，
  旧版先整份备份；**不再出现「报『已是最新 —— 不重装』却一个字节都没写」**。
- 新增 **`-Force`**：强制重装（内容完全相同也照装，旧版仍整份备份）。

### 生效三步（缺一不可）

1. **重新安装**；
2. **重启 MiniMax Code 客户端**（宿主把 Hook 绑在注册时按内容哈希物化出的缓存树上，覆盖磁盘不会换绑）；
3. **新开会话**（Hook 按会话激活，旧会话不重新注入）。

### 诚实边界（本版**没有**做到的事，别当成已覆盖）

- **活体证据只覆盖「内层 `bash` 重复」这一形态**（2026-11-12 18:16 取得）。
  其它工具形态（`read` / `glob` / `grep`）、**父会话豁免**、**非 PTC 形态**（模型直接调工具时）
  的活体拦截**仍未取到**。
- 这道闸门是**效率闸门**：读不到 transcript / 解析不出历史时**放行**（与越界拦截的 fail-closed 相反）；
  且只覆盖「**严格连续**」这一族 —— 「查证 → 验证 → 再查证」这类被别的调用打断的打散形态覆盖有限。
- 内层参数只落**子集**的那类调用（`grep` / `glob`）**不可判** ⇒ 实测连跑 **29 次**逐字相同的 `grep` 仍放行
  （fail-open 方向，少拦不误伤）。
- **D-99 修的是安装器**：内容比对按逐文件 SHA256 判定（不看时间戳）；目标目录里多出源没有的文件
  也算「内容不同」⇒ 照常重装（旧版整份备份，**不做增量删除**）。
- **D-92 派工粒度（S4.6）仍无代码兜底** —— 只读类派工不触发组队冲突闸门，靠派工方遵守。

---

## 1. 逐文件改了什么

### 1.1 `install.ps1`（D-99 的修复本体）

| 位置 | 改动 |
|---|---|
| `param` 块 | 新增 `[switch]$Force` |
| `.DESCRIPTION` 第 3 步 | 三分支描述由「按版本号」改为「按**内容**」，并补 `-Force` 分支 |
| `.PARAMETER Force` | 新增（说明与 `-VerifyOnly` 同用时以 `-VerifyOnly` 为准） |
| 第 6 节「幂等判断」 | 判定式由版本号相等改为**逐文件 SHA256 内容相等**；新增 `-Force` 分支；新增「同版本但内容不同」文案 |
| 第 7 节安装完成后 | 新增一行「同版本但内容不同，已重装」 |

**判定式（逐字）**：

```powershell
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$doInstall = $true
$sameVersionContentDiffers = $false
if ($Force) {
    Write-Head '强制重装（-Force）'
    Write-Note '已指定 -Force ⇒ 跳过幂等判断，直接重新安装（旧版仍会整份备份）'
} elseif ($destExists) {
    $destMap = Get-FileMap $DestDir
    $diffNow = @(Compare-FileMaps $srcMap $destMap)
    if ($diffNow.Count -eq 0) {
        $doInstall = $false
        Write-Head '已是最新 —— 不重装'
        Write-Ok ('目标已是 v' + $installedVersion + '，与源**内容逐文件一致**，跳过安装（没有备份、没有覆盖）')
    } else {
        $sameVersionContentDiffers = ($installedVersion -eq $srcVersion)
        Write-Head '目标与源不一致 —— 照常重装'
        if ($sameVersionContentDiffers) {
            Write-WarnTxt ('**同版本但内容不同**：版本号相同（v' + $srcVersion + '）但内容有 ' + $diffNow.Count + ' 处不同 ' +
                           '⇒ 不能当「已是最新」—— 同一版本内改了代码再跑安装，必须真的装上去（旧版会先整份备份）')
        } else {
            Write-Note ('版本号不同（目标 v' + $installedVersion + ' / 源 v' + $srcVersion + '），内容有 ' + $diffNow.Count +
                        ' 处不同 ⇒ 照常安装（旧版会先整份备份）')
        }
        foreach ($d in $diffNow) { Write-Note ('  ' + $d) }
    }
}
```

**关键点**：比较逻辑**复用**脚本里已有的 `Get-FileMap` / `Compare-FileMaps`（装完自校验本来就在用），
**没有另造一套比较逻辑**；版本号相等**不再**是「不重装」的理由 —— 它只是内容比对结果的一个子情形
（版本号不同 ⇒ `plugin.json` 内容不同 ⇒ 必然落到「照常重装」分支）。

**D-88 口径未被弱化**：「必须重启 MiniMax Code 客户端才会生效 —— 不会自动生效」
在 `.DESCRIPTION` 第 8 步 / `.NOTES` / 收尾输出三处**原文保留**。

### 1.2 `tools/install-selftest/install-idempotency-test.ps1`（新增套件，24 条断言）

| 场景 | 断言标签 | 逻辑 |
|---|---|---|
| I | `I1`~`I9` | 同版本号 + **内容不同** ⇒ **会重装**（新内容被装上、旧版被整份备份、输出说明「同版本但内容不同」） |
| II | `II1`~`II5` | 同版本号 + **内容完全相同** ⇒ 仍报「已是最新 —— 不重装」、输出含「没有备份、没有覆盖」、**目标整棵目录哈希前后相同**（一个字节都没写）、备份目录数不变 |
| III | `III1`~`III5` | `-Force` ⇒ **强制重装**（输出不含「已是最新 —— 不重装」、含「强制重装」、备份目录数 +1、重装后内容仍与源一致） |
| IV | `IV1`~`IV5` | **语义变异对照（可证伪）**：把判定退化成版本号口径的变异副本 ⇒ 场景 I 必红 |

**沙箱约定**：建在 `%TEMP%\sar-idem-<时间戳>` 下；`$env:USERPROFILE` 重定向到沙箱内的 `fakehome`；
被测的 `install.ps1` 与 `plugin/` 都是**副本**（假仓库）⇒ **真实安装目录与仓库全程不被触碰**。

**IV 的变异体怎么造**：把副本里的 `$diffNow.Count -eq 0` 替换成 `($installedVersion -eq $srcVersion)`
= 退回 D-99 修复前的版本号口径。`IV5` 断言「仓库重装了、变异体没重装」⇒ 证明场景 I 的断言**会红**，
不是恒绿。

### 1.3 `tools/install-selftest/run-all.ps1`

- `$suites` 增加 `install-idempotency-test.ps1`（7 个子套件）；
- 自身 `ASSERTION-COUNT` **8 → 9**（结构性期望 = 子套件 7 + 2 = 9）；
- 头部人类可读条数同步改「（9 条断言）」，`机器标记`同步。

### 1.4 `tools/install-selftest/check-readme-consistency.mjs`

- 参数集断言：`Target/Project/VerifyOnly` → **`Target/Project/VerifyOnly/Force`**（长度 3 → 4）；
- `SUITE_FILES` 增加 `install-idempotency-test.ps1`；
- **新增 8 条 D-99 语义断言**（实现口径 ↔ 文档口径一起钉住）：
  幂等判定按内容比对 / 不再用「版本号相同就跳过」旧判定 / 支持 `-Force` / `-Force` 分支有「强制重装」文案 /
  有「同版本但内容不同」文案 / `.DESCRIPTION` 写明按内容 / README 写明 `-Force` / README 写明按内容而不是版本号；
- 自身 `ASSERTION-COUNT` **131 → 144**（+4 新套件对账 +8 D-99 断言 +1 新增命令字面量 `install.ps1 -Force`）。

### 1.5 `plugin/.minimax-plugin/plugin.json`

- `version`：`0.5.9` → **`0.5.10`**；
- `description` 末尾追加 **v0.5.10 段**（沿用既有「v0.5.x 起……」体例），覆盖：
  - **D-97 修法**（按文件形态择一命名空间 + 来源择一，投影对齐规则）；
  - **活体证据已取到**（含「工具 = bash ⇒ 走内层口径」这个关键事实、活体缓存树哈希）；
  - **未取到的面**（其它工具形态 read/glob/grep、父会话豁免、非 PTC 形态）；
  - **D-99 修法**（内容比对 + `-Force`）+ 升级必须重启客户端。
- 描述长度 4180 → **5128** 字符；v0.5.9 段**原文保留未动**。

### 1.6 `plugin/CHANGELOG.md`

- 顶部新增 `## [0.5.10] - 2026-11-12` 段（Keep a Changelog 体例），共 5 块：
  | 块 | 内容 | 三要素 |
  |---|---|---|
  | 变更 1 | D-97 修复 + **活体证据已取到**（含实测事实与拒绝原文逐字） | 改了什么 / 为什么 / 怎么验证 ✅ |
  | 变更 2 | D-99 修复（幂等改按内容 + `-Force`） | 改了什么 / 为什么 / 怎么验证 ✅ |
  | 升级必读 | 0.5.9 → 0.5.10 是**必要的**；生效三步 | — |
  | 诚实边界 | 六条（未取到的面 / 效率闸门 fail-open / 只覆盖严格连续 / 参数只落子集 / D-92 无兜底 / D-99 的比对口径） | — |
- 原 `## [Unreleased]` 段的 D-97 说明**并入** v0.5.10 段（不留两处重复叙述）；
  `[Unreleased]` 段本身保留一行指向 `[0.5.10]` 的指针。
- **0.5.9 段原文保留**：逐字节比对 `## [0.5.9]` 段与 HEAD 一致（4788 字符，**逐字相同**）；
  0.5.8 及更早同样逐字未改。0.5.9 段末那句「修法与措辞见上面的 `[Unreleased]` 段」**原文保留**
  （该指针仍然可达 —— `[Unreleased]` 段现在指向 `[0.5.10]`）。

### 1.7 `plugin/README.md`（面向使用者）

| 位置 | 改动 |
|---|---|
| 开头 | 当前版本：v0.5.9 → **v0.5.10** |
| 「升级已有安装」 | 「0.5.9 装上后这道闸门仍一次都不触发 / 待下一个 patch 版」→ **「0.5.10 起已补上，并已取到活体证据」**，并写明「从 0.5.9 升到 0.5.10 是必要的」 |
| 「升级已有安装」 | `install.ps1` 口径由「版本号相同 → 已是最新」改为「**内容逐文件一致 → 已是最新**」；新增「同版本但内容不同 ⇒ 照常重装」与 `-Force` 用法 |
| 「怎么自证当前生效的是哪一版」 | v0.5.9 → **v0.5.10**（版本字面量） |
| 「重复调用闸门」§开头 | 「前提是装的是含 D-97 修复的版本（0.5.9 不含）」→ **「前提是装的是 v0.5.10 或更高」** |
| 「v0.5.9 修好了什么」 | 改为「**v0.5.9 / 0.5.10 修好了什么**」，补 D-97 根因、活体证据原文、边界 1 改为「活体证据只覆盖内层 bash 这一形态」 |

### 1.8 `README.md`（根）

| 位置 | 改动 |
|---|---|
| 开头 | 当前版本：v0.5.9 → **v0.5.10** |
| 「这一版有什么变化」 | 整节重写为 v0.5.10 的四块（D-97 + 活体证据 / D-99 / 派工粒度沿用 / 断言补强），每块写「对你意味着」+ 边界 |
| 安装节 | 新增 `-Force` 示例命令 + 「幂等判断看的是『内容』，不是『版本号』」说明 |
| 「怎么自证当前生效的是哪一版」 | v0.5.9 → **v0.5.10** |
| 「已知边界」 | 「活体拦截证据仍未取到」→ **「已取到，但只覆盖内层 bash 重复这一形态」**，并列出仍未取到的三类形态 |
| 自测表 | 新增 `install-idempotency-test.ps1`（24 条）一行；`check-readme-consistency.mjs` 131 → **144**；`run-all.ps1` 8 → **9** |

---

## 2. 包内自洽性校验（实测输出）

### 2.1 版本号四处一致

脚本：`docs/audit/.tmp-release-v0510/selfcheck.mjs`（一次性，**未进仓库**）

```text
[1] plugin.json version = 0.5.10
[1] description 长度 = 5128 字符
[1] description 含 v0.5.10 段 = true
[1] description 含 v0.5.9 段 = true
[1] description 含 D-97 = true
[1] description 含 D-99 = true
[2] hooks.json 引用脚本 6 个，缺失 0 个
[3] manifest 声明 hooks/hooks.json 存在 = true
[3] manifest 声明 skills/super-agent-router/SKILL.md 存在 = true
[3] plugin/scripts 下 .mjs 共 14 个
[4] 版本号四处：
    plugin/.minimax-plugin/plugin.json     = 0.5.10
    plugin/CHANGELOG.md                    = 0.5.10
    plugin/README.md                       = 0.5.10
    README.md (根)                         = 0.5.10
[4] 四处一致 = true
[5] install.ps1 幂等判定按内容 = true
[5] install.ps1 支持 -Force = true
[5] install.ps1 复用 Get-FileMap = true
```

### 2.2 manifest 与 `hooks.json` 引用的脚本都存在

`hooks.json` 共 **8 个 handler 组**（SessionStart 1 + UserPromptSubmit 1 + PreToolUse 5 + SubagentStop 1），
引用 **6 个** 脚本（session-start / gate / dispatch / guard / loop-gate / watchdog）—— **缺失 0 个**。
manifest 声明的 `hooks/hooks.json` 与 `skills/super-agent-router/SKILL.md` **都存在**；
`plugin/scripts` 下 `.mjs` 共 **14 个**（与根 README 的「14 个脚本」一致；`8 个 handler` 亦实测相符）。

### 2.3 断言条数（**本单自己跑出来的**）

```text
sandbox-test.ps1                41
sandbox-test2.ps1               44
install-idempotency-test.ps1    24   ← 本单新增
trailing-space-test.mjs         39
verify-seed.mjs                 21
check-readme-consistency.mjs   144   ← 本单 +13
run-all-exit-code-test.mjs      18
run-all.ps1 自身对账             9   ← 本单 +1
合计 331 条，FAIL 0
```

### 2.4 先红后绿（D-99 的三条断言）

**红**（断言先写、先跑；**实现未改**，`install.ps1` 仍是版本号口径）：

```text
FAIL  I5 第二次安装**没有**说「已是最新 —— 不重装」（D-99 的正面钉子）   ::
FAIL  I6 第二次安装的输出说明了「同版本但内容不同」   ::
FAIL  I7 第二次安装把新内容装上去了（标记文件出现在目标里）   :: 标记文件没被装上
FAIL  I8 旧版被整份备份了（.backup 下有备份目录）   :: 没有备份目录
FAIL  I9 重装后目标与源的标记文件内容逐字一致   :: 内容不一致
FAIL  III1 退出码 0   :: code=1 out=... : A parameter cannot be found that matches parameter name 'Force'
FAIL  III3 输出说明了「强制重装」   ::
FAIL  III4 旧版被整份备份了（备份目录数 +1）   :: 备份目录数没变
FAIL  IV2 变异副本与仓库 install.ps1 字节不同（变异确实被应用）   :: 变异副本与仓库一字不差 —— 变异没落到文件上
FAIL  IV5 变异副本与仓库 install.ps1 的行为**不同**（仓库重装了、变异体没重装）⇒ 场景 I 的断言可证伪   :: repoInstalled=False mutantInstalled=False
==== 幂等安装判定：PASS 14 / FAIL 10 ====
```

**绿**（改完实现后复跑，同一套件、同一批断言）：

```text
PASS  I1 首次安装退出码 0
PASS  I2 夹具就绪：首次安装后目标里**没有**标记文件（标记是第二次才加的）
PASS  I3 夹具就绪：源侧改了内容但**版本号没变**（源=目标=同一版本号）
PASS  I4 第二次安装退出码 0
PASS  I5 第二次安装**没有**说「已是最新 —— 不重装」（D-99 的正面钉子）
PASS  I6 第二次安装的输出说明了「同版本但内容不同」
PASS  I7 第二次安装把新内容装上去了（标记文件出现在目标里）
PASS  I8 旧版被整份备份了（.backup 下有备份目录）
PASS  I9 重装后目标与源的标记文件内容逐字一致
PASS  II1 退出码 0
PASS  II2 输出含「已是最新 —— 不重装」
PASS  II3 输出含「没有备份、没有覆盖」
PASS  II4 目标整棵目录哈希前后相同（一个字节都没写）
PASS  II5 没有新建备份目录（备份目录数不变）
PASS  III1 退出码 0
PASS  III2 输出**没有**「已是最新 —— 不重装」
PASS  III3 输出说明了「强制重装」
PASS  III4 旧版被整份备份了（备份目录数 +1）
PASS  III5 重装后目标内容仍与源逐字一致
PASS  IV1 变异副本的幂等判定已退化为版本号口径（含 $installedVersion -eq $srcVersion，且不含内容比对口径）
PASS  IV2 变异副本与仓库 install.ps1 字节不同（变异确实被应用）
PASS  IV3 变异副本下：同版本 + 内容不同 ⇒ 判定为「已是最新 —— 不重装」
PASS  IV4 变异副本下：标记文件**没有**被装上（内容不同也没重装）
PASS  IV5 变异副本与仓库 install.ps1 的行为**不同**（仓库重装了、变异体没重装）⇒ 场景 I 的断言可证伪
==== 幂等安装判定：PASS 24 / FAIL 0 ====
```

### 2.5 按台账原文复现 D-99（改源里的 `plugin/scripts/loop-gate.mjs`，版本号不动）

沙箱在 `%TEMP%\sar-d99-repro-<时间戳>` 下；被测的 `install.ps1` 与 `plugin/` 都是**副本**；
`$env:USERPROFILE` 重定向到沙箱内的 fakehome ⇒ **真实安装目录与仓库全程不被触碰**。

```text
--- 步骤 1：首次安装 ---
  [OK] 安装完成：...\target\super-agent-router
  安装后 loop-gate.mjs sha256 = F64EFC26BED22CBC

--- 步骤 2：同一版本号内改源里的 plugin/scripts/loop-gate.mjs（版本号一个字不动）---
  源版本 = 0.5.10 / 目标版本 = 0.5.10 / 版本号相同 = True
  改后源 sha256 = 336FE53D68FBCF18 / 与目标不同 = True

--- 步骤 3：再跑 install.ps1（改前这一步输出「已是最新 —— 不重装」且一个字节都不写）---
  == 目标与源不一致 —— 照常重装
  [!] **同版本但内容不同**：版本号相同（v0.5.10）但内容有 1 处不同 ⇒ 不能当「已是最新」—— 同一版本内改了代码再跑安装，必须真的装上去（旧版会先整份备份）
  [OK] 旧版本已备份到：...\target\.backup\super-agent-router-20261112-192054
  [OK] 安装完成：...\target\super-agent-router
  [OK] 同版本但内容不同，已重装（旧的那一份在 .backup\ 里，要回退就从那儿取）
  重装后 loop-gate.mjs sha256 = 336FE53D68FBCF18
  [判定] 目标已随源更新 = True（修复前应为 False）
  [判定] 输出含「已是最新 —— 不重装」 = False（修复前应为 True）
  [判定] 旧版被整份备份 = True
```

> 台账 D-99 的复现步骤原文是「① 在同一版本号内改 `plugin/scripts/loop-gate.mjs`；② 跑 `install.ps1`
> ⇒ 输出『已是最新 —— 不重装』；③ 比对目标目录与源目录该文件的 sha256 ⇒ **不同**」。
> 上面第 3 步的三个「判定」逐条对上了这三步：修复前三条全是「坏」的那一侧，修复后全部翻到「好」的那一侧。

### 2.6 全量回归

```text
命令：`node tools\run-tests.mjs --all --root plugin --repo .` ⇒ **exit=0**

```text
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=49 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=36 fail=0
RESULT ledger-test exit=0 pass=23 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT loop-gate-test exit=0 pass=67 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
>>> SHELL ALL PASS
```

合计 **14 套 / 910 条 / FAIL = 0**（exit=0）—— 与本单改动前的基线 **14 套 / 910 条 / 0 FAIL** **逐项相同**
（本单未改 `plugin/scripts/**` 与 `tests/**`，基线未被扰动）。
```

---

## 3. 诚实边界逐条核对表

| # | 边界 | `plugin/CHANGELOG.md` | `plugin/README.md`（面向使用者） | 根 `README.md` |
|---|---|---|---|---|
| 1 | **活体证据只覆盖「内层 `bash` 重复」这一形态**（其它工具形态 / 父会话豁免 / 非 PTC 形态仍未取到） | ✅ 诚实边界第 1 条 | ✅ 闸门章节边界 1 | ✅ 「这一版」§1「仍未取到的面」+ 「已知边界」 |
| 2 | **效率闸门 fail-open**（读不到 transcript / 解析不出历史就放行，与安全闸门相反） | ✅ 诚实边界第 3 条 | ✅ 闸门章节边界 3 + 「它不拦什么（诚实边界）」 | ✅ 「这一版」§1 |
| 3 | **只覆盖「严格连续」这一族**（打散形态覆盖有限，累计次数口径本版没有） | ✅ 诚实边界第 3 条 | ✅ 「它不拦什么（诚实边界）」 | ✅ 「这一版」§1 |
| 4 | **参数只落子集 ⇒ 不可判 ⇒ 29 次逐字相同 `grep` 仍放行** | ✅ 诚实边界第 5 条 | ✅ 闸门章节边界 2 | ✅ 「这一版」§1 + 「已知边界」 |
| 5 | **D-92 项目级规则无代码兜底**（只读类派工不触发冲突闸门，靠派工方遵守） | ✅ 诚实边界第 6 条 | ✅ 「派工粒度：一个项目一个窗口」的诚实边界段 | ✅ 「这一版」§3 + 「已知边界」 |
| 6 | **升级后必须重启客户端才会换绑**（+ 新开会话） | ✅ 升级必读 | ✅ 「升级已有安装」节 + 「怎么自证当前生效的是哪一版」 | ✅ 「升级已有安装：三步缺一不可」+ 安装节 |
| 7 | **D-99 的比对口径**（逐文件 SHA256、不看时间戳、多出文件算不同、不做增量删除） | ✅ 诚实边界第 6 条 | ✅ 「升级已有安装」节的说明块 | ✅ 安装节「幂等判断看的是『内容』」 |

**没有把「机制正确」写成「客户端已生效」**：D-97 的活体证据（2026-11-12 18:16）与
仓库副本回放（独立验收 `PASS_WITH_CONDITIONS`）是**两件事**，本报告分两处写，不混。

---

## 4. 清单外问题（发现、**未处理**，按纪律上报）

1. **D-99 的台账条目仍是「已复现（未修）」** —— `docs/audit/defect-ledger.md` 归父会话统一更新，
   本单**未动**（SCOPE 外）。本单的修复在 `install.ps1` + 自测套件里，**台账状态尚未回填**。
2. **D-94（版本号四处一致无自动化断言守护）仍未修** —— 本单用一次性脚本核对，**没有**把它做成
   永久断言（那属测试工装改动，且会牵动套件条数对账）。**本单新增的 8 条 D-99 断言里没有一条覆盖它**。
3. **`plugin/skills/super-agent-router/references/contract.md`（契约正文）与
   `plugin/scripts/loop-gate.mjs` 的注释里仍有「闸门恒不触发（D-91 的根因）」「活体文件上 owned = 0
   ⇒ 恒不触发（D-97 的根因）」等措辞** —— 这些是**根因陈述**，仍然成立，**未改**（且属 SCOPE 外：
   `plugin/scripts/**` 与 `plugin/skills/**` 本单不碰）。
4. **0.5.9 段末尾那句「修法与措辞见上面的 `[Unreleased]` 段」** 指向的是 0.5.9 发布当时的排版，
   本单**原文保留**（历史记录不得改写）；为不让它变成死指针，`[Unreleased]` 段保留了一行
   「本轮 D-97 / D-99 的内容已并入下面的 `[0.5.10]` 段 —— 见那里」。**这是本单的一处判断**，
   若父会话认为该改写 0.5.9 段的指针，请指示。
5. **根 README「升级已有安装」里那句「装上 v0.5.8 后确实多出了一棵新树」** 是 2026-11-12 对 v0.5.8
   那次实测的**历史记录**，本单**原文保留未改**（改它等于篡改证据）。

---

## 5. 没做的事（明确列出）

1. **没改任何判定逻辑**：`plugin/scripts/**` 一行未动（本单只读它来核对 CHANGELOG 的描述是否属实）。
2. **没改协议正文**：`references/contract.md`、`SKILL.md`、`session-start.mjs` / `gate.mjs` 的注入一行未动。
3. **没改测试**：`tests/**` 一行未动，也没改父会话刚提交的 D-97 返工成果。
4. **没更新缺陷台账**：`docs/audit/defect-ledger.md` 归父会话统一更新。
5. **没推远端 / 没打 tag / 没建 Release / 没上传资产 / 没改仓库可见性 / 没有 commit** ——
   对外不可逆动作一律由父会话执行。
6. **没装到本机**（`~\.minimax\plugins\` 未动）、**没重启客户端**、**没碰真实运行时台账** ——
   自测全程在 `%TEMP%` 的沙箱里跑，且被测的 `install.ps1` 与 `plugin/` 都是副本。
7. **没取新的活体证据**：本单**没有**在客户端里重跑活体探针 —— D-97 的活体证据是 2026-11-12 18:16
   由上一轮取到的（`docs/audit/d97-live-evidence.md`），本单只是把它**写进**发布物。
   （父会话另告知：客户端在上一轮末尾**重启过**；本单的自测**不依赖客户端运行时**，全部在沙箱里跑。）
   **因此有一处口径必须说清**：那份活体证据是**当时**的实测（缓存树 `sha256-tree-v1-c38d41ff…` 与仓库逐字节一致），
   它**不因之后的客户端重启而失效**（缓存树是**注册时**物化的）；但**当前**运行中的客户端绑的是哪一版，
   本单**没有复验** —— 客户端刚重启过这件事只说明「此刻的绑定需要重新自证」，
   自证办法见两份 README 的「怎么自证当前生效的是哪一版」（读运行中那棵树的 `.minimax-plugin\plugin.json` 的 `version` 字段）。
   **发布后请照那两步自证一次**，别默认它还在跑上一棵树。
8. **没碰 `.superagent/STATUS.md`**、`docs/audit/d97-live-evidence.md`、`docs/audit/fix-d97-verification.md`。

---

## 6. 给父会话的发布提示

**发布动作**（tag / Release / 资产 zip）由父会话执行；v0.5.9 的流程与两个坑见
`docs/audit/release-v059.md` 第 7 节（`sync-github.mjs` → `verify-github.mjs` →
`git archive` 打 zip → `release-github.mjs --dry-run` → 正式跑）。

**Release body 建议直接取本报告的「第 0 节 给使用者」** —— 它已是用户视角、含诚实边界、可直接给人看。

**本单留下的待办**：
1. 回填台账 D-99 的状态（→ 已修（v0.5.10））；
2. 若要发 GitHub Release，先确认 `git status` 里的 **9 个**改动条目（7 个已改 + 2 个新增：`tools/install-selftest/install-idempotency-test.ps1`、`docs/audit/release-v0510.md`）已全部 commit
   （`sync-github.mjs` 从 **HEAD 的 blob** 取内容，**未提交的新文件不会进包** ——
   新增的 `tools/install-selftest/install-idempotency-test.ps1` 尤其要注意）；
3. 本报告第 4 节第 1 条（台账未回填）与第 4 条（0.5.9 段指针的处理）需要父会话拍板。
