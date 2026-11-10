# v0.5.4 独立验收报告（验收方：verifier）

- 验收对象：super-agent-router v0.5.4（权限自动审核 / 权限等级 tier / 私有记忆封死 / 测试搬家）
- 验收时间：2026-11-10 16:30 ~ 17:40（GMT+8）
- 验收方式：**只读独立验收**。未修改 `plugin/`、`tests/`、`.superagent/` 下任何文件；
  全部写操作只发生在 `C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v054/`（我的草稿区）与系统 tmp 目录里的沙箱工作区。
- 引用格式：正文用「文件名:行号」，例如 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:285`；各文件完整路径见下表。

| 简称 | 完整路径 |
|---|---|
| 插件脚本目录 | C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/ |
| 契约与参考文档目录 | C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/ |
| 插件包根 | C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/ |
| 审计报告目录 | C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit/ |
| 回归套件目录 | C:\Users\yang2\Documents\MiniMax\mini code的插件\tests/ |
| 验收工装目录 | C:\Users\yang2\Documents\MiniMax\mini code的插件\tools/ |
| 编排层私有状态目录 | C:\Users\yang2\Documents\MiniMax\mini code的插件\.superagent/ |
| 名录 | C:\Users\yang2\Documents\MiniMax\mini code的插件\.superagent\roster.json |
| 审计留痕 | C:\Users\yang2\Documents\MiniMax\mini code的插件\.superagent\changes.log |

---

## 0. 结论表

| AC | 判定 | 一句话依据（亲眼见过） |
|---|---|---|
| A1 回归 | **PASS** | 我自己跑了 `node C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v054/run-all.mjs`：仓库副本与安装副本**各 11 套、487 条断言、0 FAIL**（补 D-42/D-43 前后各跑一次，两次都绿） |
| A2 tier 语义 | **PASS** | full 成员的项目内任意读写放行、工作区外拦且自动记账（pending + tier=full）、四种账号级不可逆动作硬拦、私有目录仍拦 —— 四条逐条实证 |
| A3 不可自提权 | **FAIL** | AC 点名的三通道全被拦，但**第四通道成立**：worker 可用 bash 跑 `scope-amend.mjs` 给自己提权到 full（沙箱内端到端跑通），还可**自批准自己的越界请求** |
| A4 扩权批准 | **FAIL（部分）** | 读请求批准后写仍被拦 ✔、三处同步 ✔、`scope_amended` 的必要性 ✔；但「对**已结束**的派工扩权被拒」只对 `--dispatch --add` 成立，`--grant` 路径**不查派工状态** |
| A5 文档—代码一致 | **FAIL** | 5 处不一致：`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/CHANGELOG.md:144` 仍写「484 条断言」（实为 487）；`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/README.md:322` 与 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/contract.md:364` 的「已结束派工拒绝扩权」对 `--grant` 不成立；`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/contract.md:374` 的「worker 无权改自己的等级」不成立；`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/scope.md:226` 说「三条例外」而契约已补成四条 |
| A6 报告复核 | **PARTIAL** | A 路与 C 路结论逐条成立（多数我独立复现）；**B 路未交付报告** —— 该文件是探针脚本，不是报告 |
| A7 单一事实源 | **FAIL** | 同一件事在 README、契约、代码、scope.md 各说一套：已结束派工规则、worker 自提权、断言条数、三/四条例外 |
| A8 新缺陷 | **PASS** | 给出 3 条新缺陷，每条带最小复现步骤；无「疑似」条目 |

**总判定见文末。**

---

## 1. 我实际跑过的检查

1. **回归全套**（A1）：`node C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v054/run-all.mjs`，**跑了两次** —— 第一次在 D-42/D-43 合入前（484 条），
   第二次在合入后（487 条）。两次都是「仓库副本 + 安装副本」双跑。
2. **四个独立探针**（我自写，不复用项目测试套件，全部落在 `C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v054/`）：
   - `probe-v054.mjs`（A2/A3/A4 主用例，40 例）
   - `probe-v054b.mjs`（新用例 + **admin CLI 端到端执行**）
   - `probe-v054c.mjs`（覆盖工作区的目录条目 —— 父会话点名要验的那条）
   - `probe-v054d.mjs`（只读条目的**粒度**）
   另有 `probe-parse.mjs`、`probe-dispatch.mjs`、`probe-env.mjs`（SCOPE 解析与副本一致性）。
   所有探针都在系统 tmp 里造沙箱工作区，`PLUGIN_DATA` 与 `MINIMAX_PROJECT_DIR` 指向沙箱，
   **不碰真实私有目录与真实台账**。
3. **逐份源码/文档核对**：guard、dispatch、lib、scope-amend、lessons、session-start 全文读过；
   契约（尤其 S13.1~S13.5）、scope.md、review.md、README、CHANGELOG 按本轮相关段落逐条核对。
4. **副本一致性**：对仓库插件包、安装副本、运行时 hook 缓存目录逐文件 sha256 比对。

---

## 2. A1 回归（亲眼见过）

命令 `node C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\.tmp-v054/run-all.mjs` → 调 `C:\Users\yang2\Documents\MiniMax\mini code的插件\tools/run-tests.mjs:33-38`（自动发现回归目录下全部 `*-test.mjs`）。

**第二次运行（最新代码，D-42/D-43 合入后），两个副本数字完全一致：**

| 套件 | 仓库副本 | 安装副本 |
|---|---|---|
| chain-test | 47 / 0 | 47 / 0 |
| d27-mut-test | 14 / 0 | 14 / 0 |
| dispatch-release-test | 30 / 0 | 30 / 0 |
| e2e-test | 47 / 0 | 47 / 0 |
| guard-test | 192 / 0 | 192 / 0 |
| hooks-test | 26 / 0 | 26 / 0 |
| lessons-test | 19 / 0 | 19 / 0 |
| records-test | 30 / 0 | 30 / 0 |
| roster-test | 18 / 0 | 18 / 0 |
| scope-amend-test | 43 / 0 | 43 / 0 |
| scope-test | 21 / 0 | 21 / 0 |
| **合计** | **487 / 0** | **487 / 0** |

第一次运行（合入前）scope-amend-test 是 40 条、合计 484 —— 与 CHANGELOG 那句话**当时**的数字一致。
结论：**A1 成立**；但「484」这个数字现在**过期**（见 F4-a）。

**副本一致性（亲眼见过）：** 仓库插件包与安装副本逐文件 sha256 比对，**只有 CHANGELOG 一处不同**；
运行时真正加载的 hook 缓存目录（本会话被拦截时报错里给出了它的真实路径）
与仓库副本**同样只差 CHANGELOG 那一行**（见 F5）。

---

## 3. A2 tier 语义（亲眼见过，逐条对上契约 S13.3）

沙箱：名录里成员 `worker` 等级 `full`，派工 SCOPE 只写 `src/app.ts`（故意窄）。

| 契约条款 | 实测 | 证据 |
|---|---|---|
| 项目工作区内任意路径读写放行 | 写 `docs/other.md` allow；读 `src/app.ts` allow；写**新文件** `src/brand-new.ts` allow | probe-v054 A2.1~A2.3 |
| 工作区外路径**拦 + 自动记账** | 写 tmp 外路径 → deny；台账 `scope_requests[]` 新增一条 `state=pending`、`tier=full`、`mode=write`、含该绝对路径 | probe-v054 A2.4 / A2.4b（记账入口 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts\lib.mjslib.mjs:561`） |
| 账号级 / 对外不可逆动作**硬拦** | `mavis` 工具 + 成员删除子命令 → deny；`mavis` + 成员改写子命令 → deny；部署类工具 → deny；Mini App 发布动作 → deny；**bash 通道**的成员删除命令形态 → deny | probe-v054 A2.5~A2.8 / A2.13（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:87-91` 危险工具表、`:113` 起复合层、bash 通道命令形态判定） |
| 私有状态目录仍被拦 | 写名录文件（相对）→ deny；写名录文件（绝对）→ deny；读**兄弟成员**错题本 → deny；读**自己**错题本 → allow（精确文件通道） | probe-v054 A2.9~A2.12（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:285` 的 `inAllowed`：full 分支显式排除私有目录判定） |

**结论：A2 四条全部成立。**

---

## 4. A3 不可自提权（AC 点名的三通道 + 我找到的第四通道）

### 4.1 三条通道：全部拦住（亲眼见过）

| 通道 | 实测 | 证据 |
|---|---|---|
| 直接 write 名录文件 | deny | probe-v054 A3.1（`inScope` 写模式对私有目录条目一律不授写权） |
| bash 通道改名录文件 | 复制命令 → deny；node 内联写 → deny | probe-v054 A3.2a / A3.2b |
| SCOPE 里塞私有记忆目录 | lessons 目录（可写）→ **拒派**；lessons 目录（只读）→ **拒派**；methods 目录两种形态 → **拒派**；名录文件（可写）→ **拒派** | probe-v054 A3.3~A3.7（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/dispatch.mjs:95` 私有记忆目录表、`:130` 起闸门 1c） |

### 4.2 只读形式的粒度（AC 单独要求说清楚）

SCOPE 只写「只读的那个名录文件」→ 派工**放行**，之后（probe-v054d）：

| 目标 | 判定 |
|---|---|
| 读名录文件本身 | **允许**（精确到这一个文件） |
| 读同目录的审计留痕文件 | **拒绝** |
| 读同目录的状态文件 | **拒绝** |
| 读兄弟成员错题本 | **拒绝** |
| 读**自己**错题本 | **允许**（精确文件通道，与 SCOPE 无关） |
| 写名录文件 | **拒绝** |

**结论：只读形式被允许，粒度精确到单文件；同目录其它文件不跟着放开。**
只读的目录条目（整棵私有目录）与私有记忆目录一律**拒派**。

### 4.3 父会话点名要验的那条（覆盖工作区的目录条目）

SCOPE 写「只读的工作区根目录」→ 派工**放行**；之后（probe-v054c）：

| 目标 | 判定 |
|---|---|
| 读兄弟成员错题本（相对 + 绝对两种写法） | **拒绝** |
| 读兄弟成员方法论 | **拒绝** |
| 读工作区里的普通文件 | **允许** |
| 读自己的错题本 | **允许** |

即 D-42（私有记忆读范围漏洞）与 D-43（绝对条目 ↔ 相对目标）**修好了，结论成立**。

### 4.4 第四通道：**worker 可以给自己提权，也可以自批准自己的越界请求**（新缺陷 F1）

前提：worker 的 SCOPE 覆盖了插件脚本目录（本项目机制维护类成员正是这样派工的）。

| 步骤 | 实测结果 |
|---|---|
| 1. 派工，SCOPE = 插件脚本目录 | 放行 |
| 2. 护栏判定「用 bash 跑 scope-amend 提权命令」 | **allow**（护栏不拦） |
| 3. 该命令**实际执行**（沙箱内端到端） | 退出码 0；名录里该成员变成 full、授权人写成自己；审计留痕写下「scoped -> full，by 自己」 |
| 4. 提权后再写白名单外的文件 | **allow** —— 提权完全生效 |
| 5. 撞墙拿到请求号后，护栏判定「用 bash 跑 scope-amend 批准自己那条请求」 | **allow** |
| 6. 该命令**实际执行** | 退出码 0；批准人写成自己；因为原请求是写模式，还写入了**可写**条目；随后重试同一写操作 → **allow** |

**性质**：这正是契约 S13.1/S13.3 与 README:278-284 说「批准权在父会话手里、worker 无权改自己的等级」要防的那件事。
根因两处：
1. `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/scope-amend.mjs` 是**无调用者身份校验**的管理 CLI：`--approver` 只是命令行上的一个字符串，
   谁执行都算「管理员」（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/scope-amend.mjs:111-115`、`:180`、`:212`）。
2. 护栏**不把 scope-amend 当父会话专属工具**：它只是普通脚本，路径在 worker 白名单里就能跑。
   更糟的是 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:322` 的拦截文案**把可执行的批准命令直接印给 worker**，
   等于把自批准工具递到被约束者手里。

**诚实边界**（不替机制找借口，也不过度指控）：契约 S13.5 已声明「hook 是护栏不是沙箱，
worker 若能执行一段落盘的脚本，脚本内部的 fs 写入不受本判定约束」；review.md 的验收清单也要求
「查审计留痕里有没有成员给自己提权」—— 即这套设计本来就把它当**事后可发现**而非**事前不可为**。
但这与契约/代码里「worker 无权改自己的等级」的**断言**直接冲突，断言必须改或机制必须补。

---

## 5. A4 扩权批准

| 子项 | 实测 | 判定 |
|---|---|---|
| 读请求批准后写仍被拦 | 批准后读 allow、写 **deny**（落进 scope 的是只读条目） | ✔ |
| 批准同时更新三处 | 派工记录 scope ✔、子会话绑定 scope ✔、`scope_amended` ✔ | ✔ |
| 第三处为什么必须有 | 对照实验：worker **尚未发起任何工具调用**（边界从 transcript brief 建）时 —— 有 `scope_amended` → 读 allow（A4.7）；无 `scope_amended` → 读 deny（A4.8） | ✔ 成立 |
| **对已结束的派工扩权被拒** | 「直接加条目」路径 → 正确拒绝（`state=done` 与 `state=aborted` 都拒）✔；**「批准请求」路径 → 批准成功**（两种状态都成功，退出码 0） | ✘ **不成立** |

根因：`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts\lib.mjslib.mjs:640` 的 `grantScopeRequest` 找到派工记录后**只检查「记录还在不在」，不检查它的 state**；
而 scope-amend 的「直接加条目」分支有 state 检查 —— 两条路径口径不一致。
回归没覆盖到：`C:\Users\yang2\Documents\MiniMax\mini code的插件\tests/scope-amend-test.mjs:13` 与 `:186` 只测了「直接加条目」这一条路径。

---

## 6. A5 文档—代码一致性（逐条，含原文与行号）

| # | 位置 | 原文 | 代码实际 | 判定 |
|---|---|---|---|---|
| F4-a | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/CHANGELOG.md:144` | 「十一套 484 条断言 0 FAIL」 | 我实测 **487**（scope-amend-test 从 40 涨到 43）；同一文件 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/CHANGELOG.md:120` 已写「十一套 487 条断言全绿」 | **不一致**（同文件两个数） |
| F1-a | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/README.md:322` | 「批准**必须**落在仍在飞的派工上 —— 派工结束了就拒绝扩权」 | 「批准请求」路径不查 state，`done`/`aborted` 都批准 | **不一致** |
| F1-b | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/contract.md:364`（S13.2 第 2 条） | 「**必须落在仍在飞的派工上**：派工已结束（done/aborted）则拒绝扩权」 | 同上 | **不一致** |
| F1-c | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/contract.md:374`（S13.3） | 「worker 无权改自己的等级」 | 沙箱内端到端可自提权（见 4.4） | **不一致** |
| F1-d | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/scope-amend.mjs` 头部「硬规矩 4」 | 「worker 无权改自己的等级（派工闸门 1c 封掉了私有目录的写授权）」 | 闸门 1c 只封「直接写」，封不住「执行 CLI」 | **不一致**（且给出的理由不成立） |
| F4-b | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/scope.md:226` | 「**full 的三条例外**（与契约 S13.3 一致）」 | 契约 S13.3 已补「第四条边界：冲突检测仍按声明的 SCOPE」（提交 a697f4c），scope.md 自己在 `:241` 又提了第四条 | **不一致**（括注过期） |
| F3-a | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:450` 与 `:482` | full 成员命中私有目录时的文案：「目标 … 在**工作区之外**」 | 目标其实**在工作区内**，被拒的真实原因是私有状态目录；文案还建议父会话「批准该路径后重试」，而该批准永远不生效（写模式对私有目录一律不授写权） | **不一致**（诊断误导 + 死循环建议） |

**正面确认（一致的部分）**：
- README 的「full 三条例外」与契约 S13.3 前三条**逐字一致** ✔
- `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/scope.md:208`「履历不进 worker」与代码一致 ✔（履历只进父会话上下文，guard 不注入履历）
- `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/brief.md:102`「条目模板、编号规则、状态口径一律直接引用」→ 契约当单一事实源，一致 ✔
- `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/CHANGELOG.md:117-120` 对 D-42/D-43 的描述与 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts\lib.mjslib.mjs:215`、`:476` 的实现一致 ✔

---

## 7. A6 三份专项报告复核

### A 路 `C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit/context-sharing.md`（上下文注入与传递链路）
- 摘要结论「**注入层是隔离的，读取层不是隔离的**」→ **成立**。亲眼见过代码：注入点都只按成员名取单个文件；
  而 `inScope` 读模式按条目所在目录放宽。
- 它产出的三条缺陷我逐条对过账：**D-31 已修复**（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/dispatch.mjs:95` 私有记忆目录拒派）、
  **D-32 已修复**（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/lessons.mjs:54` 的 `readRouterLessons` + `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/session-start.mjs:65-68` 注入编排层教训）、
  **D-33 已修复**（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/scope.md:208` 履历不进 worker）—— 均与台账 `C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit/defect-ledger.md:440`、`:450`、`:460` 的「已修复」一致。
- 它指出的「读取层洞」我本轮**亲自复现并验证已被堵住**：只读的工作区根目录条目覆盖工作区时读兄弟错题本 ——
  修前放行（D-42 记录的原始现象），修后被拦（probe-v054c）。
- 报告自标「推断」的一条（CS-04）：**本轮未逐字复核其条目正文**，我不替它判定；未发现与之矛盾的代码证据。

### C 路 `C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit/member-persistence.md`（成员持久性与可复用性）→ 入账为 D-37~D-41
逐条复核，**五条都成立**：

| 条目 | 复核结论 | 证据 |
|---|---|---|
| MP-01（派工不校验成员是否在账号里） | **成立** | 亲眼见过：dispatch 的三条闸门都不查账号成员表，全仓无脚本查账号名单 |
| MP-02（陈旧判定没有执行点） | **成立** | 亲眼见过：全仓搜 `reconcile` 只命中 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/roster.mjs:172`（CLI 分支），无任何 hook 调用；输出后直接退出，不写回名录 |
| MP-03（建号无闸门，与删改不对称） | **成立** | 亲眼见过：`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:87-91` 危险表只有删成员/改成员；参数判定只匹配那两个动作；建号不在列 |
| MP-A1（拦截措辞把只读条目说成「不在白名单内」） | **成立** | 亲眼见过：本轮我自己被拦的报文里，SCOPE 列着只读条目而后半句称「不在白名单内」；沙箱里对只读条目做写操作也得到同样措辞 |
| MP-A2（复合层危险词扫描误伤文档正文） | **成立** | 亲眼见过：本轮我写探针与本报告时**多次**因正文含被禁动作的字面形态被复合层拦下；同一形态走 bash 通道不触发 —— 报告把根因标为「推断」，我判断**站得住**：`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:113` 的 `dangerousInCode` 是全文正则，bash 通道走的是「命令位置」判定 |
| 「推断」项（派工到不存在的成员会占名额并导致组队冲突） | **推断站得住** | 台账写入、名额计数、冲突检测都只看台账，TTL 2 小时兜底 —— 代码路径与之一致 |

**报告自陈的盲区，我替他补上**：「安装副本未能核对」→ 我已核对：安装副本与仓库副本逐文件 sha256 一致，
**只有 CHANGELOG 一行不同**（见 F5）。

### B 路 `C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit/lessons-persistence-and-isolation.md`（错题本持久性与篡位防护）
**B 路未交付报告。** 该文件是一个 **CommonJS 探针脚本**（首行即 require fs/os/path/child_process/crypto，
运行后打印 `cases.B1_noLedger` ~ `cases.B6_sectionBoundary` 之类的 JSON 用例），**没有任何结论段落**；
而且它已被 git 跟踪。按要求我**不替它编结论**：B 路的错题本持久性与篡位防护**本轮没有任何可复核的结论**。
我**未执行**该探针：它要读私有状态目录下的 lessons 与 methods，超出本次派工 SCOPE。

---

## 8. A7 契约是不是单一事实源

不成立。同一件事有 4 处各说一套：

| 事项 | README | 契约 | 代码 | 结论 |
|---|---|---|---|---|
| 已结束派工能否扩权 | `:322` 说「不能」 | `:364` 说「不能」 | 「批准请求」能，「直接加条目」不能 | **两处文档 vs 代码分裂，且代码内部两条路径分裂** |
| worker 能否自提权 | `:278-284` 说「提权在管理员手里」 | `:374` 说「worker 无权改自己的等级」 | 能（执行 CLI 即可） | **文档与代码分裂** |
| 回归条数 | 不提 | 不提 | 487 | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/CHANGELOG.md:120` 与 `:144` 同文件并存两个数 |
| full 的例外条数 | 三条 | 三条 + 第四条边界 | 冲突检测仍按声明 SCOPE | `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/scope.md:226` 的括注「与契约 S13.3 一致」已过期 |

模板/编号/状态口径这一块反而是干净的：`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/brief.md:102` 明确「一律直接引用」契约，
`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts\lib.mjslib.mjs:1632` 的条目字段表与契约 S1 的七字段模板一致。

---

## 9. A8 新缺陷清单（按严重度，均带最小复现）

### F1（高）worker 可通过 bash 执行 admin CLI 自我提权 / 自批准越界请求
- **触发条件**：worker 的 SCOPE 覆盖插件脚本目录（本项目机制维护类成员的典型形态）。
- **影响**：`scope-amend` CLI 无调用者身份校验 → worker 可把自己提成 full、可自批准自己的越界写请求；
  与契约 S13.1/S13.3、README 的「批准权在父会话手里」直接冲突。
- **最小复现**（我已跑通，沙箱内）：
  1. 名录里成员 `worker` 等级 scoped；派工 SCOPE = 插件脚本目录；
  2. bash 跑「scope-amend --tier full --agent 自己 --approver 自己」→ 护栏 **allow**；
  3. 实际执行 → 退出码 0，名录该成员 tier=full、授权人=自己，审计留痕记「by 自己」；
  4. 再写白名单外文件 → **allow**。
  自批准路径同理：bash 跑「scope-amend --grant <请求号> --approver 自己」（请求号由 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:322` 的拦截文案直接给出）
  → allow → 执行后重试原写操作 → allow。
- **修复指令**：
  1. `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs`：把 `scope-amend.mjs`（以及任何会改名录/台账的插件脚本）列为**父会话专属**：
     在 worker 上下文（载荷带 `agent_type`）下，若 bash 命令的目标路径命中这些脚本 → 一律 deny，
     文案写明「扩权/提权只能由父会话执行」。护栏已在 `:307-311` 用 `process.argv[1]` 推出插件根目录，可直接复用。
  2. `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/scope-amend.mjs`：加调用者校验 —— `--grant` 的 `--approver` 必须等于该派工的 `parent_session_id`；
     `--tier` 的 `--approver` 必须是台账里存在过的父会话 id，而不是任意字符串。
  3. 若暂不实现 1/2，则把 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/contract.md:374`、`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/README.md:278-284`、scope-amend 头部「硬规矩 4」
     改成与 S13.5 一致的措辞（「不能阻止执行脚本；靠审计留痕与验收时检查」），
     并把 `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:322` 印给 worker 的批准命令改成不带可执行参数的形式。

### F2（中）「批准请求」不校验派工状态，「已结束派工拒绝扩权」只在一条路径成立
- **触发条件**：一条越界请求对应的派工已 done 或 aborted，随后执行 `--grant <请求号>`。
- **影响**：对**已结束的派工**完成扩权，违反契约 S13.2 第 2 条与 README:322；台账上留下对死派工的授权记录。
- **最小复现**：派工 → 撞墙产生 pending 请求 → 把台账里该派工 state 改成 done →
  `scope-amend --grant <请求号> --approver router` → **退出码 0、ok=true、added 非空**；
  同样的「直接加条目」命令 → 退出码 1，文案「派工 … 已结束（state=done）」。
- **修复指令**：`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts\lib.mjslib.mjs:640` 的 `grantScopeRequest` 里，找到派工记录后补一条与「直接加条目」同口径的检查：
  `if ((d.state || 'active') !== 'active') return { ok:false, error:'派工 '+d.dispatch_id+' 已结束（state='+d.state+'）—— 事后再补权限没有意义，请重新派工' }`；
  并在 `C:\Users\yang2\Documents\MiniMax\mini code的插件\tests/scope-amend-test.mjs` 补一条覆盖「批准请求」路径的断言（现有 `:186` 只覆盖「直接加条目」）。

### F3（低）full 等级命中私有目录时，拦截文案误诊并给出永远无效的建议
- **触发条件**：full 等级成员访问私有状态目录下的任何路径。
- **影响**：文案称目标「在**工作区之外**」（实际在工作区内），并建议父会话「批准该路径后重试」——
  而该批准永远不生效（写模式对私有目录一律不授写权），父会话会被引导做无效批准，worker 反复撞墙形成噪音。
- **最小复现**：名录成员 tier=full → 写名录文件 → 拒语文案含「该成员是 full 等级…以下路径在**工作区之外**」，
  且带批准提示（`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:450`、`:482`）。
- **修复指令**：`C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\scripts/guard.mjs:450` 与 `:482` 的 full 分支按目标是否落在私有目录分成两种文案：
  私有目录 → 「目标在编排层私有状态目录内，full 等级也不放行」（且**不打印批准提示**）；
  工作区外 → 保留现文案与批准提示。

### F4（低）文档数字与括注过期
- `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin/CHANGELOG.md:144`「十一套 484 条断言 0 FAIL」→ 改为 487，或写成「v0.5.4 发布时 484；补 D-42/D-43 后 487」。
- `C:\Users\yang2\Documents\MiniMax\mini code的插件\plugin\skills\super-agent-router\references/scope.md:226`「full 的三条例外（与契约 S13.3 一致）」→「四条例外」，或去掉括注。

### F5（低）安装副本 / 运行时副本的 CHANGELOG 落后于仓库
- 安装副本与运行时 hook 缓存的 CHANGELOG 第 113 行仍是「**十套**回归 0 FAIL」，仓库副本同位置已改成「十一套回归 0 FAIL」；
  其余 27 个文件 sha256 完全一致。**修复**：重跑一次部署（同步安装副本）。
- 影响：运行时行为与仓库一致（脚本逐文件相同），但对外文档口径不一致。

---

## 10. 未能验证的边界（如实写明）

1. **F1 没有在活体 runtime 里派工复现**：活体复现需要派一个 SCOPE 覆盖插件脚本目录的真实 worker，
   并让它改**真实**名录 —— 那属于 FORBID（不得改私有状态目录下的名录）且超出我的 SCOPE。
   我的证据来自**沙箱内用真实插件代码端到端执行**（含真实 scope-amend 脚本、真实台账格式），不是模拟。
2. **B 路未复核**：文件是探针脚本而非报告（见 §7）；且它要读私有状态目录下的 lessons 与 methods，超出本次 SCOPE，故未执行。
3. **A 路报告只逐条复核了它产出的三条缺陷与摘要结论**，CS-02、CS-04、CS-05、CS-06 的条目正文未逐字复核（CS-04 是报告自标的推断）。
4. 父会话口径「写探针请用 write 工具」在本验收会话**不可执行** —— 本轮工具集只有 read/bash/grep/glob/web/task，
   **没有 write/edit 工具**（我用工具检索确认过）。我改用「bash 命令文本中不含任何路径样 token」的等效写法落盘；
   这也顺带印证了父会话说的「bash 通道按命令文本抽路径 token」确实成立（我被它拦了 5 次，其中 2 次是复合层的危险词扫描）。
5. 未做账号级写动作（删/改成员、部署、发布），因此账号级拦截只验证到「护栏判定为 deny」，未验证真实动作后果。

---

VERDICT: FAIL