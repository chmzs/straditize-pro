/**
 * 动作填充与填充文字的对比度门禁（`docs/UI_DESIGN_SYSTEM.md` §4 按钮、§10 验收）。
 *
 * 静态门禁第 16 组在 Node 侧复算 token 声明的对比度；这里补上「浏览器真的这样渲染吗」：
 * 把带**真实类名**的探针插进真实文档，读 `getComputedStyle` 的 color / backgroundColor，
 * 再按 WCAG 复算，两种主题 × 常态/悬停 全部要求 ≥4.5:1。
 *
 * 为什么用探针而不是现成按钮：
 *   1) `.ui-btn--success`（原 `.tool-btn.action`）只出现在深度模板的动作按钮上，
 *      正常启动流程里根本不在 DOM；
 *   2) 悬停态必须先真实 hover 才能测到级联关系——浅色下曾出现
 *      `body.theme-light .ui-btn--xs:hover:not(:disabled)`（(0,4,1)）盖掉
 *      `.ui-btn--success`（(0,3,0)）动作填充、把文字改回 `--accent-blue` 的事故：这正是
 *      「按钮悬停后文字突然看不清」的成因，本用例第一次跑就抓到了深色主题的这条回归；
 *   3) `filter: brightness()` 只影响渲染、不写进 computed 值，必须在 Node 侧按同一公式叠上去。
 *
 * 探针继承真实文档的层叠与主题作用域，所以它测的就是应用里的那条规则，不是复制品。
 */
import { expect, test, type Page } from './fixtures';
import { resetBaseline } from './helpers';

/** 3 类带不透明填充的动作按钮：填充与文字必须成对达标。 */
const PROBES = [
  { name: '主按钮', cls: 'ui-btn ui-btn--primary' },
  { name: '危险按钮', cls: 'ui-btn ui-btn--danger' },
  { name: '执行按钮', cls: 'ui-btn ui-btn--success' },
] as const;

/** 打开文件按钮：真实站点把 `.open-file-btn` 的 `!important` 半透明填充盖在 `.ui-btn--primary` 上。 */
const OPEN_FILE_CLS = 'ui-btn ui-btn--primary ui-btn--sm open-file-btn';

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgb(value: string): Rgb {
  const m = value.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i
  );
  if (!m) throw new Error(`无法解析颜色：${value}`);
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

function hexToRgb(value: string): Rgb {
  const h = value.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`token 不是 6 位色值：${value}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

/** `filter: brightness(k)` 作用于元素的**全部**渲染结果（背景与文字一起线性缩放）。 */
function applyBrightness(c: Rgb, k: number): Rgb {
  return {
    r: Math.min(255, c.r * k),
    g: Math.min(255, c.g * k),
    b: Math.min(255, c.b * k),
    a: c.a,
  };
}

function brightnessOf(filter: string): number {
  const m = filter.match(/brightness\(\s*([\d.]+)\s*\)/i);
  return m ? Number(m[1]) : 1;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const v = Math.min(255, channel) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrastRatio(bg: Rgb, fg: Rgb): number {
  const [hi, lo] = [relativeLuminance(bg), relativeLuminance(fg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const fmt = (c: Rgb) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

/**
 * 关掉过渡再测色：`:hover` 命中后 `getComputedStyle` 会返回**插值中**的中间色，
 * 不断言随机时间片上的颜色（真实站点第一次跑就是这么读出 rgb(14, 43, 68) 的）。
 */
async function disableTransitions(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('contrast-probe-noanim')) return;
    const style = document.createElement('style');
    style.id = 'contrast-probe-noanim';
    style.textContent = '*{transition:none !important;animation:none !important}';
    document.head.appendChild(style);
  });
}

/** 插入探针并置于最高层，便于 hover。 */
async function mountProbe(page: Page, name: string, cls: string, top: number): Promise<void> {
  await page.evaluate(
    ({ name, cls, top }) => {
      const el = document.createElement('button');
      el.setAttribute('data-contrast-probe', name);
      el.textContent = name;
      el.className = cls;
      el.style.position = 'fixed';
      el.style.left = '8px';
      el.style.top = `${top}px`;
      el.style.width = '160px';
      el.style.height = '32px';
      el.style.zIndex = '2147483647';
      document.body.appendChild(el);
    },
    { name, cls, top }
  );
}

async function readRendered(
  page: Page,
  probeName: string
): Promise<{ color: Rgb; background: Rgb; filter: number }> {
  const raw = await page.evaluate((name: string) => {
    const el = document.querySelector(`[data-contrast-probe="${name}"]`);
    if (!el) throw new Error(`探针不存在：${name}`);
    const cs = getComputedStyle(el);
    return { color: cs.color, background: cs.backgroundColor, filter: cs.filter };
  }, probeName);
  return {
    color: parseRgb(raw.color),
    background: parseRgb(raw.background),
    filter: brightnessOf(raw.filter),
  };
}

async function assertThemeContrast(page: Page, theme: string): Promise<void> {
  await disableTransitions(page);
  for (const [index, probe] of PROBES.entries()) {
    await mountProbe(page, probe.name, probe.cls, 8 + index * 40);
    const base = await readRendered(page, probe.name);
    const baseRatio = contrastRatio(base.background, base.color);
    console.log(
      `[contrast ${theme} ${probe.name}] 常态 ${baseRatio.toFixed(2)}:1 底=${fmt(base.background)} 字=${fmt(base.color)}`
    );
    expect(
      baseRatio,
      `${theme} ${probe.name} 常态：字 ${fmt(base.color)} / 底 ${fmt(base.background)} 只有 ${baseRatio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(4.5);

    await page.hover(`[data-contrast-probe="${probe.name}"]`);
    const hover = await readRendered(page, probe.name);
    const hoverBg = applyBrightness(hover.background, hover.filter);
    const hoverFg = applyBrightness(hover.color, hover.filter);
    const hoverRatio = contrastRatio(hoverBg, hoverFg);
    console.log(
      `[contrast ${theme} ${probe.name}] 悬停 ${hoverRatio.toFixed(2)}:1 底=${fmt(hoverBg)} 字=${fmt(hoverFg)} filter=${hover.filter}`
    );
    expect(
      hoverRatio,
      `${theme} ${probe.name} 悬停：字 ${fmt(hoverFg)} / 底 ${fmt(hoverBg)} 只有 ${hoverRatio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(4.5);
  }
}

test.describe('动作填充与填充文字的对比度契约', () => {
  test('浅色（默认）：4 类动作按钮常态与悬停均 ≥4.5:1', async ({ page }) => {
    await resetBaseline(page);
    expect(
      await page.evaluate(() => document.body.classList.contains('theme-light')),
      '默认主题为浅色'
    ).toBe(true);
    await assertThemeContrast(page, '浅色');
  });

  test('深色：4 类动作按钮常态与悬停均 ≥4.5:1', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('straditize-theme', 'dark'));
    await resetBaseline(page);
    expect(
      await page.evaluate(() => document.body.classList.contains('theme-light')),
      '显式选择深色时不得再带 theme-light'
    ).toBe(false);
    await assertThemeContrast(page, '深色');
  });

  test('打开文件按钮：悬停文字取 --text-primary，探针与真实站点同源', async ({ page }) => {
    await resetBaseline(page);
    await disableTransitions(page);

    const token = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('--text-primary').trim()
    );
    const expected = hexToRgb(token);

    await mountProbe(page, '打开文件', OPEN_FILE_CLS, 200);
    await page.hover('[data-contrast-probe="打开文件"]');
    const probe = await page.evaluate(() => {
      const el = document.querySelector('[data-contrast-probe="打开文件"]');
      if (!el) throw new Error('探针不存在');
      const cs = getComputedStyle(el);
      return { color: cs.color, background: cs.backgroundColor };
    });
    console.log(
      `[contrast 打开文件] 探针 悬停字=${probe.color} 底=${probe.background}（半透明叠加，只校验文字取色）--text-primary=${token}`
    );
    expect(
      parseRgb(probe.color),
      '悬停文字不得是白色（底色是半透明蓝叠加，浅色主题下白字不可读）'
    ).not.toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseRgb(probe.color), '探针悬停文字必须取 --text-primary').toEqual(expected);

    // 真实站点必须仍在，且与探针落到同一条级联结果上（它是顶栏的入口）。
    const real = page.locator('#btn-open-file');
    await expect(real).toBeVisible();
    const classes = (await real.getAttribute('class')) ?? '';
    expect(classes, '真实站点必须挂 open-file-btn').toContain('open-file-btn');
    await real.hover();
    const realColor = await real.evaluate((el) => getComputedStyle(el).color);
    console.log(`[contrast 打开文件] 真实站点 悬停字=${realColor} class=${classes}`);
    expect(parseRgb(realColor), '真实站点悬停文字必须取 --text-primary').toEqual(expected);
  });
});
