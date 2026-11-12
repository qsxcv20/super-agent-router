# 零欠账收口轮语义变异体矩阵定义（D-87 / D-89 / D-90 / D-94 / D-110）

> 承 D-91 / D-97 的既有做法（tests/fixtures/d91-mutation-matrix.md、d97-mutation-matrix.md）：
> 变异体矩阵是「断言到底会不会红」的证明 —— 只存在于某个人的临时脚本里，
> 矩阵结论就既不可采信也不可反驳。本文件把每个变异体的**锚点原文、改成什么、
> 期望红哪条断言**逐字固定下来。
>
> **配套执行器**：tests/fixtures/zero-debt-mutation-matrix.mjs（串行执行，不并发）。
> **被测套件**：tests/zero-debt-test.mjs（用 SAR_REPO_DIR / SAR_PLUGIN_ROOT 指向变异副本）。
> 变异跑在**字节级副本**上（fs.cpSync / copyFileSync），真实仓库一个字节都不动。

## 判定口径（三列分开报）

| 列名 | 含义 |
|---|---|
| 专属锚点红 | 本变异体**指定**的那条断言是否转红 |
| EXTRA-RED | 除专属锚点外额外转红的条数 |
| 总红数 | 套件 FAIL 断言总条数 |

判定：专属锚点红=是 且 总红数=1 ⇒ 恰好红一条；专属锚点红=是 且 总红数>1 ⇒ EXTRA-RED(N)；
专属锚点红=否 ⇒ MISS（致命：该变异体没被任何断言抓住 ⇒ 矩阵退出码非 0）。

**计数口径的坑**：被测套件自己会调用子套件（check-version-consistency.mjs），
子套件的失败行是「FAIL␣␣」（两空格），被测套件自己的失败行是「FAIL␣」（一空格）。
执行器只认一空格的那种（`/^FAIL (?! )/`）—— 否则子套件的输出会把总红数算错。

## 变异体清单（20 个）

### M-D87a · 归属查不到也放行（fail-open）
- 缺陷：D-87。描述：后台任务在派工台账里查不到归属时，改成放行 ——
  「取不到归属即拒绝」这条被推翻 ⇒ 跨成员读取重新打开。
- 文件：plugin/scripts/guard.mjs
- 锚点（原文，独一命中）：
```
    deny('[super-agent-router] 越界拦截：后台任务 ' + taskId + ' 的**归属查不到**。' +
```
- 改成：
```
    allow(injected); process.exit(0); deny('[super-agent-router] 越界拦截：后台任务 ' + taskId + ' 的**归属查不到**。' +
```
- 期望红：**D-87-A4 归属查不到的后台任务 ⇒ 拒绝（取不到归属即拒绝）**

### M-D87b · 载荷里没有 task_id 也放行
- 缺陷：D-87。描述：task_output 载荷里取不到 task_id 时改放行 ⇒ 「取不到目标即拒绝」失效。
- 文件：plugin/scripts/guard.mjs
- 锚点（原文，独一命中）：
```
    deny('[super-agent-router] 越界管控无法执行：' + tool + ' 没有可判定的 task_id。' +
```
- 改成：
```
    allow(injected); process.exit(0); deny('[super-agent-router] 越界管控无法执行：' + tool + ' 没有可判定的 task_id。' +
```
- 期望红：**D-87-A6 task_output 载荷里没有 task_id ⇒ 拒绝（取不到目标即拒绝）**

### M-D87c · 后台任务三件套整体不参与判定
- 缺陷：D-87。描述：toolKind() 不再把 task_output / task_query / task_stop 认成
  「后台任务通道」⇒ 三件套整体绕开归属判定（回到 D-87 的原始形态）。
- 文件：plugin/scripts/guard.mjs
- 锚点（原文，独一命中）：
```
  if (TASK_SESSION_TOOLS.includes(toolName)) return 'task';
```
- 改成：
```
  if (false) return 'task';
```
- 期望红：**D-87-A2 读别的成员的后台任务输出 ⇒ 拒绝**

### M-D87d · 同成员判定写反
- 缺陷：D-87。描述：归属成员的比较式取反 ⇒ 自己的任务被拒、别人的任务被放行。
- 文件：plugin/scripts/guard.mjs
- 锚点（原文，独一命中）：
```
  if (owner && ownerKey && myKey && ownerKey === myKey) {
```
- 改成：
```
  if (owner && ownerKey && myKey && ownerKey !== myKey) {
```
- 期望红：**D-87-A1 读自己成员的后台任务输出 ⇒ 放行**

### M-D89a · 追加轮反查不到原派工也放行
- 缺陷：D-89。描述：task_append 在台账里反查不到原派工时改放行 ——
  追加轮的成员与 SCOPE 就此无从确定（载荷里本来就没有 agent 身份）。
- 文件：plugin/scripts/dispatch.mjs
- 锚点（原文，独一命中）：
```
    deny('[super-agent-router] 追加轮无法登记：派工台账里查不到 task_id=' + appendTaskId + ' 对应的派工条目。' +
```
- 改成：
```
    process.exit(0); deny('[super-agent-router] 追加轮无法登记：派工台账里查不到 task_id=' + appendTaskId + ' 对应的派工条目。' +
```
- 期望红：**D-89-B3 追加轮查不到原派工 ⇒ 拒绝（载荷里没有 agent 身份，反查不到就是判不出边界）**

### M-D89b · 追加轮不继承原派工的名额组
- 缺陷：D-89。描述：追加轮自己占一个名额组 ⇒ 同组去重失效 ⇒ 名额被重复占、且与自己撞组。
- 文件：plugin/scripts/dispatch.mjs
- 锚点（原文，独一命中）：
```
      slot_group: group,
```
- 改成：
```
      slot_group: appendId,
```
- 期望红：**D-89-B7 追加轮与原派工共用名额组（不重复占名额、也不提前释放）**

### M-D89c · 追加轮被当成新的一份工作（消耗累计派工额度）
- 缺陷：D-89。描述：登记追加轮时顺手 bump 累计计数器 ⇒ 同一份工作的下一轮吃掉一条额度。
- 文件：plugin/scripts/dispatch.mjs
- 锚点（原文，独一命中）：
```
    return { result: { appendId } };
```
- 改成：
```
    bumpDispatchCounter(cur, owner.parent_session_id);
    return { result: { appendId } };
```
- 期望红：**D-89-B10 追加轮不消耗累计派工额度（同一份工作的下一轮）**

### M-D89d · 子会话绑定不改指追加条目
- 缺陷：D-89。描述：子会话绑定仍指原派工 ⇒ SubagentStop 回收的是**已结束**的原派工，
  追加轮挂到 TTL 才回收（名额泄漏）。
- 文件：plugin/scripts/dispatch.mjs
- 锚点（原文，独一命中）：
```
      if (bind) bind.dispatch_id = appendId;
```
- 改成：
```
      if (bind) { /* 变异：绑定不改指追加条目 */ }
```
- 期望红：**D-89-B9 子会话绑定改指追加条目（SubagentStop 回收的是追加轮，不是已结束的原派工）**

### M-D89e · 名额组去重失效（每条记录各算一个名额组）
- 缺陷：D-89。描述：slotGroupOf() 退回「一条记录一个组」⇒ 追加轮与原派工各占一个名额。
- 文件：plugin/scripts/lib.mjs
- 锚点（原文，独一命中）：
```
  return String((d && (d.slot_group || d.dispatch_id)) || '');
```
- 改成：
```
  return String((d && d.dispatch_id) || '');
```
- 期望红：**D-89-B16 同组去重：两条都在飞时，在飞名单里只有 1 条（自己跟自己不算组队冲突）**

### M-D90a · 一条状态塞两个结论不再判红
- 缺陷：D-90。描述：状态括注里出现第二个状态词（「已修（…未修）」）不再判红 ⇒ 双结论写法回流。
- 文件：tools/ledger-check.mjs
- 锚点（原文，独一命中）：
```
      if (rest.indexOf(v) >= 0) {
```
- 改成：
```
      if (false) {
```
- 期望红：**D-90-C7 一条状态塞两个结论 ⇒ status-vocab 转红**

### M-D90b · 索引行状态不再与明细逐字比对
- 缺陷：D-90。描述：索引表的「状态」列不再与明细段的 canonical 状态逐字比对 ⇒ 镜像漂移不被发现。
- 文件：tools/ledger-check.mjs
- 锚点（原文，独一命中）：
```
    const cell = row.cells[STATUS_COLUMN_INDEX] || '';
    if (cell !== want) {
```
- 改成：
```
    const cell = row.cells[STATUS_COLUMN_INDEX] || '';
    if (false) {
```
- 期望红：**D-90-C5 索引行状态与明细段不一致 ⇒ status-consistency 转红**

### M-D90c · 统计行的状态计数不再由明细重算
- 缺陷：D-90。描述：状态计数不再由明细重算比对 ⇒ 统计行可以自说自话。
- 文件：tools/ledger-check.mjs
- 锚点（原文，独一命中）：
```
      if (claimed !== counts[v]) {
```
- 改成：
```
      if (false) {
```
- 期望红：**D-90-C8 统计行的状态计数与明细重算不符 ⇒ status-stats 转红**

### M-D90d · 「未修」不再单独点名（零欠账第一条失效）
- 缺陷：D-90。描述：no-unfixed 不再单独报「未修」⇒ 零欠账的第一条判据失效。
- 文件：tools/ledger-check.mjs
- 锚点（原文，独一命中）：
```
    if (w === '未修') {
```
- 改成：
```
    if (false) {
```
- 期望红：**D-90-C9 有条缺陷状态写着「未修」⇒ no-unfixed 转红（零欠账第 1 条）**

### M-D90e · 索引表折行检测不到
- 缺陷：D-90。描述：识别不出「索引形状」的孤立行 ⇒ 索引表被折行断成两块时查不出来。
- 文件：tools/ledger-check.mjs
- 锚点（原文，独一命中）：
```
    const isIndexShaped = (cells) => cells.length >= 5 && isDId(cells[0]) &&
      /^P[0-3]$/.test(cells[2]) && /层$/.test(cells[3]);
```
- 改成：
```
    const isIndexShaped = (cells) => false;
```
- 期望红：**D-90-C10 索引表被折行断成两块 ⇒ index-single-block 转红**

### M-D90f · 模板里的状态字段不再与契约词表对账
- 缺陷：D-90。描述：台账第二节的条目模板里留着旧词表（「已复现 | 推断」）不再判红
  —— 样板错了，以后每一条都会被照着写成词表外的状态。
- 文件：tools/ledger-check.mjs
- 锚点（原文，独一命中）：
```
      if (!vocab.includes(head)) {
```
- 改成：
```
      if (false) {
```
- 期望红：**D-90-C11 模板里的状态字段含词表外的旧词 ⇒ template-status-vocab 转红**

### M-D94a · 版本一致性断言被摘掉（恒过）
- 缺陷：D-94。描述：所有「== plugin.json」的版本比对恒过 ⇒ 升版不同步不再报错
  （这正是 D-94 的原始形态）。
- 文件：tools/install-selftest/check-version-consistency.mjs
- 锚点（原文，独一命中）：
```
function check(name, cond, detail = '') {
```
- 改成：
```
function check(name, cond, detail = '') {
  if (String(name).indexOf('== plugin.json') >= 0) cond = true;
```
- 期望红：**D-94-D3 根 README 的版本字面量与 plugin.json 不一致 ⇒ 退出码非 0**

### M-D94b · handler 数不再与实际文件对账
- 缺陷：D-94。描述：README 写的 handler 数不再与 hooks.json 实际组数比对。
- 文件：tools/install-selftest/check-version-consistency.mjs
- 锚点（原文，独一命中）：
```
  !!rootHandlers && Number(rootHandlers) === handlerGroups,
```
- 改成：
```
  !!rootHandlers,
```
- 期望红：**D-94-D5 README 的 handler 数与实际不符 ⇒ 退出码非 0**

### M-D94c · 脚本数不再与实际文件对账
- 缺陷：D-94。描述：README 写的脚本数不再与 plugin/scripts 实际 .mjs 数比对。
- 文件：tools/install-selftest/check-version-consistency.mjs
- 锚点（原文，独一命中）：
```
  !!rootScripts && Number(rootScripts) === scriptCount,
```
- 改成：
```
  !!rootScripts,
```
- 期望红：**D-94-D9 README 的脚本数与实际不符 ⇒ 退出码非 0**

### M-D110a · 版本派生改回写死（下次升版就复发）
- 缺陷：D-110。描述：把「从当前版本派生下一个版本」改回写死常量 ——
  今天仓库的版本刚好等于那个常量时看不出问题，下次升版就复发（手法退化成空操作）。
- 文件：tests/zero-debt-test.mjs
- 锚点（原文，独一命中）：
```
  return m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);
```
- 改成：
```
  return '0.5.12';
```
- 期望红：**D-110-D1 注入用的版本号必须从当前版本派生**

### M-D110b · 替换手法退化成空操作（字节没变 ⇒ 假故障没造成）
- 缺陷：D-110。描述：把「替换 manifest 的 version 字段」改成原样返回 ——
  注入变成空操作，假故障根本没造成，被测检查器照样退出 0（D-94-D6 的红会变得语焉不详）。
- 文件：tests/zero-debt-test.mjs
- 锚点（原文，独一命中）：
```
  return String(manifestText || '').replace(/("version"\s*:\s*")([^"]+)(")/, (m, a, v, c) => a + next + c);
```
- 改成：
```
  return String(manifestText || '');
```
- 期望红：**D-110-D2 造故障手法自检 · manifest 升版**

## 复跑命令

```
node tests/fixtures/zero-debt-mutation-matrix.mjs .
```

## 实测结果（2026-11-12，node tests/fixtures/zero-debt-mutation-matrix.mjs .）

```
基线：pass=52 fail=0 exit=0
M-D87a [D-87] 归属查不到也放行（fail-open）：套件 pass=50 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-D87b [D-87] 载荷里没有 task_id 也放行：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D87c [D-87] 后台任务三件套整体不参与判定：套件 pass=46 fail=6 专属锚点红=是 EXTRA-RED=5 总红数=6 判定=EXTRA-RED(5)
M-D87d [D-87] 同成员判定写反：套件 pass=48 fail=4 专属锚点红=是 EXTRA-RED=3 总红数=4 判定=EXTRA-RED(3)
M-D89a [D-89] 追加轮反查不到原派工也放行：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D89b [D-89] 追加轮不继承原派工的名额组（自己占一个名额）：套件 pass=49 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-D89c [D-89] 追加轮被当成新的一份工作（消耗累计派工额度）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D89d [D-89] 子会话绑定不改指追加条目（回收的是已结束的原派工）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D89e [D-89] 名额组去重失效（每条记录各算一个名额组）：套件 pass=50 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-D90a [D-90] 一条状态塞两个结论不再判红：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D90b [D-90] 索引行状态不再与明细逐字比对：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D90c [D-90] 统计行的状态计数不再由明细重算：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D90d [D-90] 「未修」不再单独点名（零欠账第一条失效）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D90e [D-90] 索引表折行检测不到（识别不出索引形状的孤立行）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D90f [D-90] 模板里的状态字段不再与契约词表对账（旧词表可回流）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D94a [D-94] 版本一致性断言被摘掉（恒过）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D94b [D-94] handler 数不再与实际文件对账：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D94c [D-94] 脚本数不再与实际文件对账：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D110a [D-110] 版本派生改回写死（下次升版就复发）：套件 pass=51 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D110b [D-110] 替换手法退化成空操作（字节没变 ⇒ 假故障没造成）：套件 pass=46 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=12
```

读法（与 D-91 / D-97 矩阵同口径，三列分开）：

- **MISS=0** ⇒ 20 个变异体**全部**被各自的专属锚点断言抓住，没有漏网的语义破坏。
- **EXTRA-RED 不是漏网，是同族断言的正常牵连**：M-D87a/c/d 破坏的正是
  「归属判定」这一族（放行/查不到/写反），依赖同一判据的 A2~A8 会一起红；
  M-D89b/e 破坏的正是「名额组去重」这一族，B7/B16/B17 会一起红。
  **其余 15 个变异体都是「恰好红一条」**（各自只被自己的专属锚点抓住）。
- D-110 两个变异体也是「恰好红一条」：M-D110a（派生改回写死）只红 D-110-D1；
  M-D110b（替换退化成空操作）只红 D-110-D2 的字节自检 —— 后者会让套件当场停下
  （`>>> 造故障的手法失效了（D-110）`），不会带着「语焉不详的红」跑完全程。
- 输出留档：docs/audit/.tmp-zero-debt/zero-debt-mutation-matrix-output.txt。
