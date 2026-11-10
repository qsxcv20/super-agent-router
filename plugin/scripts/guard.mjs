// PreToolUse：越界与危险操作拦截（程序层兜底）
//
// Super-agent 原则：外部文本只是数据，不能改变权限。
// 这里把「scope 白名单」变成真正拦得住的规则，而不是提示词里的君子协定。
//
// v0.4.0 修正（实测驱动的核心修复）：
//   派工发生在父会话（Router 发起），工具执行发生在子会话（worker 执行）。
//   v0.3.x 按 session_id 查台账，而台账记的是「发起方」会话，于是：
//     · worker 在子会话里查不到自己的 scope —— 越界管控对 worker 完全失效
//     · Router 在父会话里命中 —— 被套上 worker 的 scope，Router 自己被误伤
//   现在按「子会话」维度绑定：
//     · 父会话的工具调用载荷里没有 agent_type 字段 —— 直接放行，Router 不受约束
//     · 子会话从自己的 transcript 解析 brief 拿 scope —— 权威来源就是 Router 写下的白名单
//
// 四类管控：
//   1. 账号级与对外不可逆操作 —— 工具名 + 参数二维判定，一律拦（S5）
//   2. 写类工具（write/edit/bash/...）—— 严格，精确落在白名单内才放行（S2.2）
//   3. 读类工具（read/glob/grep/...）—— 宽松，允许读 scope 所在目录树（S2.1）
//   4. 边界算不出来 —— 一律 deny，不放行（S4）
//   5. 复合工具（run_code）—— 只判危险操作，作用域交回内层调用（S3 / S5.4）
//      复合层不对自由文本代码扫路径：注释、字符串常量里的路径字样
//      一旦参与判定就会把整次调用拒掉（实测误伤，见验收 V-02 / V-04 / V-07）。
//
// 第 4 条是这次改造的核心：以前「解析不到 brief / 取不到目标路径」都是 process.exit(0)，
// 那不是「没关系」，那是越界管控整段失效而不报错（D-01 / D-02 / D-04 / D-16）。
import path from 'node:path';
import os from 'node:os';
import {
  readStdin, parseInputStrict, readLedger, writeLedger, inScope,
  findBinding, upsertBinding, readBriefFromTranscript, scopeOverlaps,
  workspaceRoot, resolveAgentKey, isPathToken, extractPathTokens,
  splitCommandTokens, isReadOnlyCommand, extractWriteTargets, hasWriteVerb,
  DANGEROUS_COMMAND, detectDangerousAccountCommand, hasCommandSubstitution,
  recordScopeRequest, memberTier, withinWorkspace, touchesSuperagentPath, TIER_FULL,
  TIER_SCOPED, normScopeEntry, isPrivateMemoryPath, isPrivateMemoryEntry,
  expandsPrivateMemoryTree, PRIVATE_MEMORY_DIRS,
  projectRoot, readPluginPackageName, ownPackageAuthority,
  expandHomePath, trimPathPunct
} from './lib.mjs';

const rawStdin = readStdin();
const parsed = parseInputStrict(rawStdin);

// 载荷坏了 -> 拒绝，不走「父会话直接放行」。
// 以前 parseInput 解析失败返回空对象，agent_type 取不到就被当成父会话放行 ——
// 载荷一坏，这个 worker 的越界管控整段失效，而且不报错（D-04 的同类问题）。
if (!parsed.ok) {
  // 空载荷 = 这个 hook 根本不是被当作一次工具调用触发的，没有判定可做。
  if (!String(rawStdin || '').trim()) process.exit(0);
  deny('[super-agent-router] 越界管控无法执行：' + parsed.reason +
    '。载荷解析不出来 = 判定依据不可信，此处不放行。');
}

const input = parsed.value;
const tool = String(input.tool_name || '').toLowerCase();
const tInput = input.tool_input || {};
const sessionId = String(input.session_id || '');
const agentType = String(input.agent_type || '');

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

// 放行。带上下文时（把该成员的历史教训送进 worker）才输出 JSON，
// 没有要注入的内容就保持 stdout 为空 —— 空输出即放行。
function allow(additionalContext) {
  if (!additionalContext) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext
    }
  }));
}

// ── 只约束被派工的子代理 ─────────────────────────────
// 载荷里带 agent_type 才是子代理会话。父会话（Router 自己）没有这个字段，
// 所以 Router 的任何读写都不会被 worker 的 scope 套住。
if (!agentType) process.exit(0);

// ── 第 1 类：账号级 / 对外不可逆操作 ────────────────────────────
// 这些不碰工作区文件，但一旦执行就是账号级或对外可见的不可逆动作。
// 派工产生的 worker 永远不该自己做这些事 —— 必须由用户亲自发起。
const DANGEROUS = {
  mavis_agent_delete: '删除成员是账号级不可逆操作（历史会话不会随之清理）',
  mavis_agent_update: '修改成员的 description/system_prompt 是账号级变更，需人工确认',
  website_deploy: '部署会把内容发布到公网，属于对外可见的不可逆动作',
  miniapp_publish: '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作',
  miniapp: '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作'
};

// 参数维度的危险判定（S5.2）：同一个工具名，参数不同后果完全不同。
// 以前只按工具名等值匹配，mavis 的 command 参数空间里就有 agent delete /
// agent update，却因为工具名是 "mavis" 而整条绕过（D-03）。
function dangerousByArgs(toolName, ti) {
  if (toolName === 'mavis') {
    const cmd = String((ti && ti.command) || '').trim().toLowerCase();
    if (/^agent\s+(delete|update)\b/.test(cmd)) {
      return 'mavis 的 ' + cmd.split(/\s+/).slice(0, 2).join(' ') + ' 会删除/改写账号级成员，必须由用户亲自发起';
    }
  }
  if (toolName === 'miniapp') {
    const action = String((ti && ti.action) || '').trim().toLowerCase();
    if (action === 'publish') return '发布 Mini App 会替换线上运行实例，属于对外可见的不可逆动作';
  }
  return '';
}

// 复合工具（run_code）内部点名危险工具时，同样要拦。
function dangerousInCode(code) {
  const c = String(code || '');
  if (/mavis_agent_delete|agent\s+delete/i.test(c)) return '在复合调用里执行了 agent delete（删除成员是账号级不可逆操作）';
  if (/mavis_agent_update|agent\s+update/i.test(c)) return '在复合调用里执行了 agent update（修改成员是账号级变更）';
  if (/website_deploy/.test(c)) return '在复合调用里执行了部署（部署会把内容发布到公网）';
  if (/miniapp/i.test(c) && /publish/i.test(c)) return '在复合调用里执行了 Mini App 发布（对外可见的不可逆动作）';
  return '';
}

const argDanger = dangerousByArgs(tool, tInput);
if (argDanger) {
  deny('[super-agent-router] 已拦截：' + argDanger + '。' +
    '这类动作必须由用户亲自发起或明确授权，worker 不得自行执行。');
}
if (DANGEROUS[tool]) {
  deny('[super-agent-router] 已拦截：' + DANGEROUS[tool] + '。' +
    '这类动作必须由用户亲自发起或明确授权，worker 不得自行执行。');
}

// ── 工具分流（S5.1）─────────────────────────────────
// 已登记的文件类工具按名分流；没登记的「文件类」工具名一律按写判定，
// 不得默认放行 —— 兜底表以前是空的，等于护栏在最外层开了一道没规则的口子。
const WRITE_TOOLS = ['write', 'edit', 'multiedit', 'notebookedit', 'bash', 'apply_patch', 'patch'];
const READ_TOOLS = ['read', 'glob', 'grep', 'list', 'search', 'notebookread'];

// 明确不碰工作区文件的工具：不参与文件类判定，避免兜底规则误伤。
const NON_FILE_TOOLS = ['web_search', 'web_fetch', 'task', 'think', 'todo', 'self_reminder', 'tool_search', 'skill', 'ask_user'];

// 名字长得像文件类工具的未登记工具
const FILE_TOOL_HINT = /(file|path|dir|folder|write|edit|read|notebook|copy|move|delete|remove|create|rename|upload|download|save|patch|glob|grep|search|list|tree|touch|mkdir|rmdir|shell|exec|bash|command|code|script)/i;

function toolKind(toolName) {
  if (toolName === 'run_code') return 'composite';
  if (WRITE_TOOLS.includes(toolName)) return 'write';
  if (READ_TOOLS.includes(toolName)) return 'read';
  if (NON_FILE_TOOLS.includes(toolName)) return 'none';
  if (FILE_TOOL_HINT.test(toolName)) return 'write';
  return 'none';
}

const kind = toolKind(tool);
if (kind === 'none') process.exit(0);

// 写类工具的路径键名（D-16）：键名清单收敛到一份映射表。
// 取不到目标时一律 deny —— 「取不到目标就放行」是又一个默认放行分支。
const WRITE_PATH_KEYS = ['file_path', 'path', 'filePath', 'notebook_path', 'notebookPath', 'file', 'filename',
  'file_name', 'files', 'paths', 'target', 'target_path', 'dest', 'destination', 'source', 'source_path',
  'abs_path', 'absolute_path'];
const READ_PATH_KEYS = ['path', 'file_path', 'filePath', 'notebook_path', 'notebookPath', 'file', 'filename',
  'file_name', 'files', 'paths', 'dir', 'directory'];

// ── 解析本子会话的 scope 白名单 ────────────────────────
const ledger = readLedger();
if (ledger.readable === false) {
  deny('[super-agent-router] 越界管控无法建立：' + (ledger.error || '派工台账不可用') +
    '。台账读不出来 = 派工边界不可信，此处不放行。');
}

let binding = findBinding(ledger, sessionId);
let injected = '';
if (!binding) {
  const brief = readBriefFromTranscript(String(input.transcript_path || ''));
  if (!brief.ok) {
    // S4：解析失败必须 deny。解析不到边界 = 边界不存在，
    // 放行等于这个 worker 整段不受越界管控，而且不报错、不留痕。
    deny('[super-agent-router] 越界管控无法建立：' + brief.reason +
      '。解析不到边界 = 边界不存在，此处不放行（放行即等于越界管控对这个 worker 整段失效）。' +
      '若本 worker 确实带 SCOPE，请让父会话重新派工并确认 transcript 可读。');
  }
  const agentKey = resolveAgentKey({ briefAgent: brief.agent, agentType });
  binding = {
    session_id: sessionId,
    parent_session_id: brief.parentSessionId,
    agent: brief.agent || agentType,
    agent_key: agentKey,
    scope: brief.scope,
    dispatch_id: '',
    at: Date.now()
  };
  // 挂上 dispatch_id，worker 结束时好回收在飞名额。
  // 匹配用 agent_key（routing id），不再拿显示名做等值比较（D-12）。
  const d = (ledger.dispatches || [])
    .filter((x) => {
      const xKey = String(x.agent_key || x.agent || '');
      if (xKey && agentKey && xKey !== agentKey) return false;
      if ((x.state || 'active') !== 'active') return false;
      return scopeOverlaps(x.scope, brief.scope);
    })
    .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  if (d) binding.dispatch_id = d.dispatch_id || '';
  // 权限等级的**快照**：worker 操作的等级 = 派工那一刻的等级（见 dispatchTier 的注释）。
  binding.tier = dispatchTier(d, agentKey);
  // 边界 = brief 原文 ∪ **已批准扩权**。
  // brief 是权威来源（它写清了父会话批准了什么），但台账里可能有**后来批准**的扩权 ——
  // 那是父会话显式授权的，必须生效；否则「批准扩权」对还没发起过工具调用的 worker 无效。
  if (d && Array.isArray(d.scope_amended) && d.scope_amended.length) {
    binding.scope = Array.from(new Set(brief.scope.concat(d.scope_amended)));
  }
  upsertBinding(ledger, binding);
  writeLedger(ledger);
  // 把该成员的历史教训送进 worker 上下文（D-06）：
  // 以前 lessons 只挂在父会话的 additionalContext 上，子会话永远收不到，
  // 除非 Router 手工抄进 brief —— 那不是机制保障，是靠自觉。
  if (d && Number(d.lesson_count || 0) > 0 && Array.isArray(d.lessons) && d.lessons.length) {
    injected = '[super-agent-router] ' + (d.agent_key || d.agent || '该成员') + ' 的历史教训（开工前先看）：\n' +
      d.lessons.map((r, i) => (i + 1) + '. ' + r).join('\n');
  }
} else if (!binding.tier) {
  // 升级前建的绑定没有等级字段：按名录读一次并**冻结**进绑定。
  // 免得每次调用都重读（也免得机制升级本身把老会话的等级打回 scoped）。
  binding.tier = dispatchTier(null, binding.agent_key || binding.agent);
  upsertBinding(ledger, binding);
  writeLedger(ledger);
}

// 私有记忆目录不得出现在 worker 的边界里（闸门 1c 的第二道防线）。
//
// 为什么要第二道：binding 也可以**直接从 transcript 的 brief** 建起来
//（没有对应派工记录时）—— 那条路不经过 dispatch，闸门 1c 拦不到。
// 漏这一道 = 兄弟成员的错题本与 Router 私有账可以被读走（D-31）。
//
// **按形态判（D-58）**：只有**目录条目**才触发这道防线 ——
// 目录条目会按读模式展开成整棵子树（放开兄弟成员的错题本全文）；
// **精确文件条目**不展开，不触发 —— 它能不能读由**范围层**判（私有记忆路径一律不授予）。
//
// 以前这里不分形态：一条精确文件条目就把**整个边界**判死 ——
// 管理员批的精确只读扩权成了死条目，而这个 worker 的**每一次**工具调用都被拒，
// 全线卡死（不只是那一个文件读不了）。那道防线拦的是「展开」，不是「路径」。
for (const e of (binding && Array.isArray(binding.scope) ? binding.scope : [])) {
  if (!expandsPrivateMemoryTree(e)) continue;
  deny('[super-agent-router] 越界管控拒绝建立：本次派工的边界里含成员的私有记忆目录**条目**（' +
    String(e) + '）。' +
    '**目录条目**会按读模式展开成整棵子树 ⇒ 读到**兄弟成员的错题本全文**与 Router 私有账' +
    '—— 这正是「成员互相篡位」的那条路。' +
    '（精确文件条目不触发这条防线：它不展开，能不能读由范围层判。）' +
    '被派工成员自己的方法论与错题本由 guard 按精确文件单独放行，与 SCOPE 无关；' +
    '需要别人的历史请让 Router 转写进 brief。');
}

if (!binding || !Array.isArray(binding.scope) || !binding.scope.length) {
  deny('[super-agent-router] 越界管控无法建立：本会话没有可用的 scope 白名单。' +
    '没有边界 = 没有越界管控，此处不放行。');
}

const scope = binding.scope;
// 复合工具不走通用路径（targetsOf 里直接返回），这里的 mode 只对读/写类工具有效。
const mode = kind === 'write' ? 'write' : 'read';

// 方法论与错题本是这个成员的「输入契约」——
// system_prompt 明确要求它开工前读这两个文件。
// 它们住在项目的 .superagent/ 下，通常不在派工 SCOPE 里；
// 不放开这两个读权限，整套「把一件事做到精」的机制就断了。
//
// 按精确文件放行，不走目录树（D-14）：以前它们被拼进 scope 列表，
// 于是「读模式按目录树放宽」把 .superagent/methods/ 下所有成员的私有文件都放开了。
const exactPaths = [];
if (kind === 'read') {
  const root = workspaceRoot();
  const who = binding.agent_key || binding.agent || agentType;
  if (root && who) {
    exactPaths.push(root + '/.superagent/methods/' + who + '.md');
    exactPaths.push(root + '/.superagent/lessons/' + who + '.md');
  }
}

function allowedByExact(target) {
  return exactPaths.some((p) => inScope([p], target, 'exact'));
}

// ── 权威面脚本：父会话专属 ─────────────────────────────
//
// 这些脚本是**权限与记录的入口**，它们内部自己写文件（roster.json / 派工台账 /
// 错题本 / 履历）。护栏对「脚本内部发生的 fs 写入」没有判定能力
// （契约 S13.5：hook 是护栏不是沙箱）—— 于是 worker 只要能在 bash 里把它们跑起来，
// 就绕开了整套 scope 判定：自己给自己提权、自己批准自己的越界请求（F1）。
//
// 主防线在这里：子代理上下文（载荷带 agent_type）里执行这些脚本 = 直接拒绝。
// 父会话不受影响 —— 父会话载荷里没有 agent_type，上面已经早退了。
//
// **归属判据 = 插件包身份**（契约 S13.3 第 1 条 / F-01）：
// 一个文件属于本插件包，当且仅当它所在目录树里有 .minimax-plugin/plugin.json，
// 且那个包的包名与本插件一致。仓库 plugin/、安装目录
// ~/.minimax/plugins/super-agent-router、运行时缓存树 sha256-tree-v1-* 都满足。
//
// 为什么不能锚在「运行中 guard 自己所在的那一份」（上一轮的做法）：
//   那个锚点只覆盖**一份**副本 —— 仓库副本 plugin/scripts/scope-amend.mjs
//   完全不在锚点内。于是 worker 的 SCOPE 覆盖 plugin/scripts/ 时，
//   整条提权链在仓库副本上跑通：名录里等级变 full、变更账写下假批准人、
//   下一次派工即按 full 生效（F-01）。
//   上一轮的口径「工作区里的同名副本是普通文件，不误拦」**是错的** ——
//   那份副本跑起来做的是同一件事（读同一个名录、写同一个变更账）。
//
// 为什么不用脚本名裸匹配：别的项目里也可能有 roster.mjs / scope-amend.mjs，
// 按名字拦会把普通文件当权威入口（误伤）；
// 「路径里含 scripts/」这种模糊特征同样会误伤 —— 归属必须落在**身份**上。
//
// 这一条管的是 **bash 通道**：命令文本里出现「本插件包里的权威面脚本」就拒
// （执行与读取都算 —— 读一份再改名执行是同一条链）。
// **write / edit / read 工具不受这条限制** —— 机制维护类成员要改的就是它们，
// 改写仍受 scope 白名单与 .superagent/ 私有目录规则约束。
const AUTHORITY_SCRIPTS = [
  'scope-amend.mjs',    // 提权 / 批准扩权
  'release-slot.mjs',   // 释放名额
  'record-gate.mjs',    // 写履历
  'lessons-gate.mjs',   // 写错题本
  'roster.mjs'          // 登记成员
];

// 本插件的包身份：从**运行中这份副本**所在的位置反推包根，再读包名。
//
// 为什么这里仍然用 process.argv[1]：它只用来确定「本插件是谁」
// （包名），不再用来确定「哪些文件算权威面脚本」——
// 后者已经改成按**插件包身份**判（每一份副本各自按身份自证），
// 所以运行中的副本换了位置（缓存树 / 安装目录 / 仓库）不影响判定结果。
//
// 读不到包名时返回空串：归属判定会退化成「只要落在某个插件包里就算」，
// 即宁可多判不可漏判 —— 归属判不出来时不能默认放行。
let ownPkgCache = null;
function ownPackage() {
  if (ownPkgCache) return ownPkgCache;
  let root = '';
  try {
    const p = String(process.argv[1] || '');
    if (p) root = path.resolve(path.dirname(path.dirname(p)));
  } catch (e) { root = ''; }
  ownPkgCache = { root, name: root ? readPluginPackageName(root) : '' };
  return ownPkgCache;
}

// 把 ~ / $HOME / %USERPROFILE% / $env:USERPROFILE% 展开成真实家目录。
// 展开规则本身在 lib.mjs 的 expandHomePath()（纯函数，可单独断言）。
// 不展开的话，`node $HOME/.minimax/plugins/.../scope-amend.mjs` 这种写法
// 会因为路径对不上而绕过权威面脚本判定 —— 护栏最怕的就是这种「换个写法就躲开」。
function expandHome(p) {
  let home = '';
  try { home = String(os.homedir() || ''); } catch (e) { home = ''; }
  return expandHomePath(p, home);
}

// 执行类命令的段首词：只有它们后面的参数才可能是「被执行的文件」。
// 用来把「插件目录里的相对写法」（cd 进插件目录后跑裸文件名）纳入判定，
// 同时不让「随便一个同名文件」都被当成权威面脚本。
const EXEC_COMMANDS = new Set(['node', 'bun', 'deno', 'tsx', 'ts-node', 'npx', 'bunx']);

// 相对路径要按**多个根**解析 —— 只按一个根解析，换个目录执行同一条相对路径
// 就绕开了判定（上一轮「只锚定一个根」的漏法就是这么来的）。
// 三个根各管一段：
//   · 当前工作目录 —— worker 实际执行命令时的位置；
//   · 工作区根 —— brief 里写的相对路径按工作区解释；
//   · 本插件包根 —— 从插件目录里跑 scripts/xxx.mjs 的常见写法。
function candidateBases() {
  const workspace = [];
  const add = (b) => {
    const s = String(b || '').trim();
    if (!s) return;
    const v = s.replace(/\\/g, '/').replace(/\/+$/, '');
    if (v && !workspace.includes(v)) workspace.push(v);
  };
  try { add(process.cwd()); } catch (e) {}
  add(projectRoot());
  const pkgRoot = String(ownPackage().root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return { workspace, pkgRoot, pkgScripts: pkgRoot ? pkgRoot + '/scripts' : '' };
}

// 命令里是否指向**本插件包**的权威面脚本。命中返回脚本名，否则空串。
//
// 判定落在「插件包身份」上（ownPackageAuthority）：
// 文件名在权威面清单里 + 所在目录树里有 .minimax-plugin/plugin.json
// + 包名与本插件一致。**不**按路径长相、**不**按脚本名裸匹配。
//
// 相对路径的解析口径（为什么不是「拼上插件根就行」）：
//   把任意相对路径拼到插件根下再判身份，会让**任何**以权威面脚本命名的文件
//   （比如别的项目的 docs/roster.mjs）都被当成插件包里的东西 —— 那就是脚本名裸匹配。
//   所以插件根这一支只接**插件目录相对写法**：'scripts/xxx.mjs' 与裸文件名，
//   而且只对执行类命令生效。
function authorityScriptHit(cmd) {
  const toks = splitCommandTokens(String(cmd || ''));
  const own = ownPackage();
  const bases = candidateBases();
  for (let i = 0; i < toks.length; i++) {
    const t = trimPathPunct(toks[i]);
    if (!isPathToken(t)) continue;
    const prev = i > 0 ? toks[i - 1].toLowerCase() : '';
    const expanded = expandHome(t).replace(/\\/g, '/').trim();
    if (!expanded) continue;
    const cands = [];
    if (/^[a-z]:\//i.test(expanded) || expanded.startsWith('/')) {
      cands.push(expanded);
    } else {
      for (const b of bases.workspace) cands.push(b + '/' + expanded);
      if (EXEC_COMMANDS.has(prev)) {
        if (!/[\\/]/.test(expanded)) {
          if (bases.pkgScripts) cands.push(bases.pkgScripts + '/' + expanded);
        } else if (expanded.indexOf('scripts/') === 0 && bases.pkgRoot) {
          cands.push(bases.pkgRoot + '/' + expanded);
        }
      }
    }
    for (const c of cands) {
      const hit = ownPackageAuthority(c, { packageName: own.name, names: AUTHORITY_SCRIPTS });
      if (hit) return hit;
    }
  }
  return '';
}

// ── 权限等级（契约 S13）────────────────────────────────
//
// tier 是**管理员授予的成员属性**，声明在项目级 .superagent/roster.json 里，
// 由父会话改 —— worker 无权改（派工闸门 1c 封掉 .superagent/ 的写授权）。
//
// full 等级的语义：**项目工作区内自由读写**，不必逐路径枚举白名单。
//   · 工作区内任何路径（读或写）→ 放行
//   · 工作区外路径 → 仍拦，且仍自动记账进待审清单（父会话可逐条批准）
//   · 账号级 / 对外不可逆动作 → 照旧硬拦（这与 tier 无关，是另一条线）
//
// 为什么不是「自动批准」：让被约束者自己决定边界 = 授权模型被拆掉。
// 这里自动的是**发现与记账**，批准权始终在父会话手里。
const memberName = (binding && (binding.agent_key || binding.agent)) || agentType;
// 等级取**绑定里的快照**，不再每次工具调用都重读名录（见 dispatchTier 的注释）。
const tier = String((binding && binding.tier) || dispatchTier(null, memberName));
const fullTier = tier === TIER_FULL;

// 权限等级的**快照**（F1-4）。
//
// 以前每次工具调用都重读 roster.json —— worker 若能在会话中途改自己的等级
// （绕过 CLI 的那条路），后面每一次判定都按新等级走，一次提权就长期有效。
// 快照让「会话中途自提权」对**当前会话**无效：下一个派工才按新等级生效。
//
// 兜底：派工记录里没有等级字段（升级前的旧派工）时按名录读一次并**冻结**进绑定 ——
// 旧绑定不该因为机制升级突然掉回 scoped。
function dispatchTier(dispatchRec, agentKey) {
  const snap = dispatchRec ? String(dispatchRec.tier || '') : '';
  if (snap === TIER_FULL || snap === TIER_SCOPED) return snap;
  return memberTier(agentKey) === TIER_FULL ? TIER_FULL : TIER_SCOPED;
}

function inAllowed(target, m) {
  // full 等级 = 项目工作区内自由读写，**但 .superagent/ 除外**。
  // 那目录装着每个成员自己的错题本与方法论、以及权限等级名录 ——
  // 放开它就等于让 full 成员改兄弟成员的记录、自己给自己提权，
  // 正是「成员互相篡位」那条路。成员自己那份走 exactPaths，与本判定无关。
  if (fullTier && withinWorkspace(target) && !touchesSuperagentPath(target)) return true;
  return inScope(scope, target, m) || allowedByExact(target);
}

// 越界拦截：除了拒绝，还要**自动记账**（权限自动审核的第一环）。
// worker 撞墙后不必自己汇报「我要读什么、被拒了什么」——
// 父会话查台账（scope-amend.mjs --list）就知道，并可一键批准扩权。
//
// 自动的是**发现与记账**；**批准权仍在父会话手里** ——
// 让被约束者自己决定边界，等于把授权模型整个拆掉。
function denyOutOfScope(reason, outside, mode, opts) {
  // approvable=false：这条请求**批准了也不会生效** —— 不给批准提示，
  // 免得把父会话引去做一次注定无效的批准。
  const approvable = !(opts && opts.approvable === false);
  let reqId = '';
  try {
    reqId = recordScopeRequest(ledger, {
      dispatch_id: (binding && binding.dispatch_id) || '',
      agent: (binding && (binding.agent_key || binding.agent)) || agentType,
      session_id: sessionId,
      tool,
      mode,
      tier,
      targets: outside
    });
    writeLedger(ledger);
  } catch (e) {
    // 记账失败也不放过越界 —— 记账只是附加信息，拒绝才是主判定。
  }
  let amendCmd = 'scope-amend.mjs';
  try {
    const root = path.dirname(path.dirname(String(process.argv[1] || '')));
    if (root) amendCmd = path.join(root, 'scripts', 'scope-amend.mjs');
  } catch (e) {}
  const hint = !approvable
    ? '（该目标**批准也不会生效**：写权限对编排层私有状态目录一律不授 —— 请让父会话改派工范围或直接改 SCOPE，不要在这里申请批准）'
    : reqId
      ? '（已记入待审清单 ' + reqId + '。批准命令：' + amendCmd + ' --grant ' + reqId +
        ' —— **这条命令只有父会话能执行**：它是父会话专属的权限入口，worker 自行执行会被护栏直接拒绝）'
      : '（越界请求未能记账：请父会话直接改 SCOPE 后重新派工）';
  deny(reason + hint);
}

// 越界目标的**分型诊断**（F3）。
//
// 为什么要分型：full 等级命中编排层私有状态目录时，说成「在工作区之外」是错的诊断
//（目标其实在工作区内），而「批准该路径后重试」的建议**永远不生效**
//（写模式对私有目录一律不授写权）—— 会把父会话引去做无效批准、worker 反复撞墙。
//
// 返回 { reason, approvable }：
//   approvable=false → 这条请求批准了也不会生效，所以**不给批准提示**。
//   工作区外的路径能逐条批准；私有目录的**写**不能；私有目录的**读**能
//   （只读条目精确生效）；full 等级一律不给批准提示。
function outOfScopeVerdict(outside, mode) {
  const privMem = outside.filter((t) => isPrivateMemoryPath(t));
  const priv = outside.filter((t) => touchesSuperagentPath(t) && !isPrivateMemoryPath(t));
  const far = outside.filter((t) => !touchesSuperagentPath(t));
  const parts = [];
  if (privMem.length) {
    parts.push('目标 ' + privMem.slice(0, 5).join(', ') +
      ' 在成员的**私有记忆目录**（.superagent/lessons、.superagent/methods）下 —— ' +
      '范围层**一律不授予**（契约 S13.4）：读请求同样不放行，扩权也不会生效；' +
      '需要它的内容请让 Router 转写进 brief（契约通道），不要走扩权');
  }
  if (priv.length) {
    parts.push((fullTier
      ? '该成员是 full 等级（项目工作区内自由读写），但目标 '
      : '目标 ') + priv.slice(0, 5).join(', ') +
      ' 在编排层私有状态目录（.superagent/）内' +
      (fullTier ? ' —— **full 等级也不放行**' : '，不在白名单内') +
      '（该目录存着成员的权限等级与彼此的错题本，写权限对私有目录一律不授）');
  }
  if (far.length) {
    parts.push((fullTier
      ? '该成员是 full 等级（项目工作区内自由读写），以下路径在**工作区之外**'
      : '本次派工声明的 SCOPE 为 [' + scope.join(', ') + ']，以下路径不在白名单内') +
      '：' + far.slice(0, 5).join(', '));
  }
  // 能不能批准：工作区外的路径能（逐条批准）；**私有记忆目录一律不能**
  // （范围层不授予，扩权入口也会拒 —— 给了就是一条永远不生效的死条目）；
  // .superagent/ 根下的**读**请求能（精确文件条目精确生效），写不能；
  // full 等级一律不给批准提示。
  const approvable = far.length > 0
    ? true
    : (privMem.length > 0 ? false
      : (fullTier ? false : (mode === 'read' && priv.length > 0)));
  return {
    reason: '[super-agent-router] 越界拦截：' + parts.join('；') +
      (got && got.mode === 'read' && !fullTier ? '（读操作允许范围为 scope 所在目录树）' : '') +
      '。如确需修改，先更新 scope 并重新派工，不要自行扩大范围。',
    approvable
  };
}

// ── 取目标 ────────────────────────────────────────────
// glob / grep 的判定对象是「有效检索根」（显式 path 优先，缺省用当前工作区），
// 不是 pattern 本身（S3）。以前拿 pattern 当判定对象，
// 于是同一个 pattern 在不同 path 下结论不同，而 path 指向目录时反而被拦（D-22）。
function globRoot() {
  const p = String(tInput.path || tInput.directory || tInput.dir || '').trim();
  if (!p) return workspaceRoot();
  return p.replace(/\\/g, '/').replace(/\/+$/, '') || workspaceRoot();
}

function targetsOf() {
  if (kind === 'composite') {
    const code = String(tInput.code || tInput.program || tInput.script || '');
    const inner = dangerousInCode(code);
    if (inner) {
      deny('[super-agent-router] 已拦截：' + inner + '。' +
        '这类动作必须由用户亲自发起或明确授权，worker 不得自行执行。');
    }
    // 复合层只判危险操作，不判作用域（契约 S3 / S5.4）。
    //
    // 为什么不再对代码文本扫路径：
    //   以前这里用 extractPathTokens(code) 对整段代码文本抽路径 token，
    //   于是注释里出现一个路径、字符串常量里出现一个路径、引号命令里出现一个斜杠，
    //   整次 run_code 就被判成越界；纯算术代码更是直接撞上「取不到目标就 deny」
    //   被拒 —— 实测坐实的大面积误伤（验收 V-02 / V-04 / V-07）。
    //
    // 为什么作用域交回内层调用：
    //   内层 tools.write / tools.edit / tools.bash 各自会触发 PreToolUse，
    //   判定对象是真实实参，比扫描整段代码文本精确得多，边界照样守得住。
    //
    // 为什么这里不套「取不到目标就 deny」：
    //   那条规则防的是写通道失守（写类工具拿不到目标路径 = 没判定）。
    //   复合工具的载荷是自由文本代码，「取不到路径 token」对纯计算代码是正常形态，
    //   不是失守 —— 拿它当拒绝理由就是误伤。
    return { mode: 'composite', targets: [], raw: code, composite: true };
  }
  if (tool === 'bash') {
    const cmd = String(tInput.command || '');
    const readOnly = isReadOnlyCommand(cmd);
    const m = readOnly ? 'read' : 'write';
    const toks = extractPathTokens(cmd);
    const targets = readOnly ? toks : [...new Set([...toks, ...extractWriteTargets(cmd)])];
    return { mode: m, targets, raw: cmd, readOnly };
  }
  if (tool === 'glob' || tool === 'grep' || tool === 'search') {
    return { mode: 'read', targets: [globRoot()], raw: globRoot() };
  }
  const keys = kind === 'write' ? WRITE_PATH_KEYS : READ_PATH_KEYS;
  const targets = [];
  for (const k of keys) {
    if (!(k in tInput)) continue;
    const v = tInput[k];
    if (typeof v === 'string' && v.trim()) targets.push(v.trim());
    else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string' && x.trim()) targets.push(x.trim());
    }
  }
  return { mode, targets, raw: targets.join(', ') };
}

const got = targetsOf();

// 复合工具（run_code）：危险操作判定已在 targetsOf 里完成。
// 作用域判定交回内层调用 —— 这里既不扫代码文本，也不套「取不到目标就 deny」。
if (got.composite) {
  allow(injected);
  process.exit(0);
}

const targets = got.targets.filter((t) => String(t || '').trim());

// ── bash：命令里可能藏着多个路径，逐个检查 ──────────────
// bash 必须单独处理，不能套用「取不到目标就 deny」：
// 读命令（git status）与无路径的普通命令（node -e "console.log(...)"）
// 本来就没有路径 token，套进去会把正常命令全拦掉。
if (tool === 'bash') {
  const cmd = String(tInput.command || '');
  // 权威面脚本：父会话专属（F1 主防线）。
  //
  // 为什么放在最前面：这些脚本内部自己写名录 / 台账 / 错题本，护栏对脚本内部的写入
  // 没有判定能力（契约 S13.5）—— 判它们**被谁执行**是唯一能拦住的判定。
  // 父会话不受影响（载荷里没有 agent_type，上面已早退）。
  const authorityHit = authorityScriptHit(cmd);
  if (authorityHit) {
    deny('[super-agent-router] 已拦截：子代理执行了**父会话专属的权威面脚本**（权限/记录入口：' + authorityHit + '）。' +
      '这类脚本内部直接写名录 / 派工台账 / 错题本，护栏对「脚本内部发生的写入」没有判定能力' +
      '（契约 S13.5：hook 是护栏不是沙箱）—— 所以它们**只允许父会话执行**。' +
      '要提权或批准扩权，让父会话执行它那条命令（拦截文案里会给全）；' +
      'worker 自行执行会被这条规则直接拒绝，**即使 SCOPE 覆盖了插件目录**。');
  }
  // 命令替换（$(...) / 反引号）里的内容会被 shell 真的执行，
  // 所以带替换的命令不能按「纯读命令」算 ——
  // cat $(mavis agent delete x) 的段首是 cat，但删成员的是替换里那条命令。
  const substitution = hasCommandSubstitution(cmd);
  if ((!got.readOnly || substitution) && DANGEROUS_COMMAND.test(cmd)) {
    deny('[super-agent-router] 已拦截：命令包含对外可见的不可逆动作（' +
      (cmd.match(DANGEROUS_COMMAND) || [''])[0] + '）。' +
      '这类动作必须由用户亲自发起或明确授权，worker 不得自行执行。');
  }
  // 账号级 / 对外不可逆动作的命令形态判定（D-25）。
  //
  // 为什么必须单独一条：dangerousByArgs 按「工具名 + 参数」判定，只认 mavis / miniapp
  // 两个工具名；bash 通道的工具名是 bash，走不到那条分支。而 mavis 是本机真实存在的
  // CLI，命令文本会被 shell 真的执行 —— 于是 bash 成了账号级动作的旁路。
  //
  // 为什么不能指望复合层（run_code）兜底：容器调用的 PreToolUse 派发**不是平台恒定行为**
  // —— 同一份纯计算容器代码，2026-11-10 10:22 的子会话没被派发（日志探针实测：同会话的
  // 容器内 read 有条目、外层 run_code 无条目），14:29 与 15:10 的子会话却被派发并当场拒答。
  // 派发与否随会话而变 ⇒ 复合层只能当纵深防御的加成，不能当唯一防线，
  // 危险操作必须在各内层调用自己的判定里做到位。
  //
  // 为什么只按「命令形态」匹配、不按字样匹配：bash 是自由文本，
  // rm build/out.txt 这类普通路径操作里出现 delete/remove 太常见，按字样拦会大面积误伤。
  //
  // 放在这一处、且在「写命令取不到目标路径」那条兜底之前：
  // `mavis agent delete sa-x` 一个路径 token 都没有，兜底那条本来就拦不住它。
  if (!got.readOnly || substitution) {
    const acct = detectDangerousAccountCommand(cmd);
    if (acct) {
      deny('[super-agent-router] 已拦截：命令包含账号级 / 对外不可逆动作（' +
        acct.matched + '）：' + acct.reason + '。' +
        '这类动作必须由用户亲自发起或明确授权，worker 不得自行执行。');
    }
  }
  // 写命令却一个目标都识别不出来 -> 无法验证是否越界 -> 拒绝。
  // 以前这里直接 process.exit(0)，整条写通道等于没设防（D-02）。
  // full 等级成员的边界 = 工作区本身，不再需要逐路径判定；
  // 危险命令与账号级动作在上游已经拦过，这里豁免「识别不出目标路径」这一条。
  if (!got.readOnly && !targets.length && hasWriteVerb(cmd) && !fullTier) {
    deny('[super-agent-router] 越界拦截：命令里有写操作，但一个可判定的目标路径都识别不出来，' +
      '无法验证是否越界。命令：' + cmd.slice(0, 160) +
      '。请改成能识别出目标路径的写法，或先更新 scope 再派工。');
  }
  const outside = targets.filter((t) => !inAllowed(t, got.mode));
  if (outside.length) {
    const verdict = outOfScopeVerdict(outside, got.mode);
    denyOutOfScope(verdict.reason, outside, got.mode, { approvable: verdict.approvable });
  }
  allow(injected);
  process.exit(0);
}

// 取不到目标 -> deny（D-16）。
// 已知写类工具却拿不到路径，说明载荷形状变了或者工具坏了，
// 这种情况下「放行」等于没有判定。
if (!targets.length) {
  deny('[super-agent-router] 越界管控无法执行：' + tool + ' 没有可判定的目标路径。' +
    '取不到目标就放行 = 这次调用完全绕过了越界判定，故拒绝。');
}

// 已在 scope 内 -> 放行
if (targets.every((t) => inAllowed(t, got.mode))) {
  allow(injected);
  process.exit(0);
}

// 其它工具：目标必须在白名单内
const outside = targets.filter((t) => !inAllowed(t, got.mode));
if (outside.length === 0) {
  allow(injected);
  process.exit(0);
}
const verdict = outOfScopeVerdict(outside, got.mode);
denyOutOfScope(verdict.reason, outside, got.mode, { approvable: verdict.approvable });
