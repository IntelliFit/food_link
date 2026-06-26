/**
 * 数字格式化工具
 *
 * 统一处理编辑页面中数字的显示与输入，避免后端原始数据（如 126.0000）
 * 直接暴露在输入框或摘要文案中。
 */

/** 兜底：把任意值转换为有限数字，无效时返回 0 */
export function toFiniteNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 兜底：把任意值转换为非负有限数字 */
export function toNonNegativeNumber(value: unknown): number {
  const n = toFiniteNumber(value)
  return Math.max(0, n)
}

/**
 * 通用四舍五入到指定小数位。
 * @param value 原始值
 * @param digits 保留小数位数
 */
export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** Math.max(0, digits)
  return Math.round(value * factor) / factor
}

/**
 * 去掉数字字符串末尾无意义的小数 0，同时避免科学计数法。
 * 例如 "126.0" -> "126"，"126.50" -> "126.5"。
 */
export function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) return value
  let trimmed = value.replace(/\.?0+$/, '')
  if (trimmed === '-0') trimmed = '0'
  return trimmed
}

/**
 * 把数字格式化为指定小数位，并去掉末尾无意义的 0。
 */
export function formatWithDigits(value: number, digits: number): string {
  const rounded = roundTo(value, digits)
  if (Object.is(rounded, -0) || rounded === 0) return '0'
  return trimTrailingZeros(rounded.toFixed(digits))
}

/**
 * 宏量营养素（热量 kcal、蛋白质/碳水/脂肪 g 等）。
 * 保留 1 位小数；整数不显示小数。
 */
export function formatMacroNutrient(value: number): string {
  return formatWithDigits(value, 1)
}

/**
 * 微量营养素（钠、钾、钙、铁等 mg/mcg）。
 * >= 10 保留 0 位；>= 1 保留 1 位；< 1 保留 2 位。
 */
export function formatMicroNutrient(value: number): string {
  const n = toNonNegativeNumber(value)
  if (n >= 10) return formatWithDigits(n, 0)
  if (n >= 1) return formatWithDigits(n, 1)
  return formatWithDigits(n, 2)
}

/**
 * 身体数据（身高 cm、体重 kg）。
 * 保留 1 位小数；整数不显示小数。
 */
export function formatBodyMetric(value: number): string {
  return formatWithDigits(value, 1)
}

/**
 * 通用数值：默认保留 2 位小数，去掉末尾无意义 0。
 */
export function formatNumber(value: number): string {
  return formatWithDigits(value, 2)
}

/**
 * 比例/百分比（如食用比例 ratio）。
 * 保留 1 位小数；整数不显示小数。
 */
export function formatRatio(value: number): string {
  return formatWithDigits(value, 1)
}

/**
 * 解析用户输入的数字字符串，返回非负有限数字。
 * 可指定最大保留小数位（默认 1 位）。
 */
export function parseInputNumber(value: string, maxDigits = 1): number {
  const text = String(value ?? '').trim()
  if (!text) return 0
  const n = parseFloat(text)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, roundTo(n, maxDigits))
}

/**
 * 解析用户输入的数字字符串，返回原始有限数字，不截断小数位。
 * 仅用于需要后续再格式化的场景。
 */
export function parseInputNumberRaw(value: string): number {
  const text = String(value ?? '').trim()
  if (!text) return 0
  const n = parseFloat(text)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}
