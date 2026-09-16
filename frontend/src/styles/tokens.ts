/**
 * Design Tokens for Straditize Pro v2.0
 * 
 * 强制规范：
 * 1. 禁止在各组件内硬编码颜色值、间距尺寸、手柄尺寸、字号。
 * 2. 必须且只能从本文件 (tokens.ts) 引用设计资产。
 * 3. 本文件已深度冻结 (as const)，改动必须显式提出理由。
 */

export const tokens = {
  color: {
    bg: {
      canvas: '#0b0f19',
      canvasLight: '#f8fafc',
      panel: '#111827',
      panelLight: '#ffffff',
      panelSecondary: '#1e293b',
      panelSecondaryLight: '#f1f5f9',
      toolbar: '#0f172a',
      toolbarLight: '#ffffff',
      card: 'rgba(30, 41, 59, 0.45)',
      cardLight: 'rgba(241, 245, 249, 0.85)',
      cardActive: 'rgba(56, 189, 248, 0.12)',
      cardActiveLight: 'rgba(2, 132, 199, 0.10)',
      input: 'rgba(15, 23, 42, 0.65)',
      inputLight: '#ffffff',
      modalBackdrop: 'rgba(0, 0, 0, 0.72)',
    },
    border: {
      default: 'rgba(255, 255, 255, 0.08)',
      defaultLight: 'rgba(0, 0, 0, 0.10)',
      focus: '#38bdf8',
      focusLight: '#0284c7',
      divider: '#334155',
      dividerLight: '#e2e8f0',
      danger: 'rgba(239, 68, 68, 0.4)',
    },
    text: {
      primary: '#f8fafc',
      primaryLight: '#0f172a',
      secondary: '#94a3b8',
      secondaryLight: '#475569',
      muted: '#64748b',
      mutedLight: '#94a3b8',
      accent: '#38bdf8',
      accentLight: '#0284c7',
      danger: '#ef4444',
      warning: '#f59e0b',
      success: '#22c55e',
    },
    column: {
      baseline: '#38bdf8',
      tick: '#f97316',
      isolate: '#64748b',
      activeBadge: '#0284c7',
      boundaryHover: '#f97316',
    },
    point: {
      peak: '#fbbf24',
      trough: '#f59e0b',
      manual: '#38bdf8',
      transition: '#ffffff',
      hover: '#f97316',
    },
    roi: {
      fill: 'rgba(56, 189, 248, 0.04)',
      fillLight: 'rgba(2, 132, 199, 0.04)',
      border: '#38bdf8',
      borderLight: '#0284c7',
      handle: '#ffffff',
      handleHover: '#f97316',
    },
    ghost: {
      overlayFill: 'rgba(34, 197, 94, 0.28)',    // 原位半透明逆向重绘绿色多边形
      overlayStroke: '#22c55e',                  // 逆向轮廓线
      mismatchHighlight: 'rgba(239, 68, 68, 0.65)',
    },
    mask: {
      pollen: 'rgba(56, 189, 248, 0.92)',
      degrid: 'rgba(239, 68, 68, 0.92)',
    }
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },

  radius: {
    sm: 3,
    md: 4,
    lg: 6,
    xl: 10,
    full: 9999,
  },

  font: {
    ui: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace",
    size: {
      xs: 9.5,
      sm: 11,
      md: 12,
      lg: 13,
      xl: 15,
      title: 17,
    },
  },

  panel: {
    leftWidth: 280,
    rightWidth: 280,
    minWidth: 200,
    maxWidth: 420,
    exportModalWidth: 1180,
  },

  canvas: {
    roiHandleSize: 8,
    boundaryHitWidth: 6,
    anchorHitRadius: 7,
    pointRadius: {
      peak: 5.5,
      trough: 5.5,
      manual: 5.0,
      transition: 3.5,
    },
    lineHitTolerance: 6,
  }
} as const;

export type Tokens = typeof tokens;
