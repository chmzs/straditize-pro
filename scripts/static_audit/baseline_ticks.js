const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE='http://127.0.0.1:23055';
(async()=>{
  const b=await chromium.launch({channel:'msedge',headless:true});
  const ctx=await b.newContext({viewport:{width:1680,height:1050},locale:'zh-CN'});
  const page=await ctx.newPage();
  const calib=[];
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/rpc')){try{const j=JSON.parse(r.postData()||'{}');if(j.method==='column.calibrateXTicks')calib.push(j.params);}catch{}}});
  await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.__straditize),undefined,{timeout:45000});
  await page.waitForTimeout(2500);
  const be=()=>page.evaluate(async()=>{const r=await fetch('http://127.0.0.1:23055/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'straditize.getDiagramData',params:{}})});const b=await r.json();return (b.result.columns||[]).map(c=>({id:c.id,xt:c.x_ticks}))});
  const R={};
  R.基线状态 = { 列数: (await be()).length, 已标定列数: (await be()).filter(c=>c.xt).length, 自动发出的标定请求数: calib.length };
  // 模拟 T1 的 gotoStage(6)
  await page.evaluate(async()=>{await window.__straditize.gotoStage(6);});
  await page.waitForTimeout(6000);
  R.gotoStage6之后 = { 已标定列数: (await be()).filter(c=>c.xt).length, 本次自动发出的标定请求数: calib.length, 请求体样本: calib.slice(0,2) };
  console.log(JSON.stringify(R,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
