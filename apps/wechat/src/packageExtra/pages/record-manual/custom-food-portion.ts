/** The user supplies the package quantity and count; never infer a piece size. */
export function calculateCustomPortion(packageQuantity: string, portionCount: string): number | null {
  const total = Number(packageQuantity)
  const count = Number(portionCount)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(count) || count <= 0) return null
  const quantity = total / count
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null
}
