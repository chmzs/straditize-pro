const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE='http://127.0.0.1:23050';
const PNG=process.env.AUDIT_PNG;
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:true});
  const ctx=await b.newContext({viewport:{width:1680,height:1050},locale:'zh-CN'});
  const page=await ctx.newPage();
  const calib=[]; const xt=[];
  page.on('request',r=>{if(r.method()!=='POST'||!r.url().endsWith('/rpc'))return;try{const j=JSON.parse(r.postData()||'{}');
    if(j.method==='column.calibrateXTicks')calib.push(j.params);
    if(j.method==='algorithm.detectXTicks')xt.push(j.params);}catch{}});
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'audit.resetZero',params:{}})})});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__straditize),undefined,{timeout:45000});
  await page.waitForTimeout(1200);
  await page.setInputFiles('#file-input-image',PNG);
  await page.waitForTimeout(7000);
  const clickNext=async()=>{await page.evaluate(()=>document.querySelector('#rpc-error-modal')?.remove());await page.click('#btn-wf-next');};
  for(let i=0;i<4;i++){await clickNext();await page.waitForTimeout(5000);}
  const n0=calib.length;
  await clickNext(); await page.waitForTimeout(8000);
  const first=calib.slice(n0);
  // 面板上用户看到的进度与输入框回填值
  const panel=await page.evaluate(()=>{
    const p=document.querySelector('.step-panel[data-step="6"]');
    return p?{text:(p.textContent||'').replace(/\s+/g,' ').trim().slice(0,400),
      v1:document.querySelector('#inp-manual-tick-val1')?.value,
      v2:document.querySelector('#inp-manual-tick-val2')?.value}:null;});
  console.log(JSON.stringify({detectXTicksParams:xt,首次进入步骤6的标定请求数:first.length,请求体:first,面板:panel},null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
