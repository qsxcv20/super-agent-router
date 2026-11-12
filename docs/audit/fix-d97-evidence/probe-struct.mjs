// D-97 复核探针（结构性）：区分「真的存在 details.ptc.child_calls 数组」与「文本里出现 child_calls 字样」。
import fs from 'node:fs';
import path from 'node:path';

function scan(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const st = {
    file: path.basename(file),
    bytes: raw.length,
    lines: lines.length,
    textMentionChildCalls: 0,      // 原始行里含 'child_calls' 子串（含文本误命中）
    realChildCallArrays: 0,       // 结构上存在 details.ptc.child_calls 且是数组
    realChildCallItems: 0,        // 上述数组的元素总数
    contentToolUse: 0,            // content[] 里 type==='tool_use'
    contentToolCall: 0,           // content[] 里 type==='toolCall'
    contentItemTypes: {},         // content[] 元素类型分布
    topKeys: {},                  // 顶层键出现次数
    msgKeys: {},                  // message 键出现次数
    msgRoles: {},                 // message.role 分布
    lineTypes: {},                // 顶层 type 分布
    sessionIds: {},               // 顶层 sessionId 分布
    turnIdCount: 0,               // 顶层 turn_id 出现次数
    toolUseNames: {}
  };
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    if (line.indexOf('child_calls') >= 0) st.textMentionChildCalls += 1;
    if (!obj || typeof obj !== 'object') continue;
    for (const k of Object.keys(obj)) st.topKeys[k] = (st.topKeys[k] || 0) + 1;
    st.lineTypes[String(obj.type)] = (st.lineTypes[String(obj.type)] || 0) + 1;
    if (obj.sessionId) st.sessionIds[String(obj.sessionId)] = (st.sessionIds[String(obj.sessionId)] || 0) + 1;
    if (obj.turn_id || obj.turnId) st.turnIdCount += 1;
    const m = obj.message;
    if (!m || typeof m !== 'object') continue;
    for (const k of Object.keys(m)) st.msgKeys[k] = (st.msgKeys[k] || 0) + 1;
    st.msgRoles[String(m.role)] = (st.msgRoles[String(m.role)] || 0) + 1;
    const det = m.details;
    if (det && typeof det === 'object' && det.ptc && typeof det.ptc === 'object' && Array.isArray(det.ptc.child_calls)) {
      st.realChildCallArrays += 1;
      st.realChildCallItems += det.ptc.child_calls.length;
    }
    if (Array.isArray(m.content)) {
      for (const item of m.content) {
        if (!item || typeof item !== 'object') continue;
        const t = String(item.type);
        st.contentItemTypes[t] = (st.contentItemTypes[t] || 0) + 1;
        if (t === 'tool_use') { st.contentToolUse += 1; st.toolUseNames[String(item.name)] = (st.toolUseNames[String(item.name)] || 0) + 1; }
        if (t === 'toolCall') { st.contentToolCall += 1; st.toolUseNames['toolCall/' + String(item.name)] = (st.toolUseNames['toolCall/' + String(item.name)] || 0) + 1; }
      }
    }
  }
  return st;
}

const out = [];
for (const f of process.argv.slice(2)) out.push(scan(f));
process.stdout.write(JSON.stringify(out, null, 2));
