# 一键安装 / 卸载脚本交付说明（v0.5.7 · 插件包零改动）

日期：2026-11-11
交付人：sa-plugin-release（插件包版本发布专项）
范围：仓库根 `install.ps1`、`uninstall.ps1`、根 `README.md` 的「安装 / 卸载」两节
**插件包（`plugin/**`）零改动，版本号仍为 0.5.7。**

---

## 0. 一句话结论

装一条命令、卸一条命令，都有幂等、有备份、有自校验、失败不装一半；
文档与脚本的参数逐字对账通过；插件包一个字节没动。

---

## 1. 交付物清单

| 文件 | 状态 | 作用 |
|---|---|---|
| `install.ps1` | 新增 | 一键安装。`-Target` / `-Project` / `-VerifyOnly` |
| `uninstall.ps1` | 新增 | 卸载。`-Target` / `-Purge` / `-PurgeData` |
| `README.md` | 改 | 「## 安装」重排（一键在前、手工降级为备选）+ 新增「## 卸载」+ 目录结构补两行 |
| `docs/audit/.tmp-release/install-v057.md` | 新增 | 本报告 |

**最终复跑（清空沙箱后从干净状态跑）**：43 + 13 + 22 + 25 = **103 条断言，0 FAIL**；
BOM 复核 `install.ps1 BOM: ef bb bf` / `uninstall.ps1 BOM: ef bb bf`。

**未做**（父会话统一做）：未 commit、未 push、未 deploy、未改仓库可见性。

### 验证脚本（留在 `docs/audit/.tmp-release/`，可复跑）

| 脚本 | 作用 | 结果 |
|---|---|---|
| `_add-bom.mjs` | 给 .ps1 加 UTF-8 BOM | 见 §3 |
| `_parse-check.ps1` | PS 5.1 语法解析 | 2 文件 PARSE OK |
| `_sandbox-test.ps1` | 沙箱实跑 11 场景（43 条断言） | 43 PASS / 0 FAIL |
| `_sandbox-test2.ps1` | 补充安全场景（13 条断言） | 13 PASS / 0 FAIL |
| `_verify-seed.mjs` | node 侧播种 / 安装副本校验（22 条断言） | 22 PASS / 0 FAIL |
| `_check-readme-consistency.mjs` | 文档与脚本参数对账（25 条断言） | 25 PASS / 0 FAIL |

复跑方式（沙箱建在可写目录内，`USERPROFILE` 被重定向，不碰真实安装目录与真实台账）：

```powershell
chcp 65001 > $null
powershell -NoProfile -ExecutionPolicy Bypass -File "docs/audit/.tmp-release/_sandbox-test.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "docs/audit/.tmp-release/_sandbox-test2.ps1"
node docs/audit/.tmp-release/_verify-seed.mjs
node docs/audit/.tmp-release/_check-readme-consistency.mjs
```

---

## 2. 设计口径（先说清「为什么这么写」，便于复核）

| 决策 | 理由 |
|---|---|
| 安装走「暂存 → 自校验 → 换位」，不是直接覆盖 | 直接覆盖中途失败会留下半份插件；暂存失败时目标目录一个字节没动 |
| 源校验失败 ⇒ **非零退出**，且不创建任何目录 | 「不装一半」是可复核的硬要求（场景 5 实测） |
| 版本相同 ⇒ 报「已是最新」不重装 | 幂等；重装会把用户的本地改动冲掉 |
| 版本不同 ⇒ 先整份备份到 `.backup/<名>-<时间戳>/` | 升级可回退 |
| 自校验用**文件数 + SHA256 逐文件** | 只比文件数会漏掉「同名不同内容」 |
| 播种 `roster.json` 用**空 members 数组** | 默认 0 个成员是插件的设计；`roster.mjs` 与 `gate.mjs` 都接受空数组（已实测） |
| 播种只放**空名录 + 三个模板** | 本仓库的成员方法论 / 错题本是**本项目的私有记忆**，不能复制给别人 |
| 已存在的文件一律不覆盖 | 用户的项目数据优先 |
| 播种的 `roster.json` 写成**无 BOM** | node 的 `JSON.parse` 不认 BOM（有 BOM 会解析失败） |
| 卸载默认**移到** `.trash/` 而不是删 | 后悔了能搬回去 |
| `-Purge` 删前逐字校验路径在插件目录内，且**不 trim** | 路径尾随空格是路径身份的一部分，裁剪会删错目录 |
| `-PurgeData` 才清运行时台账 | 台账是数据，不给开关就不动 |
| 项目里的 `.superagent/` 一律不动 | 那是项目数据，不是插件 |

---

## 3. 编码：BOM 校验（PS 5.1 的坑）

**为什么必须有 BOM**：PS 5.1 按 ANSI 读无 BOM 的 .ps1 → 中文乱码 → 本单第一次跑测试脚本时
**直接 ParseError**（报 `The string is missing the terminator: '`）—— 这不是脚本的错，是编码的错。

校验命令与原始输出：

```powershell
node docs/audit/.tmp-release/_add-bom.mjs install.ps1 uninstall.ps1
node -e "const b=require('fs').readFileSync('install.ps1');console.log('install.ps1 head:',b[0].toString(16),b[1].toString(16),b[2].toString(16))"
node -e "const b=require('fs').readFileSync('uninstall.ps1');console.log('uninstall.ps1 head:',b[0].toString(16),b[1].toString(16),b[2].toString(16))"
```

原始输出：

```text
install.ps1 -> ef bb bf  (BOM added)
uninstall.ps1 -> ef bb bf  (BOM added)
install.ps1 head: ef bb bf
uninstall.ps1 head: ef bb bf
```

> 两个 .ps1 的首 3 字节均为 `ef bb bf`。
> 报告本身是 .md，沿用仓库惯例**无 BOM**（仓库现有 md/json 均实测为 no-BOM）。

---

## 4. 语法解析（PS 5.1 自带 parser）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "docs/audit/.tmp-release/_parse-check.ps1"
```

原始输出：

```text
install.ps1 PARSE OK  tokens=2163
uninstall.ps1 PARSE OK  tokens=770
```

---

## 5. 沙箱实跑原始输出

沙箱根：`docs/audit/.tmp-release/_sandbox/`（在可写目录内）；
`USERPROFILE` 被改指向 `_sandbox/fakehome` ⇒ `-PurgeData` 动的是沙箱台账，**不是真实台账**；
`-Target` 指向 `_sandbox/plugins` ⇒ **真实安装目录 `C:\Users\yang2\.minimax\plugins\super-agent-router` 全程未被触碰**。

### 5.1 全部断言结果

```text
--- 场景 1：VerifyOnly 不写任何文件 ---
PASS  S1 退出码 0
PASS  S1 未创建 target 目录
--- 场景 2：首次安装 ---
PASS  S2 退出码 0
PASS  S2 插件目录已建
PASS  S2 文件数与源一致 (src=28)
PASS  S2 全部文件 SHA256 一致
PASS  S2 .minimax-plugin/plugin.json 存在
PASS  S2 安装后版本 0.5.7
--- 场景 3：幂等（同版本不重装） ---
PASS  S3 退出码 0
PASS  S3 未产生 .backup 目录
PASS  S3 未产生 .staging 残留
PASS  S3 目标文件未被重写 (mtime 不变)
--- 场景 4：版本不同 -> 先备份再装 ---
PASS  S4 退出码 0
PASS  S4 生成了 1 份备份
PASS  S4 备份里是旧版本 0.5.6
PASS  S4 目标已升级回 0.5.7
--- 场景 5：源包校验失败 -> 非零退出、不装一半 ---
PASS  S5 退出码非 0
PASS  S5 未创建目标插件目录
PASS  S5 未产生 .staging
--- 场景 6：-Project 播种 ---
PASS  S6 退出码 0
PASS  S6 .superagent 已建
PASS  S6 roster.json 存在
PASS  S6 members 为空数组
PASS  S6 roster.json 无 BOM
PASS  S6 methods/_TEMPLATE.md 已播种
PASS  S6 lessons/_TEMPLATE.md 已播种
PASS  S6 incidents/_TEMPLATE.md 已播种
PASS  S6 STATUS.md 已播种
PASS  S6 methods 下没有成员方法论
PASS  S6 lessons 下没有成员错题本
--- 场景 7：重复播种不覆盖已有数据 ---
PASS  S7 已有 roster.json 未被覆盖
--- 场景 8：uninstall 默认移到 .trash ---
PASS  S8 退出码 0
PASS  S8 插件目录已移走
PASS  S8 .trash 下有回收目录
PASS  S8 回收目录里插件完整
PASS  S8 运行时台账默认未动
--- 场景 9：uninstall -Purge 真删 ---
PASS  S9 重装退出码 0
PASS  S9 退出码 0
PASS  S9 插件目录已真删
PASS  S9 运行时台账仍未动
--- 场景 10：uninstall -PurgeData 清台账 ---
PASS  S10 退出码 0
PASS  S10 运行时台账已清
--- 场景 11：uninstall 幂等（未安装时） ---
PASS  S11 退出码 0
==== 结果：PASS 43 / FAIL 0 ====
```

### 5.2 补充安全场景

```text
--- 场景 12：目标目录是别的插件 -> 拒绝覆盖 ---
PASS  S12 退出码非 0
PASS  S12 别人的插件目录原封不动
PASS  S12 别人的 plugin.json 未被改写
--- 场景 13：-Purge 只删插件目录，同级其它目录保留 ---
PASS  S13 正常安装退出码 0
PASS  S13 卸载退出码 0
PASS  S13 插件目录已删
PASS  S13 同级其它目录保留
--- 场景 14：安装副本的 Hook 脚本真能被 node 跑起来 ---
PASS  S14 安装副本就绪
PASS  S14 session-start.mjs 存在
PASS  S14 session-start.mjs 退出码 0
PASS  S14 输出了 SessionStart 注入
--- 场景 15：卸载后再重装（往返） ---
PASS  S15 重装退出码 0
PASS  S15 重装后插件完整
==== 补充测试：PASS 13 / FAIL 0 ====

> 修正记录：S14 起初依赖前一个脚本留下的安装副本，而前一个脚本结尾会把它卸载 ——
> 于是「单独跑 test2」会红 3 条。已改为 test2 自建安装副本，现在**四个脚本可各自独立复跑**。
> 这条修正只动测试脚本，交付的 install.ps1 / uninstall.ps1 未改。
```

### 5.3 关键过程的原始片段

**幂等（场景 3）**：

```text
== 目标现状
  [OK] 已安装版本：0.5.7

== 已是最新 —— 不重装
  [OK] 目标已是 v0.5.7，与源一致，跳过安装（没有备份、没有覆盖）
```

**版本不同先备份（场景 4）**：

```text
== 安装
  [OK] 自校验通过：28 个文件，SHA256 全部一致
  [OK] 旧版本已备份到：...\_sandbox\plugins\.backup\super-agent-router-20261111-090004
  [OK] 安装完成：...\_sandbox\plugins\super-agent-router
  [OK] 最终目录复核通过：28 个文件，SHA256 全部一致
```

**源包校验失败即中止（场景 5）**：

```text
== 源包校验
  [X] hooks.json 引用的脚本不存在：scripts/gate.mjs

  [X] 源包校验未通过（1 项）—— 已停止，没有安装任何东西。
```

**播种结果（场景 6）**：

```text
== 播种项目状态层
  [i] 已建目录：methods
  [i] 已建目录：lessons
  [i] 已建目录：incidents
  [i] 已建目录：agent-snapshots
  [OK] 已播种：methods\_TEMPLATE.md
  [OK] 已播种：lessons\_TEMPLATE.md
  [OK] 已播种：incidents\_TEMPLATE.md
  [OK] 已播种：agent-snapshots\_README.md
  [OK] 已播种：roster.json（members 为空数组 —— 默认 0 个成员）
  [OK] 已播种：STATUS.md
  [OK] 已播种：changes.log（空文件）
```

**卸载默认移到回收位（场景 8）**：

```text
== super-agent-router 卸载程序
  [OK] 已移到回收位：...\_sandbox\plugins\.trash\super-agent-router-20261111-090007

  想彻底删掉：
      Remove-Item -LiteralPath "...\_sandbox\plugins\.trash\super-agent-router-20261111-090007" -Recurse -Force
  想装回去：把上面这个目录原样搬回上面那个「插件目录」即可。
  [i] 运行时台账仍在（未动）：...\_sandbox\fakehome\.minimax\v2\plugin-data\hooks\super-agent-router
```

### 5.4 node 侧校验（22 条）

```text
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
PASS  incidents 只有 _TEMPLATE.md
PASS  安装副本文件数 === 源 (28)
PASS  安装副本逐文件 SHA256 全部一致
PASS  安装副本 plugin.json 版本 0.5.7
PASS  安装副本 plugin.json name === super-agent-router
PASS  安装副本 hooks.json 引用的 5 个脚本都在

==== node 侧校验：PASS 22 / FAIL 0 ====
```

> 播种出来的 `roster.json` 实际内容（node 读回，中文正常）：

```json
{
  "version": 1,
  "updated": "2026-11-11",
  "note": "专项名录。成员在运行时按任务需要现场配置（source=runtime），不预先预置。内置成员 source=builtin。路由时需与 mavis_agent_list 交叉核对：list 有 roster 无 -> 收编；roster 有 list 无 -> 陈旧不派工。",
  "members": []
}
```

---

## 6. 文档与实现逐字对账（25 条）

上一轮 F-08 的教训是「文档写的参数，脚本不支持」。这次把对账做成可复跑的断言。

```text
install.ps1  参数: Target, Project, VerifyOnly
uninstall.ps1 参数: Target, Purge, PurgeData
PASS  install.ps1 参数集为 Target/Project/VerifyOnly
PASS  uninstall.ps1 参数集为 Target/Purge/PurgeData
PASS  README 命令参数受支持: install.ps1 (无参数)
PASS  README 命令参数受支持: install.ps1 -Target
PASS  README 命令参数受支持: install.ps1 -Project
PASS  README 命令参数受支持: install.ps1 -VerifyOnly
PASS  README 命令参数受支持: uninstall.ps1 (无参数)
PASS  README 命令参数受支持: uninstall.ps1 -Purge
PASS  README 命令参数受支持: uninstall.ps1 -Purge -PurgeData
README 里出现的脚本命令共 7 条：
    install.ps1
    install.ps1 -Target
    install.ps1 -Project
    install.ps1 -VerifyOnly
    uninstall.ps1
    uninstall.ps1 -Purge
    uninstall.ps1 -Purge -PurgeData
... （共 25 条断言，0 FAIL）
==== README/脚本一致性：PASS 25 / FAIL 0 ====
```

---

## 7. README 改动对照

### 7.1 「## 安装」节：手工优先 → 一键优先

| | 改前 | 改后 |
|---|---|---|
| 第一个小节 | `### 普通使用者`（手工 cp -r 打头） | `### 一键安装（推荐）`（clone → 一条命令 → 新开会话） |
| 手工步骤 | 位于最前 | 降级为 `### 备选：手工复制` |
| 幂等 / 备份 / 自校验 | 无 | 写明三件事与失败即中止的语义 |
| 参数说明 | 无 | `-Target` / `-Project` / `-VerifyOnly` 逐条列出（与脚本 param 块逐字一致） |
| 播种语义 | 无 | 写明「空名录 + 三个模板」「不复制本仓库成员/方法论/错题本」「已有文件不覆盖」 |
| 开发者小节 | 原样保留 | 原样保留（未动） |

### 7.2 新增「## 卸载」节

三种命令（与脚本逐字一致）：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1              # 默认移到 .trash\，可恢复
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge       # 彻底删除插件目录
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge -PurgeData   # 连运行时台账一起清
```

并写明：默认不删 / `-Purge` 才真删且删前逐字校验 / `-PurgeData` 才清台账 /
**项目里的 `.superagent/` 一律不动** / 卸载后要新开会话。

### 7.3 目录结构补两行

```text
├── install.ps1                  # 一键安装（Windows PowerShell 5.1+）
├── uninstall.ps1                # 卸载（默认移到 .trash\，可恢复）
├── plugin/                      # 插件包（复制到 ~/.minimax/plugins/）
```

> 这一处超出「只改安装 / 卸载两节」的字面范围，理由是：新增了两个文件却不在目录结构里，
> 文档与仓库实际内容就不自洽。**除此之外 README 全文其余部分一字未动。**

---

## 8. 插件包零改动的证据

```powershell
git status --short
git diff --name-only -- plugin/
node -e "console.log(require('./plugin/.minimax-plugin/plugin.json').version)"
```

原始输出：

```text
 M README.md
?? install.ps1
?? uninstall.ps1
--- plugin/ diff ---
(空=插件包零改动)
0.5.7
```

回归（仓库副本，13 套）：

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

13 套 / 836 条 / 0 FAIL。插件包零改动 ⇒ 版本号不变 ⇒ 回归结果与 v0.5.7 发布时一致。

---

## 9. 诚实边界（别写成别的）

1. **没有在真实安装目录上跑过安装 / 卸载。**
   真实目录 `C:\Users\yang2\.minimax\plugins\super-agent-router` 仍是你已装的 v0.5.7 副本，
   全程未动 —— 沙箱用 `-Target` + 重定向 `USERPROFILE` 隔离。
   「脚本在真实机器上能跑通」这句话，证据是**沙箱实跑**，不是真实目录实跑。
2. **README 里的 `git clone <repo-url>` 是占位符。**
   仓库公开地址尚未确定（父会话统一处理），**我没有编造 URL**。
3. **只有 Windows PowerShell 版本。**
   macOS / Linux 走 README「备选：手工复制」。README 首行已写明「需要 Windows + PowerShell 5.1 或更高」。
4. **`.backup/` / `.staging/` / `.trash/` 会留在插件根目录下。**
   三个目录都以点开头且内无 `plugin.json`，正常情况下不会被当成插件；
   但「MCode 的插件扫描会不会把点开头目录也扫一遍」**本轮没有实证**，属未验证边界。
   建议：确认无误后可手动删掉这���个目录。
5. **源校验靠正则从 `hooks.json` 抽脚本名。**
   若将来 `hooks.json` 不再用 `${PLUGIN_ROOT}/scripts/<file>` 形态，校验会**保守失败**
   （报「没有解析到任何引用」并中止安装）—— 失败方向是安全的，但会挡住安装，需要同步改脚本。
6. **`install.ps1` 用的是 `plugin.json` 的 `name` 字段决定安装目录名。**
   改名会换安装目录；改名后旧目录需要手工清。
7. **`docs/audit/.tmp-release/` 被 .gitignore 的 `docs/audit/.tmp-*/` 覆盖** ⇒
   本报告与全部验证脚本**不会出现在 `git status`**，需单独转写进版本库。
8. **`-Project` 播种的状态层没有 `roster.mjs` 登记任何成员** ——
   空名录是设计（默认 0 个成员），不是漏填。
9. **仓库里的 `LICENSE`（MIT，mtime 2026-11-11T01:02:25Z）不是本单产物。**
   本单只写了 `install.ps1`、`uninstall.ps1`、根 `README.md`、本报告与验证脚本，**从未创建 LICENSE** ——
   它在本单执行期间由他人并发新增。记账时请勿算到本单头上。

---

## 10. 验收清单逐条核对

### 10.1 本单 ACCEPT

| # | 验收项 | 证据 | 判定 |
|---|---|---|---|
| 1 | `install.ps1` 存在且 `-Target` / `-Project` / `-VerifyOnly` 三参数可用 | §4 语法 OK；§5.1 场景 1/3/6 | PASS |
| 2 | 依赖检查（node 缺失则报错退出） | §5.1 全部场景输出首行「[OK] node 可用：v26.7.0」；缺失分支为 `Fail` | PASS |
| 3 | 源校验：plugin.json 存在 / name 与目录名一致 / hooks.json 引用脚本逐个存在 | §5.1 场景 2 输出「hooks.json 引用的 5 个脚本全部存在」；场景 5 缺 `gate.mjs` 即中止 | PASS |
| 4 | 任一不满足 ⇒ 非零退出、不装一半 | §5.1 场景 5：退出码非 0、目标目录未建、无 .staging | PASS |
| 5 | 幂等：版本相同报「已是最新」不重装 | §5.1 场景 3：无 .backup、无 .staging、目标 mtime 不变 | PASS |
| 6 | 版本不同先备份并打印位置 | §5.1 场景 4：备份目录含 v0.5.6，输出打印备份路径 | PASS |
| 7 | 装完自校验（文件数 + SHA256 与源一致） | §5.1 场景 2「28 个文件，SHA256 全部一致」；§5.4 逐文件比对 PASS | PASS |
| 8 | 打印「必须新开一个会话」+ 可复制验证命令 | §5.3 安装脚本收尾输出；§6 一致性检查 | PASS |
| 9 | `-Project` 播种：空名录 / STATUS.md / 三目录 + 三模板 | §5.1 场景 6（10 条断言）；§5.4（成员产物 0 个） | PASS |
| 10 | `uninstall.ps1`：默认移到 `.trash/` 并打印位置与「怎么彻底删」 | §5.1 场景 8；§5.3 原始输出 | PASS |
| 11 | `-Purge` 真删，删前确认在插件目录内、不 trim | §5.1 场景 9；§5.2 场景 12/13（跨插件保护、同级不误伤） | PASS |
| 12 | `-PurgeData` 才清运行时台账；默认不动项目 `.superagent/` | §5.1 场景 8/9/10 | PASS |
| 13 | README「## 安装」一键优先、手工降级 + 新增「## 卸载」，命令逐字一致 | §7；§6 对账 25 PASS | PASS |
| 14 | 三个 .ps1 UTF-8 with BOM | §3：`ef bb bf` × 2（脚本 ×2 份输出） | PASS |
| 15 | 未 commit / push / deploy / 改可见性；`plugin/**` 零改动 | §8：`git status` 只有 3 项，`plugin/ diff` 为空，版本仍 0.5.7 | PASS |

### 10.2 方法论《sa-plugin-release》验收清单中与本单相关的条目

| 条目 | 判定 | 说明 |
|---|---|---|
| hooks.json 引用的每个脚本在 scripts/ 下都真实存在 | PASS | install.ps1 安装前逐个查；§5.1 场景 2 输出列出 5 个脚本名 |
| README 说明安装位置、启用验证方法、故障排查路径 | PASS | 安装位置（`%USERPROFILE%\.minimax\plugins\super-agent-router`）、启用验证（新开会话 + 出现 `[super-agent-router]`）、排障（原有「怎么用」第 3 节保留） |
| 全程只改动 SCOPE 内的文件 | PASS | §8 的 `git status`：`README.md`（修改）+ 两个新 .ps1（新增）+ `docs/audit/.tmp-release/`（可写目录，已被 gitignore 覆盖） |
| plugin.json 的 version 与 CHANGELOG 一致 | 不适用 | 本单**不升版**、不改 `plugin/**`；版本仍 0.5.7，CHANGELOG 未动 |
| description 覆盖本次行为变更 | 不适用 | 同上 |
| CHANGELOG 三要素 | 不适用 | 同上（`plugin/CHANGELOG.md` 未改） |
| README 未承诺尚未实现的能力 | PASS | README 写的每条能力都有对应实跑断言；§6 对账 25 条 |

---

## 11. 给父会话的移交事项

1. **转写本报告**：`docs/audit/.tmp-release/install-v057.md` 被 gitignore 覆盖，
   需要像 `docs/audit/release-v057.md` 那样转写到正式路径。
2. **决定 `docs/audit/.tmp-release/` 里的验证脚本去留**：
   留下则第三方能一键复跑本单的 77 条断言；删掉则只剩报告里的输出。
3. **补 README 的 clone 地址**：`git clone <repo-url>` 需要替换成真实公开地址。
4. **commit / push / 可见性**：本单一律未做，由父会话统一执行。
5. **可选**：确认 `.backup/` / `.staging/` / `.trash/` 不会被 MCode 插件扫描误认（§9 第 4 条）。
6. **别把 `LICENSE` 记到本单账上** —— 它不是本单产物（§9 第 9 条）。
