# D-77 修复报告：派工台账的无锁「读-改-写」⇒ 并发写静默丢记录

> 缺陷条目出处：docs/audit/defect-ledger.md 的 **D-77**（本报告不复述缺陷正文）。
> 条目模板出处：plugin/skills/super-agent-router/references/contract.md 第一节（S1）。
> 判定规则出处：同文件 S6（派工台账口径）/ S7（锁参数）/ S14（故障注入钩子）。

---

## 1. 缺陷与影响（摘要）

派工台账的写路径是**无锁的读-改-写**：两个写者各读一次旧快照、各改一处、各写一次 ⇒
后写的把先写的**整条覆盖掉**。覆盖后的文件**格式合法、内容看着正常**，读侧检测不出来。

丢的若是「在飞派工」那一条 ⇒「组队冲突」闸门看不见它 ⇒ 另一个 worker 可以被派去写同一处
（正是该闸门本身要防的事），且那条派工的 tier 快照与教训注入一起消失。

活体证据（见 D-77 条目）：本轮派出的 D-72 那一单（子会话 mvs_12c5c8cfcb574787af7942acde493632）
**在台账里根本没有记录** —— 台账 38 条里查不到它的 dispatch_id / scope / session，
而该子会话确实在跑、确实在改文件。

---

## 2. 复现步骤（确定性，不靠撞概率）

并发丢记录要**确定**地复现，必须让「两个写者拿到同一份旧快照」成为必然，而不是概率事件。
做法是给**读**加一个只影响时序的起跑号牌（测试专用钩子，默认关闭）：

1. 每个写者在**读完台账之后**写一个标记文件 read-&lt;pid&gt;，然后**等** go 文件出现；
2. 父进程看到**两个不同 pid** 的标记后才创建 go；
3. go 之前没有人能落盘（落盘在同步点之后）⇒ 两个写者拿到的必然是**同一份**旧快照。

钩子位置在 plugin/scripts/lib.mjs 的 readLedgerRaw() 里（读盘成功、解析成功之后）。
它对**改前与改后**是同一段代码 ⇒ 复现条件对两者完全一致。
生产路径不受影响：不设 SAR_LEDGER_SYNC_DIR ⇒ 钩子整个不执行。

> 探针脚本放在 docs/audit/.tmp-d77d73/ —— 该目录以点开头，**被 Git 忽略**，不会进版本库。
> 因此本报告把两段原始输出**原样抄录**在下方，第三方按报告即可复现；
> 变异的工装本身在版本库里（tests/dispatch-release-test.mjs，见 4.2）。

- 改前复现：docs/audit/.tmp-d77d73/probe-before.mjs
  （从 git show HEAD: 取**改前的整份 scripts 目录**，只往 readLedger 里插时序钩子，
  写路径逐字未动）
- 改后复现：docs/audit/.tmp-d77d73/probe-after.mjs（同样的夹具与并发构造）

### 2.1 改前原始输出

    node docs/audit/.tmp-d77d73/probe-before.mjs

    取到改前脚本：13 个
    已插入时序钩子（写路径逐字未动）
    ---- 改前（裸 writeFileSync，无锁无原子替换）----
    同时到达同步点的写者数 = 2
    台账里的派工记录数 = 1  （两个写者各加了一条 ⇒ 应当是 2）
    台账里的 agent = ["worker-a"]
    文件格式合法 = true  （读侧检测不出来）
    写者1 退出码=0 写者2 退出码=0
    写者1 是否报成功 = true
    写者2 是否报成功 = true

⇒ **两个写者都报成功，台账里只剩一条，文件格式合法** —— 这就是「静默」的确切形态。

### 2.2 改后原始输出

    node docs/audit/.tmp-d77d73/probe-after.mjs

    ---- 改后（统一写入口：跨进程锁 + 锁内重读 + 原子替换 + 回读校验 + 回滚）----
    同时到达读点的写者数 = 1  （第二个被锁挡住 —— 这正是串行化的证据）
    台账里的派工记录数 = 2  （两个写者各加了一条 ⇒ 应当是 2）
    台账里的 agent = ["worker-a","worker-b"]
    文件格式合法 = true
    写者1 退出码=0 写者2 退出码=0
    写者1 是否报成功 = true
    写者2 是否报成功 = true

「同时到达读点的写者数 = 1」本身就是修复的证据：**第二个写者拿不到锁**，
所以它不可能拿着旧快照去写。

---

## 3. 改造清单

### 3.1 统一写入口（plugin/scripts/lib.mjs）

新增 updateLedger(mutator, opts)，形态固定为：
**取跨进程锁 → 锁内重新读盘 → 锁内改 → 临时文件 + 原子替换 → 回读校验 → 不一致则回滚 → 放锁**。

| 部件 | 位置 | 要点 |
|---|---|---|
| 跨进程锁 | withLedgerLock() | 排他创建锁文件（wx）；等不到就**报错**，绝不放行 |
| 锁参数 | LEDGER_LOCK_WAIT_TIMEOUT_MS / LEDGER_LOCK_STALE_MS | 关系可被回归验算（见 4.3） |
| 原子替换 | writeLedgerFileAtomic() | 同目录临时文件 + rename（同卷 ⇒ 原子）；Windows EPERM 有界重试 |
| 回读校验 | updateLedgerLocked() | 写出去的必须读得回来且**逐字一致**；不一致 ⇒ R-LEDGER-VERIFY-FAILED |
| 回滚 | restoreLedgerFile() | 回到**写前状态**（不是「上一版」），并再次校验回滚结果 |
| 规则编号 | R-LEDGER-NO-DATA-DIR / R-LEDGER-UNREADABLE / R-LEDGER-WRITE-FAILED / R-LEDGER-VERIFY-FAILED / R-LEDGER-LOCK-FAILED | 断言按编号指认，不按文案关键词 |

**「原子替换不够」的原因写在代码注释里**：后写进程拿到的仍是旧快照，
原子替换只是把「写一半」变成「写全但内容旧」⇒ 必须锁内**重读**。

writeLedger(ledger) 作为兼容入口保留（签名与返回语义不变），实现改为「锁 + 原子替换 + 回读校验」，
但**不重读**（它的语义就是「写我给的这份」）⇒ 代码注释里写明它**不应**被正式写路径使用。
五个写方已全部改走 updateLedger，并有静态断言钉住（见 4.2）。

### 3.2 五个写方逐个改造清单

台账写方一共五个，全部改走统一入口；改前共 **11 处** writeLedger() 调用。

| 写方 | 改前调用点 | 改后 | 关键点 |
|---|---|---|---|
| dispatch.mjs | 2 处（判死落盘、登记派工） | 1 处 updateLedger() | **闸门 2/3 的判定与「登记这条派工」搬进同一个临界区** —— 以前是「读台账 → 判定 → 写台账」，两个并发派工可以**同时**通过冲突检测（各自都读到对方还没写进去的台账） |
| guard.mjs | 3 处（建绑定、冻结等级、记越界请求） | 3 处 updateLedger() | 越界记账的 request_id 从 updateLedger 的返回值里取回 |
| scope-amend.mjs | 3 处（--grant、--deny、--dispatch --add） | 3 处 updateLedger() | --dispatch --add 的改动（scope / scope_amended / bindings）在锁内对着**最新**台账做，锁外只做校验 |
| release-slot.mjs | 1 处（释放结果写回） | 1 处 updateLedger() | 「找目标 → 标记 aborted → 写回」整体串行化；active_before/after 口径不变 |
| watchdog.mjs | 2 处（判死落盘、回收名额） | 2 处 updateLedger() | **只碰台账写路径那一段**；D-72 的四层「声称产出」判定**一字未动** |

### 3.3 「还有谁在裸写」的排查结果

全量扫 plugin/scripts/*.mjs 的写盘点（writeFileSync / appendFileSync）：

| 文件 | 写盘对象 | 是否台账 | 处置 |
|---|---|---|---|
| lib.mjs | dispatches.json | **是** | 本单改为统一入口（writeLedger 保留为兼容入口） |
| lib.mjs | gate-trace.jsonl | 否（痕迹） | 不动（appendFileSync，追加语义不丢记录） |
| lessons.mjs | 错题本 | 否 | **不在本单范围**（归另一位成员），其锁与原子写是本单的参考实现 |
| roster.mjs / scope-amend.mjs | .superagent/roster.json | 否（名录） | 不动（名录不是台账） |
| scope-amend.mjs / lessons-gate.mjs | .superagent/changes.log | 否（变更账） | 不动（追加语义） |
| records.mjs / record-gate.mjs / lessons-gate.mjs / roster.mjs | — | **只读台账** | 不动 |

结论：**台账的裸写点只有 lib.mjs 一处**，但它被五个写方共 11 处调用 ——
本单把这 11 处全部改走统一入口，并用静态断言钉住三条：
①「五个写方不再调用 writeLedger」②「dispatches.json 这个路径只在 lib.mjs 里出现」
③「没有任何脚本用裸 writeFileSync 直写台账」。

---

## 4. 断言与变异矩阵

断言落在 tests/dispatch-release-test.mjs（本单名下的套件）。
**新增断言锚在仓库副本**（SAR_D77_PLUGIN_ROOT 可覆盖，变异矩阵指向副本）：
本单改的是仓库副本，安装副本由父会话发版时同步 —— 若新增断言跟着安装副本走，
同步前直接跑本套件会看到**假红**（测的是旧代码）。

### 4.1 断言清单（对应 ACCEPT）

| ACCEPT 条 | 断言名 | 复跑命令 |
|---|---|---|
| ① 并发两条都在 | D-77 两个并发写者各加一条记录 ⇒ 两条都在（+「并发确实发生了」前置自检 +「两条各带自己的 scope」） | node tests/dispatch-release-test.mjs |
| ② 写到一半被中断 | D-77 写到一半被中断 ⇒ 进程非零退出 / 台账仍是合法 JSON / 原有记录一条不少 / 台账内容未被改动（逐字一致） | 同上（SAR_FAULT_INJECT=ledger-crash-mid-write） |
| ③ 回读校验失败 ⇒ 回滚并报错 | D-77 回读校验失败 ⇒ 派工被拒并报出规则编号 / 台账回滚到写前状态（逐字一致） | 同上（SAR_FAULT_INJECT=ledger-verify-fail） |
| ④ 五个写方统一入口 | D-77 五个写方全部走统一写入口（无裸 writeLedger 调用）等 4 条 | 同上 |
| ⑤ 断言能区分改前改后 + 变异工装进版本库 | 4.2 的三档矩阵 | SAR_MUTATION_D77=1; node tests/dispatch-release-test.mjs |

### 4.2 变异矩阵（独立开关 SAR_MUTATION_D77=1）

工装做法沿用 tests/scope-amend-test.mjs 里 SAR_MUTATION_D75 的那一套：
把插件副本装到**系统临时目录**（仓库工作树零改动，跑完即删）→ 在**副本**上定向回退 →
用副本重跑本套件 → 目标断言必须转红。**不复用 SAR_MUTATION=1**（总矩阵归 tests/e2e-test.mjs 独占，
两套分档语义混在一起会让「总矩阵跑过了」被误读成「D-77 的变异体也跑过了」）。

实测输出：

    | 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |
    |---|---|---|---|---|
    | M-D77a | D-77 | 回退整个写路径：无跨进程锁 + 裸 writeFileSync（无临时文件、无原子替换） | 5 | YES |
        RED FAIL D-77 两个并发写者各加一条记录 ⇒ 两条都在 :: 台账记录数=1 readers=2
        RED FAIL D-77 并发写者两条记录各自带自己的 scope（没被覆盖成同一条） :: [["worker-a","src/a.ts"]]
        RED FAIL D-77 回读校验失败 ⇒ 派工被拒并报出规则编号 :: ...
        RED FAIL D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致） :: beforeLen=684 afterLen=27
        RED FAIL D-77 回读校验失败后 ⇒ 台账仍是合法 JSON 且原有记录还在 :: null
    | M-D77b | D-77 | 回退「回滚」：回读校验失败后不恢复到写前状态 | 2 | YES |
        RED FAIL D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致） :: beforeLen=684 afterLen=27
    | M-D77c | D-77 | 回退「回读校验」：写完不校验直接报成功 | 3 | YES |
        RED FAIL D-77 回读校验失败 ⇒ 派工被拒并报出规则编号 :: ...
        RED FAIL D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致） :: beforeLen=684 afterLen=27
    >>> D77 MUTATION MATRIX OK

M-D77a 的失败形态是「**台账记录数=1、readers=2**」⇒ 与 2.1 的改前原始输出**同一个形态**：
真并发下丢一条，不是别的错法。

### 4.3 锁参数的关系可被验算（契约 S7.5）

    PASS D-77 等待超时 ≥ 最大并发数 × rename 重试窗口（排队方不被误判失败） :: 等待=60000 需要>=52800
    PASS D-77 偷锁阈值 > 等待超时（不偷还在用的锁） :: 偷锁=180000 等待=60000

---

## 5. 回归

    node tools/run-tests.mjs --all --root plugin --repo .

    RESULT chain-test exit=0 pass=70 fail=0
    RESULT d27-mut-test exit=0 pass=14 fail=0
    RESULT dispatch-release-test exit=0 pass=58 fail=0
    RESULT e2e-test exit=0 pass=53 fail=0
    RESULT guard-test exit=0 pass=228 fail=0
    RESULT hooks-test exit=0 pass=29 fail=0
    RESULT lessons-test exit=0 pass=65 fail=0
    RESULT records-test exit=0 pass=52 fail=0
    RESULT roster-test exit=0 pass=38 fail=0
    RESULT scope-amend-test exit=0 pass=119 fail=0
    RESULT scope-test exit=0 pass=38 fail=0
    >>> SHELL ALL PASS

**11 套 0 FAIL，合计 764 条断言**（改动前同一命令是 11 套 0 FAIL / 717 条 ⇒ 本单净增 47 条）。

另跑三个**不计入**全量回归的独立开关矩阵，确认彼此不破坏：
- SAR_MUTATION_D77=1 ⇒ >>> D77 MUTATION MATRIX OK
- SAR_MUTATION_D73=1 ⇒ >>> D73 MUTATION MATRIX OK（见 fix-d73.md）
- SAR_MUTATION_D75=1 ⇒ >>> D75 MUTATION MATRIX OK（D-75 那单的矩阵未被本单破坏）

---

## 6. 残余风险（诚实边界）

1. **锁持有者被 kill ⇒ 锁文件残留**：后续写入要等到偷锁阈值（180s）才恢复 ⇒
   一次崩溃会让派工台账停摆 3 分钟。详见 N-02。
2. **临界区里不做任何子进程/网络 I/O**：错题本、履历、名录的读取一律放在锁**外**，
   临界区里只有「读台账 → 判定 → 改台账 → 落盘」。台账文件小，这一段只有几毫秒。
3. **测试钩子是普通环境变量**：SAR_LEDGER_SYNC_DIR / SAR_FAULT_INJECT（ledger- 前缀）
   有人故意设就能注入（与契约 S14 同款取舍）。生产须清空。
   ledger- 前缀是为了**不与错题本那套钩子串扰**（同一进程里两个模块读同一个
   SAR_FAULT_INJECT，token 同名会互相消耗额度）。
4. **回读校验的「逐字一致」是强口径**：若有人手工改了台账文件（绕过机制），
   下一次写入会把那份手工改动整体覆盖。前提是「台账是机制独占资产」。
5. **writeLedger(ledger) 仍在导出面**：它不重读 ⇒ 拿旧快照调用它仍然可能覆盖别人的记录。
   五个写方已全部改走 updateLedger，并有静态断言钉住。

---

## 7. 需要父会话处理的事

1. **契约 S14 需要补一句**：台账写路径现在也有一套同款故障注入钩子，
   但 token 带 ledger- 前缀（ledger-rename-eperm / ledger-lock-eperm /
   ledger-verify-fail / ledger-crash-mid-write），与错题本那套分开。
   ⇒ 契约文档在父会话手里，本单**未改**协议文档。
2. **契约 S6 需要补一条**：派工台账的写路径是「锁内读-改-写」，统一入口是 updateLedger。
3. **变异工装最终归并进总矩阵**：本单的变异体在 tests/dispatch-release-test.mjs，
   用独立开关 SAR_MUTATION_D77=1。第三方**不能**因为「总矩阵跑过了」就认为
   「D-77 的变异体也跑过了」—— 两套分档语义是分开的。
   ⇒ 归并进 tests/e2e-test.mjs 的总矩阵由下一位独占者做（该文件不在本单 SCOPE）。
4. **安装副本尚未同步**：本单只改仓库副本。发版同步后，安装副本上的
   tests/dispatch-release-test.mjs 直接跑（不设 SAR_PLUGIN_ROOT）仍会红 ——
   因为**本机那份安装副本本身落后**（缺 D-73/D-75 的改动），这不是本单引入的。
   ⇒ 复跑口径：node tools/run-tests.mjs --all --root plugin --repo .
5. **锁崩溃后的停摆窗口**（N-02）需要父会话裁决是否可接受。

---

## 8. 新发现的缺陷（编号从 N-01 起）

条目模板见契约第一节（S1）。

### N-01
- 触发条件：台账写路径**没有锁**，但保留了「回读校验 + 回滚」。
- 影响：两个写者并发写时，回读校验会**互相误伤** —— A 写完后回读读到的是 B 写的内容 ⇒
  A 判定校验失败 ⇒ A 执行回滚，把 B 的内容**退回 A 的写前快照** ⇒
  两条记录**一条都没登记**，而 A 与 B 都报了错。
  比「静默丢一条」更糟：连「少一条」的现场都留不下（台账被回滚到写前状态，看起来一切正常）。
- 复现步骤：把写路径回退成「无锁 + 裸写 + 保留回读校验与回滚」（本单的 M-D77a 少去第三处变异即可），
  两个写者并发写 ⇒ 台账记录数 = 0，两边都报错。
- 证据：本单变异矩阵 M-D77a 的中间版本输出（去掉「回读校验」那处变异前）——
  台账记录数=0 且两个写者都返回 deny。
- 状态：已复现
- 修法方向：**锁必须与回读校验、回滚成套出现**。回读校验假定「刚写的东西还在」，
  这个假定只在互斥成立时成立 ⇒ 校验与回滚不能脱离锁单独使用。
- 还需要什么：无，代码路径已确定。

### N-02
- 触发条件：持锁的进程被 kill -9（或机器断电）⇒ 锁文件残留。
- 影响：后续所有台账写入要等到偷锁阈值（LEDGER_LOCK_STALE_MS = 180s）才恢复；
  在这段时间里派工登记全部失败（报 R-LEDGER-LOCK-FAILED）。
  即：一次崩溃 ⇒ 派工台账**停摆 3 分钟**。
- 复现步骤：在持锁期间杀掉写者进程，再发起一次派工 ⇒ 得到 R-LEDGER-LOCK-FAILED，
  且等待约 180s。
- 证据：锁实现 withLedgerLock() 的偷锁分支（按锁文件 mtime 判定过期）。
- 状态：推断（逻辑确定，未实跑满 180s）
- 修法方向：持锁者存活探测（锁文件里记 pid，探测进程是否还活着）——
  但 Windows 上 process.kill(pid, 0) 语义不可靠，且探测不能在临界区里做。
  可行方向：锁文件写心跳时间戳，由**持锁者**更新（需另开一个轻量线程），
  或把偷锁阈值降到「一个 rename 重试窗口」量级并接受「误偷活锁」的代价（与 S7.5 的关系冲突）。
- 还需要什么：需要父会话裁决「崩溃后停摆 3 分钟」是否可接受；
  若不可接受，需要一个跨平台的持锁者存活判据。

### N-03
- 触发条件：并发测试用**同步阻塞**（Atomics.wait）等待子进程的号牌。
- 影响：**spawn 根本没被执行** —— spawn 是异步的，主线程一阻塞，子进程还没被创建 ⇒
  两个「并发写者」实际是**错峰串行** ⇒「两条都在」在改前改后都成立 ⇒
  断言成了**假绿**，变异检验全部失效（而且没有任何报错）。
  本单的第一版并发断言正是这样写的，被「并发确实发生了」这条前置自检抓了出来。
- 复现步骤：测试里用 Atomics.wait 轮询一个目录；子进程写文件 ⇒ 目录里始终读不到标记；
  父进程发 go 之后子进程才真正启动。
- 证据：本单调试记录：修好之前 readers=0（父进程等满 8s 一个标记都没有），
  但断言结束后目录里有两个标记 —— 说明标记是「父进程等完之后」才写的。
- 状态：已复现
- 修法方向：并发测试的等待必须**异步**（await new Promise(r => setTimeout(r, ms))），
  并且断言里必须带一条「并发确实发生了」的前置自检（readers >= 1），
  否则「两条都在」可能是错峰跑出来的假绿。
- 还需要什么：无，代码路径已确定。

### N-04
- 触发条件：台账写路径只给「写」加锁，而「读」发生在锁外。
- 影响：判定与写入不原子 —— 两个派工可以**同时**通过冲突检测（各自读到对方还没写进去的台账），
  然后各写一条。闸门形同虚设，且后写的覆盖先写的。
- 复现步骤：把 dispatch.mjs 的闸门 2/3 判定搬回锁外、只把写盘放进锁里 ⇒ 并发派工同时通过冲突检测。
- 证据：改前 dispatch.mjs 的结构（读台账 → 判定 → 写台账）；本单把它整体搬进 updateLedger。
- 状态：已复现
- 修法方向：**判定与写入必须在同一个临界区**。这正是「统一入口」而不是「加个锁函数」的原因 ——
  只提供 withLedgerLock() 会让调用方各自决定锁什么，迟早有人锁错。
- 还需要什么：无，代码路径已确定。

### N-05
- 触发条件：仓库副本与安装副本不同步时，直接跑某个套件（不设 SAR_PLUGIN_ROOT）。
- 影响：套件跑的是**安装副本**（旧代码）⇒ 新加的断言红 ⇒ 被误读成「修复没生效」。
- 复现步骤：不设 SAR_PLUGIN_ROOT 跑 node tests/scope-amend-test.mjs ⇒ D-75 的 16 条红
  （安装副本缺 D-75 那单的改动，与本单无关）。
- 证据：本次实测；同时 git status 显示安装副本落后于仓库副本。
- 状态：已复现
- 修法方向：新增断言锚在**仓库副本**上（SAR_D77_PLUGIN_ROOT / SAR_D73_PLUGIN_ROOT 可覆盖），
  并在报告里写明复跑口径；发版同步后由父会话统一核对三副本。
- 还需要什么：无，代码路径已确定。
