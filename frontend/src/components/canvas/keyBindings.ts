/**
 * 键盘绑定的声明式描述与校验（纯函数，无 DOM 依赖）。
 *
 * ## 为什么要它
 *
 * `onKeyDown` 曾是 277 行的顺序 if 链。后果不是难读，而是**同一按键被绑两次却没人发现**：
 * `KeyC` 既绑了「添加属种列」（先命中并 return），又在后面绑了「高对比度」——
 * 后者从加进去那天起就不可达。顺序 if 链里没有任何机制能暴露这种重复。
 *
 * 这里把「匹配规则」与「执行动作」分开：规则是数据，可以查重、可以单测；
 * 动作仍是画布实例上的闭包。查重在绑定表初始化时执行，重复即抛错。
 */

export interface KeyBinding {
  /** e.code 候选，如 'KeyA' / 'ArrowUp'。 */
  codes?: readonly string[];
  /** e.key 候选（大小写不敏感），如 '=' / '+'。 */
  keys?: readonly string[];
  /** 要求 Ctrl 或 Meta。 */
  ctrl?: boolean;
  /** 要求无 Ctrl / Meta / Alt（与 ctrl 互斥）。 */
  plain?: boolean;
  /** 额外前置条件（阶段门控、选中态等）。带事件参数以便判断 shiftKey 之类。 */
  when?: (e: KeyboardEvent) => boolean;
  /** 是否 preventDefault，默认 true。方向键在无选中时**不该**拦截。 */
  preventDefault?: boolean;
  /** 人读标签，只用于冲突报错。 */
  label: string;
  /** 命中后的动作（需要读 shiftKey 之类的用事件参数）。 */
  run: (e: KeyboardEvent) => void;
}

/** 绑定的「同一性」：codes/keys 集合 + 修饰键模式。 */
export function bindingSignature(b: KeyBinding): string {
  const codes = [...(b.codes ?? [])].sort().join(',');
  const keys = [...(b.keys ?? [])].sort().join(',');
  const mods = b.ctrl ? 'ctrl' : b.plain ? 'plain' : 'any';
  return `${mods}:${codes}|${keys}`;
}

export function matchesKeyBinding(b: KeyBinding, e: KeyboardEvent): boolean {
  if (b.ctrl) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else if (b.plain) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
  }
  const codeHit = b.codes ? b.codes.includes(e.code) : false;
  const keyHit = b.keys ? b.keys.includes(e.key.toLowerCase()) : false;
  return codeHit || keyHit;
}

/**
 * 键盘平移：一次按键把视口挪多少**屏幕像素**（issue #106）。
 *
 * 用屏幕像素而不是世界像素：平移是视口操作，与缩放无关。放大到 800% 时按一次仍然
 * 挪 40px 屏幕距离，手感与"拖拽 40px"一致（拖拽也按屏幕 delta 计）。
 */
export const PAN_KEY_STEP_PX = 40;

/** 平移键：方向键 + `Alt`。 */
export const PAN_KEY_CODES = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

/**
 * 方向键 → 视口平移位移（屏幕像素）。`null` = 这个组合不是平移。
 *
 * ## 为什么是 `Alt`+方向键，而不是裸方向键
 *
 * 裸方向键在这里已经**有主**：几何编辑态（步骤 4 选中候选线 / 选中控制点）下它们是
 * "1px 精调选中实体"（`Shift` 10px），见 `docs/ARCHITECTURE.md` 的几何编辑一节。
 * 把它挪到"无选中时才平移"也跑得通，但代价有两处：① 有选中时按方向键会**静默改动
 * 几何**，用户以为在平移；② 裸方向键在面板滚动容器里是原生滚动键，绑定后会把侧栏
 * 滚动抢走。改用 `Alt` 后两种手势在任何选中态下都互斥——平移看不到选中，微调看不到
 * `Alt`——且没有任何数据被意外改写。
 *
 * ## 方向约定
 *
 * 与既有的 `Alt`+滚轮（垂直）/`Shift`+滚轮（水平）一致：按 `→` = 视点右移、内容左移，
 * 即 `panBy(-step)`。同一个物理动作，键盘与滚轮给出同一个方向，用户不必背两套。
 */
export function panDeltaFromArrowKey(
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey'> & { key?: string },
  step: number = PAN_KEY_STEP_PX,
): { dx: number; dy: number } | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const span = Number.isFinite(step) && step > 0 ? step : PAN_KEY_STEP_PX;
  const code = e.code || '';
  const key = e.key || '';
  if (code === 'ArrowLeft' || key === 'ArrowLeft') {
    return { dx: span, dy: 0 };
  }
  if (code === 'ArrowRight' || key === 'ArrowRight') {
    return { dx: -span, dy: 0 };
  }
  if (code === 'ArrowUp' || key === 'ArrowUp') {
    return { dx: 0, dy: span };
  }
  if (code === 'ArrowDown' || key === 'ArrowDown') {
    return { dx: 0, dy: -span };
  }
  return null;
}

/**
 * 重复绑定立刻抛错。
 *
 * 不是 console.warn：重复绑定的表现是「后加的功能静默失效」，
 * 这种缺陷最贵的地方在于没人会去查——必须让它在加载期就炸出来。
 */
export function assertNoDuplicateBindings(bindings: readonly KeyBinding[]): void {
  const seen = new Map<string, string>();
  for (const b of bindings) {
    const sig = bindingSignature(b);
    const prev = seen.get(sig);
    if (prev) {
      throw new Error(`键盘绑定冲突：${sig} 同时绑定了「${prev}」与「${b.label}」`);
    }
    seen.set(sig, b.label);
  }
}
