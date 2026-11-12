import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('MISS ' + f); continue; }
  const buf = fs.readFileSync(f);
  let txt = null;
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) txt = buf.toString('utf16le');
  else if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) txt = buf.toString('utf8').slice(1);
  if (txt === null) { console.log('SKIP(已是 utf8/其它) ' + f); continue; }
  fs.writeFileSync(f, txt, 'utf8');
  console.log('CONVERTED ' + f + ' bytes=' + buf.length);
}