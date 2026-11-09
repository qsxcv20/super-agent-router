# Scope 管控边界

派工时声明的 `SCOPE` 不是建议，是**程序层可拦截的硬边界**。
本插件的 `PreToolUse` Hook 会按下面的规则判定。

## 三类管控

| 类别 | 工具 | 判定 |
|---|---|---|
| **写** | `write` `edit` `multiedit` `notebookedit` `bash` | **严格**：必须精确落在白名单内 |
| **读** | `read` `glob` `grep` `list` `search` | **宽松**：允许读 scope 所在目录树 |
| **危险** | `mavis_agent_delete` `mavis_agent_update` `website_deploy` `miniapp` | **一律拦**，不论有没有 scope |

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