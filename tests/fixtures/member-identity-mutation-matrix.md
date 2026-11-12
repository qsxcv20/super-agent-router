# 成员持久身份口径的语义变异体矩阵定义（契约 S16）

> 承 D-91 / D-97 / 零欠账轮的既有做法（tests/fixtures/d91-mutation-matrix.md、
> d97-mutation-matrix.md、zero-debt-mutation-matrix.md）：
> 变异体矩阵是「断言到底会不会红」的证明 —— 只存在于某个人的临时脚本里，
> 矩阵结论就既不可采信也不可反驳。本文件把每个变异体的**锚点原文、改成什么、
> 期望红哪条断言**逐字固定下来。
>
> **配套执行器**：tests/fixtures/member-identity-mutation-matrix.mjs（串行执行，不并发）。
> **被测套件**：tests/member-identity-test.mjs（用 SAR_REPO_DIR 指向变异副本）。
> 变异跑在**字节级副本**上（fs.cpSync），真实仓库一个字节都不动。
>
> **本文件由执行器导出**（`node tests/fixtures/member-identity-mutation-matrix.mjs . --emit-md`），
> 锚点原文与执行器里的 MUTANTS 数组**逐字同源** —— 手抄锚点迟早分叉，
> 而分叉的锚点 = 不可复现的矩阵结论。

## 判定口径（三列分开报）

| 列名 | 含义 |
|---|---|
| 专属锚点红 | 本变异体**指定**的那条断言是否转红 |
| EXTRA-RED | 除专属锚点外额外转红的条数 |
| 总红数 | 套件 FAIL 断言总条数 |

判定：专属锚点红=是 且 总红数=1 ⇒ 恰好红一条；专属锚点红=是 且 总红数>1 ⇒ EXTRA-RED(N)；
专属锚点红=否 ⇒ MISS（致命：该变异体没被任何断言抓住 ⇒ 矩阵退出码非 0）。

**计数口径的坑**：套件断言的详情里会带子进程（检查器）的原始输出。
若详情原样打印，它的 `FAIL …` 行会**独立成行** ⇒ 被行式扫描器
（tools/run-tests.mjs 与本执行器）误记成套件失败。
所以本套件的 `ok()` 把详情里的换行压成 ` | ` —— 这不是洁癖，是**计数正确性**的前提。

## 变异体清单（19 个）

### M-MIa · 完全不检查（检测循环被清空）
- 缺陷：契约 S16。描述：完全不检查（检测循环被清空）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  for (const f of FORBIDDEN_FEATURES) {
```
- 改成：
```
  for (const f of []) {
```
- 期望红：**MI-C1 脏账号目录 ⇒ 退出码非 0**

### M-MIb · 只查版本号、放过其它
- 缺陷：契约 S16。描述：只查版本号、放过其它。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
export const FORBIDDEN_FEATURES = FEATURE_SPECS.map((f) => ({
```
- 改成：
```
export const FORBIDDEN_FEATURES = FEATURE_SPECS.filter((x) => x.id === 'version').map((f) => ({
```
- 期望红：**MI-C12 只有非版本类残留 ⇒ 退出码非 0**

### M-MIc · 账号目录不可用也判失败（把「没查」当成「查出不干净」）
- 缺陷：契约 S16。描述：账号目录不可用也判失败（把「没查」当成「查出不干净」）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  if (result.hits.length) return 1;
```
- 改成：
```
  if (result.hits.length || !result.agents.available) return 1;
```
- 期望红：**MI-F1 账号目录不存在 ⇒ 退出码 0**

### M-MId · 命中项不报原文（人看不出该删什么）
- 缺陷：契约 S16。描述：命中项不报原文（人看不出该删什么）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
    '     原文：' + h.text,
```
- 改成：
```
    '     命中',
```
- 期望红：**MI-E3 命中项输出里有命中的原文**

### M-MIe · 命中项不报行号（人定位不到该删哪一行）
- 缺陷：契约 S16。描述：命中项不报行号（人定位不到该删哪一行）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
    '  ' + (i + 1) + '. ' + h.file + ':' + h.line,
```
- 改成：
```
    '  ' + (i + 1) + '. ' + h.file,
```
- 期望红：**MI-E2 命中项输出里有行号**

### M-MIf · 名录不查 created_for（能力化表述那条规矩的主战场失守）
- 缺陷：契约 S16。描述：名录不查 created_for（能力化表述那条规矩的主战场失守）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
export const ROSTER_FIELDS = ['created_for', 'owns', 'accepts', 'reject', 'method'];
```
- 改成：
```
export const ROSTER_FIELDS = ['owns', 'accepts', 'reject', 'method'];
```
- 期望红：**MI-D2 命中的字段是 created_for**

### M-MIg · 宿主配置字段也参与判定（defaultWorkspaceDir 的盘符路径又被当成残留）
- 缺陷：契约 S16-规则5。描述：宿主配置字段也参与判定（defaultWorkspaceDir 的盘符路径又被当成残留）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  return HOST_CONFIG_KEYS.some((h) => h.id.toLowerCase() === k || h.id.toLowerCase() === leaf);
```
- 改成：
```
  return HOST_CONFIG_KEYS.length === 0;
```
- 期望红：**MI-H1 front matter 的宿主配置字段**

### M-MHh · description 不参与判定（提示词本体少了一块）
- 缺陷：契约 S16-规则5。描述：description 不参与判定（提示词本体少了一块）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  if (k === 'description') return 'description';
```
- 改成：
```
  if (k === 'description') return 'host-config';
```
- 期望红：**MI-H2 front matter 里只有 description 参与判定**

### M-MHi · front matter 未闭合时静默放过（结构认不出就当宿主配置）
- 缺陷：契约 S16-规则5。描述：front matter 未闭合时静默放过（结构认不出就当宿主配置）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  if (end < 0) return out;
```
- 改成：
```
  if (end < 0) { out.fill('host-config'); return out; }
```
- 期望红：**MI-H3 front matter 未闭合 ⇒ 全文按正文扫**

### M-MHj · 让渡句不豁免一次性措辞（合规写法被当成残留）
- 缺陷：契约 S16-规则6。描述：让渡句不豁免一次性措辞（合规写法被当成残留）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
        const delegated = sent ? isDelegationSentence(line.slice(sent[0], sent[1])) : false;
```
- 改成：
```
        const delegated = false;
```
- 期望红：**MI-H5 让渡句（由 brief 决定 / 由 brief 给出 / 路径随任务变）不算残留**

### M-MHk · 让渡句豁免整句（含具体标识 ⇒ 规则 6 第二句被丢掉）
- 缺陷：契约 S16-规则6。描述：让渡句豁免整句（含具体标识 ⇒ 规则 6 第二句被丢掉）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
      if (f.suppressibleByDelegation) {
```
- 改成：
```
      if (true) {
```
- 期望红：**MI-H6 让渡句不豁免具体标识**

### M-MIl · 不认裸脚本 / 配置文件名（具体标识覆盖面只剩文档类）
- 缺陷：契约 S16-规则7。描述：不认裸脚本 / 配置文件名（具体标识覆盖面只剩文档类）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  if (!hasSep && isConcreteFileName(t)) return 'concrete-file';
```
- 改成：
```
  if (!hasSep && isConcreteFileName(t)) return null;
```
- 期望红：**MI-H7 具体标识覆盖脚本与配置文件名**

### M-MIm · 不认带目录段的相对路径（具体路径覆盖面只剩裸文件名）
- 缺陷：契约 S16-规则7。描述：不认带目录段的相对路径（具体路径覆盖面只剩裸文件名）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  if (isConcreteFileName(lastSegment)) return true;
```
- 改成：
```
  if (false) return true;
```
- 期望红：**MI-H8 具体标识覆盖带目录段的相对路径**

### M-MIn · 仓库相对引用不再豁免（机制自己的路径被当成残留）
- 缺陷：契约 S16-规则7。描述：仓库相对引用不再豁免（机制自己的路径被当成残留）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  { id: 'repo-relative', why: '仓库相对引用（以 plugin/ docs/ tests/ tools/ .superagent/ 开头且不含盘符）：机制自身的稳定资产，不是本次任务的坐标。', re: /(?:^|[^A-Za-z0-9_])(?:plugin|docs|tests|tools|\.superagent)[\\/]/i },
```
- 改成：
```
  { id: 'repo-relative', why: '仓库相对引用（以 plugin/ docs/ tests/ tools/ .superagent/ 开头且不含盘符）：机制自身的稳定资产，不是本次任务的坐标。', re: /(?!x)x/i },
```
- 期望红：**MI-H9 豁免仓库相对引用**

### M-MIo · 通配形态不再豁免（*.receipt.json 被当成具体文件名）
- 缺陷：契约 S16-规则7。描述：通配形态不再豁免（*.receipt.json 被当成具体文件名）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  { id: 'wildcard-pattern', why: '通配形态（如 *.receipt.json）指向的是「一类文件」，不是某一个具体文件名。', re: /[*?]/ },
```
- 改成：
```
  { id: 'wildcard-pattern', why: '通配形态（如 *.receipt.json）指向的是「一类文件」，不是某一个具体文件名。', re: /(?!x)x/ },
```
- 期望红：**MI-H10 豁免通配形态**

### M-MIp · 相对路径判据放宽（只要含分隔符就算路径 ⇒ 自然语言枚举全被误报）
- 缺陷：契约 S16-规则7。描述：相对路径判据放宽（只要含分隔符就算路径 ⇒ 自然语言枚举全被误报）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  if (hasSep && isRelativeDirPath(last, endsWithSep, headSegs.length > 0)) return 'relative-path';
```
- 改成：
```
  if (hasSep) return 'relative-path';
```
- 期望红：**MI-H11 自然语言里的斜杠枚举**

### M-MIq · 仓库自有资产不再豁免（机制自己的 lib.mjs 被当成某一单的交付物）
- 缺陷：契约 S16-规则7。描述：仓库自有资产不再豁免（机制自己的 lib.mjs 被当成某一单的交付物）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  { id: 'repo-own-asset', why: '裸文件名（**无目录段**）在本仓库内**确实存在同名文件** ⇒ 它是机制自身的稳定资产（规则 1 禁的是「本次任务的」标识，不是机制自己的文件）；契约规则 7 末段 contract.md:883-886。', test: (t) => isBareFileName(t) && isRepoAsset(basenameOf(t)) }
```
- 改成：
```
  { id: 'repo-own-asset', why: '裸文件名（**无目录段**）在本仓库内**确实存在同名文件** ⇒ 它是机制自身的稳定资产（规则 1 禁的是「本次任务的」标识，不是机制自己的文件）；契约规则 7 末段 contract.md:883-886。', test: (t) => false }
```
- 期望红：**MI-H12 豁免仓库自有资产**

### M-MIr · 未知 front matter 键也跳过（把「未知键 fail-closed」改回静默放行）
- 缺陷：契约 S16-规则5。描述：未知 front matter 键也跳过（把「未知键 fail-closed」改回静默放行）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  return 'front-matter';
```
- 改成：
```
  return 'host-config';
```
- 期望红：**MI-H13 未知 front matter 键按 fail-closed 处理**

### M-MIs · 仓库自有资产豁免不区分目录段（带目录段的相对路径也被放过）
- 缺陷：契约 S16-规则7。描述：仓库自有资产豁免不区分目录段（带目录段的相对路径也被放过）。
- 文件：tools/member-identity-check.mjs
- 锚点（原文，独一命中）：
```
  return !/[\\/]/.test(String(text || ''));
```
- 改成：
```
  return true;
```
- 期望红：**MI-H14 仓库自有资产豁免只给无目录段的裸文件名**

## 复跑命令

```
node tests/fixtures/member-identity-mutation-matrix.mjs .
```

<!-- 实测结果段：跑完矩阵后把归档输出回填到这里 -->
## 实测结果（2026-11-12，node tests/fixtures/member-identity-mutation-matrix.mjs .）

```
基线：pass=64 fail=0 exit=0
M-MIa [S16] 完全不检查（检测循环被清空）：套件 pass=34 fail=30 专属锚点红=是 EXTRA-RED=29 总红数=30 判定=EXTRA-RED(29)
M-MIb [S16] 只查版本号、放过其它：套件 pass=40 fail=24 专属锚点红=是 EXTRA-RED=23 总红数=24 判定=EXTRA-RED(23)
M-MIc [S16] 账号目录不可用也判失败（把「没查」当成「查出不干净」）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MId [S16] 命中项不报原文（人看不出该删什么）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIe [S16] 命中项不报行号（人定位不到该删哪一行）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIf [S16] 名录不查 created_for（能力化表述那条规矩的主战场失守）：套件 pass=62 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-MIg [S16-规则5] 宿主配置字段也参与判定（defaultWorkspaceDir 的盘符路径又被当成残留）：套件 pass=62 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-MHh [S16-规则5] description 不参与判定（提示词本体少了一块）：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-MHi [S16-规则5] front matter 未闭合时静默放过（结构认不出就当宿主配置）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MHj [S16-规则6] 让渡句不豁免一次性措辞（合规写法被当成残留）：套件 pass=62 fail=2 专属锚点红=是 EXTRA-RED=1 总红数=2 判定=EXTRA-RED(1)
M-MHk [S16-规则6] 让渡句豁免整句（含具体标识 ⇒ 规则 6 第二句被丢掉）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIl [S16-规则7] 不认裸脚本 / 配置文件名（具体标识覆盖面只剩文档类）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIm [S16-规则7] 不认带目录段的相对路径（具体路径覆盖面只剩裸文件名）：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-MIn [S16-规则7] 仓库相对引用不再豁免（机制自己的路径被当成残留）：套件 pass=60 fail=4 专属锚点红=是 EXTRA-RED=3 总红数=4 判定=EXTRA-RED(3)
M-MIo [S16-规则7] 通配形态不再豁免（*.receipt.json 被当成具体文件名）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIp [S16-规则7] 相对路径判据放宽（只要含分隔符就算路径 ⇒ 自然语言枚举全被误报）：套件 pass=61 fail=3 专属锚点红=是 EXTRA-RED=2 总红数=3 判定=EXTRA-RED(2)
M-MIq [S16-规则7] 仓库自有资产不再豁免（机制自己的 lib.mjs 被当成某一单的交付物）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIr [S16-规则5] 未知 front matter 键也跳过（把「未知键 fail-closed」改回静默放行）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
M-MIs [S16-规则7] 仓库自有资产豁免不区分目录段（带目录段的相对路径也被放过）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=64
```

读法（与 D-91 / D-97 / 零欠账矩阵同口径，三列分开）：

- **MISS=0** ⇒ 19 个变异体**全部**被各自的专属锚点断言抓住，没有漏网的语义破坏。
- **EXTRA-RED 不是漏网，是同族断言的正常牵连**：破坏「整个检测」或「整张特征表」的变异体
  （M-MIa / M-MIb）会让所有「脏夹具 ⇒ 红」与「输出形态」的断言一起红；
  破坏某一类豁免的变异体（M-MIn / M-MIp）会让「不得误报」那一族断言一起红；
  破坏「相对路径覆盖面」的 M-MIm 会连带打红「相对路径要报」那一族（MI-H6 / MI-H14）。
  其余变异体都是「恰好红一条」或只牵连同族的 1~2 条。
- 个体变异明细（每个变异体红了哪几条）留档在：docs/audit/.tmp-member-identity/r2-mutation-output-final.txt。
- 变异体 M-MIg ~ M-MIs（14 个）对应 S16 规则 5 / 6 / 7 的每条新判据，
  每条都有**专属断言**（MI-H1 ~ MI-H14）与**一个能被证伪的变异体**（契约 S16 :888-892 的要求）。
