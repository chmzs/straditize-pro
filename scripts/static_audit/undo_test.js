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
  for(let i=0;i<5;i++){await next();await page.waitForTimeout(5000);}
  await page.waitForTimeout(3000);
  const be=()=>page.evaluate(async()=>{const r=await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'straditize.getDiagramData',params:{}})});const b=await r.json();return (b.result.columns||[]).map(c=>({id:c.id,x_ticks:c.x_ticks}))});
  const fe=()=>page.evaluate(()=>window.__straditize.getState().columns.map(c=>({id:c.id,x_ticks:c.x_ticks})));
  const R={};
  R.标定后_后端 = (await be()).filter(c=>c.x_ticks).length;
  R.标定后_前端 = (await fe()).filter(c=>c.x_ticks).length;
  // 用户按 Ctrl+Z
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(2500);
  R.CtrlZ后_后端 = (await be()).filter(c=>c.x_ticks).length;
  R.CtrlZ后_前端 = (await fe()).filter(c=>c.x_ticks).length;
  // 再刷新一次后端数据（切步骤会重新 getDiagramData）
  await page.evaluate(async()=>{await window.__straditize.gotoStage(7);await window.__straditize.gotoStage(6);});
  await page.waitForTimeout(4000);
  R.刷新后_前端 = (await fe()).filter(c=>c.x_ticks).length;
  R.刷新后_后端 = (await be()).filter(c=>c.x_ticks).length;
  console.log(JSON.stringify(R,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
