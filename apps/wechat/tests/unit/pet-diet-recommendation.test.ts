import {
  classifyDietRecommendationIntent,
  inferMealType,
  isDietRecommendationQuestion,
  recommendationLocation,
  recommendationPrice,
} from '../../src/packageExtra/pages/pet-chat/index'

describe('pet campus diet recommendation helpers', () => {
  it('routes explicit campus meal requests to the structured recommendation flow', () => {
    expect(isDietRecommendationQuestion('我是北大学生，今天午餐吃什么？')).toBe(true)
    expect(isDietRecommendationQuestion('清华学生，推荐几个菜')).toBe(true)
    expect(isDietRecommendationQuestion('帮我看看最近一个月的饮食趋势')).toBe(false)
  })

  it('keeps elliptical follow-ups inside the active structured recommendation flow', () => {
    expect(classifyDietRecommendationIntent('还有没有其他选择？你可以给我多推荐一些。', true)).toBe('more')
    expect(classifyDietRecommendationIntent('你推荐的饮食在哪里呢？我没看到呀。', true)).toBe('location')
    expect(classifyDietRecommendationIntent('刚才那几个哪个更适合减脂？', true)).toBe('compare')
    expect(classifyDietRecommendationIntent('我让你解释解释这3个菜', true)).toBe('context')
    expect(classifyDietRecommendationIntent('这三个菜各自热量是多少？', true)).toBe('context')
    expect(classifyDietRecommendationIntent('它们分别有多少蛋白质？', true)).toBe('context')
    expect(classifyDietRecommendationIntent('这些太贵了，20元以内最好', true)).toBe('refine')
    expect(classifyDietRecommendationIntent('重新推荐减脂餐，500大卡以下', true)).toBe('refine')
    expect(classifyDietRecommendationIntent('最近训练怎么安排？', true)).toBeNull()
    expect(classifyDietRecommendationIntent('还有什么训练建议？', true)).toBeNull()
    expect(classifyDietRecommendationIntent('还有没有其他选择？', false)).toBeNull()
  })

  it('infers explicit meal wording before falling back to the current meal window', () => {
    expect(inferMealType('早餐吃什么', new Date(2026, 7, 22, 19, 0))).toBe('breakfast')
    expect(inferMealType('今天吃什么', new Date(2026, 7, 22, 12, 15))).toBe('lunch')
    expect(inferMealType('今天吃什么', new Date(2026, 7, 22, 19, 0))).toBe('dinner')
  })

  it('formats real campus location and optional price metadata', () => {
    const option = {
      title: '云南野生菌汤小锅',
      reason: '真实校园食堂数据',
      calories: 510,
      protein: 24,
      carbs: 55,
      fat: 20,
      items: [],
      campus_name: '燕园校区',
      canteen_name: '家园食堂',
      floor: '4F',
      window_name: '愉火锅',
      price: 18.5,
      price_unit: '份',
    }
    expect(recommendationLocation(option)).toBe('燕园校区 · 家园食堂 · 4F · 愉火锅')
    expect(recommendationPrice(option)).toBe('¥18.5/份')
  })
})
