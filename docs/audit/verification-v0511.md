> **落点说明**：本文件是 `docs/audit/.tmp-verify-v0511/verification-v0511.md` 的**入库副本**（`.tmp-*/` 在 .gitignore 里，不入版本库）。
> 原始报告的落点行照原样保留在下方第 5 行。

# v0.5.11 批次独立验收报告

- 验收方：独立验收方（子会话 verifier，本会话 id mvs_4fb48727ad654a21a7fa6933509cb49f）
- 被验收批次：v0.5.11（零欠账收口轮 + 成员持久身份口径轮）
- 判据唯一出处：契约 plugin/skills/super-agent-router/references/contract.md 的 S1（状态词表，contract.md:31-57）/ S10（零欠账 4 条，contract.md:503-518）/ S16（成员持久身份口径，contract.md:851-899）
- 逐条清单：docs/audit/.tmp-member-identity/acceptance-criteria.md（A/B/C/D/E/F 六组）
- 本报告落点（原始暂存位置）：docs/audit/.tmp-verify-v0511/verification-v0511.md ｜ **正式入库位置**：docs/audit/verification-v0511.md
- 原始输出归档：docs/audit/.tmp-verify-v0511/raw（25 个文件；每个文件首行是 CMD 与 EXIT，其后是命令原始输出）
- 纪律：判据只取契约与清单；成员报告、父会话结论、README 自述数字一律未采信，全部自己重跑；结论只有 PASS / FAIL。

## 0. 结论摘要

| 组 | 判据条数 | PASS | FAIL | 结论 |
|---|---|---|---|---|
| A 零欠账（S10 四条 + A5） | 5 | 5 | 0 | PASS |
| B 本轮修掉的机制洞 | 4 | 4 | 0 | PASS |
| C 成员持久身份口径（S16） | 8 | 8 | 0 | PASS |
| D 诚实边界（5 条） | 5 | 5（照录且未越界） | 0 | PASS |

总判定：PASS。

附加观察 5 条（非判据项，不改变上表判定）见第 7 节；本轮未能验证的面 6 条见第 8 节；验收方自造变异体 3 个见第 5 节。

## 1. 执行方式与两处环境改道（先读）

1.1 护栏按命令意图分流：node 不在只读命令白名单里，于是 node 脚本一律按写通道判定。本单初始 SCOPE 把 tools/ tests/ plugin/ 登记为只读，判据要求的 node tools/run-tests.mjs --all --root plugin --repo . 被判「只读条目被写操作命中」而拦下。父会话随后以管理员身份把这三条扩为可写，理由是只让脚本跑得起来。扩权后所有校验命令按判据原文直接执行，未使用绕行写法，也未改动 tools/ tests/ plugin/ 下任何文件（第 9 节给出机械比对）。

1.2 docs/audit 仍是只读，判据里那条「用改前快照目录直接扫」的命令字面带只读路径，会被护栏拦下。改法：把快照字节级复制到本单临时目录再扫，复制前后逐文件 sha256 对账，9/9 逐字节一致（见 4.5 节）。原始快照一个字节未动，扫的是副本。

## 2. A 组：零欠账（契约 S10 的 4 条 + A5）

### A1 台账无未修条目 —— PASS

命令：node tools/ledger-check.mjs　退出码 0

原文输出（docs/audit/.tmp-verify-v0511/raw/02-ledger-check.txt）：

```
台账：C:\Users\yang2\Documents\MiniMax\mini code的插件\docs\audit\defect-ledger.md
摘要：{"statsLine":9,"indexRows":113,"detailCount":113,"statusUnion":113,"indexIds":113}
PASS 台账检查 index-columns
PASS 台账检查 sets-equal
PASS 台账检查 severity-distribution
PASS 台账检查 detail-meta-line
PASS 台账检查 detail-count
PASS 台账检查 no-duplicate-d
PASS 台账检查 index-single-block
PASS 台账检查 status-vocab
PASS 台账检查 status-consistency
PASS 台账检查 status-stats
PASS 台账检查 no-unfixed
PASS 台账检查 template-status-vocab
>>> 台账自洽
```

12 项全 PASS，其中 no-unfixed PASS。

我的独立复核（不依赖该脚本）：解析明细段 113 条，按契约 5 词统计 → 已修 103 / 设计边界 5 / 宿主侧不可修 2 / 待复核 3 / 未修 0。判定 PASS。

### A2 状态落在契约词表内且一条只有一个结论 —— PASS

同一命令：PASS 台账检查 status-vocab（退出码 0）。

词表来源核对：脚本从契约读，不另抄 —— tools/ledger-check.mjs:92-102 的 readStatusVocab 解析契约里的 STATUS-VOCAB 行（contract.md:46 原文：STATUS-VOCAB: 已修, 未修, 设计边界, 宿主侧不可修, 待复核）；契约读不到时报 status-vocab:contract-unreadable 判红，不静默跳过。

我的独立复核：113 条明细状态全部落在 5 词内（越界 0 条），无「已修（未修）」类双结论写法。判定 PASS。

### A3 索引行状态格 / 明细段状态行 / 修复状态表状态格三处逐字相同 —— PASS

同一命令：PASS 台账检查 status-consistency（退出码 0）。

我独立抽查 D-100~D-109 十条的三处状态格（行号为台账实际行号；本轮修复状态表在台账 L1830）：

| D 号 | 索引行状态格（行号） | 明细段状态行（行号） | 修复状态表状态格（行号） | 三处逐字相同 |
|---|---|---|---|---|
| D-100 | 已修（v0.5.11）(L135) | 已修（v0.5.11）(L595) | 已修（v0.5.11）(L1832) | 是 |
| D-101 | 已修（v0.5.11）(L136) | 已修（v0.5.11）(L605) | 已修（v0.5.11）(L1833) | 是 |
| D-102 | 已修（v0.5.11）(L137) | 已修（v0.5.11）(L615) | 已修（v0.5.11）(L1834) | 是 |
| D-103 | 已修（v0.5.11）(L138) | 已修（v0.5.11）(L625) | 已修（v0.5.11）(L1835) | 是 |
| D-104 | 已修（v0.5.11）(L139) | 已修（v0.5.11）(L635) | 已修（v0.5.11）(L1836) | 是 |
| D-105 | 已修（v0.5.11）(L140) | 已修（v0.5.11）(L645) | 已修（v0.5.11）(L1837) | 是 |
| D-106 | 已修（v0.5.11）(L141) | 已修（v0.5.11）(L655) | 已修（v0.5.11）(L1838) | 是 |
| D-107 | 待复核(L142) | 待复核(L665) | 待复核(L1839) | 是 |
| D-108 | 待复核(L143) | 待复核(L675) | 待复核(L1840) | 是 |
| D-109 | 待复核(L144) | 待复核(L685) | 待复核(L1841) | 是 |

10/10 三处逐字相同。判定 PASS。

### A4 统计行由明细重算 —— PASS

同一命令：PASS 台账检查 severity-distribution + PASS 台账检查 status-stats（退出码 0）。

我的独立重算（自己解析明细，不看索引表、不看统计行）：

```
明细条数 = 113
严重度：P0=11  P1=45  P2=41  P3=16   （越界 0 条）
状态：已修=103  未修=0  设计边界=5  宿主侧不可修=2  待复核=3   （越界 0 条）
```

台账统计行原文（台账 L9）：条目统计（2026-11-12 D-109 登记后更新）：总计 **113** 条（含 D-25b~D-25e 四个子条目），其中 P0 11 条、P1 45 条、P2 41 条、P3 16 条。……状态：已修 103 条、设计边界 5 条、宿主侧不可修 2 条、待复核 3 条。

与我的重算逐字吻合。判定 PASS。

### A5 索引表只有一个连续块（不许折行断开） —— PASS

对真台账：PASS 台账检查 index-single-block（退出码 0）。

判据要求的「验收方自造折行变异体确认它现在会红」已做，见 5.1：自造折行变异体 ⇒ index-single-block 判红；把检查器改回修复前的写法 ⇒ 同一份变异体不再报红（证明这条检查此前确为死代码、现在活了）。判定 PASS。

## 3. B 组：本轮修掉的机制洞（逐条要能指到代码行）

### B1 D-100 ledger-check 折行检测是死代码 —— PASS

修法落点：tools/ledger-check.mjs 的索引表单块检查。旧写法 blk.start + blk.block.length ⇒ undefined + n = NaN ⇒ for 循环一次都不执行（死代码）；现写法 blk.startLine - 1 + blk.block.length。

我自造变异体验证（5.1）：折行变异体下 index-single-block 判红；把同一份检查器改回旧写法后，同一变异体不再报红。判定 PASS。

### B2 D-104 后台任务三件套不在 matcher —— PASS

plugin/hooks/hooks.json:51 读类 matcher：read|glob|grep|list|search|task_output|task_query|task_stop

plugin/hooks/hooks.json:73 写类 matcher：read|glob|grep|list|search|write|edit|multiedit|notebookedit|bash|run_code|mavis|task|task_output|task_query|task_stop

三个工具名逐个列出。回归：tests/hooks-test.mjs 41 条断言全绿（RESULT 行 exit=0 pass=41 fail=0，其中含 D-87-A10）。判定 PASS。

### B5 D-106 成员的持久身份无口径约束、无机器校验 —— PASS

三个落点都在：契约 S16（contract.md:851-899，硬规则 1-7 + 机器校验段）；造人闸门 plugin/skills/super-agent-router/references/bootstrap.md:130-146（三条新增闸门：system_prompt 正文不含本次任务细节 / system_prompt 里不出现工作区路径 / 方法论「适用」段写能力适用场景）；机器校验 tools/member-identity-check.mjs（本轮实测跑通，见 C 组）。判定 PASS。

### B6 D-107 检查器把宿主配置字段与合规让渡句判成残留 —— PASS

按契约 S16 规则 5/6/7 校准后的实测：真实账号目录 0 命中（4.1）、改前快照仍判红 8 处（4.5）、各类夹具按新口径出结果（4.2、4.3、4.4、4.6）。判定 PASS。

## 4. C 组：成员持久身份口径（S16）

### C1 只有 description 参与判定；宿主配置字段不参与 —— PASS

命令：node tools/member-identity-check.mjs　退出码 0

原文输出（docs/audit/.tmp-verify-v0511/raw/03-mi-real-account.txt）：

```
成员持久身份口径检查（契约 S16）
名录：C:\Users\yang2\Documents\MiniMax\mini code的插件\.superagent\roster.json（8 名成员，其中 source=runtime 的 5 名）
账号成员目录：C:\Users\yang2\.minimax\agents（9 个成员：sa-aigc-text、sa-context-trace、sa-factor-validate、sa-gate-integrity、sa-image-design、sa-mechanism-fix、sa-media-pack、sa-orchestration-audit、sa-plugin-release）
>>> 成员持久身份口径检查通过（0 处残留）
```

零命中、退出码 0。

阴性观察的阳性对照：真实目录 9 个成员里，本该命中的有 3 个（sa-aigc-text、sa-image-design、sa-media-pack —— D-106 记载的三个脏成员），改前快照里这三个成员共 8 处残留（4.5）；现在 0 命中是因为它们已整改，不是检查器失灵 —— 同一检查器在改前快照上仍判红。其余 6 个成员本就不该命中。

判定区域实测：宿主配置夹具 host-config（front matter 含 defaultWorkspaceDir 盘符路径与 model 斜杠）⇒ 0 残留、退出码 0（raw/06-fixture-host-config.txt）；未知键夹具 unknown-key ⇒ 1 处 abs-path、区域标注 front-matter、退出码 1（raw/06-fixture-unknown-key.txt）；front matter 未闭合夹具 unclosed-fm ⇒ 1 处 abs-path、区域标注正文、退出码 1（raw/06-fixture-unclosed-fm.txt）。判定 PASS。

### C2 合规让渡句不算残留 —— PASS

命令：node tools/member-identity-check.mjs --agents-dir tests/fixtures/member-identity/agents/delegation --roster tests/fixtures/member-identity/roster/clean.json　退出码 0

原文输出（raw/06-fixture-delegation.txt）：

```
账号成员目录：C:\Users\yang2\Documents\MiniMax\mini code的插件\tests\fixtures\member-identity\agents\delegation（1 个成员：sa-delegation）
>>> 成员持久身份口径检查通过（0 处残留）
```

让渡句（由 brief 决定 / 由 brief 给出 / 路径随任务变）判绿、零命中。判定 PASS。

### C3 让渡句不豁免具体标识 —— PASS

命令：node tools/member-identity-check.mjs --agents-dir tests/fixtures/member-identity/agents/delegation-id --roster tests/fixtures/member-identity/roster/clean.json　退出码 1

原文输出（raw/06-fixture-delegation-id.txt）：

```
FAIL 命中 3 处任务专属残留（持久层只放通用能力，契约 S16）：
  1. <账号成员目录>/sa-delegation-id/agent.md:7
     原文：Q:\教学\人工智能导论\任务书\
     特征：abs-path · 盘符绝对路径（区域：正文）
  2. <账号成员目录>/sa-delegation-id/agent.md:7
     原文：工具\aigc_tts.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
  3. <账号成员目录>/sa-delegation-id/agent.md:7
     原文：v0.3.2
     特征：version · 版本号（区域：正文）
>>> 成员持久身份口径检查不通过（3 处残留）
```

让渡句里的盘符路径 / 带目录段相对路径 / 版本号照报。判定 PASS。

### C4 具体标识覆盖脚本类扩展名与带目录段的相对路径 —— PASS

命令：node tools/member-identity-check.mjs --agents-dir tests/fixtures/member-identity/agents/script-path --roster tests/fixtures/member-identity/roster/clean.json　退出码 1（raw/06-fixture-script-path.txt）：裸 wordcount.py 报 concrete-file；工具\ 与 工具\aigc_tts.py 报 relative-path。

真实快照扫描同样命中脚本名与带目录段相对路径（4.5 的 8 处里，wordcount.py 与 receipt.json 属 concrete-file，工具\aigc_tts.py、工具\aigc_image.py、工具\seam_check.py、工具\make_cards.py、工具\make_shortfilm.py 属 relative-path，工具\ 属 relative-path 目录形态）。判定 PASS。

### C5 检查器没被放宽：真实存量残留仍能被抓到 —— PASS

判据写法：node tools/member-identity-check.mjs --agents-dir docs/audit/.tmp-member-identity/agents-before

执行说明：该路径在只读目录 docs/audit 下，字面出现在命令里会被护栏按写通道拦下（见 1.2）。改法：先字节级复制到本单可写临时目录 docs/audit/.tmp-verify-v0511/agents-before，再扫副本。

复制对账原文输出：

```
SRC_FILES=9 DST_FILES=9 BYTE_IDENTICAL=true
sa-aigc-text\agent.md 2289 677cc2e4634abfe6b60e6b5c67a5835bfe43be6bd84fcc5b1f8ad8033700a0f9
sa-context-trace\agent.md 2054 60728ef4aeeebcac37aa4edb976cddb74c1a59c93af8b03a565a66e5f5de2feb
sa-factor-validate\agent.md 2258 6f9d3ae5879a22c6214b2142f907f2d95801a0746e49d103c8541eabfdccd5be
sa-gate-integrity\agent.md 2160 059ce48379dc7af7fbae1acc16f17ce541f52c75e9ab24d3fe83d972a227978c
sa-image-design\agent.md 2276 9cf99d8e3e7519e3c62e57a31e4c26f218ea3a5dabc05c3041411d80dbc7ca3f
sa-mechanism-fix\agent.md 2142 92f3a6e541c352535a99d857fba99ed9dfccb0476e0d170608ba4eca2e672495
sa-media-pack\agent.md 2085 13a5269be23c9c8c86ca0a1e2bb755b955129c39752069f64f75929d7fde899b
sa-orchestration-audit\agent.md 2020 c49226e1816dfcb00682e07e5b679dfce1723fee22f84b4aaf2b95e1d984a6fc
sa-plugin-release\agent.md 1533 38a2a757cf53b8a9bfa222c82d88dd6e49565b1e896438283e375845d592a238
```

扫描结果：退出码 1，命中 8 处（raw/04-mi-agents-before-copy.txt）：

```
FAIL 命中 8 处任务专属残留（持久层只放通用能力，契约 S16）：
  1. <账号成员目录>/sa-aigc-text/agent.md:21
     原文：工具\
     特征：relative-path · 带目录段的相对路径（区域：正文）
  2. <账号成员目录>/sa-aigc-text/agent.md:21
     原文：wordcount.py
     特征：concrete-file · 具体文件名（脚本 / 配置 / 文档）（区域：正文）
  3. <账号成员目录>/sa-image-design/agent.md:21
     原文：工具\aigc_image.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
  4. <账号成员目录>/sa-image-design/agent.md:21
     原文：工具\seam_check.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
  5. <账号成员目录>/sa-image-design/agent.md:21
     原文：receipt.json
     特征：concrete-file · 具体文件名（脚本 / 配置 / 文档）（区域：正文）
  6. <账号成员目录>/sa-media-pack/agent.md:21
     原文：工具\aigc_tts.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
  7. <账号成员目录>/sa-media-pack/agent.md:21
     原文：工具\make_cards.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
  8. <账号成员目录>/sa-media-pack/agent.md:21
     原文：工具\make_shortfilm.py
     特征：relative-path · 带目录段的相对路径（区域：正文）
>>> 成员持久身份口径检查不通过（8 处残留）
```

判定 PASS：命中数 > 0、退出码非 0，且逐条落到脚本名（wordcount.py、receipt.json）与带目录段的相对路径（工具\aigc_tts.py 等）⇒ 检查器没被放宽成放行一切。9 个成员里本该命中的 3 个（sa-aigc-text、sa-image-design、sa-media-pack）全部命中；另 6 个（sa-context-trace、sa-factor-validate、sa-gate-integrity、sa-mechanism-fix、sa-orchestration-audit、sa-plugin-release）本就不含残留，0 命中。

### C6 旧脏夹具仍判红 —— PASS

命令：node tools/member-identity-check.mjs --agents-dir tests/fixtures/member-identity/agents/dirty --roster tests/fixtures/member-identity/roster/clean.json　退出码 1，15 处命中（raw/06-fixture-dirty.txt）。

命中覆盖的特征 id（逐条核对原文）：project-title（《人工智能导论》）、batch-no（实验一 / 实验二 / 实验四）、one-off-wording（本次任务 / 任务书在 / 本次交付）、abs-path（Q:\教学\人工智能导论\任务书\）、numbered-file（00_共用事实底稿.md、01_实验一_文案与核查.md）、must-read-non-method（开工前必须先读 …）、version（v0.3.2）、defect-id（D-88）—— 共 8 个不同特征 id，全部报出。

口径说明（不夸大）：判据 C6 的验收方式是退出码非 0，已满足。「9 类禁止特征一条不少」若按字面理解为「本夹具要报出 9 个特征类」，实测本夹具只含并报出 8 类；特征表共 11 类，余下 3 类各有专属夹具覆盖且全绿：cn-deliverable-file（cn-file 夹具，报中文交付物文件名）、relative-path 与 concrete-file（script-path 夹具，见 C4）。11 类在整套断言里都被钉住（member-identity-test.mjs 64 条断言全绿）。故 C6 判 PASS，措辞差异记入 7 节 O3。

### C7 每条新判据都有专属断言 + 专属变异体 —— PASS

命令：node tests/fixtures/member-identity-mutation-matrix.mjs .　退出码 0

原文输出（raw/05-mi-matrix.txt，头尾节选）：

```
基线：pass=64 fail=0 exit=0
M-MIr [S16-规则5] 未知 front matter 键也跳过（把「未知键 fail-closed」改回静默放行）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
   RED MI-H13 未知 front matter 键按 fail-closed 处理（契约规则 5 末段）：未列入宿主配置表的键照常参与判定 ⇒ 路径必须报红
M-MIs [S16-规则7] 仓库自有资产豁免不区分目录段（带目录段的相对路径也被放过）：套件 pass=63 fail=1 专属锚点红=是 EXTRA-RED=0 总红数=1 判定=恰好红一条
   RED MI-H14 仓库自有资产豁免只给无目录段的裸文件名（契约规则 7 末段）：带目录段的相对路径照报
MUT-CHECK 结束：MISS=0  EXTRA-RED 合计=64
```

MISS=0（18 个变异体全部被抓住）。EXTRA-RED 合计 64（照实记）：M-MIa=29、M-MMb=23、M-MIf=1、M-MIg=1、M-MHh=2、M-MHj=1、M-MIm=2、M-MIn=3、M-MIp=2，其余 9 个变异体 EXTRA-RED=0（恰好红一条）。判定 PASS。

### C8 名录侧：created_for 是能力化表述 —— PASS

同一条真实账号目录命令同时扫了项目名录（8 名成员，其中 source=runtime 的 5 名），零命中（4.1）。

我独立核名录原文：.superagent/roster.json 里 5 个 runtime 成员的 created_for 依次为 —— 首次触发场景：插件包版本升级与发布说明产出 / 首次触发场景：编排机制判定分支的行为缺陷审计 / 首次触发场景：上下文注入与传递链路的来源盘点 / 首次触发场景：缺陷台账登记的边界判定改造 / 首次触发场景：缺陷台账登记的记录闸门与统计口径改造 —— 全部是能力化表述，无任务原文、无版本号、无批次编号、无路径。判定 PASS。

## 5. 验收方自造的三个变异体（方法要求 1：全部跑在字节级副本上，真实仓库一个字节未动）

### 5.1 A5 / D-100：折行变异体

做法：把台账索引表第 36 行（D-05 行）的收尾竖线去掉，并在其后插入一行不以竖线开头的续行 —— 即 D-96 记录的折行形态（续行不收尾竖线 ⇒ 索引表从中间断成两块）。

变异体文件：docs/audit/.tmp-verify-v0511/mutant-A5-fold-ledger.md

用现行检查器跑（raw/07-ledger-mutant-fold-fixed.txt）：

```
FAIL 台账检查 index-single-block（1 处）
       索引形状的行 D-06（第 38 行）落在索引表之外 —— 索引表被折行断开了（续行不以 | 开头 ⇒ 断点之后的条目对解析器不存在）
```

退出码 1。阳性对照：同一份变异体，把检查器改回修复前的写法（blk.start + blk.block.length）后再跑（raw/08-ledger-mutant-fold-oldbehavior.txt）：

```
PASS 台账检查 index-single-block
```

退出码 1（sets-equal 仍报 108 处，那是折行本身造成的连带效应，不是本条检查）。两条合起来说明：这条检查此前确为死代码（折行也不报），现修复后折行必红。判定 PASS。

### 5.2 D-108（MI-H13 ↔ M-MIr）：未知键 fail-closed 回退

做法：把 tests/ tools/ plugin/ 三目录字节级复制到 docs/audit/.tmp-verify-v0511/mbase2，在副本的 tools/member-identity-check.mjs 上把 regionForKey 的宿主配置判定改成「除 description 外一律按宿主配置跳过」（即把未知键改回 fail-open）：

- 原：if (isHostConfigKey(k)) return 'host-config';
- 改为：if (k !== 'description') return 'host-config';

结果（raw/11-mutant-D108-unknown-key.txt）：

```
BASELINE exit=0 pass=64 fail=0
D108 exit=1 pass=63 fail=1
   RED FAIL MI-H13 未知 front matter 键按 fail-closed 处理（契约规则 5 末段）：未列入宿主配置表的键照常参与判定 ⇒ 路径必须报红 :: []
RESTORED exit=0 pass=64 fail=0
```

恰好红一条，且就是 MI-H13；还原后恢复全绿。判定 PASS。

### 5.3 D-109（MI-H14 ↔ M-MIs）：仓库自有资产豁免去掉无目录段限定

做法：同一副本机制，把 isBareFileName 的返回语句改回无差别放行（去掉「无目录段」限定）：

```
ORIGINAL_SNIPPET=[export function isBareFileName(text) {
  return !/[\\/]/.test(String(text || ''));]
```

结果（raw/12-mutant-D109-bare-filename.txt）：

```
D109 exit=1 pass=63 fail=1
   RED FAIL MI-H14 仓库自有资产豁免只给无目录段的裸文件名（契约规则 7 末段）：带目录段的相对路径照报 :: []
RESTORED exit=0 pass=64 fail=0
```

恰好红一条，且就是 MI-H14；还原后恢复全绿。D-109 还要求确认两条对偶事实，我用夹具直接验了（raw/06-fixture-repo-asset.txt 与 raw/06-fixture-repo-asset-path.txt）：裸 lib.mjs（仓库里确有同名文件）⇒ 0 残留、退出码 0（仍豁免）；带目录段的 工具\contract.md ⇒ 1 处 relative-path、退出码 1（照报）。判定 PASS。

## 6. D 组：诚实边界（照录，未越界）

判据 D 组列了 5 条本轮不可宣称的内容。本报告逐条照录，并逐条自检有没有写出超出的断言。

1. 检查器是词法级判据（特征 → 正则），只保证「已知的这几类残留一定被报出来」，不保证「持久层里一定没有任务内容」；用别的说法指代同一个项目查不出来。
2. 检查器只覆盖本机已存在的成员文件；账号目录不可用时只查名录（退出码 0，但结论行明写「账号级未检查」）。
3. defaultWorkspaceDir 把成员钉在哪个项目属于项目归属问题，S16 不判它 —— 一个专为一单建的成员仍可能带着那一单的工作目录。
4. 新建成员时提示词写没写对，仍由建员者与独立验收把关（机器校验管不了还没建出来的成员）。
5. 本批没有取到新的活体 hook 拦截证据；活体证据仍只有 D-97 那一轮（内层 bash 重复调用形态）。

本报告的自我核对（逐条）：

- 未写「持久层一定没有任务内容」；4.1 的结论只表述为「本次扫描 0 处残留」。
- 未写「活体拦截已验证」；本轮未取活体证据，B2 只核了 hooks.json 的 matcher 与回归断言。
- 未把 defaultWorkspaceDir 说成已判；4.1 只说它按规则 5 不参与残留判定，并按第 3 条明确它属项目归属问题、S16 不判。
- 未把「账号目录不可用时的行为」写成实测；该形态只由夹具 MI-F1~MI-F5 覆盖（套件全绿），未在真机复现（见 U2）。
- 未把「新建成员时的提示词写法」说成机器可管。

## 7. 附加观察（非判据项，不改变上表判定）

O1 护栏对 node 的分流口径：本单初始 SCOPE 为只读时，连「执行只读校验脚本」都会被判越界（node 不在只读命令白名单；白名单与判定见 plugin/scripts/lib.mjs 的 READ_ONLY_COMMANDS 与 isReadOnlyCommand）。这不是本批次的产品缺陷（契约 S3 的口径是按命令意图分流），但它使「只读 scope 下无法跑校验」成为现实约束，已由父会话扩权解决。

O2 判据清单文件里的两个数字已过期：docs/audit/.tmp-member-identity/acceptance-criteria.md 第 6 行写「16 套 / 1027 条」、第 7 行写「总计 111 条」；我的实测是 16 套 / 1046 条断言（比 1027 多 19 条，来自 D-108 / D-109 的新增断言）与 113 条台账。本报告采用实测值。

O3 「9 类禁止特征」的措辞与实测差一层（详见 C6）：脏夹具报出 8 个特征 id；特征表共 11 类，其余 3 类由 cn-file 与 script-path 专属夹具覆盖且全绿。判据 C6 的验收方式（退出码非 0）满足。

O4 检查器有两处判据项超出契约字面列举，均落在契约「这类」的开集表述内，且没有在仓库别处另存第二份判据：DELEGATION_MARKERS 的 by-dispatch-decide（由派工决定，契约规则 6 的例句只列了 brief 三种）；PATH_EXEMPTIONS 的 wildcard-pattern（通配形态，契约规则 7 未逐字列举）。契约机器校验段（contract.md:888-892）把判据表指向 tools/member-identity-check.mjs，该文件内的四张表（FEATURE_SPECS / HOST_CONFIG_KEYS / DELEGATION_MARKERS / PATH_EXEMPTIONS）是同一份判据的四个侧面。

O5 回归套件不写真实变更账：git diff --stat 在「跑完全部 16 套之前」与「跑完之后」两次完全一致（.superagent/changes.log 均为 3 insertions），说明本轮回归没有往真实变更账追加假记录（与 D-64 同族的污染未复发）。需要说明两点：该文件在本次验收开始时的 git status 里未显示改动、父会话扩权留痕后变成 3 insertions，二者时间顺序与我的执行不冲突；且该文件在私有目录内，我的 scope 只给了只读的名录文件，故我未读取其内容，只用了 git 的机械统计。

## 8. 本轮未能验证的面（逐条）

U1 账号级成员目录的写入权限与建员链路：本单只读该目录（扫描），没有验证宿主是否允许新建 ~/.minimax/agents/<名>/agent.md，也没有验证成员创建命令的实际行为。

U2 账号目录不可用时的形态：本轮账号目录可用，MI-F1~MI-F5（账号目录不存在 ⇒ 退出码 0 且结论行写「账号级未检查」）只在夹具层验证过，未在真机复现；别的机器 / CI 上的实际输出未验。

U3 非本机环境：全部实测都在 Windows + PowerShell + 本机账号目录下完成；别的操作系统、CI runner、以及路径形态差异下的行为未验。

U4 宿主侧行为：hook 是否真把 task_output / task_query / task_stop 派发到 guard、宿主 matcher 是否按精确等值匹配，只核了 plugin/hooks/hooks.json 的配置与回归断言，没有活体拦截证据。

U5 活体 hook 拦截：本批次没有取到新的活体证据，活体证据仍只有 D-97 那一轮；本报告不主张活体已验证，也不把「回放正确」写成「活体已验证」。

U6 新建成员的提示词写法：机器校验管不了还没建出来的成员；本轮只验证了「已存在的成员文件」与「项目名录」两个持久层。

U7 词法级判据的完备性：检查器只保证已知的特征类被报出来，不保证持久层里没有用别的措辞写的任务内容（契约 S16 诚实边界第 1 条）。

## 9. 附录：本次验收的产物与仓库未被改动的机械证据

9.1 产物（全部写在 docs/audit/.tmp-verify-v0511/ 下）

- verification-v0511.md —— 本报告。
- raw/ —— 25 个文件，每份含 CMD 行、EXIT 与命令原始输出。
- agents-before/ —— 改前快照的字节级副本（9 个文件，与源文件 sha256 逐一相同）。
- mutant-A5-fold-ledger.md —— 我自造的折行变异体（台账字节副本 + 折行）。
- ledger-check-D100-oldbehavior.mjs —— 把 index-single-block 修复前写法放进副本的检查器。
- mbase2/ —— tests/ tools/ plugin/ 的字节级副本，D-108 / D-109 变异体在其上施加。

9.2 仓库未被改动的机械证据

- 验收开始与结束时的 git status --short 列表对照：tools/ tests/ plugin/ 三个目录下的条目完全相同（10 个已改文件 + 9 个未跟踪新文件），无新增、无删除；唯一新增的改动是 .superagent/changes.log，出现在父会话扩权留痕之后，与我的执行无关（O5 已用 diffstat 对账）。
- 全部变异体都跑在副本上（docs/audit/.tmp-verify-v0511/mbase2 与系统临时目录），真实仓库的 tools/member-identity-check.mjs、tests/member-identity-test.mjs、docs/audit/defect-ledger.md 一个字节未动。

9.3 判定结论

A 组 5/5 PASS；B 组 4/4 PASS；C 组 8/8 PASS；D 组 5 条诚实边界照录且未越界。总判定：PASS。

台账里 D-107 / D-108 / D-109 三条当前状态仍是「待复核」——按台账自己的口径，需由父会话收口时转「已修」；本单是验收不改台账（FORBID），故三条状态保持原样，本报告不改写它们。
