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
import {
  readStdin, parseInputStrict, readLedger, writeLedger, inScope,
  findBinding, upsertBinding, readBriefFromTranscript, scopeOverlaps,
  workspaceRoot, resolveAgentKey, isPathToken, extractPathTokens,
  splitCommandTokens, isReadOnlyCommand, extractWriteTargets, hasWriteVerb,
  DANGEROUS_COMMAND, detectDangerousAccountCommand, hasCommandSubstitution
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
  upsertBinding(ledger, binding);
  writeLedger(ledger);
  // 把该成员的历史教训送进 worker 上下文（D-06）：
  // 以前 lessons 只挂在父会话的 additionalContext 上，子会话永远收不到，
  // 除非 Router 手工抄进 brief —— 那不是机制保障，是靠自觉。
  if (d && Number(d.lesson_count || 0) > 0 && Array.isArray(d.lessons) && d.lessons.length) {
    injected = '[super-agent-router] ' + (d.agent_key || d.agent || '该成员') + ' 的历史教训（开工前先看）：\n' +
      d.lessons.map((r, i) => (i + 1) + '. ' + r).join('\n');
  }
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

function inAllowed(target, m) {
  return inScope(scope, target, m) || allowedByExact(target);
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
  if (!got.readOnly && !targets.length && hasWriteVerb(cmd)) {
    deny('[super-agent-router] 越界拦截：命令里有写操作，但一个可判定的目标路径都识别不出来，' +
      '无法验证是否越界。命令：' + cmd.slice(0, 160) +
      '。请改成能识别出目标路径的写法，或先更新 scope 再派工。');
  }
  const outside = targets.filter((t) => !inAllowed(t, got.mode));
  if (outside.length) {
    deny('[super-agent-router] 越界拦截：本次派工声明的 SCOPE 为 [' +
      scope.join(', ') + ']，以下路径不在白名单内：' + outside.slice(0, 5).join(', ') +
      '。如确需修改，先更新 scope 并重新派工，不要自行扩大范围。');
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
const reason = '[super-agent-router] 越界拦截：本次派工声明的 SCOPE 为 [' +
  scope.join(', ') + ']，目标 ' + outside.slice(0, 5).join(', ') + ' 不在白名单内' +
  (got.mode === 'read' ? '（读操作允许范围为 scope 所在目录树）' : '') + '。' +
  '如确需操作，先更新 scope 并重新派工，不要自行扩大范围。';
deny(reason);
