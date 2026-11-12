// D-97 复核探针（会话库形态）：按 sessionId 自行解析 ~/.minimax/v2/sessions 下的 messages.jsonl。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function b64url(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function locate(id) {
  const want = b64url(id);
  const root = path.join(os.homedir(), '.minimax', 'v2', 'sessions');
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name.indexOf(want) >= 0) {
        const mj = path.join(p, 'messages.jsonl');
        if (fs.existsSync(mj)) return mj;
      }
      stack.push(p);
    }
  }
  return null;
}

function scan(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const st = {
    file, bytes: raw.length, lines: lines.length,
    textMentionChildCalls: 0, realChildCallArrays: 0, realChildCallItems: 0,
    contentToolUse: 0, contentToolCall: 0, contentItemTypes: {}, topKeys: {}, msgKeys: {},
    lineTypes: {}, sessionIds: {}, turnIdCount: 0, toolUseNames: {}, childToolNames: {},
    innerSample: null
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
    const det = m.details;
    if (det && typeof det === 'object' && det.ptc && typeof det.ptc === 'object' && Array.isArray(det.ptc.child_calls)) {
      st.realChildCallArrays += 1;
      st.realChildCallItems += det.ptc.child_calls.length;
      for (const c of det.ptc.child_calls) {
        if (!c || typeof c !== 'object') continue;
        const n = String(c.tool_name || c.name || '');
        st.childToolNames[n] = (st.childToolNames[n] || 0) + 1;
        if (!st.innerSample) st.innerSample = c;
      }
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
for (const id of process.argv.slice(2)) {
  const f = locate(id);
  out.push(f ? scan(f) : { sessionId: id, found: false });
}
process.stdout.write(JSON.stringify(out, null, 2));
