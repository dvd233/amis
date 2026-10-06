import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {scenarios,structured,classify,summarize,stackLocation,requireRenderCoverage,verifyBaselineConfirmation} from './contract.mjs';
const ROOT=path.resolve(import.meta.dirname,'..');
const SOURCE=path.resolve(process.argv[2]),variant=process.argv[3];
assert.ok(['baseline','candidate'].includes(variant));
// This guard must succeed before importing Playwright or creating any listener/browser.
execFileSync('python3',[path.join(ROOT,'scripts/verify.py'),'post',SOURCE,variant],{stdio:'inherit'});
const M=JSON.parse(await fs.readFile(path.join(ROOT,'source-manifest.json')));
const out=path.join(ROOT,'results');
const build=JSON.parse(await fs.readFile(path.join(out,'build.json')));
assert.equal(build.variant,variant);
assert.equal(build.commit,M[variant==='baseline'?'base_commit':'source_commit']);
assert.equal(build.tree,M[variant==='baseline'?'base_tree':'source_tree']);
assert.equal(build.runId,process.env.GITHUB_RUN_ID);
assert.equal(build.runAttempt,process.env.GITHUB_RUN_ATTEMPT);
assert.equal(build.validationCommit,process.env.GITHUB_SHA);
assert.ok(Date.now()-Date.parse(build.completedAt)>=0 && Date.now()-Date.parse(build.completedAt)<60*60*1000,'Stale build provenance');
const exits=(await fs.readFile(path.join(out,'raw-exits.tsv'),'utf8')).trim().split('\n').slice(1).map(x=>x.split('\t'));
for(const label of ['source-pre','harness-selftests','install-harness','install-source','build-amis-formula','build-amis-core','build-amis-ui','build-amis','source-post','provenance','install-chromium']) assert.ok(exits.some(x=>x[0]===label&&x[1]==='0'),`Missing successful stage: ${label}`);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const browserMetadata=await fs.readFile(path.join(ROOT,'node_modules/playwright-core/browsers.json'));
assert.equal(hash(browserMetadata),M.browsers_json_sha256);
const browserInfo=JSON.parse(browserMetadata).browsers.find(x=>x.name==='chromium');
assert.equal(browserInfo.revision,M.chromium_revision);
assert.equal(browserInfo.browserVersion,M.chromium);
assert.equal(JSON.parse(await fs.readFile(path.join(ROOT,'node_modules/playwright-core/package.json'))).version,M.playwright);
const {chromium}=await import('playwright-core');
const assets=new Map();
for(const mod of Object.values(build.modules)) {
  const bytes=await fs.readFile(path.join(SOURCE,'packages/amis/sdk',mod.file));
  assert.equal(hash(bytes),build.inventory[mod.file].sha256);
  assets.set(mod.file,bytes.toString('utf8'));
}
const report={variant,source:build.commit,tree:build.tree,runId:build.runId,runAttempt:build.runAttempt,validationCommit:build.validationCommit,startedAt:new Date().toISOString(),completed:false,scenarios:[],infrastructureErrors:[],served:{}};
let server,browser;
try {
  server=http.createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      let filename,expected;
      if(pathname==='/') filename=path.join(ROOT,'harness/index.html');
      else if(pathname==='/harness/app.js') filename=path.join(ROOT,'harness/app.js');
      else if(pathname.startsWith('/sdk/') && Object.hasOwn(build.inventory,pathname.slice(5))) {
        const relative=pathname.slice(5);
        filename=path.join(SOURCE,'packages/amis/sdk',relative);expected=build.inventory[relative].sha256;
      } else { res.writeHead(404);res.end();return; }
      const bytes=await fs.readFile(filename),actual=hash(bytes);
      if(expected) assert.equal(actual,expected,'Served SDK bytes changed after build');
      report.served[pathname]={sha256:actual,bytes:bytes.length};
      const ext=path.extname(filename);
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml'})[ext] || 'application/octet-stream');
      res.end(bytes);
    } catch(error) { report.infrastructureErrors.push(String(error.stack));res.writeHead(500);res.end(); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,channel:'chromium',chromiumSandbox:true});
  report.browserVersion=browser.version();assert.equal(report.browserVersion,M.chromium);
  report.browserExecutable={path:chromium.executablePath(),sha256:hash(await fs.readFile(chromium.executablePath()))};
  for(const scenario of scenarios) {
    const dir=path.join(out,scenario.id);await fs.mkdir(dir,{recursive:true});
    const entry={id:scenario.id,phase:'initial',status:'failed',checkpoints:[],input:scenario,infraErrors:[],pageErrors:[],consoleErrors:[],consoleWarnings:[]};
    report.scenarios.push(entry);
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'zh-CN',userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'});
    await context.tracing.start({screenshots:true,snapshots:true,sources:true});
    const page=await context.newPage();page.setDefaultTimeout(12000);
    const pending=[];
    page.on('pageerror',e=>entry.pageErrors.push({name:e.name,message:e.message,stack:e.stack}));
    page.on('console',msg=>{
      if(!['error','warning'].includes(msg.type())) return;
      pending.push((async()=>{
        const args=await Promise.all(msg.args().map(a=>a.evaluate(x=>x instanceof Error?{name:x.name,message:x.message,stack:x.stack}:String(x)).catch(()=>null)));
        const target=msg.type()==='error'?entry.consoleErrors:entry.consoleWarnings;
        target.push({text:msg.text(),args});
      })());
    });
    page.on('requestfailed',r=>entry.infraErrors.push(`Request failed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response',r=>{if(r.status()>=400)entry.infraErrors.push(`HTTP ${r.status()}: ${r.url()}`);});
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin!==origin){entry.infraErrors.push(`Unexpected network: ${route.request().url()}`);return route.abort('blockedbyclient');}
      return route.continue();
    });
    const cdp=await context.newCDPSession(page);
    await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
    let observed=false,uiPassed=false,coverageProven=false;
    const read=()=>page.evaluate(()=>window.readCity());
    const result=()=>page.locator('.cxd-CityArea-Input');
    const columns=()=>page.locator('.cxd-PickerColumns-columnWrapper');
    const checkpoint=async name=>{
      const state=await read();
      const dom=await page.evaluate(()=>({label:document.querySelector('.cxd-CityArea-Input')?.textContent??null,popup:!!document.querySelector('.cxd-CityArea-popup'),columns:[...document.querySelectorAll('.cxd-PickerColumns-columnWrapper')].map(x=>({options:x.children.length,selected:x.querySelector('.is-selected')?.textContent??null})),bodyOverflow:document.body.style.overflow}));
      const item={name,state,dom};entry.checkpoints.push(item);
      await page.screenshot({path:path.join(dir,`${String(entry.checkpoints.length).padStart(2,'0')}-${name}.png`),fullPage:true});
      return item;
    };
    const noError=async()=>assert.equal((await read()).errors.length,0,'Runtime error from real renderer');
    const label=async value=>{await page.waitForFunction(v=>document.querySelector('.cxd-CityArea-Input')?.textContent===v,value);await noError();};
    const popupClosed=async()=>{await page.waitForFunction(()=>!document.querySelector('.cxd-CityArea-popup'));assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');};
    const open=async()=>{
      await result().tap();await page.locator('.cxd-CityArea-popup').waitFor({state:'visible'});
      await page.waitForFunction(()=>document.querySelectorAll('.cxd-PickerColumns-columnWrapper').length>0);
      await page.waitForFunction(()=>!document.querySelector('.cxd-CityArea-popup.in'));
      const style=await page.locator('.cxd-CityArea-popup').evaluate(el=>{const css=getComputedStyle(el),r=el.getBoundingClientRect();return {position:css.position,width:r.width,height:r.height,bottom:r.bottom,overflow:document.body.style.overflow};});
      assert.equal(style.position,'fixed');assert.ok(style.width>350&&style.width<=392);assert.ok(style.height>200&&style.height<844);assert.ok(Math.abs(style.bottom-844)<2);assert.equal(style.overflow,'hidden');
      assert.ok(await page.evaluate(()=>[...document.styleSheets].some(s=>s.href?.endsWith('/sdk/sdk.css')&&s.cssRules.length>100)),'Native SDK CSS must be loaded');
      await noError();
    };
    const select=async(index,text)=>{
      // Drive the real clipped mobile wheel with trusted CDP touch gestures.
      // No DOM click/evaluate shortcut, no offset/style/React-state mutation.
      for(let tries=0;tries<45;tries++) {
        const data=await columns().nth(index).evaluate((el,text)=>({target:[...el.children].findIndex(x=>x.textContent===text),selected:[...el.children].findIndex(x=>x.classList.contains('is-selected')),height:el.children[0]?.getBoundingClientRect().height}),text);
        assert.ok(data.target>=0,`Missing picker option: ${text}`);
        if(data.target===data.selected) return;
        assert.equal(data.height,40,'Use actual native 40px row height');
        const direction=Math.sign(data.target-data.selected),box=await columns().nth(index).locator('..').boundingBox();
        assert.ok(box&&box.height>=120&&box.width>50);
        const x=box.x+box.width/2,y=box.y+box.height/2;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        for(let n=1;n<=8;n++) {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-direction*40*n/8}]});await page.waitForTimeout(25);}
        await page.waitForTimeout(350); // Release after the native momentum threshold.
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.waitForFunction(({index,previous})=>{
          const list=document.querySelectorAll('.cxd-PickerColumns-columnWrapper')[index];
          return list&&[...list.children].findIndex(x=>x.classList.contains('is-selected'))!==previous;
        },{index,previous:data.selected});
        await page.waitForTimeout(250);await noError();
      }
      throw new Error(`Touch selection did not reach ${text}`);
    };
    const assertEmptyDistrict=async()=>{assert.equal(await columns().count(),3);assert.equal(await columns().nth(2).locator('li').count(),0);};
    const assertValue=async expected=>{await page.waitForFunction(value=>JSON.stringify(window.readCity().data?.address)===JSON.stringify(value),expected);};
    const confirm=async(expected,expectedLabel,expectCrash=false)=>{
      const before=await read();
      let preconfirm;
      if(expectCrash) {
        await noError();
        assert.equal(entry.pageErrors.length,0,'Page error before confirmation');
        await label(scenario.label);await assertValue(scenario.value);await assertEmptyDistrict();
        preconfirm=await checkpoint('preconfirm-baseline');
      }
      await page.locator('.cxd-PopUp-confirm').tap();
      await page.waitForFunction(n=>window.validation.rendererEvents.length>n,before.rendererEvents.length);
      assert.deepEqual((await read()).rendererEvents.at(-1),expected,'InputCity renderer change payload');
      if(expectCrash) {
        await page.waitForFunction(()=>window.validation.errors.length>0);
        const state=await read();
        entry.confirmationEvidence=verifyBaselineConfirmation(preconfirm,state,scenario,expected,expectedLabel.split(',').at(-1));
        observed=true;entry.phase='confirm';await checkpoint('expected-baseline-crash');return;
      }
      await popupClosed();await assertValue(expected);await label(expectedLabel);
      const after=await read();
      if(JSON.stringify(before.data.address)!==JSON.stringify(expected)) {
        assert.ok(after.formChanges.length>before.formChanges.length,'Missing form onChange');
        assert.deepEqual(after.formChanges.at(-1).data.address,expected);
        assert.ok(after.controlledUpdates>before.controlledUpdates,'Missing controlled props feedback');
      }
      await checkpoint('confirmed');
    };
    const dismiss=async(mode,committed,labelText,pendingText)=>{
      const before=await read();await select(1,pendingText);await assertEmptyDistrict();
      if(mode==='cancel') await page.locator('.cxd-PopUp-cancel').tap();
      else await page.locator('.cxd-PopUp-overlay').tap({position:{x:20,y:20}});
      await popupClosed();await label(labelText);await assertValue(committed);
      const after=await read();assert.deepEqual(after.rendererEvents,before.rendererEvents);assert.deepEqual(after.formChanges,before.formChanges);
      await checkpoint(`${mode}-dismissed`);await open();
    };
    try {
      assert.equal((await page.goto(origin+'/',{waitUntil:'networkidle'})).status(),200);
      await page.evaluate(config=>window.mountCity(config),{value:scenario.value,props:scenario.props??{}});
      await page.waitForFunction(()=>window.validation.sdkReady===true);
      if(variant==='baseline' && scenario.regression==='initial') {
        await page.waitForFunction(()=>window.validation.errors.length>0);
        observed=true;await checkpoint('expected-baseline-crash');
      } else {
        await label(scenario.label);await assertValue(scenario.value);await checkpoint('initial');
        await open();assert.equal(await columns().count(),scenario.columns??3);await checkpoint('open');
        if(scenario.regression==='initial') {
          await assertEmptyDistrict();await confirm(String(scenario.value),scenario.label);await open();await assertEmptyDistrict();await checkpoint('reopened');
        } else if(scenario.id==='controlled-roundtrip' || scenario.id==='structured-roundtrip') {
          const obj=scenario.id==='structured-roundtrip';
          const first=obj?structured(500229,'城口县'):'500229';
          await select(1,'城口县');await assertEmptyDistrict();
          await confirm(first,'重庆市,城口县',variant==='baseline');
          if(variant==='candidate') {
            await open();await assertEmptyDistrict();
            if(!obj) {
              await dismiss('cancel',first,'重庆市,城口县','丰都县');
              assert.equal(await columns().nth(1).locator('.is-selected').textContent(),'城口县');
              await dismiss('overlay',first,'重庆市,城口县','丰都县');
              assert.equal(await columns().nth(1).locator('.is-selected').textContent(),'城口县');
              await select(1,'重庆市市辖区');await select(2,'万州区');
              await confirm('500101','重庆市,重庆市市辖区,万州区');await open();
            }
            await select(1,'丰都县');await assertEmptyDistrict();
            await confirm(obj?structured(500230,'丰都县'):'500230','重庆市,丰都县');
            await open();await assertEmptyDistrict();await checkpoint('reopened');
          }
        } else if(scenario.id==='cross-province') {
          await select(0,'湖北省');await select(1,'仙桃市');await assertEmptyDistrict();
          await confirm('429004','湖北省,仙桃市',variant==='baseline');
          if(variant==='candidate') {
            await open();await select(0,'重庆市');await select(1,'城口县');await assertEmptyDistrict();await confirm('500229','重庆市,城口县');
            await open();await select(0,'四川省');await select(1,'成都市');await select(2,'锦江区');await confirm('510104','四川省,成都市,锦江区');
          }
        } else if(scenario.id==='cancel-overlay-reopen') {
          await dismiss('cancel',500101,scenario.label,'城口县');
          assert.equal(await columns().nth(1).locator('.is-selected').textContent(),'重庆市市辖区');
          await dismiss('overlay',500101,scenario.label,'丰都县');
          assert.equal(await columns().nth(2).locator('.is-selected').textContent(),'万州区');
          await confirm('500101',scenario.label);
        } else {
          if(!scenario.columns) assert.ok(await columns().nth(2).locator('li').count()>0);
          await confirm(scenario.result??String(scenario.value),scenario.label);
        }
        uiPassed=!(variant==='baseline'&&scenario.regression);
      }
    } catch(error) {entry.assertionError=error.stack;}
    try {
      const coverage=(await cdp.send('Profiler.takePreciseCoverage')).result;
      entry.coverage={};
      for(const [name,mod] of Object.entries(build.modules)) {
        const fileCoverage=coverage.find(x=>x.url===origin+'/sdk/'+mod.file);
        const executed=requireRenderCoverage(mod,fileCoverage?.functions??[]);
        entry.coverage[name]={...mod,function:executed};
      }
      coverageProven=true;
    } catch(error) {entry.verificationError=error.stack;}
    // Close the observation window before deciding any case outcome. Late
    // screenshot/trace/close errors must not escape the final classification.
    await page.screenshot({path:path.join(dir,'final.png'),fullPage:true}).catch(e=>entry.infraErrors.push(String(e)));
    await context.tracing.stop({path:path.join(dir,'trace.zip')}).catch(e=>entry.infraErrors.push(String(e)));
    try {entry.finalState=await read();} catch(error) {entry.verificationError=error.stack;}
    await Promise.all(pending); // Materialize console Error handles while the page is alive.
    await context.close();
    await Promise.all(pending); // Include any events delivered during context shutdown.
    try {
      if(entry.verificationError) throw new Error(entry.verificationError);
      const runtimeErrors=[...entry.finalState.errors,...entry.pageErrors];
      for(const message of entry.consoleErrors) {
        const objects=message.args.filter(x=>x&&typeof x==='object'&&x.stack);
        if(objects.length) runtimeErrors.push(...objects);
        else entry.infraErrors.push(`Unclassified console.error: ${message.text}`);
      }
      entry.runtimeErrors=runtimeErrors.map(error=>{
        const location=stackLocation(error.stack,origin,build.modules,assets);
        return {...error,location,knownCityAreaMapError:error.name==='TypeError'&&/Cannot read properties of undefined \(reading ['"]map['"]\)/.test(error.message)&&!!location};
      });
      if(entry.assertionError) throw new Error(entry.assertionError);
      entry.status=classify({variant,scenario,phase:entry.phase,observed,errors:entry.runtimeErrors,infraErrors:entry.infraErrors,uiPassed,mobileProven:entry.finalState.cityAreaObserved&&entry.finalState.mobileUI===true,coverageProven});
    } catch(error) {entry.verificationError=error.stack;}
    if(entry.infraErrors.length)entry.status='failed';
    await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(entry,null,2)+'\n');
    console.log(`${variant}: ${entry.id}: ${entry.status}`);
  }
  assert.equal(report.infrastructureErrors.length,0);
  report.summary=summarize(variant,report.scenarios);
  report.completed=true;
} catch(error) {report.fatal=error.stack;process.exitCode=1;}
finally {
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  report.finishedAt=new Date().toISOString();
  await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
  if(!report.completed)process.exitCode=1;
}
