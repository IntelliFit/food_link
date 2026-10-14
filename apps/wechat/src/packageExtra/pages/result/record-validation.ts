const zeroEnergyFoods = new Set([
  '水', '白水', '白开水', '饮用水', '纯净水', '矿泉水', '苏打水', '无糖苏打水', '无糖气泡水',
  '茶', '清茶', '绿茶', '红茶', '乌龙茶', '无糖茶', '无糖茶水', '黑咖啡', '美式咖啡', '无糖黑咖啡',
])

type RecordableItem = {
  name: string
  weight: number
  calorie: number
  protein: number
  carbs: number
  fat: number
}

export function getResultRecordError(items: RecordableItem[]): string {
  if (!items.length) return '没有可记录的食物，请重新分析'
  for (const item of items) {
    if (!item.name.trim() || item.name === '未知食物' || !Number.isFinite(item.weight) || item.weight <= 0) {
      return '食物份量未能正确解析，请重新分析或补充重量'
    }
    if ([item.calorie, item.protein, item.carbs, item.fat].some(value => !Number.isFinite(value) || value < 0)) {
      return '营养数据异常，请重新分析'
    }
    if (item.calorie === 0 && !zeroEnergyFoods.has(item.name.trim())) {
      return '食物营养未能正确分析，请重新分析'
    }
  }
  return ''
}
