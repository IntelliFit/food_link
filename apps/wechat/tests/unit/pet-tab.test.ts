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
import { petFocusLabels } from '../../src/pages/pet/pet-focus'
import {
  BUILTIN_FOCUS_OPTIONS,
  builtinFocusLabel,
  focusOptions,
  keepKnownFocus,
  toggleFocus,
} from '../../src/components/FocusSheet/focus-options'
import { DEFAULT_PET_NAME, PET_TAB_LABEL, petDisplayName } from '../../src/utils/pet-name'
import { MAIN_PAGE_ROUTES, MAIN_TAB_ROUTES, normalizeRedirectUrlForSubpackage } from '../../src/utils/subpackage-extra'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('伙伴 page actions', () => {
  it('opens the full analysis as a sub-page and dressing in pet settings', () => {
    expect(petActionTarget('stats')).toEqual({ kind: 'navigateTo', url: '/packageStats/pages/stats/index' })
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

  it('asks what the user typed, or the placeholder question, in a new conversation', () => {
    expect(askTarget(' 奶茶能喝吗 ', '晚上吃什么好？')).toEqual({ kind: 'petAsk', question: '奶茶能喝吗' })
    expect(askTarget('  ', '晚上吃什么好？')).toEqual({ kind: 'petAsk', question: '晚上吃什么好？' })
  })

  it('makes the chat page start fresh and send the question by itself', () => {
    const chat = read('src/packageExtra/pages/pet-chat/index.tsx')
    expect(read('src/utils/pet-navigation.ts')).toContain("export const PET_ASK_ENTRY = 'pet_tab_ask'")
    expect(chat).toContain('options?.entry === PET_ASK_ENTRY')
    expect(chat).toContain('if (homeMealContextRef.current || freshAskRef.current) return')
    expect(chat).toMatch(/autoSendRef\.current = ''\s*handleSend\(\)/)
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
  const custom = [{ id: 'abc', label: '少喝奶茶', created_at: '2026-11-01' }]

  it('offers the seven built-ins plus the custom focuses the user added', () => {
    const options = focusOptions(custom)
    expect(options.map((option) => option.key)).toEqual([...BUILTIN_FOCUS_OPTIONS.map((option) => option.key), 'custom:abc'])
    expect(options[options.length - 1]).toEqual({ key: 'custom:abc', label: '少喝奶茶', customId: 'abc' })
  })

  it('uses the same short names as sign-up', () => {
    const onboarding = read('src/packageOnboarding/focus.ts')
    for (const option of BUILTIN_FOCUS_OPTIONS) expect(onboarding).toContain(`label: '${option.label}'`)
    expect(builtinFocusLabel('hypertension')).toBe('控血压')
    expect(builtinFocusLabel('custom:abc')).toBe('')
  })

  it('keeps at most three and says when the list is full', () => {
    expect(toggleFocus(['hypertension'], 'weight')).toEqual({ keys: ['hypertension', 'weight'], blocked: false })
    expect(toggleFocus(['hypertension', 'weight'], 'hypertension')).toEqual({ keys: ['weight'], blocked: false })
    expect(toggleFocus(['a', 'b', 'c'], 'd')).toEqual({ keys: ['a', 'b', 'c'], blocked: true })
  })

  it('drops a removed custom focus before saving', () => {
    expect(keepKnownFocus(['custom:gone', 'weight', 'custom:abc'], focusOptions(custom))).toEqual(['weight', 'custom:abc'])
  })

  it('shows short names on the 伙伴 page row', () => {
    expect(petFocusLabels([
      { key: 'hypertension', title: '血压管理友好度', custom: false },
      { key: 'custom:abc', title: '少喝奶茶', custom: true },
    ])).toEqual(['控血压', '少喝奶茶'])
    expect(petFocusLabels([])).toEqual([])
  })

  it('is edited in one sheet on both the 伙伴 page and the full analysis', () => {
    expect(read('src/pages/pet/index.tsx')).toContain("<FocusSheet")
    expect(read('src/packageStats/pages/stats/index.tsx')).toContain("<FocusSheet")
    expect(read('src/packageStats/pages/stats/index.tsx')).not.toContain('risk-focus-modal')
    expect(read('src/components/StatsNutritionState/FocusSpotlightCard.tsx')).toContain('我在意的')
  })
})

describe('the pet is called by its own name', () => {
  it('falls back to 健文伙伴 and labels the slot 伙伴', () => {
    expect(petDisplayName(' 豆豆 ')).toBe('豆豆')
    expect(petDisplayName('')).toBe(DEFAULT_PET_NAME)
    expect(DEFAULT_PET_NAME).toBe('健文伙伴')
    expect(PET_TAB_LABEL).toBe('伙伴')
  })

  it('never hard-codes 小麦 in the mini program copy', () => {
    for (const file of [
      'src/pages/pet/index.tsx',
      'src/pages/pet/PetDailyCards.tsx',
      'src/components/FirstBriefSheet/index.tsx',
      'src/components/OnboardingWelcome/index.tsx',
      'src/packageExtra/pages/pet-chat/index.tsx',
      'custom-tab-bar/index.js',
      'src/app.config.ts',
    ]) {
      expect(read(file)).not.toContain('小麦')
    }
  })

  it('sends a tap on the home pet to the 伙伴 tab', () => {
    const home = read('src/pages/index/index.tsx')
    expect(home).toContain("onPetPress={openPetTab}")
    expect(home).toContain("void Taro.switchTab({ url: '/pages/pet/index' })")
  })
})

describe('伙伴 replaces the 分析 slot', () => {
  it('keeps five slots with the camera centred: 首页 · 伙伴 · 拍照 · 圈子 · 我的', () => {
    const tabBar = read('custom-tab-bar/index.js')
    const items = Array.from(tabBar.matchAll(/id: '([a-z]+)',\s*\n\s*pagePath: '([^']+)',?\s*\n\s*text: '([^']*)'/g))
      .map((match) => [match[1], match[2], match[3]])
    expect(items).toEqual([
      ['home', '/pages/index/index', '首页'],
      ['pet', '/pages/pet/index', '伙伴'],
      ['record', '/pages/index/index', ''],
      ['community', '/pages/community/index', '圈子'],
      ['profile', '/pages/profile/index', '我的'],
    ])
    expect(read('custom-tab-bar/index.wxml')).toContain("item.id === 'pet'")
  })

  it('lists the pet page as the tab and keeps the full analysis in its own subpackage', () => {
    const appConfig = read('src/app.config.ts')
    const start = appConfig.indexOf('const mainPages')
    const mainPages = appConfig.slice(start, appConfig.indexOf(']', start))
    expect(mainPages).toContain("'pages/pet/index'")
    expect(mainPages).not.toContain("'pages/stats/index'")
    expect(appConfig).toContain("{ root: 'packageStats', name: 'stats', pages: ['pages/stats/index'] }")
    expect(appConfig).toContain("'pages/pet/index': { network: 'all', packages: ['stats'] }")
    const tabList = appConfig.slice(appConfig.indexOf('tabBar:'))
    expect(tabList).toContain("pagePath: 'pages/pet/index'")
    expect(tabList).not.toContain("pagePath: 'pages/stats/index'")
  })

  it('routes old analysis redirects into the stats subpackage', () => {
    expect(MAIN_TAB_ROUTES.has('/pages/pet/index')).toBe(true)
    expect(MAIN_TAB_ROUTES.has('/pages/stats/index')).toBe(false)
    expect(MAIN_PAGE_ROUTES.has('/pages/stats/index')).toBe(false)
    expect(normalizeRedirectUrlForSubpackage('/pages/stats/index?tab=focus')).toBe('/packageStats/pages/stats/index?tab=focus')
    expect(normalizeRedirectUrlForSubpackage('/packageStats/pages/stats/index')).toBe('/packageStats/pages/stats/index')
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

  it('opens the 伙伴 page for guests', () => {
    expect(read('src/pages/pet/index.tsx')).toContain('withAuth(PetTabPage, { public: true })')
  })
})
