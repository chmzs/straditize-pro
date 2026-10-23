const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE='http://127.0.0.1:23050';
const PNG=process.env.AUDIT_PNG;
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:true});
  const ctx=await b.newContext({viewport:{width:1680,height:1050},locale:'zh-CN'});
  const page=await ctx.newPage();
  const log=[]; const errs=[];
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/rpc')){try{log.push(JSON.parse(r.postData()||'{}').method);}catch{}}});
  page.on('response',async res=>{if(!res.url().includes('/rpc'))return;try{const j=await res.json();if(j&&j.error){let m='?';try{m=JSON.parse(res.request().postData()||'{}').method}catch{}errs.push(`${m} [${j.error.code}] ${String(j.error.message).slice(0,120)}`)}}catch{}});
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'audit.resetZero',params:{}})})});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__straditize),undefined,{timeout:45000});
  await page.waitForTimeout(1200);
  await page.setInputFiles('#file-input-image',PNG);
  await page.waitForTimeout(7000);
  const stages=[];
  for(let i=0;i<7;i++){
    const n=log.length;
    await page.evaluate(()=>document.querySelector('#rpc-error-modal')?.remove());
    const lbl=await page.evaluate(()=>document.querySelector('#btn-wf-next')?.textContent.trim());
    await page.click('#btn-wf-next').catch(e=>stages.push({err:String(e.message).slice(0,80)}));
    await page.waitForTimeout(5000);
    const st=await page.evaluate(()=>window.__straditize.getState());
    stages.push({i:i+1,btn:lbl,stage:st.stage,cols:st.columns.length,rpc:log.slice(n)});
  }
  console.log(JSON.stringify({stages,errs,allRpc:log},null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
