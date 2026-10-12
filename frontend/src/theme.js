// ─── 深色主题配色 ─────────────────────────────────────────────
// 设计语言：深空蓝黑 + 微光卡片，参考 Linear / Vercel Dashboard 美学
export const C_DARK = {
  // 背景层次（从上到下由浅到深，形成卡片悬浮感）
  bgDeepest:  '#07090f',   // 页面底色（最暗）
  bgDeep:     '#0c0f1a',   // 导航条 / 列表头
  bgCard:     '#131929',   // 卡片主体
  bgHover:    '#1a2338',   // 悬停态
  bgActive:   '#1f2d4a',   // 选中态

  // 边框（微光蓝紫）
  border:        '#1e2d45',
  borderBright:  '#2e4470',
  borderGlow:    'rgba(96,165,250,0.35)',

  // 主色：青蓝（品牌 / 主动作）
  cyan:         '#60a5fa',
  cyanDim:      '#3b82f6',
  cyanGlow:     'rgba(96,165,250,0.15)',
  cyanSubtle:   'rgba(96,165,250,0.08)',

  // 成功 / 绿
  green:        '#34d399',
  greenDim:     '#10b981',
  greenGlow:    'rgba(52,211,153,0.15)',
  greenSubtle:  'rgba(52,211,153,0.08)',

  // 危险 / 红
  red:          '#f87171',
  redDim:       '#ef4444',
  redGlow:      'rgba(248,113,113,0.15)',
  redSubtle:    'rgba(248,113,113,0.08)',

  // 警告 / 琥珀
  amber:        '#fbbf24',
  amberDim:     '#f59e0b',
  amberGlow:    'rgba(251,191,36,0.15)',

  // 橙色（零收益 / 警告）
  orange:       '#fb923c',
  orangeDim:     '#f97316',
  orangeGlow:    'rgba(251,146,60,0.15)',
  orangeSubtle:  'rgba(251,146,60,0.08)',

  // 紫色（代码 / 特殊）
  purple:       '#c084fc',
  purpleDim:    '#a855f7',

  // 蓝色（训练进度 / 主动作）
  blue:         '#60a5fa',
  blueDim:      '#3b82f6',
  blueGlow:     'rgba(96,165,250,0.15)',
  blueSubtle:   'rgba(96,165,250,0.10)',

  // 黄色（暂停 / 警告）
  yellow:       '#facc15',
  yellowDim:    '#eab308',
  yellowGlow:   'rgba(250,204,21,0.15)',
  yellowSubtle: 'rgba(250,204,21,0.10)',

  // 灰色（空闲 / 禁用）
  gray:         '#9ca3af',
  grayDim:      '#6b7280',
  grayGlow:     'rgba(156,163,175,0.15)',
  graySubtle:   'rgba(156,163,175,0.10)',

  // 纯色
  white:        '#ffffff',

  // 文字层次
  textPrimary:   '#e2e8f0',
  textSecondary: '#8b9cc8',
  textMuted:     '#4a5f82',
  textFaint:     '#253050',
};

// ─── 浅色主题配色 ─────────────────────────────────────────────
// 核心原则：卡片 #fff 必须与文字有足够对比度，次要文字不低于 #5a6478
export const C_LIGHT = {
  bgDeepest:  '#eef1f6',   // 页面底色（冷灰白）
  bgDeep:     '#f5f7fb',   // 导航条 / 列表头
  bgCard:     '#ffffff',   // 卡片（纯白）
  bgHover:    '#f0f4ff',   // 悬停态（淡紫灰）
  bgActive:   '#e4ebff',   // 选中态
  border:        '#dde3f0',
  borderBright:  '#b8c4e0',
  borderGlow:    'rgba(59,130,246,0.2)',
  cyan:         '#2563eb',
  cyanDim:      '#1d4ed8',
  cyanGlow:     'rgba(37,99,235,0.12)',
  cyanSubtle:   'rgba(37,99,235,0.08)',
  green:        '#059669',
  greenDim:     '#047857',
  greenGlow:    'rgba(5,150,105,0.12)',
  greenSubtle:  'rgba(5,150,105,0.08)',
  red:          '#dc2626',
  redDim:       '#b91c1c',
  redGlow:      'rgba(220,38,38,0.12)',
  redSubtle:    'rgba(220,38,38,0.08)',
  amber:        '#d97706',
  amberDim:     '#b45309',
  amberGlow:    'rgba(217,119,6,0.12)',

  // 橙色
  orange:       '#ea580c',
  orangeDim:     '#c2410c',
  orangeGlow:    'rgba(234,88,12,0.12)',
  purple:       '#7c3aed',
  purpleDim:    '#6d28d9',

  // 蓝色
  blue:         '#2563eb',
  blueDim:      '#1d4ed8',
  blueGlow:     'rgba(37,99,235,0.15)',
  blueSubtle:   'rgba(37,99,235,0.10)',

  // 黄色
  yellow:       '#ca8a04',
  yellowDim:    '#a16207',
  yellowGlow:   'rgba(202,138,4,0.15)',
  yellowSubtle: 'rgba(202,138,4,0.10)',

  // 灰色
  gray:         '#6b7280',
  grayDim:      '#4b5563',
  grayGlow:     'rgba(107,114,128,0.15)',
  graySubtle:   'rgba(107,114,128,0.10)',

  // 纯色
  white:        '#ffffff',

  textPrimary:   '#1a2035',
  textSecondary: '#5a6478',  // 至少 4.5:1 on #fff
  textMuted:     '#8896aa',  // 至少 3:1 on #fff
  textFaint:     '#c4cddf',
};

// ─── 全局主题状态（App.jsx 写入，AutonomyControl 读取）────────
export const themeColors = { current: C_DARK };

// ─── 将 C 对象映射为 CSS 变量，写入 document.documentElement ─
function setCssVars(C) {
  console.log('[setCssVars] Start setting CSS variables...');
  const el = document.documentElement;
  const map = {
    '--ac-bgDeepest':  C.bgDeepest,
    '--ac-bgDeep':     C.bgDeep,
    '--ac-bgCard':     C.bgCard,
    '--ac-bgHover':    C.bgHover,
    '--ac-bgActive':   C.bgActive,
    '--ac-border':        C.border,
    '--ac-borderBright':  C.borderBright,
    '--ac-borderGlow':    C.borderGlow,
    '--ac-cyan':       C.cyan,
    '--ac-cyanDim':    C.cyanDim,
    '--ac-cyanGlow':   C.cyanGlow,
    '--ac-cyanSubtle': C.cyanSubtle,
    '--ac-green':      C.green,
    '--ac-greenDim':   C.greenDim,
    '--ac-greenGlow':  C.greenGlow,
    '--ac-greenSubtle':C.greenSubtle,
    '--ac-red':        C.red,
    '--ac-redDim':     C.redDim,
    '--ac-redGlow':    C.redGlow,
    '--ac-redSubtle':  C.redSubtle,
    '--ac-amber':      C.amber,
    '--ac-amberDim':   C.amberDim,
    '--ac-amberGlow':  C.amberGlow,
    '--ac-orange':      C.orange,
    '--ac-orangeDim':   C.orangeDim,
    '--ac-orangeGlow':  C.orangeGlow,
    '--ac-orangeSubtle':C.orangeSubtle,
    '--ac-purple':     C.purple,
    '--ac-purpleDim':  C.purpleDim,
    '--ac-blue':       C.blue,
    '--ac-blueDim':    C.blueDim,
    '--ac-blueGlow':   C.blueGlow,
    '--ac-blueSubtle': C.blueSubtle,
    '--ac-yellow':     C.yellow,
    '--ac-yellowDim':  C.yellowDim,
    '--ac-yellowGlow': C.yellowGlow,
    '--ac-yellowSubtle':C.yellowSubtle,
    '--ac-gray':       C.gray,
    '--ac-grayDim':    C.grayDim,
    '--ac-grayGlow':   C.grayGlow,
    '--ac-graySubtle': C.graySubtle,
    '--ac-white':      C.white,
    '--ac-textPrimary':  C.textPrimary,
    '--ac-textSecondary':C.textSecondary,
    '--ac-textMuted':    C.textMuted,
    '--ac-textFaint':    C.textFaint,
  };
  for (const [k, v] of Object.entries(map)) {
    el.style.setProperty(k, v);
  }
  console.log('[setCssVars] Setting --ac-bgCard to:', C.bgCard);
  console.log('[setCssVars] Setting --ac-border to:', C.border);
}

export function applyTheme(theme) {
  console.log('[applyTheme] Called with theme:', theme);
  const C = theme === 'light' ? C_LIGHT : C_DARK;
  console.log('[applyTheme] Using colors:', C.bgCard, C.border);
  themeColors.current = C;
  // 核心：同步 CSS 变量，让 DOM 样式立即生效
  setCssVars(C);
  // 设置 data-theme 属性，激活 index.css 中的主题选择器
  document.documentElement.setAttribute('data-theme', theme);
  window.dispatchEvent(new CustomEvent('fqm-theme-change', { detail: { theme, C } }));
}
