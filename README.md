# super-agent-router

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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

### 一键安装（推荐）

需要 **Windows + PowerShell 5.1 或更高**（脚本在 PS 5.1 上实测过）。

```powershell
# 1. 克隆仓库
git clone https://github.com/qsxcv20/super-agent-router.git
cd super-agent-router

# 2. 一条命令安装
powershell -ExecutionPolicy Bypass -File .\install.ps1

# 3. 新开一个会话 —— Hook 按会话激活，不新开不生效
```

脚本按固定顺序做这些事，**任何一步不通过就非零退出、不装一半**：

1. 检查 `node` 在不在（Hook 全靠 node 驱动）
2. 校验源包：`plugin.json` 在不在、`name` 与安装目录名是否一致、`hooks.json` 引用的每个脚本是否都存在
3. 装到 `%USERPROFILE%\.minimax\plugins\super-agent-router\`
   - 目标已存在且版本相同 → 报「已是最新」，**不重装**
   - 目标已存在且版本不同 → 先整份备份到 `.backup\super-agent-router-<时间戳>\`，再装新版
4. 装完用**文件数 + SHA256 逐文件比对**复核副本与源是否一致

常用参数：

```powershell
# 换个安装根目录
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Target "D:\minimax-plugins"

# 顺便给某个项目播种一份状态层（.superagent）
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Project "D:\my-project"

# 只校验不安装：一个字节都不写
powershell -ExecutionPolicy Bypass -File .\install.ps1 -VerifyOnly
```

`-Project` 播种的是**空名录**（`roster.json` 的 `members` 是空数组，默认 0 个成员）加上**四个**模板文件：
`methods/_TEMPLATE.md`、`lessons/_TEMPLATE.md`、`incidents/_TEMPLATE.md`、`agent-snapshots/_README.md`
（外加一份 `STATUS.md` 和一个空的 `changes.log`）。
**不会**把本仓库的成员、方法论、错题本复制给你 —— 那些是本项目的私有记忆。
已存在的文件一律不覆盖（你的数据优先）。

装完**必须新开一个会话**，然后提一句编排型请求，看到注入里出现 `[super-agent-router]` 就说明通了。

路径参数（`-Target` / `-Project`）或家目录名若含**尾随空白**，脚本会**报错退出、不做任何改动** ——
尾随空格是路径身份的一部分，被静默裁掉的话，脚本会作用到**另一个**目录。

### 备选：手工复制

没有 Windows，或想自己控制文件位置时，手工复制同样有效：

```bash
# 复制插件包
cp -r plugin ~/.minimax/plugins/super-agent-router
```

Windows:

```powershell
Copy-Item -Recurse plugin "$env:USERPROFILE\.minimax\plugins\super-agent-router"
```

MCode 会自动扫描本地插件目录，无需重启。

项目状态层（`.superagent`）建议用 `install.ps1 -Project` 播种 —— 它只放**空名录 + 四个模板**，
不会把本仓库的成员方法论与错题本带过去。

若坚持手工复制整份 `.superagent`，复制后**必须清干净**下面这些，否则会把本项目的私有记忆带给第三方：

| 要处理的 | 处理方式 |
|---|---|
| `roster.json` | **删掉** —— 里面有本项目的成员名录（owns / accepts / reject / 提权留痕） |
| `STATUS.md` | **删掉** —— 本项目的当前状态与作业规则 |
| `changes.log` | **删掉** —— 本项目的改动留痕 |
| `methods/` | 只留 `_TEMPLATE.md`，其余删掉 |
| `lessons/` | 只留 `_TEMPLATE.md`，其余删掉 |
| `incidents/` | 只留 `_TEMPLATE.md`，其余删掉 |
| `agent-snapshots/` | 只留 `_README.md`，其余删掉 |

（或者干脆自己手写一个 `roster.json`，`members` 写成空数组 `[]`。）

手工复制**没有**幂等与备份（重复执行直接覆盖），需要这两项就用一键安装。

### 开发者

```bash
node tools/run-tests.mjs --all --root plugin --repo .   # 十三套全跑（仓库副本）
node tools/run-tests.mjs --all --repo .                  # 十三套全跑（安装副本）
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

#### 怎么复跑安装脚本的自测

`install.ps1` / `uninstall.ps1` 的行为断言在 `tools/install-selftest/` 里，**一条命令复跑全部套件**：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-selftest\run-all.ps1
```

| 套件 | 覆盖 | 断言条数 |
|---|---|---|
| `sandbox-test.ps1` | 安装 / 卸载 / 幂等 / 备份 / 播种 / 哈希自校验（沙箱实跑） | 41 |
| `sandbox-test2.ps1` | 跨插件目录保护、`-Purge` 不误伤同级目录、**错目标零删除**、**尾随反斜杠**装卸、**畸形命令行零副作用** | 44 |
| `trailing-space-test.mjs` | **尾随空格路径身份**（构造「同名只差尾随空格」的兄弟根；断言必须命中守卫消息） | 39 |
| `verify-seed.mjs` | 播种内容与安装副本的逐字节校验 | 21 |
| `check-readme-consistency.mjs` | 本文件与脚本的参数 / 口径逐字对账（含条数声明的防漂检查） | 131 |
| `run-all-exit-code-test.mjs` | **自检红 ⇒ 退出码非 0 且横幅不许说谎**（X1 的钉子：真跑一份 run-all.ps1 副本，篡改头部触发红 + 撞名变异对照） | 18 |
| `run-all.ps1` | 上面各套件的**一条命令入口**：逐套件核对条数、汇总退出码与横幅 | 8 |

自测的**退出码可信**：自检里有红 ⇒ 退出码非 0、横幅不会说「全部通过」。
（`run-all-exit-code-test.mjs` 会真跑一份 run-all.ps1 副本、把它逼红来验这件事，不是只比对源码文字。）

注意：**这套自测仅在 Windows 上跑**（依赖 `powershell` + PowerShell 5.1）。
自测对**路径形态无要求**：仓库路径 / 沙箱路径含空格或含中文都能跑 ——
需要传「末尾带反斜杠」的路径时，用 `-Command` 把参数整体留在子进程里、参数值用单引号包住，
参数原样到达，不受 Windows 命令行引号规则影响。
沙箱建在 `%TEMP%` 下，**不在仓库里**；运行时会把 `%USERPROFILE%` 重定向到沙箱内的假家目录，
所以**真实安装目录与真实运行时台账不会被碰到**。

---

## 卸载

```powershell
# 默认：移到 .trash\，可恢复（后悔了搬回去就行）
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

# 彻底删除插件目录
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge

# 连运行时台账一起清
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge -PurgeData
```

要点：

- 默认**不删**：插件目录被移到 `%USERPROFILE%\.minimax\plugins\.trash\super-agent-router-<时间戳>\`，脚本会打印位置和「怎么彻底删」
- `-Purge` 才真删。删前脚本做**两层核对**：
  - **路径级（结构自检，不构成独立验证）** —— 末段必须是 `super-agent-router`、目标必须在安装根之下。
    这一层的期望值与被检值同源（都是脚本自己拼出来的），只防实现层面的错位，**挡不住「作用到了别的目录」**。
  - **内容级（唯一有牙齿的一条）** —— 读目标目录的 `.minimax-plugin\plugin.json` 核对 `name`，
    确认它**真的是本插件目录**。只要作用到了别的目录（别的插件 / 没有 manifest / 名字不符），
    一律**非零退出，且目标目录一个字节都不删**。
- 路径参数或家目录名含**尾随空白** ⇒ 一律报错退出、不做任何改动
- `-Target` 带**尾随反斜杠**（如 `-Target "D:\plugins\"`）也能正常装、正常卸 ——
  比较前会把两侧路径的**尾随分隔符**归一（只动分隔符，空白一个字都不动）
- ⚠️ **命令行里路径末尾的反斜杠会被闭引号吃掉**：`-Target "D:\My Plugins\"` 在 cmd / PowerShell 里
  实际被解析成 `D:\My Plugins"`（**多出一个引号**）。脚本会**直接报错并点名这个原因**，
  **不会**静默帮你把引号去掉再继续跑（那会作用到你没指定的目录）：
  - 正确写法一：去掉末尾反斜杠 —— `-Target "D:\My Plugins"`
  - 正确写法二：把末尾写成两个反斜杠 —— `-Target "D:\My Plugins\\"`
  - 路径**含空格或含中文**时尤其容易踩这个坑（Windows 的引号规则只在加引号时才生效）
- `-PurgeData` 才清运行时台账（`%USERPROFILE%\.minimax\v2\plugin-data\hooks\super-agent-router\`）
- **项目里的 `.superagent/` 一律不动** —— 那是你的项目数据，不是插件，要删自己删
- 卸载后请**新开一个会话**，旧会话里的 Hook 还在

---

## 目录结构

```
.
├── install.ps1                  # 一键安装（Windows PowerShell 5.1+）
├── uninstall.ps1                # 卸载（默认移到 .trash\，可恢复）
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
├── tests/                       # 十三套回归测试（项目资产，不是私有记忆）
│   └── *-test.mjs
│
├── tools/                       # 工装
│   ├── run-tests.mjs             # 验收工装（自动发现 tests/*-test.mjs）
│   ├── deploy-plugin.mjs         # 部署到安装目录
│   ├── sync-github.mjs           # 同步到 GitHub
│   ├── verify-github.mjs         # 逐文件核对远端内容
│   └── install-selftest/         # 安装/卸载脚本自测（仅 Windows）
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

---

## 许可

[MIT](LICENSE) —— Copyright (c) 2026 yang2。

你可以自由使用、复制、修改、合并、再分发本项目（含商用），
唯一要求是**在副本里保留版权声明与许可声明**。
本项目按原样提供，**作者不承担任何担保责任**。
