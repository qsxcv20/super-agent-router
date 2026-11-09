import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

// 4. 既有 gate 仍正常
const g = spawnSync('node', [path.join(ROOT, 'scripts', 'gate.mjs')], {
  input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '帮我看下这个错误', session_id: 'p' }),
  encoding: 'utf8', env: Object.assign({}, process.env, { PLUGIN_ROOT: ROOT, MINIMAX_PROJECT_DIR: PROJ }), timeout: 10000
});
ok('普通提问仍静默放行', (g.stdout||'').trim() === '', JSON.stringify(g.stdout||'').slice(0,80));

console.log(fail === 0 ? '>>> HOOKS ALL PASS' : '>>> HOOKS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);