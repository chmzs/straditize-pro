/**
 * 步骤 4「检测横线 / 检测竖线」两个勾选框的**唯一**状态与文案来源。
 *
 * ## 为什么状态住在模块级
 *
 * 步骤 4 面板会**整块重建**：后端每次 `applyCleanupState` 之后 `Inspector`
 * 都会 `render()` 出新 HTML 再 `mount()` 重新绑事件。把勾选状态放进 `render()`
 * 的局部变量或某个 DOM 节点上，重建一次就回到默认值——用户看到的是"我刚取消
 * 勾选竖线，动一下别的东西它又自己勾上了"，而真正发出的检测参数与界面显示
 * 不一致。状态与 DOM 生命周期解耦是这里唯一可靠的放法。
 *
 * 会话内保持的边界：切 ROI、重渲染都不丢；**刷新页面回到默认**。这两个开关是
 * "这一次要检哪几类"的操作意图，不是需要跨会话记住的偏好。
 *
 * ## 为什么按 `kind` 统计而不是 `axis`
 *
 * 后端返回的 `kind` 是**类别声明**（A=贯穿横线，B=贯穿网格线，C=列内短竖线），
 * `axis` 只是由 `geometry` 派生的显示方向。拿 `axis` 统计等于把"哪一类"和
 * "朝哪个方向"混为一谈：两列数据里出现同一条竖线时，`axis` 相同而 `kind`
 * 可能分别是 B 和 C，而开关作用的对象是 `kind`。判据必须与被操纵的变量同一。
 *
 * ## 为什么取消勾选不删已检出的候选
 *
 * 删掉列表 = 用户确认过的几何一起消失，而那意味着取数结果变了。所以取消勾选
 * **只影响下一次检测**；当前列表里留着的那一类由 `orientationNotice()` 如实
 * 报数并指路"如需仅看横线请重新检测"。
 *
 * 本模块不碰 DOM、不发 RPC，因此可以脱离浏览器直接跑判据
 * （`frontend/test-step4-orientation.mjs`）。
 */

/** 这一次要生成哪几类候选。 */
export interface DetectOrientation {
  /** Kind A：贯穿横向线（坐标线）。 */
  horizontal: boolean;
  /** Kind B（贯穿网格线）**与** Kind C（列内短竖线）—— 用户眼里的"竖线"。 */
  vertical: boolean;
}

/** 默认两项都勾，与引入开关之前的行为一致。 */
export const DEFAULT_DETECT_ORIENTATION: DetectOrientation = {
  horizontal: true,
  vertical: true,
};

let detectOrientation: DetectOrientation = { ...DEFAULT_DETECT_ORIENTATION };

export function getDetectOrientation(): DetectOrientation {
  return { ...detectOrientation };
}

export function setDetectOrientation(patch: Partial<DetectOrientation>): DetectOrientation {
  detectOrientation = { ...detectOrientation, ...patch };
  return { ...detectOrientation };
}

/** 仅测试用：复位到默认（等价于"新开一个会话"）。 */
export function resetDetectOrientation(): DetectOrientation {
  detectOrientation = { ...DEFAULT_DETECT_ORIENTATION };
  return { ...detectOrientation };
}

/**
 * 按 `kind` 统计候选条数。
 *
 * 只认 `'A'` 为横线，其余（`'B'` / `'C'`）一律算竖线：与后端的开关口径
 * （`include_horizontal` 管 A、`include_vertical` 管 B 与 C）逐字对应。
 * 未知 `kind` 归竖线一侧会让"有东西没被分类"被静默吞掉，所以这里对未知值
 * 显式抛错——宁可红，也不要统计悄悄错位。
 */
export function countByOrientation<T extends { kind: string }>(
  candidates: readonly T[]
): { horizontal: number; vertical: number } {
  let horizontal = 0;
  let vertical = 0;
  for (const candidate of candidates) {
    if (candidate.kind === 'A') {
      horizontal += 1;
    } else if (candidate.kind === 'B' || candidate.kind === 'C') {
      vertical += 1;
    } else {
      throw new Error(
        `未知的候选类别 kind=${String((candidate as { kind?: unknown }).kind)}：` +
          '只能是 A（贯穿横线）/ B（贯穿竖线）/ C（列内竖线）'
      );
    }
  }
  return { horizontal, vertical };
}

/**
 * 当前列表里留着"用户刚说不想看"的那一类时，给出的提示文本（空串表示无需提示）。
 *
 * 只提示、不删数据：删除会连带抹掉已确认的几何并改变取数结果。
 */
export function orientationNotice(
  counts: { horizontal: number; vertical: number },
  orientation: DetectOrientation
): string {
  const parts: string[] = [];
  if (!orientation.vertical && counts.vertical > 0) {
    parts.push(
      `当前列表仍有 ${counts.vertical} 条竖线候选（已检出的不会自动消失），如需仅看横线请重新检测。`
    );
  }
  if (!orientation.horizontal && counts.horizontal > 0) {
    parts.push(
      `当前列表仍有 ${counts.horizontal} 条横线候选（已检出的不会自动消失），如需仅看竖线请重新检测。`
    );
  }
  return parts.join(' ');
}

/** 检测请求要带上的两个开关（`algorithm.detectLineCandidates` 的参数口径）。 */
export function toDetectPayload(orientation: DetectOrientation): {
  includeHorizontal: boolean;
  includeVertical: boolean;
} {
  return { includeHorizontal: orientation.horizontal, includeVertical: orientation.vertical };
}
