const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const repo=process.cwd();const S=path.join(repo,'plugin','scripts');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'sa-gate4-'));
const sbScripts=path.join(sandbox,'scripts');fs.mkdirSync(sbScripts,{recursive:true});
for(const f of ['record-gate.mjs','lessons-gate.mjs','lessons.mjs','lib.mjs'])fs.copyFileSync(path.join(S,f),path.join(sbScripts,f));
const proj=path.join(sandbox,'proj');
fs.mkdirSync(path.join(proj,'.superagent','methods'),{recursive:true});
fs.mkdirSync(path.join(proj,'.superagent','lessons'),{recursive:true});
const M=path.join(proj,'.superagent','methods'),L=path.join(proj,'.superagent','lessons');
const pdata=path.join(sandbox,'pdata');fs.mkdirSync(pdata,{recursive:true});
const led=(d)=>fs.writeFileSync(path.join(pdata,'dispatches.json'),JSON.stringify(d,null,2));
function run(script,payload,noData){
  const env=Object.assign({},process.env,{MINIMAX_PROJECT_DIR:proj});
  if(!noData)env.PLUGIN_DATA=pdata; else delete env.PLUGIN_DATA;
  const r=cp.spawnSync(process.execPath,[path.join(sbScripts,script),JSON.stringify(payload)],{encoding:'utf8',env});
  return {exit:r.status,stdout:(r.stdout||'').trim(),stderr:(r.stderr||'').split('\n')[0]||''};
}
const RG=(a,t)=>({agent:a,task:t,domain:'D',approach:'a',evidence:'e',verified_by:'verifier'});
const out={sandbox:sandbox,cases:{}};
fs.writeFileSync(path.join(M,'p1.md'),'# p1\n\n## 实战记录\n\n');
out.cases.B1_noLedger=run('record-gate.mjs',RG('p1','T1'),true);
led({dispatches:[{dispatch_id:'d1',agent:'verifier',agent_key:'verifier',state:'active',parent_session_id:'sess-1'}]});
out.cases.B2_activeButHasParentSession=run('record-gate.mjs',RG('p1','T2'));
led({dispatches:[{dispatch_id:'d1',agent:'verifier',agent_key:'verifier',state:'active'}]});
out.cases.B3_activeNoParentSessionLegacyMigration=run('record-gate.mjs',RG('p1','T3'));
led({dispatches:[{dispatch_id:'d1',agent:'verifier',agent_key:'verifier',state:'done',parent_session_id:'sess-1'}]});
out.cases.B4_doneWithParentSession=run('record-gate.mjs',RG('p1','T4'));
out.ledgerShapeEffect=fs.readFileSync(path.join(pdata,'dispatches.json'),'utf8');
// D-21 段定位：实战记录段之后还有别的 ## 段，里面带 ### 标题 —— 不应计入条数
let m2='# p2\n\n## 实战记录\n\n### 2026-11-10 · D1 · T1\n- 做法：a\n- 证据：e\n- 验收：verifier\n\n## 易错\n\n### 2026-11-10 · 踩坑一\n- 说明：x\n\n';
fs.writeFileSync(path.join(M,'p2.md'),m2);
out.cases.B5_sectionBoundary=run('record-gate.mjs',RG('p2','T5'));
out.p2After=fs.readFileSync(path.join(M,'p2.md'),'utf8');
// 段首定位口径：实战记录段在文件中间，前面有别的 ### 标题
let m3='# p3\n\n## 归属\n\n### 说明一\n- x\n\n## 实战记录\n\n';
fs.writeFileSync(path.join(M,'p3.md'),m3);
out.cases.B6_sectionNotFirst=run('record-gate.mjs',RG('p3','T6'));
out.p3After=fs.readFileSync(path.join(M,'p3.md'),'utf8');
const rb={};for(const d of ['methods','lessons'])for(const f of fs.readdirSync(path.join(repo,'.superagent',d)))rb[d+'/'+f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'.superagent',d,f))).digest('hex');
const ra={};for(const d of ['methods','lessons'])for(const f of fs.readdirSync(path.join(repo,'.superagent',d)))ra[d+'/'+f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'.superagent',d,f))).digest('hex');
out.repoUnchanged=JSON.stringify(rb)===JSON.stringify(ra);
console.log(JSON.stringify(out,null,2));