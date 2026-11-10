// PreToolUse (task)：派工登记 + 组队闸门 + 教训前置 + 履历参考
//
// 五个职责：
//   1. 闸门一：派工必须带 SCOPE 白名单（不带就拒 —— 否则整个授权模型形同虚设）
//   2. 闸门二：SCOPE 不得与仍在飞的派工重叠（两个 worker 写同一处会互相覆盖）
//   3. 闸门三：单会话派工数设上限（并发在飞 + 累计）
//   4. 记录每次派工的 scope，供 guard.mjs 做越界判定
//   5. 把目标成员的历史教训前置给 Worker，把实战记录带给 Router 参考
//
// 第 5 步是「自我进化」真正生效的位置：
// 不是事后修补，而是让 Worker 开工前就知道上次同类任务栽在哪儿。
import {
  readStdin, parseInputStrict, updateLedger, extractScopeDetail,
  activeDispatches, activeDispatchesAll, totalDispatches, dispatchedTotal,
  bumpDispatchCounter, scopeClash, workspaceRoot, projectRoot,
  MAX_ACTIVE_DISPATCHES, MAX_TOTAL_DISPATCHES,
  resolveAgentKey, extractBriefMarkers, reapExpiredDispatches, normScopeEntry,
  touchesSuperagentPath, memberTier, TIER_FULL, TIER_SCOPED,
  isPrivateMemoryEntry, PRIVATE_MEMORY_DIRS,
  accountMemberNames, accountMemberExists, rosterMemberNames, staleRosterMembers,
  readRoster, writeGateTrace
} from './lib.mjs';
import { readLessons, countEntries, readRecords, lessonsStatusLine } from './lessons.mjs';

const rawStdin = readStdin();
const parsed = parseInputStrict(rawStdin);
if (!parsed.ok) {
  // 载荷坏了 -> 派工无法登记（台账里查不到在飞记录）-> 拒绝，不做「什么都没发生」的放行。
  if (!String(rawStdin || '').trim()) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '[super-agent-router] 派工无法登记：' + parsed.reason +
        '。载荷解析不出来 = 派工台账记不下这次派工，此处不放行。'
    }
  }));
  process.exit(0);
}
const input = parsed.value;
const tool = String(input.tool_name || '');
if (tool.toLowerCase() !== 'task') process.exit(0);

const tInput = input.tool_input || {};
const prompt = String(tInput.prompt || '');
const scopeDetail = extractScopeDetail(prompt);
const scope = scopeDetail.entries;

// 发起方会话 = 父会话（Router）。worker 在子会话里跑，父会话不该被 worker 的 scope 约束。
const sid = String(input.session_id || '');
const tid = String(input.turn_id || '');
const toolUseId = String(input.tool_use_id || '');
const now = Date.now();
const project = projectRoot();

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

// === 闸门 1：派工必须声明 scope ===
// 不带 scope 的派工会让 guard 完全失去判定依据（无白名单 = 无边界），
// 等于把授权模型整个绕开。所以这里直接拒绝。
if (!scope.length) {
  deny('[super-agent-router] 派工缺少 SCOPE 白名单，拒绝派发。' +
    'brief 必须逐条写明可改动的具体路径，例如：' +
    'SCOPE: src/app.ts, src/util.ts（目录要写成 src/app/ 才涵盖其下所有文件；只读要写成 ro: src/app/）。' +
    '没有白名单就没有边界，越界拦截会失效。');
}

// SCOPE 行里有「长得像路径却解析不出来」的条目 -> 拒绝。
// 以前这类条目被悄悄丢掉，白名单比派工意图窄，
// 窄掉的部分等于无人看管 —— 漏收即放行（D-07）。
if (scopeDetail.rejected.length) {
  deny('[super-agent-router] 派工的 SCOPE 行里有无法解析的条目：' +
    scopeDetail.rejected.slice(0, 5).join(', ') +
    '。白名单漏收 = 越界管控范围被静默缩小，请把这些条目写成规范路径后重新派工。');
}

// === 闸门 1b：SCOPE 不得越权授予「他人的私有记忆」 ===
//
// .superagent/lessons/ 与 .superagent/methods/ 装的是**每个成员自己的**记忆：
// 错题本 = 栽过哪，方法论 = 怎么做事。读模式按「目录条目所在目录树」放宽，
// 所以一旦把整个目录写进 SCOPE，worker 就能读到**兄弟成员的错题本全文**与
// **Router 私有账 _router.md**。
// 独立验收实测复现（本轮 sa-context-trace）：读兄弟成员规则全文与 _router.md 94 行，均未被拦。
// 方向是「教训被窃取而非分发」—— 用户担心的「成员互相篡位」正是这条。
//
// 而这些权限**本来就不需要写进 SCOPE**：guard 对被派工成员自己的方法论与错题本
// 按**精确文件**单独放行（guard.mjs 的 exactPaths），与 SCOPE 无关。
// 所以把整个目录写进 SCOPE 只有一个效果：越权授予他人记忆。
// 判据用 lib.mjs 的共享函数（isPrivateMemoryEntry）——
// 与护栏第二道防线、范围层同一口径，免得两处各判各的、慢慢长歪（D-58）。
for (const raw of scope) {
  if (!isPrivateMemoryEntry(raw)) continue;
  const p2 = normScopeEntry(raw);
  const hit = PRIVATE_MEMORY_DIRS.find((m) => p2 && (p2.path === m || p2.path.startsWith(m + '/'))) || '私有记忆目录';
  {
    deny('[super-agent-router] 派工的 SCOPE 覆盖了成员的私有记忆目录（' + hit + '/）—— 拒绝派发。' +
      '该目录装的是每个成员自己的错题本与方法论。读模式按目录树放宽，' +
      '而文件条目的读范围是它**所在的目录** —— 所以哪怕只写某个成员的文件，' +
      '读范围也会覆盖整个目录，写进白名单等于让 worker 读到**兄弟成员的错题本全文**与 Router 私有账。' +
      '不需要写进 SCOPE：被派工成员自己的方法论与错题本由 guard 按精确文件单独放行，与 SCOPE 无关。' +
      '若确实要把某成员的记录给 worker，请走「Router 转写进 brief」这条契约通道。');
  }
}
// === 闸门 1c：SCOPE 不得覆盖 .superagent/ 下的任何条目 ===
//
// D-31 只封了 lessons/ 与 methods/ 两个目录，但**同一个漏洞在别的条目上照样成立**：
// 读模式下，文件条目的读范围 = 它**所在的目录**（inScope 的 treeRoot 规则）。
// 所以只写一条 roster.json 的只读条目，读范围也是整个 .superagent/ ——
// 能读到兄弟成员的错题本全文与方法论全文，与直接写 lessons/ 目录效果一样。
//
// 写权限更危险：.superagent/roster.json 存着成员的**权限等级（tier）**。
// worker 能改它 = 自己给自己提权 = 授权模型当场被拆掉。
//
// 所以这里按「目录树」整体封，而不是按具体文件封：
//   · 读权限：worker 不需要读 roster（路由是 Router 的事）；
//     它自己的方法论与错题本走 guard 的 exactPaths，与 SCOPE 无关。
//   · 写权限：权限等级的变更必须由父会话（管理员）执行，不在 worker 手里。
//
// 诚实边界（别写成「绝对安全」）：hook 是护栏不是沙箱 —— worker 若能执行一段
// 落盘的脚本，脚本内部的 fs 写入不受本判定约束。那一层的兜底是运行时权限 +
// 人工确认 + .superagent/changes.log 的审计留痕。
for (const raw of scope) {
  const p2 = normScopeEntry(raw);
  if (!p2) continue;
  if (!touchesSuperagentPath(p2.path)) continue;
  if (p2.isDir) {
    deny('[super-agent-router] 派工的 SCOPE 覆盖了编排层的私有状态目录（.superagent/）—— 拒绝派发。' +
      '目录条目会把整棵 .superagent/ 展开成可读范围，' +
      '于是能读到兄弟成员的错题本全文与方法论全文（这正是「成员互相篡位」的那条路）。' +
      '需要读编排层状态文件时，请逐个文件写成只读条目（ro: .superagent/roster.json），' +
      '那种写法**精确生效**、不展开目录树。');
  }
  if (!p2.readOnly) {
    deny('[super-agent-router] 派工的 SCOPE 给了编排层私有状态目录（.superagent/）的**写**权限 —— 拒绝派发。' +
      '该目录存着成员的**权限等级（tier）**，写它等于自己给自己提权 = 授权模型当场被拆掉。' +
      '只读条目（ro: ）可以，逐个文件写；写权限不行。');
  }
}

// === 闸门 1d：目标成员必须存在于账号（D-37）===
//
// 为什么这道闸门必须有：派工到「账号里不存在的成员」**不会启动子会话**，
// 但台账照样会写一条 state:'active' ——
// ① 占掉一个并发名额与一个累计名额；
// ② 同 SCOPE 的后续派工被「组队冲突」误拦；
// ③ 教训与履历照常注入 brief，外观完全正常 ⇒ **静默失效**（最长 2 小时）。
// 所以必须在**写台账之前**拦：拦晚了，台账里那条记录已经占住名额了。
//
// 账号名单只有一处计算（lib.mjs 的 accountMemberNames）——
// 注入侧披露的陈旧名单与这里拒绝的派工必须是同一份口径，两处各算各的迟早长歪。
//
// 目标成员的解析提前到这里（闸门 1d 要用它）。
const agent = String(tInput.agent_name || '');
const promptAgent = extractBriefMarkers(prompt).agent;
const agentKey = resolveAgentKey({
  agentType: input.agent_type,
  promptAgent,
  toolAgentName: agent
});
const accountCtx = accountMemberNames();
const rosterCtx = readRoster();
const declaredMembers = rosterMemberNames(rosterCtx);
const targetMember = String(agentKey || agent || '');
// 降级标记（D-73）：账号名单不可得时这次派工的存在性**没有核验过**。
//   memberExistence —— account_verified（账号侧核验通过）
//                   / roster_declared（项目名录声明存在）
//                   / unverified（既没核验过、也没登记过）
//   degraded —— 是否进入「不占名额、不参与冲突判定」的降级口径
//   degradedScope —— 本次派工是否处在「名单不可得」的环境里
let memberExistence = 'account_verified';
let degradedFlag = false;
let degradedScope = false;
let degradedReason = '';
if (accountCtx.available) {
  if (!accountMemberExists(accountCtx.names, targetMember)) {
    const staleHit = declaredMembers.includes(targetMember);
    deny('[super-agent-router] 派工被拒：目标成员「' + targetMember + '」在账号里不存在' +
      (staleHit ? '（该成员在项目名录里登记过，账号侧没有 —— 这是**陈旧成员**）' : '') + '。' +
      '派工到一个不存在的成员不会启动子会话，却会占掉一个并发名额与一个累计名额，' +
      '并让同 SCOPE 的后续派工被「组队冲突」误拦 —— 外观看起来完全正常（**静默失效**）。' +
      '台账不会留下任何记录。请先在账号里建好该成员，或把它从项目名录里移除，再重新派工。' +
      '（账号成员目录：' + accountCtx.dir + '）');
  }
} else {
  // 账号名单读不出来 = **无法核验**目标成员是否存在（不是「成员不存在」）。
  //
  // 这里不因为「取不到」就拒掉整个派工：账号成员是**账号级事实**，
  // 没有账号环境的项目（测试夹具等）里根本没有这份名单 ——
  // 据此拒派等于让整套编排在没有账号环境的项目里全停摆，连正常派工都发不出去。
  // **这个取舍不推翻**（D-37 已定），但「我无法核验」这件事
  // 不许悄悄吃掉名额、也不许悄悄堵死后续派工（D-73）。
  //
  // 降级路径的三条口径：
  //   ① **不占名额、不参与 SCOPE 冲突判定** —— 降级派工的存在性没核验过，
  //      子会话可能根本没起来（派给不存在的成员不会启动子会话）。
  //      让它占名额 = 一次「名单取不到」就把并发名额与累计名额吃掉，
  //      还会让同 SCOPE 的后续派工被「组队冲突」误拦 —— 正是 D-73 说的静默失效。
  //   ② **名录内 / 名录外口径不同**：
  //      名录里登记过的成员 = 项目自己声明存在的（名录是项目级可审计资产）⇒ 照常派工，
  //      标记为 roster_declared；名录之外的成员 = 连项目都没声明 ⇒ 标记为 unverified，
  //      痕迹与回执都要更响。两者都**不占名额**（账号侧仍然不可核验）。
  //   ③ **父会话看得见**：台账记录上带 member_existence / counts_against_slots /
  //      degraded_reason 三个字段，痕迹写进 gate-trace.jsonl（带 session id、目标成员、原因），
  //      派工输出里也披露一段降级提示。
  // 降级口径的成立条件（D73-R1，理由见下）：
  //   账号名单不可得 **且** 项目**确实在用专项成员**
  //   （名录读得到且非空，或名录读不出来 —— 读不出来时更不能假设「项目没用专项成员」）。
  //
  // 为什么要有「项目在用专项成员」这一条：项目压根没用过专项成员时
  // （没有 roster.json，或名录为空），「派工目标是不是专项成员」这件事**不存在** ——
  // 这时把名额与冲突判定整个降级，等于让这些项目里的并发上限与组队闸门**全部失效**，
  // 而它们本来就不依赖「专项成员存在性」这条判定。
  //
  // 降级口径下的三条：
  //   ① **名录内成员照常派工**（roster_declared）：名录是项目级可审计资产，
  //      名录里登记过的成员**至少是项目自己声明存在的** ⇒ 照常占名额、照常参与冲突判定。
  //   ② **名录外成员降级**（unverified）：连项目都没声明它存在 ⇒
  //      **不占名额、不参与 SCOPE 冲突判定** ——
  //      它的存在性没核验过，子会话可能根本没起来（派给不存在的成员不会启动子会话）；
  //      让它占名额 = 一次「名单取不到」就吃掉并发名额与累计名额，
  //      还让同 SCOPE 的后续派工被「组队冲突」误拦（外观完全正常 ⇒ 静默失效）。
  //   ③ **父会话看得见**：台账记录带 member_existence / degraded 两个字段，
  //      痕迹写进 gate-trace.jsonl（带 session id、目标成员、原因、名录状态），
  //      降级口径成立时还在派工注入里披露一段降级提示。
  const rosterInUse = !rosterCtx.ok || declaredMembers.length > 0;
  const rosterDeclared = declaredMembers.includes(targetMember);
  degradedScope = rosterInUse;
  memberExistence = rosterDeclared ? 'roster_declared' : 'unverified';
  degradedFlag = rosterInUse && !rosterDeclared;
  degradedReason = accountCtx.error;
  writeGateTrace('account_member_list_unavailable',
    'session=' + sid + ' | target=' + targetMember +
    ' | existence=' + memberExistence +
    ' | degraded=' + degradedFlag +
    ' | slots=' + (degradedFlag ? 'false' : 'true') +
    ' | roster_in_use=' + rosterInUse +
    ' | ' + accountCtx.error);
}

// ── 台账登记：整个「读-改-写」在一个临界区里（D-77）────────
//
// 为什么整段搬进 updateLedger：
//   ① 闸门 2/3 的判定与「登记这条派工」必须**原子** —— 以前是「读台账 → 判定 → 写台账」，
//      两个并发派工可以**同时**通过冲突检测（各自都读到对方还没写进去的台账），然后各写一条，
//      闸门形同虚设。
//   ② 后写的那个会把先写的整条覆盖掉（D-77）：台账里**少一条**，而文件格式合法、内容看着正常，
//      读侧检测不出来 —— 丢的若是「在飞派工」那一条，「组队冲突」闸门就看不见它，
//      另一个 worker 就能被派去写同一处。
//
// 临界区里不许有子进程调用、网络调用、其它 I/O —— 所以错题本/履历在**锁外**读，
// 临界区里只做「读台账 → 判定 → 改台账 → 落盘」。
//
// 权限等级的**快照**（F1-4）：worker 操作的等级 = 派工时的等级。
// 为什么快照：worker 若能在会话中途改自己的等级（绕过 admin CLI 的那条路），
// 后面每一次判定都按新等级走，一次提权就长期有效。
// 快照让「会话中途自提权」对**当前会话**无效：下一个派工才按新等级生效。
const tierSnap = memberTier(agentKey) === TIER_FULL ? TIER_FULL : TIER_SCOPED;

// 抓目标成员的错题本规则
// （目标成员与 agentKey 已在闸门 1d 解析好 —— 那里先要拿它判存在性；
//   命名口径见 D-12：台账写 routing id，反查也用 routing id。）
const lessons = agentKey ? readLessons(agentKey) : (agent ? readLessons(agent) : []);
const lessonCount = agentKey ? countEntries(agentKey) : (agent ? countEntries(agent) : 0);

// 抓目标成员的实战记录（最近 3 条）
const records = agentKey ? readRecords(agentKey).slice(-3).reverse() : (agent ? readRecords(agent).slice(-3).reverse() : []);

const reg = updateLedger((cur) => {
  if (cur.readable === false) {
    return { deny: '[super-agent-router] 派工登记失败：' + (cur.error || '派工台账不可用') +
      '。台账读不出来就没法做冲突与名额判定，这里不放行。' };
  }

  // TTL 兜底（S6.2 第 2 条）：先把超龄的 active 记录判死，再看在飞名单。
  // 以前只有读取时过滤，台账里永远留着 state:'active' 的僵尸条目（D-10）。
  reapExpiredDispatches(cur, now);

  // === 闸门 2：SCOPE 重叠检测 ===
  // 两个仍在飞的 worker 写同一处 —— 后写的会覆盖先写的，
  // 而且验收时无法判断哪份改动是有效的。所以组队阶段就要拦。
  //
  // 比对集是「同一项目内所有在飞派工」，不只同一父会话：
  // 嵌套派工与第二个 Router 会话以前完全取不到对方的在飞记录（D-09）。
  //
  // **降级派工（degraded）不参与冲突判定**（D-73）：
  //   它的存在性没核验过 —— 它到底是「真在跑的 worker」还是「派给不存在成员的空记录」，
  //   机制分不出来。若拿它去撞别人的闸门，就会把**同 SCOPE 的后续派工误拦**
  //   （这正是 D-73 说的静默失效：外观完全正常，却把后续派工堵死两小时）。
  //   代价：两个降级派工之间不再互相挡 —— 这一条写进报告的残余风险。
  if (!degradedFlag) {
    const activeAll = activeDispatchesAll(cur, now, workspaceRoot());
    for (const d of activeAll) {
      const clash = scopeClash(d.scope, scope);
      if (clash.length) {
        return { deny: '[super-agent-router] 组队冲突：本次派工的 SCOPE 与仍在飞的 ' + (d.agent_key || d.agent) +
          ' 派工重叠（冲突路径：' + clash.slice(0, 5).join(', ') + '）。' +
          '两个 worker 同时写同一处会互相覆盖，验收也无从判断谁的改动生效。' +
          '要么等它结束再派，要么把范围拆开重写 SCOPE。' };
      }
    }
  }

  // === 闸门 3：单会话派工数上限 ===
  // 编排不是撒网。派工数失控通常意味着任务没拆干净，或者在用派工代替思考。
  const active = activeDispatches(cur, sid, now);
  if (active.length >= MAX_ACTIVE_DISPATCHES) {
    return { deny: '[super-agent-router] 派工超限：本会话同时在飞的派工已达 ' + active.length +
      ' 个（上限 ' + MAX_ACTIVE_DISPATCHES + '）。' +
      '先收拢已完成的任务再派新的 —— 如果确实需要更多并行，先把任务拆细、明确各自边界。' };
  }
  const total = dispatchedTotal(cur, sid);
  // 累计上限默认是硬编码的 30（D-69）。
  //
  // 为什么留一个**管理员可调的口子**：这个上限的作用是拦住「撒网式派工」，
  // 不是拦住「一轮做完又要做下一轮」的正常节奏。上限一旦写死，父会话在长轮次里
  // 会被自己的历史锁死 —— 而新开一个父会话往往不在人的控制范围内（桌面端一轮对话
  // 就是一次会话）。管理员要能**显式、留痕**地抬高它，而不是让机制自己悄悄失效。
  //
  // 口径：台账顶层的 limits.max_total_dispatches 存在且为正数时用它，否则用默认值；
  // 抬高这件事本身由管理员在台账里落笔（台账本身就是留痕），并在提示里写明当前用的是哪个值。
  const adminCap = Number(((cur.limits || {}).max_total_dispatches) || 0);
  const totalCap = adminCap > 0 ? adminCap : MAX_TOTAL_DISPATCHES;
  if (total >= totalCap) {
    return { deny: '[super-agent-router] 派工超限：本会话累计派工已达 ' + total +
      ' 个（上限 ' + totalCap + (adminCap > 0 ? '，管理员已显式抬高（D-69）' : '') + '）。' +
      '一个会话的组队规模应该收敛；新的任务组请开新会话。' };
  }

  // 写台账
  // 去重键（S6.1）：父会话 + agent + (turn_id || tool_use_id)。
  // 以前只用 turn_id，载荷缺该字段时 tid 为空串，
  // 「空串 === 空串」对所有历史记录成立 —— 同一父会话里前一个 worker 的整条记录
  // 被抹掉，它的 scope 从台账消失，冲突检测与名额统计同时失真（D-05）。
  // 两者都拿不到时不去重：宁可多一条记录，也绝不抹掉别的 agent / 别的 turn 的记录。
  const turnKey = tid || toolUseId;
  let dispatchId = '';
  const existing = turnKey ? (cur.dispatches || []).find((d) =>
    String(d.parent_session_id || '') === sid &&
    String(d.agent_key || d.agent || '') === agentKey &&
    String(d.turn_key || d.turn_id || '') === turnKey &&
    (d.state || 'active') === 'active') : null;
  if (existing) {
    // 同名键只允许覆盖完全相同的那一条（原地覆盖，保留 dispatch_id，
    // 这样 worker 的绑定仍能反查到这条记录）
    existing.scope = scope;
    existing.agent = agent;
    existing.agent_key = agentKey;
    existing.project = project;
    existing.tool_use_id = toolUseId;
    existing.lessons = lessons;
    existing.lesson_count = lessonCount;
    existing.tier = tierSnap;
    existing.at = now;
    // 同名键只允许覆盖**完全相同**的那一条 —— 存在性口径是**首次登记时的事实**，
    // 不许被后来的重放改写（口径会漂）。这里读一次旧值。
    if (!existing.member_existence) existing.member_existence = memberExistence;
    if (existing.degraded === undefined) existing.degraded = degradedFlag;
    dispatchId = existing.dispatch_id;
  } else {
    dispatchId = 'dsp_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    cur.dispatches.push({
      dispatch_id: dispatchId,
      parent_session_id: sid,
      turn_id: tid,
      turn_key: turnKey,
      tool_use_id: toolUseId,
      agent,
      agent_key: agentKey,
      project,
      scope,
      lessons,
      lesson_count: lessonCount,
      tier: tierSnap,
      // 成员存在性的口径（D-73）：
      //   account_verified —— 账号名单可得且核验通过（正常路径）
      //   roster_declared —— 账号名单不可得，但该成员在项目名录里登记过（项目自己声明存在）
      //   unverified       —— 既没在账号侧核验过，项目名录里也没有
      member_existence: memberExistence,
      // 降级口径的记录**不占名额、不参与 SCOPE 冲突判定**：
      // 它的存在性没核验过，子会话可能根本没起来 ——
      // 让它占名额就是 D-73 说的那种静默失效（占名额 + 堵后续派工 + 外观完全正常）。
      degraded: degradedFlag,
      state: 'active',
      at: now
    });
    // 累计派工额度用持久化计数器（D-19）：台账截断到 200 条之后，
    // 靠扫台账算出来的累计数会偏低，30 条上限就形同虚设了。
    //
    // 降级路径（D-73）**不** bump 计数器 —— 降级派工的存在性没核验过，
    // 它不该吃掉一个累计名额（否则一次「名单取不到」就少一条额度，
    // 而子会话可能根本没起来，额度却永远回不来）。
    if (!degradedFlag) bumpDispatchCounter(cur, sid);
  }
  cur.dispatches = cur.dispatches.slice(-200);
  return { result: { dispatchId } };
});
if (!reg.ok) {
  deny('[super-agent-router] 派工登记失败：' + (reg.error || '台账写入失败') + '（' + reg.code + '）。' +
    '台账写不进去 = 在飞派工不可见、冲突与名额判定失真，此处不放行。');
}
if (reg.deny) deny(reg.deny);
const dispatchId = String((reg.result && reg.result.dispatchId) || '');

const blocks = [];
// 降级披露（D-73）：账号名单不可得时，这次派工的存在性**没有核验过**。
// 不许静默 —— 这段话进子会话上下文，痕迹进 gate-trace.jsonl，台账字段给父会话查。
if (degradedScope) {
  blocks.push('[super-agent-router] 【降级提示】账号成员名单不可得 ⇒ 本次派工**没有核验**目标成员「' +
    targetMember + '」是否存在（' + memberExistence + '）。' +
    (memberExistence === 'roster_declared'
      ? '该成员在项目名录里登记过 ⇒ 按项目自己的声明照常派工（照常占名额、照常参与 SCOPE 冲突判定）。'
      : '该成员**不在项目名录里**，账号侧又不可核验 ⇒ 这次派工完全无法确认能否启动子会话；' +
        '这条派工在台账里标记为**不占名额、不参与 SCOPE 冲突判定**。') +
    '（原因：' + degradedReason + '）账号名单可用时，派给不存在的成员会被直接拒绝。');
}
// 教训前置：空集合也要显式说「0 条」。
// 「没有错题本」与「错题本没送达」在下游必须能区分开（D-18）：
// 前者是没栽过跟头，后者是链路故障，处理方式完全不同。
if (lessons.length) {
  const l2 = ['[super-agent-router] ' + (agentKey || agent) + ' 的历史教训（派工时必须写进 brief）：'];
  lessons.forEach((r, i) => l2.push((i + 1) + '. ' + r));
  blocks.push(l2.join('\n'));
} else {
  // 三态（无错题本 / 文件已建但无条目 / 有条目却抽不出规则）由 lessons.mjs 统一出口。
  // 注入层别自己拼文案 —— 否则「内容在但抽不出」会被谎报成「还没栽过跟头」（D-50）。
  blocks.push(lessonsStatusLine(agentKey || agent));
}
if (records.length) {
  const l2 = ['[super-agent-router] ' + (agentKey || agent) + ' 的实战记录（该成员此前验收通过的成果，可作方法参考）：'];
  records.forEach((r) => {
    l2.push('- ' + r.title + (r.approach ? ' —— ' + r.approach : '') + (r.evidence ? '（证据：' + r.evidence + '）' : ''));
  });
  blocks.push(l2.join('\n'));
} else {
  blocks.push('[super-agent-router] ' + (agentKey || agent) + ' 的实战记录：0 条' +
    '（该成员暂无验收通过的成果）。');
}

// ── 会话复用提示（契约 S4.5）────────────────────────────────
//
// 为什么要在这里提示：新开一个子会话 = 那位成员要**重新读一遍**它需要读的东西
// （方法论、契约、台账、相关脚本、既有报告）。同一专项的连续工作反复重开，
// 上下文预算就被「重复读仓库」吃掉，窗口越堆越多。
//
// 判据只有一条：**该成员是否已有一个会话，其 binding.scope 覆盖本单要动的路径**。
// 覆盖 ⇒ 那个会话的上下文已经加载了这些文件 ⇒ 追加即可，不必重开。
//
// 这只是**提示**，不阻断派工 —— 边界不同、专项不同、上下文太旧的情况都该新开。
// 阻断会让「为了省上下文」变成「为了让机制闭嘴」，那是本末倒置。
//
// ⚠️ 复用要**人/父会话**用追加的方式去做；派工闸门只负责把「有得复用」这件事说出来。
const reusable = (reg.ledger.bindings || []).filter((b) => {
  // 必须有 session_id —— 没有会话就没有可追加的上下文。
  if (!b || !b.session_id) return false;
  if (String(b.agent_key || b.agent || '') !== String(agentKey || agent || '')) return false;
  const bs = Array.isArray(b.scope) ? b.scope : [];
  if (!bs.length) return false;
  // 本单 scope 的每个路径，都要被该 binding 的某条目覆盖（或该 binding 是 full 等级）。
  return scope.every((entry) => bs.some((e) => {
    const raw = String(e || '').replace(/^ro:\s*/, '');
    const t = String(entry || '').replace(/^ro:\s*/, '');
    if (!raw || !t) return false;
    if (raw === '*') return true;
    const rr = raw.replace(/\\/g, '/').toLowerCase();
    const tt = t.replace(/\\/g, '/').toLowerCase();
    if (rr === tt) return true;
    // 条目是目录（以 / 结尾）⇒ 覆盖其下所有路径
    return rr.endsWith('/') && tt.startsWith(rr);
  }));
});
if (reusable.length) {
  blocks.push('[super-agent-router] 复用提示：该成员已有 ' + reusable.length +
    ' 个会话的上下文覆盖本单 SCOPE。若那些会话仍可用，**优先追加**而不是新开子会话 ——' +
    '新开会让它把方法论、契约、台账、相关脚本重读一遍（契约 S4.5）。' +
    '注意：追加**不会**自动扩大边界，要加路径走管理员扩权。');
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: blocks.join('\n\n')
  }
}));
process.exit(0);
