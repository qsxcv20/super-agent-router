# D-75 修复报告：管理员批准「只读条目上的写请求」时的显式升级留痕

## 0. 结论

D-75 的实质是**静默升级**：管理员 `--grant` 批准一个落在只读条目（`ro:`）上的写请求时，
授权从「只读」被升级为「可写」，但回执与变更账都看不出发生过升级。
修复后：升级**仍然被允许**（保留能力不堵死），但升级必须在**回执**与**变更账**两处
显式留痕，并指认**来源只读条目**；读请求仍然只授读。

## 1. 缺陷复现（改前）

前置：项目内存在只读条目 `ro: docs/other.md`；会话请求写 `docs/other.md`。

复现步骤（改前副本由 `docs/audit/.tmp-d75/make-before.mjs` 生成，
即「工作树现状只回退 D-75 的显式化」，其余实现保持现状）：

    node docs/audit/.tmp-d75/make-before.mjs
    node docs/audit/.tmp-d75/probe-ba.mjs

改前回执（原始输出节选）：

    upgraded_paths: []
    upgraded_from_readonly: []
    upgrade_notice: ""

改前变更账行：

    ... | grant req_... | by mvs_parent | + docs/other.md

对照契约：S2 规定 `ro:` 条目永不授写（升级需显式批准）；S13.2 第 2 条要求
「只读→可写」的升级必须显式留痕。改前两者都没发生——批准生效了，账上看不出来。

## 2. 口径（父会话定死，本单逐条落地）

| # | 口径 | 落地位置 | 钉住它的断言 |
|---|---|---|---|
| ① | 管理员批准即授权升级，保留能力不堵死 | `grantScopeRequest` 不拦截升级路径 | 升级成功路径断言 |
| ② | 升级必须显式：回执 + 变更账都写明「只读→可写」并指出来源只读条目 | `scope-amend.mjs` `--grant` / `--dispatch --add` 两分支 | 回执字段断言 + 变更账行断言（变异体 M-D75b/M-D75c 分别单独回退一处） |
| ③ | 读请求仍然只授读（契约 S13.2 第 1 条） | `grantScopeRequest` 按 `req.mode` 分流 | 读请求写仍被拦断言 |
| ④ | `--dispatch --add` 直接加条目路同样适用第 2 条，冲突/重复要显式说明 | `--dispatch --add` 分支 + `duplicate_paths` | 冲突/重复显式说明断言 |

## 3. 改动清单

| 文件 | 改动 | 对应断言 |
|---|---|---|
| `plugin/scripts/lib.mjs` | 新增 `readOnlyScopeHit()`（D-40 分型判定）、`canonicalPathKey()`、`canonicalScopeEntries()`、`readonlyEntryCovering()`、`writableEntryGranting()`、`detectReadonlyUpgrades()`；`grantScopeRequest()` 记录 `upgraded_paths` / `upgraded_from_readonly` / `duplicate_paths` | 第 15 节起 D-75 断言段 + 本单新增的别名/去重断言 |
| `plugin/scripts/lib.mjs` | **本单补**：路径写法归一（`canonicalPathKey` / `canonicalScopeEntries`），升级检测在归一后的条目上判定，去重键按归一路径 | 别名写法升级仍被认出；同一文件不同写法只报一条 |
| `plugin/scripts/scope-amend.mjs` | `--grant` 与 `--dispatch --add` 两分支输出升级字段并写变更账升级标注；**本单补**：`note` 字段恢复原文（升级信息只走新增字段，不改既有字段语义）；新增 `audit_logged` 字段并接住 `appendChangeLog()` 返回值 | 回执含 `audit_logged` 且变更账写成功时为 `true` |
| `tests/scope-amend-test.mjs` | D-75 断言段；**本单补** 5 条断言；变异工装（`SAR_MUTATION_D75=1`）；修掉一处既有崩溃点（`JSON.stringify(ad2.out.duplicate_paths).slice(...)` 在字段缺失时抛 TypeError，已改 `|| []`） | 92 → 97 PASS |

## 4. 改后原始输出

改后回执（原始输出节选）：

    upgraded_paths: ["docs/other.md"]
    upgraded_from_readonly: [{path: "docs/other.md",
 from_entry: "ro: docs/other.md",
                               to_entry: "docs/other.md"}]
    upgrade_notice: "本次批准把 docs/other.md 从只读条目升级为可写（来源只读条目：ro: docs/other.md）"

改后变更账行：

    ... | + docs/other.md | upgrade readonly -> writable: docs/other.md (from: ro: docs/other.md)

## 5. 变异矩阵

复跑命令（原样可跑）：

    $env:SAR_MUTATION_D75='1'; $env:SAR_REPO_DIR='.'; node tests/scope-amend-test.mjs
    # 期望结尾：>>> D75 MUTATION MATRIX OK

工装做法与 e2e 一致：插件副本装到系统临时目录 → 在**副本**上回退实现 → 跑目标断言 →
目标断言必须转红；仓库工作树零改动，跑完即删。

| 变异体 | 回退了什么 | 转红断言数 | 仍为绿者证明什么 |
|---|---|---|---|
| M-D75a | 整体回退「升级显式化」（`detectReadonlyUpgrades` 直接返回空） | 12 | — |
| M-D75b | 只回退**变更账**升级标注（回执不动） | 3 | 回执断言仍绿 ⇒ 两处留痕各自被独立钉住 |
| M-D75c | 只回退**回执**升级字段（变更账不动） | 8 | 变更账断言仍绿 ⇒ 同上，另一侧亦独立 |
| M-D75d | 回退路径写法归一 | 2 | — |

**归属**：本变异体最终由 `tests/e2e-test.mjs` 的下一位独占者归并进 `SAR_MUTATION=1` 总矩阵；
本单因 `tests/e2e-test.mjs` 归 D-72 独占（双 writer 会撞车），先在专属套件
`tests/scope-amend-test.mjs` 里自证，开关独立为 `SAR_MUTATION_D75=1`，不并入总矩阵。

## 6. 回归结果

    node tools/run-tests.mjs scope-amend-test --root plugin --repo .   # 97 PASS / 0 FAIL
    node tools/run-tests.mjs --all --root plugin --repo .              # 11 套 0 FAIL / 712 断言

逐套：chain 70 / d27-mut 14 / dispatch-release 33 / e2e 53 / guard 228 / hooks 29 /
lessons 65 / records 52 / roster 38 / scope-amend 97 / scope 33。
并发成员的 roster / e2e / chain 套件无污染。

## 7. 新发现缺陷（模板出处：条目模板见 contract.md 第一节 S1）

### N-01 路径写法别名逃逸只读升级检测
- 判定分支：只读升级检测（`detectReadonlyUpgrades` 原按路径写法逐字比较）
- 触发条件：只读条目写作 `ro: docs/other.md`，请求路径写作 `./docs/other.md` 或 `docs//other.md`
- 复现：批准该写请求 →授权确已升级为可写 → 回执 `upgraded_paths` 为空、变更账无升级标注
- 影响：升级再次静默，D-75 同类缺陷以「路径别名」形态复现
- 证据：`docs/audit/.tmp-d75/probe-forms.mjs` 探针输出（修复前 `./` 与 `//` 写法不命中、修复后命中；同串与反斜杠写法前后均命中）
- 处置：本单已修（`canonicalPathKey` / `canonicalScopeEntries`）；变更账去重键同步改为归一路径，避免同一文件不同写法重复记账

### N-02 变更账写失败被静默吞掉
- 判定分支：回执生成（`appendChangeLog()` 返回值被丢弃/未用）
- 触发条件：变更账写入失败（权限/磁盘/路径问题）而批准本身成功
- 复现：批准生效但账上无痕，回执无任何提示 → 读回执者以为「已记账」
- 影响：口径②的「变更账必须写明」在写失败时静默失效，等价于静默放行
- 证据：本单改动前 `scope-amend.mjs` 两分支均未使用 `appendChangeLog()` 返回值
- 处置：本单已修（回执新增 `audit_logged: boolean`，`--grant` 与 `--dispatch --add` 两处都接住返回值）

## 8. 残余风险与未覆盖

1. `canonicalPathKey` **不解析 `..`**：故意不解析，避免把 `../x` 与 `x` 误判成同一文件
   （把不存在的升级写进回执，比漏写更危险）。
2. 归一只用于**升级检测**，授权语义仍走 `inScope` / `readOnlyScopeHit`，未另起一套匹配口径。
3. 变更账写失败时**批准不回滚**（避免半回滚），仅回执报 `audit_logged: false`；
   此时回执与账本可能不一致，需人工看 `audit_logged`。
4. 覆盖面有限：只覆盖 `scope-amend.mjs` 的 `--grant` 与 `--dispatch --add` 两条路径；
   其它写路径（record-gate / lessons-gate / records 等）不在本单范围。
5. `.tmp-d75/` 被 `.gitignore` 的 `docs/audit/.tmp-*/` 忽略，只放一次性探针，
   **不可**作为变异工装的唯一载体；工装本体在 `tests/scope-amend-test.mjs`（随仓库走）。
6. 审计账污染自查：所有测试与探针均显式传 `MINIMAX_PROJECT_DIR` / `PLUGIN_DATA` 指向系统临时目录，
   未向真实项目变更账写入（D-64）。

## 9. 需要父会话处理的事

1. `docs/audit/defect-ledger.md`：更新 D-75 状态；收录 N-01 / N-02（字段名请按契约 S1 逐字对齐）。
2. `plugin/CHANGELOG.md` 与版本号同步。
3. 部署、安装副本与运行时缓存树同步。
4. 变异矩阵归并进 `SAR_MUTATION=1` 总矩阵（由 `tests/e2e-test.mjs` 的下一位独占者执行）。

## 10. 接手说明

- **上一位成员留下了什么**：`lib.mjs` 的升级检测族（`readOnlyScopeHit` /
  `readonlyEntryCovering` / `writableEntryGranting` / `detectReadonlyUpgrades`）、
  `grantScopeRequest()` 的升级痕迹字段、`scope-amend.mjs` 两分支的回执与变更账输出、
  `tests/scope-amend-test.mjs` 第 15 节起的 D-75 断言段。方向正确，四条口径基本满足，
  **予以保留为主，未回退重写**。
- **本单补的三个洞**：
  1. **回执既有字段语义被改写**：升级文案原先被追加进 `note` 字段，违反「加字段、不改既有字段语义」
     → `note` 复原为原文，升级信息只走新增字段。
  2. **变更账写失败被静默吞掉**：两分支的 `appendChangeLog()` 返回值原先丢弃     → 回执新增 `audit_logged`，写失败必须报出，不静默。
  3. **路径写法别名逃逸升级检测**（真洞）：`./docs/other.md`、`docs//other.md` 与
     `ro: docs/other.md` 比不上 → 升级静默 → 新增 `canonicalPathKey` /
     `canonicalScopeEntries`，在归一后的条目上判定（仍复用 `inScope` / `readOnlyScopeHit`）。
- **为什么不用 git HEAD 当「改前」基线**：HEAD 早于 `ro:` 条目那一轮，拿它当基线量出的是
  「`ro:` 根本不被识别」，会把别人的缺陷混进本单证据。改用「工作树现状只回退 D-75 显式化」
  的副本作为改前基线。
- **为什么不动 `tests/e2e-test.mjs`**：父会话后补的所有权约束（该文件归 D-72 watchdog 独占，
  双 writer 会撞车），故变异工装落在本单专属套件并用独立开关。
- **本单顺手修的既有缺陷**：`tests/scope-amend-test.mjs` 中
  `JSON.stringify(ad2.out.duplicate_paths).slice(...)` 在字段缺失时抛 TypeError（会让套件崩溃），
  已改 `|| []`。

## 11. 复跑清单

    node tools/run-tests.mjs scope-amend-test --root plugin --repo .
    node tools/run-tests.mjs --all --root plugin --repo .
    $env:SAR_MUTATION_D75='1'; $env:SAR_REPO_DIR='.'; node tests/scope-amend-test.mjs
    node docs/audit/.tmp-d75/make-before.mjs
    node docs/audit/.tmp-d75/probe-ba.mjs
    node docs/audit/.tmp-d75/probe-forms.mjs
