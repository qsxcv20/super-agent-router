import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const PROJ = process.env.SAR_PROJECT_DIR || process.cwd();

let fail = 0;
const ok = (l, c, e='') => { if(!c) fail++; console.log((c?'PASS ':'FAIL ')+l+(e?' :: '+e:'')); };

// 1. hooks.json 是合法 JSON 且结构符合官方契约
let hj = null;
try { hj = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')); }
catch (e) { console.log('JSON_PARSE_FAIL ' + e.message); process.exit(1); }
ok('hooks.json 合法 JSON', true);

const h = hj.hooks || {};
ok('含 SessionStart 事件', !!h.SessionStart, Object.keys(h).join(','));
ok('UserPromptSubmit 无 matcher', h.UserPromptSubmit && h.UserPromptSubmit[0].matcher === undefined, JSON.stringify(h.UserPromptSubmit[0] && h.UserPromptSubmit[0].matcher));
ok('SubagentStop 无 matcher', h.SubagentStop && h.SubagentStop[0].matcher === undefined, '');

// 2. 每个 handler 字段合规
let handlerCount = 0, bad = [];
for (const [ev, groups] of Object.entries(h)) {
  for (const g of groups) {
    for (const hh of (g.hooks || [])) {
      handlerCount++;
      if (hh.type !== 'command') bad.push(ev + ':type');
      if (!hh.command || typeof hh.command !== 'string') bad.push(ev + ':command');
      if (hh.timeout !== undefined && (!Number.isInteger(hh.timeout) || hh.timeout < 1 || hh.timeout > 10)) bad.push(ev + ':timeout');
      if (hh.commandWindows === undefined) bad.push(ev + ':no-commandWindows(Windows 必需)');
      for (const k of Object.keys(hh)) {
        if (!['type','command','commandWindows','timeout'].includes(k)) bad.push(ev + ':extra-' + k);
      }
    }
  }
}
ok('handler 字段全部合规', bad.length === 0, bad.join(' | '));
ok('handler 数量 <= 64', handlerCount <= 64, String(handlerCount));

// 3. SessionStart 脚本输出符合契约（plain text，exit 0）
const ss = spawnSync('node', [path.join(ROOT, 'scripts', 'session-start.mjs')], {
  input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'probe-ss' }),
  encoding: 'utf8', env: Object.assign({}, process.env, { PLUGIN_ROOT: ROOT, MINIMAX_PROJECT_DIR: PROJ }), timeout: 10000
});
ok('SessionStart exit 0', ss.status === 0, 'exit=' + ss.status + ' ' + (ss.stderr||'').slice(0,200));
ok('SessionStart 有输出注入', (ss.stdout||'').includes('super-agent-router'), (ss.stdout||'').slice(0,120));
ok('SessionStart 说明触发条件', (ss.stdout||'').includes('主动走编排流程'), '');
ok('SessionStart 提示先读 roster', (ss.stdout||'').includes('roster.json'), '');
ok('S9 SessionStart 注入编排层自己的教训', (ss.stdout||'').includes('编排层自己的历史教训') && (ss.stdout||'').includes('RT-'), (ss.stdout||'').slice(0,240));

// 3b. S12：SessionStart 必须写明主 agent 的管理层定位（不做苦力）
{
  const o = ss.stdout || '';
  ok('S12 写明主 agent 是管理层', o.includes('管理层'), '');
  ok('S12 写明「有专项成员就派工」', o.includes('有就派工'), '');
  ok('S12 划清分工边界（实现/批量取证/独立验收不归主 agent）', o.includes('分工边界') && o.includes('独立验收') && o.includes('不归你'), '');
  ok('S12 写明成员记忆共享但隔离', o.includes('共享但隔离'), '');
  ok('S12 仍保留单点小改直做', o.includes('单点小改'), '');
  ok('S12 「不预置成员」与「管理层定位」分开表述（不再互相打架）',
    o.includes('不预置成员') && o.includes('管理层'), '');
}

// 4. gate：没有可用专项成员的工作区里，普通提问必须 0 字节（单点小改零噪声）
const EMPTY_PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-hooks-empty-'));
const g = spawnSync('node', [path.join(ROOT, 'scripts', 'gate.mjs')], {
  input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '帮我看下这个错误', session_id: 'p' }),
  encoding: 'utf8', env: Object.assign({}, process.env, { PLUGIN_ROOT: ROOT, MINIMAX_PROJECT_DIR: EMPTY_PROJ }), timeout: 10000
});
ok('普通提问仍静默放行（无可用专项成员的工作区）', (g.stdout||'').trim() === '', JSON.stringify(g.stdout||'').slice(0,80));

// 4b. D-27：未命中时的条件式兜底 —— 有专项成员且该成员有实战记录时，注入一行
{
  const WITH = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-hooks-roster-'));
  fs.mkdirSync(path.join(WITH, '.superagent', 'methods'), { recursive: true });
  fs.writeFileSync(path.join(WITH, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-01-01',
    members: [{ name: 'sa-hooks', kind: 'specialist', owns: '钩子回归', method: '.superagent/methods/sa-hooks.md' }]
  }), 'utf8');
  fs.writeFileSync(path.join(WITH, '.superagent', 'methods', 'sa-hooks.md'), [
    '# sa-hooks', '', '## 实战记录', '', '### 钩子回归用例',
    '- 做法：先写断言再改实现', '- 证据：回归全绿', '- 验收：独立验收通过', ''
  ].join('\n'), 'utf8');
  const g2 = spawnSync('node', [path.join(ROOT, 'scripts', 'gate.mjs')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '帮我看下这个错误', session_id: 'p2' }),
    encoding: 'utf8', env: Object.assign({}, process.env, { PLUGIN_ROOT: ROOT, MINIMAX_PROJECT_DIR: WITH }), timeout: 10000
  });
  const out2 = (g2.stdout||'').trim();
  ok('D-27 未命中时条件式兜底注入一行', out2.includes('本工作区有可复用的专项成员') && out2.includes('roster.json'), out2.slice(0,140));
  ok('D-27 兜底注入不是完整路由指令', !out2.includes('本轮按编排流程处理'), out2.slice(0,160));
  ok('D-27 兜底注入只有一行', out2.split('\n').length === 1, 'lines=' + out2.split('\n').length);
}

// 5. matcher 覆盖面：guard 只看得到被 matcher 命中的工具（D-03）
{
  const groups = h.PreToolUse || [];
  const writeGroup = groups.find((g) => g.matcher && /write\|edit/.test(g.matcher));
  const readGroup = groups.find((g) => g.matcher && /read\|glob/.test(g.matcher));
  const dangerGroup = groups.find((g) => g.matcher && /mavis_agent_delete/.test(g.matcher));
  ok('写类 matcher 覆盖 bash', !!writeGroup && /bash/.test(writeGroup.matcher), writeGroup ? writeGroup.matcher : '');
  ok('写类 matcher 覆盖 run_code（复合工具）', !!writeGroup && /run_code/.test(writeGroup.matcher), writeGroup ? writeGroup.matcher : '');
  ok('写类 matcher 覆盖 mavis（参数维度危险判定）', !!writeGroup && /\bmavis\b/.test(writeGroup.matcher), writeGroup ? writeGroup.matcher : '');
  ok('读类 matcher 覆盖 glob/grep', !!readGroup && /glob/.test(readGroup.matcher) && /grep/.test(readGroup.matcher), readGroup ? readGroup.matcher : '');
  ok('危险 matcher 覆盖删除/部署/发布', !!dangerGroup && /mavis_agent_delete/.test(dangerGroup.matcher) && /website_deploy/.test(dangerGroup.matcher) && /miniapp/.test(dangerGroup.matcher), dangerGroup ? dangerGroup.matcher : '');
}

// ── D-38：会话开始的注入里必须能看到「名录里有、账号里没有」的陈旧名单 ───
//
// 以前「陈旧」只有一条没人调用的 reconcile 命令能算出来（只 stdout、不写回名录、
// 不阻断派工）—— 名义上有检测工具、实际上机制不生效。
// 现在陈旧名单每次会话开始都能看到（与派工侧拒的是同一份名单计算）。
{
  const STALE_PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-hooks-stale-'));
  fs.mkdirSync(path.join(STALE_PROJ, '.superagent'), { recursive: true });
  fs.writeFileSync(path.join(STALE_PROJ, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-01-01',
    members: [
      { name: 'sa-stale-gone', kind: 'specialist', owns: '陈旧成员用例' },
      { name: 'sa-live-member', kind: 'specialist', owns: '账号里存在的成员' }
    ]
  }), 'utf8');
  const ACCT = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-hooks-acct-'));
  fs.mkdirSync(path.join(ACCT, 'sa-live-member'), { recursive: true });
  const ss2 = spawnSync('node', [path.join(ROOT, 'scripts', 'session-start.mjs')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'probe-stale' }),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PLUGIN_ROOT: ROOT, MINIMAX_PROJECT_DIR: STALE_PROJ, SAR_ACCOUNT_AGENTS_DIR: ACCT
    }),
    timeout: 10000
  });
  const o2 = ss2.stdout || '';
  ok('D-38 SessionStart 注入陈旧成员名单',
    o2.includes('陈旧成员') && o2.includes('sa-stale-gone'), o2.slice(0, 300));
  ok('D-38 SessionStart 不把账号里存在的成员列成陈旧',
    !o2.includes('sa-live-member'), o2.slice(0, 300));

  // 账号成员名单不可用时必须**披露**（不能静默：静默 = 存在性校验悄悄失效）。
  // 用自带名录的夹具（不依赖仓库根目录有没有名录）。
  const ss3 = spawnSync('node', [path.join(ROOT, 'scripts', 'session-start.mjs')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'probe-noacct' }),
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PLUGIN_ROOT: ROOT, MINIMAX_PROJECT_DIR: STALE_PROJ
    }),
    timeout: 10000
  });
  const o3 = ss3.stdout || '';
  ok('D-38 账号成员名单不可用时必须披露', o3.includes('账号成员名单不可用'), o3.slice(0, 300));
}

console.log(fail === 0 ? '>>> HOOKS ALL PASS' : '>>> HOOKS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);