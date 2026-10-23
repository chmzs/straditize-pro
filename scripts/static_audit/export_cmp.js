const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE='http://127.0.0.1:23050';
const PNG=process.env.AUDIT_PNG;
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:true});
  const ctx=await b.newContext({viewport:{width:1680,height:1050},locale:'zh-CN'});
  const page=await ctx.newPage();
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'audit.resetZero',params:{}})})});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__straditize),undefined,{timeout:45000});
  await page.waitForTimeout(1200);
  await page.setInputFiles('#file-input-image',PNG);
  await page.waitForTimeout(7000);
  const next=async()=>{await page.evaluate(()=>document.querySelector('#rpc-error-modal')?.remove());await page.click('#btn-wf-next');};
  for(let i=0;i<7;i++){await next();await page.waitForTimeout(4500);}
  await page.waitForTimeout(3000);
  // 打开导出弹窗
  await page.evaluate(()=>{const bb=Array.from(document.querySelectorAll('button')).find(x=>/导出/.test(x.textContent||''));bb&&bb.click();});
  await page.waitForTimeout(6000);
  const preview = await page.evaluate(()=>{
    const t=document.querySelector('.wpd-export-dialog textarea');
    return t?t.value.split('\n').slice(0,3):null;});
  const backendCsv = await page.evaluate(async()=>{
    const r=await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'export.csv',params:{}})});
    const j=await r.json();
    const v=j.result; const s = typeof v==='string'?v:(v&&(v.csv||v.csv_content));
    return s?String(s).split('\n').slice(0,3):JSON.stringify(j).slice(0,200);});
  console.log(JSON.stringify({previewHead:preview, backendCsvHead:backendCsv},null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
