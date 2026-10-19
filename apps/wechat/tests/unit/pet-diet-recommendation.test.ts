import {
  classifyDietRecommendationIntent,
  hasPaidMealRecommendation,
  inferMealType,
  isDietRecommendationQuestion,
  recommendationLocation,
  recommendationPrice,
} from '../../src/packageExtra/pages/pet-chat/index'

describe('pet campus diet recommendation helpers', () => {
  it('does not unlock a paid meal from a free clarification or unrelated paid chat', () => {
    const base = { id: 'm', role: 'assistant' as const, content: '请补充位置' }
    expect(hasPaidMealRecommendation([{ ...base, message_type: 'diet_recommendation', credits_charged: 0 }])).toBe(false)
    expect(hasPaidMealRecommendation([{ ...base, message_type: 'analysis', credits_charged: 1 }])).toBe(false)
    expect(hasPaidMealRecommendation([{ ...base, message_type: 'diet_recommendation', credits_charged: 1 }])).toBe(true)
  })
  it('routes explicit campus meal requests to the structured recommendation flow', () => {
    expect(isDietRecommendationQuestion('我是北大学生，今天午餐吃什么？')).toBe(true)
    expect(isDietRecommendationQuestion('清华学生，推荐几个菜')).toBe(true)
    expect(isDietRecommendationQuestion('附近有什么清淡的饭可以选？')).toBe(true)
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
    expect(classifyDietRecommendationIntent('我刚健身完，不吃鸡肉', true)).toBe('refine')
    expect(classifyDietRecommendationIntent('重新推荐减脂餐，500大卡以下', true)).toBe('refine')
    expect(classifyDietRecommendationIntent('最近训练怎么安排？', true)).toBeNull()
    expect(classifyDietRecommendationIntent('还有什么训练建议？', true)).toBeNull()
    expect(classifyDietRecommendationIntent('还有没有其他选择？', false)).toBeNull()
  })

  // Production screenshot 2026-10-17: after a recommendation the user answers it. Those turns stay in
  // the meal conversation on the server, so the cost shown before sending must follow the same rule.
  it('keeps complaints and short demands about the recommendation in the meal conversation', () => {
    for (const question of [
      'AI原点社区食堂不是外卖啊 食堂这个食堂不是外卖 继续推荐其他的',
      '我都说了AI原点社区食堂不是外卖，你还在继续推荐这个AI原点社区食堂，你是傻逼吗?',
      '我就是需要附近商家的呀，你给我点呗，你给我推荐呗',
      '不是这个，换商家',
      '你怎么又推荐食堂',
      '我要的是外卖不是食堂',
    ]) {
      expect(classifyDietRecommendationIntent(question, true)).not.toBeNull()
    }
    for (const question of ['你是傻逼吗', '我想洗澡，热水还是冷水？', '不一定是饮食，其他的通用建议也可以', '我不是很饿，想睡觉']) {
      expect(classifyDietRecommendationIntent(question, true)).toBeNull()
    }
    expect(classifyDietRecommendationIntent('我就是需要附近商家的呀，你给我点呗', false)).toBeNull()
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
