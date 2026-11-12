# D-97 独立验收报告（对抗性复核 · 仓库副本范围）

- 验收对象：D-97「无进展重复调用闸门（loop-gate）在真实运行时恒不触发」
- 验收人：Verifier（独立复核，子会话 mvs_50726a8614b5409b9631c1323f5abee5）
- 仓库状态：HEAD = 9f886cb（远端 09bd3a50b3）；修复前基线 = 6fd064b；工作区干净（git status 无输出）
- 运行时间：2026-11-12 17:12:05 +08:00 ；环境：Windows / Node v26.7.0
- 写入边界：仅 `docs/audit/.tmp-verify-d97/`（仓库只读，未改任何既有文件，未 commit/push/安装/重启）

> **口径声明（先说死）**：本报告只回答**仓库副本**上的问题。
> 「机制正确（回放）」与「链路连通（客户端活体）」是两件事，本报告只证明前者。
> 客户端里是否真被拦下，**本轮拿不到证据**（要装新副本 + 用户重启客户端 + 全新子会话），
> 本报告**不**宣布「客户端里已生效」。

---

## 0. 结论摘要

**VERDICT: PASS_WITH_CONDITIONS**

| 问 | 答 | 证据强度 |
|---|---|---|
| D-97 在仓库副本里修好了吗？ | **修好了**（机制层） | 强：直接拿**未经改动的真实宿主投影字节**回放 ⇒ 第 6 次逐字相同调用 DENY |
| 修得对吗？ | 对：投影口径的对齐/计数/择一/回退/留痕均实测符合契约 S15 §2 | 强：黑盒 7 例 + 白盒层 + 边界探针 |
| 有没有破坏 D-91？ | 没有：5 个锚点**函数体逐字未变**（sha256 逐个相同） | 强：blob 级比对 + 变异矩阵 MISS=0 |
| 引入新问题了吗？ | 机制层**没有**；发现 **1 处断言覆盖缺口**（实现正确但不可证伪）+ **用户-facing 文档口径过时** + **1 处证据清单数字错误** | 中/强 |

**扣分项（= CONDITIONS）**：
1. `plugin/scripts/loop-gate.mjs:678` 的「unknown 打断连续段但不计入」语义**无任何断言钉住**（变异后 64 PASS / 0 FAIL，而两种实现黑盒判定相反）——实现是对的，但**不可证伪**。
2. `plugin/CHANGELOG.md:10` / `plugin/README.md:84` / `plugin/README.md:637-638` 仍宣称「PTC 形态下闸门恒不触发，**已修**」，而 D-97 证明**已安装副本里该症状仍在**；两文件对 D-97 **零提及**。
3. `docs/audit/.tmp-verify-d97/raw-runtime-manifest.json` 的 `lines`（171 / 4920）与文件实际行数（19 / 39）不符（sha256 与字节数都对 ⇒ 文件本体是真的，只有行数口径写错）。

---

## 1. 执行的检查与真实输出

### 1.1 全量回归（自跑）

命令：`node tools/run-tests.mjs --all --root plugin --repo .` ⇒ exit=0

    RESULT chain-test exit=0 pass=70 fail=0
    RESULT d27-mut-test exit=0 pass=14 fail=0
    RESULT dispatch-release-test exit=0 pass=58 fail=0
    RESULT e2e-test exit=0 pass=53 fail=0
    RESULT fix-d80-d85-test exit=0 pass=49 fail=0
    RESULT guard-test exit=0 pass=228 fail=0
    RESULT hooks-test exit=0 pass=36 fail=0
    RESULT ledger-test exit=0 pass=23 fail=0
    RESULT lessons-test exit=0 pass=65 fail=0
    RESULT loop-gate-test exit=0 pass=64 fail=0
    RESULT records-test exit=0 pass=52 fail=0
    RESULT roster-test exit=0 pass=38 fail=0
    RESULT scope-amend-test exit=0 pass=119 fail=0
    RESULT scope-test exit=0 pass=38 fail=0
    >>> SHELL ALL PASS

**真实数字：14 套 / 907 条断言 / FAIL = 0**（loop-gate-test 单独 64 条 / 0 FAIL）。

### 1.2 台账自洽（自跑）

命令：`node tools/ledger-check.mjs` ⇒ exit=0

    摘要：{"statsLine":9,"indexRows":102,"detailCount":102,"statusUnion":102,"indexIds":102}
    PASS 台账检查 index-columns / sets-equal / severity-distribution / detail-meta-line / detail-count / no-duplicate-d
    >>> 台账自洽

**真实数字：6 项检查全 PASS / 102 条缺陷 / exit 0。**

### 1.3 输入来源核对（原始投影字节）

对父会话拷进的两份原始文件独立复算 sha256 与结构：

| 文件 | 字节 | manifest sha256 | 实测 sha256 | 一致 | manifest 声称行数 | 实测行数 |
|---|---|---|---|---|---|---|
| raw-runtime-A.compatible.jsonl | 41125 | 8c691394…9664 | 8c691394…9664 | 是 | 171 | **19** |
| raw-runtime-B.compatible.jsonl | 484367 | 954a9ebe…a22f | 954a9ebe…a22f | 是 | 4920 | **39** |

⇒ **文件本体是逐字节真实的**（sha256 相同）；**manifest 的行数口径写错了**（见发现 3）。

结构化统计（自写脚本 analyze-structure.mjs / analyze-content.mjs / analyze-tooluse.mjs）：

    A: 顶层键 = message,parentUuid,sessionId,timestamp,toolUseResult,type,uuid   （无 turn_id）
       content[] 类型计数 = text:18, tool_use:8, tool_result:8 ；toolCall = 0 ；details.ptc.child_calls 数组数 = 0
       tool_use 元素键 = {id,input,name,type} ；input 键 = {code,description} ；name 全是 run_code
    B: 顶层键 = 同上 + subtype ；content[] = text:37, tool_use:18, tool_result:17 ；toolCall = 0 ；child_calls 数组数 = 0
       tool_use 元素键同上 ；input 键 = {code,description,timeout_ms}

### 1.4 自造活体形态输入 → 喂真实实现（脚本 probe-live-d97.mjs）

用**原始投影的真实行**（同一条 assistant tool_use 行 + 其 tool_result 行）拼出「前 N 次相同 + 第 N+1 次是当前调用」，
再用**内层 bash 载荷**（tool_name='bash'、tool_input={command}、agent_type='worker'）喂 plugin/scripts/loop-gate.mjs：

| # | 形态 | 期望 | 实测 | stderr 留痕 |
|---|---|---|---|---|
| A1 | 5 次相同 + 第 6 次当前（真实行复制，tool_use id 改成唯一） | DENY | **deny**（原文含「你已经连续第 6 次…前 5 次的归一化指纹完全一致」） | 无 |
| A2 | 第 4 次（3 次前序 + 当前） | ALLOW | **ALLOW** | 无（阈值未到，正常放行不属留痕义务） |
| A3 | 同一份 bash 形态文件，载荷换成 read | ALLOW | **ALLOW** | 有：「兼容投影里定位不到当前调用（内层载荷与外层条目不可比）⇒ 本子会话的重复调用不可见，放行」 |
| A4 | 当前内层命令不同（echo A-DIFFERENT-COMMAND） | ALLOW | **ALLOW** | 无 |
| A5 | 连跑被中间一条不同命令打断 | ALLOW | **ALLOW** | 无 |
| A6 | 同 A1，但不覆盖 SAR_LOOP_GATE_SESSION_ROOT（走真实会话库回退路径） | DENY | **deny** | 无 |
| A7 | 同 A1，载荷无 turn_id | DENY | **deny** | 无 |

### 1.5 直接跑**未经改动的真实宿主投影**（脚本 probe-real-files.mjs）

关键发现：**raw A 里天然存在一段 6 次逐字相同的内层 bash**（node -e "process.stdout.write('SAR_PROBE_FRESH')"），
所以不需要任何合成就能复现 D-97 的原始场景：

| # | 输入（文件**逐字节未改**） | 载荷 | 实测 |
|---|---|---|---|
| R1 | raw-runtime-A | 那 6 连发里的命令 | **deny**（原文「你已经连续第 6 次发起**完全相同**的工具调用（工具=bash，前 5 次的归一化指纹完全一致…）」） |
| R2 | raw-runtime-A | 另一条命令（仅 1 次出现） | ALLOW |
| R3 | raw-runtime-B | 其中一段真实 3 连发的命令 | ALLOW（前序只有 2 次 ⇒ 未达阈值） |
| R4 | raw-runtime-A | 同 R1，但载荷无 agent_type（父会话） | ALLOW（父会话一律放行） |

阈值敏感性（同一份真实文件、同一载荷）：

    SAR_LOOP_GATE_MAX_SAME=3 -> deny ；=4 -> deny ；=5 -> deny      （真实连跑长度 6 ⇒ 3/4/5 都该拦）

### 1.6 阴性观察的三件套（金丝雀 + 时间戳 + 会话/环境标识）

- **金丝雀**：每一次 ALLOW 都在**同一次运行、同一份文件**上配了对侧阳性对照 —— R1/R2/R4 用的是同一份 raw A 与同一份载荷口径，
  只换命令或只换 agent_type；A1/A2/A3/A4/A5 用的是同一批构造文件。也就是说：**ALLOW 不是「文件读不出来」造成的**，
  因为同一文件同一载荷换个参数就能 deny。
- **时间戳**：2026-11-12 17:12:05 +08:00（本报告所有命令同批执行）。
- **会话/环境标识**：子会话 mvs_50726a8614b5409b9631c1323f5abee5；仓库 HEAD 9f886cb；工作目录 C:\Users\yang2\Documents\MiniMax\mini code的插件；Node v26.7.0；
  会话库回退在主用例中被显式指向不存在的目录以隔离（隔离版与**不隔离**版结论一致，见 A1/A6）。

### 1.7 D-91 锚点逐字比对（脚本 compare-anchors4.mjs）

用 git plumbing 取到**两个提交的 blob 原文**（git ls-tree + git cat-file -p，字节级，未经 PowerShell 文本管道）：

    baseline blob = 0ca54a2706d79f35adab6bbc561cc45c7fc7c7ce  (6fd064b)  28532 B
    HEAD     blob = 297490d5fe32c56a0855a960361f60dd27eabd11  (9f886cb)  45410 B
    HEAD blob == 工作区文件字节：true          （我测的就是提交进仓库的那份代码）

| 锚点 | 基线 sha256(前16) | HEAD sha256(前16) | 结论 |
|---|---|---|---|
| pickNamespace() | 6b72f15e6f230dd9 | 6b72f15e6f230dd9 | 逐字相同 |
| innerCallsOf() | 93418597529751ce | 93418597529751ce | 逐字相同 |
| innerComparable() | b0c1558a30bc12b9 | b0c1558a30bc12b9 | 逐字相同 |
| incomparableFp() | 9c067cbc8678c2ed | 9c067cbc8678c2ed | 逐字相同 |
| callsFromLines() | 789d6175032f52b1 | 789d6175032f52b1 | 逐字相同 |

独立交叉验证：git diff 6fd064b..9f886cb -U0 -- plugin/scripts/loop-gate.mjs 的**新文件改动行集合**与 HEAD 里
这 5 个函数的行区间（287-309 / 339-342 / 354-370 / 378-388 / 398-425）**交集为空**。

### 1.8 变异矩阵复跑（仓库自带执行器，仓库只读）

node tests/fixtures/d91-mutation-matrix.mjs . ⇒ exit=0

    BASE pass=64 fail=0 exit=0
    M1 pickNamespace 恒返回 outer    : 专属红=是 EXTRA-RED=3 判定=EXTRA-RED(3)
    M2 不可比分支不生效              : 专属红=是 EXTRA-RED=0 判定=恰好红一条
    M4 哨兵改用正常指纹              : 专属红=是 EXTRA-RED=1 判定=EXTRA-RED(1)
    M6 innerCallsOf 读错层级         : 专属红=是 EXTRA-RED=3 判定=EXTRA-RED(3)
    M7 innerComparable 恒 false      : 专属红=是 EXTRA-RED=3 判定=EXTRA-RED(3)
    M8 不可比记录直接丢弃            : 专属红=是 EXTRA-RED=1 判定=EXTRA-RED(1)
    MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=11

**逐条核对 11 条 EXTRA-RED 的红点名称：全部以「D-91 …」开头，输出中不含任何「D-97」行** ⇒
D-97 新增断言未被 D-91 的变异体牵连（该项要求满足）。

node tests/fixtures/d97-mutation-matrix.mjs . ⇒ exit=0

    基线：pass=64 fail=0 exit=0
    M-D97a 投影口径不生效     : 专属红=是 EXTRA-RED=0 判定=恰好红一条
    M-D97b 对齐层恒判不匹配   : 专属红=是 EXTRA-RED=2 判定=EXTRA-RED(2)
    M-D97c 当前调用被计入     : 专属红=是 EXTRA-RED=2 判定=EXTRA-RED(2)
    M-D97d 动态参数当可比     : 专属红=是 EXTRA-RED=0 判定=恰好红一条
    MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=4

### 1.9 夹具来源核对（脚本 profile-fixture.mjs）

| 结构化计数 | tests/fixtures/d97-hook-compatible.jsonl | raw A | raw B |
|---|---|---|---|
| details.ptc.child_calls 数组数 | **0** | **0** | **0** |
| content[] 里 type='tool_use' | 6 | 8 | 18 |
| content[] 里 type='toolCall' | **0** | **0** | **0** |
| 顶层键集合 | message,parentUuid,sessionId,timestamp,toolUseResult,type,uuid | 同左 | 同左 + subtype（因含 system 行） |
| tool_use 元素键 | id,input,name,type | 同左 | 同左 |
| tool_result 元素键 | content,is_error,tool_use_id,type | 同左 | 同左 |
| tool_use 元素名 | run_code ×6 | run_code ×8 | run_code ×18 |

⇒ 夹具与真实投影**同源**（结构逐项一致）；它是**脱敏后的子集**（去掉了正文 text 块、11 行 vs 19/39 行），
不是某一份运行时文件的字节拷贝。台账「结构逐字取自」的措辞与实测相符。

### 1.10 真实投影里「可计入条目」的比例（脚本 analyze-literal-coverage.mjs）

对齐规则要求内层参数**取得出字面量**（否则 unknown ⇒ 打断且不计入）：

    raw A：tool_use 共 8 个 ⇒ 字面量可取 8/8（0 个动态）
    raw B：tool_use 共 18 个 ⇒ 字面量可取 7/18，动态 11/18
             动态样本：{ command: 模板串含 ${ROOT} }、{ path: 模板串含 ${ROOT}/plugin/… }、
                       { pattern: '…', path: ROOT }、以及 write（按全部参数取指纹 ⇒ 代码文本没法逐键比）

### 1.11 自造变异体（可证伪性，脚本 mutate-and-check.mjs）

在**我自己的可写目录里**复制 plugin/ 后改动（**仓库未动**），再分别跑仓库套件（SAR_PLUGIN_ROOT 指副本）与我的真实文件探针：

| 变异 | 改动 | 套件结果 | 我的探针（真实 raw A） |
|---|---|---|---|
| X1 | loop-gate.mjs:751  if (owned === 0 && excluded === 0) → if (owned === 0) | 64 PASS / **FAIL=0** | deny（未变） |
| X2 | loop-gate.mjs:678  if (verdict !== 'match') break; → if (verdict === 'mismatch') break; | 64 PASS / **FAIL=0** | deny（未变） |
| X3 | loop-gate.mjs:824  if (same < n) → if (same < n - 1) | 64→60 PASS / **FAIL=4** | deny（未变） |
| X4（阳性对照） | projectionTrailing 取**首个**匹配而不是末个 | 64→62 PASS / **FAIL=2** | **deny → ALLOW（探针被变异翻转）** |

⇒ X3、X4 证明相关断言**会红**（可证伪）；X4 同时证明**我的探针结果依赖实现、不是巧合**。
**X1、X2 两个语义变异没有任何断言变红** ⇒ 这两处语义当前**不可证伪**（其中 X2 是可观测的行为差异，见发现 1）。

### 1.12 边界探针（脚本 probe-edges.mjs，全部跑在仓库版实现上）

| # | 形态 | 实测 | 说明 |
|---|---|---|---|
| E1 | 前置一条**动态参数**条目 + 5 条逐字相同 + 当前 | **ALLOW** | unknown 打断连续段且不计入 ⇒ 同一份文件在 X2 变异体上却 **deny** ⇒ 两种实现判定相反，但**无断言区分** |
| E2 | 只有 5 条逐字相同（无动态条目） | ALLOW | 未达阈值，正确 |
| E3 | 5 次前序，**当前外层条目尚未落盘** | ALLOW | ⇒ deny 依赖「当前外层 tool_use 已先落盘」这一前提 |
| E4 | 一个 code 块里两个内层调用（末位=当前） | **deny** | 与「取最后一个内层调用」的口径一致 |
| E5 | 6 次逐字相同的 read（同 path+offset+limit） | **deny** | read 同参也是重复（换 offset/limit 才是新信息） |
| E6 | 连跑中间被一条不同命令打断 | ALLOW | 连续段断开，正确 |

---

## 2. 逐条结论（对应任务书 1~9 项）

**1）读实现** —— 完成。plugin/scripts/loop-gate.mjs 全文读过：投影口径（projectionCallsOf）、
对齐规则（innerTailOf / argValuesOf / tailMatches / directEntryMatches）、
计数基准（projectionTrailing：cur=末个与载荷相等的外层条目，prior=其之前的条目）、
来源择一（main() 里 transcript_path 优先、resolveSessionTranscript 回退）、
fail-open 留痕（allow(reason) 写 stderr；投影定位不到 / 归属不符 / 扩读触顶 三种失败态都有留痕）。
tests/loop-gate-test.mjs 的 D-97 段（8 条断言：黑盒 4 + 白盒 4）读过。

**2）自己跑回归** —— 完成。**14 套 / 907 条 / FAIL=0**；ledger-check **6 项 PASS / 102 条 / exit 0**（见 §1.1、§1.2）。

**3）自己造活体形态输入** —— 完成。用**原始投影字节**的真实行拼出「前 5 次相同 + 第 6 次当前」，
用**内层 bash 载荷**喂 plugin/scripts/loop-gate.mjs ⇒ **DENY**（A1）。
更强的一条：直接用**未经改动的 raw-runtime-A**（其中天然含 6 连发）⇒ **DENY**（R1）。
**用的是我自写的脚本**（probe-live-d97.mjs / probe-real-files.mjs），未调用仓库夹具或成员脚本。

**4）阴性对照** —— 完成，逐条实测：
① 第 4 次 ⇒ ALLOW（A2、R3）；② 工具名换 read（在 bash 形态文件上）⇒ ALLOW + 留痕（A3）；
③ 内层命令不同 ⇒ ALLOW（A4）；附加：连跑被打断 ⇒ ALLOW（A5/E6）、父会话 ⇒ ALLOW（R4）、当前条目未落盘 ⇒ ALLOW（E3）。

**5）夹具来源核对** —— 完成，结构化计数逐项同源（§1.9）；差异是「脱敏子集」而非字节拷贝，已如实记录。

**6）D-91 未被破坏** —— 完成：5 个锚点**函数体 sha256 逐字相同**（§1.7）；两个变异矩阵 MISS=0；
D-91 矩阵的 11 条 EXTRA-RED **红点全部是 D-91 断言，不含任何 D-97 断言**（§1.8）。

**7）文档口径核对** —— 完成（.superagent/STATUS.md 除外，见 §4 边界）。
- 契约 S15 §2：plugin/skills/super-agent-router/references/contract.md:727-748 口径**正确且克制**，
  明确写「投影形态按内层尾调用对齐」「计数基准：宿主先落外层 tool_use」「客户端活体拦截证据以装入新副本并重启后的复验为准 —— 未取到之前**不许**写成「已生效」」。
- 台账 D-97 明细段 + 状态段：docs/audit/defect-ledger.md:496-499、:1603-1607 状态为「**已修（待独立验收）**」，
  并写明「**未闭合：活体拦截证据未取到**」⇒ **没有**把仓库副本的修写成客户端已生效。
- 修复报告 docs/audit/fix-d97.md §7.1 明写「现有证据是回放，**不是**客户端里真被拦下」⇒ 口径正确。
- **但用户-facing 文档有旧口径未收**（见发现 2）。
- plugin/README.md 与 plugin/CHANGELOG.md 对「D-97」**零命中**（grep count = No matches found）。

**8）可证伪性** —— 完成（§1.11）。X3（阈值差一）红 4 条、X4（阳性对照）红 2 条且把我的探针从 deny 翻成 ALLOW；
**X1、X2 两个变异 0 红** ⇒ 对应语义当前**没有断言钉住**（发现 1、发现 4）。仓库与 plugin/ 未被改动（变异只发生在副本上）。

**9）活体证据的现实边界** —— 已遵守：报告全程限定在「仓库副本」，**没有**宣布客户端已生效；
活体拦截证据本轮**未取到**（见 §4）。

---

## 3. 发现的问题（按严重度排序）

### 发现 1 · P2 · 断言覆盖缺口：「unknown 打断连续段但不计入」在投影计数层**不可证伪**
- 位置：plugin/scripts/loop-gate.mjs:678（if (verdict !== 'match') break;），语义归属 loop-gate.mjs:656-682（projectionTrailing）
- 触发条件：窗口里存在**内层参数取不出**的外层条目（变量 / 表达式 / 模板插值 / 按全部参数取指纹的工具），
  且其后的条目与当前载荷逐字相同。
- 证据：变异 X2（verdict !== 'match' → verdict === 'mismatch'）跑仓库全套件 **64 PASS / FAIL=0**；
  而 E1 黑盒对比显示两种实现**判定相反**（仓库版 **ALLOW** vs X2 变异体 **deny**）⇒ 该差异**可观测但无人钉住**。
- 影响：**当前实现是对的**（与契约 S15 §2「unknown 打断连续段但不计入」一致），
  但它**没有断言保护** ⇒ 后人把 break 改成 mismatch 时全套件仍然全绿，而行为会从「少拦」翻成「**凭空造出连续重复 ⇒ 误伤**」。
  仓库自带的 tests/fixtures/d97-mutation-matrix.mjs 也只覆盖了 tailMatches 本身（M-D97d），没覆盖它的**消费者**。
- 结论：**不是实现缺陷，是断言缺口**。建议（在 D-97 收尾里补）：给 projectionTrailing 加一条「前置换一条动态条目 ⇒ same 不跨过它」的断言，
  或把 X2 加进 d97-mutation-matrix.mjs。

### 发现 2 · P2 · 用户-facing 文档口径过时：仍宣称「PTC 形态下闸门恒不触发，已修」，而已安装副本里该症状仍在
- plugin/CHANGELOG.md:10：「一句话：**重复调用闸门在 PTC 形态下恒不触发，已修**（按载荷形态择一计数，两套序列绝不混数）；」
- plugin/README.md:84：「本版（0.5.9）在 0.5.8 的基础上修掉了「重复调用闸门在 PTC 形态下恒不触发」的问题（D-91），」
- plugin/README.md:637-638：「**同一个子代理连续发起 5 次完全相同的工具调用**（中间没有任何别的工具调用）时，**第 6 次当场被拦下**。」
- 为什么不对：D-97 证明**已安装的 v0.5.9 副本**里闸门在真实运行时仍然**一次都没触发**（根因：hook 读到的
  %TEMP%/…/*.compatible.jsonl 投影里没有 child_calls、tool call 是 tool_use+input）。
  D-91 的「按载荷形态择一计数」在**会话库形态**上是对的，但**不覆盖宿主实际喂给 hook 的那份投影**。
  ⇒ 这三处把「D-91 的机制层修复」写成了「用户可见的症状已消失」，与实测不符。
- 补充事实：plugin/README.md 与 plugin/CHANGELOG.md 对「D-97」**零命中**；D-97 修复**没有**任何用户-facing 条目。
- 影响：读者会以为 0.5.9 已经装好就能看到闸门生效；实际要等 D-97 进安装副本 + 重启 + 新会话。
- 建议（不属于本次验收的执行范围）：发布时补 CHANGELOG 条目，并把 README:84 与 README:637-638 的措辞收紧为
  「D-91 修了会话库形态；D-97 修了宿主实际投影形态」+ 指向「需重装 + 重启 + 新开会话」。

### 发现 3 · P3 · 证据清单的行数口径写错（文件本体是真的）
- 位置：docs/audit/.tmp-verify-d97/raw-runtime-manifest.json 的 lines 字段 = **171 / 4920**；两份副本**实测**行数 = **19 / 39**
  （bytes 与 sha256 两项**都对**，我独立复算一致 ⇒ 拷贝本身逐字节真实，只有行数写错）。
- 影响：复核者按「171 行 / 4920 行」去核对会以为文件被截断；不涉及被审对象的行为。
- 建议：把 lines 改成实测值，或改成「行数按 <空行不计入> 统计」并写明口径。

### 发现 4 · P3 · excluded === 0 守卫未被任何断言钉住
- 位置：plugin/scripts/loop-gate.mjs:751（if (owned === 0 && excluded === 0) {）
- 证据：变异 X1（去掉 excluded === 0）→ 64 PASS / FAIL=0；我的探针也未翻转。
- 影响：**当前语料下不可观测**（会话库形态文件里没有 tool_use 元素 ⇒ 投影分支产出 0 条目 ⇒ 行为不变），
  但一旦出现**同时含两种形态**的文件，这个守卫的语义（会话库口径认不出调用且**没有任何调用被归属键排除**时才启用投影口径）就会失守。
- 结论：潜在未钉语义，非当前缺陷。

### 发现 5 · P3 · 计数基准依赖「当前外层 tool_use 已先落盘」（已写进契约，但未独立复现该时序）
- 证据：E3（当前外层条目不在文件里、只有 5 次前序）⇒ **ALLOW**（不拦）。
- 契约 contract.md:740-742 与 docs/audit/fix-d97.md §1「差异 3」都写明这条前提，
  成员称是**活体实测**（投影文件 mtime 距探测时刻 0.7s、最后一条 tool_use 即当时正在执行的那次）。
- 我的判定：该前提在**原始投影的行序**里成立（assistant 的 tool_use 行总在它自己的 tool_result 行之前），
  但「外层条目先于**内层调用**落盘」这一**具体时序**我**未独立复现** ⇒ **转述，待核**。

### 发现 6 · P3 · 真实运行时可覆盖比例明显低于「6 连发即拦」的直觉（未量化进文档）
- 证据：raw B 的 18 个 tool_use 里 **11 个**的内层参数取不出（模板插值 / 裸标识符 / 全参数工具）⇒ unknown ⇒ 打断连续段且不计入。
  raw A 则是 8/8 可取。
- 影响：真实会话里，**只要连跑序列中混进一条动态参数条目**，连续段就断 ⇒ 闸门看不到那组重复（fail-open，方向安全）。
- 现状：契约已把「动态参数取不出 ⇒ unknown ⇒ 该次不被拦」写成诚实边界（contract.md:744-745），
  但**没有给出覆盖率量级**；建议在对外文档里给一句量级说明，避免读者以为「6 连发必被拦」。

### 发现 7 · P4 · 「6 次逐字相同即拦」对 read 同样成立（语义澄清，非缺陷）
- 证据：E5 —— 6 次**同 path+offset+limit** 的 read ⇒ **deny**；换 offset/limit 才是新信息。
- 说明：任务书阴性对照 ②「工具名换成 read 应放行」在**bash 形态文件**上成立（A3 ALLOW + 留痕）；
  在**read 形态文件**上，同参连读 6 次被判为重复是**规则本意**（契约 S15 §2：read 连 offset/limit 一起取）。
  两处口径不冲突，列出以免被误读成矛盾。

---

## 4. 仍未闭合的边界（本轮无法验证的部分）

1. **客户端活体拦截证据**（最关键）：本机跑的还是**旧安装副本**（宿主绑定的是注册时解析的缓存树），
   本轮**不装新版、不重启客户端** ⇒ **拿不到**「运行中的客户端里真被拦下」的证据。
   ⇒ 机制正确（回放）已坐实；**链路连通（客户端活体）本轮未验证**。
2. **.superagent/STATUS.md 读不到**：tools.read 与 git diff 两种方式都被护栏拦下
   （.superagent/ 是编排层私有目录，不在本次 SCOPE 白名单内，扩权只有父会话能做）。
   ⇒ 任务书第 7 项要求核对该文件的表述，**本轮未完成**；若父会话要求该项必须核，请扩权或代为核对。
   （已知：D-97 提交动了它 3 行，内容未读。）
3. **宿主内部实现未复核**：app.asar 源码（PluginHookTranscript.create() / pluginHookTranscriptPaths()）在工作区外，
   本轮**未读**；「hook 读的是投影而不是 messages.jsonl」这一事实我是靠**实测输入文件**（%TEMP% 下的 .compatible.jsonl）
   与真实运行行为反推确认的，不依赖源码。
4. **真实会话的覆盖面未做统计**：只有 2 份真实投影（8 + 18 个 tool_use），
   「闸门在真实会话里能拦多少」没有样本量意义；发现 6 的量级说明仅供参考。

---

## 5. 本次自产脚本清单（均在 docs/audit/.tmp-verify-d97/，仓库未改）

| 文件 | 用途 |
|---|---|
| analyze-structure.mjs / analyze-shape2.mjs / analyze-content.mjs | 原始投影的顶层键、content[] 类型、tool_use 内部形态 |
| analyze-tooluse.mjs | tool_use 的 id/输入键/内层 code 尾调用抽取（sha256 与 manifest 核对） |
| analyze-literal-coverage.mjs | 字面量可取 vs 动态的比例统计 |
| profile-fixture.mjs | 夹具 vs 真实投影的结构化计数对照 |
| probe-live-d97.mjs | 自造活体形态 + 阴性对照矩阵（A1~A7） |
| probe-real-files.mjs | 直接跑未经改动的真实宿主投影（R1~R4 + 阈值敏感性） |
| probe-edges.mjs | 边界探针 E1~E6 + 与 X2 变异体的判定对比 |
| compare-anchors2/3/4.mjs | D-91 锚点字节级比对（含 diff hunk 交叉验证） |
| mutate-and-check.mjs | 自造变异体 X1~X4（副本上跑，仓库未动） |
| stdin-to-file.mjs / strip-bom.mjs | git blob 提取、报告去 BOM |

（仓库既有件 docs/audit/fix-d97-evidence/ 与 tests/fixtures/d97-* 是**被审对象**，本报告未把它们当证据源。）

---

## 附录 A · 父会话处置记录（2026-11-12，父会话 mvs_9bdda202ae274c909a5b4352fc45a471）

**本文件正文是独立验收方报告的逐字转写**（源：docs/audit/.tmp-verify-d97/fix-d97-verification.md）。
以下附录由父会话追加，不改动验收原文。

### 结论

**VERDICT: PASS_WITH_CONDITIONS**（验收方原文口径：只覆盖仓库副本，客户端活体证据本轮拿不到）。

### 验收方 7 条发现的处置

| 发现 | 严重度 | 父会话处置 |
|---|---|---|
| 发现 1 · unknown 打断但不计入的语义无断言钉住 | P2 | **待返工**：派 sa-mechanism-fix 在既有 D-97 会话上补断言（前置一条动态条目 ⇒ same 不跨过它），并把该语义变异体加进 d97 变异矩阵；**不改实现** |
| 发现 2 · 用户文档口径过时 | P2 | **本轮已订正**：plugin/CHANGELOG.md 加 [Unreleased] 段 + 0.5.9 段末订正指针；plugin/README.md 的升级节与「第 6 次当场被拦下」两处收紧 |
| 发现 3 · manifest 行数口径写错 | P3 | **已订正**（见下「父会话自己的 bug」） |
| 发现 4 · excluded === 0 守卫未被钉住 | P3 | **待返工**：与发现 1 同单补一条断言（当前语料下不可观测，属潜在未钉语义） |
| 发现 5 · 计数基准依赖「当前外层 tool_use 已先落盘」 | P3 | **父会话已独立复核**（见下），并将在活体端到端复验时一并坐实 |
| 发现 6 · 真实运行时可覆盖比例低于直觉 | P3 | **已写进契约** S15 §2（新增「量级」一段：实测一份真实投影 18 条外层条目里 11 条取不出 ⇒ 不是「6 连发必被拦」），CHANGELOG 的 [Unreleased] 段也写了 |
| 发现 7 · 同参 read 连读 6 次会被拦是规则本意 | P4 | **无需改动**（契约 S15 §2 已写明 read 连 offset/limit 一起取；验收方已注明两处口径不冲突） |

### 父会话自己的 bug（已订正）

验收方发现 3 是**父会话的错误**：拷原始投影时写的 manifest 里，行数是按「文本里出现字面量两字符 \n 的次数」算的，
不是真实行数（把 JSON 里的转义序列当成了换行）⇒ 报成 171 / 4920，真实是 19 / 39。
**文件本体一直是逐字节真实的**（sha256 与字节数都对，验收方独立复算一致）⇒ 只是统计口径写错，已订正。

### 父会话对验收方两处「待核」的独立复核

1. **发现 5 的前提（当前外层 tool_use 先于内层调用落盘）**：父会话用**自己此刻正在跑的这次调用**实测 ——
   当前会话的活体投影里 `tool_use` 42 条 / `tool_result` 41 条，多出来的那条 `tool_use` 正是**当时正在执行**的这次
   （它自己的 tool_result 还没落盘）⇒ 该前提**成立**。仍需活体端到端复验最终坐实。
2. **.superagent/STATUS.md 的口径**（验收方因不在其 SCOPE 内而未能核对）：父会话 `git diff 6fd064b..HEAD -- .superagent/STATUS.md`
   自查 —— 状态行写的是「D-97 已在仓库修好（活体证据仍未取到）」，诚实边界 1 追加段明确写「**本版仍不写「闸门已生效」**」
   ⇒ **没有把仓库副本的修写成客户端已生效**。

### 仍未闭合

1. **客户端活体拦截证据**：装新副本 + **用户重启客户端** + **全新子会话**（D-98）跑 6 连发 + 阳性对照 + 金丝雀。
2. **发现 1 / 发现 4 的断言补强**（P2 / P3）：待派 sa-mechanism-fix 返工（只改 tests/，不改实现）。
3. **发版由用户拍板**（版本号由用户定，用户已定口径：将来若开 = patch = v0.5.10）。
