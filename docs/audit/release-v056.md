# v0.5.6 发布说明

> 产物落点：`docs/audit/.tmp-release/release-v056.md`（本单冻结边界内）。
> 正式路径 `docs/audit/release-v056.md` 由**父会话**转写 —— 不在本单边界内，本单不写。
> 本单负责的三件产出：`plugin/.minimax-plugin/plugin.json`、`plugin/CHANGELOG.md`、`plugin/README.md`。

## 1. 版本

| 项 | 值 |
|---|---|
| 版本号 | **0.5.6**（语义化 patch：修复 + 新增纪律，无破坏性变更） |
| 版本号落点 | `plugin/.minimax-plugin/plugin.json` 的 `version` |
| CHANGELOG 顶部条目 | `plugin/CHANGELOG.md` 的 `## [0.5.6] - 2026-11-10` |
| 一致性 | 两者一致（自洽检查 B 组断言） |
| 破坏性变更 | **无**。v0.5.0 的四条破坏性变更仍适用，本版未新增 |

## 2. 本版做了什么（一句话）

把「派工链路会静默失效」这一族缺陷收掉，并给派工与收尾两条链路补上可核验的判定口径：

- **台账的写统一到一个锁内入口** —— 并发写不再静默丢记录（丢一条在飞派工会让组队冲突闸门看不见它）；
- **派工目标成员的存在性分三态判** —— 账号名单不可得时不再静默降级；
- **扩权升级与收尾拦截都留痕 / 带编号** —— 能复核，不靠猜文案关键词。

## 3. 变更清单（按分组）

完整条目见 `plugin/CHANGELOG.md` 的 v0.5.6 段落（每条含「改了什么 / 为什么 / 怎么验证」）。
此处只列**分组与编号**，便于对照台账逐条复核。

### 3.1 权限侧

| 编号 | 缺陷 | 本版状态 |
|---|---|---|
| D-73 | 账号名单不可得时派工存在性判定整体降级为不判 → 派给不存在的成员重新变成静默失效 | 改为三态（`account_verified` / `roster_declared` / `unverified`）；降级路径不占名额、不参与 SCOPE 冲突判定，并向父会话披露 |
| D-75 | 管理员批准「只读条目上的写请求」时只读被静默升级成可写 | 升级**仍然允许**，但回执与变更账必须显式留痕并指认来源只读条目 |
| D-83 | 只读升级检测按路径写法逐字比较，别名写法逃逸检测 | 新增路径写法归一（`canonicalPathKey` / `canonicalScopeEntries`），归一后仍能认出同一文件；**不解析 `..`** |
| D-84 | 变更账写入失败被静默吞掉（`appendChangeLog()` 返回值被丢弃） | 接住返回值，新增 `audit_logged` 字段 |
| D-71 | 名录里的提权留痕可以写自称 | 已由**父会话**对齐为真实父会话 id（`mvs_9bdda202ae274c909a5b4352fc45a471`）；属项目侧数据对齐，机制只校验**新**提权的批准人 |

### 3.2 判定侧

| 编号 | 缺陷 | 本版状态 |
|---|---|---|
| D-72 | watchdog 把「这个文件没有创建」判成「声称产出」→ 连续 block，实质在逼成员去创建那个文件 | 判定拆成四层（子句级归属 / 否定式独立判定 / 路径形态 / 存在性） |
| D-78 | 「声称产出」判定按行归属路径，同行无关路径被一并认领 | 改为**子句级归属** |
| D-79 | 四条 block 消息都不带规则编号，断言只能靠猜文案关键词 | 各带稳定编号 `R-EMPTY-DELIVERY` / `R-NO-EVIDENCE` / `R-CLAIM-PATH-MISSING` / `R-ENTRY-FORMAT` |
| D-80 | `lib.mjs` 的 `absolutizePath()` 不展开家目录写法 | **只修了一半**（详见第 5 节） |
| D-81 | watchdog 路径正则不含通配符，模式路径被截成碎片当文件 | 通配符按「模式」整体识别 |

### 3.3 并发与判读

| 编号 | 缺陷 | 本版状态 |
|---|---|---|
| D-77 | 派工台账是无锁的读-改-写 ⇒ 并发写静默丢记录 | 新增 `withLedgerLock()` + `updateLedger()` 统一写入口（锁内重读 + 原子替换 + 回读校验 + 回滚）；五个写方全部改走；组队闸门 2/3 的判定搬进临界区 |
| D-82 | 插件数据目录判定先 trim 整条路径 ⇒ Windows 上带尾随空格的同名目录被误判 ⇒ 读到空台账 ⇒ 冲突与名额检测全盲 | 取 basename 时不 trim，按**目录名逐字**比较 |

### 3.4 派工上下文纪律与契约

| 项 | 内容 |
|---|---|
| 契约 S4.5 | 会话复用（同一专项的连续工作，不新开子会话）—— 判据、做法、边界继承、归档 vs 复用的实测边界、追加时 SCOPE 行的写法 |
| 契约 S8.1 | 「声称产出」的判定口径（四层判定） |
| 契约 S8.2 | block 消息必须带规则编号 |
| 派工回执 | 该成员已有覆盖本单 SCOPE 的会话时，给出**复用提示**（提示，不阻断） |
| 编排层纪律 | RT-06 ~ RT-08 回流进 `SessionStart` 注入与 `_router.md` |

### 3.5 台账与文档口径对齐

| 编号 | 缺陷 | 本版状态 |
|---|---|---|
| D-37 | 派工链路不校验目标成员是否存在于账号 | 核验账号成员目录（`~/.minimax/agents/<name>/`，内置在 `.builtin/`），不存在则拒派 |
| D-38 | 陈旧判定（roster reconcile）既无执行点也无消费者 | 工具存在但机制不生效 |
| D-39 | 账号级成员创建无闸门（与删除/改写不对称） | 建号纳入账号级危险动作；`roster.mjs register` 补「必须已存在于账号名单」校验 |
| D-40 | 越界拦截消息把「只读条目不授写权」说成「路径不在白名单内」 | 两条文案分型，并给只读条目专属提示（不诱导去申请批准） |
| D-41 | 复合层危险词扫描对文档正文同样生效 | 收敛到「命令位置」口径，引用被拦命令的形态不再被拦 |
| D-63 | 部署工具对每一棵租约缓存树做全量同步 | 缓存树同步先判插件归属 |
| D-64 | 回归用例漏传 `MINIMAX_PROJECT_DIR`，把测试夹具的假批准人写进真实项目的变更账 | 回归用例补传环境变量 |
| D-65 ~ D-69 | 权威面脚本锚点 / 专属断言 / 台账自洽 / 含空格路径 / 派工上限 | 逐条已修（待独立复验） |
| D-70 | 「家目录四种写法都被拦」的断言是假绿 | 断言重做 |

## 4. 验证方式（全部为本次实测）

### 4.1 包内自洽性（4 组断言）

脚本：`docs/audit/.tmp-release/selfcheck-v056.mjs`

```powershell
node docs/audit/.tmp-release/selfcheck-v056.mjs --root plugin
```

| 组 | 检查什么 | 断言数 |
|---|---|---|
| A | `hooks.json` 引用的每个脚本在 `plugin/scripts/` 下**真实存在**（一个不漏） | 5 |
| B | `plugin.json` 的 version 与 CHANGELOG 顶部版本号一致、且是合法 semver | 3 |
| C | README 里出现的脚本与 `--flag` 开关与脚本源码对得上 | 15 |
| D | manifest 声明的 skills / hooks / 图标文件真实存在 | 4 |

### 4.2 回归

```powershell
node tools/run-tests.mjs --all --root plugin --repo .
```

十一套全部 **0 FAIL**。逐套 pass 数（发布前最后一次全量实测）：
chain 70、d27-mut 14、dispatch-release 58、e2e 53、guard 228、hooks 29、
lessons 65、records 52、roster 38、scope-amend 119、scope 38。

**口径说明（两次实测的差异已在发布前查清）**：

- 首次全量跑时 `dispatch-release-test` 报 **3 条 FAIL**（`readers=0`），`scope-amend-test` 为 117；
  复跑全量时两套均 **0 FAIL**，`scope-amend-test` 变为 119。
- 差异原因有二，都已查证，**都不是机制缺陷**：
  ① `dispatch-release-test` 的那 3 条是**前置条件断言**（并发确实发生的观测），
     单独重跑该套件 58/0 全过；独立探针（`probe-d77-concurrency.mjs`）证明锁在生效 ——
     第一个写者 72~80ms 到达临界区，第二个直到 go 释放后才进入，台账两条记录各带独立 scope。
     首次全量跑时机器负载高，两个子进程的调度被拉开，观测窗口内只看到 1 个写者 ⇒ 报 `readers=0`。
  ② `scope-amend-test` 从 117 变 119，是因为 `tests/scope-amend-test.mjs` 在本单交付期间
     **仍在被追加断言**（该文件的最后修改时间 2026-11-11 00:04:44 晚于首次全量跑；
     该文件属他人正在途的改动，本单**未触碰**）。连跑 3 次稳定在 119。
- **口径**：断言条数以**发布前最后一次实测**为准，钉死一个数会被下一个人立刻推翻。

### 4.3 变异检验

三个开关**互相独立**（混在一起会让「总矩阵跑过了」被误读成「每条缺陷的变异体都跑过了」）：

| 开关 | 覆盖 | 变异体 |
|---|---|---|
| `SAR_MUTATION_D75=1` | 只读升级显式化 + 路径写法归一 | M-D75a / b / c / d |
| `SAR_MUTATION_D77=1` | 台账并发写（无锁 / 回滚 / 回读校验） | M-D77a / b / c |
| `SAR_MUTATION_D73=1` | 名单不可得时的降级口径 | D-73 变异矩阵 |

### 4.4 D-77 的独立探针复验

脚本：`docs/audit/.tmp-release/probe-d77-concurrency.mjs`（3 轮）、
`docs/audit/.tmp-release/probe-mimic-test.mjs`（复刻测试的等待逻辑）。

实测结论：第一个写者在 **72~80ms** 到达临界区，第二个写者**直到 go 释放之后才进入** ——
这正是锁在生效的直接证据；台账最终两条记录、各带自己的 scope，无一条被覆盖。

## 5. 已知边界与残余风险

### 5.1 D-80 只修了一半（**本版最重要的一条残余**）

家目录写法（`~` / `$HOME` / `%USERPROFILE%`）的展开目前做在 **watchdog 侧**（收尾校验）；
`plugin/scripts/lib.mjs` 的 `absolutizePath()`（`lib.mjs:585`）**本身仍不展开**。

- **影响面**：经由收尾判定（watchdog）的那条路已不受影响；
  **不经由**它的其它路径仍可能把家目录下的真实文件判成「不存在」。
- **归属**：台账 D-80 记为「部分已修」，残余归 `lib.mjs` 的归属成员。
- **本版不声称**该缺陷已全修。

### 5.2 D-76 是设计边界，不是缺陷

复合层载荷（`run_code`）把命令放进变量时，护栏**取不到命令文本**，判不了。

这是复合层判定的固有限制，**不是缺陷、也不是漏修** —— 已写进契约与注入，
留成明示边界而不是隐性缺口。本版在 README「诚实边界」一节与 `plugin.json` 的 description 里都交代了。

### 5.3 D-73 与 D-77 的代码尚未提交

这两项修复**已落地在工作树**，但在本单交付时**尚未 commit**。

- 本说明与 CHANGELOG 按「**已落地、待独立复验**」表述，**不写成已发布**；
- 它们的修复报告 `docs/audit/fix-d73.md` 与 `docs/audit/fix-d77.md` **尚未落盘** ——
  本版这两条依据的是**父会话给出的修复说明**，代码侧已逐点核实（见下表）。

| 编号 | 代码落点（工作树） |
|---|---|
| D-73 | `plugin/scripts/dispatch.mjs:174-244`（三态判定）、`:365-391`（台账字段 `member_existence` / `degraded`）、`:416-424`（降级披露进子会话上下文） |
| D-77 | `plugin/scripts/lib.mjs:299`（`withLedgerLock`）、`:418`（`updateLedger`）、`:473`（`writeLedger` 走锁 + 原子替换）；`plugin/scripts/dispatch.mjs:277+`（闸门 2/3 判定搬进 `updateLedger`） |

### 5.4 其余沿用 v0.5.5 的诚实边界

hook 是护栏不是沙箱；`full` 不放开工作区外、私有状态目录与账号级不可逆动作；
批准人校验挡不住蓄意自提权；扩权/提权全部留痕。详见 README「诚实边界」一节。

## 6. 本次发布的两轮全量回归实测记录

| 轮次 | dispatch-release-test | scope-amend-test | 其余八套 | 结论 |
|---|---|---|---|---|
| 第 1 轮（全量） | 55 pass / **3 FAIL** | 117 pass / 0 FAIL | 0 FAIL | SHELL HAS FAILURES (1) |
| 第 2 轮（全量，复跑） | 58 pass / 0 FAIL | 119 pass / 0 FAIL | 0 FAIL | **SHELL ALL PASS** |
| dispatch-release-test 单独重跑 | 58 pass / 0 FAIL | — | — | ALL PASS |
| scope-amend-test 单独重跑 ×3 | — | 119 / 119 / 119 pass / 0 FAIL | — | ALL PASS |

第 1 轮那 3 条 FAIL 的诊断见上一节的「口径说明」—— 结论是**观测窗口的时敏现象，不是机制缺陷**，
并且有独立探针与单独重跑两条证据支撑（不是靠「重跑变绿」这一件事下结论）。

---

## 7. 需要父会话处理的事项

1. **转写发布说明**：把本文件转写为 `docs/audit/release-v056.md`（正式路径不在本单边界内）。
2. **提交工作树改动**：`plugin/scripts/**` 与 `tests/**` 的在途改动由父会话提交 ——
   本单**未**触碰这些文件（见第 7 节的文件清单）。
3. **补两份修复报告**：`fix-d73.md` 与 `fix-d77.md` 尚未落盘；
   若由其它成员产出，请与本说明第 5.3 节的代码落点表对齐。
4. **台账状态表与工作树不一致**：`docs/audit/defect-ledger.md` 的状态表里 D-73 记「已复现，待修」、
   D-77 记「已复现（活体），待修」，但两者的代码**已在工作树落地** —— 状态表需要更新。
   本单**不改台账**（不在边界内），在此报告。
5. **编号不一致一处**：`plugin/scripts/dispatch.mjs:321` 的注释写「累计上限默认是硬编码的 30（D-65）」，
   但台账与提交 `e802f8c` 里「累计派工上限可调」这条是 **D-69**
   （D-65 是「权威面脚本的拦截锚点只覆盖运行中 guard 自己那一份」）。
   本说明按台账口径写 **D-69**；代码注释的编号需要归属成员订正 —— 本单**不改脚本**（不在边界内）。
6. **D-80 残余**：需要派单给 `lib.mjs` 的归属成员，把家目录展开补到 `absolutizePath()` 本身。
7. **安装副本同步**：安装副本 `C:/Users/yang2/.minimax/plugins/super-agent-router/` 当前仍是 **0.5.5**，
   本单**不部署**（部署不在职责边界内），同步动作由父会话按部署流程执行。

## 8. 本单改动文件清单

| 文件 | 改动 |
|---|---|
| `plugin/.minimax-plugin/plugin.json` | version 0.5.5 → **0.5.6**；description 追加 v0.5.6 段（含 D-80 残余与 D-76 边界两条诚实交代） |
| `plugin/CHANGELOG.md` | 顶部新增 `## [0.5.6] - 2026-11-10` 段落（8 个变更块 + 总体验证 + 已知边界） |
| `plugin/README.md` | 版本号同步；新增「会话复用：省上下文的纪律，不是自动机制」一节；排查清单新增第 12 / 13 条；诚实边界一节补 D-76 与 D-80 残余 |
| `docs/audit/.tmp-release/release-v056.md` | 本文件 |
| `docs/audit/.tmp-release/selfcheck-v056.mjs` | 包内自洽性检查脚本（4 组断言） |
| `docs/audit/.tmp-release/probe-d77-concurrency.mjs` | D-77 并发独立探针 |
| `docs/audit/.tmp-release/probe-mimic-test.mjs` | 复刻测试等待逻辑的对照探针 |

**未改动**（本单边界外）：`plugin/scripts/**`、`plugin/hooks/**`、`plugin/skills/**`、`tests/**`、
`.superagent/**`、`docs/audit/defect-ledger.md`、`docs/audit/release-v055.md`。

