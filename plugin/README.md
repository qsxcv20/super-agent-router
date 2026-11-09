# Super Agent Router

把「会话」当系统来用的编排插件：任务来了自动路由到合适的专项成员、组队派工、
独立验收、把成败沉淀成错题本与实战记录。

安装后你得到的是一套**程序层拦得住**的授权模型 —— 不是提示词里的君子协定：

- 派工没写 SCOPE 白名单 → 直接拒绝派发。
- Worker 想改白名单外的文件 → 越界拦截，工具调用当场被 deny。
- Worker 声称做完却拿不出证据 → 交付被拦一次，要求补证据。

## 装在哪

插件包本体（只读，随插件安装）：

```text
<插件目录>/
  .minimax-plugin/plugin.json    清单：版本、能力声明
  hooks/hooks.json               Hook 接线
  scripts/*.mjs                  Hook 脚本
  skills/super-agent-router/     编排协议（SKILL.md + references/）
  icon.png / icon-dark.png
```

运行时数据（可写，跨会话持久，与插件包分离）：

```text
${PLUGIN_DATA}/dispatches.json  派工台账
```

> `PLUGIN_DATA` 由 Hook 运行时注入，指向插件的数据目录；普通 PowerShell 窗口里
> 没有这个环境变量，要手动找台账文件请用下面的排查第 4 步给的命令。

按项目组织的部分留在项目里，随 git 管理：

```text
.superagent/roster.json          专项名录（归属的唯一依据）
.superagent/methods/<成员名>.md  成员方法论 + 实战记录
.superagent/lessons/<成员名>.md  成员错题本
```

## 怎么装

1. 把插件包目录放进 MiniMax Code 的本地插件目录：

   ```text
   C:/Users/yang2/.minimax/plugins/super-agent-router/
   ```

   目录名必须与 `.minimax-plugin/plugin.json` 里的 `name` 一致（`super-agent-router`），
   不要再套一层同名目录。

2. 装完后**新开一个会话**。

   > **Hook 是按会话激活的。** `SessionStart` 只在新会话或真正恢复的 Hook 会话触发。
   > 安装/升级后不新开会话，Hook 不会跑 —— 这是「装完没反应」最常见的原因，
   > 不是安装失败。

3. 确认 Node.js 可用（Hook 脚本用 `node` 执行）：

   ```powershell
   node --version
   ```

4. 项目侧按需建一个 `.superagent/roster.json`。没有它，插件依然能装上并注入协议，
   但路由会缺少专项名录依据，只能退到通用 worker 直做。

## 怎么确认 Hook 真的生效

按这个顺序看，**三条都命中才算完全生效**：

### 第 1 步：新会话里应该自动出现协议注入

新开一个会话，第一轮就能看到类似这样的注入：

```text
[super-agent-router] 本会话已启用 Super-agent 编排机制。
```

看不到 → 跳到下面的排查清单第 1、2 条。

### 第 2 步：问一句带编排意图的话，应该看到路由指令

输入「帮我把这个需求拆给合适的成员」或任何含
「派工 / 组队 / 拆成 / 拆给 / 分工 / 并行 / 验收 / 复盘 / 错题本」的提问：

```text
[super-agent-router] 本轮按编排流程处理。
```

看不到 → Hook 装上了但意图粗筛没命中（换一句含上述关键词的话再试）；
仍然看不到则看排查清单第 3 条。

### 第 3 步：派一个工，越界应该被当场拦下

派一个带 SCOPE 的工，让 worker 去改一个 SCOPE 外的文件，应该看到拦截：

```text
[super-agent-router] 越界拦截：本次派工声明的 SCOPE 为 [...]，目标 ... 不在白名单内
```

拦不住 → 派工时没写 `SCOPE:` 具体路径清单，或写成了否定式禁令。
注意：**只有被派工的子代理受约束**；Router 主会话本来就不该被拦，
如果连 worker 都拦不住，看排查清单第 4 条。

### 第 4 步（可选）：查台账确认链路通了

```powershell
Get-ChildItem -Path "$env:USERPROFILE/.minimax" -Filter dispatches.json -Recurse -ErrorAction SilentlyContinue
```

应能看到两个数组：

- `dispatches` —— 每条有 `parent_session_id`、`scope`、`state`（`active` → `done`）。
- `bindings` —— worker 跑过之后出现，记录该子会话绑定的 scope。

## 不生效时按什么顺序排查

严格按顺序来，从上往下过一遍。**不要跳步** —— 后面的检查依赖前面的结论。

### 1. 是不是没新开会话？

最高频原因。Hook 按会话激活，安装/升级后必须新开一个会话。
先新开会话再重测，这一步能解决大部分「没反应」。

### 2. 插件目录放对了吗？

- 路径：`C:/Users/yang2/.minimax/plugins/super-agent-router/`
- 该目录下的 `.minimax-plugin/plugin.json` 要存在
- 目录名必须等于清单里的 `name`（`super-agent-router`），多套一层就会认不出
- 清单里 `hooks` 与 `skills` 两个数组的每个路径都要真实存在

```powershell
Get-ChildItem -Recurse -File 'C:/Users/yang2/.minimax/plugins/super-agent-router' | Select-Object FullName
```

### 3. Node.js 能不能跑？

所有 Hook 脚本都是 `node` 执行的。`node` 不在 PATH 里，Hook 会静默失败
（Hook 失败是 fail-open 的 —— 不生效，但不会报错给你看）。

```powershell
node --version
```

### 4. 派工的时候到底带没带 SCOPE？

Hook 拦不住越界，最常见的原因是派工时没给可判定的白名单：

- ✅ `SCOPE: src/app.ts, src/util/` —— 具体路径，目录以 `/` 结尾
- ❌ `SCOPE: 不要动生产配置` —— 否定式禁令，程序无法判定，直接不算 scope
- ❌ 只写目录不带 `/` —— 会被当成单个文件，其下的文件全部拦掉

记不住格式就看 `references/brief.md`。

### 5. 是不是 Router 自己被拦了？（v0.4.0 已修）

v0.3.x 有个链路漏洞：台账记的是「发起方」会话，于是 worker 在子会话查不到自己的 scope，
Router 在父会话反而命中了 —— 表现为「派完第一个工，Router 连自己的收尾文件都写不了」。

v0.4.0 已修：约束只落在被派工的子代理身上，Router 父会话不受 worker scope 约束，
worker 的 scope 改从它自己 transcript 的派工原文解析。

如果你在旧会话里遇到这个现象，**新开一个会话**即可确认是否已修复。

### 6. 派工被「组队冲突」或「派工超限」拒绝？

这是 v0.4.0 新增的组队闸门在正常工作，不是故障：

- **组队冲突** —— 本次 SCOPE 与本会话仍在飞的派工重叠。要么等它结束再派，要么把范围拆开。
- **派工超限** —— 并发在飞上限 6 个、累计上限 30 个。说明任务没拆干净，或者在用派工代替思考。

两个闸门都只算**写冲突**，读范围天然重叠不会被拦。

### 7. 插件在设置里被禁用了吗？

已安装的本地插件默认启用，但如果你之前手动关过同一个目录，它会保持关闭状态。
到设置里的插件列表确认它处于启用状态。

### 8. 报「越界拦截」但你确认路径没问题？

- 绝对路径与相对路径都会折算后比对 —— 通常不是路径写法的问题。
- 目录 scope 必须以 `/` 结尾才涵盖其下所有文件；写成 `src/app` 时，
  `src/app/sub/x.ts` 会被拦。
- 读操作比写宽松：允许读 scope 所在目录树（读邻近文件理解上下文是正当的）。

## 它管什么、不管什么

| | 行为 |
|---|---|
| **写** `write` `edit` `multiedit` `notebookedit` `bash` | 严格：必须精确落在白名单内，否则拦 |
| **读** `read` `glob` `grep` `list` `search` | 宽松：允许读 scope 所在目录树 |
| **危险** `mavis_agent_delete` `mavis_agent_update` `website_deploy` `miniapp` / `miniapp_publish` | 子代理会话里一律拦：账号级或对外可见的不可逆动作，必须由你亲自发起。Router 父会话（你本人）不受此拦 |

三条硬边界：

1. **只约束被派工的子代理。** Router 父会话不受 worker scope 约束。
2. **worker 自述完成不算完成。** 派工后必须由独立 verifier 验收。
3. **账号级与对外不可逆操作不由 worker 执行。** 删成员、改成员配置、部署上线、发布 Mini App ——
   这些交回给你亲自发起。

## 不想用编排？

默认就是 **0 个成员**。改 typo、查 API、单点小改一律直接做 ——
走完全套编排比直接干更慢更贵。只有当任务需要同时做多件不同性质的事、
或某件事有明确的方法论要求、需要做到「精」而不是「能」时，才值得组队。

## 卸载

删掉整个插件目录即可：

```powershell
Remove-Item -Recurse -Force 'C:/Users/yang2/.minimax/plugins/super-agent-router'
```

派工台账留在插件数据目录（`${PLUGIN_DATA}/dispatches.json`），项目侧数据留在项目的
`.superagent/`（名录、方法论、错题本）。两者都不会自动清掉 —— 需要的话自行删除。
