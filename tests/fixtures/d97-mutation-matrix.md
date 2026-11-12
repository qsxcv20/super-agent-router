# D-97 语义变异体矩阵定义

> 承 D-91 收尾轮的做法（tests/fixtures/d91-mutation-matrix.md）：
> 变异体矩阵是「断言到底会不会红」的证明 —— 只存在于某个人的临时脚本里，
> 矩阵结论就既不可采信也不可反驳。本文件把每个变异体的**锚点原文、改成什么、
> 期望红哪条断言**逐字固定下来。
>
> **配套执行器**：tests/fixtures/d97-mutation-matrix.mjs（串行执行，不并发）。
> 被测套件：tests/loop-gate-test.mjs（用 SAR_PLUGIN_ROOT 指向变异副本）。

## 判定口径（三列分开报）

| 列名 | 含义 |
|---|---|
| 专属锚点红 | 本变异体**指定**的那条断言是否转红 |
| EXTRA-RED | 除专属锚点外额外转红的条数 |
| 总红数 | 套件 FAIL 断言总条数 |

判定：专属锚点红=是 且 总红数=1 ⇒ 恰好红一条；专属锚点红=是 且 总红数>1 ⇒ EXTRA-RED(N)；
专属锚点红=否 ⇒ MISS（致命：该变异体没被任何断言抓住）。

## 变异体清单

### M-D97a · 投影口径不生效
- 描述：`measureTrailing()` 里启用兼容投影口径的分支恒不成立 ⇒ 投影上的调用认不出来。
- 锚点（原文，独一命中）：
```
    if (owned === 0 && excluded === 0) {
```
- 改成：
```
    if (false) {
```
- 期望红：**D-97 活体形态：兼容投影上连续 5 次相同调用 ⇒ 第 6 次被拦**

### M-D97b · 对齐层恒判不匹配
- 描述：`tailMatches()` 的末尾恒返回 mismatch ⇒ 内层 payload 与外层条目永不可比。
- 锚点（原文，独一命中）：
```
    if (normByKey(k, got) !== normByKey(k, want)) return 'mismatch';
  }
  return 'match';
}
```
- 改成（末行）：
```
  return 'mismatch';
```
- 期望红：**D-97 白盒·对齐层：同参 ⇒ match；异参 ⇒ mismatch；动态参数 ⇒ unknown（打断连续段但不计入）**

### M-D97c · 当前调用被计入（差一）
- 描述：`projectionTrailing()` 的末尾连续计数把**当前**那条也数进去 ⇒ 阈值差一。
- 锚点（原文，独一命中）：
```
  for (let i = cur - 1; i >= 0; i--) {
```
- 改成：
```
  for (let i = cur; i >= 0; i--) {
```
- 期望红：**D-97 白盒·计数层：6 条外层条目里末尾连续相同数 = 5（当前那条不计），且定位到了当前调用**

### M-D97d · 动态参数当可比
- 描述：`tailMatches()` 把「参数取不出」（动态表达式）判成 match ⇒ 会凭空造出连续重复。
- 锚点（原文，独一命中）：
```
  if (ext.dynamic.length) return 'unknown';
```
- 改成：
```
  if (ext.dynamic.length) return 'match';
```
- 期望红：**D-97 白盒·对齐层：同参 ⇒ match；异参 ⇒ mismatch；动态参数 ⇒ unknown（打断连续段但不计入）**

### M-D97e · unknown 不打断连续段（参数取不出的条目被算进连续数 ⇒ 误伤）
- 描述：`projectionTrailing()` 的末尾连续计数里，verdict='unknown'（参数取不出）**不打断**连续段，
  于是被当成一次「相同调用」计入 ⇒ 阈值差一 ⇒ 会误伤（契约 S15 §2 要求：不可比 ⇒ 打断连续段但**不计入**）。
- 锚点（原文，独一命中）：
```
    if (verdict !== 'match') break;
```
- 改成：
```
    if (verdict === 'mismatch') break;
```
- 期望红：**D-97 补断言 P2·白盒：动态条目（unknown）打断连续段且不计入 ⇒ same=4（不是 5）**

### M-D97f · excluded===0 守卫失效
- 描述：`measureTrailing()` 里启用兼容投影口径的守卫少了 `excluded === 0` ⇒
  当会话库口径的调用**全被归属键排除**（说明这份文件混着别的会话的行）时也改用投影口径去数
  ⇒ 把投影那半的行算进来 ⇒ 误伤。
- 锚点（原文，独一命中）：
```
    if (owned === 0 && excluded === 0) {
```
- 改成：
```
    if (owned === 0) {
```
- 期望红：**D-97 补断言 P3：混形态文件里有调用被归属键排除时 ⇒ 不得改用投影口径去数 ⇒ 放行并留痕（excluded===0 守卫）**

## 复跑命令

```
node tests/fixtures/d97-mutation-matrix.mjs .
```
## 实测结果（2026-11-12，node tests/fixtures/d97-mutation-matrix.mjs .）

```
基线：pass=67 fail=0 exit=0
M-D97a 投影口径不生效：套件 pass=66 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-D97b 对齐层恒判不匹配：套件 pass=63 fail=4 专属锚点红=是 EXTRA-RED=3 总红数=4 判定=EXTRA-RED(3)
M-D97c 当前调用被计入（差一）：套件 pass=62 fail=5 专属锚点红=是 EXTRA-RED=4 总红数=5 判定=EXTRA-RED(4)
M-D97d 动态参数当可比：套件 pass=64 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-D97e unknown 不打断连续段（参数取不出的条目被算进连续数 ⇒ 误伤）：套件 pass=65 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-D97f excluded===0 守卫失效（有调用被归属键排除时也改用投影口径去数 ⇒ 误伤）：套件 pass=66 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=10
```

读法（与 D-91 矩阵同口径，三列分开）：

- **MISS=0** ⇒ 6 个变异体**全部**被各自的专属锚点断言抓住，没有漏网的语义破坏。
- **EXTRA-RED 不是漏网，是分层断言的正常牵连**：M-D97b/c/d/e 破坏的正是「对齐层 / 计数层 /
  unknown 语义」这一族，依赖同一层的端到端断言与 P2 两条断言会一起红；
  **M-D97a 与 M-D97f 是「恰好红一条」**（各自只被自己的专属锚点抓住）。
- 输出留档：docs/audit/.tmp-d97/d97-mutation-matrix-output2.txt；
  D-91 矩阵复跑留档：docs/audit/.tmp-d97/d91-mutation-matrix-output2.txt（MISS=0、EXTRA-RED 合计 11，
  输出中**不含任何**「补断言」行 ⇒ 新增的 P2/P3 断言未被 D-91 变异体牵连）。