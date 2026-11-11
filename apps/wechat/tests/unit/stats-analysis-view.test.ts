import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  calorieChartView,
  focusPillTone,
  gateHeadline,
  macroSplit,
  rangeLabel,
  recordedDayDots,
  sodiumGapNote,
  splitAction,
  summaryNote,
  weightTrendView,
  WEIGHT_PLOT,
} from '../../src/packageStats/pages/stats/analysis-view'

function source(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../src', relativePath), 'utf8')
}

const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']

describe('summary card', () => {
  it('labels the period with its dates', () => {
    expect(rangeLabel('week', '2026-11-02', '2026-11-08')).toBe('这一周 · 11月2日–8日')
    expect(rangeLabel('week', '2026-10-28', '2026-11-03')).toBe('这一周 · 10月28日–11月3日')
    expect(rangeLabel('month', '2026-10-10', '2026-11-08')).toBe('这个月 · 10月10日–11月8日')
    expect(rangeLabel('week', '', '2026-11-08')).toBe('这一周')
  })

  it('notes days, meals and missing sodium', () => {
    const gaps = [{ key: 'sodium_unknown', text: '3 餐没有钠的数据', hint: '', action: 'record' }]
    expect(sodiumGapNote(gaps)).toBe('有 3 餐缺钠数据，分数可能偏高')
    expect(sodiumGapNote([{ key: 'sodium_unknown', text: '有几餐没有钠的数据', hint: '', action: 'record' }])).toBe('部分餐缺钠数据，分数可能偏高')
    expect(sodiumGapNote([{ key: 'weight_missing', text: '最近两周没记体重', hint: '', action: 'weight' }])).toBe('')
    expect(summaryNote(6, 15, sodiumGapNote(gaps))).toBe('已记 6 天 · 15 餐 · 有 3 餐缺钠数据，分数可能偏高')
    expect(summaryNote(6, 15)).toBe('已记 6 天 · 15 餐')
    // 近一个月没有引擎的餐数，只写天数
    expect(summaryNote(12, null)).toBe('已记 12 天')
  })

  it('says how many more days the score needs', () => {
    expect(gateHeadline('week', 1)).toBe('再记 1 天，这一周的分数就出来了')
    expect(gateHeadline('week', 0)).toBe('再记 2 天，这一周的分数就出来了')
    expect(gateHeadline('month', 0)).toBe('再记 2 天，这个月的分数就出来了')
    // 后端还没出分但已经记了 2 天以上：不说「再记 0 天」
    expect(gateHeadline('week', 3)).toBe('再记 1 天，这一周的分数就出来了')
  })

  it('marks which of the last 7 days were recorded', () => {
    const daily = WEEK.map((date, index) => ({ date, calories: index === 6 ? 820 : 0 }))
    expect(recordedDayDots(daily)).toEqual([false, false, false, false, false, false, true])
    expect(recordedDayDots([{ calories: 500 }, { calories: 0 }])).toEqual([false, false, false, false, false, true, false])
  })
})

describe('focus rows and actions', () => {
  it('colours a score green when good, amber otherwise and grey without one', () => {
    expect(focusPillTone(71)).toBe('ok')
    expect(focusPillTone(60)).toBe('ok')
    expect(focusPillTone(58)).toBe('warn')
    expect(focusPillTone(null)).toBe('none')
  })

  it('bolds the first sentence of an action', () => {
    expect(splitAction('晚餐少喝汤，酱汁另放。这周超标的 4 天都有汤面或盖饭酱汁。'))
      .toEqual({ lead: '晚餐少喝汤，酱汁另放。', rest: '这周超标的 4 天都有汤面或盖饭酱汁。' })
    expect(splitAction('每餐加一拳深色蔬菜。')).toEqual({ lead: '每餐加一拳深色蔬菜。', rest: '' })
    expect(splitAction('少喝含糖饮料，换成无糖茶')).toEqual({ lead: '少喝含糖饮料，换成无糖茶', rest: '' })
  })
})

describe('calorie chart', () => {
  const daily = WEEK.map((date, index) => ({ date, calories: [1250, 1440, 1520, 1350, 0, 1420, 930][index] }))

  it('scales the week against the larger of the reference and the busiest day', () => {
    const chart = calorieChartView({ daily, tdee: 1900, avgCalories: 1633.4, range: 'week', today: '2026-11-08' })!
    expect(chart.bars).toHaveLength(7)
    expect(chart.referencePct).toBeCloseTo(100 / 1.1, 5)
    expect(chart.referenceText).toBe('参考 1900')
    expect(chart.averageText).toBe('日均 1633 kcal')
    expect(chart.bars[0].heightPct).toBeCloseTo(1250 / (1900 * 1.1) * 100, 5)
    expect(chart.bars.map(bar => bar.label)).toEqual(['一', '二', '三', '四', '五', '六', '今'])
    expect(chart.bars[4]).toMatchObject({ empty: true, heightPct: 0 })
    expect(chart.bars[6].today).toBe(true)
    expect(chart.dense).toBe(false)
  })

  it('keeps a day above the reference inside the plot', () => {
    const chart = calorieChartView({ daily: [{ date: '2026-11-08', calories: 3000 }], tdee: 1900, avgCalories: 3000, range: 'week', today: '2026-11-08' })!
    expect(chart.bars[0].heightPct).toBeCloseTo(100 / 1.1, 5)
    expect(chart.referencePct).toBeCloseTo(1900 / 3300 * 100, 5)
  })

  it('draws no reference line or average when they are unknown', () => {
    const chart = calorieChartView({ daily, tdee: 0, avgCalories: 0, range: 'week', today: '2026-11-08' })!
    expect(chart.referencePct).toBeNull()
    expect(chart.referenceText).toBe('')
    expect(chart.averageText).toBe('')
    expect(calorieChartView({ daily: [], tdee: 1900, avgCalories: 0, range: 'week', today: '2026-11-08' })).toBeNull()
  })

  it('shows every day of the month thinner and labels one day a week', () => {
    const month = Array.from({ length: 30 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 9, 10 + index))
      return { date: day.toISOString().slice(0, 10), calories: 1500 }
    })
    const chart = calorieChartView({ daily: month, tdee: 1900, avgCalories: 1500, range: 'month', today: '2026-11-08' })!
    expect(chart.bars).toHaveLength(30)
    expect(chart.dense).toBe(true)
    expect(chart.bars[29].label).toBe('今')
    expect(chart.bars[22].label).toBe('1')
    expect(chart.bars.filter(bar => bar.label).length).toBe(5)
  })

  it('splits the three macros into 100', () => {
    expect(macroSplit({ protein: 20, carbs: 50, fat: 30 })).toEqual({ protein: 20, carbs: 50, fat: 30 })
    expect(macroSplit({ protein: 1, carbs: 1, fat: 1 })).toEqual({ protein: 33, carbs: 33, fat: 34 })
    expect(macroSplit({ protein: 0, carbs: 0, fat: 0 })).toBeNull()
  })
})

describe('weight card', () => {
  const entries = [
    { date: '2026-10-20', value: 63.4 },
    { date: '2026-11-02', value: 63.0 },
    { date: '2026-11-05', value: 62.7 },
    { date: '2026-11-08', value: 62.4 },
  ]

  it('compares the latest weigh-in with the first one in the range', () => {
    const view = weightTrendView(entries, '2026-11-02', '2026-11-08')!
    expect(view.valueText).toBe('62.4')
    expect(view.changeText).toBe('比11月2日 −0.6 kg')
    expect(view.countText).toBe('记了 3 次')
    expect(view.points).toHaveLength(3)
    expect(view.segments).toHaveLength(2)
    // 最重的在上，最轻的在下，都在框里
    expect(view.points[0]).toMatchObject({ x: WEIGHT_PLOT.pad, y: WEIGHT_PLOT.pad })
    expect(view.points[2]).toMatchObject({ x: WEIGHT_PLOT.width - WEIGHT_PLOT.pad, y: WEIGHT_PLOT.height - WEIGHT_PLOT.pad })
    expect(view.segments[0].angle).toBeGreaterThan(0)
  })

  it('falls back to the last weigh-in before the range when there is only one inside', () => {
    const view = weightTrendView(entries, '2026-11-06', '2026-11-08')!
    expect(view.changeText).toBe('比11月5日 −0.3 kg')
    expect(view.points).toEqual([])
    const flat = weightTrendView([{ date: '2026-11-01', value: 62.4 }, { date: '2026-11-08', value: 62.4 }], '2026-11-02', '2026-11-08')!
    expect(flat.changeText).toBe('和11月1日持平')
    const first = weightTrendView([{ date: '2026-11-08', value: 70 }], '2026-11-02', '2026-11-08')!
    expect(first.changeText).toBe('11月8日记录')
  })

  it('hides the card without a weigh-in in the range', () => {
    expect(weightTrendView([], '2026-11-02', '2026-11-08')).toBeNull()
    expect(weightTrendView([{ date: '2026-10-01', value: 60 }], '2026-11-02', '2026-11-08')).toBeNull()
  })
})

describe('full analysis page layout', () => {
  const page = source('packageStats/pages/stats/index.tsx')

  it('is one scroll page without the old tabs, trend panel or record buttons', () => {
    expect(page).not.toContain('analysisPanel')
    expect(page).not.toContain('EvidenceGapsCard')
    expect(page).not.toContain('<FocusSheet')
    expect(page).not.toContain('餐次分布')
    expect(page).not.toContain('喝水趋势')
    expect(page).not.toContain('其他方面')
    expect(page).not.toContain('加载中')
    expect(page).toContain('<RangeSegment')
    expect(page).toContain('结果仅供参考，不代替医学判断')
  })
})
