# v0.5.5 插件包版本发布报告

- 发布负责人：sa-plugin-release（专项：插件包版本发布）
- 父会话 id：`mvs_9bdda202ae274c909a5b4352fc45a471`
- 版本：super-agent-router **v0.5.4 → v0.5.5**
- 依据：`docs/audit/fix-f1-f5-rg03.md`（另一名成员交付，本轮**只读参考，未改动**）、
  `docs/audit/fix-rg01-09.md`（另一名成员交付的记录闸门与统计口径修复，本轮**只读参考，未改动**）、
  `docs/audit/defect-ledger.md`（共 66 条；本轮新增 D-44~D-62 共 19 条，**未改动**）
- 状态：**完成**。版本号、CHANGELOG、面向使用者的 README 三项交付齐备；
  包内自洽性校验逐条跑过并留证。
  **补写轮**：父会话追加要求补 v0.5.5 的「变更 9 / 变更 10」两段（另一名成员的收尾成果）——
  **CHANGELOG 补写完成**，见 §1.5。
  **仍待父会话处理 2 项**（见 §5 第 4 条、第 5 条），均不影响本次交付的成立。

---

## 1. 改了哪几个文件、哪几段

只改了 SCOPE 内的 4 个文件（另加草稿区 1 个目录），**没有碰任何别人的文件**。

### 1.1 `plugin/.minimax-plugin/plugin.json`

| 位置 | 改了什么 |
|---|---|
| `version` | `0.5.4` → `0.5.5` |
| `description` | 末尾追加 v0.5.5 段（保留 v0.5.0~v0.5.4 全部历史描述，不删不改） |

追加的 v0.5.5 描述覆盖 brief 要求的四件事，一句话说完：

> 权限等级 tier（scoped 默认 / full 项目内自由读写）与越界自动审核（撞墙自动记账 → 父会话一条命令批准扩权）继续沿用；
> **权威面脚本**（提权 / 批准扩权 / 写履历 / 写错题本 / 登记成员）改为**父会话专属**，子代理执行即被护栏拒绝；
> 批准人必须是真实的父会话 id（纵深防御，挡不住蓄意自提权）；
> 权限等级按派工时快照，会话中途提权对已在飞的会话不生效；
> 两条扩权路径同口径，派工已结束一律拒批；
> full 等级命中私有状态目录时文案分型，不再误诊为「在工作区之外」；
> 护栏第二道防线按形态判，私有记忆目录的扩权当场白拒，不再静默变成永远不生效的死条目。
> **诚实边界**：hook 是护栏不是沙箱 —— worker 若能执行一段落盘的脚本，脚本内部的写入不受判定约束，
> 真正的防线是运行时权限 + 审计留痕 + 验收复核。

**描述没有承诺未实现的能力**：逐条对照 §3 的契约口径检查过 ——
「权威面脚本父会话专属」「批准人必须是真实父会话 id」「按派工时快照」「两条扩权路径同口径」
「私有目录文案分型」「第二道防线按形态判」「私有记忆扩权当场白拒」七项，
在 `plugin/scripts/guard.mjs` / `scope-amend.mjs` / `lib.mjs` / `dispatch.mjs` 里都能逐行指到。

### 1.2 `plugin/CHANGELOG.md`

**把既有的 `## [未发布]` 段落整理成 `## [0.5.5] - 2026-11-10` 正式条目**（原段落整体消化，不是新写一遍），
并按本文件既有体例（"每条改动写清改了什么 / 为什么 / 怎么验证"）重组为 8 个变更：

| 变更 | 覆盖 | 改了什么 / 为什么 / 怎么验证 三要素 |
|---|---|---|
| 变更 1 | **F1** | 权威面脚本父会话专属（主防线）+ 批准人必须是真实父会话 id（纵深防御）+ 诚实边界。三要素齐全 |
| 变更 2 | **F2 / RG-03** | `--grant` 补派工状态校验（与「直接加条目」同口径）+ legacy 迁移不再把 `active` 提升成 `done`。三要素齐全 |
| 变更 3 | **F3** | full 等级命中私有目录的文案分型，不再误诊、不再给永远无效的批准提示。三要素齐全 |
| 变更 4 | tier 快照 | 权限等级按派工时快照（会话中途提权对已在飞会话不生效）。三要素齐全 |
| 变更 5 | **D-58** | 护栏第二道防线按形态判 + 私有记忆目录扩权当场白拒。三要素齐全 |
| 变更 6 | **F4** | 文档与代码口径对齐（删掉按现状不成立的断言；`full` 三条例外 → 四条）。三要素齐全 |
| 变更 7 | **F5** | 部署与副本一致性核对。三要素齐全 |
| 变更 8 | 台账与报告 | D-44~D-62 共 19 条；四份专项/验收报告 + 三份本版报告入库。三要素齐全 |

**断言总数没有钉死**（brief 明确要求）：写成「**全量断言总数以发布前最后一次实测为准** ——
断言条数随套件增删变动，钉死一个数会被下一个人立刻推翻」。§3 的自洽性脚本对此有断言守着。

另注：`## [未发布]` 段落已整体消失，CHANGELOG 里没有残留的未发布段（§3 有断言）。

### 1.3 `plugin/README.md`（面向使用者）

| 位置 | 改了什么 | 对应 brief 要求的哪一处 |
|---|---|---|
| 第 13 行 | `当前版本：**v0.5.2**。` → `v0.5.5` | **顺带修的过期数字**（manifest 早已是 0.5.4，README 却还写 0.5.2 —— 属 F4 同类问题） |
| 「权限等级」节 | 新增「`<父会话 id>` 填什么」段：填**你这一侧的父会话 id**（形如 `mvs_xxx`），**不能写「router」「管理员」这种自称**；`--tiers` 看当前等级 | ① 权限等级 tier 怎么用、怎么提权，批准人必须是真实父会话 id |
| 「子代理撞墙了怎么办」节 | 改写成**三步流程表**（发现+记账 → 审核 → 批准）+ 三步小节 + 「三条批准口径」（必须落在仍在飞的派工上 / 批准读 ≠ 批准写 / 私有记忆目录扩权当场被拒）；并补「不是「router」这种自称」 | ② 越界自动审核的流程（自动记账 → 管理员一键批准） |
| 新增「## 诚实边界：护栏是护栏，不是沙箱」整节 | 「机制做到的」6 条 + 「机制做不到的」4 条 + 「真正的防线是这三条」（运行时权限 / 审计留痕 / 独立验收）+ 一句话总结 | ③ 诚实边界 |
| 「权限等级」节内的诚实边界块 | 改为指向新小节，**删掉重复表述**，避免两处各写一份、日后必然漂移 | ③（去重） |
| 「它管什么、不管什么」节 | 三条硬边界 → **四条硬边界**，新增第 4 条「权威面脚本父会话专属」 | 与 §3 口径一致 |

**没有写「绝对不可能」这类按现状不成立的断言** —— §3 有断言专门守着这一点（见 §3.6）。

### 1.4 草稿区（不算交付物）

- `docs/audit/.tmp-release/check-selfconsistency.mjs` —— §3 的自洽性校验脚本（可复跑）。
  它是**本轮新写的**，不是交付物，但 §3 的每条结论都由它产出，可第三方复跑复核。
- `docs/audit/.tmp-release/count-assertions.mjs` —— 补写轮用来核对新增断言条数的脚本。
- `docs/audit/.tmp-release/block9.md` / `block10.md` —— 补写轮的两个变更块草稿。

### 1.5 补写轮：CHANGELOG 的「变更 9 / 变更 10」

父会话追加要求补写另一名成员的收尾成果。**已在 v0.5.5 条目里补了两个变更块**，
接在原 8 块之后、「怎么验证（总体）」之前：

| 块 | 标题 | 覆盖 |
|---|---|---|
| **变更 9** | 记录闸门与统计口径补齐（写入者身份 / 段首定位 / 并发写 / 归因 / 私有账闸门 / 取样名额 / 名录去重） | D-49 / D-50 / D-51 / D-52 / D-53 / D-55 / D-56 / D-57 |
| **变更 10** | 修并发写时实测发现的四个新缺陷（全在 Windows 并发写路径上） | D-59 ~ D-62 |

**措辞按本文件的体例重写**（每块含「改了什么 / 为什么 / 怎么验证」），没有照抄父会话给的概括。

**写之前逐条回读依据核对**（都是亲眼跑过 / 读到的，不是转述）：

| 核对项 | 核对方式 | 结果 |
|---|---|---|
| `resolveWriter` / `locateRecordsSection` / `writeFileLocked` / `withFileLock` | grep `plugin/scripts/lessons.mjs` | 四个函数均存在，行号可指 |
| 写入者身份判据 | 读 `lessons.mjs:265` 起 | `session_id` → 台账绑定 → 成员只许写自己的 / 父会话可代写 / 查不到 fail-closed |
| 段首定位共用 | 读 `lessons.mjs:72` + `record-gate.mjs` | 写入端与读取端共用 `locateRecordsSection` |
| 锁等待 60s / 偷锁 180s | 读 `lessons.mjs:380-381` | `timeoutMs = 60000`、`staleMs = 180000` |
| rename 重试 40 次 | 读 `lessons.mjs:472` | `for (let attempt = 0; attempt < 40; attempt++)` |
| 抢锁判据 `EEXIST`/`EPERM` | 读 `lessons.mjs:402` | `const taken = code === 'EEXIST' || code === 'EPERM'` |
| 取样名额单一常量 | 读 `records.mjs:56` | `export const SUMMARY_MAX_MEMBERS = MAX_ROSTER` |
| 名录去重 + 报出 | 读 `roster.mjs:59/74` | `dedupeByName()` / `duplicateNames()` 均在 |
| 三态读取 | 读 `lessons.mjs:152-166` | `no-file` / `empty` / `unreadable` / `entries` |
| 父会话已自行处理的两处 | grep `gate.mjs` / `session-start.mjs` / `dispatch.mjs` | 已引用 `SUMMARY_MAX_MEMBERS` 与 `lessonsStatusLine(name)` |
| 并发参数 | 读 `tests/lessons-test.mjs:286` / `tests/records-test.mjs:422` | 错题本 12×3 轮、履历 16×3 轮，异步 `spawn` |
| 变异检验 | **实跑** `docs/audit/.tmp-gate2/mutation-check.mjs` | **12 个变异体全部 RED**，输出 `>>> MUTATION CHECK OK` |
| 前半轮变异检验 | **实跑** `docs/audit/.tmp-fix/mutation-check.mjs` | **8 个变异体全部 RED** |
| 新增断言条数 | **实跑**基线对比（`be9caa3` 同一 harness 口径） | **+54**（lessons 19→52、records 30→46、roster 18→23） |

**两处我改了自己初稿的地方（如实记录）**：

1. 父会话给的「新增 56 条回归断言」—— 我按基线 `be9caa3` 同一 harness 口径实测是 **54 条**
   （lessons-test 19→52、records-test 30→46、roster-test 18→23）。
   **CHANGELOG 写的是实测的 54**，不是转述的 56。
2. 我初稿在「变更 10」里写了「D-59/D-60/D-61/D-62 各有专门变异体」—— **这是错的**：
   `docs/audit/.tmp-gate2/mutations.json` 里 12 个变异体覆盖的是 D-49/51/52/53/55/56/57，
   **没有**针对 D-59~D-62 的专门变异体。
   已改成如实表述：这四条被 M4/M12 **整段回退连带覆盖**（M4/M12 回退整个 `writeFileLocked`，
   含写锁、rename 重试与回滚），**不是逐条变异证明**。

---

## 2. 改了什么没改（明确声明）

- **没改** `plugin/scripts/**`（含 `lessons*.mjs` / `record-gate.mjs` / `records.mjs` / `roster.mjs`）、
  `plugin/hooks/**`、`plugin/skills/**`、`tests/**`、`docs/audit/defect-ledger.md`。
- **没部署**、**没 `git commit` / `git push`**（父会话统一做 —— 本轮部署由父会话执行）。
- `docs/audit/fix-f1-f5-rg03.md`、`docs/audit/fix-rg01-09.md` 与 `docs/audit/defect-ledger.md`
  **只读参考，未改动**。
- 「另一名成员收尾」那一段 CHANGELOG：初稿按 brief 留给父会话；
  **补写轮已由本成员按父会话追加要求补上**（见 §1.5），细节逐条回读依据核对过。

---

## 3. 包内自洽性校验（逐条结果，全部亲眼跑过）

校验脚本：`docs/audit/.tmp-release/check-selfconsistency.mjs`
复跑命令：`node docs/audit/.tmp-release/check-selfconsistency.mjs <repo>`
**实测输出：`>>> SELF-CONSISTENCY ALL PASS`（34 条断言，0 FAIL）**

### 3.1 manifest 与 hooks.json 引用的脚本都存在 ✅

- manifest `version` = **0.5.5**（PASS）
- manifest 声明的 `skills/super-agent-router/SKILL.md`、`hooks/hooks.json` — **均存在**（PASS ×2）
- manifest 的 `icon.png` / `icon-dark.png` — **均存在**（PASS ×2）
- hooks.json 引用的 **5 个脚本全部存在**（PASS ×7 条目）：

| 事件 | 脚本 | 结果 |
|---|---|---|
| SessionStart | `scripts/session-start.mjs` | 存在 |
| UserPromptSubmit | `scripts/gate.mjs` | 存在 |
| PreToolUse (task) | `scripts/dispatch.mjs` | 存在 |
| PreToolUse ×3 matcher | `scripts/guard.mjs` | 存在 |
| SubagentStop | `scripts/watchdog.mjs` | 存在 |

**引用悬空：0 处。**

### 3.2 plugin.json 版本号与 CHANGELOG 顶部条目一致 ✅

- CHANGELOG 顶部条目 = `## [0.5.5] - 2026-11-10`（PASS）
- CHANGELOG 无残留 `## [未发布]` 段（PASS）
- README `当前版本：**v0.5.5**`（PASS）—— 与 manifest 同值

### 3.3 README 的命令与脚本真实支持的开关一致 ✅

**做法**：把 README 里每一条 `scope-amend.mjs` / `release-slot.mjs` 命令行里的每个 `--xxx`
与脚本源码里 `FLAGS_WITH_VALUE` / 布尔开关表逐个比对（9 条命令全部 PASS）。

- `scope-amend.mjs` 真实支持的开关：
  值开关 `grant, deny, dispatch, add, approver, reason, data-dir, tier, agent, roster`；
  布尔 `read, write, list, tiers`
- `release-slot.mjs` 真实支持的开关：
  值开关 `data-dir, dispatch, parent, agent, reason`；布尔 `all`
- README 的 9 条命令**没有一条使用脚本不支持的开关**（PASS ×9）

**并且实跑了这些命令**（不是只读源码）：

| 命令 | 实跑结果 |
|---|---|
| `--tiers` | `ok: true`，输出全员等级表 |
| `--list` | `ok: true`，`pending_count` 正确 |
| `--grant req_xxx --approver <id>` | 参数解析通过，报「找不到 request_id=req_xxx」（业务层拒绝，非参数错误） |
| `--deny req_xxx --approver <id> --reason ...` | 同上 |
| `--dispatch dsp_xxx --add src/app/ --approver <id>` | 参数解析通过，报「台账里找不到派工 dsp_xxx」 |
| `--tier full --agent <名> --approver <id>` | 参数解析通过，报「批准人 mvs_test 不是台账里存在过的父会话 id（已知：mvs_9bdda202...）」—— **正是 brief 要求的「批准人必须是真实父会话 id」的行为证据** |
| `release-slot --dispatch dsp_xxx` / `--parent mvs_xxx` | 参数解析通过，报「台账里没有这条记录」/「没有匹配到仍在飞的派工」 |
| `--bogus`（反向对照） | 报「未知参数：--bogus」—— 证明上面的「通过」不是因为解析器放行一切 |

**台账未被改动**：全部探针跑完后 `dispatches.json` 的
**sha256 相同、mtime 相同**（`HASH_SAME=True MTIME_SAME=True`）—— 这些是只读验证，没有留下副作用。

### 3.4 README / CHANGELOG 与 `references/contract.md` 口径不打架 ✅

- 契约 `S13.5` 存在且含「护栏不是沙箱」（PASS）
- README 含诚实边界小节（PASS）
- README 明写批准人不能是自称（PASS）／必须是真实父会话 id（PASS）
- README 明写「批准读 ≠ 批准写」（PASS）
- README 的 `full` 例外含第四条（写冲突检测仍按声明的 SCOPE 比对）（PASS）
- 契约写明第四条边界（PASS）、`scope.md` 写明四条例外（PASS）

**「worker 无权改自己的等级」这类按现状不成立的断言：**
README **0 处**；CHANGELOG **2 处，均为引述**（写在「删掉这类断言」的上下文里，不是断言本身）——
校验脚本按「是否出现在引号内」判定，两处都判为引述（PASS ×2）。

### 3.5 断言总数没有被钉死 ✅

README / CHANGELOG 含「**以发布前最后一次实测为准**」，不含任何固定的总条数（PASS）。

### 3.6 回归实测（本轮亲自跑的两遍）

```
node tools/run-tests.mjs --all --root plugin --repo .   # 仓库副本
node tools/run-tests.mjs --all --repo .                  # 安装副本
```

**仓库副本：十一套全部 0 FAIL**（`>>> SHELL ALL PASS`）

| 套件 | pass | fail | 套件 | pass | fail |
|---|---|---|---|---|---|
| chain-test | 47 | 0 | lessons-test | 52 | 0 |
| d27-mut-test | 14 | 0 | records-test | 45 | 0 |
| dispatch-release-test | 30 | 0 | roster-test | 23 | 0 |
| e2e-test | 47 | 0 | scope-amend-test | **67** | 0 |
| guard-test | **199** | 0 | scope-test | 21 | 0 |
| hooks-test | 26 | 0 | | | |

**安装副本：十一套同样全部 0 FAIL**（`>>> SHELL ALL PASS`），与仓库副本**逐项相同**。

> 本报告初稿时安装副本尚落后于仓库（`lessons-test` / `records-test` / `roster-test` 三套 FAIL，
> sha256 差 10 处）—— 根因是**安装副本还没部署**另一名成员的落地改动与本版三个发布文件，
> **不是机制缺陷**。部署完成后复测：两侧均 0 FAIL，sha256 差 **0** 处（见 §4.1）。

本版改动直接涉及的五套（`guard-test` 199、`scope-amend-test` 67、
`lessons-test` 52、`records-test` 46、`roster-test` 23）在**两侧都是 0 FAIL**。

---

## 4. 发现但没改的不一致清单

**只读核对，没有为了「自洽」去改别人的文件。** 以下逐条都写明「谁该改」。

### 4.1 安装副本与仓库副本的 sha256 差异（部署后已归零）

```
REPO=28 INST=28   SHA_DIFF_COUNT=0
```

**部署完成，28 对 28 文件逐字节一致。**

> 本报告初稿时该值为 **10**（本版三个发布文件尚未部署 + 另一名成员的 6 个在途改动 +
> `session-start.mjs` 的 v0.5.5 前半修复尚未部署）—— 那不是内容不一致，
> 是**部署没做**。部署后复测为 0，F5 闭环。

**归属**：前 3 项是本版文件（部署后自然消解），后 7 项是**另一名成员的落地改动 + v0.5.5 前半的修复**——
后 7 项**必须由部署动作消解，不是内容不一致**。**我没有部署**（brief 明确禁止）。

### 4.2 安装副本的 `session-start.mjs` 旧文案（**部署后已消解**）

安装副本第 53 行仍写：

```
node scripts/scope-amend.mjs --tier full --agent <成员名> --approver router
```

而仓库副本已改成「`--approver <本次派工的父会话 id = 你自己的会话 id>`」并补了诚实边界一句
（v0.5.5 前半提交 `be9caa3` 里的父会话侧同步修）。

**这条正是 F1「批准人必须是真实父会话 id」的用户侧落点** ——
若用户照安装副本的旧文案敲 `--approver router`，会被拒（行为正确，但报错会让人一头雾水）。

**归属**：部署动作。**部署已完成，现两侧一致 —— 本条已消解。**

### 4.3 仓库副本 `plugin/scripts/session-start.mjs` 的注入文案与安装副本不一致

同上。**归属**：部署动作。**部署已完成，现两侧逐字节一致 —— 本条已消解。**
README 与契约的口径本身**是**一致的（§3.4 PASS）。

### 4.4 缺陷台账的统计行与明细需复核（他人文件，未改）

`docs/audit/defect-ledger.md` 顶部统计行写「总计 66 条，其中 P0 10 条、P1 28 条、P2 20 条、P3 7 条，
另 D-26 一条为翻案条目（未标严重度）」。

**待复核点**：`10 + 28 + 20 + 7 = 65`，加上 D-26 才 66 —— 数字自洽。
但**本轮新增的 D-44~D-62 共 19 条的状态标注是否与实际落地一致**，
我无法在不动别人文件的前提下逐条判定（台账条目在明细则区）。
**归属**：父会话或台账 owner。**我只读，未改。**

### 4.5 测试用例缺 `MINIMAX_PROJECT_DIR`，变异检验会往**真实项目**的变更账里写假记录（补写轮实测发现）

**现象**：补写轮我实跑 `docs/audit/.tmp-fix/mutation-check.mjs`（8 个变异体）**两次**，
真实项目的 `.superagent/changes.log` 每次多出一行：

```
2026-11-10T11:00:36.364Z | scope | dsp_mwakwy7d_aueohz | grant req_mwakwy8s_t9s44u | by mvs_parent | + ro: .superagent/methods/sa-other.md
2026-11-10T11:05:43.683Z | scope | dsp_mwal3jc0_1xfzg4 | grant req_mwal3jde_bh6ezr | by mvs_parent | + ro: .superagent/methods/sa-other.md
```

`by mvs_parent` 是**测试夹具里的假批准人**，不是真实会话 id —— 这两行不是真实扩权记录。

**根因（已复现）**：

1. `tests/scope-amend-test.mjs:608` 的私有记忆目录 `--grant` 用例只传了 `PLUGIN_DATA`，
   **没传 `MINIMAX_PROJECT_DIR`** —— 而 `scope-amend.mjs` 的 `appendChangeLog()` 写的是
   `projectRoot()/.superagent/changes.log`，`projectRoot()` 在没有 `MINIMAX_PROJECT_DIR` 时
   **回退到 `process.cwd()`**，也就是仓库根 —— 写进了真实项目的变更账，不是沙箱。
   （同一文件 `:617` 的 `--dispatch --add` 用例就传了 `MINIMAX_PROJECT_DIR: envQ.PROJ`。）
2. 平时不暴露：正常跑该用例时，私有记忆目录的扩权**被当场拒绝**，
   `fail()` 在 `appendChangeLog()` 之前就退出了，压根写不到账上。
3. **变异体 M8 回退了这条拒绝**（`if (hitMem) {` → `if (false) {`），
   扩权于是**成功** → 走到 `appendChangeLog()` → 写进真实项目变更账。

**结论**：这是**测试隔离漏项**，不是机制缺陷 —— 机制在两种情况下都表现正确
（正常拒绝；变异体下放行且留痕）。

**归属与处置**：

- 修法在 `tests/scope-amend-test.mjs:608` 补 `MINIMAX_PROJECT_DIR: envP.PROJ` ——
  **该文件不在本轮所有权内，我没改**（brief 明确禁止改 `tests/**`）。
- 这两行假记录在 `.superagent/changes.log` 里 —— **该文件也不在我的 SCOPE 内，我没动**。
  父会话提交时建议把这两行去掉（或整段回退该文件的改动），
  否则变更账里会留下两条不存在的扩权记录。
- **我也因此没有再重复跑这两个变异检验脚本** —— 每跑一次就会多一条假记录。
  复跑命令仍写在 §7，父会话要复跑前建议先修好那个用例。

### 4.6 另一名成员的 `docs/audit/fix-rg01-09.md` 已入库（补写轮时已 commit）

该报告已随 commit `0de4520` 入库（补写轮开始时 `git status` 曾显示未跟踪，现已入库）。
**归属**：父会话已处理。**我没有 git add / commit。**

### 4.7 我自己造成的一处台账噪音（已清理，如实记录）

§3.3 的探针里有一条命令把正则片段写进了 bash 命令文本，被护栏当成了「工作区之外的路径」并
自动记了一条待审请求（`req_mwajf06h_m8pzco`）。
**已用插件自己的 `--deny` 入口关掉**（reason 写明是探针误触发，非真实需求），
并核对台账其余部分未被改动。
**顺带说明**：这条请求是**机制按设计工作**的证据（撞墙自动记账 → 管理员可审可拒），
不是缺陷。

---

## 5. 需要父会话处理的部分

### 第 1 条（**已完成**）：部署 + 重跑两侧回归 + 逐文件 sha256 复核

**父会话已部署，本轮复核结果**：

1. 部署已执行（`node tools/deploy-plugin.mjs`），安装副本 `version` = **0.5.5**；
2. 两侧回归**逐项相同、全部 0 FAIL**
   （`node tools/run-tests.mjs --all --root plugin --repo .` 与 `--all --repo .`）；
3. 逐文件 sha256 比对：**28 对 28 文件，0 处差异**；
4. **最终断言总数仍未钉死** —— CHANGELOG 写的是「以发布前最后一次实测为准」，
   按 brief 要求保持不钉死（断言数随套件增删变动，钉死会被下一个人立刻推翻）。

### 第 2 条（**已完成**）：「另一名成员收尾」已补进 CHANGELOG

父会话追加要求补写后，已在 v0.5.5 条目里补了**两个变更块**（接在原 8 块之后）：

- **变更 9**：记录闸门与统计口径补齐
  （写入者身份 / 段首定位 / 并发写 / 归因 / 私有账闸门 / 取样名额 / 名录去重）
  —— 对应 D-49 / D-50 / D-51 / D-52 / D-53 / D-55 / D-56 / D-57；
- **变更 10**：修并发写时实测发现的四个新缺陷（D-59 ~ D-62，全在 Windows 并发写路径上）。

两段均按本文件的体例写（**改了什么 / 为什么 / 怎么验证**），措辞按我的体例重写，
**没有照抄父会话的概括**。写之前逐条回读报告与源码核对，核对结果见 §1.5。

### 第 3 条（**已消解**）：安装副本 `session-start.mjs` 的旧文案（§4.2）

随部署一并消解 —— 安装副本与仓库副本现已逐字节一致。

### 第 4 条（**仍待处理**）：缺陷台账状态的逐条复核（§4.4）

请台账 owner 或父会话逐条核对 D-44~D-62 的「状态」行与实际落地是否一致
（台账现共 66 条，本轮新增 D-44~D-62 共 19 条）。
**成员自述不算完成，最终以独立验收为准。**

### 第 5 条（**待处理**）：测试隔离漏项 —— 变异检验会往真实项目的变更账写假记录（§4.5）

**要做什么**：

1. 修 `tests/scope-amend-test.mjs:608` 的私有记忆目录 `--grant` 用例 —— 补上
   `MINIMAX_PROJECT_DIR: envP.PROJ`（同一文件 `:617` 的用例已经传了）。
   **该文件不在我的所有权内，我没改。**
2. 处理 `.superagent/changes.log` 里那两行假记录（`by mvs_parent` 是测试夹具的假批准人）：
   建议提交时把这两行去掉，或整段回退该文件的改动 —— 否则变更账里会留下两条**不存在的**扩权记录。
   **该文件也不在我的 SCOPE 内，我没动。**
3. 修好之后，`docs/audit/.tmp-fix/mutation-check.mjs` 才可安全复跑（每跑一次多一条假记录）。

### 第 6 条（建议，非阻塞）：D-58 的后半步

`docs/audit/fix-f1-f5-rg03.md` §1 D-58 明确写了一个**未做的后续**：
若要让「精确的单个私有记忆文件」可读，需要三步一起做 ——
改契约 S13.4 的表 + 范围层读模式放行精确命中 + 第二道防线按「条目来源」区分。
**本次发布没有做这一步**，README 与 CHANGELOG 都按现状写（扩权当场白拒，不承诺可读）。
**是否派单由父会话决定**；若派单，README 的「三条批准口径」第 3 条与契约 S13.4 要同步改。

---

## 6. 验收清单逐条核对

对照 `.superagent/methods/sa-plugin-release.md` 的「验收清单」：

- [x] **plugin.json 的 version 与 CHANGELOG 顶部条目版本号一致** —— 双方均 0.5.5，脚本断言守着（§3.2）
- [x] **plugin.json 的 description 覆盖本次全部行为变更，且未承诺未实现的能力** ——
      七项行为逐条对到代码行（§1.1）；诚实边界按 S13.5 措辞，未承诺「绝对拦得住」
- [x] **CHANGELOG 每条都含「改了什么 / 为什么 / 怎么验证」三要素** —— 8 个变更逐条三要素齐全（§1.2）
- [x] **hooks.json 引用的每个脚本在 plugin/scripts/ 下都真实存在** —— 5 个脚本 0 处悬空（§3.1）
- [x] **README 说明安装位置、启用验证方法、故障排查路径** —— 三节原本就有（§3.1 之前已存在），
      本轮补齐 tier 用法 / 自动审核流程 / 诚实边界三处口径（§1.3）
- [x] **全程只改动 SCOPE 内的文件** —— 见 §2；git status 复核过，
      本轮只碰 `plugin/.minimax-plugin/plugin.json`、`plugin/CHANGELOG.md`、`plugin/README.md`
      与新增的 `docs/audit/release-v055.md` + 草稿区 `docs/audit/.tmp-release/`

**额外自查（brief 的包内自洽性四项）**：
manifest/hooks 引用存在 ✅、版本号一致 ✅、README 命令与脚本开关一致 ✅、README/CHANGELOG 与 contract.md 口径一致 ✅
—— 见 §3.1~§3.4，全部为实跑结果。

---

## 7. 复跑方式（第三方可复核）

```powershell
# 包内自洽性（34 条断言）
node docs/audit/.tmp-release/check-selfconsistency.mjs 'C:/Users/yang2/Documents/MiniMax/mini code的插件'

# 回归（仓库副本 / 安装副本）
node tools/run-tests.mjs --all --root plugin --repo .
node tools/run-tests.mjs --all --repo .

# 副本一致性（发布前应输出 SHA_DIFF_COUNT=0）
$a = Get-ChildItem -Recurse -File plugin
$inst = "$env:USERPROFILE/.minimax/plugins/super-agent-router"
$d = 0
foreach ($f in $a) {
  $rel = $f.FullName.Substring((Resolve-Path plugin).Path.Length + 1)
  $p2 = Join-Path $inst $rel
  if (-not (Test-Path $p2)) { $d++ }
  elseif ((Get-FileHash $f.FullName -Algorithm SHA256).Hash -ne (Get-FileHash $p2 -Algorithm SHA256).Hash) { $d++ }
}
"SHA_DIFF_COUNT=$d"
```

---

## 8. 自评：这版还差什么

- **本轮三件交付物（版本号 / CHANGELOG / README）+ 包内自洽性校验都做完了**，
  每条结论都有实跑输出或读回内容支撑。
- **没做的**：部署、git 提交、另一名成员的 CHANGELOG 段落、断言总数实测值 ——
  前两项按 brief 归父会话，第三项是 brief 明确要求留给父会话，第四项须等部署后才有最终值。
- **本版没有钉死断言总数**，这是有意的：brief 明确指出这一版断言数随另一名成员收尾而变，
  钉死会被下一个人立刻推翻。**发布前那次实测值仍需父会话补进 CHANGELOG。**
