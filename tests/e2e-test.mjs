// super-agent-router 回归测试（v0.5.0）
// 用法：node tests/e2e-test.mjs
// 断言插件的 Hook 在真实 stdin/stdout 契约下的行为。
//
// v0.4.0 语义：派工发生在父会话，工具执行发生在子会话。
//   · 父会话 = Router（不受 worker 的 scope 约束）
//   · 子会话 = worker（载荷带 agent_type，scope 来自它自己 transcript 里的 brief）
//
// v0.5.0 新增锁住：
//   · codex 变体 transcript 的端到端链路（D-01）
//   · 解析不到边界一律拒绝（D-04）
//   · glob/grep 按有效检索根判定（D-22）
//   · watchdog 的收尾契约校验（S8）与证据判定（D-11）
//   · 名额回收的三条路（S6.2）
//   · 实战记录摘要的披露口径（S7.3）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';

// 主动触发的命中判定直接 import 出来断言 ——
// 漏判的表现是 stdout 为空，跟「判定为不该命中」长得一模一样，
// 只看 stdout 的回归永远发现不了漏判（D-27）。
let judgeTriggerIntent = null;
try {
  ({ judgeTriggerIntent } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs')).href));
} catch (e) {
  console.log('IMPORT_FAIL lib.mjs ' + e.message);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-e2e-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const a = 1;', 'utf8');

// 账号成员夹具（D-37 / D-38）：账号成员是**跨项目的账号级事实**，
// 夹具不自带账号环境，派工侧就只能判定「账号名单不可用」而**不判存在性**。
const ACCOUNT = path.join(tmp, 'account');
for (const n of ['worker', 'sa-lesson', 'sa-live-member']) {
  fs.mkdirSync(path.join(ACCOUNT, n), { recursive: true });
}

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ' :: ' + extra : ''));
};
// ── 变异矩阵 / 改前改后对照（可选，用开关打开）────────────────────
//
// 用法：
//   $env:SAR_MUTATION='1'; node tests/e2e-test.mjs   → 变异矩阵：回退实现 → 目标断言必须转红
//   $env:SUTATION='2'; node tests/e2e-test.mjs   → 改前（git HEAD 原实现）/ 改后（工作树）对照
//
// 为什么放在测试文件里：docs/audit/.tmp-*/ 是 .gitignore 忽略的临时脚手架区
// （用完即删），证据工装必须**随仓库走**，否则第三方无法复核。
//
// 只改系统临时目录里的插件副本，仓库工作树零改动；跑完即删。
if (process.env.SAR_MUTATION === '1') {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SRC_PLUGIN = path.join(REPO, 'plugin');

  const mutRead = (p) => fs.readFileSync(p, 'utf8');
  const mutWrite = (p, s) => fs.writeFileSync(p, s, 'utf8');
  // 替换一处文本；变异点没命中就直接失败（变异体没生效 = 矩阵无效）。
  const mutReplace = (file, from, to) => {
    const src = mutRead(file);
    const idx = src.indexOf(from);
    if (idx < 0) throw new Error('变异点未命中：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    if (src.indexOf(from, idx + 1) >= 0) throw new Error('变异点不唯一：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    mutWrite(file, src.slice(0, idx) + to + src.slice(idx + from.length));
  };

  // 旧版复合层判定（对整段代码文本做朴素正则）—— D-41 的变异体。
  // 字面量在源码里是拼出来的：本插件自己的复合层扫描会把源码当载荷正文命中（自举误伤）。
  const MAD_RE = '/' + 'mavis' + '_agent_delete|agent' + '\\s+delete/i';
  const MAU_RE = '/' + 'mavis' + '_agent_update|agent' + '\\s+update/i';
  const WD_RE = '/' + 'website' + '_deploy/';
  const MINI_RE = '/' + 'mini' + 'app/i';
  const PUB_RE = '/' + 'pub' + 'lish/i';
  const OLD_DANGEROUS_IN_CODE = [
    'function dangerousInCode(code) {',
    "  const c = String(code || '');",
    '  if (' + MAD_RE + ".test(c)) return 'MUT-OLD';",
    '  if (' + MAU_RE + ".test(c)) return 'MUT-OLD';",
    '  if (' + WD_RE + ".test(c)) return 'MUT-OLD';",
    '  if (' + MINI_RE + '.test(c) && ' + PUB_RE + ".test(c)) return 'MUT-OLD';",
    "  return '';",
    '}'
  ].join('\n');
  const NEW_DANGEROUS_IN_CODE = [
    'function dangerousInCode(code) {',
    '  const hit = detectDangerousInComposite(code);',
    "  if (!hit) return '';",
    "  return '在复合调用里执行了' + hit.matched + '（' + hit.reason + '）';",
    '}'
  ].join('\n');

  const MUTATIONS = [
    {
      id: 'M-D37', defect: 'D-37',
      what: '派工前的「目标成员存在性」判定被摘掉',
      suites: ['scope-test', 'dispatch-release-test', 'e2e-test'],
      expect: ['D-37 派工到账号里不存在的成员被拒', 'D-37 派工到不存在的成员被拒', 'D-38 派工到陈旧成员被拒'],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'dispatch.mjs'),
          'if (!accountMemberExists(accountCtx.names, targetMember)) {',
          'if (false && !accountMemberExists(accountCtx.names, targetMember)) {');
      }
    },
    {
      id: 'M-D38', defect: 'D-38',
      what: '会话注入里的陈旧名单披露被摘掉',
      suites: ['hooks-test'],
      expect: ['D-38 SessionStart 注入陈旧成员名单'],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'session-start.mjs'),
          'if (staleMembers.length) {', 'if (false && staleMembers.length) {');
      }
    },
    {
      id: 'M-D39', defect: 'D-39',
      what: '账号级建号子命令从危险清单里摘掉（bash 通道 + 参数判定 + 复合层）',
      suites: ['guard-test'],
      expect: ['D-39 账号级建号子命令在 bash 通道被拦', 'D-39 账号级建号子命令在 mavis 工具参数上被拦', 'D-39 账号级建号子命令在复合层被拦'],
      apply: (mut) => {
        const lib = path.join(mut, 'scripts', 'lib.mjs');
        mutReplace(lib,
          "if (act !== 'delete' && act !== 'update' && act !== 'create') continue;",
          "if (act !== 'delete' && act !== 'update') continue;");
        mutReplace(lib,
          "const ACCOUNT_MEMBER_ACTIONS = new Set(['delete', 'update', 'create']);",
          "const ACCOUNT_MEMBER_ACTIONS = new Set(['delete', 'update']);");
        mutReplace(path.join(mut, 'scripts', 'guard.mjs'),
          'if (/^agent\\s+(delete|update|create)\\b/.test(cmd)) {',
          'if (/^agent\\s+(delete|update)\\b/.test(cmd)) {');
      }
    },
    {
      id: 'M-D40', defect: 'D-40',
      what: '拦截消息的「只读条目」分型被摘掉（退回一律说不在白名单内）',
      suites: ['guard-test'],
      expect: ['D-40 ro: 命中的消息说「在白名单内，但登记为只读条目」', 'D-40 ro: 命中的消息不再说「不在白名单内」', 'D-40 ro: 命中的消息提示去掉 ro: 重新派工'],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'guard.mjs'),
          'const farRo = far.filter((t) => readOnlyScopeHit(scope, t));',
          'const farRo = [];');
      }
    },
    {
      id: 'M-D41', defect: 'D-41',
      what: '复合层判定退回「对整段代码文本做朴素正则」',
      suites: ['guard-test'],
      expect: ['D-41 复合层：write 载荷里的被禁形态不再被拦（载荷是数据）', 'D-41 复合层：edit 载荷里的被禁形态不再被拦（载荷是数据）'],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'guard.mjs'), NEW_DANGEROUS_IN_CODE, OLD_DANGEROUS_IN_CODE);
      }
    },
    {
      // D-72：否定式产出判定被摘掉 —— 退回「只按肯定式动词表扫」
      id: 'M-D72a', defect: 'D-72',
      what: '否定式产出判定被摘掉（否定标记不再让产出动词失去断言性）',
      suites: ['chain-test'],
      expect: [
        'D-72 否定式「没有创建」不触发路径存在性校验',
        'D-72 否定式「未创建」不触发路径存在性校验',
        'D-72 否定式「不该创建」不触发路径存在性校验',
        'D-72 否定式「不会被创建」不触发路径存在性校验',
        'D-72 否定式「并非创建」不触发路径存在性校验',
        'D-72 否定式「未被创建」不触发路径存在性校验',
        'D-72 否定式「并没有创建」不触发路径存在性校验'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'watchdog.mjs'),
          '    const negated = isNegatedBefore(clause, m.index);',
          '    const negated = false; // MUT-D72a：否定式判定被摘掉');
      }
    },
    {
      // D-72：非断言语境判定被摘掉 —— 疑问 / 引述句里的动词又被当成产出声明
      id: 'M-D72b', defect: 'D-72',
      what: '非断言语境判定被摘掉（疑问从句 / 引述句里的动词又被当成产出声明）',
      suites: ['chain-test'],
      expect: [
        'D-72 疑问从句里的「被创建」不触发路径存在性校验',
        'D-72 引述句里的「声称创建过」不触发路径存在性校验'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'watchdog.mjs'),
          '    const embedded = EMBED_MARKERS.some((k) => seg.indexOf(k) >= 0);',
          '    const embedded = false; // MUT-D72b：非断言语境判定被摘掉');
      }
    },
    {
      // D-72：子句级归属被摘掉 —— 退回行级扫描（一行里有产出动词 ⇒ 行里所有路径都被当成声称产出）
      id: 'M-D72c', defect: 'D-72',
      what: '子句级归属被摘掉（退回行级扫描：引用的护栏拒绝原文又把越界路径变成「声称产出」）',
      suites: ['chain-test'],
      expect: [
        'D-72 引用的护栏拒绝原文里的路径不被当成声称产出',
        'D-72 活体报告一（第一份汇报）不再被 block'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'watchdog.mjs'),
          'const CLAUSE_SPLIT = /[，,；;。！？!?、（）()「」『』\\r\\n]+/;',
          'const CLAUSE_SPLIT = /[\\r\\n]+/; // MUT-D72c：退回行级归属');
      }
    },
    {
      // N-03：家目录展开被摘掉 —— "~/.minimax/..." 又被拼成 "<工作区根>/~/.minimax/..."
      id: 'M-D72d', defect: 'D-72',
      what: '家目录展开被摘掉（~ 路径不再按真实家目录判存在性）',
      suites: ['chain-test'],
      expect: [
        'N-03 家目录写法（~）按真实家目录判存在性：存在的文件不被拦'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'watchdog.mjs'),
          '      const abs = absolutizePath(expandHomePath(p, HOME_DIR), root);',
          '      const abs = absolutizePath(p, root); // MUT-D72d：家目录展开被摘掉');
        // D-80 起，家目录展开已经**下沉到 lib.mjs 的 absolutizePath() 内部** ——
        // 只摘 watchdog 侧那一环，链路仍然成立（N-03 不会转红）。
        // 变异体要断的是**整条链**：两处都摘，N-03 才真的塌。
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "  const raw = expandHomePath(String(p || '').replace(/\\\\/g, '/').trim(), homeDir());",
          "  const raw = String(p || '').replace(/\\\\/g, '/').trim(); // MUT-D72d：家目录展开被摘掉");
      }
    },
    {
      // N-04：通配符跳过被摘掉 —— 通配符路径又被当成「声称产出的文件」
      id: 'M-D72e', defect: 'D-72',
      what: '通配符跳过被摘掉（模式又被当成文件去校验存在性）',
      suites: ['chain-test'],
      expect: [
        'N-04 通配符路径不被截成碎片路径触发拦截',
        'N-04 通配符路径不参与存在性校验'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'watchdog.mjs'),
          '      if (/[*?]/.test(p)) continue;',
          '      // MUT-D72e：通配符跳过被摘掉');
      }
    }
  ];

  const mutRunSuite = (suite, pluginRoot) => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tests', suite + '.mjs')], {
      encoding: 'utf8', timeout: 300000, cwd: REPO,
      // 必须清掉 SAR_MUTATION：被重跑的套件里若再次打开本工装，就会**递归**跑自己。
      env: Object.assign({}, process.env, { SAR_PLUGIN_ROOT: pluginRoot, SAR_MUTATION: '' })
    });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const lines = out.split(/\r?\n/);
    return {
      fail: lines.filter((l) => l.startsWith('FAIL ')),
      pass: lines.filter((l) => l.startsWith('PASS ')).length
    };
  };

  console.log('| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |');
  console.log('|---|---|---|---|---|');
  for (const m of MUTATIONS) {
    const mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mut-' + m.id.toLowerCase() + '-'));
    const mutPlugin = path.join(mutRoot, 'plugin');
    try {
      fs.cpSync(SRC_PLUGIN, mutPlugin, { recursive: true });
      m.apply(mutPlugin);
      const turnedRed = [];
      for (const s of m.suites) {
        const r = mutRunSuite(s, mutPlugin);
        for (const f of r.fail) turnedRed.push(f);
      }
      const missing = m.expect.filter((name) => !turnedRed.some((l) => l.indexOf(name) >= 0));
      const good = missing.length === 0 && turnedRed.length > 0;
      if (!good) fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | ' + turnedRed.length + ' | ' + (good ? 'YES' : 'NO') + ' |');
      for (const l of turnedRed) console.log('    RED ' + l.slice(0, 150));
      if (!good) console.log('    MISS ' + missing.join(' / '));
    } catch (e) {
      fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | 0 | NO（变异体本身失败：' + e.message + '） |');
    } finally {
      fs.rmSync(mutRoot, { recursive: true, force: true });
    }
  }
  console.log(fail === 0 ? '>>> E2E MUTATION MATRIX OK' : '>>> E2E MUTATION MATRIX FAILURES: ' + fail);
}

// ── 改前 / 改后对照（可选，SAR_MUTATION='2'）────────────────────────
//
// 「改前」= 从 git HEAD 取出 plugin/scripts/{lib,dispatch,guard,session-start}.mjs 的原版，
// 装进系统临时目录跑 —— 仓库工作树零改动。
// 用途：每条缺陷的「改前/改后原始输出」可被第三方原样复跑。
if (process.env.SAR_MUTATION === '2') {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SRC_PLUGIN = path.join(REPO, 'plugin');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-ba-'));
  const BA_PROJ = path.join(TMP, 'proj');
  const BA_DATA = path.join(TMP, 'data');
  const BA_ACCOUNT = path.join(TMP, 'account');
  fs.mkdirSync(path.join(BA_PROJ, '.superagent'), { recursive: true });
  fs.mkdirSync(BA_DATA, { recursive: true });
  fs.mkdirSync(path.join(BA_ACCOUNT, 'sa-live-member'), { recursive: true });
  fs.writeFileSync(path.join(BA_PROJ, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-01-01',
    members: [
      { name: 'sa-live-member', kind: 'specialist', owns: '账号里存在的成员' },
      { name: 'sa-stale-gone', kind: 'specialist', owns: '账号里没有的成员' }
    ]
  }), 'utf8');
  const BA_TR = path.join(TMP, 'tr.jsonl');
  fs.writeFileSync(BA_TR, JSON.stringify({
    uuid: 'p-0', parentUuid: null, sessionId: 'w1',
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'SCOPE: ro: src/' }] }
  }) + '\n', 'utf8');

  const BA_CREATE = 'mavis' + ' agent' + ' create' + ' sa-x';
  const BA_DELETE = 'mavis' + ' agent' + ' delete' + ' sa-x';

  const BA_BEFORE = path.join(TMP, 'before-plugin');
  fs.cpSync(SRC_PLUGIN, BA_BEFORE, { recursive: true });
  for (const f of ['scripts/lib.mjs', 'scripts/dispatch.mjs', 'scripts/guard.mjs', 'scripts/session-start.mjs', 'scripts/watchdog.mjs']) {
    const content = execFileSync('git', ['show', 'HEAD:plugin/' + f], { cwd: REPO, encoding: 'utf8' });
    fs.writeFileSync(path.join(BA_BEFORE, f), content, 'utf8');
  }

  const baHook = (root, script, payload) => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000,
      env: Object.assign({}, process.env, {
        PLUGIN_ROOT: root, PLUGIN_DATA: BA_DATA, MINIMAX_PROJECT_DIR: BA_PROJ,
        SAR_ACCOUNT_AGENTS_DIR: BA_ACCOUNT
      })
    });
    return String(r.stdout || '').trim();
  };
  const baLedgerCount = () => {
    try { return JSON.parse(fs.readFileSync(path.join(BA_DATA, 'dispatches.json'), 'utf8')).dispatches.length; }
    catch { return 0; }
  };
  const baScenario = (root, kind) => {
    fs.rmSync(path.join(BA_DATA, 'dispatches.json'), { force: true });
    if (kind === 'd37') {
      const o = baHook(root, 'dispatch.mjs', {
        hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'p1', turn_id: 't1',
        tool_input: { agent_name: 'sa-stale-gone', prompt: 'SCOPE: src/d37.ts' }
      });
      return '台账记录数=' + baLedgerCount() + ' | ' + (o ? o.slice(0, 200) : '(放行：stdout 为空)');
    }
    if (kind === 'd38') {
      const o = baHook(root, 'session-start.mjs', {
        hook_event_name: 'SessionStart', source: 'startup', session_id: 'p1'
      });
      const line = o.split('\n').filter((l) => l.includes('陈旧') || l.includes('sa-stale-gone') || l.includes('不可用'));
      return line.length ? line.join(' / ') : '(注入里没有陈旧名单，也没有披露账号名单不可用)';
    }
    if (kind === 'd39') {
      const o = baHook(root, 'guard.mjs', {
        hook_event_name: 'PreToolUse', tool_name: 'bash', session_id: 'w1',
        agent_id: 'w1', agent_type: 'worker', transcript_path: BA_TR,
        tool_input: { command: BA_CREATE }
      });
      return o ? 'DENY | ' + o.slice(0, 220) : 'ALLOW（stdout 为空）';
    }
    if (kind === 'd40') {
      const o = baHook(root, 'guard.mjs', {
        hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 'w1',
        agent_id: 'w1', agent_type: 'worker', transcript_path: BA_TR,
        tool_input: { file_path: 'src/x.md' }
      });
      return o ? 'DENY | ' + o.slice(0, 320) : 'ALLOW（stdout 为空）';
    }
    if (kind === 'd41') {
      const asWrite = baHook(root, 'guard.mjs', {
        hook_event_name: 'PreToolUse', tool_name: 'run_code', session_id: 'w1',
        agent_id: 'w1', agent_type: 'worker', transcript_path: BA_TR,
        tool_input: { code: "await tools.write({ path: 'docs/audit/x.md', content: '" + BA_DELETE + "' });" }
      });
      const asBash = baHook(root, 'guard.mjs', {
        hook_event_name: 'PreToolUse', tool_name: 'run_code', session_id: 'w1',
        agent_id: 'w1', agent_type: 'worker', transcript_path: BA_TR,
        tool_input: { code: "await tools.bash({ command: '" + BA_DELETE + "' });" }
      });
      const bashChan = baHook(root, 'guard.mjs', {
        hook_event_name: 'PreToolUse', tool_name: 'bash', session_id: 'w1',
        agent_id: 'w1', agent_type: 'worker', transcript_path: BA_TR,
        tool_input: { command: BA_DELETE }
      });
      return [
        '同一段正文作为 write 载荷（复合层）：' + (asWrite ? 'DENY' : 'ALLOW'),
        '同一段正文作为 bash 命令（复合层）：' + (asBash ? 'DENY' : 'ALLOW'),
        '同一段作为 bash 通道命令：' + (bashChan ? 'DENY' : 'ALLOW')
      ].join(' / ');
    }
    if (kind === 'd72') {
      // D-72：否定式产出陈述被当成「声称产出」⇒ 连续 block 诚实的交付报告。
      // 两行都要看：否定式改前被 block、改后放行；肯定式改前改后**都**被拦
      // （不许因为修否定式而打开新的放行口子）。
      const neg = baHook(root, 'watchdog.mjs', {
        hook_event_name: 'SubagentStop', session_id: 'w1', agent_id: 'w1', agent_type: 'worker',
        last_assistant_message: '已完成。docs/audit/live-probe-outside.txt 没有创建，这是白名单外被护栏拦下的结果，不是缺失交付物。'
      });
      const pos = baHook(root, 'watchdog.mjs', {
        hook_event_name: 'SubagentStop', session_id: 'w1', agent_id: 'w1', agent_type: 'worker',
        last_assistant_message: '已完成。已创建 docs/audit/live-probe-outside.txt，测试通过。'
      });
      return [
        '否定式（没有创建）：' + (neg ? 'BLOCK | ' + neg.slice(0, 150) : 'ALLOW（stdout 为空）'),
        '肯定式（已创建，文件不存在）：' + (pos ? 'BLOCK | ' + pos.slice(0, 150) : 'ALLOW（stdout 为空）')
      ].join(' / ');
    }
    return '';
  };
  for (const [kind, title] of [
    ['d37', 'D-37 派工到账号里不存在的成员'],
    ['d38', 'D-38 会话注入里的陈旧名单'],
    ['d39', 'D-39 账号级建号子命令（bash 通道）'],
    ['d40', 'D-40 写通道命中 ro: 只读条目'],
    ['d41', 'D-41 同一段正文：数据载荷 vs 命令'],
    ['d72', 'D-72 否定式产出陈述 vs 肯定式产出陈述']
  ]) {
    console.log('=== ' + title + ' ===');
    console.log('  改前（HEAD）：' + baScenario(BA_BEFORE, kind));
    console.log('  改后（工作树）：' + baScenario(SRC_PLUGIN, kind));
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}


// 工装模式（开关打开）：**只**跑工装，不跑常规断言 ——
// 常规断言由 tools/run-tests.mjs 统一跑；工装模式单独跑，
// 否则工装会在「安装副本」上跑常规断言，报出来的失败与工装无关。
if (process.env.SAR_MUTATION === '1' || process.env.SAR_MUTATION === '2') {
  console.log(fail === 0 ? '>>> E2E 工装 ALL PASS' : '>>> E2E 工装 FAILURES: ' + fail);
  process.exit(fail ? 1 : 0);
}


function run(script, payload, env) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload),
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA,
      MINIMAX_PROJECT_DIR: payload && payload.cwd ? payload.cwd : tmp,
      SAR_ACCOUNT_AGENTS_DIR: ACCOUNT, ...(env || {}) },
    encoding: 'utf8'
  });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}

// 造一份子会话 transcript：第一条 user 消息里带父会话、成员名与 SCOPE
function makeTranscript(session, parent, agent, scope) {
  const text = [
    '<agent-context>',
    '  agentName: ' + agent,
    '  PARENT SESSION: ' + parent,
    '</agent-context>',
    '任务：按 brief 执行',
    'SCOPE: ' + scope
  ].join('\n');
  const p = path.join(tmp, 'tr-' + session + '.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    uuid: 'p-0', parentUuid: null, sessionId: session,
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] }
  }) + '\n', 'utf8');
  return p;
}

// codex 变体：type=response_item + payload.role=user + content[].type=input_text
function makeCodexTranscript(session, parent, agent, scope) {
  const text = [
    '<agent-context>',
    '  agentName: ' + agent,
    '  PARENT SESSION: ' + parent,
    '</agent-context>',
    '任务：按 brief 执行',
    'SCOPE: ' + scope
  ].join('\n');
  const p = path.join(tmp, 'tr-codex-' + session + '.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    timestamp: new Date().toISOString(), type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
  }) + '\n', 'utf8');
  return p;
}

// 1. UserPromptSubmit：普通提问静默放行，编排意图才注入
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '帮我看下这个错误', session_id: 'e1' });
  ok('普通提问静默放行', r.out === '');
}
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做，谁来负责？', session_id: 'e1' });
  ok('编排意图注入路由指令', r.out.includes('super-agent-router') && r.out.includes('直做'));
}
// 1b. gate 不得把用户文本里的路径说成「已声明的 SCOPE」（D-15）
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做？\nSCOPE: src/app.ts', session_id: 'e1b' });
  ok('gate 不把用户文本里的 SCOPE 说成授权', r.out.includes('未验证') && !r.out.includes('本轮 prompt 中声明的 SCOPE'), r.out.slice(0, 200));
}

// 1c. D-27：主动触发粗筛 —— 语料直接喂判定函数
//     判据与语料见 docs/audit/d27-acceptance.md
{
  ok('D-27 判定函数可独立 import', typeof judgeTriggerIntent === 'function', String(typeof judgeTriggerIntent));
  const SHOULD = [
    '同时做 A 和 B', '拆一下这块', '分一下工', '派谁去做', '谁负责这块', '几个人一起做',
    '实现和验证一起', '一边调研一边写', '帮我拆解这个任务', '这个要做两件事', '并行跑一下',
    '各做各的', '让 A 和 B 各自负责', '复审一下', '评审一下', '放到后台做', '开个会话并行做',
    '你安排人', '这两个能不能一起做', '拆成两块', '分头做', '一前一后两个人',
    '好像还有点问题就是主动触发还有其他的你看看'
  ];
  const SINGLE = ['改个 typo', '查一下 API 文档', '帮我看下这个函数', '加个注释', '这个 bug 怎么修', '把文件名改一下'];
  const FAKE = ['分别说明这两个概念的区别', '同时打开这两个文件', '批量导入这批数据', '这个函数有多个分支', '把这两个文件合并一下', '并行度调高一点', '这两个概念各自的意思'];

  if (typeof judgeTriggerIntent === 'function') {
    const missed = SHOULD.filter((p) => !judgeTriggerIntent(p).hit);
    const overSingle = SINGLE.filter((p) => judgeTriggerIntent(p).hit);
    const overFake = FAKE.filter((p) => judgeTriggerIntent(p).hit);
    ok('D-27 编排意图 23 条全部命中', missed.length === 0, missed.join(' | '));
    ok('D-27 单点动作 6 条全部不命中', overSingle.length === 0, overSingle.join(' | '));
    ok('D-27 伪信号 7 条全部不命中', overFake.length === 0, overFake.join(' | '));
  }

  // 口语编排请求必须真的走到「注入完整路由指令」
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '拆一下这块', session_id: 'e1c' });
  ok('D-27 口语编排请求注入完整路由指令', r.out.includes('super-agent-router') && r.out.includes('直做'), r.out.slice(0, 120));

  // 载荷解析失败必须留痕，且不注入任何内容（不能静默失效）
  const bad = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
    input: '{ this is not json',
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: tmp },
    encoding: 'utf8'
  });
  const traceFile = path.join(DATA, 'hooks', 'super-agent-router', 'gate-trace.jsonl');
  const traced = fs.existsSync(traceFile) && fs.readFileSync(traceFile, 'utf8').includes('payload-parse-failed');
  ok('D-27 载荷解析失败留下痕迹', traced, 'err=' + (bad.stderr || '').slice(0, 120));
  ok('D-27 载荷坏时不注入任何内容', (bad.stdout || '').trim() === '', JSON.stringify(bad.stdout || '').slice(0, 120));

  // D-29：运行时 PLUGIN_DATA 本身就是本插件的专属目录，
  //        痕迹必须落在它**下一层**，不能再多套一层 hooks/super-agent-router
  {
    const runtimeShape = path.join(tmp, 'plugin-data', 'hooks', 'super-agent-router');
    fs.mkdirSync(runtimeShape, { recursive: true });
    spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
      input: '{ this is not json',
      env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: runtimeShape, MINIMAX_PROJECT_DIR: tmp },
      encoding: 'utf8'
    });
    const direct = path.join(runtimeShape, 'gate-trace.jsonl');
    const nested = path.join(runtimeShape, 'hooks', 'super-agent-router', 'gate-trace.jsonl');
    const directHit = fs.existsSync(direct) && fs.readFileSync(direct, 'utf8').includes('payload-parse-failed');
    ok('D-29 痕迹落在 PLUGIN_DATA 下一层（不多套一层）', directHit,
      'direct=' + fs.existsSync(direct) + ' nested=' + fs.existsSync(nested));
    ok('D-29 不产生多套一层的怪目录', !fs.existsSync(nested), 'nestedExists=' + fs.existsSync(nested));

    // F4（独立验收实测的洞）：PLUGIN_DATA 带**尾斜杠**时也不能多套一层。
    // 之前的判定是「正则锚末尾」，尾斜杠会打破锚点 -> 又去拼一层。
    spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
      input: '{ this is not json',
      env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: runtimeShape + path.sep, MINIMAX_PROJECT_DIR: tmp },
      encoding: 'utf8'
    });
    const nestedTrailing = path.join(runtimeShape, 'hooks', 'super-agent-router', 'gate-trace.jsonl');
    ok('D-29/F4 尾斜杠形态也不多套一层', !fs.existsSync(nestedTrailing),
      'nestedExists=' + fs.existsSync(nestedTrailing));
  }
}

// 2. 派工登记：scope 只收路径，自然语言被过滤
const scopeSession = 'e-task';
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: scopeSession, turn_id: 'et1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts, src/util.ts\n请实现登录超时修复' }
  });
  const led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const d = led.dispatches.find((x) => x.parent_session_id === scopeSession);
  ok('scope 只收路径', !!d && JSON.stringify(d.scope) === JSON.stringify(['src/app.ts', 'src/util.ts']), JSON.stringify(d && d.scope));
  ok('派工记录带 dispatch_id', !!d && !!d.dispatch_id, d ? String(d.dispatch_id) : 'no-record');
}

// 2b. D-31：SCOPE 不得覆盖成员的私有记忆目录（越权授予他人记忆）
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-privmem1', turn_id: 'pm1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: ro: .superagent/lessons/\n读一下错题本' }
  });
  ok('D-31 覆盖错题本目录被拒', r.out.includes('deny') && r.out.includes('私有记忆'), r.out.slice(0, 200));
}
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-privmem2', turn_id: 'pm2',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: ro: .superagent/methods/\n读方法论' }
  });
  ok('D-31 覆盖方法论目录同样被拒', r.out.includes('deny'), r.out.slice(0, 160));
}
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-privmem3', turn_id: 'pm3',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: ro: .superagent/lessons/sa-x.md\n读某个成员的' }
  });
  ok('D-31 单个成员文件同样被拒（读模式没有细粒度写法：文件条目的读范围是所在目录）',
    r.out.includes('deny'), r.out.slice(0, 200));
}

// 3. 越界拦截：worker 受自己 scope 约束，Router 不受约束
const workerSession = 'e-worker';
const TR = makeTranscript(workerSession, scopeSession, 'worker', 'src/app.ts');
function wguard(tool, payload, sid, tr) {
  return run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: sid || workerSession,
    agent_id: sid || workerSession, agent_type: 'worker',
    transcript_path: tr === undefined ? TR : tr,
    tool_input: payload
  });
}
{
  const r1 = wguard('write', { file_path: 'src/app.ts' });
  ok('worker scope 内文件放行', r1.out === '');
  const r2 = wguard('write', { file_path: 'config/prod.yaml' });
  ok('worker scope 外文件 deny', r2.out.includes('deny'), r2.out.slice(0, 90));
  const r3 = wguard('bash', { command: 'rm -rf config/prod.yaml' });
  ok('worker bash 越界 deny', r3.out.includes('deny'), r3.out.slice(0, 90));
  // 解析不到边界 -> 拒绝（D-04 / 契约 S4）
  const r4 = wguard('read', { path: 'any/x.ts' }, 'no-scope-w', null);
  ok('worker 解析不到边界时被拦', r4.out.includes('deny'), r4.out.slice(0, 120));
  const r5 = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: scopeSession, tool_input: { file_path: 'any/x.ts' } });
  ok('Router 父会话不被 worker scope 约束', r5.out === '', r5.out.slice(0, 90));
}

// 3b. D-01：codex 变体的完整链路（派工 -> 守卫按 scope 判定）
{
  const s = 'e-codex';
  const w = 'e-codex-worker';
  const t = makeCodexTranscript(w, s, 'worker', 'src/app.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'ct1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts' }
  });
  const g = (tool, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: w,
    agent_id: w, agent_type: 'worker', transcript_path: t, tool_input: input
  });
  ok('codex 变体：scope 内放行', g('write', { file_path: 'src/app.ts' }).out === '');
  ok('codex 变体：scope 外 deny', g('write', { file_path: 'config/prod.yaml' }).out.includes('deny'));
}

// 4. Watchdog：空交付与无证据 block，有证据放行
{
  const a = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '' });
  ok('空交付 block', a.out.includes('block'));
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已经完成修复了' });
  ok('无证据声称完成 block', b.out.includes('block'));
  const c = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已修复。改动文件 src/app.ts，测试命令 npm test 全部通过', cwd: tmp });
  ok('有证据放行', c.out === '');
}

// 4b. D-11：描述性词不算证据
{
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '搞定了，测试通过' });
  ok('「搞定了，测试通过」被拦', b.out.includes('block'), b.out.slice(0, 140));
}

// 4b-bis. D-72：否定式产出陈述不得被判成「声称产出」
// 活体缺陷：watchdog 只按肯定式动词表逐行扫，「X 没有创建」里的「创建」被当成
// 产出声明 ⇒ 路径存在性校验失败 ⇒ 连 block 诚实的交付报告。
// 活体证据：子会话 mvs_73441ff316ed4d2db69fe88e9b17eeb3，2026-11-10T13:05:07Z 起连 block 三次
//（原文见 docs/audit/live-trigger-evidence.txt）。
{
  const neg = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a1b', agent_type: 'worker',
    last_assistant_message: '已完成。docs/audit/live-probe-outside.txt 没有创建，这是白名单外被护栏拦下的结果。'
  });
  ok('D-72 否定式产出陈述不触发路径存在性校验', neg.out === '', neg.out.slice(0, 200));
  const pos = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a1b', agent_type: 'worker',
    last_assistant_message: '已完成。已创建 docs/audit/live-probe-outside.txt，测试通过。'
  });
  ok('D-72 肯定式产出陈述里文件不存在仍被拦',
    pos.out.includes('block') && pos.out.includes('R-CLAIM-PATH-MISSING'), pos.out.slice(0, 200));
}

// 4c. S8：条目型产出必须符合 S1 的 7 字段模板
{
  const bad = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a3', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n条目统计：总计 1 条；已复现 1 条，推断 0 条'
  });
  ok('条目缺字段时 block 并指明缺哪项', bad.out.includes('block') && bad.out.includes('缺字段'), bad.out.slice(0, 300));
  const good = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a4', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n- 复现步骤：z\n- 证据：e\n- 状态：已复现\n- 修法方向：f\n- 还需要什么：无，代码路径已确定\n条目统计：总计 1 条；已复现 1 条，推断 0 条'
  });
  ok('合规条目放行', good.out === '', good.out.slice(0, 200));
  const noStat = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a5', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n- 复现步骤：z\n- 证据：e\n- 状态：已复现\n- 修法方向：f\n- 还需要什么：无，代码路径已确定'
  });
  ok('条目缺统计行时 block', noStat.out.includes('block') && noStat.out.includes('条目统计'), noStat.out.slice(0, 300));
}

// 5. 读类工具纳入管控
{
  const scopeSession2 = 'e-read';
  const w2 = 'e-read-worker';
  const tr2 = makeTranscript(w2, scopeSession2, 'worker', 'src/app/login.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: scopeSession2, turn_id: 'rt1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app/login.ts' }
  });
  const g = (toolName, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: toolName, session_id: w2,
    agent_id: w2, agent_type: 'worker', transcript_path: tr2, tool_input: input
  });
  ok('读 scope 内放行', g('read', { path: 'src/app/login.ts' }).out === '');
  ok('读无关目录 deny', g('read', { path: 'config/prod.yaml' }).out.includes('deny'));
  // D-22：判定对象是有效检索根，不是 pattern
  ok('glob 检索根在读放行目录树内放行', g('glob', { pattern: '**/*.ts', path: 'src/app' }).out === '');
  ok('glob 检索根在范围外 deny', g('glob', { pattern: '**/*.ts', path: 'config' }).out.includes('deny'));
  ok('glob 无 path 时按工作区根判定并 deny', g('glob', { pattern: 'src/app/*.ts' }).out.includes('deny'));
}

// 6. 危险操作一律拦（子代理侧，不受 scope 保护）
{
  const g = (toolName, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: toolName, session_id: 'no-scope',
    agent_id: 'no-scope', agent_type: 'worker', tool_input: input
  });
  ok('删除成员被拦', g('mavis_agent_delete', { agent_name: 'x' }).out.includes('deny'));
  ok('公网部署被拦', g('website_deploy', { path: 'x' }).out.includes('deny'));
  ok('改成员配置被拦', g('mavis_agent_update', { agent_name: 'x' }).out.includes('deny'));
  ok('mavis 的 agent delete 被拦', g('mavis', { command: 'agent delete' }).out.includes('deny'));
}

// 7. 名额回收三条路（契约 S6.2）
{
  // 第 1 条：正常结束（SubagentStop）-> 立即回收
  const s = 'e-recycle';
  const w = 'e-recycle-worker';
  const t = makeTranscript(w, s, 'worker', 'src/recycle.ts');
  fs.writeFileSync(path.join(tmp, 'src', 'recycle.ts'), 'export const b = 2;', 'utf8');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'r1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/recycle.ts' }
  });
  run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: w,
    agent_id: w, agent_type: 'worker', transcript_path: t,
    tool_input: { file_path: 'src/recycle.ts' }
  });
  run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', session_id: w, agent_id: w, agent_type: 'worker',
    transcript_path: t, last_assistant_message: '已完成，改动文件 src/recycle.ts，测试通过'
  });
  let led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const rec = led.dispatches.find((x) => x.parent_session_id === s);
  ok('正常结束后派工状态为 done', !!rec && rec.state === 'done', JSON.stringify(rec && rec.state));

  // 第 2 条：超时兜底 —— 超龄的 active 记录判死并落盘
  led.dispatches.push({
    dispatch_id: 'dsp_e2e_stale', parent_session_id: 'e-stale', turn_id: 'x', turn_key: 'x',
    tool_use_id: '', agent: 'sa-stale', agent_key: 'sa-stale', project: tmp,
    scope: ['src/stale.ts'], state: 'active', at: Date.now() - 5 * 60 * 60 * 1000
  });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify(led, null, 2), 'utf8');
  run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'e-stale-worker', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 src/app.ts，测试通过'
  });
  led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const stale = led.dispatches.find((x) => x.dispatch_id === 'dsp_e2e_stale');
  ok('超龄派工被 TTL 判死并落盘', !!stale && stale.state !== 'active' && stale.end_reason === 'ttl_expired', JSON.stringify(stale));

  // 第 3 条：读时自愈 —— 读取在飞名单时把超龄记录判死
  led.dispatches.push({
    dispatch_id: 'dsp_e2e_selfheal', parent_session_id: 'e-selfheal', turn_id: 'y', turn_key: 'y',
    tool_use_id: '', agent: 'sa-selfheal', agent_key: 'sa-selfheal', project: tmp,
    scope: ['src/selfheal.ts'], state: 'active', at: Date.now() - 5 * 60 * 60 * 1000
  });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify(led, null, 2), 'utf8');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-selfheal2', turn_id: 'z',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/selfheal2.ts' }
  });
  led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const healed = led.dispatches.find((x) => x.dispatch_id === 'dsp_e2e_selfheal');
  ok('读取在飞名单时超龄记录被自愈判死', !!healed && healed.state !== 'active', JSON.stringify(healed && healed.state));
}

// 8. S7.3：实战记录摘要必须披露「已显示 N / 共 M」（调用方口径）
{
  fs.mkdirSync(path.join(tmp, '.superagent', 'methods'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-01-01',
    members: [{ name: 'sa-e2e', kind: 'specialist', owns: '端到端回归', method: '.superagent/methods/sa-e2e.md' }]
  }), 'utf8');
  fs.writeFileSync(path.join(tmp, '.superagent', 'methods', 'sa-e2e.md'), [
    '# sa-e2e', '', '## 实战记录', '', '### 端到端回归用例',
    '- 做法：先写断言再改实现', '- 证据：五套回归全绿', '- 验收：独立验收通过', ''
  ].join('\n'), 'utf8');
  const g = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做，谁来负责？', session_id: 'e-disclose' });
  ok('gate 披露已显示/共有的成员数', g.out.includes('已显示 1 / 共 1'), g.out.slice(0, 240));
  const ss = run('session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'e-ss' });
  ok('session-start 披露已显示/共有的成员数', ss.out.includes('已显示 1 / 共 1'), ss.out.slice(0, 240));
}

// 9. D-06 / D-18：历史教训必须真的到达 worker（不能只挂在父会话的 additionalContext 上）
{
  const s = 'e-lessons';
  const w = 'e-lessons-worker';
  fs.mkdirSync(path.join(tmp, '.superagent', 'lessons'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.superagent', 'lessons', 'sa-lesson.md'),
    '# 错题本\n\n## 2026-01-01 · 某次\n- **规则**：先写回归断言再改实现\n', 'utf8');
  const t = makeTranscript(w, s, 'sa-lesson', 'src/lesson.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'l1',
    tool_input: { agent_name: 'sa-lesson', prompt: 'SCOPE: src/lesson.ts' }
  });
  const g = run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: w,
    agent_id: w, agent_type: 'sa-lesson', transcript_path: t,
    tool_input: { path: 'src/lesson.ts' }
  });
  ok('历史教训被送进 worker 上下文', g.out.includes('历史教训') && g.out.includes('先写回归断言再改实现'), g.out.slice(0, 260));
}

// ── D-38：陈旧成员（名录里有、账号里没有）必须看得见、也派不出去 ──
//
// 以前「陈旧」只有一条没人调用的 reconcile 命令能算出来（只 stdout、不写回名录、
// 不阻断派工）—— 名义上有检测工具、实际上机制不生效。
// 现在：① 会话开始的注入里披露陈旧名单；② 派工到陈旧成员被拒（且不留台账记录）。
{
  const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-e2e-stale-'));
  fs.mkdirSync(path.join(proj2, '.superagent'), { recursive: true });
  fs.writeFileSync(path.join(proj2, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-01-01',
    members: [
      { name: 'sa-stale-gone', kind: 'specialist', owns: '陈旧成员用例' },
      { name: 'sa-live-member', kind: 'specialist', owns: '账号里存在的成员' }
    ]
  }), 'utf8');
  const acct = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-e2e-acct-'));
  fs.mkdirSync(path.join(acct, 'sa-live-member'), { recursive: true });
  const envStale = { SAR_ACCOUNT_AGENTS_DIR: acct, MINIMAX_PROJECT_DIR: proj2 };
  const staleDispatch = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-stale', turn_id: 't1',
    tool_input: { agent_name: 'sa-stale-gone', prompt: 'SCOPE: src/d38-stale.ts' }
  }, envStale);
  ok('D-38 派工到陈旧成员被拒',
    staleDispatch.out.includes('deny') && staleDispatch.out.includes('在账号里不存在'), staleDispatch.out.slice(0, 220));
  ok('D-38 陈旧成员的拦截消息点明「陈旧成员」',
    staleDispatch.out.includes('陈旧成员'), staleDispatch.out.slice(0, 220));
  const ledStale = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  ok('D-38 被拒的陈旧派工不留台账记录',
    !ledStale.dispatches.some((d) => String(d.agent_key || d.agent || '') === 'sa-stale-gone'),
    JSON.stringify(ledStale.dispatches.map((d) => d.agent_key || d.agent)));
  const liveDispatch = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-live', turn_id: 't1',
    tool_input: { agent_name: 'sa-live-member', prompt: 'SCOPE: src/d38-live.ts' }
  }, envStale);
  ok('D-38 派工到账号里存在的成员不受影响', !liveDispatch.out.includes('deny'), liveDispatch.out.slice(0, 200));
}

console.log(fail === 0 ? '>>> E2E ALL PASS' : '>>> E2E FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
