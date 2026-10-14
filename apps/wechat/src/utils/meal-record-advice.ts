import type { FoodRecord } from './api'

export function mealRecordAdvice(record: Pick<FoodRecord, 'items' | 'total_calories' | 'total_protein' | 'total_carbs' | 'total_fat'> & Partial<FoodRecord>) {
  const protein = Math.max(0, Number(record.total_protein) || 0)
  const carbs = Math.max(0, Number(record.total_carbs) || 0)
  const fat = Math.max(0, Number(record.total_fat) || 0)
  const energy = protein * 4 + carbs * 4 + fat * 9
  const manual = record.advice_source === 'nutrition_summary' || !record.insight || record.insight.startsWith('手动记录') || record.insight.startsWith('营养点评：')
  const p = energy > 0 ? protein * 4 / energy * 100 : 0
  const c = energy > 0 ? carbs * 4 / energy * 100 : 0
  const f = energy > 0 ? fat * 9 / energy * 100 : 0
  const notes = [p < 15 ? '蛋白质供能占比较低' : '', f > 35 ? '脂肪供能占比较高' : '', c > 65 ? '碳水供能占比较高' : ''].filter(Boolean)
  const insight = energy > 0
    ? `本餐记录${Number(record.total_calories || 0).toFixed(1)} kcal、蛋白质${protein.toFixed(1)}g；${notes.join('，') || '三大营养素供能比例较均衡'}。`
    : '当前营养数据不足，暂无法评价本餐搭配。'
  const items = (record.items || []).filter(item => Number(item.intake ?? item.weight) > 0)
  const veg = items.find(item => /青菜|西兰花|菠菜|白菜|黄瓜|番茄|生菜|苹果|香蕉|橙/.test(item.name))
  const prot = items.find(item => /鸡蛋|水煮蛋|肉|鱼|虾|豆腐|牛奶|蛋白/.test(item.name))
  const staple = items.find(item => /饭|面|粥|包|饼|馒头|土豆|燕麦/.test(item.name))
  const order = Array.from(new Set([veg?.name, prot?.name, staple?.name].filter(Boolean)))
  const ratioAdvice = items.filter(item => Number(item.suggested_ratio) > 0 && Number(item.suggested_ratio) < 100)
    .map(item => `${item.name}建议 ${item.suggested_ratio}%${item.suggested_ratio_reason ? `，${item.suggested_ratio_reason}` : ''}`).join('；')
  return {
    title: manual ? '本餐营养点评' : '本餐 AI 点评',
    source: manual ? '依据已记录的营养和实际摄入量' : '识别点评与已记录的摄入量',
    insight: manual ? insight : record.insight,
    ratio: record.pfc_ratio_comment || (energy > 0 ? `按供能计算：蛋白质约${Math.round(p)}%、碳水约${Math.round(c)}%、脂肪约${Math.round(f)}%。` : '营养数据不足，暂无法计算供能比例。'),
    ratioAdvice,
    order: record.eating_order_advice || (order.length > 1 ? `可先吃${order.join('，再吃')}。` : '本餐按实际食用顺序、放慢速度进食即可。'),
    absorption: record.absorption_notes || (veg && prot ? `本餐包含${veg.name}与${prot.name}，注意搭配并放慢进食速度。` : '点评按实际摄入量计算，营养资料有误时请先修正记录。'),
    context: record.context_advice || (record.meal_type === 'dinner' || record.meal_type === 'evening_snack' ? '晚间进食注意适量，避免临睡前吃得过饱。' : record.activity_timing === 'post_workout' ? '运动后结合本餐摄入补充水分，蛋白质安排以全天摄入为准。' : '本餐只是全天饮食的一部分，后续餐食结合全天摄入安排。'),
  }
}

/** 仅构造本人整餐视图，不创建、合并或重写任何持久化记录。 */
export function combineMealRecords(records: FoodRecord[]): FoodRecord | null {
  if (!records.length) return null
  const first = records[0]
  return {
    ...first,
    id: '',
    items: records.flatMap(record => record.items || []),
    total_calories: records.reduce((sum, record) => sum + Number(record.total_calories || 0), 0),
    total_protein: records.reduce((sum, record) => sum + Number(record.total_protein || 0), 0),
    total_carbs: records.reduce((sum, record) => sum + Number(record.total_carbs || 0), 0),
    total_fat: records.reduce((sum, record) => sum + Number(record.total_fat || 0), 0),
    total_weight_grams: records.reduce((sum, record) => sum + Number(record.total_weight_grams || 0), 0),
    image_paths: Array.from(new Set(records.flatMap(record => record.image_paths?.length ? record.image_paths : record.image_path ? [record.image_path] : []))),
    description: records.flatMap(record => record.items || []).map(item => item.name).join('、'),
    insight: null, pfc_ratio_comment: null, eating_order_advice: null, absorption_notes: null, context_advice: null,
    source_task_id: null, advice_source: 'nutrition_summary',
    diet_goal: records.every(record => record.diet_goal === first.diet_goal) ? first.diet_goal : null,
    activity_timing: records.every(record => record.activity_timing === first.activity_timing) ? first.activity_timing : null,
  }
}
