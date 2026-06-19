export const colors = {
  brand: '#5cb896',
  brandDark: '#4a9d7d',
  brandSoft: '#eef8f4',
  background: '#f0f3f6',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  text: '#1f2937',
  textSecondary: '#6b7280',
  textMuted: '#94a3b8',
  border: '#eef2f7',
  warning: '#d4ac52',
  danger: '#ef4444',
  blue: '#5c9ed4',
  orange: '#f0985c',
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
}

export const shadow = {
  shadowColor: '#0f172a',
  shadowOpacity: 0.04,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
} as const

export function compactFont(size: number, compactSize = size - 2) {
  return Math.max(10, compactSize)
}
