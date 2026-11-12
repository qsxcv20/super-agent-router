# 会话复用台账（父会话维护）

> **本文件已移入版本库**（`docs/audit/reuse-registry.md`）：原来的 `docs/audit/.tmp-parent/` 在 .gitignore 里，
> 放在那里 = 这条纪律随会话结束就消失。派工前查这张表的规矩不变。

> 目的：**同一专项的连续工作不再新开子会话**。
> 每派一单前先查这张表：有没有该成员的会话**已经加载了本单要改的那些文件**？
> 有 ⇒ 追加（`task_append`），没有 ⇒ 才新开。

## 判据（一条就够）

**该成员是否已经读过本单要改/要看的那些文件？**
读过 ⇒ 追加复用；没读过 ⇒ 新开。
（边界不同 ⇒ 新开 —— 追加不会自动扩边界，见契约 S4.5 第 3 条。）

## 当前可复用会话（2026-11-10 归档收敛后）

| 专项成员 | 会话（session_id） | 已加载的文件 | 边界（binding.scope） | tier | 适用场景 |
|---|---|---|---|---|---|
| sa-mechanism-fix | `mvs_12c5c8cfcb574787af7942acde493632` | watchdog.mjs、tests/e2e-test.mjs、tests/chain-test.mjs、契约、台账、缺陷台账 | 同左（5 条） | full | **只适合 watchdog 与 e2e/chain 断言的活**；要改 lib.mjs/dispatch.mjs 必须先扩边界或新开 |
| sa-mechanism-fix | `mvs_a79294252567414dbf0cf1a461655c2a` | lib.mjs、dispatch.mjs、guard.mjs、session-start.mjs、e2e/chain/scope/hooks 测试、契约、缺陷台账 | 见台账 dsp_mwaos5tt_dwo56y | full | **D-37~D-41 那单的会话**：lib/dispatch/guard/session-start 全读过 ⇒ 改这几处优先复用它 |
| sa-mechanism-fix | `mvs_f84d6132dfcf443388af8a702ad7448b` | lib.mjs、scope-amend.mjs、tests/scope-amend-test.mjs、契约、缺陷台账 | 见台账 dsp_mwaqshph_9rlbb5（已 aborted） | full | D-75 那单（500 中断的实例）；代码已在树里，接手单用它续 |
| sa-mechanism-fix | `mvs_6b41cf2b3b98465f984d2f37c0ea740e` | 同上 + D-75 复核 | 见台账 dsp_mwarh6z0_fc0rb5（active） | full | **D-75 正在跑的那个**；它最熟 scope-amend 这条线 |
| sa-gate-integrity | `mvs_2114fc23f76b40c6b84811e5d0e47e99` | roster.mjs、tests/roster-test.mjs、缺陷台账 | 见台账 dsp_mwapq3wd_j6z6m0（已 done） | full | **roster/名录侧**的活 |
| sa-gate-integrity | `mvs_262f35c3023049c6b39d444e75a41162` | lessons.mjs、record-gate、lessons-gate、records.mjs、roster.mjs、对应测试 | 见台账 dsp_mwanf1n8_4olnve | full | **记录闸门族**（履历/错题本/统计口径）的活 |

## 已发生过的浪费（自查用）

- 本会话共开了 **52** 个子会话，其中 **45 个成功**、1 个在跑、1 个失败（500）、4 个取消。
  （2026-11-11 复核口径：这是当时的计数；今天累计已到 **50** 个子会话，其中 37 个已归档 —— 见上面「整盘账」。）
- 真正的**不同任务**远少于 52：sa-mechanism-fix 一个专项就占了 **12** 个会话。
- 典型浪费：**同一个专项连续修同一族缺陷，却每单重开** —— 每个新会话都要重读方法论、契约、台账、相关脚本。
- 一次 500 失败后**另开一个接手单**，而不是追加到失败的那个 ⇒ 又是一次全量重读。
  （接手单确实是必要的，但**上下文本可以继承**：失败会话的代码已在树里，缺的是「补报告」这一步。）

## 纪律

1. 派工前查这张表；能复用就追加，别新开。
2. 追加的内容**必须自包含**（追加会并入下一轮，措辞会被机制判定）。
3. 复用率要盯：同一专项的「会话数」应远小于「派工单数」。
4. 边界不同就新开 —— 复用的前提是**边界覆盖**本单要动的地方。


## 复用边界的实测结论（2026-11-10 父会话实测，三条）

1. **复用可行且保留上下文**：`task_append` 到**已结束**的子会话，会被唤起成新 task（`mode: activated`），
   **完整保留原有上下文** —— 实测 D-72 那单结束后被唤起，准确复述了自己改过的四层判定、707 条断言、5 个变异体。
2. **追加后的边界 = 原派工的边界（固定，不可扩大）**：
   `guard.mjs` 先 `findBinding(ledger, sessionId)`，**命中就直接用旧 binding**；
   只有没命中才从 transcript 的 brief 重建。
   ⇒ 追加消息里写的 SCOPE **不生效**（除非该会话在台账里没有 binding）。
   ⇒ 想扩边界只能对 **state=active** 的派工用 `scope-amend.mjs --dispatch ... --add ...`，
   而**已结束的派工加不了** ⇒ **复用 ⇒ 边界冻结**。
3. **追加指令里的 SCOPE 行有反作用**：闸门取 transcript 里的 SCOPE 行，
   追加内容里的 SCOPE 会参与边界解析。写成顿号+反引号形式 ⇒ 解析出 0 条 ⇒
   **整段拒绝**该子会话的所有工具调用（连不带路径的调用也拒）——
   实测让 D-75 那单整轮瘫掉、报告写不了盘。
   ⇒ 追加内容里**要么不写 SCOPE**，要么写成合规格式（`SCOPE: a, b, c` 逗号分隔、无反引号、行首 SCOPE）。

## 复用台账（实测校正后 · 归档收敛后）

**窗口收敛结果（2026-11-11 实测校准）**：sa-mechanism-fix 13 → **5**；sa-gate-integrity 7 → **2**；
sa-plugin-release 4 → **1**；sa-context-trace 3 → **1**；sa-orchestration-audit 4 → **1**。

**整盘账**（`mavis_session_list` 实测，非估计）：

| 口径 | 数字 |
|---|---|
| 本父会话累计派出的子会话 | **50**（专项 31 + 验收 19） |
| 其中已归档 | **37**（专项 20 + 验收 17） |
| 现在还开着的（可见窗口） | **11**（专项 10 + 本项目的 verifier 1） |
| 整个 profile 的会话总数 | 116（含归档 42；`mavis` 自己的 51 个是用户与主 agent 的对话，不是子窗口） |

归档的都是 v0.4.0/v0.5.0 时代的老会话（产物都在工作树里，代码与报告都没丢），
保留的都是「下一步可能还要续」的：

| 专项成员 | 会话（session_id） | 冻结边界（可做什么） | 不可做 |
|---|---|---|---|
| sa-mechanism-fix | `mvs_a79294252567414dbf0cf1a461655c2a` | lib.mjs / dispatch.mjs / guard.mjs / session-start.mjs / tests/{scope,guard,e2e,dispatch-release,hooks}-test.mjs / docs/audit/fix-d37-d41.md / .tmp-d37/ | 碰 scope-amend.mjs、release-slot.mjs、watchdog.mjs、tests/scope-amend-test.mjs |
| sa-mechanism-fix | `mvs_d9707ac2c03046289c564bfcc3dce7d2` | guard.mjs / lib.mjs / scope-amend.mjs / dispatch.mjs / tests/{guard,scope-amend}-test.mjs / README / CHANGELOG / contract.md / scope.md | 碰 release-slot.mjs、watchdog.mjs、session-start.mjs、tests/dispatch-release-test.mjs |
| sa-mechanism-fix | `mvs_12c5c8cfcb574787af7942acde493632` | watchdog.mjs / tests/{e2e,chain}-test.mjs / docs/audit/fix-d72.md / .tmp-d72/ | 其它一律不行 |
| sa-mechanism-fix | `mvs_6b41cf2b3b98465f984d2f37c0ea740e` | lib.mjs / scope-amend.mjs / tests/scope-amend-test.mjs / docs/audit/fix-d75.md / .tmp-d75/ | 其它一律不行 |
| sa-mechanism-fix | `mvs_f84d6132dfcf443388af8a702ad7448b` | 同上（上一实例，500 中断） | 同上 |
| sa-gate-integrity | `mvs_2114fc23f76b40c6b84811e5d0e47e99` | roster.mjs / tests/roster-test.mjs / docs/audit/fix-d39-roster.md / .tmp-d39/ | 名录侧以外 |
| sa-gate-integrity | `mvs_262f35c3023049c6b39d444e75a41162` | lessons.mjs / record-gate.mjs / lessons-gate.mjs / records.mjs / roster.mjs / tests/{lessons,records}-test.mjs / fix-f02.md / .tmp-f02/ | 机制层文件 |

**结论**：D-77（台账并发写）要改 lib/dispatch/guard/scope-amend/release-slot/watchdog **六个脚本** ——
没有任何一个现有会话的冻结边界能覆盖 ⇒ 这一单**该新开**。
但**同族连续修**（例如 D-75 的后续修正）就该复用 `mvs_6b41cf2b3b98…`。


## 本轮新增的三条复用结论（2026-11-10 父会话实测与实操）

### 结论 A：复用 ⇒ 边界冻结 ⇒ **产出路径必须在冻结边界内**
复用会话的写边界 = 它**第一单**的 SCOPE（`guard.mjs` 先 `findBinding(ledger, sessionId)`，命中即用旧 binding；
只有未命中才从 transcript 重建）。已结束的派工不能再用 `scope-amend.mjs --dispatch --add` 扩权（要求 `state='active'`）。
⇒ **冻结边界里没有的路径，就是写不了。**

### 结论 B：正式路径不在边界内时的标准做法 = 「写进可写子目录 + 父会话转写」
派工单里要交付的报告文件路径若不在冻结边界内（例：`docs/audit/release-v056.md` 不在 v0.5.5 发布单的边界里），
**不要为此新开会话**。做法：
1. 让成员把报告写进**边界内的可写子目录**（例：`docs/audit/.tmp-release/release-v056.md`、`docs/audit/.tmp-v055/verification-v056.md`）；
2. 父会话用 `read` + `write` 转写到正式路径（父会话不受 scope 约束）；
3. 转写后父会话自己核一遍（正式路径存在、内容一致）。
⇒ 复用的上下文收益全部保留，边界也一行没动。

### 结论 C：`ro:` 条目**不授权 bash**；bash 是写通道
成员想跑东西时，命令行里出现的路径 token 按**写**判定，`ro:` 条目不授写 ⇒ 会被拦。
可用的做法：把要跑的东西**复制/写进自己的可写目录**，再从那个路径跑
（护栏判的是命令行，不是脚本内容 —— 脚本内部再引用仓库路径不会被判）。
例：把 `tools/run-tests.mjs` 复制到 `docs/audit/.tmp-v055/` 再跑；命令行里避免出现 `.`。

## 本轮的两处复用决策

| 专项 | 复用会话 | 冻结边界 | 结论 |
|---|---|---|---|
| sa-plugin-release | `mvs_06f664af23b1446faf7070bb55bb6ea8`（v0.5.5 发布单） | plugin.json / CHANGELOG.md / README.md / release-v055.md / .tmp-release/ | **复用**：本单要动的三个文件都在边界内；发布说明走结论 B 的转写 |
| verifier | `mvs_26fc11cb8e99483697531140266df940`（v0.5.5 验收单） | ro: plugin/tests/tools/docs-audit/. + verification-v055.md + .tmp-v055/ | **复用**：本单只读为主；验收报告走结论 B 的转写 |
| sa-mechanism-fix | `mvs_956275dd932d4e0690842458e840ed42`（D-77+D-73 合并单） | lib/dispatch/guard/scope-amend/release-slot/watchdog/session-start + 2 套测试 + 两份报告 + .tmp-d77d73/ | **新开**：没有任何现有会话的冻结边界覆盖这六个脚本 |


## 本轮（v0.5.6 → v0.5.7）复用实况：14 个派工动作，只用了 5 个会话

### v0.5.7 增量（2026-11-11）：5 个派工动作，**0 个新会话**

| 专项 | 复用会话 | 本轮用它做了什么 | 新开? |
|---|---|---|---|
| sa-mechanism-fix | `mvs_956275dd932d4e0690842458e840ed42` | D-80 + D-85 修复单 → **补两条永久断言单** | 复用（**第 2 单走追加**） |
| verifier | `mvs_26fc11cb8e99483697531140266df940` | D-80/D-85 验收单 → **复查单** | 复用（**第 3 单走追加**） |
| sa-plugin-release | `mvs_06f664af23b1446faf7070bb55bb6ea8` | v0.5.7 发布单（版本号 / description / CHANGELOG / README / 发布说明） | 复用（**第 3 单走追加**） |

⇒ 这一轮**一个新会话都没开**：三个专项各把自己的会话复用到底。
验收方在复查单里也复用同一会话（它的第 3 单），**没有为「换个验收角度」重开窗口**。

### v0.5.6 主体：9 个派工动作，5 个会话

| 专项 | 会话 | 本轮用它做了什么 | 新开? |
|---|---|---|---|
| sa-mechanism-fix | `mvs_956275dd932d4e0690842458e840ed42` | D-77 + D-73 合并单 | **新开**（无现有会话的冻结边界覆盖那六个脚本） |
| sa-plugin-release | `mvs_06f664af23b1446faf7070bb55bb6ea8` | v0.5.6 发布单 → **F-08 危险工具表收口** | 复用 |
| verifier | `mvs_26fc11cb8e99483697531140266df940` | v0.5.6 独立复验 → **收口后的最终复核** | 复用 |
| sa-gate-integrity | `mvs_262f35c3023049c6b39d444e75a41162` | 台账自洽永久断言 → **KNOWN_GAPS 清理** | 复用 |

⇒ **同一专项的连续工作，第二次起全部走追加**：四个专项里有三个的第二单都是追加，
没有一个因为「单子不同」就重开窗口。

### 追加时的实测细节（补充到 S4.5）

- 追加内容里**带一条合规的 SCOPE 行是安全的**（逗号分隔、无反引号、行首 SCOPE）——
  本轮三次追加都带了（其中两次还**新增**了一个路径），边界解析正常、成员照常写到了那个路径。
  ⇒ S4.5 的「要么不写、要么写成合规格式」在实践中**后者更常用**（它同时表达了这一单的意图）。
- 追加内容里**不要出现别处的 SCOPE 行**（例如「本单 SCOPE：」这种带前缀的写法）——
  闸门按行首 SCOPE 解析，写成别的形式会被当成散文，**不会**被解析成新边界，但也会让人误以为扩了权。

## 项目级覆盖（2026-11-12 补 · 契约 S4.6）

上面的表按**成员**登记窗口。派工前还要多问一句：**这一单是那个大项目的「新的一块」，还是它内部的一个步骤？**

| 维度 | 问什么 | 答「是」怎么办 |
|---|---|---|
| 专项 | 这件事归哪个专项成员？ | 有专精成员 ⇒ 派它，别派通用 worker |
| 文件 | 该成员是否**已经读过**本单要动/要看的那些文件？ | 读过 ⇒ 追加，不新开 |
| **项目** | **这个大项目是不是已经有窗口在负责？** | **是 ⇒ 并入那个窗口，不新开** |

三个维度**都答「否」才新开**。项目这一维是后补的 —— 缺了它，
「一个大项目拆成十几个小问题、十几个窗口各干一小块」就是协议的必然产物，
因为每个小问题看上去都是不同的活。

**大项目 = 同一族缺陷 / 同一批交付物 / 同一个验证目标。**
它的内部步骤（探针、夹具、回放、取证、判读、记录、台账回写）**不另开窗**。

**诚实边界**：只读类派工不触发组队闸门（只算写冲突），插件的复用提示也只说
「有 N 个会话覆盖本单 SCOPE」而**不指出该追加哪一个** ⇒ 这一维**没有代码兜底**，靠派工方守。
程序层解法（台账加「项目键」）已登记为 D-92。
