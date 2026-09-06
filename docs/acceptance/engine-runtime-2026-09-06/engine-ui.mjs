import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'file:///D:/universe/mempool/mempool/scripts/universe/visual-qa/node_modules/playwright/index.mjs';
const base='http://127.0.0.1:4310';
const transcript=JSON.parse(fs.readFileSync(new URL('public-musig2-transcript.json',import.meta.url),'utf8'));
const fixtures='D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5/backend/src/api/intelligence/opentimestamps/__fixtures__/';
const proof=name=>fs.readFileSync(fixtures+name).toString('base64');
const digest='03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340';
const evidence={startedAt:new Date().toISOString(),scope:'Actual browser -> existing gateway4310 -> candidate monolith -> configured owned Bitcoin source. No fixtures or intercepted responses in the browser. One fresh-profile background tab.',observations:[],assertions:[]};
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--window-size=1440,1000','--window-position=0,0']});
const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
evidence.browser=browser.version();
page.on('response',async response=>{
  if(response.url().includes('/public-sessions/verify')||response.url().includes('/timestamps/proofs/verify')) {
    try {evidence.observations.push({path:new URL(response.url()).pathname,status:response.status(),body:await response.json()});} catch {}
  }
});
async function poll(fn,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Expected rendered result did not arrive');}
async function capture(name){const text=await page.locator('body').innerText();fs.writeFileSync(new URL(name+'.txt',import.meta.url),text);await page.screenshot({path:new URL(name+'.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});return text;}
const musigStatus=()=>page.locator('app-multiparty-musig2 [role="status"]');
const otsStatus=()=>page.locator('app-opentimestamps-verify [role="status"]');
async function verifyOts(text,expected,digestValue=''){
  await page.locator('#ots-proof').fill(text);await page.locator('#ots-digest').fill(digestValue);
  assert.equal(await page.getByText('BITCOIN CONFIRMED',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Verify Cryptographic Proof',exact:true}).click();
  await poll(async()=>await otsStatus().count()>0&&(await otsStatus().innerText()).includes(expected));
}
try{
  await page.goto(base+'/tools/multiparty/musig2',{waitUntil:'domcontentloaded'});
  await page.locator('#musig2-keys').waitFor();
  evidence.frontendRevision=await page.evaluate(()=>window.__env.GIT_COMMIT_HASH);
  assert.match(evidence.frontendRevision,/0a8e157/);
  await page.locator('#musig2-keys').fill(transcript.participant_public_keys.join('\n'));
  await page.locator('#musig2-message').fill(transcript.message_hash);
  await page.locator('app-multiparty-musig2 summary').click();
  await page.locator('#musig2-nonces').fill(transcript.public_nonces.join('\n'));
  await page.locator('#musig2-partials').fill(transcript.partial_signatures.join('\n'));
  await page.locator('#musig2-final').fill(transcript.final_signature);
  await page.getByRole('button',{name:'Verify Public Data',exact:true}).click();
  await poll(async()=>await musigStatus().count()>0&&(await musigStatus().innerText()).includes('Public transcript verified'));
  assert.ok((await page.locator('app-multiparty-musig2').innerText()).toLowerCase().includes(transcript.final_signature.toLowerCase()));
  await capture('musig2-complete');evidence.assertions.push('Complete public transcript and exact computed signature rendered');
  await page.locator('#musig2-partials').fill(['00'.repeat(32),transcript.partial_signatures[1]].join('\n'));
  assert.equal(await musigStatus().count(),0);
  await page.getByRole('button',{name:'Verify Public Data',exact:true}).click();
  await poll(async()=>await page.locator('app-multiparty-musig2 [role="alert"]').count()>0);
  assert.match(await page.locator('app-multiparty-musig2 [role="alert"]').innerText(),/invalid partial signature/i);
  await capture('musig2-corrupt');evidence.assertions.push('Changing transcript clears prior verdict; corrupt partial is visibly rejected');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#musig2-keys').waitFor();
  await page.getByRole('button',{name:'Verify Public Data',exact:true}).click();
  await poll(async()=>await musigStatus().count()>0&&(await musigStatus().innerText()).includes('Session incomplete'));
  await capture('musig2-key-only');evidence.assertions.push('Reload and key-only request show partial scope, not completed signing rounds');
  await page.goto(base+'/tools/timestamp/verify',{waitUntil:'domcontentloaded'});await page.locator('#ots-proof').waitFor();
  await verifyOts(proof('hello-world.txt.ots'),'Bitcoin anchoring verified',digest);
  const anchored=await otsStatus().innerText();
  assert.ok(anchored.includes('358391'));assert.ok(anchored.includes('000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319'));assert.ok(anchored.includes('2015-05-28T15:41:18.000Z'));assert.ok(anchored.includes(digest));
  await capture('ots-anchored');evidence.assertions.push('Exact mainnet proof digest, block hash, height and timestamp rendered from owned header verification');
  await verifyOts(proof('hello-world.txt.ots'),'Proof verification failed','ff'.repeat(32));
  await capture('ots-digest-mismatch');evidence.assertions.push('Wrong document digest cannot retain confirmed verdict');
  await verifyOts(proof('incomplete.txt.ots'),'Pending calendar attestation');
  await capture('ots-pending');evidence.assertions.push('Pending calendar receipt renders pending, without a confirmed badge');
  await verifyOts(proof('bad-stamp.txt.ots'),'Proof verification failed','7e3717bbe020f53cdc6c40154a1a8e55bddc13a28c8bb3c82e9ee64b81b44872');
  await capture('ots-bad-commitment');evidence.assertions.push('Invalid real proof commitment is rejected despite matching document digest');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#ots-proof').waitFor();
  assert.equal(await otsStatus().count(),0);assert.equal(await page.locator('#ots-proof').inputValue(),'');
  await verifyOts(proof('hello-world.txt.ots'),'Bitcoin anchoring verified',digest);
  await page.setViewportSize({width:390,height:844});await new Promise(resolve=>setTimeout(resolve,250));
  await capture('ots-recovered-mobile');evidence.assertions.push('Reload clears old proof and fresh resubmission recovers verified result at390px');
  evidence.status='PASS SCOPED CONSUMER JOURNEYS';
}catch(error){evidence.status='FAIL';evidence.error=String(error);if(!page.isClosed())await capture('engine-ui-failure').catch(()=>{});process.exitCode=1;}
finally{evidence.finishedAt=new Date().toISOString();fs.writeFileSync(new URL('engine-ui.json',import.meta.url),JSON.stringify(evidence,null,2));await browser.close();console.log(JSON.stringify({status:evidence.status,assertions:evidence.assertions.length,responses:evidence.observations.length,error:evidence.error}));}
