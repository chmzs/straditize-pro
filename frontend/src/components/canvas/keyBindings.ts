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
