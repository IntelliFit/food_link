export function restoreRiskFocusKeys(stored: unknown, defaults: readonly string[]): string[] {
  if (!Array.isArray(stored)) return [...defaults]
  return Array.from(new Set(stored.map(item => String(item || '').trim()).filter(Boolean)))
}
