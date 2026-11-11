import type { NutritionItem } from './result-item-converter'

/** A missing or failed suggestion must never be presented as an AI recommendation for 100%. */
export function resultRatioAdvice(status: string, items: NutritionItem[]): string {
  const suggestions = items
    .filter(item => item.suggestedRatioSource === 'ai' && typeof item.suggestedRatio === 'number' && item.suggestedRatio < 100)
    .slice(0, 3)
    .map(item => `${item.name}建议 ${item.suggestedRatio}%${item.suggestedRatioReason ? `，${item.suggestedRatioReason}` : ''}`)
  if (suggestions.length) return `${suggestions.join('；')}。点食物卡片的“应用建议”可调整，记录时请以实际食用量为准。`
  if (status === 'disabled' || items.some(item => item.suggestedRatioSource === 'disabled')) {
    return '本次未开启 AI 比例建议，请按实际食用量调整滑块。'
  }
  if (status === 'applied' && items.length > 0 && items.every(item => item.suggestedRatioSource === 'ai' && item.suggestedRatio === 100)) {
    return 'AI 建议按整份安排；记录时仍请按实际食用量调整。'
  }
  if (['fallback', 'unavailable', 'empty'].includes(status)) {
    return '本次 AI 比例建议暂不可用，请按实际食用量记录。'
  }
  return '本次未生成单项 AI 比例建议，滑块表示实际摄入量，可自行调整。'
}
