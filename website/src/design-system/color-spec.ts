export type ColorToken = {
  value: string
  source: string
  usage?: string
}

export type ColorPalette = {
  background: ColorToken
  backgroundMuted: ColorToken
  backgroundTintStart: ColorToken
  backgroundTintEnd: ColorToken
  foreground: ColorToken
  foregroundMuted: ColorToken
  foregroundSubtle: ColorToken
  primary: ColorToken
  primaryForeground: ColorToken
  secondary: ColorToken
  secondaryForeground: ColorToken
  accent: ColorToken
  accentAlt: ColorToken
  card: ColorToken
  border: ColorToken
}

export const brandGradients = {
  primary: {
    from: '#00bc7d',
    to: '#00bba7',
    source: 'docs/note.md',
  },
  page: {
    from: 'rgb(92 184 150 / 8%)',
    to: '#f0f3f6',
    source: 'src/app.scss',
  },
} as const

export const lightColors: ColorPalette = {
  background: {
    value: '#f0f3f6',
    source: 'src/app.scss, src/pages/index/index.scss',
    usage: 'Page floor / gradient end',
  },
  backgroundMuted: {
    value: '#f9fafb',
    source: 'src/app.config.ts window.backgroundColor',
    usage: 'Window and tab bar background',
  },
  backgroundTintStart: {
    value: 'rgb(92 184 150 / 8%)',
    source: 'src/app.scss page gradient',
    usage: 'Top of page green tint',
  },
  backgroundTintEnd: {
    value: 'rgb(92 184 150 / 3%)',
    source: 'src/app.scss page gradient',
    usage: 'Mid-page green tint fade',
  },
  foreground: {
    value: '#1f2937',
    source: 'src/pages/index/index.scss $text-primary',
    usage: 'Primary body text',
  },
  foregroundMuted: {
    value: '#6b7280',
    source: 'src/pages/index/index.scss $text-secondary',
    usage: 'Secondary copy',
  },
  foregroundSubtle: {
    value: '#9ca3af',
    source: 'src/pages/index/index.scss $text-tertiary',
    usage: 'Hints and placeholders',
  },
  primary: {
    value: '#00bc7d',
    source: 'docs/首页PRD.md, src/app.config.ts tabBar.selectedColor',
    usage: 'Brand primary — buttons, emphasis, tab selected',
  },
  primaryForeground: {
    value: '#ffffff',
    source: 'Mini program button/capsule contrast',
    usage: 'Text on primary surfaces',
  },
  secondary: {
    value: '#5cb896',
    source: 'src/pages/index/index.scss $primary-color',
    usage: 'Home ecosystem sage green — secondary brand',
  },
  secondaryForeground: {
    value: '#ffffff',
    source: 'Mini program UI contrast',
    usage: 'Text on secondary surfaces',
  },
  accent: {
    value: '#8dd3bf',
    source: 'src/pages/index/index.scss $primary-gradient-end',
    usage: 'Hover states and gradient mate',
  },
  accentAlt: {
    value: '#5c9ed4',
    source: 'src/pages/index/index.scss $blue-color',
    usage: 'Macro / feature accent (protein blue)',
  },
  card: {
    value: '#ffffff',
    source: 'src/pages/index/index.scss $modal-sheet-bg',
    usage: 'Cards and panels',
  },
  border: {
    value: '#e5e7eb',
    source: 'Common UI borders across mini program',
    usage: 'Default border color',
  },
}

export const darkColors: ColorPalette = {
  background: {
    value: '#0f1312',
    source: 'src/styles/fl-color-scheme-dark.scss dark gradient end',
    usage: 'Dark page background',
  },
  backgroundMuted: {
    value: '#141c1a',
    source: 'src/styles/fl-color-scheme-dark.scss $fl-dark-panel-bg-soft',
    usage: 'Muted dark surface',
  },
  backgroundTintStart: {
    value: '#1a2822',
    source: 'src/styles/fl-color-scheme-dark.scss dark gradient start',
    usage: 'Dark page gradient top',
  },
  backgroundTintEnd: {
    value: 'rgb(18 24 22)',
    source: 'src/styles/fl-color-scheme-dark.scss dark gradient mid',
    usage: 'Dark page gradient mid',
  },
  foreground: {
    value: '#e8ece9',
    source: 'src/styles/fl-color-scheme-dark.scss $fl-dark-text',
    usage: 'Primary dark text',
  },
  foregroundMuted: {
    value: '#9ca3a8',
    source: 'src/styles/fl-color-scheme-dark.scss $fl-dark-text2',
    usage: 'Secondary dark text',
  },
  foregroundSubtle: {
    value: '#9ca3af',
    source: 'Light theme tertiary, reused for subtle dark hints',
    usage: 'Subtle dark hints',
  },
  primary: {
    value: '#7dd3b0',
    source: 'src/styles/fl-color-scheme-dark.scss $fl-dark-accent',
    usage: 'Dark mode primary accent',
  },
  primaryForeground: {
    value: '#0f1312',
    source: 'Derived from dark background contrast',
    usage: 'Text on dark primary surfaces',
  },
  secondary: {
    value: '#5cb896',
    source: 'Brand green coordinated with dark theme',
    usage: 'Secondary brand on dark surfaces',
  },
  secondaryForeground: {
    value: '#ffffff',
    source: 'Mini program UI contrast',
    usage: 'Text on secondary dark surfaces',
  },
  accent: {
    value: '#5cb896',
    source: 'src/styles/fl-color-scheme-dark.scss brand coordination',
    usage: 'Dark accent / hover',
  },
  accentAlt: {
    value: '#5c9ed4',
    source: 'src/pages/index/index.scss $blue-color',
    usage: 'Feature accent preserved in dark mode',
  },
  card: {
    value: '#1a2220',
    source: 'src/styles/fl-color-scheme-dark.scss $fl-dark-surface',
    usage: 'Dark cards and panels',
  },
  border: {
    value: '#3d5d51',
    source: 'src/styles/fl-color-scheme-dark.scss $fl-dark-border',
    usage: 'Dark borders',
  },
}

export type ShadcnCssVars = Record<string, string>

/** Map Food Link tokens to shadcn/ui CSS variable names. */
export function toShadcnCssVars(palette: ColorPalette): ShadcnCssVars {
  return {
    '--background': palette.background.value,
    '--foreground': palette.foreground.value,
    '--card': palette.card.value,
    '--card-foreground': palette.foreground.value,
    '--popover': palette.card.value,
    '--popover-foreground': palette.foreground.value,
    '--primary': palette.primary.value,
    '--primary-foreground': palette.primaryForeground.value,
    '--secondary': palette.secondary.value,
    '--secondary-foreground': palette.secondaryForeground.value,
    '--muted': palette.backgroundMuted.value,
    '--muted-foreground': palette.foregroundMuted.value,
    '--accent': palette.accent.value,
    '--accent-foreground': palette.foreground.value,
    '--destructive': '#ef4444',
    '--border': palette.border.value,
    '--input': palette.border.value,
    '--ring': palette.secondary.value,
    '--chart-1': palette.primary.value,
    '--chart-2': palette.secondary.value,
    '--chart-3': palette.accent.value,
    '--chart-4': palette.accentAlt.value,
    '--chart-5': palette.foregroundMuted.value,
    '--sidebar': palette.backgroundMuted.value,
    '--sidebar-foreground': palette.foreground.value,
    '--sidebar-primary': palette.primary.value,
    '--sidebar-primary-foreground': palette.primaryForeground.value,
    '--sidebar-accent': palette.accent.value,
    '--sidebar-accent-foreground': palette.foreground.value,
    '--sidebar-border': palette.border.value,
    '--sidebar-ring': palette.secondary.value,
  }
}

export const lightShadcnVars = toShadcnCssVars(lightColors)
export const darkShadcnVars = toShadcnCssVars(darkColors)
