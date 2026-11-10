# v0.5.6 独立复验报告

- 验收方：verifier（独立验收角色；与 v0.5.6 的修复产出作者互不通信）
- 复验对象：**v0.5.6 的代码与文档**（代码是唯一事实源；两份修复报告只当索引，不当证据）
- 上一轮：`docs/audit/verification-v055.md`（VERDICT: FAIL）—— 本轮复验它的 F-01~F-04
- 日期：2026-11-11
- 铁律：生产代码全程只读（`plugin/` `tests/` `tools/` `docs/audit/*.md` 一行未改）；写入只发生在 `docs/audit/.tmp-v055/`（探针 + 本报告）；未 commit / push / 部署 / 改账号成员。
- 证据档位：`[见]` = 我本轮亲自跑出的输出；`[码]` = 我亲自读过的代码行；`[推]` = 由代码与实测推断；`[未验]` = 未验证。
- 探针（本轮新写，均可重跑）：`probe-v056-p1.mjs`（F-01/D-39/D-41/D-40）、`p2`（F-04/D-83/D-82/D-80）、`p3`（P4 的 dispatch 三态）、`p4`（D-73 三态）、`p5`（D-75/D-83/D-84/D-85）、`p6`（watchdog D-72/78/79/81）、`p7`（D-77/D-71）、`p8`（D-39 roster register）、`p9`（台账自洽 F-03）、`p10`（S4.5 复用提示）、`regress-v056.mjs`（逐套回归）、`matrix-v056.mjs`（四个变异矩阵），均在 `docs/audit/.tmp-v055/`。

---

## 0. 结论表

### A 组：上一轮的 F-01~F-04

| 条目 | 判定 | 我实际看到的 |
|---|---|---|
| **F-01** 权威面脚本锚点覆盖仓库副本 | **PASS** | `[见]` 仓库副本 `plugin/scripts/scope-amend.mjs` 被子代理执行 → **被「权威面脚本」规则当场拒**（`authority=false` 变成命中）；安装副本、`$HOME` 写法同样被拒。`[见]` 两条金丝雀：同包内非权威脚本（`plugin/scripts/guard.mjs`）、非插件包里的同名 `scope-amend.mjs` → **都不**被该规则拦（证明判据是「插件包身份」而不是脚本名裸匹配） |
| **F-02** D-59~D-62 各有专属断言 | **PASS** | `[码]` `tests/lessons-test.mjs:589` 起是四条的专属断言段；`[见]` 我逐条回退实现后跑该套件：**5 个变异体全部变红**（D-59→2 红、D-60→1 红、D-61→2 红、D-62 超时→3 红、D-62 偷锁→1 红）；**D-61 连跑 3 轮都红** —— v0.5.5 的「时敏」已由 `SAR_FAULT_INJECT` 确定性故障注入解决 |
| **F-03** 台账自洽三处 | **FAIL** | `[见]` ① 索引表 **88 行**，明细区 **89 条**，**缺 D-25**；② 明细区 **7 条（D-78/79/80/81/83/84/85）没有「来源/严重度」行**；③ 统计行写「P0 11 / P1 35 / P2 31 / P3 12」= 89，与**索引表**吻合，但与**明细区**（P0 11 / P1 35 / **P2 26 / P3 10** + 7 条未标）矛盾 —— 统计行自己写着「统计以本表逐条明细为准」，而明细区算不出这个数 |
| **F-04** 含空格路径不被切开 | **PASS** | `[见]` `SCOPE: C:\Users\yang2\Documents\MiniMax\mini code的插件\src\app.ts` → 整体收成一条，`inScope` 对真实目标返回 true；引号包裹的含空格相对路径同样整体收成一条；不含空格的相对路径仍按空白切（旧语义未变） |

### B 组：v0.5.6 新增修复

| 条目 | 判定 | 我实际看到的 |
|---|---|---|
| **D-37** 账号名单可得时校验成员存在 | **PASS** | `[见]` 派给账号里不存在的成员 → 被拒（文案「目标成员…在账号里不存在…台账不会留下任何记录」），且台账 **0 条记录** |
| **D-38** 陈旧名单与派工侧同源 | **PASS** | `[见]` 名录有、账号无的成员 → 被拒且点名「这是**陈旧成员**」；`staleRosterMembers()` 算出同一集合 `['sa-stale']` |
| **D-39** 建号纳入账号级危险动作 + register 校验 | **PASS**（文档有缺口，见 F-08） | `[见]` 工具名 `mavis_agent_create` 被拒；命令形态 `mavis agent create` 被拒（文案「创建账号级成员是账号级全局可见的变更」）；**父会话（无 agent_type）不受影响**；`roster.mjs register`：账号里存在 → 登记成功；不存在 → 拒（`account_member_missing`）；名单不可得 → 拒（`account_list_unavailable`） |
| **D-40** 只读条目写请求文案分型 | **PASS** | `[见]` 只读条目上的写 → 文案「**在白名单内，但登记为只读条目**（ro:）」，**不含**「不在白名单内」、**不含**申请批准提示；对照组（路径不在白名单内）仍走「不在白名单内」分支 |
| **D-41** 危险词只按命令位置判 | **PASS** | `[见]` `echo "mavis agent delete sa-x"` 与 `grep -rn "mavis agent delete" src` → **不拦**；命令位置上的 `mavis agent delete sa-x` → **被拦** |
| **D-71** 提权留痕只认真实会话 id | **PASS** | `[见]` `--approver router` → 拒（「不是台账里存在过的父会话 id（已知：mvs_parent_p7）」）；真实父会话 id → 放行且 `tier_granted_by = mvs_parent_p7` |
| **D-72** 四层独立规则 | **实现 PASS**（变异体见 §D） | `[见]` 「没有创建 / 不存在 / 并非创建 / 是否…被创建」四种否定与引述句 → **全不拦**；肯定式「我创建了 src/missing.ts」→ 拦且规则编号 `R-CLAIM-PATH-MISSING` |
| **D-73** 三态 + 降级不静默 | **PASS** | `[见]` 24 项断言全过：三态（`account_verified` / `roster_declared` / `unverified`）、降级标记、名录内外**措辞不同**、降级派工**不占累计名额**（counters 为空）**不参与冲突判定**（同 SCOPE 后续派工不被拦）、`gate-trace.jsonl` 带 session/目标/名单状态/原因、**「名录读得到但为空 ⇒ 不降级」**（无【降级提示】、degraded=false） |
| **D-74** hooks matcher 含建号工具名 | **PASS（matcher）/ 子项未验证** | `[码]` `plugin/hooks/hooks.json:62` matcher 含 `mavis_agent_create`。**「该工具名在真实运行时存在」我未验证**：本会话工具清单里没有它（`tool_search` 无命中），本机 `mavis` CLI 也不在 PATH（`CommandNotFoundException`）；台账 `defect-ledger.md:1161` 记录「本机工具清单里**确实有**」—— 属他人取证，我不据此下结论 |
| **D-75** 只读升级显式留痕 | **PASS** | `[见]` `--grant` 批准只读条目上的写请求 → 回执含 `upgraded_paths` / `upgraded_from_readonly`（`from_entry: ro: docs/x.md`）/ `upgrade_notice`；变更账写出 `upgrade readonly -> writable: docs//x.md (from: ro: docs/x.md)` |
| **D-77** 台账写路径串行化 | **PASS** | `[见]` 两个并发写者 → 两条记录都在、各带各的 scope、台账仍是合法 JSON；mutator 抛错 → `ok=false`、**原文件逐字不变**、**锁不泄漏**（后续写入仍成功）；五个写方**无裸 `writeLedger`、无裸 `writeFileSync` 直写台账、台账路径字面量只在 `lib.mjs`**；两个并发同 SCOPE 派工 → **恰好一个**通过冲突检测 |
| **D-78** 路径归属到子句 | **PASS** | `[见]` 同行第二子句（`参考 docs/other.md`）的路径**不被认领**；引用护栏拒绝原文那一行的 `docs/other.md` 也**不被认领** |
| **D-79** block 带规则编号 | **PASS** | `[见]` `R-EMPTY-DELIVERY` / `R-NO-EVIDENCE` / `R-CLAIM-PATH-MISSING` 三条编号实测出现；消息形如 `[规则 R-…]` |
| **D-80** 家目录展开 | **PASS（watchdog 侧）/ 残余仍在（lib 侧）** | `[见]` **残余确实还在**：`lib.absolutizePath('~/.minimax/x.md')` → `C:/work/~/.minimax/x.md`（不展开），`$HOME` 同；watchdog 侧已展开（`expandHomePath`），正反对照：文件存在 → 不拦；把家目录指到别处 → **拦**（证明不是「跳过校验」） |
| **D-81** 通配符按模式 | **PASS** | `[见]` `~.../sha256-tree-v1-*/scripts/watchdog.mjs` → **不被当成文件校验**，不拦 |
| **D-82** 数据目录逐字比目录名 | **PASS** | `[见]` normal=true / spaced=false / slash=true / empty=false / other=false —— 五例全对（带尾随空格的同名目录不再被误判成插件目录） |
| **D-83** 别名不逃逸升级检测 | **PASS** | `[见]` `detectReadonlyUpgrades(['ro: docs/x.md'], [...,'docs//x.md'], ['docs//x.md'])` → 检出 1 条；`'./docs/x.md'` 同；「本来就可写」→ 0 条 |
| **D-84** 变更账写失败不静默 | **PASS（回执如实反映）/ 口径观察** | `[见]` 把变更账做成目录使写入失败 → 回执 `audit_logged=false`（不再吞掉）。**观察**：此时 CLI 仍 **退出码 0、`ok:true`**，只有回执字段如实反映 —— 若父会话认为「报错」应包含非零退出码或 stderr 提示，这一条要按口径再定 |
| **D-85** 空设备重定向 | **已知未修，确认仍在** | `[见]` `echo hi > /dev/null` → **仍被当成写目标**，记一条 pending 越界请求（`targets:['/dev/null']`）。**但台账「永远无法批准」的表述与实测不符**：我实测 `--grant` **成功**（`ok:true`、`added:['/dev/null']`、`audit_logged:true`）→ 见 F-05 |

### C 组：契约与文档

| 条目 | 判定 | 我实际看到的 |
|---|---|---|
| **S4.5** 会话复用 | **PASS**（一条子项未验证） | `[见]` 既有会话边界覆盖本单 SCOPE → 派工回执给出**复用提示**（写明「优先追加」「追加不会自动扩大边界」），且**派工仍然成功（只提示不阻断）**；金丝雀（边界不覆盖）→ 不给提示 |
| **S8.1** 声称产出的判定口径 | **PASS** | `[见]` 四层逐条实测（归属/断言性/路径形态/存在性）；残余 D-80 如实写进契约 |
| **S8.2** block 带规则编号 | **PASS** | `[见]` 四条编号机制在位，断言按编号判定 |
| 复用提示接线 | **PASS** | `[码]` `plugin/scripts/dispatch.mjs:448-486` |
| 台账 89 条自洽 | **FAIL** | 见 F-03（A 组） |
| **D-65 → D-69 编号订正** | **PASS** | `[见]` `dispatch.mjs:321`/`:334` 与 `plugin/CHANGELOG.md:215` 都用 **D-69**；代码里**没有第二处**旧编号。另有一处交叉引用有误（F-09） |
| **版本与发布产物** | **PASS** | `[见]` 仓库 `plugin.json` version=**0.5.6**、安装副本同样 **0.5.6**（description 逐字一致）；`plugin/CHANGELOG.md:6` 有 `## [0.5.6]`，8 条变更标题齐；`plugin/README.md` 是面向使用者的（:256-257 明写「建号是账号级危险动作…插件会拦子代理的建号调用」） |
| **release-v056.md 与成员原稿一致** | **未验证** | 成员原稿应在 `docs/audit/.tmp-release/`，实测该目录**为空** → 原稿不在工作区，无法逐字核对（`docs/audit/.tmp-release/**` glob 无命中） |

### D 组：回归与变异矩阵

**回归 764 条 0 FAIL；四个变异矩阵全部 OK；F-02 的 5 个变异体全部变红** —— 原始输出见 §D。

---

## 1. 我自己探针的夹具误判（自曝，避免把「红」误读成缺陷）

本轮我的探针出现 5 处**假红**，全部是夹具写错，逐条列出：

| # | 探针 | 假红现象 | 根因（夹具错） | 修正后 |
|---|---|---|---|---|
| 1 | `p7`（D-77②） | 「写失败时报错」拿到 `R-LEDGER-NO-DATA-DIR` | 进程内调 `lib.updateLedger` 时**没设 `process.env.PLUGIN_DATA`**（只在子进程 env 里设了） | 设上后 → `R-LEDGER-LOCK-FAILED`（注入失败），原文件逐字不变 |
| 2 | `p7`（D-77④） | 脚本卡死 280s | `spawn` 不支持 `input` 选项（那是 `spawnSync` 的），子进程等 stdin 等到天荒地老 | 改成 `p.stdin.end(payload)` → 两个并发派工：一个放行、一个「组队冲突」 |
| 3 | `p8`（D-39 register） | register 报错但归因不对 | 成员 JSON 缺 `accepts` / `reject`、方法论文件不存在 → 被更早的校验挡住，`account_check: null` | 补齐字段与 `.superagent/methods/<name>.md` → 三态断言全过 |
| 4 | `p10`（S4.5 复用提示） | 「不给复用提示」红 | 预置的旧派工写成 `state:'active'` → 新派工先撞**组队冲突**被拒，压根没走到复用提示 | 旧派工改 `state:'done'`、保留 binding → 提示出现且派工不被拦 |
| 5 | `regress-v056.mjs` | 脚本报乱码 | 我自己的 base64 编码器把 `c<0x80` 误写成 `c<0x0` → 字节全错 | 修正编码器后逐套跑通 |

---

## 2. 新发现缺陷

### F-05（P2）D-85 的「永远无法批准」与实测相反 —— 该请求**可以**被批准

- **触发条件**：worker 执行 `echo hi > /dev/null`（任何重定向到空设备的命令）。
- **观察到的后果**：护栏把 `/dev/null` 当成写目标 → 拦下并**记一条 pending 越界请求**，拦截文案还给出了 `--grant <id>` 的批准命令。
- **证据**：`probe-v056-p5.mjs` 实测：
```
D-85 RAW_GUARD …「以下路径不在白名单内：/dev/null。…（已记入待审清单 req_mwax5j0p_gzy29n。批准命令：… --grant req_mwax5j0p_gzy29n …」
D-85 GRANT_RESULT exit=0 { "ok": true, "granted": "req_mwax5j0p_gzy29n", "added": [ "/dev/null" ], "approved_by": "mvs_parent_p85", "audit_logged": true, … }
```
- **为什么这是缺陷**：台账 `defect-ledger.md` D-85 条把影响写成「记一条**永远无法批准**的越界请求（待审清单噪声，且可能掩盖真请求）」。实测它**能批准**（批准后 `/dev/null` 进入 scope）—— 真正的残留问题是「待审清单里混进一条永远用不上的请求 + 拦截文案给出无意义的批准命令」，**不是**「永远无法批准」。按现有表述去修，会修错方向。
- **最小复现**：跑 `node docs/audit/.tmp-v055/probe-v056-p5.mjs`（看 `D-85 GRANT_RESULT` 一行）。

### F-06（P2）台账 7 条新条目没有「来源/严重度」行 ⇒ 统计行与明细区对不上（F-03 未闭环）

- **触发条件**：任何人按明细区重算严重度分布，或按统计行判断「P0/P1/P2/P3 各几条」。
- **观察到的后果**（`probe-v056-p9.mjs` 实测）：
```
HEADLINE … 总计 89 条…其中 P0 11 条、P1 35 条、P2 31 条、P3 12 条。…统计以本表逐条明细为准，不得凭印象写数
INDEX_STRICT_ROWS 88 {"P0":10,"P1":35,"P2":31,"P3":12}
DETAIL_COUNT 89 {"P0":11,"P1":35,"P2":26,"P3":10,"MISSING":7}
DETAIL_NO_SEV ["D-83","D-84","D-85","D-78","D-79","D-80","D-81"]
DETAIL_NOT_IN_INDEX ["D-25"]
```
- **两处硬伤**：① 索引表 88 行、明细区 89 条 → **D-25 不在索引表**（v0.5.5 的 F-03 里缺 6 条，这轮补了 5 条、仍缺 D-25）；② 明细区 7 条（D-78/79/80/81/83/84/85）**整条没有「来源…严重度…」行** ⇒ 明细区算不出 P2=31/P3=12（它给的是 P2=26/P3=10 + 7 条未标）。统计行那句「统计以逐条明细为准」目前**做不到**。
- **最小复现**：`node docs/audit/.tmp-v055/probe-v056-p9.mjs`（纯读台账，不改一个字）。

### F-07（P3）索引表与明细区的 P0 数也差一条（由 D-25 缺表引起）

- 索引表 P0=10、明细区 P0=11，差的正是缺在索引表里的 D-25（明细区来源行写「严重度：P0」）。补上 D-25 行后两处自动对齐。
- **最小复现**：同 F-06 的探针，输出 `INDEX_STRICT_ROWS` 与 `DETAIL_COUNT` 两行。

### F-08（P3，文档）D-39 的「建号」进了机制与 hook，但**用户可见的危险工具表没更新**

- **触发条件**：用户读 `plugin/README.md:544` 或 `plugin/skills/super-agent-router/references/scope.md:12` 的「危险工具」表来知道自己不能做什么。
- **观察到的后果**：两张表仍只列 `mavis_agent_delete` / `mavis_agent_update`，**没有 `mavis_agent_create`**；而 `plugin/hooks/hooks.json:62` 的 matcher 已经含它、`lib.mjs` 的命令位置判定也已经拦 `mavis agent create`（我实测都拦住了）。README 正文 `:256-257` 说「建号是账号级危险动作…插件会拦子代理的建号调用」—— **三处口径不一致**（两张表说没拦、正文说拦、代码确实拦）。
- **最小复现**：对比 `plugin/README.md:544`、`plugin/skills/super-agent-router/references/scope.md:12` 与 `plugin/hooks/hooks.json:62`。

### F-09（P3，文档）台账 D-80 条的交叉引用指错编号

- `docs/audit/defect-ledger.md:1318` 写「guard.mjs 侧早就因此把 `expandHomePath()` 抽成纯函数（**见 D-65/D-70**）」——D-65 是「权威面脚本的拦截锚点只覆盖运行中 guard 自己那一份」，与家目录展开无关；抽 `expandHomePath()` 纯函数是 **D-70** 那轮做的。
- **影响面**：读者按 D-65 去查家目录展开会查错条目。**最小复现**：读 `defect-ledger.md:85`（D-65 的标题）与 `:1318`。

---

## D. 回归与变异矩阵（原始输出）

### D-1 十一套回归（仓库副本）

驱动脚本 `docs/audit/.tmp-v055/regress-v056.mjs`（逐套驱动 + 每套计时 + 900s/套上限；环境里显式清掉四个变异开关）。

```
AUDIT_BEFORE {"total":35,"nonEmpty":34,"fake":0}
RESULT chain-test exit=0 pass=70 fail=0 elapsed=5.4s
RESULT d27-mut-test exit=0 pass=14 fail=0 elapsed=17.6s
RESULT dispatch-release-test exit=0 pass=58 fail=0 elapsed=153.1s
RESULT e2e-test exit=0 pass=53 fail=0 elapsed=3.0s
RESULT guard-test exit=0 pass=228 fail=0 elapsed=13.7s
RESULT hooks-test exit=0 pass=29 fail=0 elapsed=0.4s
RESULT lessons-test exit=0 pass=65 fail=0 elapsed=20.6s
RESULT records-test exit=0 pass=52 fail=0 elapsed=6.4s
RESULT roster-test exit=0 pass=38 fail=0 elapsed=1.2s
RESULT scope-amend-test exit=0 pass=119 fail=0 elapsed=8.0s
RESULT scope-test exit=0 pass=38 fail=0 elapsed=1.9s
AUDIT_AFTER {"total":35,"nonEmpty":34,"fake":0}
TOTAL suites=11 pass=764 fail=0 badSuites=0
```

- **与父会话自述一致**：chain 70 / d27-mut 14 / dispatch-release 58 / e2e 53 / guard 228 / hooks 29 / lessons 65 / records 52 / roster 38 / scope-amend 119 / scope 38 = **764 条 0 FAIL**（我的计数是独立跑出来的，不是抄父会话的数）。
- **D-64 仍然成立**：跑前跑后 `.superagent/changes.log` 完全一致（35 行 / 34 非空 / **0** 条 `by mvs_parent`）—— 回归不再往真实变更账里写假记录。
- **观察**：`dispatch-release-test` 单套耗时 **153s**（其余套件 0.4~21s）。这是新 D-77 锁语义带来的（锁等待/偷锁阈值场景）。它跑得完，但**很慢** —— 父会话那次「`SAR_MUTATION_D77` 跑超时（>280s）」很可能与此有关（见 §D-2）。

### D-2 四个变异矩阵

**四个开关互不残留**：驱动脚本 `docs/audit/.tmp-v055/matrix-v056.mjs` 每个矩阵**单开一个进程**，子进程 env 里显式 `delete` 其余三个开关（父会话提醒的「没清开关会误报」那个坑，本轮用进程隔离从根上避开）。

#### ① `SAR_MUTATION=1`（总矩阵：覆盖 D-37~D-41 与 D-72 的变异体）

```
MATRIX total switch=SAR_MUTATION suite=e2e-test.mjs
EXIT 0 elapsed=229.0s pass=0 fail=0
| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |
|---|---|---|---|---|
| M-D37 | D-37 | 派工前的「目标成员存在性」判定被摘掉 | 9 | YES |
| M-D38 | D-38 | 会话注入里的陈旧名单披露被摘掉 | 1 | YES |
| M-D39 | D-39 | 账号级建号子命令从危险清单里摘掉（bash 通道 + 参数判定 + 复合层） | 3 | YES |
| M-D40 | D-40 | 拦截消息的「只读条目」分型被摘掉（退回一律说不在白名单内） | 3 | YES |
| M-D41 | D-41 | 复合层判定退回「对整段代码文本做朴素正则」 | 3 | YES |
| M-D72a | D-72 | 否定式产出判定被摘掉（否定标记不再让产出动词失去断言性） | 7 | YES |
| M-D72b | D-72 | 非断言语境判定被摘掉（疑问从句 / 引述句里的动词又被当成产出声明） | 4 | YES |
| M-D72c | D-72 | 子句级归属被摘掉（退回行级扫描：引用的护栏拒绝原文又把越界路径变成「声称产出」） | 5 | YES |
| M-D72d | D-72 | 家目录展开被摘掉（~ 路径不再按真实家目录判存在性） | 1 | YES |
| M-D72e | D-72 | 通配符跳过被摘掉（模式又被当成文件去校验存在性） | 2 | YES |
>>> E2E MUTATION MATRIX OK
```

#### ② `SAR_MUTATION_D75=1`（`tests/scope-amend-test.mjs`）

```
MATRIX d75 switch=SAR_MUTATION_D75 suite=scope-amend-test.mjs
EXIT 0 elapsed=29.9s
| M-D75a | D-75 | 回退「升级显式化」：detectReadonlyUpgrades 直接返回空 | 12 | YES |
| M-D75b | D-75 | 回退变更账上的升级标注（回执不动） | 3 | YES |
| M-D75c | D-75 | 回退回执上的升级字段（变更账不动） | 8 | YES |
| M-D75d | D-75 | 回退路径写法归一：canonicalPathKey 原样返回 | 2 | YES |
>>> D75 MUTATION MATRIX OK
```

#### ③ `SAR_MUTATION_D73=1`（`tests/scope-amend-test.mjs`）

```
MATRIX d73 switch=SAR_MUTATION_D73 suite=scope-amend-test.mjs
EXIT 0 elapsed=20.3s
| M-D73a | D-73 | 回退「降级记录不占名额」：countsAgainstSlots 不再读 degraded 标记 | 2 | YES |
| M-D73b | D-73 | 回退「名录内外口径不同」：存在性口径恒为 unverified | 1 | YES |
| M-D73c | D-73 | 回退「降级派工不参与冲突检测」 | 1 | YES |
>>> D73 MUTATION MATRIX OK
```

#### ④ `SAR_MUTATION_D77=1`（`tests/dispatch-release-test.mjs`）

```
MATRIX d77 switch=SAR_MUTATION_D77 suite=dispatch-release-test.mjs
EXIT 0 elapsed=458.3s
| M-D77a | D-77 | 回退整个写路径：无跨进程锁 + 裸 writeFileSync（无临时文件、无原子替换） | 5 | YES |
| M-D77b | D-77 | 回退「回滚」：回读校验失败后不恢复到写前状态 | 2 | YES |
| M-D77c | D-77 | 回退「回读校验」：写完不校验直接报成功 | 3 | YES |
>>> D77 MUTATION MATRIX OK
```

**父会话那次「`SAR_MUTATION_D77` 跑超时（>280s）」的结论**：我这边**跑完了**，用时 **458.3s**，三个变异体全部转红 → **不是死锁，是慢**（`dispatch-release-test` 在锁语义下单套就要 153s，3 个变异体各跑一遍）。把预算放到 900s 以上就能过。

#### ⑤ F-02 的四条专属断言（我自己写的回退，不依赖被验对象自带的矩阵）

探针 `docs/audit/.tmp-v055/probe-v056-p11.mjs`：把 `plugin/` 整份复制到系统临时目录 → 只改一处实现 → 用 `SAR_PLUGIN_ROOT` 指向副本跑 `tests/lessons-test.mjs` → 数红。**仓库工作树零改动**。

```
PASS M-D59-noretry round=1 red=2 hit=["D-59"] :: FAIL D-59 rename 遇 EPERM 会重试（写入不静默少条目） | FAIL D-59 重试后条目真的落盘
PASS M-D60-norollback round=1 red=1 hit=["D-60"] :: FAIL D-60 校验失败已回滚（前序条目未被这次失败写入抹掉）
PASS M-D61-eexistonly round=1 red=2 hit=["D-61"] :: FAIL D-61 抢锁遇 EPERM 当作「暂时拿不到」继续等（不误判失败） | FAIL D-61 等到锁之后写入真的落盘
PASS M-D61-eexistonly round=2 red=2 hit=["D-61"] :: FAIL D-61 抢锁遇 EPERM 当作「暂时拿不到」继续等（不误判失败） | FAIL D-61 等到锁之后写入真的落盘
PASS M-D61-eexistonly round=3 red=2 hit=["D-61"] :: FAIL D-61 抢锁遇 EPERM 当作「暂时拿不到」继续等（不误判失败） | FAIL D-61 等到锁之后写入真的落盘
PASS M-D62-shorttimeout round=1 red=3 hit=["D-62"] :: FAIL D-62 等待超时应容得下编排层最大并发数（6）轮持有者 | FAIL D-62 锁被占用时排队写入方不被误判失败 | FAIL D-62 排队写入方确实等到了锁释放
PASS M-D62-stalethresh round=1 red=1 hit=["D-62"] :: FAIL D-62 偷锁阈值 > 等待超时（不能把还在用的锁当陈旧锁偷走）
```

- **v0.5.5 的 F-02 已闭环**：四条各有专属断言、回退后**必红**，且 **D-61 连跑 3 轮都红** —— 上一轮「一次 2 红、一次 0 红」的**时敏**问题被 `SAR_FAULT_INJECT`（`rename-eperm` / `lock-eperm` / `verify-fail` 三个确定性钩子）解决。


---

## 3. 未验证边界（如实列出）

1. **D-74 的子项「`mavis_agent_create` 在真实运行时存在」——未验证**。我这一轮的 `tool_search` 没有命中该工具，本机 `mavis` CLI 也不在 PATH（`mavis agent --help` → `CommandNotFoundException`）。台账 `defect-ledger.md:1161` 写「本机工具清单里**确实有**」—— 属他人取证，我不据此下结论。matcher 含该工具名（代码事实）我已核实。
2. **`docs/audit/release-v056.md` 与成员原稿是否逐字一致——未验证**：成员原稿应在 `docs/audit/.tmp-release/`，实测该目录**为空**（`glob docs/audit/.tmp-release/**` 无命中），原稿不在工作区，无法逐字比对。我只能验证转写稿自身的自洽（版本号 0.5.6、变更清单分组与 CHANGELOG 的 8 条变更标题对得上）。
3. **契约 S4.5 的「归档后的会话不能再复用（`task_append` 返回 `TASK_CHILD_ARCHIVED`）」——未验证**：verifier 会话没有 `task_append` 工具，无法对归档会话做试探性追加。这条在契约里写的是「（实测：…）」的观察，不是永恒的平台事实，但**我无法独立复核**。
4. **只跑了仓库副本的回归**，没有在安装副本上复跑十一套（安装副本与仓库副本 `plugin.json` 与 description 逐字一致、版本都是 0.5.6，但回归未在安装副本上复测）。
5. **D-85 的后续**：我只验到「请求可以被批准（`ok:true`）」，**没有**验「批准后再写 `/dev/null` 是否真的被放行」。
6. **D-84 的「报错」口径**：我验到回执 `audit_logged=false` 如实反映，但 CLI **退出码仍是 0、`ok:true`** —— 若口径要求非零退出码或 stderr 提示，这一条要另定。
7. **只验证了 Windows**（win32 / Node v26.7.0 / PowerShell 5.1）。Linux/macOS 行为未验证。
8. **台账 89 条我只做了机械统计**（编号/严重度/索引覆盖），没有逐条人工复核 89 条的「影响/复现步骤」是否仍与代码一致 —— 本轮范围是本轮新增与上一轮遗留那几条。
9. **F-01 修法后的旁路未系统评估**：现在判定落在「插件包身份」上（包名 + `.minimax-plugin/plugin.json`）。若有人**复制一份插件包并改掉包名**，或把脚本放在别的插件包里 —— 我只验了「非插件包里的同名脚本不被拦」（这是设计意图），没有穷举其它改名/伪包形态。
10. **未部署、未改生产代码、未改台账编号与状态**；本会话唯一写入 = `docs/audit/.tmp-v055/`（探针 + 本报告）。

---

## 4. 结论：v0.5.6 能不能发

**机制侧：能发。** 我对每一条修复都写了独立探针（不依赖被验对象自带的断言），21 条机制类修复全部成立或按「已知未修」如实记录：F-01（权威面锚点换成插件包身份，覆盖仓库副本）、F-04（含空格路径）、D-37/D-38（成员存在性）、D-39（建号纳入账号级危险动作 + register 校验）、D-40（只读分型文案）、D-41（命令位置口径）、D-71（真实会话 id）、D-72/D-78/D-79/D-80（watchdog 侧）/D-81、D-73（三态 + 降级四子项逐条对照）、D-74（matcher）、D-75/D-83（升级留痕与别名归一）、D-77（台账串行化四项判据）、D-82（目录名逐字比较）、D-84（回执如实反映）。十一套回归 **764 条 0 FAIL**，且不再污染真实变更账。

**但有 3 项文档/台账问题建议先收口再发**（其中 F-05 优先，因为它会把后续修复方向带偏）：

| 阻塞项 | 性质 | 为什么算阻塞 |
|---|---|---|
| **F-05** D-85 条把影响写成「记一条**永远无法批准**的越界请求」，实测**可以**批准 | 台账描述与事实相反 | 按这条去修会修错方向；D-85 是「已知未修」，等它真去修时这句描述会误导实现者 |
| **F-06 / F-07** 台账统计行（P2 31 / P3 12）与明细区（P2 26 / P3 10 + 7 条无严重度）对不上；索引表缺 **D-25** | 同一族复发：上一轮 F-03 判的就是这个 | 台账自己写着「统计以本表逐条明细为准，不得凭印象写数」—— 而明细区**算不出**那个数；7 条新条目整条缺「来源/严重度」行 |
| **F-08** 危险工具表（README:544 / scope.md:12）未列建号工具名，而 hooks matcher 与代码都已拦 | 用户可见口径不一致 | 读者按表办事会以为建号没被拦（README 正文 :256-257 又说拦了） |

**结论一句话**：**v0.5.6 的机制可以发**；台账/文档侧建议先把 F-05、F-06+F-07、F-08 三项收口再发 —— 若沿用上一轮「台账与文档必须自洽」的硬门槛（F-03 的由来），当前状态是**有条件通过**，不满足「无条件发」。

**VERDICT: PASS_WITH_CONDITIONS**
---

## 7. 父会话对阻塞项的收口（2026-11-11，父会话记）

VERDICT 是 **PASS_WITH_CONDITIONS** —— 机制侧全通过，条件是台账 / 文档侧 4 项收口。逐条交代：

| 编号 | 收口动作 | 证据（父会话复核） |
|---|---|---|
| **F-05**（P2）D-85 描述与事实相反 | 改写 D-85 的「影响」段：明确这条请求**是能被批准的**（实测 `--grant` 返回 `ok:true`、`added:["/dev/null"]`、`audit_logged:true`），真正的残余是「待审清单混进用不上的请求 + 拦截文案给出**无意义**的批准命令」，并写明「按旧表述去修会修错方向」 | `docs/audit/defect-ledger.md` 的 D-85 条 |
| **F-06**（P2）7 条明细缺「来源/严重度」行 | 给 D-78/79/80/81/83/84/85 七条补上「来源：… ｜ 严重度：Pn ｜ 归属层：机制层」 | 同上；**从明细重算**的分布 = 统计行 |
| **F-06 / F-07**（P2/P3）D-25 被严格解析器漏掉 | **根因不是「缺行」**：那两行里写着 `mavis agent delete|update`，**未转义的竖线**把行切成 8 列 ⇒ 严格解析器丢弃该行。已把措辞改成 `mavis agent delete` / `mavis agent update`（不再用竖线） | 严格解析复跑：**索引表 89 行、无列数异常行** |
| **F-08**（P3）两张「危险工具」表缺建号 | 已派 **sa-plugin-release** 收口（**复用其 v0.5.6 发布会话**）：README 的危险工具表、`scope.md` 的管控分类行、`scope.md` 的「为什么拦」明细表 —— 三处都加了 `mavis_agent_create`，并写明「建号与删除、改写**对称**」的理由 | `plugin/README.md`、`plugin/skills/super-agent-router/references/scope.md` 的 diff（父会话逐行核对） |
| **F-09**（P3）D-80 里的交叉引用易误读 | 改成「见 **D-65 的修复轮**（判定锚点换成插件包身份后，把家目录展开抽成纯函数 `expandHomePath()`）；以及 **D-70**（上一轮「四种家目录写法都被拦」的断言是假绿）」 | `docs/audit/defect-ledger.md` D-80 条 |

### 7.1 收口时又查出 3 处台账不自洽（F-03 的更深一层）

把「台账自洽」从**临时脚本**升级成**版本库里的永久断言**时（`tools/ledger-check.mjs` + `tests/ledger-test.mjs`，已进 `--all`，十二套），严格解析器又查出 3 处：

1. **D-81 的「来源/严重度」行被落在文件末尾**（脱离了自己的明细段）⇒ 统计口径上 D-81 没有严重度；
2. **状态表里 D-75 出现两次且状态互相矛盾**（「已修（待独立复验）」vs「口径已定，待实现」）；
3. 明细重算的 P2 = 30、统计行写 31（上一条连带）。

三处均已由父会话修完；顺带按检查器报的「其它发现」更新了三处过期口径（「本轮新增」改为 D-44~D-85 共 42 条、章节编号统一为 一~九、状态表标题改为「本轮新增 D-44~D-85」）。
**现在** `node tools/ledger-check.mjs` 六项全 PASS：`index-columns` / `sets-equal` / `severity-distribution` / `detail-meta-line` / `detail-count` / `no-duplicate-d`，89 索引行 = 89 明细 = 89 状态并集。

### 7.2 复验方两条「未验证 / 误判」的更正（父会话复核后）

- **「release-v056.md 与成员原稿一致：未验证（成员原稿目录为空）」** —— 实为复验方的 glob **默认跳过点目录**，目录并不空（8 个文件）。
  父会话逐字核对：`docs/audit/release-v056.md` 与成员原稿 `docs/audit/.tmp-release/release-v056.md` **均为 14,724 字节、内容完全一致**。
  ⇒ 该项应为 **PASS**。
- **「索引表 88 行 vs 明细区 89 条 ⇒ 缺 D-25」** —— D-25 **在**索引表里（第 58 行），只是那一行含未转义竖线，严格解析器把它丢了。
  ⇒ 结论（严格解析会漏行）成立，但「缺 D-25」不成立；已按根因修（见上表 F-06/F-07）。

### 7.3 复验方自曝的 5 处探针夹具误判

复验方在报告 §1 里主动列了自己 5 处探针夹具误判（漏设 `PLUGIN_DATA`、`spawn` 用错 `input`、register 字段不全、复用提示夹具撞组队闸门、base64 编码器笔误），每处都给了产品侧反证与修正结果 ——
**这条自查纪律本身是本轮最值得保留的东西**：验收方把自己的误判和修正一起交上来，比「结论全对」更可信。
