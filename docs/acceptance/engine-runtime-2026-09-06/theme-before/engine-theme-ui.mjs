import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'file:///D:/universe/mempool/mempool/scripts/universe/visual-qa/node_modules/playwright/index.mjs';
import { contrastProbe } from 'file:///D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5/scripts/universe/visual-qa/contrast-probe.mjs';
const [tool, theme, widthInput] = process.argv.slice(2);
const width = Number(widthInput);
assert.ok(['ots','musig2'].includes(tool)); assert.ok(['light','dark'].includes(theme)); assert.ok([390,1440].includes(width));
const name = `engine-theme-${tool}-${theme}-${width}`;
const result = { startedAt:new Date().toISOString(),tool,theme,width,scope:'Actual frontend and gateway with candidate monolith and owned Bitcoin header reads; no intercepted responses; fresh headless profile; theme contrast and rendered provided-proof result.' };
const transcript=JSON.parse(fs.readFileSync(new URL('public-musig2-transcript.json',import.meta.url),'utf8'));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--window-size=1440,1000','--window-position=0,0']});
const page=await browser.newPage({viewport:{width,height:width===390?844:1000},serviceWorkers:'block'});
await page.addInitScript(theme=>localStorage.setItem('theme-preference',theme),theme);
const root=tool==='ots'?'app-opentimestamps-verify':'app-multiparty-musig2';
result.responses=[];
page.on('response',async response=>{if(/public-sessions\/verify|timestamps\/proofs\/verify/.test(response.url())) {try{result.responses.push({url:response.url(),status:response.status(),body:await response.json()});}catch{}}});
try {
  await page.goto('http://127.0.0.1:4310'+(tool==='ots'?'/tools/timestamp/verify':'/tools/multiparty/musig2'),{waitUntil:'domcontentloaded'});
  await page.locator(root+' textarea').first().waitFor();
  result.frontendRevision=await page.evaluate(()=>window.__env.GIT_COMMIT_HASH);
  assert.match(result.frontendRevision,/a974f79/);
  result.backendInfo=await (await fetch('http://127.0.0.1:4310/api/v1/backend-info')).json();
  if(tool==='ots') {
    const proof=fs.readFileSync('D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5/backend/src/api/intelligence/opentimestamps/__fixtures__/hello-world.txt.ots').toString('base64');
    await page.locator('#ots-proof').fill(proof);
    await page.locator('#ots-digest').fill('03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340');
    await page.getByRole('button',{name:'Verify Cryptographic Proof',exact:true}).click();
    await page.getByText('BITCOIN CONFIRMED',{exact:true}).waitFor({timeout:25000});
    const status=await page.locator(root+' [role="status"]').innerText();
    assert.ok(status.includes('358391')&&status.includes('2015-05-28T15:41:18.000Z')&&status.includes('Provided file digest matches'));
  } else {
    await page.locator('#musig2-keys').fill(transcript.participant_public_keys.join('\n'));
    await page.locator('#musig2-message').fill(transcript.message_hash);
    await page.locator(root+' summary').click();
    await page.locator('#musig2-nonces').fill(transcript.public_nonces.join('\n'));
    await page.locator('#musig2-partials').fill(transcript.partial_signatures.join('\n'));
    await page.locator('#musig2-final').fill(transcript.final_signature);
    await page.getByRole('button',{name:'Verify Public Data',exact:true}).click();
    await page.getByText('Public transcript verified',{exact:true}).waitFor();
    assert.ok((await page.locator(root).innerText()).toLowerCase().includes(transcript.final_signature.toLowerCase()));
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  await new Promise(resolve=>setTimeout(resolve,150));
  result.bodyText=await page.locator(root).innerText();
  result.contrast=await page.evaluate(contrastProbe);
  result.fields=await page.locator(root+' textarea, '+root+' input').evaluateAll(elements=>elements.map(el=>({id:el.id,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,fontSize:getComputedStyle(el).fontSize,valueLength:el.value.length})));
  result.geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.getAttribute('data-theme'),bodyClass:document.body.className}));
  assert.ok(result.geometry.scrollWidth<=width,'No page overflow');
  assert.deepEqual(result.contrast.text,[],'No low contrast rendered text');
  for(const field of result.fields) assert.notEqual(field.color,field.background,'Field text differs from its background');
  result.status='PASS';
}catch(error){result.status='FAIL';result.error=String(error);process.exitCode=1;}
finally {
  if(!page.isClosed()) await page.screenshot({path:new URL(name+'.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true}).catch(error=>{result.screenshotError=String(error);});
  result.finishedAt=new Date().toISOString();result.browser=browser.version();
  fs.writeFileSync(new URL(name+'.json',import.meta.url),JSON.stringify(result,null,2));
  await browser.close();console.log(JSON.stringify({name,status:result.status,error:result.error,contrast:result.contrast?.text.length}));
}
