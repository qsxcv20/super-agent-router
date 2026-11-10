# Super Agent Router

把「会话」当系统来用的编排插件：任务来了自动路由到合适的专项成员、组队派工、
独立验收、把成败沉淀成错题本与实战记录。

安装后你得到的是一套**程序层拦得住**的授权模型 —— 不是提示词里的君子协定：

- 派工没写 SCOPE 白名单 → 直接拒绝派发。
- Worker 想改白名单外的文件 → 越界拦截，工具调用当场被 deny。
- Worker 声称做完却拿不出证据 → 交付被拦一次，要求补证据。
- Worker 的边界算不出来 → **拒绝**，不是放行。

当前版本：**v0.5.2**。

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
.superagent/lessons/_router.md   Router 自己的错题本（编排层的锅记这里）
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
   >
   > **v0.5.0 尤其要注意这条**：本版给 `PreToolUse` 的 matcher 加了 `run_code` 与 `mavis`，
   > 新增的匹配项**只在新会话里生效**。老会话里，`mavis`（含 `agent delete` / `agent update`）
   > 和 `run_code` 这两类调用仍然不会进越界拦截。
   > 原因：匹配项取自**会话绑定的 hook 缓存树**，老会话绑的是老树，老树的 matcher 里没有这两项。
   > 所以「装完/升完版不新开会话」不只是不加载新脚本，而是**新加的匹配项整条不生效**。

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

输入「帮我把这个需求拆给合适的成员」，或任何明确要求拆分 / 并行 / 派谁 / 验收的提问
（书面说法如「派工 / 组队 / 拆成 / 分工 / 验收 / 复盘」，口语说法如「拆一下」「分头做」「谁负责」同样算数）：

```text
[super-agent-router] 本轮按编排流程处理。
```

看不到 → Hook 装上了但意图粗筛没命中（换一句明确要求拆分 / 并行 / 派谁的话再试）；
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
v0.5.0 换了 `hooks.json` 的 matcher，**不新开会话就等于没升级**。

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

记不住格式就看插件包里的 `references/brief.md`。

### 5. 是不是 Router 自己被拦了？（v0.4.0 已修）

v0.3.x 有个链路漏洞：台账记的是「发起方」会话，于是 worker 在子会话查不到自己的 scope，
Router 在父会话反而命中了 —— 表现为「派完第一个工，Router 连自己的收尾文件都写不了」。

v0.4.0 已修：约束只落在被派工的子代理身上，Router 父会话不受 worker scope 约束，
worker 的 scope 改从它自己 transcript 的派工原文解析。

如果你在旧会话里遇到这个现象，**新开一个会话**即可确认是否已修复。

### 6. 派工被「组队冲突」或「派工超限」拒绝？

这是组队闸门在正常工作，不是故障：

- **组队冲突** —— 本次 SCOPE 与仍在飞的派工重叠。要么等它结束再派，要么把范围拆开。
- **派工超限** —— 并发在飞上限 6 个、累计上限 30 个。说明任务没拆干净，或者在用派工代替思考。

两个闸门都只算**写冲突**，读范围天然重叠不会被拦 —— 只读条目（`ro:`）也永远不构成写冲突。

### 7. 插件在设置里被禁用了吗？

已安装的本地插件默认启用，但如果你之前手动关过同一个目录，它会保持关闭状态。
到设置里的插件列表确认它处于启用状态。

### 8. 报「越界拦截」但你确认路径没问题？

- 绝对路径与相对路径都会折算后比对 —— 通常不是路径写法的问题。
- 目录 scope 必须以 `/` 结尾才涵盖其下所有文件；写成 `src/app` 时，
  `src/app/sub/x.ts` 会被拦。
- 读操作比写宽松：允许读 scope 所在目录树（读邻近文件理解上下文是正当的）。
- 派工用 `ro:` 条目时，读放行、写照拦 —— 这是设计，不是误判。

### 9. Worker 报「解析不到边界」被拒绝？

v0.5.0 起，worker 的 scope 来自它自己 transcript 里的派工原文；解析不出来时**一律拒绝**，
不再放行。看到这条说明派工原文有问题：

- brief 里必须有一行可解析的 `SCOPE:` 清单
- 路径要写成规范路径，别用否定式表述
- 派工的内容要确实进了 worker 的 transcript

### 10. 派工被取消后，名额没还回来？

派工被取消（或子会话异常退出）时**不会触发** `SubagentStop`，
台账里的 `state` 会停在 `active`，一直占着并发名额（上限 6 个）到 TTL（2 小时）。
表现是「机制突然不让我派工了」，但报的是「在飞派工已达上限」，不指向真正原因。

取消后请显式释放：

```powershell
$env:PLUGIN_DATA = "$env:USERPROFILE\.minimax\v2\plugin-data\hooks\super-agent-router"
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\release-slot.mjs" --dispatch dsp_xxx
```

释放某个父会话下的全部在飞派工：

```powershell
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\release-slot.mjs" --parent mvs_xxx
```

> **用开关而不是 JSON**：PowerShell 的原生参数解析会吃掉 JSON 里的双引号 ——
> `node x.mjs '{"id":"a"}'` 实际收到 `{"id:a}`（非法 JSON）。
> 开关形式不含引号，跨 shell 一致。JSON 形式仍然支持，但在 PowerShell 里要自己转义。

只把仍在飞的（`active`）记录翻成 `aborted`，已完成的记录不动。
id 写错或台账读不出来时会直接报错退出，不会「假装释放成功」。

### 11. 粗筛像是从不命中？先看留痕文件

载荷坏掉时（平台改了字段名、JSON 不合法），粗筛会**留痕而不是静默退出**。
痕迹文件在插件的数据目录下：

```powershell
Get-Content "$env:USERPROFILE\.minimax\v2\plugin-data\hooks\super-agent-router\gate-trace.jsonl" -Tail 20
```

- 看到 `payload-parse-failed` 或 `prompt-field-missing` → 是**载荷问题**，不是粗筛词表的问题；
- 文件不存在 → 载荷没问题，是「没命中」，回第 2 步看意图词。

## 只读条目 `ro:`：想让它读，但不想让它改

同一个 SCOPE 清单里，两种条目可以混着用：

```text
SCOPE: ro: plugin/scripts/, docs/audit/report.md
```

含义是：

| 条目 | 能读 | 能写 |
|---|---|---|
| `ro: plugin/scripts/` | ✅ 该目录树下所有文件 | ❌ 一律拦 |
| `docs/audit/report.md` | ✅ | ✅（仅这一个文件） |

写法上 `ro: path` 与 `ro:path` 都认；目录条目仍要带结尾的 `/` 才涵盖其下所有文件。

两条配套规则：

- `ro:` 条目**永不**授予写权限 —— 写同一个文件也会被拦。
- `ro:` 条目**不参与**派工的写冲突检测 —— 两个人都只读同一个目录不算冲突。


## 权限等级：给成员更多权限，但不靠自觉

逐路径白名单对「派一个大活」太琐碎。这个插件给每个成员一条**权限等级**（tier）：

| 等级 | 含义 |
|---|---|
| `scoped`（默认） | 逐路径白名单；白名单外一律拦，越界自动记账进待审清单 |
| `full` | 项目工作区内自由读写，不必逐路径枚举 |

**每个成员都是平等的** —— `full` 不是某些成员的特权，任何成员都可以被管理员提权。
提权这个动作在管理员手里：

```powershell
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --tiers
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --tier full --agent sa-gate-integrity --approver router
```

提权写进 `.superagent/roster.json`，留痕 `.superagent/changes.log`。
收回就是把 `full` 换回 `scoped`（同一条命令，改一个词）。

**`full` 不等于无限权限**，这三条照旧生效：

1. `.superagent/` 编排层私有状态目录除外 —— 那是成员互相篡位、自己给自己提权的战场；
2. 工作区之外的路径仍然拦，并自动记账待审；
3. 账号级 / 对外不可逆动作（删成员、改成员、部署、发布）照旧硬拦。

## 子代理撞墙了怎么办：自动审核，一键批准

子代理撞到 scope 墙时，护栏**自动**把「它想访问什么、被拒了什么」记进台账 ——
不用等 worker 汇报。父会话一条命令看待审清单：

```powershell
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --list
```

批准一条（读请求只授读，写仍然拦）：

```powershell
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --grant req_xxx --approver router
```

拒绝一条：

```powershell
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --deny req_xxx --approver router --reason "不该读"
```

直接给某个仍在飞的派工加条目：

```powershell
node "$env:USERPROFILE\.minimax\plugins\super-agent-router\scripts\scope-amend.mjs" --dispatch dsp_xxx --add src/app/ --approver router
```

批准**必须**落在仍在飞的派工上 —— 派工结束了就拒绝扩权（事后再补权限没有意义，重新派工即可）。
自动的是**发现与记账**，批准权始终在管理员手里：让被约束者自己决定边界等于拆掉授权模型。

## brief 是 worker 唯一的协议载体

这条是运行时事实，不是什么设计偏好：

> `plugin/hooks/hooks.json` 声明的 Hook 全部挂在**父会话（Router）**的事件流上。
> **子会话不会触发 `SessionStart`，也不会触发 `UserPromptSubmit`。**
> 没有对应事件可挂，代码层面关不掉。

所以「会话开始自动注入编排协议」这件事**只对 Router 生效**。对 worker 来说：

| worker 需要的东西 | 怎么到达 |
|---|---|
| 编排协议要点 | **随 brief 走** —— Router 在 brief 里写清，别指望 hook 自动注入 |
| 派工白名单（SCOPE） | brief 正文 + 子会话 transcript |
| 该成员的历史教训 | 机制直接注入 worker 上下文（v0.5.0 起，不再只挂父会话） |
| 该成员的实战记录 | 派工时随注入文本给出（匹配阶段给 Router 参考） |

结论：**brief 少写一条，worker 就少一条依据。**
目标、边界、验收标准、交付要求，一条都不能省。

## v0.5.0 的破坏性变更

以下四项会改变现有用法。升级前请逐条检查，避免「以前能跑、升级后被拦」。

1. **解析不到边界 = 拒绝（不再放行）。**
   旧 brief 写法若解析不出 SCOPE，worker 会被拒绝操作。
   - 检查：所有在用的派工 brief 是否都含一行可解析的 `SCOPE:` 路径清单。

2. **通道判定变严。**
   bash 现在按**命令意图**分流（只读命令按读判定，其余按写判定）；
   glob / grep 改按**有效检索根**判定；未登记的文件类工具名一律按**写**判定。
   - 检查：worker 脚本里是否有依赖「bash 里带点的东西不算路径」的写法；
     是否有对目录树外做 glob/grep 的步骤需要补进 scope。

3. **履历的验收方必须真实存在。**
   写实战记录时，`verified_by` 必须在派工台账里有一条 `state = done` 的记录。
   填一个陌生名字写履历会被拒绝。
   - 检查：现有履历写入流程是否走真实派工验收。
   - 历史履历不受影响：闸门只在**写入时**校验，读取时不管历史记录。

4. **编排层的归因不再写进成员错题本。**
   「brief 给错」「派工给错」「Router 的锅」这类归因会被错题本闸门退回来，
   改记进 `.superagent/lessons/_router.md`（用契约的 7 字段条目模板）。
   - 检查：成员错题本里若有这样的归因，迁到 `_router.md`。

另有一条运行时要求：**`hooks.json` 的 matcher 变了，必须新开会话才生效**（见上面排查第 1 条）。

## 它管什么、不管什么

| | 行为 |
|---|---|
| **写** `write` `edit` `multiedit` `notebookedit` `bash` | 严格：必须精确落在白名单内，否则拦 |
| **读** `read` `glob` `grep` `list` `search` | 宽松：允许读 scope 所在目录树 |
| **复合** `run_code` | 只判危险操作（代码里夹带的 `mavis agent delete` / `website_deploy` 等一律拦）；不扫代码文本里的路径，作用域交回内层调用：每个内层写/读调用各自触发 PreToolUse 重新判定 |
| **危险** `mavis_agent_delete` `mavis_agent_update` `website_deploy` `miniapp` / `miniapp_publish`，以及 `mavis` 的 `agent delete` / `agent update`、`miniapp` 的 `publish` | 子代理会话里一律拦：账号级或对外可见的不可逆动作，必须由你亲自发起。Router 父会话（你本人）不受此拦 |

三条硬边界：

1. **只约束被派工的子代理。** Router 父会话不受 worker scope 约束。
2. **worker 自述完成不算完成。** 派工后必须由独立 verifier 验收。
3. **账号级与对外不可逆操作不由 worker 执行。** 删成员、改成员配置、部署上线、发布 Mini App ——
   这些交回给你亲自发起。

## 什么时候它会主动接管（触发语义）

插件在**每一轮**用一句粗筛决定「这一轮要不要展开编排流程」：

| 这句话像什么 | 结果 |
|---|---|
| 在要求拆 / 分 / 并行 / 派谁 / 验收 | **展开**：注入完整路由指令 |
| 改 typo / 查文档 / 加注释 / 修 bug | **不展开**：静默，直接做 |
| 只是出现了「同时 / 多个 / 分别 / 各自 / 并行」 | **不展开**：那不是编排，是普通句子 |

口语也算数：「拆一下这块」「分头做」「谁负责这块」「各做各的」「放到后台做」「几个人一起做」
「复审一下」都能识别；完整判据见 `references/contract.md` 的 **S11**。

信号词必须**和动作词挨着**才算编排 ——「同时打开这两个文件」「批量导入」不是编排，「并行做」才是。

在本工作区**有可用专项成员**（名录里有专精成员、且他有过验收通过的成果）时，
即使这轮不是编排请求，也会多出一行极短提示告诉你「本工作区有可复用的专项成员」。
没有可用专项成员的工作区，这行不会出现 —— 单点小改零噪音。

## 它怎么定位自己：主 agent 是管理层，不是执行层

会话一开始，主 agent 会被明确告知它的定位：

| 归主 agent | 不归主 agent |
|---|---|
| 理解用户到底要什么、定方向 | 具体实现 |
| 拆解任务、组队 | 批量取证（多文件扫描、批量读） |
| 整合产出、给用户最终结论 | 独立验收（必须派独立 verifier） |

所以：**有专项成员 owns 这件事，就派工，不自己上手**；
没有专精成员但这事有方法论要求（要做「精」而不是「能」），先现场配置成员再派工；
只有单点小改（改 typo、查 API、加注释、改配置值）才自己直做。

**成员记忆是共享但隔离的**：教训、履历、方法论各归各的，派工时只注入目标成员自己的历史。
如果发现串味 —— 别人的教训出现在别人的 brief 里、两个成员抢同一个 `owns`、有人改了别人的记录 ——
那是缺陷，要改归属映射，不能默认放着不管。

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
