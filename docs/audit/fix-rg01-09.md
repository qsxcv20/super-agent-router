# 记录闸门与统计口径定向修复报告（RG-01 / RG-02 / RG-04 / RG-05 / RG-07 / RG-08 / RG-09）

- 修复者：sa-gate-integrity（记录闸门与统计口径改造）
- 依据：`docs/audit/defect-ledger.md` 的 **D-49 / D-51 / D-52 / D-53 / D-55 / D-56 / D-57**
  （对应 B 路原始报告 `docs/audit/lessons-persistence-and-isolation.md` 的
  **RG-01 / RG-02 / RG-05 / RG-04 / RG-07 / RG-08 / RG-09**）
- 判定依据（唯一事实源）：契约 S1（条目模板 7 字段）、S7（记录闸门）、S9（归因先过 Router 自检），
  见 `plugin/skills/super-agent-router/references/contract.md`
- 本轮改动范围（SCOPE）：`plugin/scripts/{lessons,lessons-gate,record-gate,records,roster}.mjs`、
  `tests/{lessons,records,roster}-test.mjs`、`plugin/skills/super-agent-router/references/records.md`
- 探针与沙箱：`docs/audit/.tmp-gate2/`（变异检验脚本、变异定义表、并发探针）

## 0. 一句话

三道记录闸门此前都缺四个基本口径 —— **谁在写**（身份）、**写到哪一段**（定位）、
**并发时怎么落盘**（原子性）、**取样名额从哪来**（单一常量）——
本轮把这四条补齐，并给全仓唯一靠自觉维护的 Router 私有账 `_router.md` 补上写入闸门。
每条缺陷都配了能区分改前改后的回归断言，并用变异检验证明「把修复回退，断言就变红」。

**另外：修的过程中实测发现并修掉了四个台账里没有的新缺陷** —— 全部在并发写入路径上，
其中三个是 Windows 上才显形的（`rename` 覆盖被占用文件报 EPERM、回读校验失败未回滚会抹掉前序条目、
抢锁时的 `EPERM` 被误判成失败），第四个是旧口径「整体覆盖」在**读取端**的可见后果。
详见 §1 的 D-52 一节。

---

## 1. 逐条：修了什么 / 断言在哪 / 改前红改后绿 / 残余风险

### D-49（RG-01）记录闸门不校验写入者身份

**修了什么**

1. **`plugin/scripts/lessons.mjs:265-344` 新增 `resolveWriter(payload)`** —— 写入者身份的**唯一事实源**。
   - 载荷必须带 `session_id`；闸门拿它去派工台账（`PLUGIN_DATA/dispatches.json`）查绑定。
   - **成员子会话**：`findBinding(ledger, sessionId)` 命中 → `canWrite(target)` 只认绑定成员自己的名字
     （`agent_key` 与 `agent` 两个别名都算数，因为 D-12 说它们指同一个成员）→ 载荷 `agent` 指别人即拒。
   - **父会话**：台账里 `dispatches[].parent_session_id` 或 `bindings[].parent_session_id` 命中该 `session_id`
     → 判定为父会话，可给本项目任意成员记账。
   - **都查不到 → fail-closed 不放行**，并给出可读文案说明为什么被拒。
   - **为什么父会话不按派工名单限死**：派工台账只保留最近 200 条，按名单限死会让「补记一条旧履历」不可用；
     真正要挡的「成员冒名写兄弟成员的账」由成员分支负责 —— 两件事分开，各用各的判据。
2. **`plugin/scripts/lessons-gate.mjs:60-75`、`plugin/scripts/record-gate.mjs:64-83`** 接入身份校验。
3. **条目内加「写入者」行**（`lessons-gate.mjs:325`、`lessons-gate.mjs:242`（router 分支）、`record-gate.mjs:171`）：
   写入者 · 会话 id · 时间戳。
   - **为什么条目里也要记**：身份校验管的是「能不能写」，条目里记的是「谁写的」—— 事后审计要查的是后者。
4. **`lessons-gate.mjs:63-75`：保留名 `_router` 的校验提到身份校验之前** ——
   否则父会话的宽松口径会把 `_router` 一起放行，成员路径那条保留名规则就漏了。

**断言在哪**

- `tests/lessons-test.mjs:204-240`（6 条）：① 冒用他人身份写入被拒；② 受害成员的错题本文件**未被创建**
  （防「拒了但文件已建」）；③ 成员写自己的错题本放行；④ 缺 `session_id` 不放行；
  ⑤ 身份无法核对的会话被拒；⑥ 条目内记录写入者。
- `tests/records-test.mjs:350-369`（4 条）：① 冒用他人身份写履历被拒；② 受害成员的履历未被写入；
  ③ 成员写自己的履历放行；④ 条目内记录写入者。

**改前红改后绿**

| 变异体 | 回退的是 | 变红的断言 |
|---|---|---|
| M1 | `lessons.mjs` 成员分支 `canWrite` 恒真 | 「D-49 冒用他人身份写入被拒」「受害成员的错题本未被创建」 |
| M2 | 父会话判定改成 `if (false)`（认不出派工凭据也放行） | 「D-49 身份无法核对的会话被拒」 |
| M10 | `record-gate.mjs` 跳过身份校验 | 「D-49 冒用他人身份写履历被拒」 |

**残余风险（如实写）**

- 身份判据依赖派工台账可读；台账被删或损坏 → **fail-closed 拒写**，不会误放行。
- 父会话能给任意成员记账 —— 这是刻意取舍，靠「条目内写入者 + changes.log」事后追责，不靠事前限死。
- **行为变更**：旧调用方没带 `session_id` 会被拒（文案里明写「旧调用方请补 session_id」）。
- 身份校验只认「会话 id → 台账绑定」，不认载荷自称 —— 这正是本次要修的那点。

### D-51（RG-02）段首定位两套口径（子串 vs 行首）

**修了什么**

1. **`plugin/scripts/lessons.mjs:64-118` 新增段落定位三件套**（写入端与读取端共用）：
   - `RECORDS_HEADING = '## ' + RECORDS_SECTION`（`:70`）—— **由 `RECORDS_SECTION` 拼出**，
     不留第二份字面串，杜绝「两份常量各改各的」。
   - `locateRecordsSection(raw)`（`:72-87`）：**行首锚定** `/^##[ \t]+[^\n]*/gm`，
     取标题里含「实战记录」的**第一个**段首，返回 `{found, start, end, title, body}`。
   - `countRecordsInSection(body)`（`:90-92`）：数段内 `^###[ \t]+`。
   - `countRecordsInFile(raw)`（`:95-98`）、`appendRecordsEntry(raw, entryText)`（`:108-118`）：
     插入位置也由 `locateRecordsSection` 决定。
2. **`lessons.mjs:227-246` 读取端 `readRecords` 改用 `locateRecordsSection`**。
3. **`plugin/scripts/record-gate.mjs:135-200` 删掉自带的 `raw.indexOf(SECTION)` 与 `nextSectionIndex` 两套口径**，
   段首定位、段尾定位、条数计数、条目插入全部走上面同一批函数。
   - **为什么多个「实战记录」段取第一个**：写入口与读入口必须指向同一段，否则计数与读回又分成两套口径。
     代价是「两个实战记录段」这种畸形文件的第二段不再被计入 —— 这是有意的取舍，`lessons.mjs` 注释里写明了。

**断言在哪**

- `tests/lessons-test.mjs:355-374`（3 条）：段首按行首锚定（不命中正文里的字面串）、
  段内只数真正的履历条、新条目插进真正的实战记录段。
- `tests/records-test.mjs:371-408`（5 条）：段首定位统一后写入成功、
  新履历落进真正的段（不在归属段）、段内条数正确（1 条存量 + 1 条新增 = 2）、
  归属段里的 `###` 不被算成履历条数、**新履历能被读取端读出**（最后一条是 D-51 的要害：
  写进去却读不出来 = 静默丢失）。

**改前红改后绿**

| 变异体 | 回退的是 | 变红的断言 |
|---|---|---|
| M3 | 行首锚定 → `^##[^\n]*`（允许 `##` 后无空格，即任意位置匹配） | lessons「段内只数真正的履历条（0 条）」「新条目插进真正的实战记录段」 |
| M11 | `appendRecordsEntry` 内部的定位改回子串 `indexOf` | records 4 条全红（含「写进去却读不出来」） |

**残余风险**

- 段首靠标题文字含「实战记录」判定；若方法论把该段标题改成别的字面（如 `## Records`），定位不到 →
  走「新建段」分支，不会写坏原文件，但记录会另起一段。

### D-52（RG-05）并发写同一账本静默丢条目

**修了什么**

1. **`plugin/scripts/lessons.mjs:357-522` 新增并发写两件套**：
   - `withFileLock(file, fn, opts)`（`:373-434`）：跨进程互斥锁
     （`wx` 排他创建 + 超龄偷锁 + 60s 等待超时 + 180s 偷锁阈值），锁文件按目标路径 sha1 命名。
   - `writeFileLocked(file, build)`（`:437-522`）：锁内**重读** → `build(raw)` 构造 →
     写同目录临时文件 → 原子 `rename` → **落盘回读校验**（marker + 条数）→
     不一致则**回滚**到写入前内容并判失败。
   - **为什么不能是「读全文 → 拼串 → 整体覆盖」**：两个写入方同时读到同一份旧快照 →
     各自拼出「旧 + 自己那条」→ 后写的覆盖先写的，先写的那条**静默消失**，而两次写入都返回 `ok:true`。
2. **三条写入路径全部改走 `writeFileLocked`**：`lessons-gate.mjs:329+`（成员错题本）、
   `lessons-gate.mjs:246+`（Router 私有账）、`record-gate.mjs:175-190`（履历）。
3. **条数上限判定移进锁内**（`lessons-gate.mjs:332`、`record-gate.mjs:178`）——
   锁外判会被并发写入一起放行（两个进程都看到 14 条就都写）。
4. **Router 私有账的编号序列判定同样移进锁内**（`lessons-gate.mjs:246-252`）。

**断言在哪**

- `tests/lessons-test.mjs:268-312`（3 条）：**12 次真并发 × 3 轮**（每轮独立成员名）→
  每轮条目数 == 12、每一条都在文件里、全部返回成功或明确失败（**不谎报**）。
- `tests/records-test.mjs:410-450`（3 条）：**16 次真并发 × 3 轮** → 落盘条数 == 16、逐条都在。
- **为什么必须真并发**：`spawnSync` 包在 Promise 里**仍是串行** —— 去掉写锁断言照样绿，
  这条断言就废了。所以这里用异步 `spawn`。
- **为什么必须多轮**：旧口径的丢条目是**概率性**的 —— 进程启动错峰时，
  后起的进程读到的快照已经含前几条，就丢不了条目，断言会「碰巧绿」。
  **变异检验实测：8 并发单轮时绿、红各出现过一次**（第一次跑红、第二次跑绿）。
  加到 12~16 并发 × 3 轮后，回退实现的最少落盘条数从 7 条 / 5 条掉到 **1 条**，检出变稳定。
- **并发数必须小于该账本的条数上限**（错题本 15、履历 20）：上限判定在锁内生效，
  并发数一旦追平上限，第 N 个写入必然被「已达上限」拒掉 —— 那是**正确行为**不是缺陷。
  （实测：16 并发写错题本时第 16 个稳定报「已达上限 15 条」。）

**改前红改后绿**

| 变异体 | 回退的是 | 变红的断言 |
|---|---|---|
| M4 | `writeFileLocked` 整段换成「读全文 → 拼串 → 整体覆盖」 | 「D-52 并发写入不丢条目」+「每一条都在文件里」（实测最少落盘条数掉到 **1~4 条**；具体数字每次跑不同，重要的是**从 12 掉到个位数**） |
| M12 | 同上（履历侧） | 「D-52 并发写履历不丢条目」+「逐条都在」+「无明确失败」（实测 16 次并发只落 **2~13 条**） |

**M12 还暴露了旧口径更严重的一面**：回退后出现的失败原因是
「方法论文件不存在：`.superagent/methods/sa-concurrent-records-r1.md`」——
因为 `fs.writeFileSync` 的「整体覆盖」是**先截断再写**，并发时另一个进程正读这个文件就会看到
**空文件 / 文件不存在**。也就是说旧口径不只是「丢条目」，还会让**读取端以为该成员没有履历** ——
这比丢条目更隐蔽，因为它在读取端表现为「本来就没有」。

**本轮实测发现并修掉的四个新缺陷（台账里没有，本轮一并修）**

1. **Windows 上 `rename` 覆盖被占用文件会 EPERM**：`fs.renameSync` 覆盖一个正被其它进程打开的目标文件，
   在 Windows 上会 EPERM（读句柄未共享删除）。16 并发实测**有 2 次直接失败** —— 那两条记录根本没落盘，
   而旧实现会返回 `ok`。修法：`lessons.mjs:472-491` 加 40 次重试（退避 25ms + 10ms/次，
   总窗口约 8.8s，覆盖 EPERM / EBUSY / EACCES），且**临时文件只写一次**、重试只做 rename
   （每次重试都重写临时文件会多触发一次杀毒软件扫描 —— 而扫描正是 EPERM 的来源）。
   **Linux 上 rename 覆盖总是成功，这个坑只在 Windows 显形** ——
   不重试就等于「并发写在 Windows 上会静默少条目」。
2. **回读校验失败未回滚会把前序条目一起抹掉**：校验失败时文件**已经被这一份快照覆盖**了 ——
   校验只是「发现覆盖」，不是「避免覆盖」。不回滚的话，那一次失败写入就把前面所有条目一起抹掉
   （实测 16 并发丢到 15 条）。修法：`lessons.mjs:499-520` 加回滚；回滚后失败的那次写入对文件**没有副作用**，
   调用方看到 `ok:false` 就知道这条没记上，可以重试。
3. **Windows 上抢锁会被误判成失败**（本轮最隐蔽的一个）：`withFileLock` 用 `fs.openSync(lock, "wx")` 排他创建锁文件，
   原来只把 `EEXIST` 当成「锁正被占用」。但 Windows 上**锁文件已存在且正被别的进程打开**时，
   CreateFile 报 ERROR_SHARING_VIOLATION，Node 映射成 **`EPERM`** 而不是 `EEXIST` ——
   于是并发写同一份账本会随机报「获取写锁失败：EPERM」，**锁机制本身是对的却被误判成失败**。
   修法：`lessons.mjs:402` 把判据改成 **`EEXIST` 或 `EPERM` 一律当作「暂时拿不到」，继续等**。
   **为什么不再用 `existsSync` 区分「占用」与「权限问题」**（第一版修法就是这么写的，仍然偶发失败）：
   实测发现**杀毒软件正在扫描/清理锁文件**时，文件被标记 delete-pending ——
   路径在目录里已经解析不到，`existsSync` 返回 false，而 `openSync` 报 EPERM。
   用 `existsSync` 去区分这两种情况就是判错。统一继续等：真的权限问题也会走到超时，
   超时文案说清「拿不到锁」，不谎报成别的原因。
4. **锁等待超时（15s）比持有者的重试窗口（8.8s）短**：16 个写入方排队时，
   最后一个要等 15 × 持有时长 —— 15s 超时会把它们**误判成失败**。
   修法：`lessons.mjs:380-381` 等待超时 15s → **60s**、偷锁阈值 60s → **180s**
   （偷锁阈值必须**大于**等待超时，否则会把「还在用的锁」当陈旧锁偷走，两个写入方同时进临界区）。
   正常路径不受影响（毫秒级完成），只在异常时多等。

**残余风险**

- 锁等待 60s 超时；超时取不到锁会**判失败**而不是强抢（避免两个写入方同时进临界区）。
  偷锁阈值 180s，必须大于等待超时 —— 否则会把「还在用的锁」当陈旧锁偷走。
- 回滚本身失败时仍返回 `ok:false`（不谎报），但文件可能已被覆盖 —— 极端情形，代码注释写明「至少没有谎报成功」。
- rename 重试是**实测驱动**的，跨平台仓库里这段不能删。

### D-53（RG-04）归因判定只查 cause+rule，漏查 symptom

**修了什么**

**`plugin/scripts/lessons-gate.mjs:91-166`**：

1. **语序枚举从单条扩到 10 条**（`:110-121`）：派工 brief 有误 / 派工给错 / Router 给错 /
   给错的 brief / brief 给错 / brief 有误 / Router 的锅 / 编排层的锅 / 上游给错 / 需求本身自相矛盾。
   每条一个正则 + 一个可读标签，命中报错时指出**是哪条语序** —— 补词即可，不必重写整条规则。
   - **为什么按语序枚举、不按词枚举**：按词拦（出现 brief / 派工 / Router 就拦）拦不住语序变化
     （「给错的 brief」里根本没有「brief 给错」这个子串），而且这些词在**成员认错**时同样出现
     （「按 brief 做了但没回显口径」）—— 按词拦就是把认错也一起拦了。
2. **逐字段判定**（`:154-166`）：`symptom` / `cause` / `rule` / `next_time` 四个自由文本字段各判各的。
   - **为什么不拼成一个大字符串判**：豁免的「前文 / 后文」只在同一个字段里找，不会跨字段误判；
     报错能指明是**哪个字段**出的问题，便于定位。
3. **豁免逐字段生效**（`:129-138`）：否定语境（不是 brief 给错）、宾语豁免
   （brief 处在执行语境「按 brief 给错了口径」里 → 是执行失误不是 brief 的错）。
   - **分寸：拦的是甩锅，不是认错**。宾语豁免**必须同时**要求执行语境 ——
     光看宾语会把「brief 给错了口径来源」也放过去，而那句话是在说 brief 本身写错了。

**断言在哪**

`tests/lessons-test.mjs:242-266`（4 条）：symptom 字段里的甩锅被拒、rule 字段里的甩锅被拒、
next_time 字段里的甩锅被拒、**现象里提到 brief 不算甩锅（豁免逐字段生效）**。
最后一条是**反向断言** —— 防止修过头把认错也一起拦了。

**改前红改后绿**

| 变异体 | 回退的是 | 变红的断言 |
|---|---|---|
| M5 | 归因判定不看 `symptom` 字段 | 「D-53 symptom 字段里的甩锅被拒」 |

**残余风险**

- 语序枚举是**封闭清单**：清单外的说法（如「上游没讲清楚」）不会被拦 ——
  这是设计取舍（按词拦会把认错也一起拦），代价是需要持续补语序。
- 豁免靠前后文 12 字符窗口判断，句子结构特别绕时可能豁免/拦错。

### D-55（RG-07）`_router.md` 没有任何写入闸门

**修了什么**

**`plugin/scripts/lessons-gate.mjs:36-37` 新增 `--router` 参数；`:190-330` 是完全独立的一条路径**，
不与成员校验共用一条链。

- **为什么必须独立成路**：成员错题本 = 4 字段（现象 / 根因 / 规则 / 下次派工），类型限四类重大错误；
  Router 私有账 = 契约 S1 的 7 字段（触发条件 / 影响 / 复现步骤 / 证据 / 状态 / 修法方向 / 还需要什么）。
  混在一条链里跑，私有账必然被成员校验拒掉（缺 agent / type 不在四类 / 缺 symptom…），
  于是 S9 的「改为记进 `_router.md`」**永远走不到** —— 这条路径不能是死路。
  （在途半成品里 `--router` 正是走成员校验链，**必然失败**；本轮已拆开。）
- **四道校验**：
  1. **写入者身份** —— 只有父会话（Router 自己）能写编排层的账，成员子会话一律拒；
  2. **S1 七字段齐全 + 状态取值**只能是「已复现 / 推断」；
  3. **编号**：格式 `^[A-Za-z][A-Za-z0-9]{1,3}-[0-9]{2}$`、同文件前缀一致、
     序号递增不跳号不重号、首条必须 `-01`；
  4. **条数上限 50 + 写入留痕**。
- **留痕两处**（`:242`、`:291-298`）：条目内的「写入者」行回答**谁写的**，
  `.superagent/changes.log` 一行回答**什么时候写的**。
  只留前者，事后查时间线要靠文件系统时间戳，不算留痕。
- **编号序列判定在锁内**（`:246-252`）：编号是文件级全局序列，锁外读到的「上一条编号」
  可能已被另一个并发写入顶掉 → 两个并发写算出同一个序号，重号/跳号只能等事后翻文件才发现。

**断言在哪**

`tests/lessons-test.mjs:306-353`（7 条）：合规条目写入成功、按 S1 七字段落盘、
changes.log 有留痕、编号跳号被拒、缺 S1 字段被拒、编号格式非法被拒、成员子会话写私有账被拒。

**改前红改后绿**

| 变异体 | 回退的是 | 变红的断言 |
|---|---|---|
| M6 | 跳过 S1 字段校验 | 「D-55 缺 S1 字段被拒」 |
| M7 | 不查上一条编号 | 「D-55 编号跳号被拒」 |

**残余风险**

- 编号前缀允许 2~4 位字母数字（含大写，兼容既有 `RT-` 编号）——
  前缀唯一性靠「同文件前缀一致」保证，跨文件重名不管。
- 私有账满 50 条后报**明确错误**（不是静默丢弃），需人工合并。

### D-56（RG-08）取样名额两处口径不一致（CLI 8 vs 注入层 12）

**修了什么**

1. **`plugin/scripts/records.mjs:56` 新增并导出 `export const SUMMARY_MAX_MEMBERS = MAX_ROSTER;`**（= 12）。
2. **`records.mjs:63`、`:102` 的 `maxMembers` 默认参数改用它**，CLI 默认同步（原来 8）。
3. **为什么与 `MAX_ROSTER` 绑定**：名录上限 12 意味着「有记录的成员」最多 12 个 ——
   名额若小于 12，就必然有成员被名额挤掉，摘要里结构性不可见（正是 D-24 想消除的那类）。

**断言在哪**

- `tests/lessons-test.mjs:376-386`（2 条）：取样名额是单一常量（CLI 与注入层同源）、
  取样名额绑定名录上限（不可能有成员被名额挤掉）。
- `tests/records-test.mjs:444-466`（3 条）：常量与 `MAX_ROSTER` 同源、
  CLI 默认口径与常量一致（CLI 与注入层同一结论）。

**改前红改后绿**

| 变异体 | 回退的是 | 变红的断言 |
|---|---|---|
| M8 | 常量改回 8（与名录上限脱钩） | 「D-56 取样名额是单一常量且与名录上限同源」（实测输出 `SUMMARY_MAX_MEMBERS=8 MAX_ROSTER=12`） |

**未在本轮修完的部分（如实写）**

- 注入层 `plugin/scripts/gate.mjs` 与 `plugin/scripts/session-start.mjs` 里硬编码的 `12`
  **不在本轮 SCOPE**（属机制成员）。当前数值与常量一致，**行为无差异**；
  但「同一份数据两个结论」的风险仍在 —— 下次有人改常量，两处会分叉。
  需要父会话把这两处改成引用 `SUMMARY_MAX_MEMBERS`（见 §4）。

### D-57（RG-09）名录重名不去重

**修了什么**

1. **`plugin/scripts/roster.mjs:59-72` 新增 `dedupeByName(members)`**（同名取一条）；
   **`:74-84` 新增 `duplicateNames(roster)`**（显式报出重名）。
2. **`roster.mjs:44` `listMembers` 排序后按 name 去重**；**`:188-193` `cmdList` 输出 `duplicateNames`**。
3. **`records.mjs:96` 摘要返回里新增 `duplicateNames` 披露字段**。
   - **为什么不静默去重**：静默去重会让「名录被人手改过」这件事消失，异常就再也查不到了 ——
     所以**去重 + 报出**两件事一起做。

**断言在哪**

- `tests/roster-test.mjs:134-171`（5 条）：同名成员只保留一条、重名被显式报出（可查，不静默去重）、
  去重后仍按名字升序、`list` 命令报出重名成员、`list` 里同名成员只出现一次。
- `tests/lessons-test.mjs:388-393`、`tests/records-test.mjs:468-474`：摘要侧同名成员只出现一次、
  重名异常被显式报出。

**改前红改后绿**

| 变异体 | 回退的是 | 变红的断言 |
|---|---|---|
| M9 | `listMembers` 去掉重 | roster 3 条红（实测输出 `["sa-dup","sa-dup","sa-solo"]`） |

**残余风险**

- 去重保留「排序后的第一条」—— 同名成员若配置不同（`owns` 不同），保留哪一条取决于排序稳定性，
  配置冲突需要人工修。

### D-50（RG-06）伪空值 —— 不在本轮 brief 清单内，但补了断言

台账 D-50 标着「由 sa-gate-integrity 修」，但它不在本轮 brief 的 7 条清单里。
在途改动里**已含** `lessons.mjs:155-197` 的三态实现（`readLessonsStatus` / `lessonsStatusLine`），
但**没有任何回归断言** —— 「有实现无断言」等于把风险留给下一个人。
本轮补了 **6 条断言**（`tests/lessons-test.mjs:397-441`）：

- 无错题本文件 = 真空态（`no-file`）；文件在但无条目 = 真空态（`empty`）；
- **有条目却抽不出规则 = 异常态（`unreadable`），不是真空态**；
- 有条目且抽得出规则 = 正常态（`entries`）；
- 异常态的措辞明确标为「通道异常待查」，**不谎报成「还没栽过跟头」**；
- 三态措辞互不相同（不会都塌成同一句）。

**注入层接线没做（如实写）**：`plugin/scripts/dispatch.mjs:276-277` 仍是老的硬编码文案
（`0 条（该成员暂无错题本…）`），**没有调用 `lessonsStatusLine`** ——
`dispatch.mjs` 不在本轮 SCOPE，需另一名成员或父会话补（见 §4）。

---

## 2. 断言怎么证明「改前红改后绿」

只跑新断言一次绿，**证明不了它能区分改前改后** —— 断言必须能在修复回退时变红才算数。
本轮用**变异检验**做这件事：把修复**整段回退**成修复前的写法，跑同一套断言，必须变红，
且变红的那条断言要正好对应被回退的缺陷。

- 脚本：`docs/audit/.tmp-gate2/mutation-check.mjs`
- 变异定义：**外置**到 `docs/audit/.tmp-gate2/mutations.json` ——
  长字符串内嵌在脚本里时，转义层数是主要故障源（曾多次把脚本结构弄坏）。
- 命令：`node docs/audit/.tmp-gate2/mutation-check.mjs`

真实输出（12 个变异体全部变红）：

```
RED   M1 D-49 成员写入者身份校验回退（canWrite 恒真） :: lessons-test fail=2 relevant=2
        FAIL D-49 冒用他人身份写入被拒 :: []
        FAIL D-49 受害成员的错题本未被创建 :: C:\Users\yang2\AppData\Local\Temp\sar-lesson-IGmDDb\proj\.superagent\lessons\sa-victim.md
RED   M2 D-49 父会话身份判定回退（认不出派工凭据也放行） :: lessons-test fail=1 relevant=1
        FAIL D-49 身份无法核对的会话被拒 :: []
RED   M3 D-51 段首定位回退（行首锚定 → 任意位置匹配） :: lessons-test fail=2 relevant=2
        FAIL D-51 段内只数真正的履历条（0 条） :: ## 实战记录
        FAIL D-51 新条目插进真正的实战记录段（读得出来） :: ## 实战记录
RED   M4 D-52 错题本并发写回退（去掉写锁与原子替换） :: lessons-test fail=2 relevant=2
        FAIL D-52 并发写入不丢条目（12 次并发 × 3 轮 → 最少 4 条） :: 最少落盘条目数=4
        FAIL D-52 并发写入的每一条都在文件里
RED   M5 D-53 归因判定回退（不看 symptom 字段） :: lessons-test fail=1 relevant=1
        FAIL D-53 symptom 字段里的甩锅被拒 :: []
RED   M6 D-55 router 私有账闸门回退（跳过 S1 字段校验） :: lessons-test fail=1 relevant=1
        FAIL D-55 缺 S1 字段被拒 :: []
RED   M7 D-55 编号递增校验回退（不查上一条编号） :: lessons-test fail=1 relevant=1
        FAIL D-55 编号跳号被拒 :: []
RED   M8 D-56 取样名额回退（常量与名录上限脱钩） :: records-test fail=1 relevant=1
        FAIL D-56 取样名额是单一常量且与名录上限同源 :: SUMMARY_MAX_MEMBERS=8 MAX_ROSTER=12
RED   M9 D-57 名录重名去重回退（不去重） :: roster-test fail=3 relevant=3
        FAIL D-57 同名成员只保留一条 :: ["sa-dup","sa-dup","sa-solo"]
        FAIL D-57 去重后仍按名字升序 :: sa-dup,sa-dup,sa-solo
        FAIL D-57 list 里同名成员只出现一次 :: ["sa-dup","sa-dup"]
RED   M10 D-49 履历写入者身份回退（record-gate 不查身份） :: records-test fail=1 relevant=1
        FAIL D-49 冒用他人身份写履历被拒 :: ["方法论文件不存在：.superagent/methods/sa-victim.md（先写方法论，成果才有地方沉淀）"]
RED   M11 D-51 履历段首口径回退（写入端改用子串匹配） :: records-test fail=4 relevant=4
        FAIL D-51 段首定位统一后写入成功 :: ["写入后回读校验失败：期望 2 条，实际 1 条 —— 已回滚，判失败，不返回「成功」"]
        FAIL D-51 新履历落进真正的实战记录段（不在归属段） :: "# sa-locate-tricky\n\n## 归属\n详见 ## 实战记录 段的说明（正文里的字面串）\n\n## 实战记录\n\n### 2026-01-01 · 旧领域 · 旧任务\n- 做法：老做法\n- 证据：老证据\
        FAIL D-51 段内条数正确（1 条存量 + 1 条新增 = 2） :: 1
        FAIL D-51 新履历能被读取端读出 :: {"agent":"sa-locate-tricky","records":[{"title":"2026-01-01 · 旧领域 · 旧任务","approach":"老做法","evidence":"老证据","verified":"verifie
RED   M12 D-52 履历并发写回退（去掉写锁与原子替换） :: records-test fail=3 relevant=3
        FAIL D-52 并发写履历不丢条目（16 次 × 3 轮 → 最少 2 条） :: 最少落盘条数=2 明确失败=3 首条失败原因=["方法论文件不存在：.superagent/methods/sa-concurrent-records-r1.md（先写方法论，成果才有地方沉淀）"]
        FAIL D-52 并发写履历逐条都在 :: 最少落盘条数=2 明确失败=3 首条失败原因=[同上]
        FAIL D-52 并发写履历无明确失败（每一次写入都真的落盘） :: 最少落盘条数=2 明确失败=3 首条失败原因=[同上]
>>> MUTATION CHECK OK（每个变异体都让新断言变红）
```

**连续跑了多轮，12/12 全红** —— 只跑一轮不算数：D-52 的丢条目是概率性的，
单轮绿可能是**碰巧绿**（本轮就实测到过一次：第一轮红、第二轮绿）。
多轮都红，才说明断言的检出力够。

**还有一个坑：变异体锚点会随实现改动而失效。** 改了 `writeFileLocked` 之后，
`mutations.json` 里 M4/M12 的 `from` 锚点就对不上了 —— 脚本会报「锚点没找到」并把它算作**失败**
（不会假绿，但会浪费一轮排查）。改实现后必须同步刷新锚点，
本轮用 `docs/audit/.tmp-gate2/refresh-anchor.cjs` 从当前源码里**程序化提取**函数体，
不手抄长字符串（手抄就是转义层数打架的老坑）。

**三个方法论要点（留给后来者）**

1. **变异体必须打在真正生效的那一处**：M11 必须打在 `appendRecordsEntry` **内部的定位**上，
   只改 record-gate 的计数处不够 —— 写入仍走子串定位，断言照样红，但不是它红的，验的就不是那一处。
2. **判读时只认对应缺陷的断言**（`expect` 键）：一个变异体可能连带打红别的断言，那是噪声不是信号。
3. **并发断言必须多轮**：概率性缺陷的单轮观察是噪声。要么并发数开大、要么多跑几轮，
   目标是「回退实现时最少落盘条数掉到个位数」—— 那样检出才是稳的。
   配套约束：**并发数必须小于该账本的条数上限**，否则第 N 个写入会被上限正确拒绝，
   看起来像失败，其实是正确行为。

---

## 3. 没修的 / 不在本轮范围的

| 条目 | 为什么没在本轮修 |
|---|---|
| **D-54（RG-03）** legacy 台账行可冒充验收凭据 | 不在本轮 brief 的 7 条清单内；且 `lib.mjs` 的 legacy 迁移**已由机制成员修好**（见 `docs/audit/fix-f1-f5-rg03.md`）。本轮未动，`lib.mjs` 也不在本轮 SCOPE。 |
| **D-50 的注入层接线** | 三态实现已在（见 §1 末），断言本轮补了；但 `dispatch.mjs:276-277` 仍是老文案，`dispatch.mjs` 不在 SCOPE。 |
| **D-56 的注入层接线** | `gate.mjs` / `session-start.mjs` 里的硬编码 `12` 不在 SCOPE。数值当前与常量一致，行为无差异，但同源这件事没做完。 |
| **安装副本回归与三副本 sha256 核对** | 读安装副本路径 `C:\Users\yang2\.minimax\plugins\super-agent-router` 在本会话被裁决为写通道而拒绝访问，本轮**无法自行核对**。见 §4。 |

---

## 4. 需要父会话补的部分

1. **注入层引用常量**：`plugin/scripts/gate.mjs` 与 `plugin/scripts/session-start.mjs` 里的 `12`
   改为引用 `records.mjs` 导出的 `SUMMARY_MAX_MEMBERS`。
   数值当前一致，改的是「同源」这件事 —— 不改的话，下次常量一改就分叉。
2. **D-50 注入层接线**：`plugin/scripts/dispatch.mjs:276-277` 改用 `lessonsStatusLine(name)`。
3. **安装副本回归**：`node tools/run-tests.mjs --all --repo .`（安装副本口径）本轮**未跑** ——
   同 §3 最后一行。须由父会话在部署后补跑。
4. **三副本 sha256 核对**：仓库插件包 / 安装副本 / 运行时缓存树的逐文件一致性，本轮**无法自行核对**
   （读不到安装副本）。须由父会话部署后统一核对 —— D-48 的修法要求部署后必须做这一步。
5. **部署**：本轮**未部署**、工作树**未提交**（按约束不得 commit / push）。

---

## 5. 回归命令与真实输出

### 5.1 全量回归（仓库副本口径）

```
> node tools/run-tests.mjs --all --root plugin --repo .
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=47 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=30 fail=0
RESULT e2e-test exit=0 pass=47 fail=0
RESULT guard-test exit=0 pass=199 fail=0
RESULT hooks-test exit=0 pass=26 fail=0
RESULT lessons-test exit=0 pass=52 fail=0
RESULT records-test exit=0 pass=46 fail=0
RESULT roster-test exit=0 pass=23 fail=0
RESULT scope-amend-test exit=0 pass=67 fail=0
RESULT scope-test exit=0 pass=21 fail=0
>>> SHELL ALL PASS
```

### 5.2 并发断言连跑（竞态单次绿不算数）

```
> $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\records-test.mjs
>>> RECORDS ALL PASS
> $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\lessons-test.mjs
>>> LESSONS ALL PASS
```

两套各连跑多轮全部通过（records 20 轮、lessons 10 轮），全量回归也连跑 2 轮全绿。
D-52 的并发断言本身已是**真并发**（异步 `spawn`）
**且每套内部再跑 3 轮**（错题本 12×3=36 次、履历 16×3=48 次写入机会），
所以「套件绿」与「并发不丢条目」不是同一件事 —— 外层再连跑多轮是确认没有残留的偶发。

**断言把「明确失败」与「静默丢失」分开记**（这是本轮加的关键诊断）：
少一条有两种可能 —— ① 写入返回 `ok:false`（明确失败，调用方知道没记上、可以重试，这是「不谎报」）；
② 写入返回 `ok:true` 却没落盘（**静默丢失**，这才是 D-52 的要害）。
不分开就会把两者混成同一个红。断言现在同时报「最少落盘条数」「明确失败数」「首条失败原因」，
红的时候能直接看出是哪一类 —— 本轮正是靠这条诊断信息才定位到 `EPERM` 那两个新缺陷。

### 5.3 变异检验

```
> node docs/audit/.tmp-gate2/mutation-check.mjs
>>> MUTATION CHECK OK（每个变异体都让新断言变红）
```

### 5.4 并发探针（16 并发实测）

```
> $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node docs/audit/.tmp-gate2/probe-concurrent.mjs
```

修复后 16/16 条全部落盘、零缺失（修复前实测有 2 次 Windows rename EPERM 直接失败 ——
那两条根本没落盘，见 §1 的 D-52 新缺陷 1）。

### 5.5 失败原因探针（断言只说「少了条目」，不说「为什么少」）

```
> $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node docs/audit/.tmp-gate2/probe-lessons-fail.mjs 12 3
round 0: ok=12/12 落盘条目=12 失败=0
round 1: ok=12/12 落盘条目=12 失败=0
round 2: ok=12/12 落盘条目=12 失败=0
```

**这个探针是在加稳断言的过程中写的** —— 断言从「8 并发单轮」改成「12 并发 × 3 轮」后，
第一次跑就出现「16 次并发只落 15 条」，探针一打才看清**三个不同的失败原因**：
一个是我的断言设计错误（并发数追平了条数上限）、两个是真缺陷
（Windows 锁文件 EPERM、rename EPERM）。失败原因有三种、修法完全不同，
不看清就是在猜 —— 这就是「先问为什么，再改代码」。

**履历侧另有一个探针**（`probe-records-fail.mjs`）：它在隔离环境下 320/320 全过，
但在「紧跟其它套件跑完」的高负载时刻会偶发失败 —— **这就是定位根因的那一步**：
给断言加上「明确失败数 + 首条失败原因」的诊断后，失败原因直接被指出来：
「获取写锁失败：EPERM」。于是才有了新缺陷 3、4 的修复。

修复前探针的真实输出（三个原因各出现过一次）：

```
round 0: ok=15/16 落盘条目=15 失败=1
    FAIL: ["该成员错题本已达上限 15 条 —— 必须先合并/淘汰旧规则才能加新的"]
round 1: ok=15/16 落盘条目=15 失败=1
    FAIL: ["获取写锁失败：EPERM: operation not permitted, open '...\\super-agent-router-locks\\1c2baf7d1ee1ca2cee193807.lock'"]
round 2: ok=15/16 落盘条目=15 失败=1
    FAIL: ["获取写锁失败：EPERM: operation not permitted, open '...\\super-agent-router-locks\\f98ac52aa16eaa98b31a2fa6.lock'"]
```

---

## 6. 改动清单

| 文件 | 改了什么 |
|---|---|
| `plugin/scripts/lessons.mjs` | 新增 `RECORDS_HEADING`、`locateRecordsSection`、`countRecordsInSection`、`countRecordsInFile`、`appendRecordsEntry`、`resolveWriter`（含 `canWrite`）、`withFileLock`、`writeFileLocked`；`readRecords` 改用共用定位；三态读取（上一实例在途改动）；**`withFileLock` 的 Windows EPERM 判据**（`EEXIST`/`EPERM` 一律当作「暂时拿不到」继续等）与**锁等待 60s / 偷锁 180s**；**`rename` 重试 40 次（窗口约 8.8s，临时文件只写一次）** |
| `plugin/scripts/lessons-gate.mjs` | 写入者身份校验；保留名校验前置；归因逐字段判定 + 10 条语序；`--router` 私有账写入闸门（独立分支）；写入改走 `writeFileLocked`；条数与编号判定移入锁内；条目加「写入者」行 |
| `plugin/scripts/record-gate.mjs` | 接入 `resolveWriter`；段首/段尾/计数/插入改用共用定位（删掉自带两套口径）；写入改走 `writeFileLocked`；条数上限移入锁内；坏载荷拒；条目加「写入者」行 |
| `plugin/scripts/records.mjs` | 新增导出 `SUMMARY_MAX_MEMBERS = MAX_ROSTER`；默认参数与 CLI 默认改用它；摘要披露 `duplicateNames` |
| `plugin/scripts/roster.mjs` | 新增 `dedupeByName`、`duplicateNames`；`listMembers` 去重；`cmdList` 报出重名 |
| `tests/lessons-test.mjs` | 新增第 10~16 组断言（D-49 / D-53 / D-52 / D-55 / D-51 / D-56 / D-57 / D-50）；台账夹具（父子会话绑定）；`errs()` 助手；D-52 改为真并发 **12 并发 × 3 轮**（并发数必须小于错题本上限 15） |
| `tests/records-test.mjs` | 新增第 17~20 组断言（D-49 / D-51 / D-52 / D-56 / D-57）；夹具保留 bindings；D-52 改为真并发 **16 并发 × 3 轮**，并把「明确失败」与「静默丢失」分开记（诊断字段：最少落盘条数 / 明确失败数 / 首条失败原因） |
| `tests/roster-test.mjs` | 新增第 12 组 D-57 断言（内存对象 + 真实 roster.json 两条路径） |
| `plugin/skills/super-agent-router/references/records.md` | 写入闸门补 `session_id` 要求与身份判据；被拒情况表新增 3 行；条目格式补「写入者」行；新增「写入口径」章节；闭环补取样名额口径 |
| `docs/audit/.tmp-gate2/` | 变异检验脚本、变异定义表、锚点刷新脚本、并发探针、失败原因探针（错题本侧 / 履历侧）（过程物，非交付物） |
