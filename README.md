# super-agent-router

把「会话」当系统：**路由 → 组队 → 派工 → 验收 → 复盘** 五段闭环。

受 DeepSeek 2026-10-31 公开的 Super-agent 架构启发，在 MiniMax Code 上落地。
核心不是「多智能体并行」，而是 **授权模型 + 降噪机制 + 纪律代码化**。

---

## 这是什么

一个 MiniMax Code 插件 + 一套项目状态层：

- **插件包**（`plugin/`）：协议、Hook、可执行纪律。装到 `~/.minimax/plugins/` 即可用。
- **项目状态层**（`.superagent/`）：专项名录、方法论、错题本。每个项目各一份。

装好之后，任务来了会自动走编排流程：

```
任务到来
  ├─ 能直做？ ────────────→ 直接做（默认 0 个成员，不组队）
  └─ 需要编排
      ├─ 读专项名录 + 查成员列表，交叉核对
      ├─ 匹配专精成员 → 复用 / 现场配置新的
      │    └─ 实战记录作为「该派给谁」的参考注入
      ├─ 组队（scope 不重叠 + 职责正交）
      ├─ 派工（scope 白名单 + 验收标准 + 历史教训 + 履历）
      ├─ 独立 verifier 验收（worker 自述不算）
      │    └─ 验收通过 → 给该成员记一条实战记录
      └─ 复盘 → 错题本 → 下次派工自动前置
```

## 四个关键设计

### 1. 成员是运行时长出来的，不是预置的

插件包里**没有任何业务专项**。专项成员在任务真正需要它时才现场配置，
用完留在名录里供下次复用。

因为本机 `agent create` 无法绑定技能，方法论必须落成项目文件
`.superagent/methods/<name>.md`，由 system_prompt 指向它 ——
这让方法论能**按当前任务现场派生**，而不是预置的假想场景。

### 2. 纪律必须落在代码里，不能只写在文档里

本项目实测踩过的坑：文档里禁了 `sa-data-analyst` 这种泛词命名，
但代码的正则放行了它。模型会绕过提示词里的君子协定。

所以造人纪律和错题本纪律都由脚本强制：

| 纪律 | 强制者 |
|---|---|
| 方法论没写就不许建成员 | `plugin/scripts/roster.mjs` |
| 命名不得含泛词、不得撞内置名、不得重复 | `plugin/scripts/roster.mjs` |
| 错题本类型必须是四类重大错误 | `plugin/scripts/lessons-gate.mjs` |
| 归因甩锅给 Router 则拒 | `plugin/scripts/lessons-gate.mjs` |
| 缺「下次派工」或写成感想则拒 | `plugin/scripts/lessons-gate.mjs` |
| 履历缺证据 / 缺验收人则拒 | `plugin/scripts/record-gate.mjs` |
| **执行者不可自证**（验收人 ≠ 执行人） | `plugin/scripts/record-gate.mjs` |
| 越界写入直接 deny | `plugin/scripts/guard.mjs`（Hook） |
| 删成员/改配置/部署上线一律拦 | `plugin/scripts/guard.mjs`（Hook） |

### 3. Scope 三档：写严格 / 读宽松 / 危险一律拦

派工时声明的 `SCOPE` 是可拦截的硬边界，不是建议。

| 类别 | 工具 | 判定 |
|---|---|---|
| 写 | write/edit/bash | 严格：精确落在白名单内 |
| 读 | read/glob/grep | 宽松：允许读 scope 所在目录树 |
| 危险 | agent delete/update、部署、发布 | 一律拦，不论有没有 scope |

**只约束派工产生的 worker，主会话不受影响。**

### 4. 失败记错题本，成功记履历 —— 两端闭环

单记一边都不成立：只记失败，成员不知道自己强在哪；只记成功，成员不知道自己弱在哪。

| | 错题本 | 实战记录（履历） |
|---|---|---|
| 记什么 | 栽过哪（失败） | 做成过什么（成功） |
| 何时读 | 派工时前置给 Worker | 匹配时给 Router 参考 |
| 谁触发 | 复盘归因 | **验收通过后** |
| 作用 | 下次别再栽 | 下次派得更准 |

履历写在成员方法论文件的「实战记录」段，不另开目录 ——
Worker 读方法论时自然看到上次怎么做的，且方法论与履历同生共死。

**履历只作参考，绝不自动改写 `roster.json` 的 `owns`。**
归属声明是人工可审计的资产，让模型根据战绩自行收窄等于让系统自己给自己发权限。
想收窄归属，由人改 `roster.json`，走 git 记录。

---

## 安装

### 普通使用者

```bash
# 1. 复制插件包
cp -r plugin ~/.minimax/plugins/super-agent-router

# 2. 复制项目状态层到你的工作区
cp -r .superagent <你的项目目录>/.superagent
```

Windows:

```powershell
Copy-Item -Recurse plugin "$env:USERPROFILE\.minimax\plugins\super-agent-router"
Copy-Item -Recurse .superagent "<你的项目目录>\.superagent"
```

MCode 会自动扫描本地插件目录，无需重启。

### 开发者

```bash
node tools/run-tests.mjs --all --root plugin --repo .   # 十一套全跑（仓库副本）
node tools/run-tests.mjs --all --repo .                  # 十一套全跑（安装副本）
node tools/run-tests.mjs scope-amend-test --repo .       # 单跑一套
```

单套也可以直接跑：

```bash
node tests/e2e-test.mjs      # Hook 契约
node tests/roster-test.mjs   # 造人纪律
node tests/lessons-test.mjs  # 错题本纪律
node tests/guard-test.mjs    # 越界判定
node tests/scope-test.mjs    # 作用域边界
node tests/records-test.mjs  # 履历机制
node tests/scope-amend-test.mjs  # 权限自动审核与等级
```

---

## 目录结构

```
.
├── plugin/                      # 插件包（复制到 ~/.minimax/plugins/）
│   ├── .minimax-plugin/plugin.json
│   ├── hooks/hooks.json          # 7 个 handler（含 SessionStart）
│   ├── scripts/                  # 13 个脚本，纪律的执行者
│   └── skills/super-agent-router/
│       ├── SKILL.md              # Router 协议 + 铁律
│       └── references/           # teams routing brief bootstrap review scope records
│
├── .superagent/                 # 项目状态层（每个项目各一份；成员的私有记忆）
│   ├── roster.json               # 专项名录 + 权限等级（路由的唯一依据）
│   ├── methods/                  # 专项方法论 + 实战记录（运行时现场写）
│   ├── lessons/                  # 错题本（每成员一份）
│   ├── incidents/                # L0 原始事故
│   ├── changes.log               # 自动改动留痕（含提权留痕）
│   ├── agent-snapshots/          # 改 prompt 前的快照
│   └── STATUS.md                 # 项目当前状态
│
├── tests/                       # 十一套回归测试（项目资产，不是私有记忆）
│   └── *-test.mjs
│
├── tools/                       # 工装
│   ├── run-tests.mjs             # 验收工装（自动发现 tests/*-test.mjs）
│   ├── deploy-plugin.mjs         # 部署到安装目录
│   ├── sync-github.mjs           # 同步到 GitHub
│   └── verify-github.mjs         # 逐文件核对远端内容
│
├── docs/audit/                  # 独立验收与专项审计报告
│
└── README.md
```

---

## 怎么用

### 1. 直接提任务就行

插件会自己判断该不该编排。普通问题静默放行，零干扰。

### 2. 编排型请求长这样

> 这个需求拆成两个任务并行做，谁来负责？

### 3. 先确认 Hook 生效（重要）

插件的 Hook **按会话激活**。安装或更新插件后，**必须新开一个会话**，
否则本会话里 Hook 不会触发。

新会话里提一句编排型请求，例如：

> 这个需求拆成两个任务并行做，谁来负责？

看到出现 `[super-agent-router] 本轮按编排流程处理` 就说明 Hook 通了。
如果没出现，检查：

```bash
# 看 Hook 有没有真的跑过（dispatch 会写台账）
ls ~/.minimax/v2/plugin-data/hooks/super-agent-router/

# 手工验证单个 Hook
node -e "process.stdin.pipe(process.stdout)" | echo '{"hook_event_name":"SessionStart","source":"startup"}' | node ~/.minimax/plugins/super-agent-router/scripts/session-start.mjs
```

### 4. 派工时 scope 要写具体路径

```markdown
SCOPE: src/auth/login.ts, src/auth/session.ts
GOAL: 修复登录请求超时后未正确清理连接
ACCEPT:
- [ ] 超时路径下连接被显式释放
EVIDENCE:
- 改动文件路径与测试输出
```

目录要写成 `src/auth/`（带斜杠）才涵盖其下所有文件；
写成 `src/auth/login.ts` 就只匹配这一个文件。

### 4. 验收通过后记一条履历

```bash
node plugin/scripts/record-gate.mjs '{
  "agent": "sa-chart-plot",
  "task": "月度对比图",
  "domain": "图表绘制",
  "approach": "先回显生效筛选条件，再出图并把口径写进图注",
  "evidence": "output/monthly.png，由 verifier 比对口径确认",
  "verified_by": "verifier"
}'
```

---

## 已知边界

- 外部事件触发（GitHub / 飞书 / CI）未接
- 主动接活（cron 巡检）未做
- 读操作宽松到「scope 所在目录树」，比写严格
- 危险操作一律拦，若要开口子需专门改 guard

---

## 参考

DeepSeek Harness 团队《Super-agent 设计探索：迈向更自主的 Agent 系统》
（2026-10-31），及 `deepseek-ai/dsh-superagent-prototype`（MIT）。

本项目是受其启发的独立实现，不依赖 DeepSeek 的代码。
