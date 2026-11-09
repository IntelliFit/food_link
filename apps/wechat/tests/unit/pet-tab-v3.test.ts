import * as fs from 'fs'
import * as path from 'path'
import { petDayLabel, petMealLines, petTodayLine, petWeekChip } from '../../src/pages/pet/pet-tools'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('伙伴页简报卡', () => {
  it('puts the week score in the corner chip, or says it is still collecting', () => {
    expect(petWeekChip({ score: 64, delta: 6 })).toBe('本周 64 分 · +6')
    expect(petWeekChip({ score: 60, delta: -3 })).toBe('本周 60 分 · -3')
    expect(petWeekChip({ score: 60, delta: 0 })).toBe('本周 60 分')
    expect(petWeekChip({ score: null, delta: null })).toBe('本周分数还在攒')
    expect(petWeekChip(null)).toBe('本周分数还在攒')
  })

  it('writes the day as 今天 · 11月8日 周日', () => {
    expect(petDayLabel('2026-11-08')).toBe('今天 · 11月8日 周日')
    expect(petDayLabel('2026-11-09')).toBe('今天 · 11月9日 周一')
    expect(petDayLabel('')).toBe('今天')
  })

  it('says one thing about today, never the week line the analysis page shows', () => {
    expect(petTodayLine([{ label: '蔬菜', text: '还差 2 份', status: 'short' }], '晚餐')).toBe('今天蔬菜还差 2 份，晚餐补上就好。')
    expect(petTodayLine([{ label: '钠', text: '1850/2000mg，快到上限', status: 'near_limit' }], '晚餐')).toBe('今天钠快到上限了，晚餐清淡一点。')
    expect(petTodayLine([{ label: '钠', text: '超出 400mg', status: 'over' }], '')).toBe('今天钠已经超了，下一顿清淡一点。')
    expect(petTodayLine([], '午餐')).toBe('今天都在范围里，午餐照这样吃就好。')
  })

  it('splits the next-meal advice into what to eat and how', () => {
    expect(petMealLines('一份深色蔬菜 + 鱼或豆腐，汤和酱汁少一点')).toEqual({ dish: '一份深色蔬菜 + 鱼或豆腐', note: '汤和酱汁少一点' })
    expect(petMealLines('多吃蔬菜')).toEqual({ dish: '多吃蔬菜', note: '' })
    expect(petMealLines('')).toEqual({ dish: '', note: '' })
  })
})

describe('我在意的 只在伙伴页改', () => {
  it('opens the sheet when another page asks for it', () => {
    const page = read('src/pages/pet/index.tsx')
    expect(page).toContain('takePetFocusSheetRequest()')
    expect(page).toContain('<FocusSheet')
    const nav = read('src/utils/pet-navigation.ts')
    expect(nav).toContain('export function openPetFocusSheet()')
    expect(nav).toContain("void Taro.switchTab({ url: PET_TAB_URL })")
  })

  it('keeps one page purpose: no separate focus card, no week card', () => {
    const cards = read('src/pages/pet/PetDailyCards.tsx')
    expect(cards).not.toContain('PetFocusRow')
    expect(cards).not.toContain('PetWeekRow')
    expect(cards).toContain('拍第一餐')
  })
})
