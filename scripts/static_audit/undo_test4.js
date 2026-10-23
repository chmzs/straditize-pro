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
  const ink=()=>page.evaluate(()=>{const c=document.querySelector('#geology-canvas');const x=c.getContext('2d');const d=x.getImageData(0,0,c.width,c.height).data;let o=0,ink=0;for(let i=0;i<d.length;i+=4){if(d[i+3]===0)continue;o++;if(!(d[i]>250&&d[i+1]>250&&d[i+2]>250))ink++;}return {opaque:o,ink}});
  const fe=()=>page.evaluate(()=>({cols:(window.__straditize.getState().columns||[]).length, sidebarRows:document.querySelectorAll('.taxa-list-item, .taxa-item, [data-taxa-id]').length, activeTaxa:document.querySelector('#footer-active-taxa')?.textContent.trim()}));
  const be=()=>page.evaluate(async()=>{const r=await fetch('http://127.0.0.1:23050/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'straditize.getDiagramData',params:{}})});const b=await r.json();return (b.result.columns||[]).length});
  const R={};
  R.before = { fe: await fe(), backendCols: await be(), canvas: await ink() };
  // 用户手动标定一列（会产生 history push）
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').fill('0');
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').fill('50');
  await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').click();
  await page.waitForTimeout(3500);
  R.afterCalib = { fe: await fe(), backendCols: await be(), canvas: await ink() };
  // Ctrl+Z
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(3500);
  R.afterCtrlZ = { fe: await fe(), backendCols: await be(), canvas: await ink(),
                   stage: await page.evaluate(()=>window.__straditize.getState().stage) };
  console.log(JSON.stringify(R,null,1));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1)});
