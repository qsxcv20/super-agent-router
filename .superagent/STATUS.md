# super-agent-router 当前状态

更新：2026-11-09 20:30　版本：v0.3.2

## 状态：可以拿去正式任务上试了

插件已被 MCode 识别并启用（`v2/plugin-hook-cache/` 有完整包副本）。
**必须新开一个会话** —— Hook 按会话激活，本会话启动于插件创建之前。

v0.3.1 修复：按官方 Hook 契约修正，SessionStart 事件补齐 ——
会话一开始就注入编排协议，模型自动知道该派工。详见下方「v0.3.1 修了什么」。

v0.3.0 新增：实战记录（履历）机制。错题本记失败，履历记成功，两端闭环。

## v0.3.2 修了什么（实测探测出的链路漏洞）

不是读文档猜的，是按运行时真实环境喂 JSON 实测出来的：

| 漏洞 | 探测方式 | 后果 | 修法 |
|---|---|---|---|
| 派工不写 SCOPE 静默放行 | dispatch → guard 越界写 | 无白名单=无边界，授权模型被绕开 | dispatch 直接 deny |
| 连续派工覆盖前一条 | 同 session 派 2 次读台账 | 前 worker 的 scope 丢失 | 去重键改 session+turn+agent |
| watchdog 被「搞定了」蒙混过关 | SubagentStop 假消息 | 空交付守门人失效 | 扩充声明词 + 强制证据 |
| watchdog 不验证文件存在 | 声称 src/ghost-file.ts | 编造产出也能通过 | 逐个路径落盘校验 |

新增 `chain-test.mjs` 锁定上述五个行为，八套回归全绿。

**仍存两处软肋（未修）**：
- 组队 scope 重叠无人检测 —— 只在 SKILL.md 里约束，代码层不强制
- 单会话派工数无上限 —— roster 上限 12 兜底，但不精准

## v0.3.1 修了什么（Hook 不触发的根因）

| 问题 | 根因 | 修法 |
|---|---|---|
| Hook 从不触发 | 本会话 17:16 启动，插件 17:35 才创建 —— Hook 按会话激活 | 新增 `SessionStart` 事件 + **必须新开会话** |
| 编排意图可能匹配不上 | `UserPromptSubmit` 写了空 `matcher: ""` | 官方要求省略该字段，已删 |
| 模型不知道有编排机制 | 只有提问时才注入 | `SessionStart` 在会话开始就注入协议 |

官方契约原文：*"Plugin recognition alone does not verify command execution."*
缓存副本存在 ≠ Hook 会跑。

## 核心设计决定

**1. 成员是运行时长出来的，不是预置的。**

插件包里只有协议、内置成员引用和通用 worker，**没有任何业务专项**。
业务专项在任务真正需要它时才现场配置，用完留在 roster 里供下次复用。

**2. 机制在插件，数据在项目。**

| 层 | 位置 |
|---|---|
| 机制（准入规则、归因表、校验逻辑） | 插件包 `references/` + `scripts/` |
| 数据（实际教训条目 / 履历，运行时增长） | 项目 `.superagent/lessons/` + `.superagent/methods/` |

**3. 错题本必须闭环：只记不读 = 没进化。**

复盘写入 → 下次派工自动前置 → Worker 开工前就知道上次栽在哪。

**4. 履历必须闭环：只记不读 = 没积累。**

验收通过 → 写入方法论「实战记录」段 → 匹配阶段注入 Router → 派工时带给 Worker。

**5. 履历只作参考，不自动改 owns。**

归属声明是人工可审计的资产。让模型根据战绩自行收窄 owns，
等于让系统自己给自己发权限 —— 不可审计，也不可追责。

**6. Scope 管控分三档：写严格 / 读宽松 / 危险操作一律拦。**

## 管控边界（详见 references/scope.md）

| 类别 | 工具 | 判定 |
|---|---|---|
| 写 | write/edit/bash/... | 严格：精确落在白名单内 |
| 读 | read/glob/grep/... | 宽松：允许读 scope 所在目录树 |
| 危险 | agent delete/update、部署、发布 | 一律拦，**不论有没有 scope** |

**只约束派工产生的 worker，主会话不受影响**（已实测）。
绝对路径会折算成相对工作区路径比对，两种写法都能命中。

## 六套机制（均代码强制）

| 机制 | 强制者 | 触发点 |
|---|---|---|
| 编排协议注入（会话开始即生效） | `session-start.mjs` | SessionStart |
| 编排粗筛（普通提问静默放行） | `gate.mjs` | UserPromptSubmit |
| 履历匹配参考注入 | `gate.mjs` + `records.mjs` | UserPromptSubmit |
| 越界拦截 / 危险操作拦截 | `guard.mjs` | PreToolUse |
| 派工登记 + 教训前置 + 履历带入 | `dispatch.mjs` | PreToolUse(task) |
| 空交付/无证据 block | `watchdog.mjs` | SubagentStop |
| 造人纪律（方法论先行、命名、闸门） | `roster.mjs` | 手动调用 |
| 错题本准入 | `lessons-gate.mjs` | 手动调用 |
| 履历准入（含执行者不可自证） | `record-gate.mjs` | 手动调用 |

## 回归测试（六套全绿）

```
node .superagent/e2e-test.mjs      # Hook 契约 + 读类/危险管控
node .superagent/roster-test.mjs   # 造人纪律
node .superagent/lessons-test.mjs  # 错题本纪律
node .superagent/guard-test.mjs    # 越界判定细节
node .superagent/scope-test.mjs    # 作用域边界（不误伤主会话）
node .superagent/records-test.mjs  # 履历机制（写入准入 + 匹配注入 + 不改 owns）
node .superagent/hooks-test.mjs   # Hook 契约合规（事件/字段/matcher/输出形状）
node .superagent/chain-test.mjs   # 链路漏洞（SCOPE 强制/派工不覆盖/证据核验）
```

## 包结构

```
super-agent-router/
├── .minimax-plugin/plugin.json      v0.3.0
├── hooks/hooks.json                  7 个 handler
├── scripts/                           11 个脚本
│   ├── lib.mjs         路径归一化 + scope 判定
│   ├── session-start.mjs SessionStart 注入编排协议
│   ├── gate.mjs        UserPromptSubmit 粗筛 + 履历匹配参考
│   ├── dispatch.mjs    派工登记 + 教训前置 + 履历带入
│   ├── guard.mjs       越界 + 危险操作拦截
│   ├── watchdog.mjs    空交付/无证据 block
│   ├── roster.mjs      交叉核对 + 登记
│   ├── lessons.mjs     错题本 + 实战记录读取
│   ├── lessons-gate.mjs 错题本写入闸门
│   ├── record-gate.mjs  履历写入闸门
│   └── records.mjs      履历摘要（匹配参考）
└── skills/super-agent-router/
    ├── SKILL.md
    └── references/  teams / routing / brief / bootstrap / review / scope / records
```

## 正式任务上怎么试

1. **新开一个会话**（关键 —— 本会话 Hook 不回溯生效）
2. 提一个编排型请求，例如「这个需求拆成两个任务并行做，谁来负责」
3. 看是否出现 `[super-agent-router] 本轮按编排流程处理` —— 出现说明 Hook 通了
4. 若出现了但行为不对，把现象告诉我，我按现象调

## 已知边界

- 外部事件触发源（GitHub / 飞书 / CI）未接
- 主动接活（cron 巡检）未做
- 履历上限 20 条/成员，超了要先合并淘汰旧的
- 读宽松到「scope 所在目录树」，比写严格

## 有意未做

- 订阅直通 / 存算分离（单机用不着）
- Plugin 公开分发（当前仅本机安装 + GitHub 私有备份）
