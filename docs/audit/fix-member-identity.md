# 成员持久身份口径 · 交付报告

- 单号：成员持久身份口径（S16 落地为机器可查的东西）
- 日期：2026-11-12
- 判据的唯一出处：`plugin/skills/super-agent-router/references/contract.md` 的 **S16**（本单只把它落成可执行的检查，**不改协议**）
- 新增检查器：`tools/member-identity-check.mjs`
- 新增回归套件：`tests/member-identity-test.mjs`（45 条断言）
- 变异矩阵定义：`tests/fixtures/member-identity-mutation-matrix.md`（执行器 `tests/fixtures/member-identity-mutation-matrix.mjs`）
- 报告落点：`docs/audit/fix-member-identity.md`（正式路径由父会话转写）

> ⚠️ **本文件记录的是第一轮（R1）**。第二轮（R2）已把判据对齐契约 S16 新增的规则 5 / 6 / 7，
> 特征表从 9 条扩到 **11 条**、断言从 45 条扩到 **64 条**、变异体从 6 个扩到 **19 个**。
> R2 报告：`docs/audit/fix-member-identity-r2.md`（入库副本，含契约行号 ↔ 实现位置 ↔ 实测输出逐条对照；
> 父会话指定路径的同一份在 `docs/audit/.tmp-member-identity/member-identity-report-r2.md`，该目录被 .gitignore）。
> 本文件下面出现的「9 条特征 / 45 条断言」是 R1 的历史数字，**不代表当前实现**。

---

## 0. 结论摘要

| 事项 | 结果 |
|---|---|
| 检查器 | `tools/member-identity-check.mjs`：扫项目级 roster + 账号级 agent.md，禁止特征做成**可枚举的表**（9 条：特征 → 正则 → 为什么禁） |
| 专属断言 | `tests/member-identity-test.mjs`，**45 条**（规则表 5 / 不得误报 8 / 每条特征 12 / 名录 5 / 输出形态 5 / 跳过语义 5 / 边界 4） |
| 合成夹具 | `tests/fixtures/member-identity/`：干净 1 份、脏 4 份（脏 / 只有版本号 / 只有非版本类 / 只有中文文件名）、名录 2 份（干净 / 脏） |
| 语义变异体 | **6 个，MISS=0**（每个都被自己的专属锚点抓住） |
| 常驻回归 | `tools/run-tests.mjs --all` **自动发现**，套件 15 → **16 套**，全绿 |
| 真实账号目录 | **未扫**（工作区外，本单不读家目录）⇒ 取证请求见 §6 |

---

## 1. 检查器：判据与口径

### 1.1 扫两处持久层

| 层 | 扫什么 | 判定对象 |
|---|---|---|
| 项目级 | `.superagent/roster.json` 里 `source == 'runtime'` 的成员字段 | `created_for`（必查）、`owns`、`accepts`、`reject`、`method` |
| 账号级 | `<账号成员目录>/<名>/agent.md` 的 **description 与正文** | 整个文件（形态容忍：YAML front matter 与裸 Markdown 都认；认不出就全算正文 —— **宁可多报区域，也不漏报命中**） |

账号成员目录的定位口径**与 `plugin/scripts/lib.mjs` 的 `accountAgentsRoot()` 完全一致**
（`SAR_ACCOUNT_AGENTS_DIR` → 否则 `<用户主目录>/.minimax/agents`），不另造一套 ——
两处各写各的，迟早分叉。隐藏目录（`.builtin/` 等宿主自带成员）不扫。

### 1.2 禁止特征表（可枚举，9 条）

```
tools/member-identity-check.mjs  FEATURE_SPECS → FORBIDDEN_FEATURES
  abs-path               盘符绝对路径            [A-Za-z]:[\\/]…      （前置否定环视：URL 的 "s:/" 不算盘符）
  must-read-non-method   开工前必读的非方法论路径   开工前必须先读 <非 .superagent/…>
  numbered-file          带编号前缀的具体文件      00_共用事实底稿.md
  cn-deliverable-file    中文交付物文件名          素材底稿说明.md
  project-title          书名号项目名            《…》
  batch-no               批次 / 实验编号          实验一
  version                版本号                  v0.3.2（日期 2026.11.12 不算）
  defect-id              缺陷编号                D-88
  one-off-wording        一次性措辞              本次任务 / 这次要交付 / 任务书在
```

每条都带 `why`（为什么禁），命中时**原样打印**给读者看。特征按「同组互相抑制」处理：
`numbered-file` 与 `cn-deliverable-file` 同属 `file-name` 组 ⇒ 同一个文件名只报一次；
不同组不抑制（一个短语踩了两条特征，两条都报）。

### 1.3 不得误报（已逐条断言）

| 合法内容 | 为什么合法 | 断言 |
|---|---|---|
| `.superagent/methods/<名>.md`、`.superagent/lessons/<名>.md` | 方法论 / 错题本路径 = 「这类活怎么做」 | MI-B3 |
| `开工前必须先读 .superagent/methods/x.md`（bootstrap 模板原句） | 同上；`must-read-non-method` 用前置否定环视放过它 | MI-B3 |
| `plugin/skills/…/contract.md`、`docs/audit/defect-ledger.md` | 仓库相对路径 | MI-B4 |
| `sa-image-design`、`sa-aigc-text` | 兄弟成员的**稳定名** | MI-B5 |
| `https://example.com/…` | URL 不是盘符路径 | MI-B7 |
| `2026.11.12` | 日期不是版本号 | MI-B8 |

### 1.4 退出码（诚实边界）

| 码 | 含义 |
|---|---|
| 0 | 无残留；**或**账号目录不可用（打印「跳过：账号成员目录不可用」，**不打印「通过」** —— 那是把「没查」说成「查过了」） |
| 1 | 命中残留 |
| 2 | 用法错误（参数缺值即拒绝 —— 静默忽略一个写坏的参数 = 这次扫描的**范围**与用户以为的不一样） |
| 3 | 名录读不到 / 不是合法 JSON ⇒ **判据不可信，拒绝**（不放行） |

「跳过」**不等于**放行：账号目录不可用时，名录脏仍然红（MI-F5）。

---

## 2. 合成夹具与专属断言

```
tests/fixtures/member-identity/
  roster/clean.json              干净名录（3 名成员，2 名 runtime）
  roster/dirty.json              脏名录（created_for 写任务原文、accepts 写「本次任务」）
  agents/clean/sa-image-design/agent.md      干净成员（description + 正文，含方法论路径/兄弟名/仓库相对路径）
  agents/dirty/sa-aigc-text/agent.md         脏成员（9 条特征全触发，15 处命中）
  agents/version-only/sa-pack/agent.md       只有版本号残留
  agents/nonversion/sa-media/agent.md        只有非版本类残留（盘符路径 + 编号文件 + 一次性措辞）
  agents/cn-file/sa-cn/agent.md              只有中文交付物文件名残留
  agents/empty/                             账号目录可用但没有成员
```

断言按「每条特征一条专属断言」组织：MI-A（规则表 5 条）、MI-B（不得误报 8 条）、
**MI-C（脏账号目录 13 条，每条禁止特征各有一条）**、MI-D（脏名录 5 条）、
MI-E（输出形态 5 条）、MI-F（跳过语义 5 条）、MI-G（边界 4 条），共 **45 条**。

**一条关键的计数纪律**：断言详情里会带子进程（检查器）的原始输出，若原样打印，
它的 `FAIL …` 行会**独立成行** ⇒ 被行式扫描器（`tools/run-tests.mjs` 与本单的变异矩阵执行器）
**误记成套件失败**。本套件的 `ok()` 把详情里的换行压成 ` | ` —— 这不是洁癖，是**计数正确性**的前提
（第一版矩阵跑出 M-MId=MISS 时才暴露出来）。

---

## 3. 语义变异体矩阵

`tests/fixtures/member-identity-mutation-matrix.md`（定义，逐字固定）+ `.mjs`（执行器，串行）。

| 变异体 | 退化语义 | 专属锚点 | 实测 |
|---|---|---|---|
| M-MIa | 完全不检查（检测循环清空） | MI-C1 | EXTRA-RED(22) |
| M-MIb | 只查版本号、放过其它 | MI-C12 | EXTRA-RED(15) |
| M-MIc | 账号目录不可用也判失败 | MI-F1 | 恰好红一条 |
| M-MId | 命中项不报原文 | MI-E3 | 恰好红一条 |
| M-MIe | 命中项不报行号 | MI-E2 | 恰好红一条 |
| M-MIf | 名录不查 `created_for` | MI-D2 | EXTRA-RED(1) |

**MISS=0，EXTRA-RED 合计 38。** M-MIa / M-MIb 的 EXTRA-RED 大是**同族断言的正常牵连**
（前者打掉整个检测、后者打掉规则表的覆盖面），不是漏网。

---

## 4. 接入常驻回归

- `tools/run-tests.mjs` 是**自动发现**（`discoverSuites()` 扫 `tests/*-test.mjs`）⇒
  **本单没有改它一行**：新套件自动进 `--all`，套件数 15 → **16**。
- **断言条数的机器标记没有加**：`ASSERTION-COUNT:` 是 `tools/install-selftest/` 那 7 个套件的约定
  （`check-readme-consistency.mjs` 只对 `SUITE_FILES` 里那 7 个断言），`tests/` 下的套件
  （含上一单的 `zero-debt-test.mjs`）**从来不带这个标记** ⇒ 加了就是造第二套口径。
- **真实账号目录的扫描不进常驻回归**：它依赖本机状态，别的机器 / CI 会缺目录 ⇒ 用合成夹具，
  真实路径由父会话单独取证（§6）。

---

## 5. 完整输出

### 5.1 `node tools\run-tests.mjs --all --root plugin --repo .`

```
﻿REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=70 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=58 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT fix-d80-d85-test exit=0 pass=49 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=41 fail=0
RESULT ledger-test exit=0 pass=29 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT loop-gate-test exit=0 pass=67 fail=0
RESULT member-identity-test exit=0 pass=45 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
RESULT zero-debt-test exit=0 pass=61 fail=0
>>> SHELL ALL PASS
```

留档：`docs/audit/.tmp-member-identity/run-tests-all-output.txt`。

### 5.2 变异矩阵复现（MISS=0）

```
﻿基线：pass=45 fail=0 exit=0
M-MIa [S16] 完全不检查（检测循环被清空）：套件 pass=22 fail=23 专属锚点红=是 EXTRA-RED=22 总红数=23 判定=EXTRA-RED(22)
M-MIb [S16] 只查版本号、放过其它：套件 pass=29 fail=16 专属锚点红=是 EXTRA-RED=15 总红数=16 判定=EXTRA-RED(15)
M-MIc [S16] 账号目录不可用也判失败（把「没查」当成「查出不干净」）：套件 pass=44 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MId [S16] 命中项不报原文（人看不出该删什么）：套件 pass=44 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIe [S16] 命中项不报行号（人定位不到该删哪一行）：套件 pass=44 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIf [S16] 名录不查 created_for（能力化表述那条规矩的主战场失守）：套件 pass=43 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=38
```

留档：`docs/audit/.tmp-member-identity/mi-mutation-output.txt`。

### 5.3 检查器三态（合成夹具）

```
# 脏目录 ⇒ 红（退出码 1，15 处命中）
成员持久身份口径检查（契约 S16）
FAIL 命中 15 处任务专属残留（持久层只放通用能力，契约 S16）：
  1. <账号成员目录>/sa-aigc-text/agent.md:3
     原文：《人工智能导论》
     特征：project-title · 书名号项目名（区域：description）
     为什么禁：《…》是某一个具体项目的名字，属于一次性层。
  …
  4. <账号成员目录>/sa-aigc-text/agent.md:18
     原文：Q:\教学\人工智能导论\任务书\
     特征：abs-path · 盘符绝对路径（区域：正文）
     为什么禁：工作区路径钉进持久层 = 成员下次照着去找一个已不存在的位置；账号级文件对所有项目可见，还会泄漏别的项目的目录结构。
  …
  13. <账号成员目录>/sa-aigc-text/agent.md:20
     原文：v0.3.2
     特征：version · 版本号（区域：正文）
     为什么禁：版本号是一次性交付物的时间坐标；写进持久层会让成员以为自己只支持那个版本。
>>> 成员持久身份口径检查不通过（15 处残留）

# 干净目录 ⇒ 绿（退出码 0）
>>> 成员持久身份口径检查通过（0 处残留）

# 账号目录不存在 ⇒ 退出码 0 + 如实说明「没查」
跳过：账号成员目录不可用（账号成员目录读不到：ENOENT: …）—— 账号级残留**本次未检查**（这不是「通过」）。
>>> 项目级名录无残留；账号级未检查

# 参数缺值 ⇒ 退出码 2（不许静默忽略一个写坏的参数：范围错了结论就错了）
用法错误：--agents-dir 需要一个路径参数
用法：node tools/member-identity-check.mjs [--agents-dir <path>] [--roster <path>] [--json]
```

留档：`docs/audit/.tmp-member-identity/checker-三态输出.txt`。

---

## 6. 取证请求（请父会话执行）

本单**没有**读账号目录（工作区外，护栏会拦；且账号目录是本机状态，不是仓库资产）。
请父会话在**真实账号目录**上执行并留存输出：

```
node tools\member-identity-check.mjs
```

预期：对 `sa-aigc-text` / `sa-image-design` / `sa-media-pack` 三个成员报出
「盘符绝对路径 / 带编号前缀的具体文件 / 书名号项目名 / 批次编号 / 一次性措辞」等残留，
退出码非 0，并把每处落到**文件 + 行号 + 原文 + 特征**。
若某个成员其实不脏（提示词已被改过），它不该出现在命中列表里 —— 这也是本检查器的**反向证据**。

留档建议：`docs/audit/.tmp-member-identity/real-agents-scan.txt`。

---

## 7. 诚实边界（本单没做到什么）

1. **只覆盖本机已存在的成员文件**：新建成员时提示词写没写对，仍由建员者与独立验收把关
   （契约 S16 的原话，本单不扩大）。
2. **只扫 `agent.md`**：成员目录下的其它 `.md` 文件不扫（本单按契约 S16 的口径只认这一个文件）。
   若宿主把系统提示词拆到别的文件里，本检查器会**漏** —— 属待验证项，不是已知结论。
3. **账号目录不可用时只查名录**：退出码 0，但结论行明写「账号级未检查」。
4. **规则是词法级的**：判据是「特征 → 正则」，不是语义理解。漏网形态（例如用别的说法指代同一个项目）
   **查不出来** —— 本检查器只保证「已知的这 9 类残留一定会被报出来」，不保证「持久层里一定没有任务内容」。
5. **三个新成员的真实内容未取证**（§6）。

---

## 8. 本单新发现（用「本单新增-XX」临时叫法，父会话统一分配 `D-` 号）

| # | 现象 | 性质 | 处理 |
|---|---|---|---|
| 本单新增-01 | 上一单的 `tests/zero-debt-test.mjs` 把子套件原始输出**带换行**内嵌在断言详情里 ⇒ 它的 `FAIL  …` 行理论上能独立成行，被 `tools/run-tests.mjs` 的行式扫描误记成套件失败。当前**未触发**（被内嵌的 tail 里恰好没有 FAIL 行），属同类隐患 | 潜在 | **未改**（该文件在本单受保护清单里），仅记录；本单自己的套件已用「详情压换行」的做法规避 |
| 本单新增-02 | 根 README 的「十四套回归测试」在上一单加套件后已与实际（15 套）不符 | 文档漂移 | 本单一并订正为「十六套」（3 处）+ 工装树补一行 `member-identity-check.mjs`；`check-readme-consistency.mjs` 仍 **144 PASS / 0 FAIL** |
| 本单新增-03 | `docs/super-agent-router-workflow.html` 里写着「14 套 · 十四套 897 条断言 0 FAIL」，同样已漂移 | 文档漂移 | **未改**（该文件在本单 SCOPE 之外，SCOPE 只有 `docs/audit/`），留给父会话转写 |

---

## 9. 完工自查

| # | 项 | 结果 |
|---|---|---|
| 1 | `node tools\run-tests.mjs --all --root plugin --repo .` 全绿 | ✅ 16 套件（比上一单 +1），全 PASS / 0 FAIL，退出码 0 |
| 2 | 检查器三态 | ✅ 脏目录 ⇒ 退出码 1；干净夹具 ⇒ 退出码 0；目录不存在 ⇒ 退出码 0 且输出「跳过：账号成员目录不可用」 |
| 3 | 变异体 MISS=0 | ✅ 6 个变异体全部被自己的锚点抓住（EXTRA-RED 合计 38） |
| 4 | 上一单文件逐字未动 | ✅ 全部 mtime **早于本单开始**（最新 21:25:50 是父会话改的 roster/契约，非本单）；`plugin/scripts/loop-gate.mjs` 与 `tests/loop-gate-test.mjs` 的 sha256 与上一单报告记录值**逐字一致**（`f64efc26…fec5` / `6958fbb7…fe14c`） |
| 5 | 报告齐全 | ✅ 本文（完整输出 + 矩阵 + 取证请求） |

**本单改动文件清单**

| 文件 | 性质 |
|---|---|
| `tools/member-identity-check.mjs` | **新增**：检查器（禁止特征表 + 两处扫描 + 退出码口径） |
| `tests/member-identity-test.mjs` | **新增**：45 条专属断言 |
| `tests/fixtures/member-identity/**` | **新增**：合成夹具（干净/脏/按特征分类 + 名录两份） |
| `tests/fixtures/member-identity-mutation-matrix.md` | **新增**：变异矩阵定义（锚点/改法/期望红哪条/判定口径） |
| `tests/fixtures/member-identity-mutation-matrix.mjs` | **新增**：变异矩阵执行器（串行，字节级副本） |
| `README.md` | **改动 4 行**：3 处「十四套」→「十六套」+ 工装树补一行 `member-identity-check.mjs` |

**未改**：`contract.md`、`bootstrap.md`、`teams.md`、`.superagent/roster.json`（父会话在改，我只读）；
上一单的全部实现与断言（`plugin/scripts/{loop-gate,guard,dispatch,lib}.mjs`、`plugin/hooks/hooks.json`、
`tools/ledger-check.mjs`、`tests/zero-debt-test.mjs`、`tests/hooks-test.mjs`、`tests/fixtures/zero-debt-*`）。
未 commit / push / tag / Release / 改仓库可见性；未新建或修改成员；新缺陷未自编号。
