// D-97 复核探针：统计任意 jsonl 文件里两种 tool call 形态与 child_calls 出现次数。
// 用法: node probe-forms.mjs <file> [<file> ...]
import fs from 'node:fs';

function scan(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  let childCalls = 0;
  let toolCallType = 0;      // {type:'toolCall', arguments:{}}
  let toolUseType = 0;       // {type:'tool_use', input:{}}
  let otherToolTypes = {};
  const toolNames = {};
  const topKeys = new Set();
  const sample = [];
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    if (obj && typeof obj === 'object') Object.keys(obj).forEach((k) => topKeys.add(k));
    if (line.includes('child_calls')) childCalls += 1;
    const holders = [];
    if (obj && obj.message && typeof obj.message === 'object') holders.push(obj.message);
    if (obj && obj.payload && typeof obj.payload === 'object') holders.push(obj.payload);
    for (const h of holders) {
      if (!Array.isArray(h.content)) continue;
      for (const item of h.content) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'toolCall') {
          toolCallType += 1;
          const n = String(item.name || '');
          toolNames['toolCall:' + n] = (toolNames['toolCall:' + n] || 0) + 1;
          if (sample.length < 3) sample.push(item);
        } else if (item.type === 'tool_use') {
          toolUseType += 1;
          const n = String(item.name || '');
          toolNames['tool_use:' + n] = (toolNames['tool_use:' + n] || 0) + 1;
          if (sample.length < 3) sample.push(item);
        } else if (typeof item.type === 'string' && item.type.indexOf('tool') >= 0) {
          otherToolTypes[item.type] = (otherToolTypes[item.type] || 0) + 1;
        }
      }
    }
  }
  return { file, lines: lines.length, bytes: raw.length, childCalls, toolCallType, toolUseType, otherToolTypes, toolNames, topKeys: [...topKeys].sort(), sample };
}

const out = [];
for (const f of process.argv.slice(2)) out.push(scan(f));
process.stdout.write(JSON.stringify(out, null, 2));
