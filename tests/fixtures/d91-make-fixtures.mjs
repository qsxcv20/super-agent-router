// D-91 收尾轮：从**真实 PTC transcript 字节**派生新夹具（tests/fixtures/）
// 事实（实测）：真实 PTC transcript 中「同一行同含外层 toolCall + 内层 child_calls」= 0 行；
// 真实形态是 assistant 行（外层 toolCall）与 toolResult 行（details.ptc.child_calls[]）**跨行交替**。
// ⇒ 主夹具按真实形态（跨行交替）派生；另出一份「同含行」夹具，标注真实中不存在，用于防宿主改形态。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.argv[2] || process.cwd();
const HOME = os.homedir();
const SRC = path.join(HOME, '.minimax', 'v2', 'sessions', '2026', '11', '12',
  '00-04-02-355-session_bXZzX2JjM2RjY2E1ZGU5YjRmNzlhZGRkY2UyZDU0OTgyZjQw', 'messages.jsonl');
const OUT = path.join(REPO, 'tests', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const outer = [], inner = [];
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch (e) { continue; }
  const m = o.message;
  const ct = m && Array.isArray(m.content) ? m.content.filter((x) => x && x.type === 'toolCall') : [];
  const cc = m && m.details && m.details.ptc && Array.isArray(m.details.ptc.child_calls) ? m.details.ptc.child_calls : [];
  if (ct.length) outer.push(o);
  if (cc.length) inner.push(o);
}
console.log('MK 真实外层行=' + outer.length + ' 真实内层行=' + inner.length);
// 真实出现过的取值（只取真实值，不自造参数）
const REAL_BASH = 'echo d86-live-probe';                 // 真实出现 9 次
const REAL_READ = 'docs/audit/defect-ledger.md';        // 真实内层 read 的 path 之一
let foundBash = false, foundRead = false;
for (const o of inner) for (const c of o.message.details.ptc.child_calls) {
  if (c.tool_name === 'bash' && c.input && c.input.command === REAL_BASH) foundBash = true;
  if (c.tool_name === 'read' && c.input && c.input.path === REAL_READ) foundRead = true;
}
console.log('MK 真实值核对：bash "' + REAL_BASH + '"=' + foundBash + '  read "' + REAL_READ + '"=' + foundRead);
if (!foundBash || !foundRead) { console.log('MK !! 真实值未命中，中止'); process.exit(1); }

const TURN = outer[0].turn_id;
function setInner(o, tool, input, tag) {
  const cc = o.message.details.ptc.child_calls;
  cc[0].tool_name = tool;
  cc[0].input = input;
  cc[0].child_tool_call_id = 'child-' + tag;
  cc[0].parent_tool_call_id = o.message.toolCallId;
  cc[0].status = 'completed';
  return o;
}
// 夹具 1（F1 形态）：5 次逐字相同的内层 read{path}（宿主只落 path ⇒ 参数没落全 ⇒ 不可比）
//   外层 run_code 行与内层行**跨行交替**（真实形态）
{
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push(JSON.stringify(outer[i]));
    const o = setInner(JSON.parse(JSON.stringify(inner[i])), 'read', { path: REAL_READ }, 'f1-' + i);
    out.push(JSON.stringify(o));
  }
  fs.writeFileSync(path.join(OUT, 'd91-ptc-inner-read-repeat.jsonl'), out.join('\n') + '\n', 'utf8');
  console.log('MK 写夹具 d91-ptc-inner-read-repeat.jsonl 行数=' + out.length);
}
// 夹具 2（F2 形态）：bash×3 + 1 条不可比 read + bash×2 —— 不可比记录在**末尾连续段之前**
{
  const out = [];
  const plan = ['bash', 'bash', 'bash', 'read', 'bash', 'bash'];
  for (let i = 0; i < plan.length; i++) {
    out.push(JSON.stringify(outer[i]));
    const input = plan[i] === 'bash' ? { command: REAL_BASH } : { path: REAL_READ };
    out.push(JSON.stringify(setInner(JSON.parse(JSON.stringify(inner[i])), plan[i], input, 'f2-' + i)));
  }
  fs.writeFileSync(path.join(OUT, 'd91-ptc-inner-read-breaks-run.jsonl'), out.join('\n') + '\n', 'utf8');
  console.log('MK 写夹具 d91-ptc-inner-read-breaks-run.jsonl 行数=' + out.length + ' 内层序列=bash,bash,bash,read,bash,bash');
}
// 夹具 3（防御性 · 同含行）：同一行里既有外层 message.content[].toolCall 又有 message.details.ptc.child_calls[]
//   诚实边界：真实 transcript 中这种行**不存在**（实测 0 行）⇒ 本夹具不是真实同源，是防宿主改形态的哨兵
{
  const out = [];
  for (let i = 0; i < 6; i++) {
    const o = JSON.parse(JSON.stringify(inner[i]));
    const ot = outer[i].message.content.find((x) => x && x.type === 'toolCall');
    o.message.content = [ot, { type: 'text', text: 'inner result ' + i }];
    out.push(JSON.stringify(setInner(o, 'bash', { command: REAL_BASH }, 'f3-' + i)));
  }
  fs.writeFileSync(path.join(OUT, 'd91-ptc-same-line-mixed.jsonl'), out.join('\n') + '\n', 'utf8');
  console.log('MK 写夹具 d91-ptc-same-line-mixed.jsonl 行数=' + out.length + '（合成同含行 · 真实中不存在）');
}
console.log('MK turn_id=' + TURN);
