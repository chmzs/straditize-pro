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
  await page.waitForTimeout(4000);
  const be=()=>page.evaluate(async()=>{const r=await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'straditize.getDiagramData',params:{}})});const b=await r.json();return (b.result.columns||[]).map(c=>({id:c.id,xt:c.x_ticks}))});
  const fe=()=>page.evaluate(()=>window.__straditize.getState().columns.map(c=>({id:c.id,xt:c.x_ticks})));
  const R={};
  // 用户在步骤 6 手动输入并保存（会 push history）
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').fill('0');
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').fill('50');
  await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').click();
  await page.waitForTimeout(3500);
  const b1=(await be()).find(c=>c.xt&&c.xt[1]&&c.xt[1].value===50);
  const f1=(await fe()).find(c=>c.xt&&c.xt[1]&&c.xt[1].value===50);
  R['1_after_manual_calib'] = {backendHas50: !!b1, frontendHas50: !!f1, colId: b1 && b1.id};
  // 用户按 Ctrl+Z
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(3000);
  const b2=(await be()).find(c=>c.id===(b1&&b1.id));
  const f2=(await fe()).find(c=>c.id===(b1&&b1.id));
  R['2_after_ctrl_z'] = {backendXt: b2 && b2.xt, frontendXt: f2 && f2.xt, consistent: JSON.stringify(b2&&b2.xt)===JSON.stringify(f2&&f2.xt)};
  // 切到步骤 7 再回 6，让前端从后端重新拉取
  await page.evaluate(async()=>{await window.__straditize.gotoStage(7);});
  await page.waitForTimeout(2500);
  await page.evaluate(async()=>{await window.__straditize.gotoStage(6);});
  await page.waitForTimeout(4000);
  const f3=(await fe()).find(c=>c.id===(b1&&b1.id));
  R['3_after_refresh_frontend'] = {frontendXt: f3 && f3.xt, inputVal2: await page.evaluate(()=>document.querySelector('#inp-manual-tick-val2')?.value)};
  console.log(JSON.stringify(R,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
