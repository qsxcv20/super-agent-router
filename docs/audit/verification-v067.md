# v0.5.9 发布产物 — 独立复审报告

> **本报告的正式入库路径**：`docs/audit/verification-v067.md`（原产于 gitignore 的 `docs/audit/.tmp-verify-release-v059/REPORT-v059-release.md`）。
> **父会话补记见文末**「父会话补记（2026-11-12，发布前）」一节 —— 两条条件的关闭方式、并发改动的核实与三条「复审方没做的事」的处置。

- 复审对象：`plugin/.minimax-plugin/plugin.json` / `plugin/CHANGELOG.md` / `plugin/README.md` / 根 `README.md` / `install.ps1` / 新建 `docs/audit/release-v059.md`
- 纪律：不采信任何转述（发布侧自述 / 我的结论 / 上一轮结论均为待核断言）；**只报不改**
- 复审时间：2026-11-12 11:57~12:20
- 临时目录：`docs/audit/.tmp-verify-release-v059/`（已 gitignore，规则 `docs/audit/.tmp-*/`）

## 结论

**VERDICT: PASS-with-conditions** —— AC1~AC7 的**全部判定项达成**；另记 2 条中/低严重度的口径问题（CHANGELOG 对夹具形态的描述与事实相反；「54 条 / 897 条」已被发布后的并发改动冲成 55/898），并确认一条**已登记的新缺陷**（四处版本号一致无自动化断言）。

**机制 vs 链路仍分开判**：本单只判发布产物；**活体拦截证据依旧未取到**（需装插件 + 重启客户端 + 重跑探针），发布产物对这条的措辞是诚实的（见 AC2）。

## AC1 版本一致性 —— PASS

四处逐字核对：

- `plugin/.minimax-plugin/plugin.json` → `"version": "0.5.9"` ✓
- `plugin/CHANGELOG.md:6` → `## [0.5.9] - 2026-11-12` ✓
- `plugin/README.md:13` → 「当前版本：**v0.5.9**」✓
- 根 `README.md:10` → 「当前版本：**v0.5.9**」✓

四处出现的其它 0.5.x 均为**历史陈述**（v0.5.8 引入 loop-gate / v0.5.7 那棵树 / v0.5.0 破坏性变更等），**不是过期的「当前版本」声明** ✓

### description 的 v0.5.9 段内容属实 —— 逐条回代码核对

| description 的说法 | 核到的落点 | 结论 |
|---|---|---|
| 按载荷形态择一计数（内层 child_calls[] / 外层 content[] toolCall） | `loop-gate.mjs:391` callsFromLines → `:371` pickNamespace | 属实 |
| 两套序列绝不混数 | `:398` `const seq = ns === 'inner' ? inner : outer;` | 属实 |
| 不可比 ⇒ 打断连续段但不计入 | `:347` innerComparable + `:410` 哨兵占位 | 属实 |
| 一个项目一个窗口（契约 S4.6 / SKILL 铁律第 9 条） | `contract.md:271` S4.6 专节、`SKILL.md:29` 铁律 9 | 属实 |
| 运行时两处注入 | `session-start.mjs:35`、`gate.mjs:60` 各一条同口径粒度规则 | 属实 |
| 29 次 grep 仍放行 / 活体未取到 / fail-open / 只覆盖严格连续 / D-92 无代码兜底 / 必须重启 | 见 AC2 逐条表 | 属实 |

## AC2 诚实边界 6 条逐条核对 —— PASS

| # | 边界 | 写了没 | 在哪个文件哪一行 | 措辞有没有夸大 |
|---|---|---|---|---|
| 1 | 活体拦截证据仍未取到 | ✅ | `plugin/CHANGELOG.md:91-100`；`plugin/README.md:709-712`；根 `README.md:57-60`、`:481-482`；`plugin.json` description | **没有夸大**：明写「**在拿到之前，别把它当成「已经生效」**」/「不要把它当成「已经生效」」/「本版**不写「已生效」**」 |
| 2 | PTC 内层参数只落子集 ⇒ 不可判 | ✅ | `CHANGELOG.md:101-105`；`plugin/README.md:713-716`；根 `README.md:61-62`、`:483-484`；description | **没有夸大**：明写「实测连跑 **29 次**逐字相同的 `grep` 仍放行」⇒ 与我的实测一致（第 5 轮：内层 grep{} 29 次 ⇒ ALLOW） |
| 3 | 效率闸门 fail-open（读不到就放行） | ✅ | `CHANGELOG.md:106-111`；`plugin/README.md:680-687`（「它不拦什么」+ 边界 3）；根 `README.md:63-64`；description | **没有夸大**：明写与安全闸门 fail-closed「故意相反」且「本闸门失效也不放宽任何 scope 判定」 |
| 4 | 只覆盖「严格连续」这一族 | ✅ | `CHANGELOG.md:112-116`；`plugin/README.md:680-684`；根 `README.md:64`、`:483` | **没有夸大**：明写打散形态「覆盖有限」、「累计次数口径……本版没有」 |
| 5 | D-92 无代码兜底，靠派工方遵守 | ✅ | `CHANGELOG.md:117-121`；`plugin/README.md:842-846`；根 `README.md:75-78`、`:485`；description | **没有夸大**：明写「只读类派工**不触发**冲突闸门 ⇒ 程序层拦不住 ⇒ **靠派工方遵守**」 |
| 6 | 升级后必须重启客户端 | ✅ | `CHANGELOG.md:122-127`；`plugin/README.md:104`、`:120`；根 `README.md:85`、`:199`、`:207`；`install.ps1` 三处；description | **没有夸大**：明写「三步缺一不可」且保留「若宿主将来改为热重载，本节需复核」 |

**逐字未夸大**的旁证：三份文件都把「回放坐实」与「活体未取到」并列写，没有把任一条写成「已生效 / 已上线」。

## AC3 历史段落未被改写 —— PASS（字节级）

用**已安装副本**做基线（发布前状态）：

```
工作树 CHANGELOG 132729 B ｜ 已安装 v0.5.8 副本 125250 B ｜ 备份 v0.5.7 副本 113358 B
最新版本：work=0.5.9 ｜ installed=0.5.8 ｜ backup=0.5.7
v0.5.8 段及更早：工作树 vs 已安装 v0.5.8 副本  →  段长 65179 vs 65179，逐字全等 = true（sha 相同）
v0.5.7 段及更早：工作树 vs 备份 v0.5.7 副本      →  逐字全等 = true
工作树新增部分：仅 0.5.9 段（3801 字符）
```

- ⇒ **v0.5.8 及更早段原文未动**（不是「看着没变」，是逐字节相同）✓
- ⇒ 历史审计报告 `docs/audit/verification-*.md` **零改动**（`git status` 命中数 = 0）✓

## AC4 D-88 没被弱化 —— PASS

`install.ps1` 的三处重启告知**全部在位**（`git diff` 显示全是新增行，无一处删除）：

- `.DESCRIPTION` 第 8 条：「收尾提示写明**「重启 MiniMax Code 客户端后生效」**……运行中的客户端仍绑定旧树 ⇒ **不会自动生效**」
- `.NOTES`：「升级 / 重装后还必须**重启 MiniMax Code 客户端**……⇒ 新代码不会自动生效」+ 新增自证段（**只加不删**）
- 收尾输出：`Write-WarnTxt '【必须重启 MiniMax Code 客户端才会生效】—— 不会自动生效。'` + 「为什么必须重启（**不是建议，是确定行为**）」

另外三处口径一致且仍在：根 `README.md:199/207/261/428`、`plugin/README.md:104/120/220`、`CHANGELOG.md:122-127`。

唯一的既有行改动是收尾输出的步骤序号 `3) 卸载` → `4) 卸载`（因为新增了「3) 想确认当前跑的是哪一版」）—— **不是弱化** ✓

## AC5 自洽实测（我自己跑） —— PASS

```
$ node tools\run-tests.mjs --all --root plugin --repo .
chain 70 / d27-mut 14 / dispatch-release 58 / e2e 53 / fix-d80-d85 49 / guard 228 / hooks 36 /
ledger 23 / lessons 65 / loop-gate 55 / records 52 / roster 38 / scope-amend 119 / scope 38
套件数=14  我自己逐套加总 = 898 条  fail 合计 = 0   >>> SHELL ALL PASS

$ powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-selftest\run-all.ps1
sandbox-test 41 / sandbox-test2 44 / trailing-space 39 / verify-seed 21 / check-readme 131 / exit-code 18   （全 0 FAIL）
「全部套件断言总数：声明 294 == 实际 294」  「条数对账 8 条绿」  「6 / 6 个套件全部通过」  exit=0

$ node tools\install-selftest\check-readme-consistency.mjs
==== 文档与实现对账：PASS 131 / FAIL 0 ====   exit=0

install.ps1 沙箱实跑（run-all 内）：[版本] 源=0.5.9 模拟旧版=0.5.8；
  S1 VerifyOnly exit 0 ｜ S2 首次安装 exit 0（src=29 文件 SHA256 全等）｜ S3 同版本不重装 exit 0
  S4 版本不同 ⇒ 生成 1 份备份（备份里是 0.5.8）⇒ 目标升级回 0.5.9 exit 0 ｜ S5 源包校验失败 ⇒ 非零退出、不装一半
```

### 「版本号四处一致」是否有自动化断言 —— **没有**（已确认的新缺陷）

- `tools/install-selftest/check-readme-consistency.mjs:31-32`：`const SRC_VERSION = String(manifest.version);` 之后只有 `console.log('[版本] ' + SRC_VERSION);` —— **只打印、不判定** ✓（发布侧的说法属实）
- 全仓唯一用到 `SRC_VERSION` 判定的只有 `tools/install-selftest/verify-seed.mjs:119`（「安装副本 plugin.json 版本与源一致」）—— 那是**安装副本 vs 源**的一致性，不是**四处文档 vs manifest** 的一致性。
- ⇒ 「四处版本号一致」目前**无任何自动化守护**：下一次改版本只改 manifest 而漏改某份 README/CHANGELOG，**没有任何检查会红**。发布侧已在 `release-v059.md` 第 4 节自报这条（只报不改）✓；按纪律**我只报事实、未修**。

## AC6 变更范围 —— PASS-with-conditions

**本单（发布侧）改动 = 6 个文件**（按 mtime 独立确认）：

| 文件 | mtime |
|---|---|
| plugin/.minimax-plugin/plugin.json | 11:41:11 |
| plugin/CHANGELOG.md | 11:43:13 |
| plugin/README.md | 11:43:50 |
| install.ps1 | 11:45:53 |
| README.md（根） | 11:53:11 |
| docs/audit/release-v059.md（新建） | 11:54:19 |

**其余未提交改动都不是本单的**（父会话此前几轮 / 并发轮次）：

- `git status --short` = **25 行**（20 改 + 5 未跟踪），其中 `?? docs/audit/release-v059.md` 是本单新增。
- `plugin/scripts/loop-gate.mjs`、`tests/loop-gate-test.mjs` 在 **12:03:05 / 12:03:28** 被改（**在我复审期间**）—— 不是我改的，也不是发布单改的（发布侧 `release-v059.md:7` 明确「本单**未碰** `plugin/scripts/**` / `tests/**`」）：
  - 改动内容：① `loop-gate.mjs` 的导出清单注释被改成与代码一致（**7 个** export 逐个列出，正是修我第 5 轮那条「4 个/五个/实际 7 个」注释矛盾）；② `tests/loop-gate-test.mjs` 的性能断言改成「**取 7 次采样最小值**」并新增一条「相对同规模小基线的倍数 <= 20」（正是修我第 5 轮那条「性能断言负载敏感」）。
  - **判定行为未变**（我实测）：用第 5 轮那套区分夹具重打当前实现 ⇒ `F0 DENY / F1 ALLOW / F1b ALLOW / F2 ALLOW`，与第 5 轮**逐项一致**；真实回放 `tests/d91-ptc-replay.mjs` 亦逐项一致（内层 bash 第 6 次 DENY / 外层第 6 次 DENY / grep 29 次 ALLOW / glob ALLOW / 完整体 ALLOW）。
- `docs/audit/defect-ledger.md`（11:32:45）、`plugin/scripts/gate.mjs` / `session-start.mjs`（10:33）、`SKILL.md` / `reuse-registry.md`（10:15~10:17）⇒ 分别是 D-91 收尾轮与 D-92 协议轮的产出，**不属发布单**。
- 历史审计报告 `docs/audit/verification-v*.md`：**零改动** ✓

## AC7 文档数字漂移 —— 2 处

### 我逐项核过的数字（全部对得上）

| 文档里的数字 | 实际 |
|---|---|
| 根 README「hooks/hooks.json — **8 个 handler**（含 SessionStart）」 | hooks.json：4 个事件 / **8 个 handler 组** / 8 条 hook |
| 根 README「scripts/ — **14 个脚本**」 | `plugin/scripts` **14 个文件** |
| 根 README「tests/ — **十四套回归测试**」 | `tests/*-test.mjs` **14 套** |
| 「loop-gate 套件 **54 条**断言」 | 当时 54（第 5 轮 11:26 与发布侧 11:41 均实测 54）；**现为 55**（12:03 并发改动，见下） |
| 「全量回归 **14 套 / 897 条 / 0 FAIL**」 | 当时实测 **897**（我 11:40 的回归同样是 14/897/0）；**现为 898** |
| 「重复调用闸门套件由 44 条增至 54 条」 | 44→54 属实（第 5 轮实测 44 与 54 两端都对） |
| 「### 4.」编号笔误 | HEAD 里「怎么用」段确有**两个 `### 4.`**（`### 4. 派工时 scope 要写具体路径` 与 `### 4. 验收通过后记一条履历`）；本单把后者改为 `### 5.`（`git diff` 可见 `-### 4. 验收通过后记一条履历` / `+### 5. …`）⇒ **已修**；plugin/README 编号 1~13 连续、无重复 |

### 漂移 1（中）：CHANGELOG 把主夹具说成「同一行同含」

- `plugin/CHANGELOG.md:39`：「**PTC 真混合形态夹具**（**同一行同时含外层 `content[]` 与内层 `child_calls[]`**）」
- **事实**（我第 5 轮实测，本轮复核仍成立）：
  - 真实 PTC transcript（51 行）：**同含外层+内层的行 = 0**（仅外层 24 / 仅内层 24 / 皆无 3）⇒ 真实形态是**跨行交替**；
  - 两份主夹具 `d91-ptc-inner-read-repeat.jsonl`（10 行）、`d91-ptc-inner-read-breaks-run.jsonl`（12 行）：**同含行 = 0**（外层行 5/6、内层行 5/6 交替）；
  - **只有** `d91-ptc-same-line-mixed.jsonl` 是同含形态（6/6），且它是**合成**的（生成器注释与断言名都写明「真实中不存在」）。
- ⇒ 这句括注把「真实形态」写反了。实现者自己在 `tests/fixtures/d91-make-fixtures.mjs` 头部写的是「同一行同含……= **0 行**；真实形态是……**跨行交替**」—— **文档与生成器自述、与夹具事实互相矛盾**。
- ⇒ 危害：读者会以为「真实 PTC transcript 的工具调用与子调用在同一行」——这正是 D-91「夹具与真实形态不同源」那族错误的**文档版**；而 D-91 的教训恰恰是「注释宣称 ≠ 代码在做」。**只报不改。**

### 漂移 2（低）：「54 条 / 897 条」已被发布后的并发改动冲掉

- 发布侧写这两个数字时（11:41~11:54）**是对的**：我 11:40 的回归也是 14 套 / 897 条 / 0 FAIL（与「改前改后一致」自述相符）。
- 但 **12:03** 的并发改动给 loop-gate 套件加了 1 条性能断言 ⇒ 当前工作树是 **55 条 / 898 条**，CHANGELOG 与两份 README 仍写 54 / 897 ⇒ **在读者手上的仓库里已经漂了 1 条**。
- ⇒ 与 D-86 那条「文档数字漂移」同族；根因与 AC5 那条新缺陷同源：**没有「文档数字 vs 实际」的自动校验**。

## 清单外问题（按严重度）

1. **[中] `plugin/CHANGELOG.md:39` 对夹具形态的描述与事实相反**（把跨行交替的真实形态写成「同一行同时含」；主夹具同含行 = 0，真实 transcript 同含行 = 0，只有合成夹具才是同含形态）。与生成器自述、断言名、夹具内容三处自相矛盾。
2. **[低] 「54 条断言 / 897 条」在当前工作树已过期**（55 / 898）——发布时为真，被 12:03 的并发改动冲掉；与第 3 条同源。
3. **[低] 「四处版本号一致」无自动化断言**（`check-readme-consistency.mjs:31-32` 只打印；`verify-seed.mjs:119` 只核安装副本 vs 源）⇒ 下次改版本漏改一处没有任何检查会红。**已由发布侧自报；按纪律未修。**
4. **[低] 两份 README 的用户视角句先于边界限定出现**：根 README:52「**对你意味着**：子代理真的在空转时，**它会被拦下来**催着交结论」、`plugin/README.md:707`「**修好之后的效果**：……**第 6 次会被拦下来**」—— 紧跟着的下一段就写明「在拿到之前，别把它当成「已经生效」」/「不要只读上一句」。**不构成夸大**，但把未取到活体证据的行为写成既成事实放在最显眼处，措辞可以再紧一档。
5. **[信息] 根 README:210「装上 v0.5.8 后确实多出了一棵新树，但之后新起的会话里 Hook 跑的**仍是 v0.5.7 那棵树**」是带日期与版本号的历史观测**，发布侧原文保留未改（改它等于篡改证据）—— 处理得当，不是缺陷。
6. **[信息] 12:03 的并发改动已修掉我第 5 轮的两条意见**（导出清单注释与代码一致化、性能断言改为 7 次采样取最小 + 相对基线倍数）⇒ 判定行为经我复测**未变**（F0/F1/F1b/F2 + 真实回放逐项一致）。

## 没能验证的项及原因

- **活体拦截**（真实运行的客户端里真被拦下过）：未验证 —— 需 ①把插件装进 `~/.minimax` ②**重启 MiniMax Code 客户端** ③重跑活体探针（8 次逐字相同 + 阳性对照 + 金丝雀 + 时间戳 + 会话 id）。发布侧明确写「本单做不到也不假装做到」，且**没有**在文档里把它写成已生效 ⇒ 诚实边界成立 ✓
- **宿主侧「内容哈希缓存树」行为是否仍与文档一致**：本轮未复核（D-88 那一轮的证据），本单只核「四处口径是否一致、措辞是否被弱化」。
- **`plugin-hook-cache` 活体树当前指向哪一版**：我只能读到**已安装副本 = 0.5.8**（`~/.minimax/plugins/super-agent-router/.minimax-plugin/plugin.json`）、仓库 = 0.5.9 ⇒ 磁盘上仍是旧版，**尚未安装本版**（本单不装、不重启）。
- **`docs/audit/release-v059.md` 自报的两条「清单外问题」**：我逐条独立复核过（目录数字漂移 ✓、版本号无断言 ✓），与我的结论一致。

## 没做的事（明示）

- **未修改任何项目既有文件**（6 个发布产物、测试、脚本、契约、台账一律只读）。
- 未推远端 / 未打 tag / 未发 Release / 未改仓库可见性 / 未 commit。
- **未安装插件**（`~/.minimax` 全程只读：只读了已安装副本的 CHANGELOG / plugin.json 作比对基准）、**未重启客户端**、未跑活体探针。
- 未替发布侧改那句不实的夹具描述、未替发布侧补「四处版本号一致」的断言、未更新 CHANGELOG / README 里的 54 / 897。
- 临时产物只落在 `docs/audit/.tmp-verify-release-v059/`：
  `REPORT-v059-release.md`（本报告）、`ac3.mjs`（历史段字节比对）、`disc.mjs`（第 5 轮区分夹具重打）、`regress.txt`（回归全量输出）、
  `F0-canary-inner-bash5.jsonl` / `F1-inner-read-onlypath.jsonl` / `F1b-inner-read-with-offset.jsonl` / `F2-sentinel-break-run.jsonl`（我造的夹具）。
  该目录被 `.gitignore` 的 `docs/audit/.tmp-*/` 覆盖，不影响 `git status`。

---

## 父会话补记（2026-11-12，发布前）

本报告由独立复审方（verifier）产出。**结论没有被当成「已发布」直接采纳**，而是逐条处理 —— 处理记录如下（父会话补记，**不改动复审方原文**）。

### 两条条件的关闭方式

| 复审提出的条件 | 关闭方式 | 证据 |
|---|---|---|
| **CHANGELOG 对夹具形态的描述与事实相反**（写「同一行同时含外层与内层」，事实是同含行 = 0） | 父会话**独立复算**同一组数字后改写 CHANGELOG：真实 transcript（51 行）= 仅外层 24 / 仅内层 24 / **同行同含 0** / 皆无 3；两份主夹具同含行 = 0；**合成**夹具 `d91-ptc-same-line-mixed.jsonl` = 6/6 同含（生成器与断言名已标注「真实中不存在」）。CHANGELOG 改为「跨行交替」的实话，并单列合成夹具的用途与标注 | 本报告 §AC7-1；父会话复算结果与复审**逐项一致**；**已登记为 D-95**（P2｜契约层） |
| 「54 条 / 897 条」已被并发改动冲成 55 / 898 | 父会话**独立复跑**全量回归 = **14 套 / 898 条 / 0 FAIL**（且是在「三份回归并发 + 16 个忙循环」的满载下跑绿的）；CHANGELOG / 两份 README / `release-v059.md` 的数字全部按**终态实测**回填 | 本报告 §AC7-2 与「清单外问题 2」；**D-93 已修（v0.5.9）** |

### 复审期间发生的并发改动（复审方主动发现，非事后追认）

`plugin/scripts/loop-gate.mjs`(12:03:05) 与 `tests/loop-gate-test.mjs`(12:03:28) 在复审进行中被**另一单**改动：

- ① 导出清单注释与代码一致化（7 个导出函数，删掉「4 个 / 五个」这类数字口径）；
- ② 性能断言改 **min-of-7 取最小值 + 相对基线倍数**（D-93），**阈值 2000ms 未动**。

复审方用第 5 轮的区分夹具**重打当前实现**（F0 DENY / F1 ALLOW / F1b ALLOW / F2 ALLOW，真实回放逐项一致）⇒ **判定行为未变**。父会话另**独立复跑**回归确认终态 898/0。

### 三件「复审方没做的事」，父会话的处置

| 复审方没做 | 父会话的处置 |
|---|---|
| 未改那句不实的夹具描述 | **已改**（见上表第 1 行） |
| 未补「四处版本号一致」的断言 | **未补** —— 已登记为 **D-94**（P3｜工具层），属工具层待做，本版不改 |
| 未更新 CHANGELOG / README 的 54 / 897 | **已更新**为 55 / 898（见上表第 2 行） |

### 顺带抓到的另一条：台账索引表折行（D-96）

发布前跑 `node tools/ledger-check.mjs` 时**当场报红 7 处** —— 根因是台账**索引表的三条长行被折成两行**（D-91 / D-93 / D-92 的第 5 格被拆到下一物理行，且续行**没有收尾竖线**），markdown 表格因此**从中间断成两块**，而 `ledger-check` 的 `blocks.find()` **只取第一块** ⇒ 「index」集合看不见 D-92 / D-93 / D-94 / D-95。已修复（合并回单行 + 去掉行间空行），并登记为 **D-96**（P2｜契约层）。台账现状：**100 条，六项检查全 PASS**。

### 本报告引用的区分夹具去向

本报告 AC6 用的 4 份区分夹具（`F0-canary-inner-bash5` / `F1-inner-read-onlypath` / `F1b-inner-read-with-offset` / `F2-sentinel-break-run`）与两个比对脚本 `ac3.mjs` / `disc.mjs` **留在 gitignore 的 `docs/audit/.tmp-verify-release-v059/` 内，未入库**（复审方的既定处置，报告末尾已明示）。需要复现请按本报告 §AC6 的描述**自行造**（判据：F0 = 连跑 5 次内层同一条 bash ⇒ 第 6 次 DENY；F1 / F1b = 内层 read 带不同 path / 带 offset ⇒ 打断连续段但不计入；F2 = 哨兵打断连续段）。

> **一条元纪律**：本报告之所以能抓到「文档宣称 ≠ 事实」，靠的是**复审方自己造夹具重打**；父会话之所以能**独立复算**出同一组数字、还顺手抓到**台账索引表折行**（D-96），靠的是**每个数字都自己重算一遍** —— 两者都不是「采信上一轮的结论」。
