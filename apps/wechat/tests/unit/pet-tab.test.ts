import * as fs from 'fs'
import * as path from 'path'
import {
  askTarget,
  petActionNeedsLogin,
  petActionTarget,
  petTaskHint,
  petWeekTitle,
  pickMealTarget,
} from '../../src/pages/pet/pet-tools'
import { PET_FOCUS_OPTIONS, petFocusOptions, petFocusSummary, togglePetFocus } from '../../src/pages/pet/pet-focus'
import { MAIN_PAGE_ROUTES, MAIN_TAB_ROUTES, normalizeRedirectUrlForSubpackage } from '../../src/utils/subpackage-extra'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('小麦 page actions', () => {
  it('opens the full analysis as a sub-page and dressing in pet settings', () => {
    expect(petActionTarget('stats')).toEqual({ kind: 'navigateTo', url: '/pages/stats/index' })
    expect(petActionTarget('dress')).toEqual({ kind: 'petSettings' })
  })

  it('hands the next meal to pet chat the way the home next-meal card does', () => {
    const meal = { meal_type: 'dinner', label: '晚餐', advice: '深色蔬菜 + 鱼或豆腐', starter_question: '今天晚餐吃什么？' }
    expect(pickMealTarget(meal, '2026-11-05')).toEqual({
      kind: 'petChatMeal',
      entry: {
        source: 'home_next_meal',
        date: '2026-11-05',
        mealType: 'dinner',
        mealLabel: '晚餐',
        basicAdvice: '深色蔬菜 + 鱼或豆腐',
        starterQuestion: '今天晚餐吃什么？',
      },
    })
    expect(pickMealTarget({ ...meal, meal_type: 'snack' }, '2026-11-05')).toEqual({ kind: 'petChat', starter: '今天晚餐吃什么？' })
    expect(pickMealTarget(null, '')).toEqual({ kind: 'petChat', starter: '下一餐吃什么？' })
  })

  it('asks what the user typed, or the placeholder question', () => {
    expect(askTarget(' 奶茶能喝吗 ', '晚上吃什么好？')).toEqual({ kind: 'petChat', starter: '奶茶能喝吗' })
    expect(askTarget('  ', '晚上吃什么好？')).toEqual({ kind: 'petChat', starter: '晚上吃什么好？' })
  })

  it('lets guests open the full analysis and gates personal actions', () => {
    expect(petActionNeedsLogin('stats')).toBe(false)
    for (const id of ['pick_meal', 'ask', 'dress'] as const) expect(petActionNeedsLogin(id)).toBe(true)
  })

  it('words the task hint and the week line from the numbers it gets', () => {
    expect(petTaskHint({ kind: 'fill', progress: 0, goal: 6, done: false, exp_reward: 20 })).toBe('记录这一餐就自动完成 · +20 经验')
    expect(petTaskHint({ kind: 'water', progress: 2, goal: 6, done: false, exp_reward: 20 })).toBe('2/6 杯 · 喝够自动完成 · +20 经验')
    expect(petTaskHint({ kind: 'fill', progress: 6, goal: 6, done: true, exp_reward: 20 })).toBe('完成啦 · +20 经验已到账')
    expect(petWeekTitle({ score: 64, delta: 6 })).toEqual({ score: '本周 64 分', delta: '比上周 +6', better: true })
    expect(petWeekTitle({ score: 60, delta: -3 })).toEqual({ score: '本周 60 分', delta: '比上周 -3', better: false })
    expect(petWeekTitle({ score: null, delta: null })).toEqual({ score: '本周分数还在攒', delta: '', better: false })
  })
})

describe('我在意的', () => {
  const current = [
    { key: 'hypertension', title: '控血压', custom: false },
    { key: 'custom:abc', title: '少喝奶茶', custom: true },
  ]

  it('offers the seven focus cards plus the custom focuses already chosen', () => {
    const options = petFocusOptions(current)
    expect(options.map((option) => option.key)).toEqual([...PET_FOCUS_OPTIONS.map((option) => option.key), 'custom:abc'])
    expect(options[options.length - 1]).toEqual({ key: 'custom:abc', label: '少喝奶茶', custom: true })
  })

  it('keeps at most three and says when the list is full', () => {
    expect(togglePetFocus(['hypertension'], 'weight')).toEqual({ keys: ['hypertension', 'weight'], blocked: false })
    expect(togglePetFocus(['hypertension', 'weight'], 'hypertension')).toEqual({ keys: ['weight'], blocked: false })
    expect(togglePetFocus(['a', 'b', 'c'], 'd')).toEqual({ keys: ['a', 'b', 'c'], blocked: true })
  })

  it('summarises the choice on the entry', () => {
    expect(petFocusSummary(current)).toBe('控血压·少喝奶茶')
    expect(petFocusSummary([])).toBe('选一选')
  })
})

describe('小麦 replaces the 分析 slot', () => {
  it('keeps five slots with the camera centred: 首页 · 小麦 · 拍照 · 圈子 · 我的', () => {
    const tabBar = read('custom-tab-bar/index.js')
    const items = Array.from(tabBar.matchAll(/id: '([a-z]+)',\s*\n\s*pagePath: '([^']+)',?\s*\n\s*text: '([^']*)'/g))
      .map((match) => [match[1], match[2], match[3]])
    expect(items).toEqual([
      ['home', '/pages/index/index', '首页'],
      ['pet', '/pages/pet/index', '小麦'],
      ['record', '/pages/index/index', ''],
      ['community', '/pages/community/index', '圈子'],
      ['profile', '/pages/profile/index', '我的'],
    ])
    expect(read('custom-tab-bar/index.wxml')).toContain("item.id === 'pet'")
  })

  it('lists the pet page as the tab and keeps the full analysis in the main package', () => {
    const appConfig = read('src/app.config.ts')
    const start = appConfig.indexOf('const mainPages')
    const mainPages = appConfig.slice(start, appConfig.indexOf(']', start))
    expect(mainPages).toContain("'pages/pet/index'")
    expect(mainPages).toContain("'pages/stats/index'")
    const tabList = appConfig.slice(appConfig.indexOf('tabBar:'))
    expect(tabList).toContain("pagePath: 'pages/pet/index'")
    expect(tabList).not.toContain("pagePath: 'pages/stats/index'")
  })

  it('routes login redirects to the analysis sub-page without a subpackage prefix', () => {
    expect(MAIN_TAB_ROUTES.has('/pages/pet/index')).toBe(true)
    expect(MAIN_TAB_ROUTES.has('/pages/stats/index')).toBe(false)
    expect(MAIN_PAGE_ROUTES.has('/pages/stats/index')).toBe(true)
    expect(normalizeRedirectUrlForSubpackage('/pages/stats/index?tab=focus')).toBe('/pages/stats/index?tab=focus')
    expect(normalizeRedirectUrlForSubpackage('/pages/pet/index')).toBe('/pages/pet/index')
  })

  it('no longer switches tabs to the analysis page', () => {
    for (const file of [
      'src/components/MealImpactCard/index.tsx',
      'src/packageExtra/pages/stats-metabolic/metabolic-dynamics-report.tsx',
    ]) {
      expect(read(file)).not.toMatch(/switchTab\(\{\s*url:\s*'\/pages\/stats\/index'/)
    }
  })

  it('opens the 小麦 page for guests', () => {
    expect(read('src/pages/pet/index.tsx')).toContain('withAuth(PetTabPage, { public: true })')
  })
})
