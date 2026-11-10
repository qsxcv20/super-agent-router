# F1~F5 + RG-03 + D-58 定向修复报告

- 修复者：sa-mechanism-fix（编排机制边界判定改造）
- 依据：`docs/audit/verification-v054.md`（VERDICT: FAIL）的 F1~F5 与 RG-03，
  以及父会话追加的 D-58（护栏第二道防线不分形态）。
- 判定：除 `lessons-test` 外全部修复并有回归断言；`lessons-test` 的红是**另一名成员的在途改动**，不是本轮缺陷（证据见 §4）。

## 0. 一句话

worker 自提权/自批准的主防线补上了（护栏把权威面脚本列为父会话专属），
两条扩权路径口径统一，legacy 迁移不再伪造「已完成」，文档里那句不成立的断言删干净了。
断言总数从 487 增到 **518**（十套实测 499 条：guard-test 199、scope-amend-test 67，其余八套未动；
加上 lessons 套件 19 条 —— 该套件本轮因在途改动变红，19 这个数取自验收方 v054 的实测）。

## 1. 逐条：修了什么 / 断言在哪 / 残余风险

### F1（高）worker 用 bash 执行 admin CLI 自提权、自批准

**修了什么**

1. **主防线（护栏）**：`plugin/scripts/guard.mjs:284-350` 新增「权威面脚本」清单与判定，
   `:561-572` 在 bash 分支最前面拦：子代理上下文（载荷带 `agent_type`）执行
   `scope-amend.mjs` / `release-slot.mjs` / `record-gate.mjs` / `lessons-gate.mjs` / `roster.mjs`
   一律 deny。匹配按**插件根目录下的具体文件**（`path.resolve` 后的绝对路径，`:308-316`），
   不按脚本名裸匹配 —— 工作区里的同名副本是普通文件，不误拦；
   `~` / `$HOME` / `%USERPROFILE%` 先展开再比对（`:319-331`），
   否则「换个写法就躲开」是最容易的绕过。父会话不受影响（载荷没有 `agent_type`，前面已早退）。
2. **纵深防御（admin CLI）**：`plugin/scripts/scope-amend.mjs:143-160`（`--grant`/`--deny`）、
   `:254-263`（`--tier`）、`:308-318`（`--dispatch --add`）—— 批准人必须是**真实的父会话 id**：
   前两者要等于该派工的 `parent_session_id`，`--tier` 的必须是台账里存在过的父会话 id。
   `--list` 的待审清单直接给出 `parent_session_id`（`:105-107`、`:118`），父会话照抄即可。
3. **诚实口径**：`references/contract.md`（S13.2 第 4 条、S13.3、S13.5）、`plugin/README.md`、
   `references/scope.md`、`scope-amend.mjs:30-44` 头部 —— 「worker 无权改自己的等级」这类
   按现状不成立的断言全部删掉，换成与 S13.5 一致的措辞（机制做什么 / 不做什么）。
4. **tier 快照（可选项，已实现）**：`plugin/scripts/dispatch.mjs:208` 在派工时把 tier 写进派工记录
   （`:256` 新记录 / `:239` 覆盖记录），`plugin/scripts/guard.mjs:206` 让子会话绑定继承这份快照，
   `:368` 起不再每次工具调用重读名录 —— 会话中途的等级变更对已在飞的会话不生效。

**断言在哪**

- `tests/guard-test.mjs:792-845`：① 子代理执行权威面脚本 → deny（文案含「权威面脚本」）；
  ② 父会话执行同一脚本 → 不被这条规则拦；③ 工作区同名副本 → 不误拦，且照常按 scope 放行。
- `tests/scope-amend-test.mjs:512-550`：`--grant` / `--dispatch --add` 的批准人校验；
  `:289-297`：`--tier` 的批准人校验；`:526-529`：`--list` 给出父会话 id。
- `tests/scope-amend-test.mjs:283-320`：等级快照三条（派工记录带 tier / 会话中途提权对在飞会话无效 /
  重新派工后按新等级）。

**残余风险（如实写）**

- 「命令 + 只有父会话能执行」的取舍：拦截文案**仍**印出可复制的批准命令，但明确标注「只有父会话能执行，
  worker 自行执行会被护栏拒绝」。理由：父会话需要这条命令（自动审核的 UX），
  拿掉它等于让父会话自己拼参数；而 worker 那份已经被主防线废掉。
- **绕过面仍在**：复制脚本改名再执行、用内联代码直接写文件，都不在判定范围内（hook 是护栏不是沙箱）。
- `--approver` 校验**挡不住蓄意自提权**（worker 的派工原文里就带着 `PARENT SESSION:`）——
  文档里已按「纵深防御」写，没写成「绝对禁止」。
- 工作区里的同名副本**不拦**（按 brief 的要求）：若那份副本能写同一个 `roster.json`，仍是提权路径 ——
  已被「批准人必须是父会话 id」与「会话中途提权对在飞会话无效」两道纵深防御削弱，但不是零。
- 提权是**项目级**动作，`--tier` 要求台账里有该父会话的派工记录 —— 在本项目派过工之前无法提权。

### F2（中）`--grant` 不校验派工状态

**修了什么**：`plugin/scripts/lib.mjs:678-701` 的 `grantScopeRequest()` 补派工状态检查 ——
对已结束（done/aborted）的派工拒绝，文案与「直接加条目」分支同一口径（`:699`）。

**断言在哪**：`tests/scope-amend-test.mjs:493-510`（done / aborted 各 3 条：拒绝、同口径文案、请求仍是 pending）。

**残余风险**：无（两条扩权路径口径已一致；`--dispatch --add` 的 state 检查本来就有）。

### F3（低）full 成员命中私有目录时文案误诊

**修了什么**：`plugin/scripts/guard.mjs:443-470` 的 `outOfScopeVerdict()` 按目标分型 ——
私有状态目录（`.superagent/`）与工作区外两种文案分开；私有目录说「在编排层私有状态目录内，full 等级也不放行」，
**不打印批准提示**（`:401-427` 的 `approvable` 开关，因为那种批准永远不生效）。
**亲眼见过**：本轮我自己的命令行里出现 `.superagent/changes.log` 这个路径 token 时，
护栏当场拒我，拒语文案正是修后的版本（无「工作区之外」、无批准提示）。

**断言在哪**：`tests/scope-amend-test.mjs:351-360`（文案不含「工作区之外」、不含批准提示、点明私有状态目录）。

**残余风险**：scoped 等级对私有目录的**读**请求仍会给批准提示 ——
那种批准是有效的（只读条目精确生效），所以提示不算错；写请求则不给提示。

### F4（低）文档数字与括注过期

- `plugin/CHANGELOG.md`：旧条目里的「484 条断言」补注口径（v0.5.4 发布时 484；补 D-42/D-43 后 487），
  不再与同文件的另一个数打架；新增「[未发布]」段落记录本轮改动。
- `references/scope.md:226` 起：「full 的**三条例外**（与契约 S13.3 一致）」→ **四条例外**
  （补上第四条边界：写冲突检测仍按声明的 SCOPE 比对）；`plugin/README.md` 同步改成四条。
- **断言条数不钉死**：断言数随套件增删变动（另一名成员正在改 `lessons-test`），
  CHANGELOG 里写「以发布前那次实测为准」，钉死一个会被下一个人立刻推翻的数。

**残余风险**：发布前需重测一次并把总数写进发布说明（父会话动作，见 §5）。

### F5（低）安装副本与运行时副本落后

**修了什么**：跑了一次 `node tools/deploy-plugin.mjs`（`INSTALLED_SYNCED copied=28`、`CACHE_SYNCED trees=5`）。
**亲眼见过**：仓库 `plugin/` 与安装目录 `~/.minimax/plugins/super-agent-router` 逐文件 sha256 比对 ——
**28 个文件、0 处不同**；运行时 hook 缓存里承载本插件内容的 4 棵树与仓库副本 **DIFFS=0**。

**残余风险**：部署把另一名成员的在途 `lessons.mjs` / `lessons-gate.mjs` 一起同步到了安装副本
（全量同步是 `tools/deploy-plugin.mjs` 的语义，我不能只同步我自己的文件而仍声称「逐文件一致」）。
他改完后需要再部署一次。另外：部署脚本按内容哈希命名缓存树，改内容后树名与内容不再对应，
运行时按新哈希自建树（本次已自建 1 棵）。

### RG-03 台账 legacy 迁移把 active 提升成 done

**修了什么**：`plugin/scripts/lib.mjs:78-87` —— 迁移**只补缺失的字段**，不改写已声明的状态：
旧行缺 `parent_session_id` 时补上并标 `legacy`，但 `state` 只在**没写**的时候补 `done`；
写着 `active` 的行保持 `active`（迁移不得把 active 提升成 done —— 那是替还没结束的派工伪造「已完成」，
record-gate 的履历真实性判据会被绕过）。

**断言在哪**：`tests/scope-amend-test.mjs:570-595`（legacy active 行仍是 active + 仍标 legacy；
没有状态的旧行仍落 done —— 保留原有的防锁死语义）。

**残余风险**：**缺 `state` 字段**的旧行仍落到 `done`（旧格式没有这个字段，无法判断它是否在飞；
保留 done 是为了不把一次历史派工永久锁死在在飞名单里）。若 record-gate 的真实性判据要求
「state=active→done 的完整链路」，这条要 `sa-gate-integrity` 复核 —— 那是他的文件，我没动。

### D-58（父会话追加）护栏第二道防线不分形态

**修了什么**

1. **按形态判（主修复）**：`plugin/scripts/guard.mjs:244` —— 第二道防线从「路径前缀命中就拒绝建立边界」
   改成「只有**目录条目**（会按读模式展开成整棵子树）才拒绝」。精确文件条目不展开，不触发这道防线。
2. **共用同一判定函数**：判据收进 `plugin/scripts/lib.mjs:397-415`（`PRIVATE_MEMORY_DIRS` /
   `isPrivateMemoryEntry()` / `expandsPrivateMemoryTree()`），派工闸门 1b（`dispatch.mjs:96-101`）、
   护栏第二道防线、范围层、扩权入口四处共用，注释里写明**哪一层管什么**。
3. **范围层分型文案**：`guard.mjs:443-460` —— 私有记忆目录（lessons / methods）单独一种诊断：
   「范围层一律不授予（契约 S13.4），读请求同样不放行，扩权也不会生效；需要它的内容请让 Router 转写进 brief」，
   并且**不给批准提示**（`:462-470`）。
4. **扩权入口不造死条目**：`scope-amend.mjs:162-170` 与 `:319-324` —— 给私有记忆目录扩权当场拒，
   并指出契约通道（Router 转写进 brief）。

**断言在哪**：`tests/guard-test.mjs:846-882`（精确文件条目 → 不触发第二道防线，worker 不卡死；
那个文件仍由范围层判；目录条目 → 仍然拒绝建立边界）；`tests/scope-amend-test.mjs:597-621`
（`--grant` / `--dispatch --add` 给私有记忆目录扩权被拒）。

**残余风险 / 与父会话口径的一处偏差（如实说明）**：
父会话的修法方向写的是「精确文件条目不触发第二道防线（是否放行仍由范围层 D-42 决定）」。
实现按此执行：**精确文件条目确实不再触发第二道防线**。但要如实说明 ——
**范围层 D-42 的现行实现是「私有记忆路径一律不授予」**（`lib.mjs` 的 `inScope` 对读模式的目标做
`isPrivateMemoryPath` 拦截），所以那条「精确只读扩权」**在范围层仍然读不到**；
brief 里说「范围层 D-42 明确允许这种形态」与代码不符（亲眼见过：`lib.mjs` 的 `inScope` 读模式分支）。
我没有改范围层，理由两条：
（一）改它等于改契约 S13.4 的表（lessons/methods 下任何条目拒派），那是协议决定，父会话的权限；
（二）范围层一放开，**不经 dispatch 的 brief 直建边界那条路**就会重新打开兄弟成员错题本的读通道 ——
第二道防线当初就是为这条路设的。所以我按父会话指的方向修第二道防线，
并把「批准了也不生效」这件事在**两个地方**讲清楚（护栏拒语文案 + 扩权入口当场拒），
让它从「静默的死条目」变成「当场说清的白拒」。
**若父会话确实要让「精确的单个私有记忆文件」可读**，需要三步一起做：
改 S13.4 的表 + 范围层读模式放行精确命中 + 第二道防线按「条目来源」
（brief 声明 vs 管理员批准）区分，否则 brief 直建边界那条路会漏。**这一步我没做，请派单。**

## 2. 变异检验（A1 的硬要求）

`docs/audit/.tmp-fix/mutation-check.mjs`：把 plugin/ 复制到草稿区 → 单独回退一处修复 →
用 `SAR_PLUGIN_ROOT` 指向副本跑对应套件 → 统计变红的断言。**仓库工作树零改动。**

```
node docs/audit/.tmp-fix/mutation-check.mjs
```

| 变异体 | 结果 | 变红的断言 |
|---|---|---|
| M1 权威面脚本判定回退（F1） | RED | ① 子代理执行权威面脚本被拒 |
| M2 `--grant` 派工状态检查回退（F2） | RED | 6 条（done/aborted 各 3 条） |
| M3 full 私有目录文案回退（F3） | RED | 2 条（工作区之外 / 批准提示） |
| M4 等级快照回退 | RED | 会话中途提权对已在飞的会话不生效 |
| M5 legacy 迁移回退（RG-03） | RED | legacy 行仍是 active |
| M6 批准人校验回退（F1 纵深） | RED | 2 条 |
| M7 第二道防线回到不分形态（D-58） | RED | 精确文件条目不触发第二道防线 |
| M8 私有记忆死条目拦截回退（D-58） | RED | 私有记忆目录的 --grant 被拒 |

结论：**8 个变异体全部让对应的新断言变红** —— 新断言不是恒绿空断言。

## 3. 改了哪些文件

| 文件 | 改了什么 |
|---|---|
| `plugin/scripts/guard.mjs` | 权威面脚本判定（F1-1）、等级快照（F1-4）、越界分型诊断（F3）、第二道防线按形态判（D-58）、批准提示只在可批准时给 |
| `plugin/scripts/lib.mjs` | `--grant` 派工状态检查（F2）、legacy 迁移不提升状态（RG-03）、私有记忆目录共享判据（D-58） |
| `plugin/scripts/dispatch.mjs` | 派工写 tier 快照（F1-4）、闸门 1b 改用共享判据（D-58） |
| `plugin/scripts/scope-amend.mjs` | 批准人校验（F1-2）、私有记忆目录扩权白拒（D-58）、批准/拒绝进 changes.log（A4）、头部硬规矩改写（F1-3） |
| `tests/guard-test.mjs` | F1 三条 + D-58 三条（新增） |
| `tests/scope-amend-test.mjs` | F2 六条 + F1 纵深六条 + F3 三条 + RG-03 三条 + 快照三条 + A4 两条 + D-58 两条（新增） |
| `plugin/README.md` | tier 四条例外、诚实边界、批准人口径（F1-3 / F4） |
| `plugin/CHANGELOG.md` | 新增「[未发布]」段落、484/487 口径统一（F4） |
| `plugin/skills/super-agent-router/references/contract.md` | S13.2 第 4 条、S13.3 诚实边界与快照、S13.5 补一段（F1-3） |
| `plugin/skills/super-agent-router/references/scope.md` | 四条例外、措辞、快照（D-58 / F4） |
| `docs/audit/fix-f1-f5-rg03.md` | 本报告 |

草稿区（不算交付物）：`docs/audit/.tmp-fix/mutation-check.mjs`、`docs/audit/.tmp-fix/check-audit-log.mjs`。

## 4. 回归结果（亲眼见过）

```
node tools/run-tests.mjs --all --root plugin --repo .   # 仓库副本
node tools/run-tests.mjs --all --repo .                  # 安装副本
```

两份副本结果**逐项相同**：chain 47 / d27-mut 14 / dispatch-release 30 / e2e 47 / **guard 199** /
hooks 26 / records 30 / roster 18 / **scope-amend 67** / scope 21 —— 十套 0 FAIL；
`lessons-test` **红**。

**`lessons-test` 的红不是本轮缺陷（证据）**：

1. 报错文案逐字出自 `plugin/scripts/lessons.mjs:241`（另一名成员 `sa-gate-integrity` 的在途改动，
   要求写入必须声明 `session_id`）—— 我没碰过这两个文件（`git status` 里它们有改动但不是我的）。
2. `tests/lessons-test.mjs:52` 的调用 `gate(GOOD)` 的载荷里**没有** `session_id`，所以被新规则拒。
3. 他还没改这个测试文件（`git status` 显示 `tests/lessons-test.mjs` 未被修改）。
4. 结论：该套件的红是他在途改动导致的**跨套件并发假红**，等他改完测试即恢复；
   本轮改动涉及的十套（含本轮新增断言的两套）在**仓库副本与安装副本都 0 FAIL**。

**审计留痕（A4）**：回归跑完后，真实项目变更账的 mtime 仍是本会话开始之前、
里面没有任何测试标记（`docs/audit/.tmp-fix/check-audit-log.mjs` 的输出）——
本轮所有批准/提权都写进了**沙箱**的变更账，测试断言见 `tests/scope-amend-test.mjs:151-158` 与 `:366-372`。

## 5. 需要父会话做什么

1. **`session-start.mjs:52-53` 的注入文案已过期**：它还在告诉父会话用 `--approver router` ——
   现在批准人必须是真实的父会话 id（否则被拒，错误信息里会列出已知父会话 id）。
   那个文件不在我的所有权里，**请改或转派**（改法：把 `router` 换成「你的父会话 id」，
   或加一句「父会话 id 见 `--list` 的待审清单」）。
2. **部署要再跑一次**：`sa-gate-integrity` 落地后，他的 `lessons.mjs` / `lessons-gate.mjs` 与
   `tests/lessons-test.mjs` 会变；届时重跑 `node tools/deploy-plugin.mjs` 并重测十一套。
3. **断言总数**：发布前重测一次并把总数写进发布说明（CHANGELOG 里我刻意没钉死）。
4. **D-58 的后半步（若要「精确单个私有记忆文件可读」）**：需要改契约 S13.4 + 范围层 + 
   第二道防线按条目来源区分 —— 属于协议决定，我没做，等派单。
5. **台账编号**：D-44~D-48、D-54、D-58 由父会话写入 `docs/audit/defect-ledger.md`
   （本报告按父会话给的编号引用）。
6. **独立验收**：本轮是定向修复，**建议派 verifier 复验**（重点：把 F1-1、F1-4、D-58 三处回退后，
   新断言是否真的变红）。

## 6. 自评：还差什么

- F1-1 的匹配仍按「插件安装目录下的具体文件」，**工作区里的同名 admin CLI 副本不在拦截面内** ——
  这是 brief 明确要求的行为（③），但它确实是一条残余提权路径（已被 F1-2 与等级快照削弱，非零）。
- `--approver` 校验对**蓄意**自提权无效（worker 知道父会话 id）—— 已在文档里写明是纵深防御。
- D-58 只修到「不卡死 + 白拒 + 讲清楚」，没做到「精确私有记忆文件可读」—— 理由与后续步骤见 §1 D-58。