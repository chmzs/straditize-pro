/**
 * Standard danger / reset button component conforming to UI design spec (Figure 2 pattern).
 */
export function renderResetButton(options: {
  id: string;
  title: string;
  label?: string;
  className?: string;
  style?: string;
}): string {
  const label = options.label ?? '重置';
  const cls = options.className ? `ui-btn-reset ${options.className}` : 'ui-btn-reset';
  const inlineStyle = options.style ? ` style="${options.style}"` : '';
  return `
    <button type="button" id="${options.id}" class="${cls}" title="${options.title}"${inlineStyle}>
      <svg class="ui-btn-reset-icon" viewBox="0 0 16 16" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2 6.2"/>
        <path d="M2 2.5v3.8h3.8"/>
      </svg>
      <span>${label}</span>
    </button>
  `.trim();
}
