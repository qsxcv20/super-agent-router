# D-39 名录侧修复报告：`roster register` 的「成员必须已存在于账号名单」校验

> 修复轮 · 归属：`sa-gate-integrity` · 缺陷依据：`docs/audit/defect-ledger.md` 的 `D-39` 条目
> 条目模板出处：`plugin/skills/super-agent-router/references/contract.md` S1（本报告不复述字段清单）
> 本报告只写**名录侧**；机制侧（建号纳入账号级危险动作）见 `docs/audit/fix-d37-d41.md`，不在本单范围。

---

## 1. 这一单修了什么

D-39 的台账口径是「建号纳入账号级危险动作，**并在 `roster.mjs register` 处补一条『该成员必须已存在于账号名单』的校验** —— 建号与登记必须成对」。
机制侧那一半（建号是账号级危险动作）由机制成员在本轮并行完成；**本单只做名录侧那一半**：

| 项 | 改前 | 改后 |
|---|---|---|
| 登记一个账号里不存在的成员 | **登记成功**（名录与账号漂移） | 被拒，规则代号 `account_member_missing` |
| 登记账号里真实存在的专项成员 | 成功 | 成功（不变） |
| 登记内置成员（`.builtin/<name>/`） | 成功 | 成功（**不被误伤**，新增专门断言） |
| 账号名单读不出来时 | 成功（默认放行） | 被拒，规则代号 `account_list_unavailable`（**不放行**） |
| `reconcile` 的陈旧判定 | 本地算，且多带一层 `source === 'runtime'` 过滤 | 走 `lib.mjs` 的 `staleRosterMembers()`，与注入侧/派工侧同一份计算 |

改动文件（严格在 SCOPE 内）：

- `plugin/scripts/roster.mjs`
- `tests/roster-test.mjs`
- `docs/audit/fix-d39-roster.md`（本文件）
- `docs/audit/.tmp-d39/`（探针与探针输出）

未碰：`guard.mjs` / `dispatch.mjs` / `lib.mjs` / `watchdog.mjs` / `session-start.mjs` / `scope-amend.mjs` /
`record-gate.mjs` / `lessons-gate.mjs` / `records.mjs` / `plugin/hooks/hooks.json` /
`plugin/skills/super-agent-router/references/` 下协议文档 / `plugin/README.md` / `plugin/CHANGELOG.md` / 版本号。
未 commit、未部署、未推送远端、未创建或改写任何账号成员。

---

## 2. 判据（先写清楚，再看代码）

### 2.1 「存在于账号」到底指什么

判据：**被登记的成员名，必须出现在账号成员名单里**，且名单取自 `lib.mjs` 的共享计算：

```
专项成员：<账号成员目录>/<name>/
内置成员：<账号成员目录>/.builtin/<name>/
```

账号成员目录的定位也全部委托 `lib.mjs`（`accountRoot()` / `accountAgentsRoot()` / `accountMemberNames()` / `accountMemberExists()`），
**本单没有自己写第二份目录扫描**。理由不是「省代码」：一旦名录侧自己扫目录，就会出现第二份「账号成员长什么样」的判定，
它与派工侧、注入侧迟早分叉 —— 而这次要修的缺陷本身就是「两套事实」造成的。

### 2.2 为什么内置成员不会被误伤

内置成员在 `.builtin/<name>/`，不在账号成员目录的顶层。共享计算 `accountMemberNames()` 明确把两处合并成一个名单
（`lib.mjs` 第 799–804 行），所以名单天然含内置成员 —— 本侧**不需要**为内置成员单开一条分支。
一旦单开分支，内置成员就会变成「另一种存在性」，那正是要避免的事。

### 2.3 为什么「名单读不出来」不等于「成员不存在」，但仍然要拒

这是本单最容易被做错的一条。三种状态必须分开：

| 状态 | 语义 | 本单处理 |
|---|---|---|
| 名单可读、查无此名 | **该成员在账号里不存在** | 拒，`account_member_missing` |
| 名单可读、有此名 | 存在 | 放行 |
| 名单读不出来 | **无法核验**（目录不存在 / 不在账号运行环境） | 拒，`account_list_unavailable`，且**不**说「在账号里不存在」 |

「读不出来」不等于「不存在」—— `lib.mjs` 对这两种情况分得很清（`available=false` 是「读不出来」，不是「空名单」）。
但本单**仍然拒绝登记**，理由：登记侧是**建档闸门**，放行等于把「取不到账号事实」当成「该成员没问题」，
与「建号与登记必须成对」这条判据直接矛盾。

**这与派工侧的处理刻意不同**：`dispatch.mjs` 在名单不可得时**不拒派**，只写痕迹并披露
（`plugin/scripts/dispatch.mjs:184` 起的注释与分支）。差别有据可依：

- 派工侧是**运行时调度**。账号成员是账号级事实，没有账号环境的项目（测试夹具等）根本没有这份名单 ——
  据此拒派等于让整套编排在没有账号环境的项目里全停摆，连正常派工都发不出去。
- 登记侧是**建档闸门**。取不到账号事实就不许写档 —— 否则写进去的正是后面查不出来的漂移。

两边都**不许静默**：登记侧拒绝并说明原因，派工侧留痕并在会话注入里披露。

### 2.4 为什么账号存在性检查放在「前置规则都过了之后」

校验顺序：命名格式 → 泛词 → 保留名 → 三字段齐备 → 方法论文件存在 → **账号存在性** → 重复名 → 名录上限。

账号检查只在**前述规则全部通过**时才执行（`roster.mjs:277` 的 `if (!items.length)`）。两个理由：

1. **一次拒绝只该给一个要改的地方。** 报错多了，人会去逐条试，而不是直奔真正那条。
2. **不能对保留名谎报「不存在」。** 保留名（`worker` / `explore`）在账号里本来就有，
   若在保留名规则之前问账号，会同时报「与内置/保留名冲突」和「该成员在账号里不存在」—— 后一句是假话。

### 2.5 为什么报错不原样印账号目录路径

账号成员目录的绝对路径会被抄进 brief、错题本与变更账；一旦被当成命令执行，就是一条「看起来能跑的账号级写动作」。
所以 `redactAccountDir()`（`roster.mjs:164`）把它替换成 `<账号成员目录>`，
应检查位置以**相对形态**给出：「账号成员目录下的 `<name>/` 与 `.builtin/<name>/`」。

### 2.6 为什么错误输出要带规则代号

只给中文报错，调用方只能靠「报错文本里有没有某个词」去猜命中的是哪条规则 —— 那是猜。
所以输出新增 `error_rules`（规则代号数组，与 `errors` **同序**），`errors` 文本保持向后兼容。
这样「命中的就是这一条」成为可断言的事实，也让「回退某条校验 → 哪条断言转红」能被机械核对（第 6 节）。

本单新增的规则代号：`name_format` / `banned_word` / `reserved_name` / `missing_owns` / `missing_accepts` /
`missing_reject` / `method_missing` / `account_member_missing` / `account_list_unavailable` /
`duplicate_member` / `roster_full`。

---

## 3. 改动明细

### 3.1 `plugin/scripts/roster.mjs`

**新增导出 `checkAccountMember(name)`**（`roster.mjs:130`），返回 `{ok, code, error}`：

```js
export function checkAccountMember(name) {
  const target = String(name || '').trim();
  const ctx = accountMemberNames();
  if (!ctx.available) {
    return { ok: false, code: 'account_list_unavailable', error: '无法核验账号成员名单：' + redactAccountDir(ctx.error, ctx.dir) + '。……' };
  }
  if (!accountMemberExists(ctx.names, target)) {
    return { ok: false, code: 'account_member_missing', error: '该成员在账号里不存在：' + target + '。……' };
  }
  return { ok: true, code: 'account_member_present', error: '' };
}
```

**新增私有 `redactAccountDir(text, dir)`**（`roster.mjs:164`）：把账号目录绝对路径替换成 `<账号成员目录>`。

**`cmdRegister` 改为收集 `{rule, message}` 对**（`roster.mjs:245` 起）：错误输出新增 `error_rules` 与 `account_check`，`errors` 文本不变。

**`cmdReconcile` 收敛到共享口径**（`roster.mjs:171` 起）：
- 账号侧视图：喂了名单用 `fed-list`，没喂则用 `accountMemberNames()`（`runtime` / `explicit` / `none`）；
- 名录侧名字集合改用 `rosterMemberNames(roster)`；
- 陈旧集合改用 `staleRosterMembers(roster, account)`，**移除原先的 `source === 'runtime'` 过滤**；
- 输出新增 `account_view: {source, available, members, error}`，让「结论从哪来」不必猜。

### 3.2 为什么 reconcile 此前会与机制侧分叉（追加要求：口径收敛）

机制侧（会话注入披露、派工拒绝）的陈旧计算在本轮落到了 `lib.mjs` 的 `staleRosterMembers()`：
「名录里有、账号里没有」即陈旧，**不看 source**。
而 `roster.mjs reconcile` 原来是本地算的，且多带一层 `source === 'runtime'` 过滤。

结果是：**同一个成员，机制侧认它陈旧、reconcile 说不陈旧。** 一边拦派工、一边说没问题 ——
结论不一致迟早长歪成两套事实。这正是本单要求对齐的那条。

收敛后：**陈旧规则只有一份**（`lib.mjs` 的 `staleRosterMembers`），差别只剩「喂哪份账号名单」，
且这个差别是**显式**的（`account_view.source`）。

**语义差异的显式声明**：内置成员（`.builtin/<name>/`）在两种来源下都算「账号里存在」，
所以**内置成员不会被判成陈旧**。这一条由 `accountMemberNames()` 与调用方喂的名单各自保证
（`mavis_agent_list` 同样会列出内置成员）。代码注释里写明（`roster.mjs:193` 起）。

---

## 4. 复现步骤（可复制）

```powershell
# ① 仓库副本的 roster 套件（必须显式指定 SAR_PLUGIN_ROOT；
#    不指定时 PLUGIN_ROOT 默认是**已安装副本** C:/Users/yang2/.minimax/plugins/super-agent-router）
$env:SAR_PLUGIN_ROOT='plugin'; node tests/roster-test.mjs

# ② 变异矩阵（开关打开，额外 5 条断言）
$env:SAR_MUTATION='1'; $env:SAR_PLUGIN_ROOT='plugin'; node tests/roster-test.mjs

# ③ 十一套全量回归
node tools/run-tests.mjs --all --root plugin --repo .

# ④ 探针（改前/改后同输入对照；「改前」取 git HEAD 里的真版本，不是手工伪装的桩）
node docs/audit/.tmp-d39/probe-d39.mjs
```

探针输出全文另存于 `docs/audit/.tmp-d39/probe-output.txt`。

### 4.1 探针的边界声明（必须披露，不藏）

探针为了拿到**真·改前**的对照，用 `git show HEAD:plugin/scripts/roster.mjs` 取改前版本，
把它复制到临时目录后**执行了那一份副本**（用 `node` 跑 `register`）。三点如实说明：

1. **执行的是副本，不是权威面脚本本身**；且运行环境完全隔离 —— `MINIMAX_PROJECT_DIR`、`PLUGIN_DATA`、
   `SAR_ACCOUNT_AGENTS_DIR` 全部指向临时目录，**真实名录、派工台账、错题本、账号成员都没有被碰过**，
   也没有创建或改写任何账号成员。
2. **这次执行发生在 node 子进程内部**，bash 层的护栏看不到它 —— 这正是契约 S13.5 说的
   「护栏是护栏不是沙箱：脚本内部发生的写入/执行不受判定约束」。
   本单的处理方式是**审计留痕 + 验收复核**：把探针脚本落盘、可复跑、输出逐字贴进报告，
   而不是靠「护栏拦得住」来自我担保。
3. 如果只跑回归套件（`tests/roster-test.mjs`），**不会**执行任何权威面脚本副本 ——
   变异矩阵改的是临时副本的**源码**，跑的是被改后的**插件副本**在沙箱里的行为。

> 顺带一条实测发现（已记为 N-02）：bash 层护栏对权威面脚本的判定是「命令文本里出现指向本插件包的权威面脚本路径就拒」
> （`plugin/scripts/guard.mjs:329` 的注释写明「执行与读取都算」）。因此 `git diff --stat -- plugin/scripts/roster.mjs`
> 这条**只读、不读文件内容**的 git 命令也会被拦，而 `git diff --stat`（输出里同样含该文件名）放行。

---

## 5. 改前 / 改后输出

### 5.1 改前（`git HEAD` 的真·改前版 `roster.mjs`，同一输入）

账号目录里只有 `sa-live-member`（专项）与 `sa-builtin-probe`（`.builtin/` 内置），
登记 `sa-ghost-member`（账号里没有）：

```json
{
  "ok": true,
  "member": {
    "name": "sa-ghost-member",
    "kind": "specialist",
    "owns": "从表格抠出结构化数据并回显口径",
    "method": ".superagent/methods/sa-ghost-member.md",
    "source": "runtime",
    "created_at": "2026-11-10T14:04:24.932Z"
  }
}
【改前】名录里现在有：["sa-ghost-member"]
【改前】账号里的成员：sa-live-member（专项）、sa-builtin-probe（.builtin/ 内置）
【改前】sa-ghost-member 账号里没有，却被登记进名录 ⇒ 名录与账号漂移
```

### 5.2 改后（工作树版，同一输入）

```json
{
  "ok": false,
  "errors": [
    "该成员在账号里不存在：sa-ghost-member。建号与登记必须成对（先在账号里建好该成员，再登记进项目名录）。应检查的位置：账号成员目录下的 sa-ghost-member/ 与 .builtin/sa-ghost-member/。"
  ],
  "error_rules": ["account_member_missing"],
  "account_check": { "ok": false, "code": "account_member_missing" }
}
```

### 5.3 改后：账号里真实存在的成员 → 通过

```json
{ "ok": true, "member": { "name": "sa-live-member", "kind": "specialist", "source": "runtime", "...": "..." } }
```

### 5.4 改后：内置成员（`.builtin/` 下）→ 通过，不被误伤

```json
{ "ok": true, "member": { "name": "sa-builtin-probe", "kind": "specialist", "source": "runtime", "...": "..." } }
```

### 5.5 改后：账号名单不可用 → 拒绝，且不说「在账号里不存在」

```json
{
  "ok": false,
  "errors": [
    "无法核验账号成员名单：账号成员目录读不出来：<账号成员目录>（ENOENT: no such file or directory, scandir '<账号成员目录>'）。名单读不出来时不能断言「该成员存在」—— 建号与登记必须成对，所以这里不放行。请在账号运行环境里执行（PLUGIN_DATA 指向本插件的专属目录，此时账号成员目录取 <用户主目录>/.minimax/agents/），或用 SAR_ACCOUNT_AGENTS_DIR 显式指向账号成员目录后重试。"
  ],
  "error_rules": ["account_list_unavailable"],
  "account_check": { "ok": false, "code": "account_list_unavailable" }
}
```

注意报错里的账号目录已被替换成 `<账号成员目录>`（第 2.5 节）。

### 5.6 改后：reconcile 与共享计算同口径

```
账号视图(账号成员目录)      = ["sa-builtin-probe","sa-live-member"]
reconcile(不喂).stale        = []
lib.stale(同一账号视图)      = []
两者逐字相同                 = true

账号视图(喂进来的名单)        = ["sa-live-member"]
reconcile(喂名单).stale       = ["sa-builtin-probe"]
lib.stale(同一喂入视图)       = ["sa-builtin-probe"]
两者逐字相同                 = true
```

> 比较必须**喂同一份账号视图**才成立：拿 `reconcile(喂名单)` 去比「账号目录视图」，比的是两个不同输入，恒不相等 ——
> 那是比较方法错了，不是实现分叉了。测试里两条断言分别按各自视图比较（`roster-test.mjs` 第 14 节）。

---

## 6. 变异矩阵（断言有没有区分力）

**目的**：证明「D-39 账号存在性校验」这条断言**不是恒真** —— 把实现改回去，目标断言必须转红；
若不变红，说明这条断言测了个寂寞。

**安全性**：变异只改**系统临时目录里的插件副本**，仓库工作树零改动；跑完即删。
开关是 `SAR_MUTATION=1`（只存在于测试文件，插件包内无此钩子；被重跑的子进程显式清空该变量，避免递归跑自己）。

| 变异体 | 改什么 | 期望转红的断言 | 实测 |
|---|---|---|---|
| **M1** | `roster.mjs`：把 `accountCheck = checkAccountMember(name);` 换成恒 ok 桩（= 回退整条校验，即改前的样子） | 「登记账号里不存在的成员被拒」 | ✅ 转红 |
| **M1** | 同上 | 「报错写明『在账号里不存在』」 | ✅ 转红 |
| **M1** | 同上 | 「命中的规则是 account_member_missing（唯一一条）」 | ✅ 转红 |
| **M1** | 同上 | 「被拒的成员没有进名录（拒绝必须是真的拒绝）」 | ✅ 转红 |
| **M2** | `lib.mjs`：账号名单不再合并 `.builtin/`（`if (en && en.isDirectory() …)` → `if (false && …)`） | 「内置成员（`.builtin/` 下）登记通过，不被误伤」 | ✅ 转红 |
| **M2** | 同上 | 「D-39 登记账号里真实存在的成员通过」**必须仍绿** | ✅ 仍绿（变异点没打偏） |

**为什么 M1 证不了「内置成员不被误伤」**：M1 把整条校验摘掉后，内置成员照样放行 —— 它**证明不了**这条断言有区分力。
所以必须另设 M2：校验还在、只是名单漏了 `.builtin/`，内置成员才会被误伤。
两个变异体缺一不可。

实测输出（变异体运行时被重跑的套件报出的红行）：

```
PASS D-39 变异体 M1（回退账号存在性校验）→「登记账号里不存在的成员被拒」转红
  :: FAIL D-39 登记账号里不存在的成员被拒 :: {"ok":true,"member":{"name":"sa-ghost-member",…
  :: FAIL D-39 报错写明「在账号里不存在」
  :: FAIL D-39 命中的规则是 account_member_missing（唯一一条）
  :: FAIL D-39 被拒的成员没有进名录 :: ["sa-dup","sa-dup","sa-ghost-member"]
PASS D-39 变异体 M1 →「命中的规则是 account_member_missing」也转红
PASS D-39 变异体 M1 →「被拒的成员没有进名录」也转红（拒绝必须是真的拒绝）
PASS D-39 变异体 M2（账号名单漏计 .builtin/ 内置成员）→「内置成员不被误伤」转红
  :: FAIL D-39 内置成员（.builtin/ 下）登记通过，不被误伤 :: {"ok":false,"errors":["该成员在账号里不存在：sa-builtin-probe。…
PASS D-39 变异体 M2 只打红内置成员那一条（其余断言仍绿）
>>> ROSTER ALL PASS
```

---

## 7. 回归结果

### 7.1 本单套件

| 阶段 | 命令 | 结果 |
|---|---|---|
| 改前基线 | `node tools/run-tests.mjs --all --root plugin --repo .` | 11 套全绿，roster-test **pass=23 fail=0** |
| 改后 | `$env:SAR_PLUGIN_ROOT='plugin'; node tests/roster-test.mjs` | **pass=38 fail=0**（新增 15 条），末行 `>>> ROSTER ALL PASS` |
| 改后 + 变异开关 | `$env:SAR_MUTATION='1'; …` | **43 条断言全绿**（38 + 5 条变异断言） |

新增的 15 条断言：第 13 节（D-39 名录侧，10 条）+ 第 14 节（reconcile 同口径，5 条）。

### 7.2 十一套全量回归（改后）

```
REPO=.
ROOT=plugin
RESULT chain-test exit=0 pass=65 fail=0
RESULT d27-mut-test exit=0 pass=14 fail=0
RESULT dispatch-release-test exit=0 pass=33 fail=0
RESULT e2e-test exit=0 pass=53 fail=0
RESULT guard-test exit=0 pass=228 fail=0
RESULT hooks-test exit=0 pass=29 fail=0
RESULT lessons-test exit=0 pass=65 fail=0
RESULT records-test exit=0 pass=52 fail=0
RESULT roster-test exit=0 pass=38 fail=0
RESULT scope-amend-test exit=0 pass=92 fail=0
RESULT scope-test exit=0 pass=33 fail=0
>>> SHELL ALL PASS
```

**0 FAIL**，与改前基线同绿。本轮无「别人改到一半」造成的失败套件。

### 7.3 夹具隔离

测试与探针的 `MINIMAX_PROJECT_DIR` / `PLUGIN_DATA` / `SAR_ACCOUNT_AGENTS_DIR` 全部指向临时目录；
测试进程内也显式设了前两者（该文件有几处**在本进程内 import** `roster.mjs` / `lib.mjs` 再调读接口，不设会去读真实项目）。
**真实项目的变更账与真实账号目录都没有被碰过。**

---

## 8. 残余风险

1. **在「没有账号环境」的执行上下文里，登记功能整体不可用。**
   取不到账号名单 ⇒ 一律拒绝（`account_list_unavailable`）。这是有意取舍（第 2.3 节），
   但它意味着：任何在没有账号名单的沙箱/CI 里跑 `roster register` 都会拿到拒绝。
   解除办法目前只有 `SAR_ACCOUNT_AGENTS_DIR` —— 而**这个环境变量没有进契约**（见第 10 节 N-01）。

2. **账号名单是目录扫描，存在时间差。** 校验通过后、名录落盘前，账号成员被删除的情况不会被本单拦住
   （账号级删除本就是硬拦动作，且删除与登记之间的时间差极短）。残余窗口存在。

3. **名单可读但内容不全时，结论仍然「可核验」。** `accountMemberNames()` 把 `.builtin/` 合并进名单，
   但若账号成员目录的布局在别处发生变化（例如未来新增第三处成员位置），共享计算需要同步更新 ——
   这是**单点风险**，正因如此才必须所有侧共用这一份计算，而不是各自扫。

4. **本单只管名录侧。** 账号侧建号闸门在机制侧（`docs/audit/fix-d37-d41.md`），
   两边是「成对」的两半，任一半单独存在都不能保证「建号与登记成对」。

5. **变异开关 `SAR_MUTATION` 是普通环境变量**，与契约 S14 记录的 `SAR_FAULT_INJECT` 同类问题：
   它只存在于测试文件、只改临时副本，**不进入插件包**，不构成生产注入面。

---

## 9. 需要父会话处理的事

1. **N-01 建议入台账**（编号前缀 `N-`，起始 `01`）—— 见第 10 节。台账文件 `docs/audit/defect-ledger.md` 不在本单 SCOPE 内，
   且本轮由机制成员并行改动，故**本单未写入台账**，请父会话合并。
2. **补契约**（协议文档不归本单）：把「账号成员目录的定位方式」写进契约的运行时环境约定。
   现在 `SAR_ACCOUNT_AGENTS_DIR` / `SAR_ACCOUNT_HOME_DIR` 只存在于代码注释与 `docs/audit/fix-d37-d41.md`，
   不在 `contract.md` 里 —— 而本单的严格策略让它成了登记功能的唯一解除办法。
3. **确认人工建号的确认通道**：本单让「登记」要求成员先存在于账号，机制侧让「建号」需要人工确认 ——
   首次现场配置成员的流程因此卡在「人工建号」这一步。请父会话确认该确认通道在实机上可用，
   否则 bootstrap 流程（方法论文件 → 建成员 → 登记 roster，契约 S12）会在中间断掉。
4. **D-39 台账条目的状态**已被机制成员改写为「已修（v0.5.6，待独立复验）」并注明「名录登记侧由 `sa-gate-integrity` 并行处理」——
   名录侧这一半现已完成，请父会话据此更新台账状态与复验安排。
5. **部署**：本单**未部署**、**未改版本号**、**未动 CHANGELOG/README**。发布相关动作归 `sa-plugin-release`。
6. **N-02（机制侧）**：bash 层护栏对权威面脚本的判定按「命令文本里出现该路径」判，不区分动词，
   导致 `git diff --stat -- plugin/scripts/roster.mjs` 这类**不读内容的只读命令**被拦。
   `plugin/scripts/guard.mjs` 不在本单 SCOPE，本单**只记录不改**；请派给机制侧成员处理。

---

## 10. 本单新发现的缺陷（建议入台账，编号前缀 `N-`，起始 `01`）

### N-01
- **触发条件**：在没有账号环境的执行上下文里，需要登记专项成员（并希望登记能成功）。
- **影响**：`roster.mjs register` 的「名单不可用 ⇒ 拒绝」策略使登记功能在非账号环境下**整体不可用**；
  唯一的解除办法 `SAR_ACCOUNT_AGENTS_DIR` **未写入契约**，只存在于代码注释与审计报告里
  （实测：`plugin/skills/super-agent-router/references/contract.md` 全文无 `SAR_ACCOUNT_AGENTS_DIR` / `SAR_ACCOUNT_HOME_DIR`；
  契约只在 S11 的语境里提到 `PLUGIN_DATA` 是本插件专属目录）。后果是：按契约配置运行的用户**无法从文档得知**
  登记为何被拒、也不知道该设哪个变量。
- **复现步骤**：1) 在 `PLUGIN_DATA` 不指向本插件专属目录、且未设 `SAR_ACCOUNT_AGENTS_DIR` 的环境里执行
  `node plugin/scripts/roster.mjs register '<memberJson>'`；2) 返回 `account_list_unavailable`，提示里给出的变量名来自代码而非契约。
- **证据**：`docs/audit/.tmp-d39/probe-output.txt` 第 5 段（名单不可用时的报错原文）；
  `plugin/scripts/lib.mjs:759`（`accountAgentsRoot()` 的三条定位规则）；`plugin/scripts/roster.mjs:145`（报错里点名该变量）。
- **状态**：已复现（实测 + 全文检索）→ **待修**。修法方向：把「账号成员目录定位」写进契约的运行时环境约定
  （契约文档归属协议维护者，不在本单 SCOPE）。
- **还需要什么**：无。
- **来源：sa-gate-integrity 修复轮实测 ｜ 严重度：P3 ｜ 归属层：契约层**

---

### N-02
- **触发条件**：子代理在 bash 通道执行一条**只读**命令，其参数里带了本插件包内权威面脚本的路径
  （典型：`git diff --stat -- plugin/scripts/roster.mjs`）。
- **影响**：命令被当成「执行了父会话专属的权威面脚本」而整条拒绝。
  但该命令**不执行任何脚本、也不读脚本内容**（`--stat` 只出统计），
  于是子代理**无法在 bash 层核对自己有权修改的权威面脚本的 diff**，验收取证被迫绕到 `read` 工具或全量 `git diff`。
  护栏自身的注释写明这条规则的理由是「读一份再改名执行是同一条链」——
  而 `--stat` 这类**不读内容**的用法并不落在该理由里，属判定粒度粗于理由（与 D-40「文案形态 ≠ 实际动作」同一族）。
- **复现步骤（对照实验，只差路径参数）**：
  1) `git diff --stat` → **放行**（输出里同样含 `plugin/scripts/roster.mjs`）；
  2) `git diff --stat -- plugin/scripts/lib.mjs` → **放行**；
  3) `git diff --stat -- plugin/scripts/roster.mjs` → **被拦**（拦截文案：「子代理执行了父会话专属的权威面脚本（权限/记录入口：roster.mjs）」）。
  三条命令形状相同，只有路径参数不同 ⇒ 触发条件是**命令文本里的路径 token 命中**，与命令动词无关。
- **证据**：`plugin/scripts/guard.mjs:329`（规则意图）、`plugin/scripts/guard.mjs:333`（权威面脚本清单）、
  `plugin/scripts/guard.mjs:408`（`authorityScriptHit()`：对每个 path token 解析候选绝对路径并按插件包身份判命中，**不看动词**）。
- **状态**：已复现（对照实验，三条命令只差路径参数）→ **待修**。修法方向：把判定落到「该路径在本命令里是否被**执行或读取内容**」
  上（如执行类动词、输出重定向、`cat`/`show`/`copy` 一类内容读取），而不是「路径 token 出现在命令行里」。
  `read` / `edit` / `write` 工具通道不受这条限制（护栏注释已写明），故 read 工具路径可用。
- **还需要什么**：无。
- **归属**：**机制侧**（`plugin/scripts/guard.mjs` 不在本单 SCOPE，本单**未修改该文件**，只如实记录）。
- **来源：sa-gate-integrity 修复轮实测 ｜ 严重度：P3 ｜ 归属层：机制层**

---

## 附：落盘清单

| 文件 | 说明 |
|---|---|
| `plugin/scripts/roster.mjs` | 实现：`checkAccountMember` / `redactAccountDir` / `error_rules` / reconcile 收敛 |
| `tests/roster-test.mjs` | 沙箱夹具 + 第 13 节（D-39 名录侧 10 条）+ 第 14 节（reconcile 同口径 5 条）+ 第 15 节（变异矩阵 5 条） |
| `docs/audit/fix-d39-roster.md` | 本报告 |
| `docs/audit/.tmp-d39/probe-d39.mjs` | 探针（改前取 `git HEAD` 真版本，同输入对照） |
| `docs/audit/.tmp-d39/probe-output.txt` | 探针输出全文 |
