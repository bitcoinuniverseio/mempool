import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const temp='C:/WINDOWS/TEMP/explorer-repair-handoff-c5b7a2d25e4a4240933575908ba457ab';
const cwd='D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5/scripts/universe/visual-qa';
const original=JSON.parse(fs.readFileSync(temp+'/mobile-current-chrome/mobile-report.json','utf8'));
const out=temp+'/mobile-integrated';fs.mkdirSync(out,{recursive:true});
const result={startedAt:new Date().toISOString(),scope:'Same 80 planned route/viewport cases and unchanged mobile gate, each run in one isolated browser process. Fixtures are layout regression inputs only, not authority acceptance. No retries or omitted failures.',parentPid:process.pid,planned:original.cases.map(({route,viewport})=>({route,viewport})),cases:[]};
const write=()=>fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));write();
for(const item of result.planned) {
  const scope=item.route+'@'+item.viewport;
  const destination=path.join(out,scope); const log=fs.openSync(path.join(out,scope+'.log'),'w');
  const args=['mobile-check.mjs','--base=http://127.0.0.1:4310','--executable=C:/Program Files/Google/Chrome/Application/chrome.exe','--routes='+item.route,'--viewports='+item.viewport,'--out='+destination];
  const row={...item,startedAt:new Date().toISOString(),args};
  const child=spawn(process.execPath,args,{cwd,windowsHide:true,env:{...process.env,DEBUG:'pw:browser'},stdio:['ignore',log,log]});row.pid=child.pid;
  await new Promise(resolve=>child.on('exit',(code,signal)=>{row.code=code;row.signal=signal;resolve();}));fs.closeSync(log);
  row.finishedAt=new Date().toISOString();
  try {
    const report=JSON.parse(fs.readFileSync(path.join(destination,'mobile-report.json'),'utf8'));
    row.build=report.build;row.executionComplete=report.executionComplete;row.findings=report.findings;
    row.reportCases=report.cases;row.measured=report.report.length;
    row.pass=row.code===0&&report.executionComplete===true&&report.cases.length===1&&report.report.length===1&&report.findings.length===0&&report.cases[0].route===item.route&&report.cases[0].viewport===item.viewport;
  }catch(error){row.pass=false;row.error=String(error);}
  result.cases.push(row);write();
}
result.finishedAt=new Date().toISOString();result.executionComplete=result.cases.length===result.planned.length&&result.cases.every(row=>row.executionComplete===true);result.pass=result.executionComplete&&result.cases.every(row=>row.pass)&&new Set(result.cases.map(row=>row.build)).size===1;
write();process.exitCode=result.pass?0:1;
