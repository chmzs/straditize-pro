const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE='http://127.0.0.1:23055';
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:true});
  const ctx=await b.newContext({viewport:{width:1680,height:1050},locale:'zh-CN'});
  const page=await ctx.newPage();
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__straditize),undefined,{timeout:45000});
  await page.waitForTimeout(2500);
  const cols=()=>page.evaluate(async()=>{const r=await fetch('http://127.0.0.1:23055/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'straditize.getDiagramData',params:{}})});const b=await r.json();return (b.result.columns||[]).map(c=>c.x_ticks)});
  const R={};
  R.gotoStage前 = (await cols()).filter(Boolean).length;
  await page.evaluate(async()=>{await window.__straditize.gotoStage(6);});
  R.gotoStage刚返回 = (await cols()).filter(Boolean).length;   // 这正是 e2e T5 读数的时刻
  await page.waitForTimeout(6000);
  R.等6秒后 = (await cols()).filter(Boolean).length;
  console.log(JSON.stringify(R,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
