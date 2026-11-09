# Scope 管控边界

派工时声明的 `SCOPE` 不是建议，是**程序层可拦截的硬边界**。
本插件的 `PreToolUse` Hook 会按下面的规则判定。

## 三类管控

| 类别 | 工具 | 判定 |
|---|---|---|
| **写** | `write` `edit` `multiedit` `notebookedit` `bash` | **严格**：必须精确落在白名单内 |
| **读** | `read` `glob` `grep` `list` `search` | **宽松**：允许读 scope 所在目录树 |
| **危险** | `mavis_agent_delete` `mavis_agent_update` `website_deploy` `miniapp` / `miniapp_publish` | **一律拦**，不论有没有 scope |

## 只约束子代理（v0.4.0 起）

派工发生在**父会话**（Router 发起），工具执行发生在**子会话**（worker 执行）。
插件的判定基准是工具调用载荷里有没有 `agent_type` 字段：

- **有** → 子代理会话 → 按 scope 严格判定
- **没有** → Router 父会话 → 直接放行

这条分水岭是必须的：Router 要汇总产出、跑验收、做复盘，
它必须能读写 worker scope 之外的文件。早期版本用同一个 session_id 索引
父与子两层，结果 worker 查不到自己的 scope（管控对真正要约束的人失效），
Router 反而命中（被自己派出的 worker 锁死）。

worker 的 scope 来自**它自己 transcript 里的派工原文** —— 那是 Router 亲手写下的
白名单，是唯一权威来源，不需要任何 id 猜测或时序启发式。

## 组队闸门（v0.4.0 起）

两道闸门在**派工时**就拦，不等到 worker 动手：

| 闸门 | 判什么 | 触发后果 |
|---|---|---|
| **scope 重叠** | 新 SCOPE 与本会话仍在飞的派工是否有写冲突 | 拒绝派发，报出冲突路径 |
| **派工数上限** | 并发在飞 > 6 或单会话累计 > 30 | 拒绝派发 |

- 只算**写冲突**（条目相同，或一方是另一方的目录前缀）。读范围天然重叠，不算冲突。
- worker 结束后（`SubagentStop`）它的名额会被回收，所以「派完 → 验收 → 再派」不会误报。
- 超过 2 小时没回收到结束信号的视为失联，不再计入在飞。

## 写：严格

目标必须精确等于某个 scope 项，或落在显式以 `/` 结尾的目录项之下。

```
SCOPE: src/app.ts
  写 src/app.ts        → 放行
  写 src/app/sub/x.ts  → 拦（src/app.ts 是文件，不是目录）

SCOPE: src/app/
  写 src/app/x.ts      → 放行
  写 src/app/sub/y.ts  → 放行（目录涵盖其下）
  写 src/other.ts      → 拦
```

## 读：宽松

读操作允许读到 **scope 所在目录树** —— Worker 需要看邻近文件理解代码，
这是正当的探查，不该被拦。

```
SCOPE: src/app/login.ts
  读 src/app/login.ts     → 放行
  读 src/app/session.ts   → 放行（同目录，理解上下文）
  读 src/app/sub/x.ts     → 放行（同目录树）
  读 config/prod.yaml     → 拦（无关目录）
```

## 绝对路径一样算

MCode 的工具接受绝对路径，scope 通常写相对路径。插件会自动把绝对路径
折算成相对工作区的路径再比对，**两种写法都能命中**，不会出现"绝对路径永远不匹配"。

## 危险操作：一律拦

这几类不碰工作区文件，但执行后是账号级或对外可见的**不可逆**动作：

| 工具 | 为什么拦 |
|---|---|
| `mavis_agent_delete` | 删除成员是账号级不可逆操作，历史会话不会随之清理 |
| `mavis_agent_update` | 改成员的 description/system_prompt 是账号级变更，需人工确认 |
| `website_deploy` | 部署会把内容发布到公网 |
| `miniapp` publish | 发布会替换线上运行实例 |

这类动作**即使没有 scope 声明也会被拦** —— 它们不受派工范围保护，
必须由用户亲自发起或明确授权。

## 绕过路径

| 想干的事 | 正解 |
|---|---|
| 需要改 scope 外的文件 | 先更新 scope 重新派工，不要自行扩大范围 |
| 需要读别的目录 | 在 brief 里写明，或派一个 scope 覆盖该目录的成员 |
| 需要删成员 / 部署上线 | 交回给用户，由用户亲自执行 |

**不要尝试用 bash 绕。** bash 命令里的路径同样会被逐段检查。