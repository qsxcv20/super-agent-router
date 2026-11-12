// 在 app.asar（未压缩存储）里按关键字取上下文，验证宿主 plugin hook 的载荷构造。
import fs from 'node:fs';

const file = process.argv[2];
const keywords = process.argv.slice(3);
const CH = 4 * 1024 * 1024;
const fd = fs.openSync(file, 'r');
const size = fs.fstatSync(fd).size;
let pos = 0;
let carry = '';
const hits = [];
const buf = Buffer.alloc(CH);
while (pos < size) {
  const n = fs.readSync(fd, buf, 0, Math.min(CH, size - pos), pos);
  pos += n;
  const text = carry + buf.toString('latin1', 0, n);
  for (const kw of keywords) {
    let idx = 0;
    while (hits.length < 400) {
      const i = text.indexOf(kw, idx);
      if (i < 0) break;
      hits.push({ kw, off: pos - n + i - carry.length, ctx: text.slice(Math.max(0, i - 900), i + 1500) });
      idx = i + kw.length;
    }
  }
  carry = text.slice(-8000);
}
fs.closeSync(fd);
process.stdout.write(JSON.stringify(hits.map((h) => ({ kw: h.kw, off: h.off, ctx: h.ctx })), null, 2));
