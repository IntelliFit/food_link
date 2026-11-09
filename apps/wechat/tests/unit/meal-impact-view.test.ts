import {
  buildImpactRow,
  buildImpactRows,
  dayWord,
  formatAmount,
  formatDelta,
  headerText,
  mealSubtitle,
  mealSummaryFromSavePayload,
  pickPetFeedback,
  withTimeout,
} from '../../src/components/MealImpactCard/meal-impact-view'
import type { MealImpact, MealImpactChange, SaveFoodRecordRequest } from '../../src/utils/api'

const change = (patch: Partial<MealImpactChange>): MealImpactChange => ({
  key: 'fiber', label: '膳食纤维', unit: 'g', before: 11, after: 17, delta: 6, target: 25, kind: 'min', status: 'short', ...patch,
})

const impact = (changes: MealImpactChange[]): MealImpact => ({
  record_id: 'r1', date: '2026-11-04', meal_type: 'lunch', changes, headline: '这一餐让纤维 +6g，今天还差 8g',
})

describe('meal impact rows', () => {
  it('splits the bar into before and this meal against the target', () => {
    const row = buildImpactRow(change({}))
    expect(row).toMatchObject({ label: '膳食纤维', tone: 'good', deltaText: '+6g', totalText: '17', targetText: '/ 25 g', badge: '', note: '' })
    expect(row.beforePct).toBeCloseTo(44)
    expect(row.deltaPct).toBeCloseTo(24)
  })

  it('puts a space before Chinese units', () => {
    const row = buildImpactRow(change({ key: 'vegetables', label: '蔬菜', unit: '份', before: 1, after: 2, delta: 1, target: 3 }))
    expect(row.deltaText).toBe('+1 份')
    expect(row.targetText).toBe('/ 3 份')
  })

  it('turns ceiling nutrients orange when near or over the limit', () => {
    const near = buildImpactRow(change({ key: 'sodium', label: '钠', unit: 'mg', before: 950, after: 1850, delta: 900, target: 2000, kind: 'max', status: 'near_limit' }))
    expect(near).toMatchObject({ tone: 'warn', badge: '快到上限', deltaText: '+900mg', totalText: '1850' })
    expect(near.beforePct).toBeCloseTo(47.5)
    expect(near.deltaPct).toBeCloseTo(45)

    const over = buildImpactRow(change({ key: 'sodium', label: '钠', unit: 'mg', before: 1500, after: 2500, delta: 1000, target: 2000, kind: 'max', status: 'over' }))
    expect(over).toMatchObject({ tone: 'warn', badge: '超过上限' })
    // 超过上限时整条按今天总量画满
    expect(over.beforePct + over.deltaPct).toBeCloseTo(100)

    const ok = buildImpactRow(change({ key: 'sodium', unit: 'mg', before: 200, after: 600, delta: 400, target: 2000, kind: 'max', status: 'ok' }))
    expect(ok).toMatchObject({ tone: 'good', badge: '' })
  })

  it('says unknown instead of drawing zero', () => {
    const row = buildImpactRow(change({ key: 'added_sugar', label: '添加糖', before: null, after: null, delta: null, kind: 'max', status: 'unknown' }))
    expect(row).toMatchObject({ note: '这一餐没有这项数据', deltaText: '', totalText: '', targetText: '', tone: 'good', badge: '' })
  })

  it('keeps this meal amount when earlier meals lack the nutrient', () => {
    const row = buildImpactRow(change({ key: 'sodium', label: '钠', unit: 'mg', before: null, after: null, delta: 900, kind: 'max', status: 'unknown' }))
    expect(row).toMatchObject({ deltaText: '+900mg', note: '今天其他餐没有这项数据', totalText: '' })
  })

  it('does not divide by a missing target', () => {
    const row = buildImpactRow(change({ target: 0, before: 0, after: 0, delta: 0 }))
    expect(row).toMatchObject({ deltaText: '+0g', targetText: '', beforePct: 0, deltaPct: 0 })
  })

  it('keeps server order and caps the list', () => {
    const rows = buildImpactRows(impact(['a', 'b', 'c', 'd', 'e', 'f'].map(key => change({ key }))))
    expect(rows.map(row => row.key)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(buildImpactRows(null)).toEqual([])
    expect(buildImpactRows({ ...impact([]), changes: null as unknown as MealImpactChange[] })).toEqual([])
  })
})

describe('meal impact formatting', () => {
  it('rounds large numbers and keeps one decimal for small ones', () => {
    expect(formatAmount(17.4)).toBe('17')
    expect(formatAmount(0.46)).toBe('0.5')
    expect(formatAmount(2)).toBe('2')
    expect(formatAmount(-0.01)).toBe('0')
    expect(formatDelta(-3, 'g')).toBe('-3g')
  })

  it('names the day and meal in the header', () => {
    const now = new Date(2026, 10, 4, 12, 20)
    expect(headerText('lunch', '2026-11-04', now)).toBe('已记录 · 午餐 12:20')
    expect(headerText('dinner', '2026-11-03', now)).toBe('已记录 · 晚餐 11月3日')
    expect(headerText(undefined, undefined, now)).toBe('已记录 · 12:20')
    expect(dayWord('2026-11-04', now)).toBe('今天')
    expect(dayWord('', now)).toBe('今天')
  })

  it('summarises the saved payload for the meal card', () => {
    const payload = {
      meal_type: 'lunch',
      date: '2026-11-04',
      description: '手动记录：番茄炒蛋',
      image_path: 'https://img/a.jpg',
      image_paths: ['https://img/b.jpg'],
      items: [{ name: '番茄炒蛋' }, { name: ' 米饭 ' }, { name: '' }],
      total_calories: 620.4,
      total_protein: 22,
    } as unknown as SaveFoodRecordRequest
    const meal = mealSummaryFromSavePayload(payload)
    expect(meal).toEqual({ title: '番茄炒蛋、米饭', calories: 620.4, protein: 22, imageUrl: 'https://img/b.jpg', mealType: 'lunch', date: '2026-11-04' })
    expect(mealSubtitle(meal)).toBe('约 620 千卡 · 蛋白质 22g')

    const described = mealSummaryFromSavePayload({ ...payload, items: [], image_paths: undefined } as SaveFoodRecordRequest)
    expect(described.title).toBe('番茄炒蛋')
    expect(described.imageUrl).toBe('https://img/a.jpg')
    expect(mealSubtitle({ title: 'x' })).toBe('')
  })
})

describe('pet feedback after a record', () => {
  it('says the daily note and reports the task only when this read just completed it', () => {
    const daily = {
      pet: { name: '小麦' },
      mood: { key: 'happy', label: '开心', reason: '蔬菜跟上了' },
      report: { today: '菜心记上了，晚饭汤少喝两口。' },
      task: { key: 'vegetables', done: true, just_done: true, exp_reward: 20 },
    }
    expect(pickPetFeedback(daily)).toEqual({ line: '菜心记上了，晚饭汤少喝两口。', exp: 20, pet: { name: '小麦' }, mood: 'happy' })
    // 早上就完成的任务不再报一次
    expect(pickPetFeedback({ ...daily, task: { ...daily.task, just_done: false } })?.exp).toBeNull()
    expect(pickPetFeedback({ ...daily, task: { ...daily.task, exp_reward: 0 } })?.exp).toBeNull()
    expect(pickPetFeedback({ ...daily, report: { today: '' } })?.line).toBe('蔬菜跟上了')
  })

  it('hides the pet when there is nothing to say', () => {
    expect(pickPetFeedback(null)).toBeNull()
    expect(pickPetFeedback({})).toBeNull()
    expect(pickPetFeedback({ report: { today: '  ' }, mood: { key: 'calm' } })).toBeNull()
    expect(pickPetFeedback({ task: { just_done: true, exp_reward: 20 } })).toEqual({ line: '', exp: 20, pet: null, mood: undefined })
  })
})

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('gives up after the deadline', async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve('late'), 5000))
    const raced = withTimeout(slow, 3000)
    jest.advanceTimersByTime(3000)
    await expect(raced).rejects.toThrow('timeout')
  })

  it('passes through fast results and errors', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 3000)).resolves.toBe('ok')
    await expect(withTimeout(Promise.reject(new Error('404')), 3000)).rejects.toThrow('404')
  })
})
