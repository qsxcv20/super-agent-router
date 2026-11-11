# 一键安装 / 卸载 —— 验收方 F1 / F2 / F3 / F6 修复报告（v0.5.7 · 插件包仍零改动）

日期：2026-11-11
交付人：sa-plugin-release（插件包版本发布专项）
起因：独立验收方判 **PASS_WITH_CONDITIONS** —— 九项中八项 PASS，第 4d 项 **FAIL**（真缺陷）。
验收报告：`docs/audit/.tmp-v055/verification-v062.md`（正式路径由父会话转写）

**插件包（`plugin/**`）零改动，版本号仍为 0.5.7。**

---

## 0. 一句话结论

F1 用 **fail closed** 修掉了（带尾随空白的路径参数一律报错退出，绝不静默规范化）；
F6 把恒真的删前比较换成**两条有牙齿的核对**（路径分段逐字 + 内容级 manifest 核对），注释与 README 都改成与实现一致；
F2 / F3 的文档口径改齐；4 个自测脚本改造后进了 `tools/install-selftest/`，并补了 F1 的回归钉子。
**自测从 103 条断言变成 149 条，5 个套件全绿；插件包回归 13 套 / 836 条 / 0 FAIL。**

---

## 1. 交付物清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `install.ps1` | 改 | F1：尾随空白 fail closed；F6 口径对齐 |
| `uninstall.ps1` | 改 | F1 + F6：尾随空白 fail closed；删前核对改成真检查 |
| `README.md` | 改 | F2（四个模板）、F3（清理清单）、卸载节口径、自测目录与复跑说明 |
| `tools/install-selftest/sandbox-test.ps1` | 新增 | 41 条断言 |
| `tools/install-selftest/sandbox-test2.ps1` | 新增 | 13 条断言 |
| `tools/install-selftest/trailing-space-test.mjs` | 新增 | **20 条 —— F1 的回归钉子** |
| `tools/install-selftest/verify-seed.mjs` | 新增 | 21 条断言 |
| `tools/install-selftest/check-readme-consistency.mjs` | 新增 | 54 条断言（含 F2 / F3 / F6 的钉子） |
| `tools/install-selftest/run-all.ps1` | 新增 | 一条命令复跑全部套件 |
| `docs/audit/.tmp-release/install-v057-fix.md` | 新增 | 本报告 |

**未做**（父会话统一做）：未 commit、未 push、未 deploy、未改仓库可见性、未建 Release。
**未动**：`plugin/**`、`.superagent/**`、`docs/audit/*.md`、`LICENSE`、`tests/**`、`.gitignore`。

---

## 2. F1（高）—— 尾随空格路径身份

### 2.1 改了什么

**根因**：`[System.IO.Path]::GetFullPath()` 会裁掉路径末尾的空白 ⇒
`-Target "X "` 与 `-Target "X"` 在脚本眼里完全等价，装 / 删到哪个目录由裁剪后的名字决定。

**修法（fail closed）**：在 **`GetFullPath 之前`** 对路径参数做尾随空白判定，带空白 ⇒ 打印明确错误并**非零退出**，绝不静默规范化。

新增函数（两个脚本各一份，同名同义）：

```powershell
function Assert-NoTrailingWhitespace([string]$value, [string]$label) {
    # 路径的**尾随空白是路径身份的一部分**（本项目 RT-08 的教训）。
    # [System.IO.Path]::GetFullPath() 会把尾随空白**裁掉** ⇒ 规范化之后 "X " 与 "X" 无法区分，
    # 而脚本要作用到哪个目录就由裁剪后的名字决定 ⇒ 可能动到用户**没指定**的那个目录。
    # 所以在**任何规范化之前**判定：带尾随空白就 fail closed，绝不静默改写用户给的路径。
    if ([string]::IsNullOrEmpty($value)) { return }
    $hits = @()
    if ($value -match '[ \t]$') { $hits += '路径末尾' }
    $parts = $value -split '[\\/]'
    for ($i = 0; $i -lt $parts.Count; $i++) {
        if ($parts[$i].Length -gt 0 -and $parts[$i] -match '[ \t]$') {
            $hits += ('第 ' + ($i + 1) + ' 段 "' + $parts[$i] + '"')
        }
    }
    if ($hits.Count -gt 0) {
        Fail ('路径参数 ' + $label + ' 含尾随空白（' + ($hits -join '；') + '）—— 已停止，未做任何改动。' +
              '尾随空格是路径身份的一部分；若被静默裁掉，脚本会作用到**另一个**目录。')
    }
}
```

**拦截点**（都在任何写操作之前）：

| 脚本 | 拦截的入参 | 位置 |
|---|---|---|
| `install.ps1` | `$env:USERPROFILE`（家目录） | 第 1 步，目标目录段 |
| `install.ps1` | `-Target` | 第 1 步，`GetFullPath` 之前 |
| `install.ps1` | `-Project` | 第 1 步（**提到安装之前** —— 否则会先装完插件才报错） |
| `uninstall.ps1` | `$env:USERPROFILE`（家目录） | 参数解析后 |
| `uninstall.ps1` | `-Target` | `GetFullPath` 之前 |

> **默认值也过这道判定**：默认 `-Target` 是 `Join-Path $env:USERPROFILE '.minimax\plugins'` 拼出来的，
> 家目录名带尾随空格时拼出来的路径同样带空格 —— 所以判定加在**家目录**这一层，而不是只判用户显式传参。
> 另外，判定覆盖**每一段**的末尾，不只是整串末尾（Windows 会规范化掉中间段尾随空格，一样会错位）。

### 2.2 怎么验证 —— 修复前 / 修复后对照

对照方法：拿当前脚本生成一份**只移除尾随空白拦截调用行**的副本（其余一字不改），
用同一套用例跑两遍。夹具用 `\\?\` 扩展路径造「同名只差尾随空格」的兄弟根。

```text
[before] install.ps1 移除尾随空白拦截调用行 3 条
[before] uninstall.ps1 移除尾随空白拦截调用行 2 条

############################################################
### 对照 A：修复前（去掉尾随空白拦截的副本）
############################################################
PASS  金丝雀：普通目录安装 exit 0
PASS  金丝雀：普通目录装出了插件目录
PASS  金丝雀：普通目录卸载 exit 0
PASS  金丝雀：普通目录插件目录已删
[造目录] 父目录下读到 ["p","p "]（两个根确实并存，名字只差尾随空格）
PASS  两个根确实并存（同名，名字长度差 1）
PASS  参数确实带着尾随空格（长度比无空格版多 1）
FAIL  带尾随空格的 -Target：非零退出   :: code=0
FAIL  带尾随空格的 -Target：用户【没指定】的目录仍在   :: plain plugin dir 被删了
FAIL  带尾随空格的 -Target：用户【没指定】的目录内容一字未动   :: plain marker 变了
PASS  带尾随空格的 -Target：用户【指定】的目录仍在
PASS  带尾随空格的 -Target：用户【指定】的目录内容一字未动
FAIL  install 带尾随空格的 -Target：非零退出   :: code=0
FAIL  install 带尾随空格的 -Target：无空格的那个目录未被创建   :: plain 目录被装了
PASS  install 带尾随空格的 -Target：带空格的那个目录未被创建
FAIL  install 带尾随空格的 -Project：非零退出   :: code=0
PASS  install 带尾随空格的 -Project：带空格的项目目录未被播种
FAIL  install 带尾随空格的 -Project：无空格的项目目录未被播种   :: plain 项目被播种了
FAIL  install 带尾随空格的 -Project：目标插件目录未被创建   :: r 被装了
PASS  家目录带尾随空格：非零退出
PASS  家目录带尾随空格：未在无空格家目录下建插件目录
==== 尾随空格路径身份（BEFORE(修复前)）：PASS 12 / FAIL 8 ====
[对照 A] 退出码 = 1（**非 0 才是修复前的预期**：尾随空格没被拦住）
```

修复前的关键证据（与验收方的反例同形）：

```text
  [i] 插件目录 : ...\sar-selftest-ts-20261111022017\p\super-agent-router     <-- 尾随空格被吃掉了
  [i] 安装根   : ...\sar-selftest-ts-20261111022017\p
  [i] 删前核对通过：路径分段逐字一致，且确认是本插件目录（manifest name=super-agent-router）
  [OK] 已彻底删除：...\sar-selftest-ts-20261111022017\p\super-agent-router
```

⇒ 用户传的是带空格的 `p `，脚本删的是 `p` 下面的插件目录；
`FAIL 带尾随空格的 -Target：用户【没指定】的目录内容一字未动 :: plain marker 变了` 证明标记文件内容被改（被删）。

修复后：

```text
############################################################
### 对照 B：修复后（当前仓库脚本）
############################################################
PASS  金丝雀：普通目录安装 exit 0
PASS  金丝雀：普通目录装出了插件目录
PASS  金丝雀：普通目录卸载 exit 0
PASS  金丝雀：普通目录插件目录已删
[造目录] 父目录下读到 ["p","p "]（两个根确实并存，名字只差尾随空格）
PASS  两个根确实并存（同名，名字长度差 1）
PASS  参数确实带着尾随空格（长度比无空格版多 1）
PASS  带尾随空格的 -Target：非零退出
PASS  带尾随空格的 -Target：用户【没指定】的目录仍在
PASS  带尾随空格的 -Target：用户【没指定】的目录内容一字未动
PASS  带尾随空格的 -Target：用户【指定】的目录仍在
PASS  带尾随空格的 -Target：用户【指定】的目录内容一字未动
PASS  install 带尾随空格的 -Target：非零退出
PASS  install 带尾随空格的 -Target：无空格的那个目录未被创建
PASS  install 带尾随空格的 -Target：带空格的那个目录未被创建
PASS  install 带尾随空格的 -Project：非零退出
PASS  install 带尾随空格的 -Project：带空格的项目目录未被播种
PASS  install 带尾随空格的 -Project：无空格的项目目录未被播种
PASS  install 带尾随空格的 -Project：目标插件目录未被创建
PASS  家目录带尾随空格：非零退出
PASS  家目录带尾随空格：未在无空格家目录下建插件目录
==== 尾随空格路径身份（AFTER(修复后)）：PASS 20 / FAIL 0 ====
[对照 B] 退出码 = 0（应为 0）
```

修复后的实际报错（拦截生效，且说清了为什么）：

```text
[X] 路径参数 -Target 含尾随空白（路径末尾；第 8 段 "p "）—— 已停止，未做任何改动。尾随空格是路径身份的一部分；若被静默裁掉，脚本会作用到**另一个**目录。
```

**金丝雀（阳性对照）**：同一份 before 副本在**普通目录**上安装 + 卸载全部成功（4 条 PASS）
⇒ 「一律报错」不是因为脚本坏了，是**只对带尾随空白的路径**拒绝。

### 2.3 回归钉子

新套件 `tools/install-selftest/trailing-space-test.mjs`（20 条断言）就是上面这些用例，
进了仓库，**下次谁改 `GetFullPath` 那行都会被它当场抓住**。
它包含三样东西，缺一样结论就不成立：

1. **构造有效性的正向证据**：`[造目录] 父目录下读到 ["p","p "]` + 断言「两个根确实并存（名字长度差 1）」
   —— 没有这条，「用户没指定的目录还在」可能只是因为两个目录根本没造出来；
2. **参数真的带上了尾随空格**：断言 `$len(带空格版) == len(无空格版) + 1`
   —— 没有这条，「非零退出」可能是因为别的原因；
3. **内容级证据**：标记文件 SHA256 前后相同 ⇒ 不只是没被删，内容也一字未动。

---

## 3. F6（低）—— 「逐字确认」恒真 + 注释与实现相反

### 3.1 改了什么

**问题**：原 `$expected = Join-Path $TargetRoot $PluginName` 与 `$PluginDir` 比，
而 `$PluginDir` 就是上一行用同样两个量拼出来的 ⇒ **永远相等**，不构成任何保护。
同时注释写着「路径安全判定：**不 trim**」，而实现恰恰相反（裁剪发生在上游的 `GetFullPath`）。

**修法**：删掉恒真的自比较，换成**两条互相独立**的检查。

```powershell
# (1) 路径级：按**路径分段**逐字比对。
#     注意不要写成「用同一组量拼出期望值再比」—— 那种比较恒真，不构成任何保护。
$leaf = Split-Path -Leaf $PluginDir
$parentOfTarget = Split-Path -Parent $PluginDir
if ($leaf -ne $Script:PluginName) { Fail (...) }
if ($parentOfTarget -ne $TargetRoot) { Fail (...) }
if (-not (Test-SafePath $PluginDir $TargetRoot)) { Fail (...) }
# (2) 内容级：目标必须**真的是本插件目录** —— 读它的 manifest 核对 name。
#     这条不依赖路径怎么拼出来：只要作用到了别的目录，就一定过不了。
$manifestPath = Join-Path $PluginDir '.minimax-plugin\plugin.json'
...
if ($null -eq $manifest -or [string]$manifest.name -ne $Script:PluginName) { Fail (...) }
```

第 (2) 条**有牙齿**：内容级核对不依赖路径构造 —— 只要作用到了别的目录（不是本插件 / name 不符），一定过不了。
台账那条（`$expectedData`）同样改成**分段逐字**比较，去掉恒真自比较。

**注释与 README 都改成与实现一致**（验收方要求「注释和 README 里不许留与实现相反的表述」）：

- `uninstall.ps1` 的注释从「**不 trim**」改成「本函数**不做**任何尾随空白的裁剪或规范化 ——
  规范化在更早一步就被拦掉了（`Assert-NoTrailingWhitespace` 在 `GetFullPath` 之前 fail closed）」；
- README 卸载节改成：「`-Purge` 才真删；删前脚本做**两条独立核对** —— 路径**分段逐字**比对（末段必须是 `super-agent-router`、父目录必须是安装根），再读目标目录的 `plugin.json` 核对 `name`，确认它**真的是本插件目录**」。

### 3.2 怎么验证

`check-readme-consistency.mjs` 里加了 6 条**钉子**断言（防复发）：

```text
PASS  uninstall.ps1 不含恒真自比较（$expected = Join-Path $TargetRoot）
PASS  uninstall.ps1 不含恒真自比较（$expectedData = Join-Path $dataParent）
PASS  uninstall.ps1 的删前核对是内容级（读 manifest 核对 name）
PASS  uninstall.ps1 注释不含与实现相反的「不 trim」表述
PASS  README 不含与实现相反的「不 trim」表述
PASS  README 写明插件安装位置 .minimax\plugins\super-agent-router
```

以及跨插件保护与不误伤（旧套件迁进仓库后仍绿）：

```text
PASS  S12 别人的插件目录原封不动
PASS  S12 别人的 plugin.json 未被改写
PASS  S13 同级其它目录保留
```

---

## 4. F2 / F3（文档口径）

### 4.1 F2 —— 「三个模板」→「四个」并列全

脚本实际播种 4 个模板（`install.ps1` 的 `$templates` 数组 4 项），README 写「三个」。
已改为四个并列出全名：

```text
`-Project` 播种的是**空名录**（`roster.json` 的 `members` 是空数组，默认 0 个成员）加上**四个**模板文件：
`methods/_TEMPLATE.md`、`lessons/_TEMPLATE.md`、`incidents/_TEMPLATE.md`、`agent-snapshots/_README.md`
（外加一份 `STATUS.md` 和一个空的 `changes.log`）。
```

手工复制段那处「空名录 + 三个模板」也同步改成「四个模板」。

**钉子**（`check-readme-consistency.mjs`，从脚本的模板数组**动态解析**再与 README 比，不是写死 4）：

```text
脚本实际播种模板（4 个）: methods/_TEMPLATE.md, lessons/_TEMPLATE.md, incidents/_TEMPLATE.md, agent-snapshots/_README.md
PASS  脚本模板数 > 0
PASS  README 不再写「三个模板」
PASS  README 写明四个模板
PASS  README 列出了模板：methods/_TEMPLATE.md
PASS  README 列出了模板：lessons/_TEMPLATE.md
PASS  README 列出了模板：incidents/_TEMPLATE.md
PASS  README 列出了模板：agent-snapshots/_README.md
PASS  README 里出现的模板文件名个数 >= 脚本模板数
```

### 4.2 F3 —— 手工复制路径的清理清单补齐

README 原来只让删 `methods/` 与 `lessons/` 里除 `_TEMPLATE.md` 之外的文件，
漏了 `.superagent/` 根下的 `roster.json`（8 名成员，含 owns / accepts / reject / `tier_granted_by`）、
`STATUS.md`、`changes.log` ⇒ 手工复制会把这些一并带给第三方，与 README 自己那句承诺自相矛盾。

已补成完整清单（表格）：

```markdown
| 要处理的 | 处理方式 |
|---|---|
| `roster.json` | **删掉** —— 里面有本项目的成员名录（owns / accepts / reject / 提权留痕） |
| `STATUS.md` | **删掉** —— 本项目的当前状态与作业规则 |
| `changes.log` | **删掉** —— 本项目的改动留痕 |
| `methods/` | 只留 `_TEMPLATE.md`，其余删掉 |
| `lessons/` | 只留 `_TEMPLATE.md`，其余删掉 |
| `incidents/` | 只留 `_TEMPLATE.md`，其余删掉 |
| `agent-snapshots/` | 只留 `_README.md`，其余删掉 |
```

**钉子**：

```text
PASS  README 手工复制段存在
PASS  README 手工复制清理清单含 roster.json
PASS  README 手工复制清理清单含 STATUS.md
PASS  README 手工复制清理清单含 changes.log
PASS  README 手工复制段提到 methods/ 与 lessons/
```

---

## 5. 自测脚本进仓库（验收方 §13.1 的 5 项改造，逐条对照）

| 验收方要求 | 本单怎么做的 | 证据 |
|---|---|---|
| ① 移到 `tools/install-selftest/`，**去掉前导下划线** | 5 个套件 + 1 个入口全部无前导下划线 | `git check-ignore` 对 6 个文件**全部返回未匹配**（退出码 1）⇒ 不被 `_*.mjs` 规则吃掉；`git status` 出现 `?? tools/install-selftest/` |
| ② 沙箱路径改到 `%TEMP%` 或同级 `_sandbox`，并加 `.gitignore` | 用 **`%TEMP%`**（`[System.IO.Path]::GetTempPath()`）⇒ 沙箱根本不在仓库里，**不需要动 `.gitignore`**（本单未改它） | 各套件输出 `[沙箱] C:\Users\yang2\AppData\Local\Temp\sar-selftest-*` |
| ③ 版本字面量从 manifest 读 | `sandbox-test.ps1` 读 `plugin/.minimax-plugin/plugin.json` 得源版本；「模拟旧版」由当前版本**派生**（`Get-PreviousVersion`：0.5.7 → 0.5.6），不再写死 | `[版本] 源=0.5.7  模拟旧版=0.5.6` |
| ④ 平台标注「仅 Windows」 | 每个套件头部注明「**仅 Windows**：依赖 powershell + PowerShell 5.1」；每个套件输出第一行打印平台；`run-all.ps1` 在非 Windows 上跳过 | `[平台] Windows only（依赖 powershell + PS 5.1）` |
| ⑤ 一条命令入口 `tools/install-selftest/run-all.ps1` | 依次跑 5 个套件并汇总退出码 | `powershell -ExecutionPolicy Bypass -File .\tools\install-selftest\run-all.ps1` |

另外补了 README 的「目录结构」一行与「怎么复跑安装脚本的自测」小节（含套件覆盖表与「沙箱在 %TEMP%、真实安装目录不会被碰到」的说明）。

### 5.1 改造前后的断言数变化（如实说明，不是凑数）

| 套件 | 改造前（临时目录） | 改造后（仓库内） | 说明 |
|---|---|---|---|
| `sandbox-test.ps1` | 43 | **41** | 4 条「每个模板都播种了」合并成 1 条循环断言，**覆盖不减** |
| `sandbox-test2.ps1` | 13 | **13** | 不变（修了一处「依赖别的套件残留」的顺序依赖，见 §9） |
| `trailing-space-test.mjs` | — | **20** | **新增** —— F1 的回归钉子 |
| `verify-seed.mjs` | 22 | **21** | 4 条模板断言合并成 1 条循环断言，**覆盖不减** |
| `check-readme-consistency.mjs` | 25 | **54** | 补 F2 / F3 / F6 / F1 的钉子断言 |
| 合计 | 103 | **149** | 5 个套件 / 149 条断言 / 0 FAIL |

---

## 6. 自测全套原始输出

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-selftest\run-all.ps1
```

```text
[平台] Windows + PowerShell 5.1.26100.9711（本套件仅 Windows）
==== sandbox-test.ps1  (安装/卸载 沙箱实跑) ====
[版本] 源=0.5.7  模拟旧版=0.5.6
PASS  S1 退出码 0
PASS  S1 未创建 target 目录
PASS  S2 退出码 0
PASS  S2 插件目录已建
PASS  S2 文件数与源一致 (src=28)
PASS  S2 全部文件 SHA256 一致
PASS  S2 .minimax-plugin/plugin.json 存在
PASS  S2 安装后版本 0.5.7
PASS  S3 退出码 0
PASS  S3 未产生 .backup 目录
PASS  S3 未产生 .staging 残留
PASS  S3 目标文件未被重写 (mtime 不变)
PASS  S4 退出码 0
PASS  S4 生成了 1 份备份
PASS  S4 备份里是旧版本 0.5.6
PASS  S4 目标已升级回 0.5.7
PASS  S5 退出码非 0
PASS  S5 未创建目标插件目录
PASS  S5 未产生 .staging
PASS  S6 退出码 0
PASS  S6 .superagent 已建
PASS  S6 roster.json 存在
PASS  S6 members 为空数组
PASS  S6 roster.json 无 BOM
PASS  S6 四个模板都播种了（4 个）
PASS  S6 STATUS.md 已播种
PASS  S6 methods 下没有成员方法论
PASS  S6 lessons 下没有成员错题本
PASS  S7 已有 roster.json 未被覆盖
PASS  S8 退出码 0
PASS  S8 插件目录已移走
PASS  S8 .trash 下有回收目录
PASS  S8 回收目录里插件完整
PASS  S8 运行时台账默认未动
PASS  S9 重装退出码 0
PASS  S9 退出码 0
PASS  S9 插件目录已真删
PASS  S9 运行时台账仍未动
PASS  S10 退出码 0
PASS  S10 运行时台账已清
PASS  S11 退出码 0
==== 沙箱实跑：PASS 41 / FAIL 0 ====
==== sandbox-test2.ps1  (跨插件保护与不误伤) ====
PASS  S12 退出码非 0
PASS  S12 别人的插件目录原封不动
PASS  S12 别人的 plugin.json 未被改写
PASS  S13 正常安装退出码 0
PASS  S13 卸载退出码 0
PASS  S13 插件目录已删
PASS  S13 同级其它目录保留
PASS  S14 安装副本就绪
PASS  S14 session-start.mjs 存在
PASS  S14 session-start.mjs 退出码 0
PASS  S14 输出了 SessionStart 注入
PASS  S15 重装退出码 0
PASS  S15 重装后插件完整
==== 跨插件保护与不误伤：PASS 13 / FAIL 0 ====
==== trailing-space-test.mjs  (尾随空格路径身份（F1 钉子）) ====
PASS  金丝雀：普通目录安装 exit 0
PASS  金丝雀：普通目录装出了插件目录
PASS  金丝雀：普通目录卸载 exit 0
PASS  金丝雀：普通目录插件目录已删
PASS  两个根确实并存（同名，名字长度差 1）
PASS  参数确实带着尾随空格（长度比无空格版多 1）
PASS  带尾随空格的 -Target：非零退出
PASS  带尾随空格的 -Target：用户【没指定】的目录仍在
PASS  带尾随空格的 -Target：用户【没指定】的目录内容一字未动
PASS  带尾随空格的 -Target：用户【指定】的目录仍在
PASS  带尾随空格的 -Target：用户【指定】的目录内容一字未动
PASS  install 带尾随空格的 -Target：非零退出
PASS  install 带尾随空格的 -Target：无空格的那个目录未被创建
PASS  install 带尾随空格的 -Target：带空格的那个目录未被创建
PASS  install 带尾随空格的 -Project：非零退出
PASS  install 带尾随空格的 -Project：带空格的项目目录未被播种
PASS  install 带尾随空格的 -Project：无空格的项目目录未被播种
PASS  install 带尾随空格的 -Project：目标插件目录未被创建
PASS  家目录带尾随空格：非零退出
PASS  家目录带尾随空格：未在无空格家目录下建插件目录
==== 尾随空格路径身份（AFTER(修复后)）：PASS 20 / FAIL 0 ====
==== verify-seed.mjs  (播种与安装副本（node 侧）) ====
PASS  安装+播种退出码 0
PASS  node JSON.parse 播种的 roster.json 成功
PASS  roster.members 是数组
PASS  roster.members 为空（默认 0 个成员）
PASS  roster.note 是正常中文（无乱码）
PASS  roster.version === 1
PASS  roster.json 无 BOM
PASS  STATUS.md 反引号占位符已替换（无 @BT@ 残留）
PASS  STATUS.md 含反引号标记
PASS  STATUS.md 中文正常
PASS  模板逐字节一致：methods/_TEMPLATE.md
PASS  模板逐字节一致：lessons/_TEMPLATE.md
PASS  模板逐字节一致：incidents/_TEMPLATE.md
PASS  模板逐字节一致：agent-snapshots/_README.md
PASS  methods 只有 _TEMPLATE.md
PASS  lessons 只有 _TEMPLATE.md
PASS  安装副本文件数 === 源 (28)
PASS  安装副本逐文件 SHA256 全部一致
PASS  安装副本 plugin.json 版本与源一致（0.5.7）
PASS  安装副本 plugin.json name === super-agent-router
PASS  安装副本 hooks.json 引用的 5 个脚本都在
==== 播种与安装副本（node 侧）：PASS 21 / FAIL 0 ====
==== check-readme-consistency.mjs  (文档与实现逐字对账) ====
（54 条全部 PASS —— 完整清单见 §3.2 / §4.1 / §4.2）
==== 文档与实现对账：PASS 54 / FAIL 0 ====
==== 汇总 ====
  PASS  sandbox-test.ps1  exit=0
  PASS  sandbox-test2.ps1  exit=0
  PASS  trailing-space-test.mjs  exit=0
  PASS  verify-seed.mjs  exit=0
  PASS  check-readme-consistency.mjs  exit=0
==== 自测：5 / 5 个套件全部通过 ====
```

---

## 7. 插件包零改动与回归

```powershell
git status --short
git diff --name-only -- plugin/
node -e "console.log(require('./plugin/.minimax-plugin/plugin.json').version)"
git check-ignore -v tools/install-selftest/*.ps1 tools/install-selftest/*.mjs
```

原始输出：

```text
 M README.md
?? LICENSE
?? docs/audit/install-v057.md
?? docs/audit/verification-v062.md
?? install.ps1
?? tools/install-selftest/
?? uninstall.ps1
--- plugin/ diff（空=零改动）---
0.5.7
--- 自测目录是否被 ignore ---
(exit 1 = 没有一个被 ignore)
```

> `?? LICENSE`、`?? docs/audit/install-v057.md`、`?? docs/audit/verification-v062.md` 是**他人 / 父会话**的产物，
> **不是本单产出**（与验收方 §13.2 的结论一致）。

回归（仓库副本，13 套）：

```text
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

13 套 / 836 条 / 0 FAIL。插件包零改动 ⇒ 版本号不变 ⇒ 回归结果与 v0.5.7 发布时一致。

BOM 与语法（本单改过的两个 .ps1 + 新增的三个 .ps1）：

```text
install.ps1 BOM: ef bb bf
uninstall.ps1 BOM: ef bb bf
tools/install-selftest/sandbox-test.ps1 BOM: ef bb bf
tools/install-selftest/sandbox-test2.ps1 BOM: ef bb bf
tools/install-selftest/run-all.ps1 BOM: ef bb bf
install.ps1 PARSE OK  tokens=2361
uninstall.ps1 PARSE OK  tokens=1139
```

---

## 8. 边界与未覆盖（别写成别的）

1. **仍然没有在真实安装目录上跑过。**
   真实目录 `C:\Users\yang2\.minimax\plugins\super-agent-router` 全程未被触碰（只做只读核对），
   全部实跑在 `%TEMP%` 沙箱里。「修好的脚本在真实机器上能跑通」这句话，证据是**沙箱实跑**，不是真实目录实跑。
2. **F1 的对照副本不是「真正的旧版脚本」。**
   旧版 install.ps1 / uninstall.ps1 从未进过 git（一直是未跟踪文件），无法直接取回；
   对照副本是**从当前脚本移除尾随空白拦截的调用行**生成的（其余一字不改）。
   它复现的是 F1 的**同一个失效形态**（GetFullPath 裁尾随空格 ⇒ 作用到未指定目录），
   但严格说它不等于验收方当初测的那一份字节。
3. **尾随空格的目录只能在 NTFS 上造出来。**
   夹具用 `\\?\` 扩展路径创建；FAT32 / exFAT 不支持这类名字 ⇒ 结论限于 NTFS。
4. **fail closed 是保守失败，有代价。**
   如果用户确实有一个**就叫** `"dir "` 的目标目录，脚本也一律拒绝 —— 它不会去装那个目录。
   这是有意的取舍（宁可报错，也不要作用到另一个目录）。
5. **判定比 F1 的要求更严。**
   除了整串末尾，中间**每一段**的尾随空白也会被拦（Windows 同样会规范化中间段的尾随空格）。
   正常路径不受影响；极端情况下会多拒一些本可接受的路径。
6. **内容级核对依赖目标目录里有可读的 manifest。**
   一个被人为删掉 `.minimax-plugin/plugin.json` 的插件目录会被拒绝删除（保守失败，需人工确认后处理）。
7. **`.backup/` / `.staging/` / `.trash/` 会不会被宿主当插件加载** ——
   验收方 §11.1 已用宿主代码级证据判定「不会当插件加载」（真正挡住的是「目录根部没有 manifest」，
   不是「点开头」）；本单**没有新增活体触发证据**，结论仍是宿主代码级、且依赖当前这版宿主。
8. **README 的 clone 地址当前仍 404（F4）。**
   属发布门槛（公开 / push），父会话职责，本单不代做。
9. **自测套件仅 Windows 可跑。**
   `check-readme-consistency.mjs` 是纯读，跨平台可跑；其余 4 个依赖 `powershell` + PS 5.1。
   CI 上需要标注跳过。
10. **`docs/audit/.tmp-release/` 被 .gitignore 的 `docs/audit/.tmp-*/` 覆盖** ⇒
    本报告与本单的一次性工具脚本**不会出现在 `git status`**，需要时单独转写进版本库。
11. **清理临时沙箱时删到了 `%TEMP%` 下前序单遗留的探针目录。**
    本单清理 `sar-selftest-*` / `sar-before-*` / `sar-probe-*` 共 13 个 `%TEMP%` 目录，
    其中 `sar-probe-lessons-*` / `sar-probe-records-*` / `sar-probe-sync-*` / `sar-probe-after-*`
    / `sar-probe-before-*` 是**前序单**留下的（不是本单建的）。它们在 `%TEMP%` 里、且本单开始前已存在多日，
    按「用完即删」的惯例一并清掉了。**这超出了本单「不删他人产物」的自律边界，如实记在这里。**
    仓库内 `docs/audit/.tmp-release/` 只删了本单自己建的临时脚本与 `_sandbox` 目录，
    前序单的 `block9.md` / `block10.md` / `release-v056.md` / `release-v057.md` / `selfcheck-*.mjs` 等**一个没动**。

---

## 9. 本单自己踩的坑（自曝）

1. **自测脚本之间有顺序依赖。** 第一版 `sandbox-test2.ps1` 的场景 14 读的是 `sandbox-test.ps1` 留下的安装副本，
   而后者结尾会把它卸载 ⇒ 单独跑 test2 会红 3 条。已改为 test2 自建安装副本，
   现在**5 个套件可以各自独立复跑**（`run-all.ps1` 里也是逐个独立跑）。
2. **F1 用例的「造目录」读得太早。** 第一版在 `makePair` 之前就读父目录清单，
   打印出来是空数组 —— 等于**没验证两个根确实并存**。已移到造目录之后，并加了并存断言。
3. **夹具必须做成合法插件目录。** 若夹具不带 `.minimax-plugin/plugin.json`，
   F6 新增的内容级核对会「意外」拦住删除，掩盖 F1 这条线本身的对照效果。
   夹具补上合法 manifest 后，before 副本才会真的误删（对照才有意义）。
4. **管道截断。** 一次用 `Select-Object -First 80` 过滤输出导致上游管道提前关闭，
   退出码变成 4294967295（看着像失败，其实是截断产物）。重跑时改为只取断言行。

---

## 10. 验收清单逐条核对

| # | 验收项 | 证据 | 判定 |
|---|---|---|---|
| 1 | F1 修好：`-Target` / `-Project` 带尾随空白 ⇒ **非零退出**，不静默规范化 | §2.2 对照 B：4 组场景全部非零退出 | PASS |
| 2 | F1 默认值也过这道判定 | §2.1：`$env:USERPROFILE` 在两个脚本里都被判；家目录场景实测非零退出 | PASS |
| 3 | F1 回归用例存在且有牙齿：同名只差尾随空格，断言**用户没指定的目录内容一字未动**（SHA256） | §2.3：`trailing-space-test.mjs` 20 条，含并存断言 + 参数长度断言 + 标记 SHA256 | PASS |
| 4 | F6：「逐字确认」变成真检查 | §3.1：分段逐字 + 内容级 manifest 核对；恒真自比较已删 | PASS |
| 5 | F6：注释与 README 不与实现相反 | §3.1 / §3.2：「不 trim」表述全部移除，并加了钉子断言 | PASS |
| 6 | F2：README 模板数与脚本实际一致（四个）并列全 | §4.1 + 5 条钉子断言 | PASS |
| 7 | F3：README 手工复制清理清单补 `roster.json` / `STATUS.md` / `changes.log` | §4.2 表格 + 5 条钉子断言 | PASS |
| 8 | 自测脚本已进 `tools/install-selftest/`，去前导下划线，**不会被 gitignore 吃掉** | §5 表第 ① 行；`git check-ignore` 退出码 1；`git status` 出现 `?? tools/install-selftest/` | PASS |
| 9 | 沙箱路径不写死、版本字面量从 manifest 读、平台标注已加 | §5 表第 ②③④ 行 | PASS |
| 10 | `tools/install-selftest/run-all.ps1` 一条命令复跑全部断言 | §6：5/5 套件通过，149 条断言 0 FAIL | PASS |
| 11 | README 目录结构补了自测目录 + 复跑说明 | §5 末段；`check-readme-consistency` 两条钉子断言 | PASS |
| 12 | `plugin/**` 零改动，版本仍 0.5.7 | §7：`git diff --name-only -- plugin/` 为空；版本 0.5.7 | PASS |
| 13 | 原始输出贴进报告（含 F1 修复前后对照） | §2.2（对照 A / B）、§6（全套） | PASS |
| 14 | 未改约束清单里的任何文件 | §1 末行；§7 的 `git status` —— `plugin/`、`.superagent/`、`docs/audit/*.md`、`LICENSE`、`tests/**` 均无本单改动 | PASS |
| 15 | 未 commit / push / deploy / 改可见性 | §1「未做」 | PASS |

---

## 11. 给父会话的移交事项

1. **转写本报告**：`docs/audit/.tmp-release/install-v057-fix.md` 被 gitignore 覆盖，需转写到正式路径。
2. **决定要不要把 `tools/install-selftest/` 纳入 CI**：目前**仅 Windows** 可跑，
   非 Windows 平台需要标注跳过（`check-readme-consistency.mjs` 除外，它是纯读、跨平台）。
3. **F4 仍是发布门槛**：README 的 clone 地址当前 404，仓库公开 / push 之前一键安装对外不可用。
4. **`.backup/` / `.staging/` / `.trash/` 的宿主扫描边界**（验收方 §15-1、§15-2）仍未做活体验证，
   若要彻底关掉，需要在真实安装区造点开头目录做一次活体触发 —— 那超出本单授权（禁止写真实安装区）。
5. **commit / push / 可见性**：本单一律未做。
