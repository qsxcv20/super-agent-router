import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = 'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-lesson-'));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, '.superagent', 'lessons'), { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function gate(payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'lessons-gate.mjs'), JSON.stringify(payload)], {
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = { raw: r.stdout, err: r.stderr }; }
  return out;
}

const GOOD = {
  agent: 'sa-spreadsheet-extract',
  task: '月度对比图',
  type: '数据错误',
  symptom: '出图时沿用了上月的筛选条件，未回显实际口径',
  cause: '取数与出图之间没有强制回显生效条件',
  rule: '出图前必须回显实际生效的筛选条件，并与 brief 中的口径逐条核对',
  next_time: 'brief 的 ACCEPT 未含「口径已回显」时，不予派发',
  occurrence: 'single'
};

// 1. 合规条目应通过
{
  const r = gate(GOOD);
  ok('合规条目写入成功', r.ok === true, JSON.stringify(r).slice(0, 120));
}

// 2. 文件真的生成了，且格式正确
{
  const p = path.join(PROJ, '.superagent', 'lessons', 'sa-spreadsheet-extract.md');
  const raw = fs.readFileSync(p, 'utf8');
  ok('条目已落盘', raw.includes('类型：数据错误') && raw.includes('**规则**'), raw.slice(0, 80));
}

// 3. 非重大错误类型应被拒
{
  const r = gate({ ...GOOD, type: '网络抖动' });
  ok('非重大错误类型被拒', r.ok === false && r.errors.some(e => e.includes('四类')), JSON.stringify(r.errors));
}

// 4. 归因甩锅给 Router 应被拒
{
  const r = gate({ ...GOOD, agent: 'sa-x-y', cause: 'Router brief 给错了', rule: '必须按 brief 做' });
  ok('甩锅给 Router 被拒', r.ok === false && r.errors.some(e => e.includes('Router')), JSON.stringify(r.errors));
}

// 5. 缺 next_time 应被拒
{
  const r = gate({ ...GOOD, agent: 'sa-x-y', next_time: '' });
  ok('缺下次派工被拒', r.ok === false && r.errors.some(e => e.includes('next_time')), JSON.stringify(r.errors));
}

// 6. 感想式规则应被拒
{
  const r = gate({ ...GOOD, agent: 'sa-x-y', rule: '下次注意口径问题' });
  ok('感想式规则被拒', r.ok === false && r.errors.some(e => e.includes('不可执行')), JSON.stringify(r.errors));
}

// 7. 派工时能读到规则（自我进化闭环）
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'ls1', turn_id: 'lt1',
      tool_input: { agent_name: 'sa-spreadsheet-extract', prompt: 'SCOPE: a.ts' }
    }),
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: path.join(tmp, 'data') }
  });
  const out = r.stdout || '';
  ok('派工时注入历史教训', out.includes('additionalContext') && out.includes('口径'), out.slice(0, 160));
}

// 8. 无错题本的成员不产生噪音
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'ls2', turn_id: 'lt2',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: a.ts' }
    }),
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: path.join(tmp, 'data') }
  });
  ok('无错题本则静默', !(r.stdout || '').includes('additionalContext'), (r.stdout || '').slice(0, 80));
}

console.log(fail === 0 ? '>>> LESSONS ALL PASS' : '>>> LESSONS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);