# v0.5.5 独立复验报告（21 条定向修复）

- 验收方：verifier（独立验收角色，与两份修复报告的作者互不通信）
- 复验对象：`docs/audit/fix-f1-f5-rg03.md`、`docs/audit/fix-rg01-09.md`（**待验对象，不是证据**）
- 台账：`docs/audit/defect-ledger.md` 第八节 D-44~D-64 共 21 条
- 上一轮：`docs/audit/verification-v054.md`（VERDICT: FAIL）
- 日期：2026-11-10
- 铁律遵守：仓库工作树零改动（`git status --short` 唯一变化是 `.superagent/changes.log`，其 4 行新增早于本轮、来自父会话自身的批准，与本轮无关 —— 见 A12）；所有写入只发生在 `docs/audit/.tmp-v055/` 与本报告；未 commit / push / 部署。

---

## 0. 结论表（AC → 判定 → 一句话依据）

| AC | 判定 | 依据（亲眼见过什么） |
|---|---|---|
| **A1 回归（两副本各十一套 0 FAIL）** | **PASS** | 我自己写的 wrapper（`docs/audit/.tmp-v055/run-regress.mjs`）跑完：仓库副本 11 套全绿、安装副本 11 套逐项相同，共 572 条断言、0 FAIL；CHANGELOG **没有**钉死总数（写「全量断言总数以发布前最后一次实测为准…本条目不写总数」）；README「v0.5.5」== `plugin.json` 的 `"version": "0.5.5"` |
| **A2 F1 主防线** | **PASS（有残余 F-01）** | 真实运行时我本会话内实测：子代理执行缓存树里的 `scope-amend.mjs` → 被「权威面脚本」规则当场拒（4 种 `~/$HOME/%USERPROFILE%/$env:USERPROFILE` 写法同样被拒）；父会话不被这条规则拦；工作区同名副本不误拦。**但**该规则只锚定「运行中 guard 自己所在的那一份」，仓库副本在 SCOPE 覆盖时整条提权链实测跑通（F-01） |
| **A3 F1 纵深（批准人=真实父会话 id）** | **PASS** | `--grant`/`--deny`/`--tier`/`--dispatch --add` 四条路我都用伪造批准人试过，全部拒且文案点名真实父会话 id；用真实 id 全部放行；文档口径统一写「纵深防御 / 不是主防线 / 不得写成绝对禁止」（contract.md:374-375、README.md:362-363、CHANGELOG.md:36） |
| **A4 F2（`--grant` 对已结束派工）** | **PASS** | done 与 aborted 各测：请求仍 `pending`、文案与「直接加条目」分支**逐字同口径**（「派工 d1 已结束（state=done）—— 事后再补权限没有意义，请重新派工」） |
| **A5 F3（full 命中私有状态目录的文案）** | **PASS** | 探针实测拒语文案含「私有状态目录」、**不含**「工作区之外」、**不含** `--grant` 批准提示；对照组（工作区外路径）仍给批准提示 |
| **A6 D-58（第二道防线按形态判 + 范围层口径）** | **PASS** | 精确文件条目不触发防线（worker 不卡死）、目录条目仍拒绝建边界、私有记忆目录扩权当场白拒（`--grant` 与 `--dispatch --add` 都被拒、请求仍 pending）。**我独立确认了父会话的说法**：`lib.mjs:222` 对私有记忆路径「一律不授予」，所以「精确只读扩权」在范围层确实读不到 —— 修复报告如实写明了这一点，没有粉饰 |
| **A7 RG-03（legacy 行不得提升成 done）** | **PASS** | 直接调 `readLedger()`：缺 `parent_session_id` 且 `state=active` 的旧行迁移后**仍是 active**，并标 `legacy=true`；缺 `state` 的旧行仍落 done（防锁死语义保留） |
| **A8 tier 快照** | **PASS** | 派工记录带 `tier`；会话中途提权对**已在飞**会话不生效（读白名单外文件仍被拦）；重新派工按新等级（`tier=full`） |
| **A9 D-49~D-53 / D-55~D-57** | **PASS** | 8 条逐条实测：冒名写兄弟成员的账被拒**且受害文件未被创建**（错题本侧 + 履历侧各验）；段首定位行首锚定、写入后 readRecords **读得出来**；真并发 12×3 轮**每轮 12/12 条都在、ok 数==落盘数**；归因拦截甩锅**且反向放行认错**；私有账闸门七字段/编号不跳号/上限 50/留痕/成员写它要拒全过；取样名额单一常量（CLI 与注入层同源 = MAX_ROSTER = 12）；名录重名去重**并显式报出** `duplicateNames` |
| **A10 D-59~D-62（Windows 并发写四缺陷）** | **PASS（实现正确，区分力缺口 F-02）** | 四处实现都在代码里（rename 重试 40 次 / 校验失败回滚 / 抢锁 EPERM 一律当「暂时拿不到」/ 超时 60s 与偷锁 180s）。**我自己回退实现实测**：D-59、D-60、D-62 回退后回归套件**一条都不红**（无断言钉住它们），D-61 仅靠 D-52 的并发断言间接暴露，且该暴露**时敏**（一次 2 红、另一次 0 红）—— 与修复报告自述一致 |
| **A11 D-63（部署工具判归属）** | **PASS** | 真实 `tools/deploy-plugin.mjs` 在**宿主机同形布局的沙箱**里跑（`USERPROFILE` 重定向）：输出 `CACHE_SYNCED trees=1 skipped=1 [... -> superpowers]`，**别人的树 5 个文件逐字节未变**，本插件树的过期文件被删。宿主机上 superpowers 6.2.8 的树真实存在（57 文件） |
| **A12 D-64（回归不污染真实变更账）** | **PASS** | 跑前 `.superagent/changes.log` = 21 行 / 20 非空 / **0** 条 `by mvs_parent`；跑完（两副本各十一套）仍是 21/20/**0**，行数与内容未变 |
| **A13 文档—代码一致** | **PASS** | 「按现状不成立的断言」已清干净（残留的 `worker 无权改自己的等级` 只出现在「不得写成…」的否定句里）；full 例外**各处都是四条**；「批准人必须是真实父会话 id」各处口径一致，**没有**任何地方教 `--approver router` |
| **A14 台账与代码相符** | **FAIL** | 台账统计行**不自洽**：标题写「P0 10 条 + D-26 未标严重度」，实测明细区 P0 **11 条**、D-26 **标着 P0**；索引表只列 62/68 条（缺 D-25、D-26、D-25b~e）；D-50 的状态描述与代码相反（F-03） |
| **A15 区分力（回退实现后断言是否真红）** | **PASS（一条时敏不稳，见 §2 F-02）** | 我在草稿区复制 plugin/ 后回退：F1 主防线 → 1 条红、D-52 并发写 → 2 条红、D-58 第二道防线 → 1 条红（另 D-49/D-51/D-53/D-55 各有红）→ **新断言不是恒绿空断言**；但 D-59/D-60/D-62 回退后**一条都不红**（无专属断言），D-61 回退**时敏**：一次跑出 2 条红、另一次跑出 0 条红 |

**总计**：AC 15 项，PASS 14、FAIL 1（A14）；另记录 4 条新发现缺陷（F-01~F-04）。

---
## 1. 逐条结论（21 条缺陷，D-44~D-64）

**证据档位标注**（每条结论后面标）：`[见]` = 本轮我自己跑出来的运行时/探针输出；`[码]` = 我本轮亲自读过的代码行；`[推]` = 由代码与实测推断、未单独取证；`[未验]` = 未验证。

编号映射取自台账第八节的对照表（`docs/audit/defect-ledger.md:760-783`）：F1→D-44、F2→D-45、F3→D-46、F4→D-47、F5→D-48；RG-01→D-49、RG-02→D-51、RG-03→D-54、RG-04→D-53、RG-05→D-52、RG-06→D-50、RG-07→D-55、RG-08→D-56、RG-09→D-57；D-58~D-64 为本轮新增。

### 1.1 总表

| 台账号 | 原编号 | 判定 | 关键证据 |
|---|---|---|---|
| D-44 | F1 | **PASS（残余 F-01）** | `[见]` 真实运行时：子代理执行 hook 缓存树里的 `scope-amend.mjs` → 被「权威面脚本」规则当场拒；`~`/`$HOME`/`%USERPROFILE%`/`$env:USERPROFILE%` 四种家目录写法同样被拒。`[见]` 父会话（载荷无 `agent_type`）不被该规则拦；工作区同名副本不误拦（`probe-final.mjs` TOTAL_FAIL=0）。`[码]` `guard.mjs:297-303`（权威脚本名单）、`:307-315`（插件根按 `process.argv[1]` 反推）、`:318-331`（家目录展开）、`:566-576`（bash 分支最前拦截）。`[见]` **残余**：锚点只覆盖运行中 guard 自己那一份 → 仓库副本整条提权链实测跑通（F-01） |
| D-45 | F2 | **PASS** | `[见]` `--grant` 对 done / aborted 派工各测：请求仍 `pending`，拒语文案与「直接加条目」分支**逐字同口径**（探针打印两串完全相同）。`[码]` 两条路径共用同一段派工状态检查：`lib.mjs:694-699`（文案）、`scope-amend.mjs:306`（同口径） |
| D-46 | F3 | **PASS** | `[见]` full 等级命中 `.superagent/roster.json` → 文案含「私有状态目录」、**不含**「在工作区之外」、**不含** `--grant` 批准提示；对照组（工作区外路径）仍给批准提示。`[码]` `guard.mjs:435`（为什么要分型）、`:458`（私有状态目录口径）、`:468`（私有目录一律不能批准） |
| D-47 | F4 | **PASS** | `[见]` 两条扩权路径（`--grant` / `--dispatch --add`）对已结束派工给出**同一句**拒文，且都记账不生效。`[码]` `scope-amend.mjs:31`（契约口径）、`:306`（实现） |
| D-48 | F5 | **PASS** | `[见]` 仓库副本 28 文件 ↔ 安装副本 28 文件：`diffs=0 missing=0 extra=0`；4 棵被租用缓存树（本插件的）各 28 文件同样 `diffs=0`；第 5 棵是 superpowers（不同插件，被跳过）。`[见]` `plugin.json` 版本 = `0.5.5` |
| D-49 | RG-01 | **PASS** | `[见]` 错题本侧与履历侧冒名写入**都被拒**，且**受害文件未被创建 / 未被写入**（`exists=false`、受害履历仍只有 `## 实战记录` 段头） |
| D-50 | RG-06 | **PASS** | `[见]` 三态注入实测：无错题本 → 「还没栽过跟头」；文件已建但抽不出规则 → 文案点明「抽不出…不是还没栽过跟头…待查」。`[码]` `dispatch.mjs:276-278` 走 `lessonsStatusLine` 统一出口 → **台账 `defect-ledger.md:852` 说「注入层接线未做」与代码相反（F-03）** |
| D-51 | RG-02 | **PASS** | `[见]` 段首行首锚定：新履历落在真正的 `## 实战记录` 段内（sec=51 < new=79），段内计数 1+1=2，`readRecords` 回读得到 2 条且新条目字段完整（title/evidence/verified）。`[码]` `lessons.mjs:103` 注释指明「读取端按行首匹配 —— 同一份文件两套口径（D-51）」 |
| D-52 | RG-05 | **PASS** | `[见]` **真并发**（异步 `spawn`，非 `spawnSync`）12 次 × 3 轮：每轮 `ok=12 count=12 missing=[]`，ok 数 == 落盘数。`[见]` 回退锁机制后同一套件**变红**（最少落盘 3 条 / 2 条）→ 断言有区分力 |
| D-53 | RG-04 | **PASS** | `[见]` symptom / rule / next_time 三处甩锅**都被拒**（文案：归因指向 Router 自身…按契约 S9 应记进 `_router.md`）；反向「按 brief 做了但没回显口径」**放行**（拦甩锅、不拦认错）。`[码]` `lessons-gate.mjs:162-163` |
| D-54 | RG-03 | **PASS** | `[见]` 缺 `parent_session_id` 且 `state=active` 的旧行，迁移后**仍是 active**（不得提升成 done）且标 `legacy=true`；带 `session_id` 的 legacy 行 `parent_session_id` 被补成 `sess_legacy_1`；缺 `state` 的旧行仍落 done（防锁死语义保留）。`[码]` `lib.mjs:61-87`（迁移只补缺失字段，不改写已声明的状态） |
| D-55 | RG-07 | **PASS** | `[见]` Router 私有账七字段齐全放行；成员会话写 `_router` 拒；编号跳号 / 前缀不一致 / 状态非法 / 缺字段**全拒**；写进 `.superagent/lessons/_router.md`。`[码]` `lessons-gate.mjs:31`（上限 50）、`:210`（七字段）、`:225`（状态枚举）、`:252-253`（上限）、`:262`（前缀）、`:265`（不跳号） |
| D-56 | RG-08 | **PASS** | `[见]` `SUMMARY_MAX_MEMBERS === MAX_ROSTER === 12`；注入层默认口径与 CLI 同源（`cli.maxMembers=12`）。`[码]` `records.mjs:56`（单一常量）、`roster.mjs:20`（MAX_ROSTER=12）、`gate.mjs:41,77`（注入层同源引用） |
| D-57 | RG-09 | **PASS** | `[见]` 名录含重名 `sa-m02` 时摘要里只出现一次、`totalMembers=3`（不是 4）、`duplicateNames=["sa-m02"]` 显式报出、`omitted/truncated/maxMembers` 披露字段保留。`[码]` `roster.mjs:74`（`duplicateNames`）、`:188-193`（随返回值披露） |
| D-58 | D-58 | **PASS** | `[见]` 精确文件条目**不**触发第二道防线（worker 不卡死）；目录条目仍拒绝建边界；私有记忆目录的 `--grant` 与 `--dispatch --add` 当场白拒且请求仍 pending。`[码]` `lib.mjs:397-414`（形态判据：只有目录条目才展开成子树）、`lib.mjs:222`（范围层对私有记忆路径一律不授予，`mode='exact'` 除外）、`guard.mjs:230-245`（第二道防线）。**独立确认父会话说法**：`lib.mjs:222` 意味着「精确只读扩权」在范围层读不到 —— 修复报告 `fix-f1-f5-rg03.md:137` 如实写明该偏差，未粉饰 |
| D-59 | D-59 | **PASS（实现正确 / 无专属断言 F-02）** | `[码]` rename 覆盖重试实现到位（`lessons.mjs:474`、`:479-481` 只对 EPERM/EBUSY/EACCES 重试）；`[见]` **回退该实现后回归套件 0 红** → 没有断言钉住它 |
| D-60 | D-60 | **PASS（同上）** | `[码]` 校验失败回滚到位（`lessons.mjs:493-504`、`:508` 与 `:517` 明确「已回滚，判失败，不返回成功」）；`[见]` **回退后 0 红** |
| D-61 | D-61 | **PASS（同上，且时敏不稳）** | `[码]` `EEXIST || EPERM` 一律当「暂时拿不到」（`lessons.mjs:402`）；`[见]` 回退该处后：一次跑出 2 条红（并发落盘 11/12），**另一次跑出 0 条红** → 暴露依赖 Windows open 竞态是否出现，**时敏** |
| D-62 | D-62 | **PASS（同上）** | `[码]` 超时 60s（`lessons.mjs:380-382`）与偷锁 180s 阈值在位；`[见]` **回退后 0 红** |
| D-63 | D-63 | **PASS（未在宿主机执行部署）** | `[见]` 真实 `tools/deploy-plugin.mjs` 在**宿主机同形布局的沙箱**（`USERPROFILE` 重定向 + 真实脚本逐字节复制）里跑：输出 `CACHE_SYNCED trees=1 skipped=1 [sha256-tree-v1-d9614e8f… -> superpowers]`，**别人的树 5 个文件逐字节未变**，本插件树的过期文件被删。`[码]` `tools/deploy-plugin.mjs:21`（归属名）、`:74-75`（owner 不符即 skip）、`:78`（只同步自己的树）、`:81`（输出口径）。`[见]` 宿主机只读盘点：租约树 5 棵 = 4 棵本插件（各 28 文件）+ 1 棵 **superpowers 6.2.8（57 文件）** |
| D-64 | D-64 | **PASS** | `[见]` 跑前 `.superagent/changes.log` = 21 行 / 20 非空 / **0** 条 `by mvs_parent`；跑完（两副本各十一套）仍是 21/20/0。`[码]` 夹具已隔离：`tests/scope-amend-test.mjs:611`（`MINIMAX_PROJECT_DIR: envP.PROJ`）、`:621`（`envQ.PROJ`）—— 修复报告 `release-v055.md:296-320` 当时说「该文件不在我所有权内，没改」，现已被补上 |

### 1.2 需要展开的两处判定

**D-44 / F1：主防线成立，但残余可端到端兑现。**
主防线（`guard.mjs:566-576`）对**运行中 guard 自己所属那一份**插件脚本确实生效：缓存树里的 `scope-amend.mjs` 被当场拒，4 种家目录写法同样被拒（`expandHome` 展开后再比对，`guard.mjs:318-331`）。父会话不受影响（载荷无 `agent_type`）。工作区同名副本不误拦 —— 这是 brief 明确要求的行为。

但「插件根」是按 `process.argv[1]` 反推的（`guard.mjs:307-315`），所以仓库副本 `plugin/scripts/scope-amend.mjs` 与安装副本的 `scope-amend.mjs` **都不在锚点内**。我实测：SCOPE 覆盖 `plugin/scripts/` 的 worker 执行 `--tier full` → **放行** → 真实执行后 `roster.members[0].tier = full`，并留下 `by mvs_parent_e2e` 的变更账。详见 `2 F-01。判定仍为 PASS（主防线确实挡住了它该挡的那一路），残余按新发现缺陷登记，不按 A2 的失败计。

**D-59~D-62：实现正确，但没有自己的断言。**
四处实现都在代码里（见上表）。我把每一处单独回退后跑回归套件：**D-59 / D-60 / D-62 回退后一条都不红**；D-61 回退后**时敏**（一次 2 红、一次 0 红）。也就是说这四条的「修好了」目前**没有回归断言兜底** —— 修复报告 `fix-rg01-09.md` 自述「不是逐条变异证明」，与此相符（我独立确认）。这是区分力缺口，不判实现失败 → F-02。

### 1.3 我自己探针的六处夹具误判（自曝，避免把「红」误读成「缺陷」）

复验过程中我的早期探针出现过 6 处**假红**，全部是夹具写错，不是产品缺陷。逐条列出并给出产品侧反证：

| # | 探针 | 假红现象 | 根因（夹具错） | 产品侧反证 | 修正后 |
|---|---|---|---|---|---|
| 1 | `probe-a9a.mjs` D-51 | 「写入失败：执行者不可自证」 | 夹具用 `verified_by: 'sa-one'`（执行者自证） | 闸门文案就是「验收人不能是执行人自己 —— 执行者不可自证」，**拦得对** | 加一条 `sa-verifier` 的 done 派工记录后放行 |
| 2 | `probe-a9a.mjs` D-52 | 「落盘 0/12」 | 计数正则写成 `/^### /`（错题本条目头是 `##`） | 同一次输出里 `missing=[]` 却 `count=0` —— 探针自相矛盾 | 正则改 `/^##[ \t]+\d{4}-\d{2}-\d{2}/` → 12/12 × 3 轮 |
| 3 | `probe-a9b.mjs` D-57 | `totalMembers=0`、members 空 | 夹具没给成员建方法论文件，摘要按「有记录才入选」过滤 | `duplicateNames` 仍报出 `sa-m02` → 名录确实读到了 | 补方法论文件 → totalMembers=3 |
| 4 | `probe-a7-a8.mjs` A7 | 「legacy 行补了 parent_session_id :: pid=」 | 夹具的 legacy 行**没有** `session_id`，而 `lib.mjs:82` 就是 `parent_session_id = String(d.session_id || '')` —— 无来源可补 | 同行 `legacy=true`、`state=active`，迁移语义正确 | legacy 行补上 `session_id` → `pid=sess_legacy_1` |
| 5 | `probe-a7-a8.mjs` A8 | 「重新派工按新等级 :: tier=scoped」 | 第二次派工用了与在飞派工**重叠**的 SCOPE → 被组队冲突闸门拒（`dispatch.mjs:165-176`），读到的是旧记录 | 闸门文案「组队冲突：本次派工的 SCOPE 与仍在飞的 … 派工重叠」 | 第二次派工改用不重叠 SCOPE → `tier=full`，记录数 2 |
| 6 | `probe-a9-v2.mjs` D-51 | 「readRecords 读到 0 条」 | 进程内 import `lessons.mjs` 时没设 `MINIMAX_PROJECT_DIR`（该模块 `lessons.mjs:24` 用它定位项目目录）→ 读到仓库真实目录 | 写入返回 `records:2`，文件里确有新条目 | 设上环境变量 → 回读 2 条且新条目字段完整 |

**合并后的权威探针**：`docs/audit/.tmp-v055/probe-a9-v5.mjs`（D-49 两侧 / D-50 / D-51 / D-52 / D-53 / D-55 / D-56 / D-57）→ **42 条断言、0 FAIL**。修正后的 A7/A8 探针：`probe-a7-v2.mjs`（8 条 0 FAIL）、`probe-a8-v2.mjs`（10 条 0 FAIL）。

## 2. 新发现缺陷

### F-01（P1）权威面脚本的判定锚点只覆盖「运行中 guard 自己那一份」→ 整条提权链在仓库副本上跑通

- **触发条件**：worker 的 SCOPE 覆盖插件脚本目录（例：`plugin/scripts/`），且它知道父会话 id（**worker 一定知道**：派工原文里就带 `PARENT SESSION:`）。
- **观察到的后果**：worker 执行仓库副本的 `scope-amend.mjs --tier full --agent <自己> --approver <父会话 id>` → 运行时 guard **放行**（`authority=false deny=false`）→ 真实执行后该成员等级变 `full`、`granted_by=<父会话 id>`、`.superagent/changes.log` 留下 `tier | sa-w | scoped -> full | by mvs_parent_e2e`。等级快照只对**已在飞**的会话有效（`dispatch.mjs:208`/`:239`/`:256`），**下一次派工即按 full 走** → 提权从「一次性」变成「长期」。
- **证据**：`guard.mjs:307-315`（插件根 = `path.resolve(dirname(dirname(process.argv[1])))`）；`guard.mjs:566-576`（bash 分支最前拦截，命中与否取决于上面那个锚点）；探针 `docs/audit/.tmp-v055/probe-d44-e2e.mjs` 的真实输出：

```
GUARD authority=false deny=false
=> 放行。执行该命令（cwd=仓库根，MINIMAX_PROJECT_DIR=沙箱）：
   CLI_EXIT=0 out={ "ok": true, "agent": "sa-w", "tier": "full", "changed": true, "before": "scoped", … }
   ROSTER_TIER=full granted_by=mvs_parent_e2e
   LOG=2026-11-10T11:56:05.714Z | tier | sa-w | scoped -> full | by mvs_parent_e2e
```

- **最小复现步骤**：
  1. 沙箱项目目录放 `.superagent/roster.json`（成员 `sa-w`，`tier=scoped`）；`PLUGIN_DATA` 台账里放一条 `state=active`、`parent_session_id=mvs_parent_e2e` 的派工。
  2. transcript 里 worker 的派工原文写 `SCOPE: plugin/scripts/` 与 `PARENT SESSION: mvs_parent_e2e`。
  3. 以 `agent_type=worker` 调用**运行时那份 guard**（hook 缓存树里的 `scripts/guard.mjs`），`tool_input.command = 'node plugin/scripts/scope-amend.mjs --tier full --agent sa-w --approver mvs_parent_e2e'` → 输出不含 `deny`，也不含 `权威面脚本`。
  4. 真正执行该命令 → `roster.members[0].tier = full`。
  5. 重新派工同一成员 → 派工记录 `tier=full`（快照生效于下一次派工）。
- **与修复报告的差异**：`fix-f1-f5-rg03.md:56-57` 与 `:235-236` **已如实写明**「工作区里的同名副本不拦…仍是提权路径，已被批准人校验与等级快照削弱，但不是零」。我的独立结论是：这条残余**比文字描述更实** —— 「批准人必须是父会话 id」在 worker 手上有 `PARENT SESSION:` 时**根本不构成阻拦**（照抄即可），「等级快照」只把生效时点推后一次派工。因此它不是「被削弱」，而是**完整可兑现**。修复报告的诚实边界表述没有错，但读者容易低估其严重度。

### F-02（P2）D-59 / D-60 / D-62 三条修复没有自己的断言；D-61 的暴露时敏不稳

- **触发条件**：任何人把 `lessons.mjs` 里 rename 重试、回滚、偷锁阈值三处回退，回归套件**不会红**。
- **观察到的后果**：这三条修复在未来重构中会被静默丢弃，且**没有测试会告诉任何人**。
- **证据**：变异矩阵 `docs/audit/.tmp-v055/mut-results.txt`（本轮重跑一致）：

```
=== M4-D59-noretry       suite=lessons-test pass=52 fail=0
=== M5-D60-norollback    suite=lessons-test pass=52 fail=0
=== M7-D62-shorttimeout  suite=lessons-test pass=52 fail=0
=== M8-D62-stalethresh   suite=lessons-test pass=52 fail=0
=== M6-D61-eexistonly    suite=lessons-test pass=52 fail=0   ← 上一轮同一变异体曾跑出 2 条红
```

- **最小复现步骤**：`node docs/audit/.tmp-v055/mutation-check.mjs`（变异定义在 `mut-spec.json`，跑在草稿区副本上，仓库零改动），看 M4/M5/M7/M8 四行的 `fail=0`。
- **说明**：修复报告与 CHANGELOG 都已自述「本轮不是逐条变异证明」，我这里是**独立确认**，并把「D-61 的暴露依赖 Windows open 竞态是否出现」这一时敏性也记下来。

### F-03（P2）缺陷台账与代码不符，且台账自身统计不自洽（A14 的具体项）

- **触发条件**：任何人按台账统计行判断「P0 有几条」，或按 D-50 的状态行判断「注入层接线是否做了」。
- **观察到的后果**（三处，均为**亲眼见过**的硬伤）：
  1. **统计行与明细区对不上**：`defect-ledger.md:7` 写「总计 68 条…其中 **P0 10 条**…**另 D-26 一条为翻案条目（未标严重度）**」；实测明细区 68 条的严重度分布是 **P0 11 / P1 29 / P2 21 / P3 7**，且 D-26 的来源行（`:376`）明写「**严重度：P0（原判 P1…）**」—— 「D-26 未标严重度」与代码事实相反，差数正好是 D-25 / D-26 / D-25b / D-25d 四条。
  2. **索引表漏 6 条**：第一节索引表只有 **62** 行，缺 **D-25、D-26、D-25b、D-25c、D-25d、D-25e**（明细区 68 条，无「索引有而明细没有」的条目）。
  3. **D-50 状态描述与代码相反**：`defect-ledger.md:852` 写「**注入层接线未做**（`dispatch.mjs:276-277` 仍是老的硬编码文案，没调用 `lessonsStatusLine`）」，而 `dispatch.mjs:276-278` 现在正是「注入层别自己拼文案…（D-50）」的注释 + `blocks.push(lessonsStatusLine(...))`。**接线早已做掉**，台账没跟上。
- **最小复现步骤**：`node docs/audit/.tmp-v055/probe-ledger2.mjs`（输出 `INDEX_ROWS=62`、`DETAIL_SEV {"P0":11,"P1":29,"P2":21,"P3":7}`、`DETAIL_NO_SEV []`、D-01/D-26 的来源行原文）、`node docs/audit/.tmp-v055/probe-ledger4.mjs`（输出 `MISSING_FROM_INDEX=["D-25","D-26","D-25b","D-25c","D-25d","D-25e"]`）。
- **旁证**：`docs/audit/release-v055.md:288-291` 里，发布者自己就写了「缺陷台账的统计行与明细需复核（他人文件，未改）…我只读，未改」—— 说明这个不自洽在发布前**已被看见但未修**。

### F-04（P3，次要）SCOPE 解析对「含空格的绝对路径」静默截断

- **触发条件**：SCOPE 里写含空格的绝对路径（**本仓库自己的路径就含空格**：`C:\Users\yang2\Documents\MiniMax\mini code的插件\…`）。
- **观察到的后果**：该条目被截成 `C:\Users\yang2\Documents\MiniMax\mini`，剩余部分**静默丢弃**（`rejected=[]`），随后 `inScope` 对真实目标返回 `false` → 一条本应生效的白名单**不生效**（判成越界）。
- **证据**：`plugin/scripts/lib.mjs:340-362`（`extractScopeDetail` → `collectScopeTokens` → 按空白切 token）；探针 `docs/audit/.tmp-v055/probe-f04.mjs` 真实输出：

```
INPUT=SCOPE: C:\Users\yang2\Documents\MiniMax\mini code的插件\src\app.ts
PARSED={"entries":["C:\Users\yang2\Documents\MiniMax\mini"],"rejected":[]}
REL_PARSED={"entries":["src/app.ts"],"rejected":[]}
  field entries[] = [...]  -> inScope(absTarget)=false
```

- **最小复现步骤**：运行 `node docs/audit/.tmp-v055/probe-f04.mjs`（只读，只 import `lib.mjs`）。
- **性质**：**既有行为**，不属本轮 21 条修复的范围；影响面我**未系统评估**（只验了「绝对路径 + 含空格」这一种形态）。相对路径写法（`src/app.ts`）不受影响。

## 3. 未验证边界（如实列出，不含糊）

1. **未在宿主机上执行真实部署**。`tools/deploy-plugin.mjs` 对安装副本是写操作，且本会话 SCOPE 对安装副本为 `ro:`。A11 改用「真实脚本逐字节复制 + `USERPROFILE` 重定向 + 宿主机同形布局沙箱」验证归属判定，并另做**只读**盘点（租约 5 棵：4 棵本插件各 28 文件 + 1 棵 superpowers 6.2.8 共 57 文件）。**「真实部署后别人缓存树仍完好」这一条我没有在宿主机上亲眼见过**，只在同形沙箱里见过。
2. **D-59 / D-60 / D-62 无专属断言**（F-02）；D-61 仅靠 D-52 的并发断言间接暴露，且时敏。
3. **F-01 的提权后果只在沙箱项目目录复现**，没有在真实项目的 `.superagent/roster.json` 上复现（避免污染真实名录）。真实名录是否被同一条路径攻破，属**推断**（代码路径相同），未实证。
4. **F-04 的影响面未系统评估**（未测相对路径含空格、目录条目含空格、`ro:` 前缀等其它形态）。
5. **「没有任何地方教 `--approver router`」这条阴性结论的覆盖范围**：我在 `plugin/`（含 `README.md`、`CHANGELOG.md`、`references/{contract,scope}.md`、`scripts/session-start.mjs`）、安装副本、以及 `docs/audit/` 三处 grep 过；命中只有三类：`CHANGELOG.md:27`（**记录「不再教」这条修复**）、`CHANGELOG.md:149/156` 与 `contract.md:395`（**否定句**「这句话按现状不成立」）、`docs/audit/release-v055.md:269`（**引用旧安装副本的错误文案**作为反例，并在 `:276` 说明「照敲会被拒」）。仓库根其它目录不在本会话 SCOPE 内，**未覆盖**。
6. **只验证了 Windows**（win32 / PowerShell 5.1 / Node v26.7.0）。Linux/macOS 行为**未验证**。
7. **A2 的「真实运行时被拒」观察**发生在本会话早期的 bash 通道（真实 hook 触发），本轮后半段未再重复触发；合成载荷复核用 `probe-final.mjs`（0 FAIL）。
8. **运行时 hook 缓存台账**（`plugin-hook-cache/*/dispatches.json`）有一次读取失败（Unexpected end of JSON input）—— 属运行时现象，**不在本轮 21 条范围内**，未追查。
9. 我**没有**逐段审阅两份修复报告的**全部**叙述性内容；对它们的态度是「待验对象，不是证据」，只当索引对照。

## 4. 改判条件

当前判定 **FAIL**（A14 FAIL + F-01 未收口 + F-02 区分力缺口）。按以下条件可改判：

**改判为 PASS_WITH_RESIDUAL 的最小条件（两条都要满足）**
1. **A14 三处台账自洽性修好**：① 统计行改成与明细区一致的「P0 11 条」（或把 D-26 严重度改回「未标」并同步改回 P0 10）；② 索引表补齐 D-25 / D-26 / D-25b / D-25c / D-25d / D-25e 六行（62 → 68）；③ D-50 状态行改为「注入层已接线（`dispatch.mjs:278` 调 `lessonsStatusLine`）」。
2. **F-01 与 F-02 被如实登记并给出处置**：F-01 要么补机制（权威面脚本判定改为按**文件内容哈希/签名**而不是路径锚点；或批准人改为父会话一次性令牌/签名，使 worker 拿不到可用批准凭据），要么在契约 S13.5 里把残余明确写成「可端到端兑现的提权路径」并写明补偿措施；F-02 至少为 D-59 / D-60 / D-62 各补 1 条专属断言，让它们回退后必红。

**改判为 PASS 的追加条件**
- 上述之外，F-01 完成**机制层收口**（不是只改文字），且 A15 变异矩阵 12 个变异体**全部**能稳定变红（含 D-61 的时敏问题被固定住），并留一次真实运行时触发记录；
- 台账的统计行与索引表能由**脚本**自证一致（可把本轮的 `probe-ledger*.mjs` 固化进回归）。

**保持 FAIL 的条件**
- A14 上述三处任一处仍与代码/明细区矛盾；
- F-01 仍可端到端兑现，且文档仍把残余写成「被削弱」而非「可兑现」；
- A10 的三条（D-59/D-60/D-62）仍无专属断言。

---

**结论**：21 条定向修复的**实现**我逐条独立验证，19 条完全成立（D-44 成立但有可端到端兑现的残余 F-01；D-59~D-62 实现正确但无自己的断言 F-02）；**回归**在仓库副本与安装副本各 11 套全绿（572 条断言，0 FAIL），且不污染真实变更账。**不通过的是台账与文档的自洽性（A14）**：统计行与明细区相差 4 条 P0、索引表漏 6 条、D-50 状态描述与代码相反 —— 这是「按现状不成立的断言」这一类问题在本轮**仍然存在**的新实例。

**VERDICT: FAIL**
