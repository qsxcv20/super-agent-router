// 错题本闸门回归测试
// 用法：node tests/lessons-test.mjs
//   默认跑安装副本；跑仓库副本请显式指定：
//   $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\lessons-test.mjs
//
// 验证这些事：
//   1. 合规条目写入成功、文件格式正确
//   2. 四类重大错误之外的类型被拒
//   3. 归因公平：编排层的锅写进成员错题本要被拒 —— **逐个语序**各测一次
//   4. 归因公平不越界：成员自己承认失误（根因在成员侧）必须仍能写进去
//   5. 感想式规则被拒、缺字段被拒
//   6. 派工时能读到规则（自我进化闭环）
//   7. 无错题本的成员不产生噪音
//   8. 「_router」保留名被拒（Router 自己的错题本用 S1 的 7 字段模板）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
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

// 4. 归因甩锅给 Router 应被拒（原始语序：brief 给错）
{
  const r = gate({ ...GOOD, agent: 'sa-x-y', cause: 'Router brief 给错了', rule: '必须按 brief 做' });
  ok('甩锅给 Router 被拒', r.ok === false && r.errors.some(e => e.includes('Router')), JSON.stringify(r.errors));
}

// 4b. 归因公平必须按**语序**逐个拦到（契约 S7.2）。
// 只测一种语序等于没测 —— 换个语序就漏，是这条规则原本失效的原因。
const BLAME_CASES = [
  ['brief 给错', 'Router brief 给错了口径来源'],
  ['给错的 brief', '上游给错的 brief 导致取数口径不对'],
  ['派工给错', '派工给错了任务范围'],
  ['派工 brief 有误', '派工 brief 有误，要求与实际数据不符'],
  ['Router 的锅', '这是 Router 的锅，需求从来没讲清楚'],
  ['需求本身自相矛盾', '需求本身自相矛盾，两个口径互相冲突']
];
for (const [label, cause] of BLAME_CASES) {
  const r = gate({ ...GOOD, agent: 'sa-blame-' + label.replace(/\s/g, '-'), cause, rule: '必须按 brief 做' });
  ok('归因语序被拦：' + label,
    r.ok === false && r.errors.some(e => e.includes('归因指向 Router')),
    JSON.stringify(r.errors));
}

// 4c. 但闸门是拦**甩锅**，不是拦**认错** —— 成员自身失误必须仍能写进去。
{
  const r = gate({
    ...GOOD,
    agent: 'sa-own-fault',
    cause: '按 brief 给错了口径，取数时没有回显生效筛选条件',
    rule: '出图前必须回显实际生效的筛选条件，并与 brief 中的口径逐条核对'
  });
  ok('成员自身失误（执行给错）仍能写入', r.ok === true, JSON.stringify(r.errors));
}
{
  const r = gate({
    ...GOOD,
    agent: 'sa-own-fault-2',
    cause: '取数与出图之间没有强制回显生效条件，沿用了上月的筛选条件',
    rule: '出图前必须回显实际生效的筛选条件'
  });
  ok('成员自身失误（纯执行根因）仍能写入', r.ok === true, JSON.stringify(r.errors));
}
{
  const r = gate({
    ...GOOD,
    agent: 'sa-own-fault-3',
    cause: '不是 brief 给错，是我取数时没有回显生效口径',
    rule: '出图前必须回显实际生效的筛选条件'
  });
  ok('否定语境（澄清自己背锅）仍能写入', r.ok === true, JSON.stringify(r.errors));
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

// 9. 「_router」是保留名：Router 自己的错题本用 S1 的 7 字段模板，
//    成员格式写进去会把两套模板搅在一起。
{
  const r = gate({ ...GOOD, agent: '_router' });
  ok('「_router」保留名被拒', r.ok === false && r.errors.some(e => e.includes('_router')), JSON.stringify(r.errors));
  ok('「_router」错题本未被成员写入',
    !fs.existsSync(path.join(PROJ, '.superagent', 'lessons', '_router.md')));
}

console.log(fail === 0 ? '>>> LESSONS ALL PASS' : '>>> LESSONS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
