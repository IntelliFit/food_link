import {
  applyEngineFocus,
  focusCardKey,
  nextMealView,
  normalizeNutritionState,
  observationHeadline,
  observationMetaText,
  overallDelta,
  planLineText,
  splitWeekDeltas,
  todayMetaText,
  todayRowView,
  weekDayLabels,
  weekHabitRows,
} from '../../src/utils/nutrition-state-view'
import type { NutrientReading, RiskCard } from '../../src/utils/api'

/** docs/algorithms/daily-nutrition-state.md 里的示例 */
const contractExample = {
  date: '2026-11-04',
  generated_at: '2026-11-04T05:10:00Z',
  coverage: { recorded_days: 6, meals: 15, today_meals: 2, nutrient_completeness: 0.72, enough_data: true },
  plan: { goal: 'fat_loss', goal_label: '减脂', energy_kcal: 1650, protein_g: 95, source: 'saved_plan' },
  today: [
    { key: 'protein', label: '蛋白质', unit: 'g', value: 52, target: 95, kind: 'min', status: 'short', gap: 43, unknown_meals: 0 },
    { key: 'vegetables', label: '蔬菜', unit: '份', value: 1, target: 3, kind: 'min', status: 'short', gap: 2, unknown_meals: 0 },
    { key: 'sodium', label: '钠', unit: 'mg', value: 1850, target: 2000, kind: 'max', status: 'near_limit', gap: 150, unknown_meals: 1 },
    { key: 'added_sugar', label: '添加糖', unit: 'g', value: null, target: 50, kind: 'max', status: 'unknown', gap: 0, unknown_meals: 1 },
  ],
  gaps: [{ key: 'fiber', label: '膳食纤维', text: '纤维还差 14g', severity: 0.56 }],
  next_meal: { meal_type: 'dinner', label: '晚餐', advice: '一份深色蔬菜 + 鱼或豆腐，汤和酱汁少一点', fills: ['fiber', 'protein'], limits: ['sodium'] },
  week: {
    days: ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'],
    habits: [{ key: 'vegetables', label: '蔬菜够 3 份', marks: ['hit', 'hit', 'miss', 'hit', 'hit', 'hit', 'today'], hit: 5, of: 6 }],
    counts: [{ key: 'fish_soy', label: '鱼或豆制品', value: 2, target: 3, unit: '次' }],
    vs_last_week: [{ key: 'vegetables', label: '蔬菜够量', last: 3, this: 5, unit: '天', better: true }],
  },
  scores: {
    overall: 64,
    overall_last_week: 58,
    focus: [{ key: 'blood_pressure', title: '血压管理友好度', score: 52, reason: '钠 6 天里 4 天超标，钾只到目标一半', evidence: ['钠 4/6 天超过 2000mg'] }],
  },
  evidence_gaps: [{ key: 'sodium_unknown', text: '3 餐没有钠和糖的数据', hint: '拍照时把汤和饮料也拍进去', action: 'record' }],
  context: { weight_trend: { kg_change: -0.6, days: 14 }, training_today: true, water_ml_today: 500, sleep_hours: null, notes: ['周三、周五练腿'] },
  headline: '这周蔬菜跟上了，盐还偏多：6 天里有 4 天钠超过 2000 毫克。',
  findings: [{ key: 'sodium_over_days', kind: 'over', text: '6 天里 4 天钠超过 2000 毫克', value: '4/6' }],
}

function reading(overrides: Partial<NutrientReading>): NutrientReading {
  return { key: 'protein', label: '蛋白质', unit: 'g', value: 52, target: 95, kind: 'min', status: 'short', gap: 43, unknown_meals: 0, ...overrides }
}

function riskCard(overrides: Partial<RiskCard>): RiskCard {
  return { key: 'hypertension', title: '血压管理友好度', score: 70, tone: 'neutral', brief: '旧说明', summary: '', basis: '', action: '', delta: 5, ...overrides }
}

describe('normalizeNutritionState', () => {
  it('keeps the contract example intact', () => {
    const state = normalizeNutritionState(contractExample)
    expect(state).not.toBeNull()
    expect(state!.today).toHaveLength(4)
    expect(state!.today[3].value).toBeNull()
    expect(state!.scores.overall).toBe(64)
    expect(state!.next_meal?.advice).toContain('深色蔬菜')
  })

  it('rejects non-objects and payloads without a date so the page hides the new modules', () => {
    expect(normalizeNutritionState(null)).toBeNull()
    expect(normalizeNutritionState('404 page not found')).toBeNull()
    expect(normalizeNutritionState([])).toBeNull()
    expect(normalizeNutritionState({ detail: 'Not Found' })).toBeNull()
  })

  it('fills missing sections instead of crashing and keeps missing numbers unknown', () => {
    const state = normalizeNutritionState({
      date: '2026-11-04',
      today: [{ key: 'sodium', label: '钠', unit: 'mg', target: 2000, kind: 'max' }],
      scores: { overall: null },
    })!
    expect(state.today[0].value).toBeNull()
    expect(state.today[0].status).toBe('unknown')
    expect(state.week.habits).toEqual([])
    expect(state.evidence_gaps).toEqual([])
    expect(state.scores.overall).toBeNull()
    expect(state.scores.overall_last_week).toBeNull()
    expect(state.next_meal).toBeNull()
  })
})

describe('score card additions', () => {
  it('compares this week with last week', () => {
    expect(overallDelta({ overall: 64, overall_last_week: 58 })).toEqual({ text: '比上周 +6', direction: 'up' })
    expect(overallDelta({ overall: 55, overall_last_week: 58 })).toEqual({ text: '比上周 -3', direction: 'down' })
    expect(overallDelta({ overall: 58, overall_last_week: 58 })).toEqual({ text: '和上周持平', direction: 'flat' })
  })

  it('does not compare against a missing week', () => {
    expect(overallDelta({ overall: 64, overall_last_week: null })).toBeNull()
    expect(overallDelta({ overall: null, overall_last_week: 58 })).toBeNull()
  })

})

describe('今天还差什么', () => {
  it('shows a short floor with the gap', () => {
    expect(todayRowView(reading({}))).toEqual({
      key: 'protein', label: '蛋白质', known: true, tone: 'short',
      valueText: '52', targetText: '/ 95 g', gapText: '差 43g', badge: '', percent: 55, note: '',
    })
  })

  it('spaces Chinese units', () => {
    const row = todayRowView(reading({ key: 'vegetables', label: '蔬菜', unit: '份', value: 1, target: 3, gap: 2 }))
    expect(row.known && row.gapText).toBe('差 2 份')
    expect(row.known && row.targetText).toBe('/ 3 份')
  })

  it('flags a ceiling that is close or crossed and notes meals without data', () => {
    const near = todayRowView(reading({ key: 'sodium', label: '钠', unit: 'mg', value: 1850, target: 2000, kind: 'max', status: 'near_limit', gap: 150, unknown_meals: 1 }))
    expect(near).toMatchObject({ known: true, tone: 'warn', badge: '快到上限', gapText: '', percent: 93 })
    expect(near.known && near.note).toBe('另有 1 餐没有钠数据，没算进来')

    const over = todayRowView(reading({ key: 'sodium', label: '钠', unit: 'mg', value: 2400, target: 2000, kind: 'max', status: 'over', gap: 400 }))
    expect(over).toMatchObject({ tone: 'over', badge: '超上限', gapText: '超出 400mg', percent: 100 })
  })

  it('marks a reached floor as done', () => {
    expect(todayRowView(reading({ value: 100, status: 'ok', gap: 0 }))).toMatchObject({ tone: 'good', gapText: '已达标', percent: 100 })
  })

  it('never shows an unknown nutrient as 0', () => {
    const unknown = todayRowView(reading({ key: 'added_sugar', label: '添加糖', value: null, status: 'unknown', unknown_meals: 1, gap: 0 }))
    expect(unknown).toEqual({ key: 'added_sugar', label: '添加糖', known: false, note: '还不知道：今天有 1 餐没有添加糖数据，不算成 0' })
    // value 缺失但状态没标 unknown，也按不知道处理
    expect(todayRowView(reading({ value: null, status: 'short' })).known).toBe(false)
    expect(todayRowView(reading({ value: null, status: 'unknown', unknown_meals: 0 }))).toMatchObject({ note: '还不知道：今天还没有蛋白质数据，不算成 0' })
  })

  it('builds the header lines in Beijing time', () => {
    const state = normalizeNutritionState(contractExample)!
    expect(todayMetaText(state)).toBe('到 13:10 · 已记 2 餐')
    expect(todayMetaText({ generated_at: '', coverage: { ...state.coverage, today_meals: 0 } })).toBe('今天还没记录')
    expect(planLineText(state.plan)).toBe('按你的减脂计划：每天 1650 千卡，蛋白质 95g')
    expect(planLineText({ ...state.plan, energy_kcal: 0, protein_g: 0 })).toBe('')
  })

  it('keeps the next meal advice and the pet meal type', () => {
    expect(nextMealView(normalizeNutritionState(contractExample)!.next_meal)).toEqual({
      title: '晚餐这样补', advice: '一份深色蔬菜 + 鱼或豆腐，汤和酱汁少一点', petMealType: 'dinner', mealLabel: '晚餐',
    })
    expect(nextMealView({ meal_type: 'snack', label: '', advice: '来点水果', fills: [], limits: [] })).toMatchObject({ title: '下一餐这样补', petMealType: '' })
    expect(nextMealView({ meal_type: 'dinner', label: '晚餐', advice: '', fills: [], limits: [] })).toBeNull()
    expect(nextMealView(null)).toBeNull()
  })
})

describe('本周规律', () => {
  it('labels days by weekday and today', () => {
    const state = normalizeNutritionState(contractExample)!
    expect(weekDayLabels(state.week.days, state.date)).toEqual(['四', '五', '六', '日', '一', '二', '今'])
  })

  it('pads marks to the week and flags rows under half', () => {
    const rows = weekHabitRows({
      days: ['2026-11-01', '2026-11-02', '2026-11-03'],
      habits: [
        { key: 'sodium', label: '钠没超上限', marks: ['miss', 'bogus'], hit: 1, of: 3 },
        { key: 'veg', label: '蔬菜够 3 份', marks: ['hit', 'hit', 'today', 'extra'], hit: 2, of: 2 },
      ],
    })
    expect(rows[0]).toEqual({ key: 'sodium', label: '钠没超上限', cells: ['miss', 'none', 'none'], countText: '1/3', warn: true })
    expect(rows[1]).toMatchObject({ cells: ['hit', 'hit', 'today'], countText: '2/2', warn: false })
  })

  it('puts the week-over-week change that got better in the header', () => {
    const split = splitWeekDeltas([
      { key: 'sodium', label: '钠超标', last: 3, this: 4, unit: '天', better: false },
      { key: 'vegetables', label: '蔬菜够量', last: 3, this: 5, unit: '天', better: true },
    ])
    expect(split.headline).toEqual({ key: 'vegetables', text: '蔬菜够量比上周多 2 天', better: true })
    expect(split.rest).toEqual([{ key: 'sodium', text: '钠超标比上周多 1 天', better: false }])
    expect(splitWeekDeltas([{ key: 'fish', label: '吃鱼', last: 3, this: 1, unit: '次', better: false }]).headline?.text).toBe('吃鱼比上周少 2 次')
    expect(splitWeekDeltas([{ key: 'fish', label: '吃鱼', last: 2, this: 2, unit: '次', better: false }]).headline?.text).toBe('吃鱼和上周一样')
    expect(splitWeekDeltas([]).headline).toBeNull()
  })
})

describe('我的关注', () => {
  it('maps engine focus keys onto the existing cards', () => {
    expect(focusCardKey('blood_pressure')).toBe('hypertension')
    expect(focusCardKey('blood_glucose')).toBe('diabetes')
    expect(focusCardKey('cardiovascular')).toBe('cardio')
    expect(focusCardKey('gut')).toBe('colorectal')
    expect(focusCardKey('habits')).toBe('longevity')
    expect(focusCardKey('micronutrients')).toBe('micronutrient')
    expect(focusCardKey('hypertension')).toBe('hypertension')
  })

  it('uses the engine score, reason and evidence and leaves other cards alone', () => {
    const cards = [riskCard({}), riskCard({ key: 'weight', title: '体重管理友好度', score: 80, tone: 'positive' }), riskCard({ key: 'custom:1', is_custom: true })]
    const focus = normalizeNutritionState(contractExample)!.scores.focus
    const next = applyEngineFocus(cards, [...focus, { key: 'custom:1', title: 'x', score: 10, reason: 'y', evidence: [] }])
    expect(next[0]).toMatchObject({ score: 52, tone: 'warning', score_available: true, brief: '钠 6 天里 4 天超标，钾只到目标一半', summary: '钠 6 天里 4 天超标，钾只到目标一半', evidence: ['钠 4/6 天超过 2000mg'] })
    expect(next[1]).toBe(cards[1])
    expect(next[2]).toBe(cards[2])
    expect(cards[0].score).toBe(70)
  })

  it('keeps the old score when the engine has no score for a card', () => {
    const next = applyEngineFocus([riskCard({})], [{ key: 'blood_pressure', title: '', score: null, reason: '还缺钠的数据', evidence: [] }])
    expect(next[0]).toMatchObject({ score: 70, tone: 'neutral', brief: '还缺钠的数据' })
  })
})

describe('宠物观察条', () => {
  it('uses the headline and falls back to the first finding', () => {
    const state = normalizeNutritionState(contractExample)!
    expect(observationHeadline(state)).toBe(contractExample.headline)
    expect(observationHeadline({ headline: '', findings: state.findings })).toBe('6 天里 4 天钠超过 2000 毫克')
    expect(observationHeadline({ headline: '', findings: [] })).toBe('')
    expect(observationMetaText('豆豆', '2026-11-03T23:30:00Z')).toBe('豆豆 · 今天 07:30 的观察')
    expect(observationMetaText('', 'not a date')).toBe('健文伙伴 · 今天的观察')
  })
})
