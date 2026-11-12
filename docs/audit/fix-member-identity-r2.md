# 成员持久身份口径检查器 · 第二轮交付报告（契约 S16 规则 5 / 6 / 7）

> **落点说明**：本文件是 `docs/audit/.tmp-member-identity/member-identity-report-r2.md` 的**入库副本**。
> `docs/audit/.tmp-*/` 在 .gitignore 里（.gitignore:31）⇒ 临时目录里的报告与原始输出**不进版本库**；
> 报告正文里的实测输出已**逐字内嵌**，所以入库这份即可复现结论，原始归档留在临时目录备查。
- 时间：2026-11-12（收尾轮：父会话裁决已落契约后重出）
- 执行：本单成员（编排机制边界判定改造专项）
- 唯一事实源：plugin/skills/super-agent-router/references/contract.md 的 S16（协议由父会话写好，本单只实现、不改协议）
- 判据表唯一出处：tools/member-identity-check.mjs 的 FEATURE_SPECS + 三张配套表

## 0. 本单一句话

第一轮把「成员的持久身份只放通用能力」变成了机器能查的东西，但**判据没有对齐契约 S16 的规则 5/6/7**：
在真实账号目录上把 9 个成员的持久提示词扫出 **14 处命中**，逐条核对原文后发现**全是误报** ——
9 处是 front matter 里的宿主配置字段（`x-mavis.defaultWorkspaceDir: Q:\…`），
5 处是「这次做哪几个实验、要交付哪些文件，一律由 brief 决定」这类**合规让渡句**。

本轮把判据逐条对齐规则 5/6/7，并在**父会话裁决落契约后**补齐了两处欠账。当前状态：

- **真实账号目录扫描 = 退出码 0、零命中**（14 处误报全部消失，且没有把真残留一起放过）；
- **改前快照目录扫描 = 退出码 1、8 处命中**，且**逐条精确指向** `工具\aigc_tts.py` 这类真残留；
- 旧脏夹具仍判红，**9 类特征一条不少**；全量回归 16 套件全绿（本套件 **64** 条断言）；
- 变异矩阵 **19 个变异体、MISS=0**；每条新判据都有**专属断言 + 一个能被证伪的专属变异体**。

## 1. 改了什么 / 没改什么

| 文件 | 性质 | 改动 |
|---|---|---|
| `tools/member-identity-check.mjs` | 改写 + 收尾修正 | 三张可枚举判据表（宿主配置键 / 让渡标记 / 路径豁免）+ 两类新特征（relative-path、concrete-file）+ 区域判定（规则 5）+ 让渡句判定（规则 6）+ 片段级路径判据（规则 7）；**收尾轮**：仓库自有资产豁免收紧到「无目录段」、代码注释逐条指到契约行号 |
| `tests/member-identity-test.mjs` | 改 | 断言 45 → **64** 条；H 段 **MI-H1 ~ MI-H14**（每条新判据一条专属断言）+ 4 条表形态断言 |
| `tests/fixtures/member-identity/**` | 增 | **12** 个夹具目录（第一轮 5 + 本轮 10 + 收尾轮 2：unknown-key / repo-asset-path），共 17 个 agent.md |
| `tests/fixtures/member-identity-mutation-matrix.mjs` | 改 | 变异体 6 → **19**；新增 `--emit-md`（定义文件与执行器逐字同源）；复制清单加 `plugin/`（判定依赖仓库文件清单） |
| `tests/fixtures/member-identity-mutation-matrix.md` | 改 | 19 个变异体的定义 + 实测结果（三列分开报） |
| `docs/audit/.tmp-member-identity/member-identity-report-r2.md` | 增 | 本文件（父会话指定路径） |
| `docs/audit/fix-member-identity-r2.md` | 增 | 本文件的入库副本（`docs/audit/.tmp-*/` 在 .gitignore:31，不进版本库） |

**没改**（协议与别人的地盘）：

- `contract.md`（S16 规则 5/6/7 及其裁决由父会话写好，本单只实现，**一个字没动**）
- `bootstrap.md` / `teams.md` / `.superagent/roster.json` / `docs/audit/defect-ledger.md`
- 账号级 `~/.minimax/agents/**` 下任何文件（本单只**读**，不写）
- `plugin/scripts/**`（guard / lib / dispatch / watchdog / session-start / gate 一律没碰）
- 没有 commit / push / tag / Release，没有改版本号，没有改仓库可见性

## 2. 逐条判据：契约出处 → 实现位置 → 实测输出

> **契约行号已按父会话本轮插入重新计算**（本报告里的行号是**当前** contract.md 的行号）：
> 规则 1 = 863｜规则 5 = **867-874**（未知键 fail-closed 小节 = **872-874**）｜规则 6 = **875-877**｜
> 规则 7 = **878-886**（仓库自有资产小节 = **883-886**）｜机器校验 = **888-892**｜诚实边界 = **894-899**。

### 规则 5（contract.md:867-874）判定区域 = 提示词本体

| 判据 | 契约出处 | 实现位置 | 专属断言 | 专属变异体 |
|---|---|---|---|---|
| R5-1 front matter 的宿主配置字段（`name` / `displayName` / `x-mavis.defaultWorkspaceDir` / `model` / `effort`）**不参与残留判定** | contract.md:867-871 | tools/member-identity-check.mjs:89-99（`HOST_CONFIG_KEYS`）、:511-525（`regionForKey` / `isHostConfigKey`）、:527-540（`scanAgentFile` 跳过 host-config 行） | MI-H1 | M-MIg |
| R5-2 front matter 里**只有** `description` 参与判定（description 里写盘符路径仍要报红） | contract.md:871 | tools/member-identity-check.mjs:472-509（`classifyAgentLines`） | MI-H2 | M-MHh |
| R5-3 front matter **未闭合** ⇒ 无法判定结构 ⇒ 全文按正文扫（fail-closed，不静默放过） | contract.md:867-871 + :894-899 | tools/member-identity-check.mjs:478-480 | MI-H3 | M-MHi |
| R5-4 **未知键按 fail-closed 处理**：未列入宿主配置表的 front matter 键**照常参与判定**（判据 = 「该键不在 `HOST_CONFIG_KEYS` 表里」，不是「只跳过那五种已知字段」） | contract.md:872-874 | tools/member-identity-check.mjs:511-518（`regionForKey`：不在表里 ⇒ 落 front-matter 区域 ⇒ 参与扫描）、:520-525（`isHostConfigKey` 只认表内键） | MI-H13 | M-MIr |

实测（规则 5 的四个夹具逐条结果）：

| 夹具 | 判据 | 实测命中 | 期望 / 结论 |
|---|---|---|---|
| `host-config` | R5-1 宿主配置字段不参与判定 | 0 处 | 零命中（defaultWorkspaceDir 的盘符路径与 model 的斜杠都不报） |
| `desc-path` | R5-2 只有 description 参与判定 | 2 处：abs-path@description :: Q:\教学\人工智能导论\任务书\ / one-off-wording@description :: 任务书在 | description 里的盘符路径报红 |
| `unclosed-fm` | R5-3 front matter 未闭合 ⇒ fail-closed 全扫 | 1 处：abs-path@正文 :: Q:\临时赶时间项目\路由器 | 宿主配置行里的路径被扫到 ⇒ 报红 |
| `unknown-key` | R5-4 未知键按 fail-closed 处理 | 1 处：abs-path@front-matter :: Q:\教学\人工智能导论\任务书\ | 未知键 taskPath 里的盘符路径报红（区域 front-matter） |

> MI-H4（`classifyAgentLines` 的区域分类单测）是**同族连带断言**：它被 M-MIg / M-MHh 连带打红，
> 但不是任何一条判据的专属锚点 —— 如实标注，不冒充专属断言。

### 规则 6（contract.md:875-877）让渡句不算残留，但让渡句不豁免具体标识

| 判据 | 契约出处 | 实现位置 | 专属断言 | 专属变异体 |
|---|---|---|---|---|
| R6-1 让渡句（「由 brief 决定 / 由 brief 给出 / 路径随任务变」）里的**一次性措辞**不算残留 | contract.md:875-876 | tools/member-identity-check.mjs:103-108（`DELEGATION_MARKERS`）、:388-409（句界 + 让渡判定）、:445-449（只对 `suppressibleByDelegation` 生效） | MI-H5 | M-MHj |
| R6-2 让渡句**不豁免具体标识**：同一句里的路径 / 文件名 / 版本号照判 | contract.md:877 | tools/member-identity-check.mjs:445-449（豁免只挂在 `one-off-wording` 一条特征上） | MI-H6 | M-MHk |

实测：

| 夹具 | 判据 | 实测命中 | 期望 / 结论 |
|---|---|---|---|
| `delegation` | R6-1 让渡句里的「一次性措辞」不算残留 | 0 处 | 零命中（由 brief 决定 / 由 brief 给出 / 路径随任务变 三种让渡句都被认出来） |
| `delegation-id/sa-delegation-id` | R6-2 让渡句不豁免具体标识 | 3 处：abs-path@正文 :: Q:\教学\人工智能导论\任务书\ / relative-path@正文 :: 工具\aigc_tts.py / version@正文 :: v0.3.2 | 路径/相对路径/版本号照报，且同句的一次性措辞不报 |

### 规则 7（contract.md:878-886）具体标识覆盖脚本与相对目录；豁免仓库相对引用、方法论 / 错题本路径与仓库自有资产

| 判据 | 契约出处 | 实现位置 | 专属断言 | 专属变异体 |
|---|---|---|---|---|
| R7-1 具体标识**覆盖脚本与配置文件名**（.py/.mjs/.js/.ts/.sh/.ps1/.bat/.json/.yml/.yaml 同样算文件名） | contract.md:878-879 | tools/member-identity-check.mjs:246-252（`concrete-file` 特征）、:360-374（`classifySpan`）、:382-384（`isConcreteFileName`） | MI-H7 | M-MIl |
| R7-2 带目录段的**相对路径**同样算具体路径（`工具\aigc_tts.py`、`工具\`） | contract.md:880 | tools/member-identity-check.mjs:220-226（`relative-path` 特征）、:360-380 | MI-H8 | M-MIm |
| R7-3 **豁免仓库相对引用**（`plugin/ docs/ tests/ tools/ .superagent/` 开头且不含盘符） | contract.md:881-882 | tools/member-identity-check.mjs:121（`repo-relative`）、:428 / :443（豁免检查） | MI-H9 | M-MIn |
| R7-4 **豁免通配形态**（`*.receipt.json` 指向的是「一类文件」，不是某一个） | contract.md:878-879（「具体文件名」要求指向某一个具体文件） | tools/member-identity-check.mjs:122 | MI-H10 | M-MIo |
| R7-5 自然语言里的斜杠枚举（`编造年代/日期/参数/引文/访问记录`、`HTMT/AVE/CR`、`用代码/PIL`）**不是**具体路径 | contract.md:878-882 + :894-899（词法级判据的诚实边界） | tools/member-identity-check.mjs:360-380（必须「含扩展名或以分隔符结尾」才算路径） | MI-H11 | M-MIp |
| R7-6 **豁免仓库自有资产**：**裸文件名（无目录段）**若在本仓库内**确实存在同名文件** ⇒ 不算「本次任务的」具体文件名（判定依据是「文件是否真实存在」，**不另抄名单**） | contract.md:883-886 | tools/member-identity-check.mjs:123（`repo-own-asset` 豁免项）、:128-159（`repoAssetIndex` 现场遍历仓库真实存在的文件名集合）、:156-163（`isRepoAsset`） | MI-H12 | M-MIq |
| R7-6b 上一条豁免**只给无目录段的裸文件名**：带目录段的相对路径（末段与仓库同名）**照判** | contract.md:883 | tools/member-identity-check.mjs:165-167（`isBareFileName`） | MI-H14 | M-MIs |

实测（规则 7 的六个夹具逐条结果）：

| 夹具 | 判据 | 实测命中 | 期望 / 结论 |
|---|---|---|---|
| `script-path` | R7-1 / R7-2 脚本名与带目录段的相对路径 | 2 处：relative-path@正文 :: 工具\ / concrete-file@正文 :: wordcount.py | 两者都报红 |
| `wildcard` | R7-4 通配形态豁免 | 0 处 | 零命中（*.receipt.json 不报） |
| `natural-sep` | R7-5 自然语言斜杠枚举不是路径 | 0 处 | 零命中（编造年代/日期/参数… 等都不报） |
| `repo-rel` | R7-3 仓库相对引用豁免 | 0 处 | 零命中（plugin/ docs/ tests/ tools/ .superagent/ 都不报） |
| `repo-asset` | R7-6 仓库自有资产豁免（裸文件名） | 0 处 | 零命中（lib.mjs 在仓库内确实存在同名文件） |
| `repo-asset-path` | R7-6b 豁免只给无目录段的裸文件名 | 1 处：relative-path@正文 :: 工具\contract.md | 带目录段的 工具\contract.md 照报 |

### 机器校验要求（contract.md:888-892）

| 要求 | 实现 | 断言 |
|---|---|---|
| 判据表只有一份 | `FEATURE_SPECS`（11 条特征）+ `HOST_CONFIG_KEYS`（6）+ `DELEGATION_MARKERS`（4）+ `PATH_EXEMPTIONS`（4） | MI-A1~A6、MI-H0、MI-H0b、MI-H0c |
| 每条新判据都有专属断言 | 14 条（MI-H1 ~ MI-H14），每条只盯一条判据 | — |
| 每条新判据都有一个**能被证伪的变异体** | 14 个新变异体（M-MIg ~ M-MIs），锚点原文落在仓库里（.mjs 的 MUTANTS 数组 + .md 由它导出） | 矩阵 MISS=0 |

## 3. 实测输出原文

### 3.1 真实账号目录扫描（退出码 0、零命中）

命令：`node tools/member-identity-check.mjs`（默认定位 = `lib.mjs` 的 `accountAgentsRoot()`）

```
成员持久身份口径检查（契约 S16）
名录：C:\Users\yang2\Documents\MiniMax\mini code的插件\.superagent\roster.json（8 名成员，其中 source=runtime 的 5 名）
账号成员目录：C:\Users\yang2\.minimax\agents（9 个成员：sa-aigc-text、sa-context-trace、sa-factor-validate、sa-gate-integrity、sa-image-design、sa-mechanism-fix、sa-media-pack、sa-orchestration-audit、sa-plugin-release）
>>> 成员持久身份口径检查通过（0 处残留）
```

退出码：**0**（实测）。命中：**0** 处。9 个成员全部扫到（不是「没查」）。

### 3.2 改前快照目录扫描（退出码 1、命中精确指向真残留）

命令：`node tools/member-identity-check.mjs --agents-dir docs/audit/.tmp-member-identity/agents-before`

```
成员持久身份口径检查（契约 S16）
名录：C:\Users\yang2\Documents\MiniMax\mini code的插件\.superagent\roster.json（8 名成员，其中 source=runtime 的 5 名）
账号成员目录：C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-member-identity\agents-before（9 个成员：sa-aigc-text、sa-context-trace、sa-factor-validate、sa-gate-integrity、sa-image-design、sa-mechanism-fix、sa-media-pack、sa-orchestration-audit、sa-plugin-release）
FAIL 命中 8 处任务专属残留（持久层只放通用能力，契约 S16）：
  1. <账号成员目录>/sa-aigc-text/agent.md:21
     原文：工具\
     特征：relative-path · 带目录段的相对路径（区域：正文）
     为什么禁：规则 7：带目录段的相对路径（如 工具\aigc_tts.py）同样是「具体路径」——它指向那一单的产物，钉进持久层 = 钉死那一单。
  2. <账号成员目录>/sa-aigc-text/agent.md:21
     原文：wordcount.py
     特征：concrete-file · 具体文件名（脚本 / 配置 / 文档）（区域：正文）
     为什么禁：规则 7：具体文件名不限于文档类 —— .py/.mjs/.js/.ts/.sh/.ps1/.bat/.json/.yml/.yaml 同样算「具体文件名」。
  3. <账号成员目录>/sa-image-design/agent.md:21
     原文：工具\aigc_image.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
     为什么禁：规则 7：带目录段的相对路径（如 工具\aigc_tts.py）同样是「具体路径」——它指向那一单的产物，钉进持久层 = 钉死那一单。
  4. <账号成员目录>/sa-image-design/agent.md:21
     原文：工具\seam_check.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
     为什么禁：规则 7：带目录段的相对路径（如 工具\aigc_tts.py）同样是「具体路径」——它指向那一单的产物，钉进持久层 = 钉死那一单。
  5. <账号成员目录>/sa-image-design/agent.md:21
     原文：receipt.json
     特征：concrete-file · 具体文件名（脚本 / 配置 / 文档）（区域：正文）
     为什么禁：规则 7：具体文件名不限于文档类 —— .py/.mjs/.js/.ts/.sh/.ps1/.bat/.json/.yml/.yaml 同样算「具体文件名」。
  6. <账号成员目录>/sa-media-pack/agent.md:21
     原文：工具\aigc_tts.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
     为什么禁：规则 7：带目录段的相对路径（如 工具\aigc_tts.py）同样是「具体路径」——它指向那一单的产物，钉进持久层 = 钉死那一单。
  7. <账号成员目录>/sa-media-pack/agent.md:21
     原文：工具\make_cards.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
     为什么禁：规则 7：带目录段的相对路径（如 工具\aigc_tts.py）同样是「具体路径」——它指向那一单的产物，钉进持久层 = 钉死那一单。
  8. <账号成员目录>/sa-media-pack/agent.md:21
     原文：工具\make_shortfilm.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
     为什么禁：规则 7：带目录段的相对路径（如 工具\aigc_tts.py）同样是「具体路径」——它指向那一单的产物，钉进持久层 = 钉死那一单。
>>> 成员持久身份口径检查不通过（8 处残留）
```

退出码：**1**（实测）。命中 **8** 处，逐条核对：`工具\`、`wordcount.py`、`工具\aigc_image.py`、
`工具\seam_check.py`、`receipt.json`、`工具\aigc_tts.py`、`工具\make_cards.py`、`工具\make_shortfilm.py` ——
**全部是真残留**（都是那一单的产物路径），**没有一条是宿主配置字段或让渡句**。

对照第一轮同一目录的扫描结果（14 处命中）⇒ 14 → 8：
消失的 14 处里，9 处是 front matter 宿主配置字段、5 处是合规让渡句 —— **两类误报全部消失**；
同时规则 7 点名的脚本名 / 相对目录**一条不漏**地报了出来（第一轮根本没报）。

### 3.3 旧脏夹具仍判红，9 类特征一条不少

旧脏夹具（tests/fixtures/member-identity/agents/dirty）+ 中文文件名夹具（cn-file）实测：15 + 1 处命中，9 类特征。

| # | 特征 id | 标题 | 命中条数 |
|---|---|---|---|
| 1 | `abs-path` | 盘符绝对路径 | 1 |
| 2 | `must-read-non-method` | 开工前必读的非方法论路径 | 1 |
| 3 | `numbered-file` | 带编号前缀的具体文件 | 2 |
| 4 | `cn-deliverable-file` | 中文交付物文件名 | 1 |
| 5 | `project-title` | 书名号项目名 | 1 |
| 6 | `batch-no` | 批次 / 实验编号 | 5 |
| 7 | `version` | 版本号 | 1 |
| 8 | `defect-id` | 缺陷编号 | 1 |
| 9 | `one-off-wording` | 一次性措辞 | 3 |

### 3.4 全量回归

命令：`node tools/run-tests.mjs --all --root plugin --repo .`

```
REPO=.
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
RESULT member-identity-test exit=0 pass=64 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=119 fail=0
RESULT scope-test exit=0 pass=38 fail=0
RESULT zero-debt-test exit=0 pass=61 fail=0
>>> SHELL ALL PASS
```

**16 套件全 PASS / 0 FAIL**（实测）。本单所属套件 `member-identity-test`：**64 条断言全绿**（第一轮 45 条）。
另：`node tools/install-selftest/check-readme-consistency.mjs` ⇒ **144 PASS / 0 FAIL**（README 未改，一致性仍绿）。

### 3.5 语义变异体矩阵

命令：`node tests/fixtures/member-identity-mutation-matrix.mjs .`（19 个变异体，串行，字节级副本）

```
基线：pass=64 fail=0 exit=0
M-MIa [S16] 完全不检查（检测循环被清空）：套件 pass=34 fail=30 专属锚点红=是 EXTRA-RED=29 总红数=30 判定=EXTRA-RED(29)
M-MIb [S16] 只查版本号、放过其它：套件 pass=40 fail=24 专属锚点红=是 EXTRA-RED=23 总红数=24 判定=EXTRA-RED(23)
M-MIc [S16] 账号目录不可用也判失败（把「没查」当成「查出不干净」）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MId [S16] 命中项不报原文（人看不出该删什么）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIe [S16] 命中项不报行号（人定位不到该删哪一行）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIf [S16] 名录不查 created_for（能力化表述那条规矩的主战场失守）：套件 pass=62 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-MIg [S16-规则5] 宿主配置字段也参与判定（defaultWorkspaceDir 的盘符路径又被当成残留）：套件 pass=62 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-MHh [S16-规则5] description 不参与判定（提示词本体少了一块）：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-MHi [S16-规则5] front matter 未闭合时静默放过（结构认不出就当宿主配置）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MHj [S16-规则6] 让渡句不豁免一次性措辞（合规写法被当成残留）：套件 pass=62 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-MHk [S16-规则6] 让渡句豁免整句（含具体标识 ⇒ 规则 6 第二句被丢掉）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIl [S16-规则7] 不认裸脚本 / 配置文件名（具体标识覆盖面只剩文档类）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIm [S16-规则7] 不认带目录段的相对路径（具体路径覆盖面只剩裸文件名）：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-MIn [S16-规则7] 仓库相对引用不再豁免（机制自己的路径被当成残留）：套件 pass=60 fail=4 专属锚点红=是 EXTRA-RED=3 总红数=4 判定=EXTRA-RED(3)
M-MIo [S16-规则7] 通配形态不再豁免（*.receipt.json 被当成具体文件名）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIp [S16-规则7] 相对路径判据放宽（只要含分隔符就算路径 ⇒ 自然语言枚举全被误报）：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-MIq [S16-规则7] 仓库自有资产不再豁免（机制自己的 lib.mjs 被当成某一单的交付物）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIr [S16-规则5] 未知 front matter 键也跳过（把「未知键 fail-closed」改回静默放行）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIs [S16-规则7] 仓库自有资产豁免不区分目录段（带目录段的相对路径也被放过）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=64
```

**MISS=0**（实测）⇒ 19 个变异体全部被各自的专属锚点断言抓住，没有漏网的语义破坏。
三列分开报的口径与第一轮一致：专属锚点红 / EXTRA-RED / 总红数；个体变异明细留档在
`docs/audit/.tmp-member-identity/r2-mutation-output-final.txt`。

## 4. 父会话裁决（已落契约）

父会话已把两条裁决写进契约并逐字回读，本单据此把实现与注释对齐到契约行号：

### 4.1 仓库自有资产豁免 —— **采纳**（契约规则 7 末段，contract.md:883-886）

- **契约怎么写的**：裸文件名（**无目录段**）若在本仓库内**确实存在同名文件** ⇒ 不算「本次任务的」具体文件名；
  机制自己的文件（`lib.mjs` 这类）是稳定资产，不是某一单的坐标；
  仓库里并不存在的 `wordcount.py` / `receipt.json` 这类文件名**仍照判**；
  **不另抄一份名单** —— 判定依据是「文件在本仓库内是否真实存在」。
- **实现怎么落的**：`repoAssetIndex()`（tools/member-identity-check.mjs:128-159）现场遍历仓库里
  `plugin/ tools/ tests/ docs/ .superagent/` 收集**真实存在的文件名集合**，
  `isRepoAsset()` 按名查表 —— **没有任何硬编码名单**，也不按「文件名长得像代码」猜。
  仓库读不到 ⇒ 不豁免（fail-closed：不能证明是自家资产，就不能放过）。
- **实测**：`lib.mjs`（存在）⇒ 豁免、不报（MI-H12）；
  `wordcount.py` / `receipt.json`（不存在）⇒ 照判（快照扫描里两条都在命中清单里）。
- **收尾轮补的一处收紧**：契约限定「**无目录段**」，而本单原实现只查末段同名 ⇒
  `工具\contract.md` 这类**带目录段**的相对路径会被误豁免（末段 @BT@@contract.md` 在仓库里存在）。
  已加 `isBareFileName()`（tools/member-identity-check.mjs:165-167）把豁免限定为无目录段的裸文件名，
  并配 MI-H14 + M-MIs 两条专属证据（详见第 5 节）。

### 4.2 未知 front matter 键按 fail-closed 处理 —— **采纳**（契约规则 5 末段，contract.md:872-874）

- **契约怎么写的**：未列入宿主配置表的 front matter 键**照常参与判定** ——
  否则「把路径写进一个谁都没见过的键」就成了一条永远查不出的暗道；
  代价是宿主将来新增字段时要在判据表里补一行（表是唯一出处，改口径必须同时改断言与变异体）。
- **实现怎么落的**：`regionForKey()`（tools/member-identity-check.mjs:511-518）的判据只有一条 ——
  **该键在不在 `HOST_CONFIG_KEYS` 表里**：在 ⇒ 宿主配置、不参与；不在 ⇒ 落 `front-matter` 区域、**照常扫描**。
  `isHostConfigKey()`（:520-525）只认表内键（整名命中，或点分写法的最后一段命中，如 `x-mavis.defaultWorkspaceDir`）。
  这不是「只跳过那五种已知字段」凑出来的效果 —— 变异体 M-MIr 把它改成「未知键也跳过」时，MI-H13 立刻转红。
- **实测**：`unknown-key/sa-unknown` 夹具的 `taskPath: Q:\教学\…` 报红（abs-path@front-matter，MI-H13）。

## 5. 本单新发现并已修的缺口（D- 号待父会话分配）

| 临时叫法 | 现象 | 根因 | 修法 | 回归证据 |
|---|---|---|---|---|
| 本单新增-01 | 「未知键 fail-closed」这条判据**没有专属断言**：只有区域分类单测（MI-H4）顺带覆盖，变异体打不红它 | 第一轮把「未知键照常参与判定」当成了区域分类的副产物，没当成一条独立判据 | 新增夹具 `unknown-key/sa-unknown`（front matter 里放一个未知键 `taskPath:` + 盘符路径）+ 专属断言 **MI-H13** + 专属变异体 **M-MIr**（把未知键改成跳过 ⇒ MI-H13 转红） | MI-H13 PASS；M-MIr 专属锚点红=是、EXTRA-RED=0 |
| 本单新增-02 | 「仓库自有资产」豁免**越界**：带目录段的相对路径（`工具\contract.md`）因末段与仓库同名被放过 | 实现只按**末段同名**判豁免，没实现契约新加的「**无目录段**」限定 ⇒ 照判路径被静默放过（正是本专项最忌的那类静默失效） | 新增 `isBareFileName()`（豁免只给无目录段的裸文件名）+ 专属断言 **MI-H14** + 专属变异体 **M-MIs**（去掉目录段限定 ⇒ MI-H14 转红） | MI-H14 PASS；M-MIs 专属锚点红=是、EXTRA-RED=0；收尾后 `工具\contract.md` 确实被报红 |

> **不自己编号**：按约定，缺陷登记与 `D-` 号由父会话统一分配（`docs/audit/defect-ledger.md` 本单未动）。

## 6. 诚实边界

- 校验只覆盖**本机已存在的成员文件**；账号成员目录不可用时只查名录（退出码 0，但结论行明写「账号级未检查」）。
- 判据是**词法级**的：只保证「已知的这几类残留一定被报出来」，不保证「持久层里一定没有任务内容」（契约 :897）。
- 本单只管**提示词文本**；`defaultWorkspaceDir` 把成员钉在哪个项目属于项目归属问题，校验器不判（契约 :898-899）。
- 「仓库自有资产」豁免只看**同名**，不看语义 —— 某一单的交付物若恰好与仓库里某个文件同名，且**写成裸文件名**，仍会被豁免。
  这是词法级判据的固有边界；带目录段的相对路径不受此影响（R7-6b 已锁住）。
- 真实账号目录的扫描**不进常驻回归**（它依赖本机状态，别的机器会缺目录）；常驻回归全部使用合成夹具。
- 本单的「真实扫描零命中」是**本机此刻**的事实（2026-11-12），不是平台事实：换一台机器、换一个成员集合，结论会变。
- 第一轮报告里的「14 处命中」是**误报**这件事，本单已用「改前快照 + 当前真实目录」双向对照坐实；
  快照目录保留在 `docs/audit/.tmp-member-identity/agents-before/`，任何人都能复跑对照。

## 7. 归档清单（docs/audit/.tmp-member-identity/）

| 文件 | 内容 |
|---|---|
| `agents-before/` | 9 个成员 agent.md 的改前快照（父会话取证） |
| `r2-real-scan-final.txt / .json` | 真实账号目录扫描（退出码 0、零命中） |
| `r2-snapshot-scan-final.txt / .json` | 改前快照扫描（退出码 1、8 处真残留） |
| `r2-dirty-fixture-final.txt / .json` | 旧脏夹具扫描（9 类特征） |
| `r2-fx-*.json` | 12 个新夹具的逐个扫描结果 |
| `r2-run-tests-all-final.txt` | 全量回归输出（16 套件） |
| `r2-mutation-output-final.txt` | 变异矩阵完整输出（含个体 RED 明细） |
| `r2-matrix-def.md` | 矩阵定义（由执行器 `--emit-md` 导出的中间件） |

（本文件由手工撰写；其中的实测输出全部**从归档文件回填**，未手抄。）