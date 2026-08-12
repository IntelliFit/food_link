type DietFocusCopy = {
  title: string
  short: string
}

const DIET_FOCUS_COPY: Record<string, DietFocusCopy> = {
  hypertension: { title: '餐次与能量分布', short: '餐次分布' },
  diabetes: { title: '碳水搭配表现', short: '碳水搭配' },
  cardio: { title: '控油饮食表现', short: '控油' },
  weight: { title: '能量平衡表现', short: '能量平衡' },
  colorectal: { title: '膳食结构规律度', short: '膳食结构' },
  longevity: { title: '长期饮食稳定度', short: '长期饮食' },
  micronutrient: { title: '微量营养摄入覆盖', short: '微量营养' },
}

export function dietFocusTitle(key: string, fallback: string): string {
  return DIET_FOCUS_COPY[key]?.title || fallback
}

export function dietFocusShort(key: string, fallback: string): string {
  return DIET_FOCUS_COPY[key]?.short || fallback
}

export function shouldShowDietScore(isCustom?: boolean): boolean {
  return !isCustom
}
