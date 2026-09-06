import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const cwd='D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5';
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
const files=git('diff','--name-only','--diff-filter=U').trim().split('\n');
const record={incoming:'ff2a108247a47a214db471850078ef8fcd98bf88',ours:'4e9c2749b5ede261a55cd1388fac1e66469eaefd',files:[]};
const pattern=/^<<<<<<< HEAD\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> [^\r\n]+\r?\n/gm;
const strip=value=>value.replace(/\s+(?:tabindex|role|aria-label)="[^"]*"/g,'').replace(/\s+i18n-aria-label\b/g,'').replace(/\s+/g,' ').trim();
for(const file of files) {
  if(file==='docs/acceptance/operation-matrix-2026-09-06.json') {
    fs.writeFileSync(cwd+'/'+file,git('show',record.ours+':'+file));
    record.files.push({file,resolution:'Preserve current source ledger pending regeneration with the complete evidence overlay.'});continue;
  }
  assert.ok(file.startsWith('frontend/src/app/universe/')||file==='frontend/src/styles.scss','Unexpected conflict '+file);
  let text=fs.readFileSync(cwd+'/'+file,'utf8');let hunks=0;
  text=text.replace(pattern,(full,ours,theirs)=>{
    hunks++;
    if(file==='frontend/src/styles.scss') {
      assert.equal(ours.trim(),'@use "styles/universe-responsive";');
      assert.equal(theirs.trim(),'@use "styles/universe-product-narrow";');
      return theirs+ours;
    }
    assert.equal(strip(ours),strip(theirs),'Non-accessibility conflict '+file);
    assert.match(ours,/role="region"/,'Expected stronger named scroll region '+file);
    assert.match(theirs,/tabindex="0"/,'Expected incoming keyboard focus repair '+file);
    return ours;
  });
  assert.ok(hunks>0);assert.ok(!/^(?:<<<<<<<|=======|>>>>>>>)/m.test(text));
  fs.writeFileSync(cwd+'/'+file,text);record.files.push({file,hunks,resolution:file.endsWith('styles.scss')?'Preserve both narrow-layout partials.':'Preserve keyboard focus plus the existing named region; conflict content is otherwise identical.'});
}
fs.writeFileSync('C:/WINDOWS/TEMP/explorer-repair-handoff-c5b7a2d25e4a4240933575908ba457ab/merge-mobile-resolution.json',JSON.stringify(record,null,2));
console.log(JSON.stringify({resolved:record.files.length}));
