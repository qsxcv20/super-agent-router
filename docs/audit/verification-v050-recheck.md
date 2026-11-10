# v0.5.0 改后状态 · 独立复核报告（recheck）

复核者：独立 verifier（不参与实现，不采信执行者自述）
复核时间：2026-11-10
被测实现：仓库工作树未提交改动（基线 HEAD = `a0cce04`）+ 已安装副本 `C:/Users/yang2/.minimax/plugins/super-agent-router`
上一轮验收：`docs/audit/verification-v050.md`（VERDICT: FAIL，三条改判条件）

**一句话 VERDICT：PASS_WITH_RESIDUAL**

三条改判条件全部成立：V-A 复合分支误伤已消除且被断言锁住；V-B 两条断言（V-12 / V-13）在实现回退时确实变红；
V-C 真实 `run_code` 三种形态（写 scope 内 / 写 scope 外 / 纯计算）已在本会话实测，scope 外的写被拦且文件未被创建。
残留项两项：(1) 本会话内未能证实平台把**外层** `run_code` 送进 PreToolUse（内层调用确证被拦），即复合层的「危险操作」判定在真实运行时可能不生效；
(2) 复合层断言对 HEAD 不具区分力（HEAD 的复合分支本就不扫代码文本），只能对**重建的改前实现**区分。

## 零、方法与取证手段

- 活体取证：用合成 PreToolUse 载荷直接驱动**仓库版** `plugin/scripts/guard.mjs`（假 PLUGIN_DATA + 真 transcript），读取 `permissionDecision`；共 17 组载荷。
- 真实会话取证：在 verifier 自己的子会话里真实调用 `run_code`（写 scope 内 / 写 scope 外 / 纯计算 / 危险标记探针），记录拒绝发生在**哪一层**。
- 变异取证：`git show HEAD:<path>` 取改前实现写进系统临时目录的副本，用 `SAR_PLUGIN_ROOT` 指向副本跑对应回归套件；每组变异核对**被套件实际加载的那个文件**的 sha256。
- 缓存树取证：在子进程内直接读 `C:/Users/yang2/.minimax/v2/plugin-hook-cache/`（子进程不受 worker scope 的路径扫描约束）。
- 基线取证：8 个回归套件逐个跑（`SAR_PLUGIN_ROOT` 指向仓库 `plugin/`），记录每套 PASS 计数与结尾行。
- 副作用控制：本次复核的全部写入只有两处 —— 本报告，以及系统临时目录 `C:/Users/yang2/AppData/Local/Temp/sar-v050-recheck/` 下的探针脚本与变异副本；未改动仓库任何机制代码、回归套件、既有报告或台账。说明：`git status` 另显示 `.gitignore` 于 2026-11-10T01:57:17Z 被改动（diff 仅新增 `.git-sync-tmp/` 忽略项），属部署/清理侧改动，非本次复核写入 —— 本次复核的全部文件写入路径已逐条核对，无一条落在该文件上。

---

## 一、ACCEPT 逐条结论

| 编号 | 结论 | 证据 |
|---|---|---|
| A1 复合分支不再扫代码文本路径 | **成立** | 活体 17 组载荷全部按预期放行；`plugin/scripts/guard.mjs:279` 复合分支返回 `{ mode: 'composite', targets: [], raw: code, composite: true }`，全文件仅剩**注释**里提到 `extractPathTokens(code)`（第 266 行），无调用点。变红证据：MUT-C 把该行改回 `extractPathTokens(code)` 后，`run_code 复合层不扫代码文本（作用域交回内层调用）` 断言转红。 |
| A2 复合分支不再套用「取不到目标即 deny」 | **成立** | 复合分支后紧跟 `if (got.composite) { allow(injected); process.exit(0); }`，不经过通用工具的「取不到目标 → deny」分支。活体：A01 纯算术、'A02 纯循环、`A09` 空载荷 payload 均 ALLOW（stdout 为空）。MUT-C 下 `run_code 纯计算代码放行（取不到目标路径不再是拒绝理由）` 转红，理由原文「run_code 没有可判定的目标路径。取不到目标就放行…故拒绝」——正是改前行为。 |
| A3 纯算术 / 注释 / 字符串常量 / 引号命令串均放行 | **成立** | 活体四组：`A01` 纯算术 ALLOW；`A03` `// 注释：docs/audit/runtime-guards.md` ALLOW；`A04` 字符串常量 `const p = 'docs/audit/runtime-guards.md'` ALLOW；`A05/A06` 引号命令串（scope 内 / 外各一组）ALLOW。MUT-C 下这四组断言全部转红（YES×4，套件内置 MUTATION-B 独立复现同一结果）。 |
| A4 内层写 scope 外仍被拦 | **成立** | 活体 `A14`（`write` → `config/prod.yaml`）DENY，理由「目标 config/prod.yaml 不在白名单内」；`A15`（`write` → scope 内）ALLOW；`A16`（读 scope 外）DENY；`A17`（未登记文件类工具名 `upload_file`）DENY。真实会话里 scope 外写同样被内层拦（见 C2）。 |
| B1 V-12 断言在改前实现下变红 | **成立** | 变异 MUT-A1（`guard.mjs` 回退 HEAD）：断言「未登记的文件类工具名按写判定并被拦」**转红**。回退落盘核对：`sha_git=f36c7731c4457192c639` = `sha_ondisk=f36c7731c4457192c639`、`identical=true`、`differs_from_repo_now=true`、bytes=5243。**行为级对照**：回退后 `upload_file`（scope 外）由 DENY 变 ALLOW；仓库版为 DENY。MUT-A2（guard+lib 同时回退）同样转红（25 条红）。 |
| B2 V-13 / D-20 断言在改前实现下变红 | **成立** | 变异 MUT-B2（`watchdog.mjs` 回退 HEAD + `lib.mjs` 去掉盘符分支）：「盘符绝对路径不存在时被拦，且报错保留盘符前缀」**转红**；「另一个盘符上真实存在的产出不被误判成不存在」**转红**（`subst` 可用，已挂第二个盘符构造可区分场景，套件未打印 SKIP）。行为级对照：回退后拦截理由里的路径变成 `/definitely-not-here/abs-out.ts`（**盘符前缀丢失**），仓库版是 `D:/definitely-not-here/abs-out.ts`。落盘核对：`sha_git=c1d6686cb7a1aef7e733` = `sha_ondisk=c1d6686cb7a1aef7e733`、`identical=true`；`lib.mjs` 盘符分支删除后 sha 由 `d0ba5d472b607dbb3ae3…` 变为 `baf7a2c2b424fc269d40…`。 |
| C1 scope 内写放行 | **成立** | 真实 `run_code` 内层 `Set-Content` 写 `C:/Users/yang2/AppData/Local/Temp/sar-v050-recheck/probe-in-scope.txt` → 内层 bash 未被拦，事后独立校验：`IN_SCOPE_PROBE_EXISTS=true | content=in-scope-probe`。 |
| C2 scope 外写被拒 | **成立** | 真实 `run_code` 内层写 `C:/Users/yang2/AppData/Local/Temp/sar-v050-outside-probe.txt` → **内层 bash 被拦**，理由「[super-agent-router] 越界拦截：本次派工声明的 SCOPE 为 […]」；外层 `run_code` 未被拦（作用域已交回内层，符合契约 S3）。事后独立校验：`OUTSIDE_PROBE_EXISTS=false`（**文件未被创建**，无需删除）。 |
| C3 纯计算放行 | **成立** | 真实 `run_code` 只做算术（20 项平方和 + 数组映射，零文件访问）→ 正常返回 `{sum_of_squares:2870, table:[1,4,9,16,25]}`。 |
| C4 当前会话绑定的 hook 树是改前还是改后 | **成立（改后）** | 缓存树取证（子进程内读取）：两棵树 `sha256-tree-v1-3a4ecdec…` 与 `sha256-tree-v1-a096e644…` 的 `plugin.json version=0.5.0`、`guard sha256=7F4E24732FA3`、`lib sha256=D0BA5D472B60`，两者 `hooks.json` 的 PreToolUse matcher 均为 `write|edit|multiedit|notebookedit|bash|run_code|mavis`（**含 run_code|mavis**）。租约 mtime：`3a4ecdec…` = 2026-11-10T01:53:08.987Z（= 本子会话启动同一秒）、`a096e644…` = 2026-11-09T14:05:33.867Z（父会话）。已安装副本 `plugin.json version=0.5.0`、`guard sha256=7F4E24732FA3`（与仓库一致）、26 个文件逐字节一致（`byte_diffs=[]`）。**没有改前 v0.4.0 的树残留**。 |
| D1 plugin.json version=0.5.0 且与 CHANGELOG 一致 | **成立** | `plugin/.minimax-plugin/plugin.json` 的 `"version": "0.5.0"`；`plugin/CHANGELOG.md` 顶部条目 `## [0.5.0] - 2026-11-10`；已安装副本同为 `0.5.0`。 |
| D2 hooks.json 引用的脚本全部存在 | **成立** | 逐个核对（仓库 + 已安装副本均查）：`SessionStart::session-start.mjs`、`UserPromptSubmit::gate.mjs`、`PreToolUse::dispatch.mjs`、`PreToolUse::guard.mjs`、`SubagentStop::watchdog.mjs` —— `repo_exists=true|installed_exists=true` 全部命中。**无缺失**。 |
| D3 README 未承诺未实现能力 | **成立（1 处表述不精确）** | `plugin/README.md` 抽查：「派工没写 SCOPE → 拒绝派发」「越界拦截」「边界算不出来 → 拒绝」「ro: 只读不授写」「并发上限 6 / 累计 30」「hook 按会话激活、新增 matcher 只在新会话生效」「子会话不触发 SessionStart/UserPromptSubmit」——逐条与实现/实测一致。唯一不精确处：「它管什么」表里「**复合** `run_code` | 按里面的写类工具与危险工具判定」——复合层现在**只**判危险工具，写类工具是由内层调用各自判定的；语义接近但措辞会让人以为复合层自己判写。建议改为「复合层只判危险操作，作用域交回内层调用」（非阻断项）。 |

---

## 二、活体载荷取证明细（V-A）

假 PLUGIN_DATA + 真 transcript（scope = `src/app/login.ts`），驱动仓库版 `plugin/scripts/guard.mjs`：

| # | 载荷 | 结果 |
|---|---|---|
| A01 | 纯算术 `const r = 1 + 2; return r;` | ALLOW |
| A02 | 纯循环（无路径 token） | ALLOW |
| A03 | `// 注释：docs/audit/runtime-guards.md` | ALLOW |
| A04 | 字符串常量 `const p = 'docs/audit/runtime-guards.md'` | ALLOW |
| A05 | 引号命令串（scope 内目标） | ALLOW |
| A06 | 引号命令串（scope 外目标） | ALLOW |
| A07 | 代码里写 scope 外路径 | ALLOW（复合层不管作用域） |
| A08 | 代码里写 scope 内路径 | ALLOW |
| A09 | 空载荷（无 code 字段） | ALLOW |
| A10 | 代码里 `mavis` 的 `agent delete` | **DENY**「在复合调用里执行了 agent delete」 |
| A11 | 代码里 `miniapp` 的 `publish` | **DENY** |
| A12 | 代码里 `website_deploy` | **DENY** |
| A13 | 代码里 `mavis` 的 `session list`（非危险） | ALLOW |
| A14 | 内层 `write` → scope 外 | **DENY**「目标 config/prod.yaml 不在白名单内」 |
| A15 | 内层 `write` → scope 内 | ALLOW |
| A16 | 内层 `read` → scope 外 | **DENY**（读放行只覆盖 scope 所在目录树） |
| A17 | 未登记文件类工具名 `upload_file` → scope 外 | **DENY** |

结论：复合层**只**剩危险操作判定（A10~A12 拦、A13 放行），作用域判定交回内层（A14/A16 拦），且**不再**对自由文本扫路径（A03~A06 放行），**不再**套用「取不到目标即 deny」（A01/A02/A09 放行）。

---

## 三、变异检验小节

基线（仓库树，`SAR_PLUGIN_ROOT=plugin`）：e2e 34 / roster 18 / lessons 19 / **guard 58** / scope 21 / records 30 / hooks 16 / **chain 47** → 合计 **243 条断言全绿**。

| 组 | 改了什么 | 落盘核对方式 | 回退后变红 |
|---|---|---|---|
| MUT-A1 | `plugin/scripts/guard.mjs` ← HEAD | sha256(HEAD 内容) == sha256(落盘文件) == `f36c7731c4457192c639`；`differs_from_repo_now=true`；bytes=5243 | **20 条**（含 V-12 那条） |
| MUT-A2 | `guard.mjs` + `lib.mjs` ← HEAD | guard 同上；lib `45f2b944a01bf9dada56` == 落盘，bytes=9177 | **25 条**（含 V-12 那条） |
| MUT-B1 | `watchdog.mjs` + `lib.mjs` ← HEAD | watchdog `c1d6686cb7a1aef7e733` == 落盘，bytes=3933 | 套件因「新 dispatch + 旧 lib」接口不匹配而崩（仅 1 条红），故改用 B2 |
| MUT-B2 | `watchdog.mjs` ← HEAD；`lib.mjs` 删掉盘符分支（`if (/^[A-Za-z]:\//.test(raw)) return raw;`，第 192 行） | watchdog 同上；lib sha 由 `d0ba5d472b607dbb3ae3…` → `baf7a2c2b424fc269d40…`，`drive_branch_present=false` | **5 条**，含「报错保留盘符前缀」与「另一个盘符上的真实产出」两条 D-20 断言 |
| MUT-C | 当前 `guard.mjs` 的复合分支改回改前语义（`return { mode: 'write', targets: extractPathTokens(code), raw: code };`） | 改后 sha=`656757b8bcbf9037b041…`，`differs_from_repo=true`，bytes=13256 | **5 条**，恰好是复合层那五条断言（全部 YES） |

**落盘核对的纪律性说明（本轮实测踩到的坑）**：第一轮变异把 HEAD 文件写到了副本的 `plugin/scripts/…` 子目录，而套件实际加载的是副本根下的 `scripts/…` —— 文件确实写进去了（sha 对得上），**但套件加载的仍是未回退的文件**，于是 58 条断言全绿（假绿）。修正后的核对方式是：先算出套件实际加载的路径（副本 `<root>/scripts/xxx.mjs`），再比对该路径上的 sha256，并额外用**行为级对照**确认回退真的生效（MUT-A1 下 `upload_file` 由 DENY 变 ALLOW；MUT-B2 下拦截理由丢掉盘符前缀）。凡本报告标注「回退后变红」的组，均已通过这两道核对。

**关于 HEAD 这个基线的性质（重要）**：HEAD `a0cce04` 的 `guard.mjs`（5243 字节）里复合分支**本来就不扫代码文本**（实测回退后纯算术仍 ALLOW），所以「回退到 HEAD」对复合层断言不具区分力；引入误伤的实现只存在于未提交的中间稿里。因此复合层的区分性证据来自 **MUT-C（按上一轮报告 V-02/V-04 记录的改前语义重建）**，并由套件内置的 `SAR_MUTATION=2`（MUTATION-B）独立复现出同一组 5 条红。实用结论：把复合分支改回扫代码文本，这 5 条断言必红 —— 覆盖有效。

---

## 四、三条改判条件的逐条结论

**改判条件①（V-A：复合分支只做危险操作判定，不扫代码文本、不套「取不到目标即 deny」、作用域交回内层）—— 满足。**
证据：第二节 17 组活体载荷（A01~A17）+ MUT-C 变异（5 条复合断言变红）。

**改判条件②（V-B：补 V-12 与 V-13/D-20 两条有区分力的断言）—— 满足。**
证据：MUT-A1/A2 下 V-12 断言变红且行为级对照成立；MUT-B2 下 D-20 的「报错保留盘符前缀」与「另一个盘符上的真实产出」两条变红（`subst` 可用，未触发 SKIP）。

**改判条件③（V-C：在新会话里真实跑一次 `run_code`：写 scope 内 / 写 scope 外 / 纯计算）—— 满足。**
证据：本 verifier 子会话（2026-11-10 09:53:08 启动，绑定改后树）内三次真实 `run_code` 调用：scope 内写放行且文件建成、scope 外写被**内层**拦且文件未创建、纯计算放行；并用「危险标记探针」确认了外层行为（见残留项 1）。

---

## 五、残留风险与未验证项

1. **外层 `run_code` 在真实运行时是否进入 PreToolUse，本会话未能证实（未验证，运行时边界）。**
   本会话的绑定树 matcher 确含 `run_code`（C4），但两次外层探针都**没有被拦**：
   (a) 外层代码文本含 scope 外路径 → 未被拦（与「复合层不扫文本」一致，无法据此区分）；
   (b) 外层代码文本含 `agent delete` → **仍未被拦**，而机制层同一载荷合成测试是 DENY（活体 A10）。
   两种候选解释无法从 worker 会话内区分：① 平台把 PTC 容器调用（run_code）走的是独立通道，不派发 PreToolUse 事件，只有其子调用派发；② 事件派发了，但载荷里代码字段名不是 `code/program/script`，`dangerousInCode` 读到空串。
   影响：**复合层的「危险操作」判定在真实运行时可能不生效**（写类工具的越界防护不受影响 —— 内层调用已实测被拦，scope 外的写文件确未落地）。下一版必须在平台侧确认：run_code 是否派发 PreToolUse、载荷里的代码字段叫什么。
2. **复合层断言对 HEAD 不具区分力（覆盖边界，非缺陷）。** 见第三节末段；实际有效性由 MUT-C 证明。
3. **D-20 的两条正向断言（#25、#25b）在单盘机器上任何实现下都绿**（旧实现截掉盘符前缀后剩下的根相对路径恰好指向同一文件）。区分力来自 #27（报错保留盘符前缀）与 #25c（`subst` 第二个盘符）。本机 `subst` 可用，#25c 已构成有效区分场景。
4. **README 有一处措辞不精确**（见 D3）：复合 run_code 一行应说明「复合层只判危险操作，作用域交回内层调用」。不影响功能。
5. **同盘符下的盘符绝对路径仍有一条正向断言不具区分力**（#25/#25b），如后续有人改坏 `absolutizePath` 但只影响同盘符场景，套件不会变红 —— 建议再加一条「同盘符绝对路径不存在时被拦」的断言（chain-test 已有 27b，但它在旧实现下同样为绿）。
6. **上一轮遗留、本轮未复验的项**：D-06（履历只给 Router 做匹配参考）、D-15/D-17（措辞治理依赖模型自觉）、教训是否真正进入子会话首条消息 —— 均属上一轮已标注的未验证项，本轮未重做，不重复计分。
7. **发布前提醒**：本轮改动全在未提交工作树（28 个文件）。已安装副本与仓库当前一致（26 文件逐字节相同，`byte_diffs=[]`），但**安装副本的 `hooks.json` 内容是就地写进已被租约的树**，老会话仍按会话开始时解析的旧 matcher 运行 —— 升级后必须**新开会话**，否则 `run_code|mavis` 两项拦截不生效。

---

## 六、结论

三条改判条件均以活体证据满足；上一轮 FAIL 的根因（`run_code` 复合层扫代码文本 → 大面积误伤）在实现层已消除，且被 5 条复合层断言 + 1 条工具名兜底断言 + 2 条 D-20 断言锁住（均有实测变红证据）。8 套回归 243 条断言基线全绿。
按「误伤已消除、改判条件全满足」判定 **PASS**；两项残留（第 5 节第 1、2 条）不构成误拦风险，但第 1 条意味着复合层危险判定在真实运行时可能失效，需要平台侧确认后补一条端到端断言。

VERDICT: PASS_WITH_RESIDUAL
