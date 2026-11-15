/**剪贴板复制：带非安全上下文的回退。

## 为什么要这一层

`navigator.clipboard` 只在**安全上下文**里存在（https，或 http://localhost / 127.0.0.1）。
用户用局域网地址访问本机服务时（设置页开启「远程访问」后就是这种情况），
`navigator.clipboard` 直接是 `undefined`，于是 `await navigator.clipboard.writeText(...)`
抛 `TypeError: Cannot read properties of undefined (reading 'writeText')` ——
用户看到的是「打开 riojaPlot 网页失败」，实际上网页根本没打开、剪贴板也没碰。

这一层只做两件事：**判空** + **回退到 execCommand('copy')**。
两种情况都失败时返回 `false`，由调用方决定怎么告诉用户（本仓禁止静默失败）。
 */

/** 复制文本；成功返回 true，失败返回 false（不抛异常）。 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒 / 文档未聚焦 / 非安全上下文兜底：继续走 execCommand 回退。
    }
  }
  return legacyCopy(text);
}

/**
 * 非安全上下文回退：临时 textarea + execCommand('copy')。
 *
 * `execCommand` 已废弃但仍是唯一在 http 页面上可用的同步复制手段；
 * 各浏览器在用户手势内调用时仍然支持。
 */
function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

