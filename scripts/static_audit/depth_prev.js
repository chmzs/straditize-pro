const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE='http://127.0.0.1:23050'; const PNG=process.env.AUDIT_PNG;
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:true});
  const ctx=await b.newContext({viewport:{width:1680,height:1050},locale:'zh-CN'});
  const page=await ctx.newPage();
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'audit.resetZero',params:{}})})});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__straditize),undefined,{timeout:45000});
  await page.waitForTimeout(1200);
  await page.setInputFiles('#file-input-image',PNG); await page.waitForTimeout(7000);
  const next=async()=>{await page.evaluate(()=>document.querySelector('#rpc-error-modal')?.remove());await page.click('#btn-wf-next');};
  for(let i=0;i<7;i++){await next();await page.waitForTimeout(4500);}
  await page.waitForTimeout(3000);
  await page.evaluate(()=>{const bb=Array.from(document.querySelectorAll('button')).find(x=>/导出/.test(x.textContent||''));bb&&bb.click();});
  await page.waitForTimeout(6000);
  const r=await page.evaluate(()=>{
    const t=document.querySelector('.wpd-export-dialog textarea'); if(!t)return null;
    const lines=t.value.split('\n');
    const depths=lines.slice(1,12).map(l=>l.split(',')[0]);
    const all=lines.slice(1).map(l=>l.split(',')[0]);
    const uniq=[...new Set(all)];
    return {header:lines[0].split(',').slice(0,3), rowCount:lines.length-1, firstDepths:depths, uniqueDepths:uniq.slice(0,6), uniqueCount:uniq.length};});
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
