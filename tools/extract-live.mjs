// 活体触发链路取证：从**指定子会话**的真实 transcript 里抽取**原始行**（逐行复制，不改写）
// 用法：node tools/extract-live.mjs <child_session_id> [outFile] [marker]
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.USERPROFILE;
const DIR = path.join(HOME, 'AppData', 'Local', 'Temp', 'minimax-plugin-hooks', 'transcripts');
const target = process.argv[2];
const outFile = process.argv[3] || path.join(process.cwd(), 'docs', 'audit', 'live-trigger-evidence.txt');
const marker = process.argv[4] || 'live-probe';
if (!target || !target.startsWith('mvs_')) {
  console.log('用法：node extract-live.mjs <child_session_id> [outFile] [marker]');
  process.exit(2);
}
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.compatible.jsonl'));
let hit = null;
for (const f of files) {
  const p = path.join(DIR, f);
  let first = '';
  try {
    // 整读再切行：按字节截断会把多字节字符切碎，JSON.parse 直接失败。
    first = fs.readFileSync(p, 'utf8').split(/\r?\n/).find(l => l.trim()) || '';
  } catch (e) { continue; }
  try {
    const j = JSON.parse(first);
    if (j.sessionId === target) { hit = { p, f }; break; }
  } catch (e) {}
}
if (!hit) { console.log('SESSION_TRANSCRIPT_NOT_FOUND ' + target + ' scanned=' + files.length); process.exit(2); }
const txt = fs.readFileSync(hit.p, 'utf8');
const lines = txt.split(/\r?\n/).filter(Boolean);
const keep = [];
for (const line of lines) {
  let role = '', ts = '';
  try {
    const j = JSON.parse(line);
    role = (j.message && j.message.role) || j.type || '';
    ts = j.timestamp || '';
  } catch (e) {}
  if (line.includes(marker) || line.includes('已拦截') || line.includes('越界管控') ||
      line.includes('permissionDecision')) {
    keep.push('[' + ts + '][' + role + '] ' + line);
  }
}
const header = [
  '# 活体触发链路证据（父会话从真实子会话 transcript 逐行复制，未改写）',
  '',
  '- 子会话 id：' + target,
  '- transcript 文件：' + hit.f,
  '- transcript 绝对路径：' + hit.p,
  '- transcript 原始总行数：' + lines.length + '，命中行数：' + keep.length,
  '- 定位标记：' + marker,
  '- 复制命令（可复现）：node docs/audit/.tmp-parent/extract-live.mjs ' + target + ' docs/audit/live-trigger-evidence.txt ' + marker,
  '',
  '## 原始行（逐行复制，未改写）',
  ''
].join('\n');
fs.writeFileSync(outFile, header + keep.join('\n') + '\n', 'utf8');
console.log('WROTE ' + outFile + ' lines=' + keep.length + ' from ' + hit.f + ' (sessionId=' + target + ')');