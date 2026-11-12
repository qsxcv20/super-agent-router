# v0.5.9 打包发布报告（发布侧）

- 日期：2026-11-12
- 版本：**0.5.8 → 0.5.9**
- 专项：sa-plugin-release —— 插件包版本发布：版本号与描述同步、CHANGELOG 与面向使用者的 README 产出、包内自洽性校验
- 本单 SCOPE（**且只动了这些**）：`plugin/.minimax-plugin/plugin.json`、`plugin/CHANGELOG.md`、`plugin/README.md`、`README.md`、`install.ps1`、`docs/audit/release-v059.md`
- 本单**未碰**：`plugin/scripts/**`、`plugin/hooks/**`、`plugin/skills/**`、`tests/**`、`docs/audit/defect-ledger.md`
  （判定逻辑与协议正文的改动属 D-91 / D-92，由父会话并发完成）

## 一句话

D-91（重复调用闸门在 PTC 形态下恒不触发）与 D-92（派工粒度缺「项目」维度）随 **v0.5.9** 发布；
本报告只覆盖**发布侧**：版本号 / description / CHANGELOG / 两份 README / install.ps1 核对 / 包内自洽性校验。

## 1. 逐文件改了什么

### 1.1 `plugin/.minimax-plugin/plugin.json`

- `version`：`0.5.8` → `0.5.9`。
- `description` 末尾追加 **v0.5.9 段**（沿用既有「v0.5.x 起……」写法），覆盖：
  - **D-91**：按载荷形态**择一计数**（内层 `message.details.ptc.child_calls[]` / 外层 `content[]` 的 toolCall）、
    **两套序列绝不混数**、内层落盘参数是子集 ⇒ **不可比时打断连续段但不计入**（宁可少拦不误伤）；
  - **D-92**：**一个大项目由一个窗口从头负责到底**（契约 S4.6 / SKILL 铁律第 9 条）；
  - 段末写全诚实边界（活体证据未取到 / 29 次 grep 仍放行 / 效率闸门 fail-open / 只覆盖严格连续 /
    D-92 无代码兜底 / 升级必须重启客户端）。

### 1.2 `plugin/CHANGELOG.md`

- 顶部新增 `## [0.5.9] - 2026-11-12` 段，共 4 个块：
  | 块 | 内容 | 三要素 |
  |---|---|---|
  | 变更 1 | 修掉 PTC 形态下闸门恒不触发（D-91） | 改了什么 / 为什么 / 怎么验证 ✅ |
  | 变更 2 | 派工粒度补上「项目」这一维（D-92，协议层） | 改了什么 / 为什么 / 怎么验证 ✅ |

  | 变更 3 | loop-gate 套件 44 → 55 条断言 | 改了什么 / 为什么 / 怎么验证 ✅ |
  | 诚实边界 | 六条，逐条给「是什么 / 为什么这么写 / 怎么才能拿到」 | — |
- v0.5.8 及更早的历史段**原文保留，一个字未改**。

### 1.3 `plugin/README.md`（面向使用者）

| 位置 | 改动 |
|---|---|
| 开头 | 当前版本：v0.5.8 → **v0.5.9** |
| 「升级已有安装」 | 「本版（0.5.8）新增了 loop-gate.mjs」→ 改写为 **0.5.9** 的实际内容（修 D-91 + 派工粒度），并把「本次从 0.5.7 升到 0.5.8」改为 **0.5.8 → 0.5.9** |
| 「怎么自证当前生效的是哪一版」 | **加强**（不是弱化）：原有的「查 `loop-gate.mjs`」判读保留并改为「v0.5.8 及以后」，**另加**「直接读那棵树的 `.minimax-plugin\plugin.json` 看 `version` 字段」这一条更精确的自证办法 |
| 新增 `### v0.5.9 修好了什么：这道闸门以前在真实运行时整条没跑` | 讲清 PTC 形态的根因（载荷是内层、transcript 记的是外层 ⇒ 指纹永不相等 ⇒ 连续数恒为 0）、修法（择一计数 + 可比性判定）、**以及三条必须一起读的边界** |
| 新增 `## 派工粒度：一个项目一个窗口（v0.5.9）` | 对使用者的影响（一个大任务只有一个窗口跟到底、不再十几个窗口各交半成品）+ **诚实边界：目前没有代码兜底，靠派工方遵守** |

### 1.4 `README.md`（根）

| 位置 | 改动 |
|---|---|
| 开头 | 新增「当前版本：**v0.5.9**（完整变更记录见 `plugin/CHANGELOG.md`）」 |
| 新增 `## 这一版（v0.5.9）有什么变化` | 三块内容（闸门修好 / 派工粒度 / 断言补强），每块都写「对你意味着」+ 边界 |
| 「升级已有安装」自证第 2 步 | 由「看有没有 `loop-gate.mjs`」**加强**为「**读那棵树的 `plugin.json` 看 `version` 字段**」，并保留闸门文件作为补充判据 |
| 「已知边界」 | 新增三条（活体证据未取到 / 只覆盖严格连续且参数只落子集不可判 / S4.6 无代码兜底） |
| 「目录结构」 | `7 个 handler` → **8 个**、`13 个脚本` → **14 个**（这两处**在本单之前就已漂移**，见第 4 节） |
| 「怎么用」小节编号 | 原本存在两个 `### 4.`（「派工时 scope 要写具体路径」与「验收通过后记一条履历」）—— **既存笔误**，后一节改为 `### 5.` |

### 1.5 `install.ps1`

- **D-88 那条告知一个字未动、力度未减**（`.DESCRIPTION` 第 8 步、`.NOTES`、收尾输出三处仍在）。
- **增强**：收尾输出新增第 3 步「想确认『当前跑的是哪一版』（不重启客户端也能查）」——
  给出可执行的两步自证（从拦截原文取缓存树哈希 → 读该树的 `plugin.json` 看 `version`），
  并用 `$srcVersion` 动态打印「读到的 version = 0.5.9 ⇒ 跑的就是这一版；不是这个号 ⇒ 还在跑旧树 ⇒ 重启客户端」。
- `.NOTES` 同步补上同一套自证办法（**只加不删**）。

## 2. 包内自洽性校验（实测输出）

### 2.1 版本号四处一致

一次性脚本（放在 `%TEMP%\sar-selfcheck-v059.mjs`，**未进仓库**，理由见第 4 节第 2 条）：

```text
[1] plugin.json version = 0.5.9
[1] description 长度 = 4180 字符
[1] description 含 v0.5.9 段 = true
[1] description 含 v0.5.8 段 = true
[2] hooks.json 引用脚本 8 个，缺失 0 个
[3] manifest 声明 hooks/hooks.json 存在 = true
[3] manifest 声明 skills/super-agent-router/SKILL.md 存在 = true
[3] plugin/scripts 下 .mjs 共 14 个
[4] 版本号四处：
    plugin/.minimax-plugin/plugin.json     = 0.5.9
    plugin/CHANGELOG.md                    = 0.5.9
    plugin/README.md                       = 0.5.9
    README.md                              = 0.5.9
[4] 四处是否全等 = YES
```

### 2.2 manifest 与 `hooks.json` 引用的脚本都存在

```text
    OK       plugin/scripts/session-start.mjs   (SessionStart)
    OK       plugin/scripts/gate.mjs   (UserPromptSubmit)
    OK       plugin/scripts/dispatch.mjs   (PreToolUse)
    OK       plugin/scripts/guard.mjs   (PreToolUse)
    OK       plugin/scripts/guard.mjs   (PreToolUse)
    OK       plugin/scripts/guard.mjs   (PreToolUse)
    OK       plugin/scripts/loop-gate.mjs   (PreToolUse)
    OK       plugin/scripts/watchdog.mjs   (SubagentStop)
[2] hooks.json 引用脚本 8 个，缺失 0 个
```

（`plugin.json` 的 `hooks` / `skills` 数组声明项也逐条核对存在，见 2.1 的 [3]。）

### 2.3 断言条数（**本单自己跑出来的**，非转述）

| 命令 | 改前基线（发版前） | 改后（发版后） | 结论 |
|---|---|---|---|

| `node tools\run-tests.mjs --all --root plugin --repo .` | 14 套 / 897 条 / 0 FAIL，`>>> SHELL ALL PASS`，exit=0 | **14 套 / 898 条 / 0 FAIL**（终态，见 §6），`>>> SHELL ALL PASS`，exit=0 | 发版后并发修法 +1 条（见 §6-2） |
| `node tests\loop-gate-test.mjs`（单跑） | — | **55 PASS / 0 FAIL**（终态，见 §6） | 与父会话口径一致 ✅ |
| `powershell -ExecutionPolicy Bypass -File tools\install-selftest\run-all.ps1` | 6 套件 / 294 条 + 8 条对账全绿 | **6 套件 / 294 条 + 8 条对账全绿**，exit=0 | 一致 |
| `node tools\install-selftest\check-readme-consistency.mjs` | PASS 131 / FAIL 0，exit=0 | **PASS 131 / FAIL 0**，exit=0 | 一致（README 未引入新命令字面量，未触发条数漂移）；最后一处 README 微调（编号笔误）后再跑一次，仍 131/0 |

改后回归逐套件实测（`RESULT ... pass=N fail=0`，14 行全 0 FAIL）：

```text
chain-test 70 · d27-mut-test 14 · dispatch-release-test 58 · e2e-test 53 · fix-d80-d85-test 49

guard-test 228 · hooks-test 36 · ledger-test 23 · lessons-test 65 · loop-gate-test 55
records-test 52 · roster-test 38 · scope-amend-test 119 · scope-test 38
合计 898 条，FAIL 行数 0
```

### 2.4 `install.ps1` 沙箱实跑（不碰真实 `~\.minimax`）

```text
EXITCODE=0
SANDBOX=%TEMP%\sar-v059-74d5f112
  [!] Hook 按会话激活，必须新开一个会话才会生效。
  [!] 【必须重启 MiniMax Code 客户端才会生效】—— 不会自动生效。
  1) 新开一个会话，在里面提一句编排型请求，例如：
  3) 想确认「当前跑的是哪一版」（不重启客户端也能查）：
       再读那棵树自己的清单 .minimax-plugin\plugin.json —— 里面的 version 字段
       读到的 version = 0.5.9 ⇒ 跑的就是这一版；不是这个号 ⇒ 还在跑旧树 ⇒ 重启客户端。
已安装版本：0.5.9    目标：%TEMP%\sar-v059-74d5f112\super-agent-router
```

## 3. 诚实边界逐条核对表

| # | 边界 | `plugin/CHANGELOG.md` | `plugin/README.md`（面向使用者） | 根 `README.md` |
|---|---|---|---|---|
| 1 | **活体拦截证据仍未取到**（判定逻辑已坐实 ≠ 活体已生效） | ✅ 诚实边界第 1 条 | ✅ 「v0.5.9 修好了什么」边界 1 + 「升级已有安装」节 | ✅ 「这一版」§1 第 1 条 + 「已知边界」 |
| 2 | **PTC 内层参数只落子集 ⇒ 不可判 ⇒ 29 次逐字相同 grep 仍放行** | ✅ 诚实边界第 2 条 | ✅ 「v0.5.9 修好了什么」边界 2 | ✅ 「这一版」§1 第 2 条 + 「已知边界」 |
| 3 | **效率闸门 fail-open**（读不到 transcript / 解析不出历史就放行，与安全闸门相反） | ✅ 诚实边界第 3 条 | ✅ 「v0.5.9 修好了什么」边界 3 + 「它不拦什么（诚实边界）」原有段 | ✅ 「这一版」§1 第 3 条 |
| 4 | **只覆盖「严格连续」这一族**（打散形态覆盖有限，累计次数口径本版没有） | ✅ 诚实边界第 4 条 | ✅ 「它不拦什么（诚实边界）」原有段 + 「v0.5.9 修好了什么」边界 3 | ✅ 「这一版」§1 第 3 条 + 「已知边界」 |
| 5 | **D-92 项目级规则无代码兜底**（只读类派工不触发冲突闸门，靠派工方遵守） | ✅ 诚实边界第 5 条 | ✅ 「派工粒度：一个项目一个窗口」的诚实边界段 | ✅ 「这一版」§2 诚实边界 + 「已知边界」 |
| 6 | **升级后必须重启客户端才会换绑** | ✅ 诚实边界第 6 条 | ✅ 「升级已有安装」节（重新安装 → 重启客户端 → 新开会话）+「怎么自证当前生效的是哪一版」 | ✅ 「升级已有安装：三步缺一不可」+ 安装节 + 怎么用 §3 |

**D-88 口径未被弱化**：`install.ps1` 的「必须重启 MiniMax Code 客户端才会生效 —— 不会自动生效」在
`.DESCRIPTION` / `.NOTES` / 收尾输出三处**原文保留**（沙箱实跑已确认输出仍在，见 2.4）；
本单在该基础上**只增不减**地补了「怎么自证当前生效的是哪一版」。

## 4. 清单外问题（发现、**未处理**，按纪律上报）

1. **根 `README.md` 的目录结构数字在本单之前就已漂移**：`hooks/hooks.json` 写「7 个 handler」、
   `scripts/` 写「13 个脚本」，而 v0.5.8 引入 `loop-gate.mjs` 与第 5 个 `PreToolUse` 组后
   实际已是 **8 / 14**。本单已在 SCOPE 内（根 README）顺带改正为 8 / 14 —— 但**这说明发布流程
   少了一道「文档数字 vs 实际」的校验**。
2. **「版本号四处一致」目前没有任何自动化断言守护**。`tools/install-selftest/check-readme-consistency.mjs`
   读了 manifest 的版本（`SRC_VERSION`）却**只打印不判定**（实测 grep：`SRC_VERSION` 只出现在
   第 31 行赋值与第 32 行 `console.log`）。本单用一次性脚本核对，但该脚本**没有进仓库**
   —— 想常驻就得改 `tools/install-selftest/`，**不在本单 SCOPE**，只上报。
3. `tests/d91-ptc-replay.mjs`（父会话新增、未跟踪）是**手工回放脚本**，按其自身文件头的说明
   **不被回归壳自动发现**（发现规则只认 `*-test.mjs`）。它消费的夹具
   `tests/fixtures/d91-ptc-real-prefix.jsonl` **已由 `loop-gate-test.mjs`（在 14 套内）覆盖**；
   但回放脚本本身**不在回归里**，需手工跑。是否把它纳入自动发现属测试工装改动，SCOPE 外。
4. `docs/audit/defect-ledger.md`（缺陷台账）由父会话统一更新，本单**未动** —— D-91 / D-92 的
   台账条目不在本报告范围内。
5. 根 README「升级已有安装」里那句「装上 v0.5.8 后确实多出了一棵新树」是 **2026-11-12 对 v0.5.8
   那次实测的历史记录**，本单**原文保留未改**（改它等于篡改证据）；读者看到的是带日期与版本号的
   历史观测，不是本版的实测结论。
6. 根 README「怎么用」里两个 `### 4.` 的**既存编号笔误**（本单之前就在），已在 SCOPE 内改为 `### 5.`。
   改完后复跑 `check-readme-consistency.mjs` 仍是 **PASS 131 / FAIL 0（exit=0）** —— 条数口径零漂移。

## 5. 没做的事（明确列出）

1. **没改任何判定逻辑**：`plugin/scripts/loop-gate.mjs` 的择一 / 可比性 / 哨兵逻辑**一行未动**
   （本单只读它来核对 CHANGELOG 的描述是否属实）。
2. **没改协议正文**：`references/contract.md` 的 S4.6、`SKILL.md` 铁律第 9 条、
   `session-start.mjs` / `gate.mjs` 的运行时注入**一行未动**（本单只读它们来核对 CHANGELOG）。
3. **没改测试**：`tests/**` 一行未动，也没新增断言。
4. **没更新缺陷台账**：`docs/audit/defect-ledger.md` 归父会话统一更新。
5. **没推远端 / 没打 tag / 没发 Release / 没改仓库可见性 / 没有 commit** —— 对外动作一律由父会话执行。
6. **没碰 `~\.minimax`**（安装副本 / 缓存树 / 运行时台账全程未读写），**没重启客户端**。
7. **没取到活体拦截证据** —— 需要先安装 + 重启客户端 + 重跑活体探针，本单**做不到也不假装做到**。
8. **没加任何断言**：本单若新增断言，会同时牵动套件 `ASSERTION-COUNT`、套件头部条数与
   根 README 自测表三处对账（`check-readme-consistency.mjs` 读的是**根** README），
   而该脚本**不在本单 SCOPE** —— 故本单采取「不新增命令字面量 + 不新增断言」的保守做法，
   
保证条数口径零漂移（实测 131 / 131 未变）。

## 6. 父会话终审订正（2026-11-12，发布前）

发布前的**独立复审**（`docs/audit/.tmp-verify-release-v059/REPORT-v059-release.md`，180 行）
给出 **VERDICT: PASS-with-conditions**，AC1~AC7 全部达成判定，并记了 2 条口径问题。
父会话逐条复核后做了以下订正，**订正内容已回填本报告与对外文档**：

| # | 问题 | 性质 | 订正 |
|---|---|---|---|
| 1 | `plugin/CHANGELOG.md:39` 写「PTC 真混合形态夹具（**同一行**同时含外层与内层）」 | **与事实相反**（中）：真实 transcript（51 行）**同含行 = 0**（仅外层 24 / 仅内层 24 / 皆无 3，**跨行交替**）；同含形态的那份是**合成**夹具，生成器与断言名都已标注「真实中不存在」 | CHANGELOG 改为**跨行交替**的实话，并单列合成夹具的用途与标注 —— 与生成器、夹具内容三处不再自相矛盾 |
| 2 | 「54 条断言 / 897 条回归」 | 数字漂移（低）：发版后 12:03 的**并发修法**（D-93 性能断言抗负载）使 loop-gate 套件 +1 条 | 全量改为 **55 / 898**（CHANGELOG、根 README、本报告），并新增「变更 4」记录该修法 |
| 3 | 两份 README 的「它会被拦下来」先于边界限定出现 | 措辞可再紧一档（低；复审判定**不构成夸大**，因紧邻下一段即写明「别当成已生效」） | 改为显式限定「**按已坐实的判定逻辑**」，并当场点出「活体拦截证据仍未取到」 |
| 4 | 「四处版本号一致」无自动化断言 | **已登记缺陷 D-94**（`check-readme-consistency.mjs:31-32` 的 `SRC_VERSION` 只打印不判定） | **本版不改**（属后续版本）；复审与发布侧**各自独立查出同一条**，非任何一方转述 |
| 5 | 复审期间 `plugin/scripts/loop-gate.mjs`(12:03:05) 与 `tests/loop-gate-test.mjs`(12:03:28) 被并发改动 | 复审方**主动发现并核实**：改动是①导出清单注释与代码一致化 ②性能断言改 min-of-7 + 相对基线；**判定行为未变**（第 5 轮区分夹具重打：F0 DENY / F1 ALLOW / F1b ALLOW / F2 ALLOW，真实回放逐项一致） | 接受；父会话另**独立复跑**全量回归确认 **14 套 / 898 条 / 0 FAIL** |

终态实测（父会话与复审方**各跑一遍**，数字相同）：

| 项 | 数字 |
|---|---|
| 全量回归 | **14 套 / 898 条 / 0 FAIL**，exit=0 |
| `tests/loop-gate-test.mjs` 单跑 | **55 PASS / 0 FAIL** |
| `run-all.ps1` | **6 套件 / 294 条 + 8 条对账全绿**，exit=0 |
| `check-readme-consistency.mjs` | **PASS 131 / FAIL 0**，exit=0 |

> **一次「不是自己写的东西要自己跑」的实例**：父会话的这次全量回归是在
> **三份全量回归并发 + 16 个忙循环**的满载下跑完的（另两份分别是复审方的与返修单的）——
> 性能断言**照样绿**，这正是 D-93 修法要解决的场景。
