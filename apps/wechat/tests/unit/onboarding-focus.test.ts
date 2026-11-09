/** @jest-environment node */

jest.mock('../../src/utils/api', () => ({
  addHealthFocus: jest.fn(),
  saveHealthFocusKeys: jest.fn(),
}))

import { addHealthFocus, saveHealthFocusKeys } from '../../src/utils/api'
import {
  CUSTOM_FOCUS_PREFIX,
  FOCUS_LIMIT,
  FOCUS_OPTIONS,
  buildFocusKeys,
  focusLabel,
  focusReply,
  focusSaid,
  normalizeCustomFocus,
  saveOnboardingFocus,
  toggleFocus,
} from '../../src/packageOnboarding/focus'

const addMock = addHealthFocus as jest.Mock
const saveMock = saveHealthFocusKeys as jest.Mock

describe('FOCUS_OPTIONS', () => {
  it('uses the analysis page focus card keys', () => {
    expect(FOCUS_OPTIONS.map((o) => o.key).sort()).toEqual(
      ['cardio', 'colorectal', 'diabetes', 'hypertension', 'longevity', 'micronutrient', 'weight'],
    )
    expect(focusLabel('hypertension')).toBe('控血压')
    expect(focusLabel('diabetes')).toBe('控血糖')
  })
})

describe('toggleFocus', () => {
  it('adds and removes a focus without touching the input', () => {
    const selected = ['hypertension'] as const
    expect(toggleFocus(selected, 'weight')).toEqual({ next: ['hypertension', 'weight'], blocked: false })
    expect(toggleFocus(selected, 'hypertension')).toEqual({ next: [], blocked: false })
    expect(selected).toEqual(['hypertension'])
  })

  it('blocks a fourth pick and counts a custom focus against the limit', () => {
    expect(toggleFocus(['hypertension', 'diabetes', 'weight'], 'cardio')).toEqual({
      next: ['hypertension', 'diabetes', 'weight'],
      blocked: true,
    })
    expect(toggleFocus(['hypertension', 'diabetes'], 'cardio', FOCUS_LIMIT - 1).blocked).toBe(true)
    expect(toggleFocus(['hypertension', 'diabetes'], 'diabetes', FOCUS_LIMIT - 1)).toEqual({ next: ['hypertension'], blocked: false })
  })
})

describe('normalizeCustomFocus', () => {
  it.each([
    ['  控尿酸 ', '控尿酸'],
    ['少喝  奶茶', '少喝 奶茶'],
    ['一二三四五六七八九十一二', '一二三四五六七八九十一二'],
    ['一', ''],
    ['一二三四五六七八九十一二三', ''],
    ['   ', ''],
  ])('reads %p as %p', (input, expected) => {
    expect(normalizeCustomFocus(input)).toBe(expected)
  })
})

describe('focusReply', () => {
  it('says what it will watch', () => {
    expect(focusReply(['hypertension'])).toBe('好，我会帮你盯着盐。')
    expect(focusReply(['hypertension', 'diabetes'])).toBe('好，我会帮你盯着盐和糖。')
  })

  it('does not repeat a word and keeps the sentence short', () => {
    expect(focusReply(['hypertension', 'cardio'])).toBe('好，我会帮你盯着盐和油。')
    expect(focusReply(['cardio', 'colorectal', 'micronutrient'])).toBe('好，我会帮你盯着油、盐、蔬菜和纤维。')
  })

  it('mentions a custom focus', () => {
    expect(focusReply(['weight'], '控尿酸')).toBe('好，我会帮你盯着热量，「控尿酸」我也记下了。')
    expect(focusReply([], '控尿酸')).toBe('好，「控尿酸」我记下了。')
  })

  it('has a line for skipping', () => {
    expect(focusReply([])).toContain('以后想改随时说')
  })
})

describe('focusSaid', () => {
  it('lists the picks in plain words, or says it was skipped', () => {
    expect(focusSaid(['hypertension', 'weight'], '控尿酸')).toBe('控血压、管体重、控尿酸')
    expect(focusSaid([])).toBe('先跳过')
  })
})

describe('buildFocusKeys', () => {
  it('puts the custom focus last as custom:<id>', () => {
    expect(buildFocusKeys(['hypertension', 'weight'], 'f1')).toEqual(['hypertension', 'weight', `${CUSTOM_FOCUS_PREFIX}f1`])
  })

  it('never sends more than three keys', () => {
    expect(buildFocusKeys(['hypertension', 'weight', 'cardio'], 'f1')).toEqual(['hypertension', 'weight', 'custom:f1'])
    expect(buildFocusKeys(['hypertension', 'weight', 'cardio', 'diabetes'])).toEqual(['hypertension', 'weight', 'cardio'])
    expect(buildFocusKeys(['weight', 'weight'])).toEqual(['weight'])
  })

  it('drops a custom focus whose id never came back', () => {
    expect(buildFocusKeys(['diabetes'], '  ')).toEqual(['diabetes'])
  })
})

describe('saveOnboardingFocus', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('saves built-in focus keys', async () => {
    saveMock.mockResolvedValue(['hypertension', 'diabetes'])
    await expect(saveOnboardingFocus(['hypertension', 'diabetes'])).resolves.toBe(true)
    expect(addMock).not.toHaveBeenCalled()
    expect(saveMock).toHaveBeenCalledWith(['hypertension', 'diabetes'])
  })

  it('creates the custom focus first and saves it as custom:<id>', async () => {
    addMock.mockResolvedValue({ focuses: [{ id: 'f9', label: '控尿酸', created_at: '' }], focus_id: 'f9' })
    saveMock.mockResolvedValue(['weight', 'custom:f9'])
    await expect(saveOnboardingFocus(['weight'], '控尿酸')).resolves.toBe(true)
    expect(addMock).toHaveBeenCalledWith('控尿酸')
    expect(saveMock).toHaveBeenCalledWith(['weight', 'custom:f9'])
  })

  it('falls back to the focus list when focus_id is missing', async () => {
    addMock.mockResolvedValue({ focuses: [{ id: 'f3', label: '控尿酸', created_at: '' }], focus_id: '', already_exists: true })
    saveMock.mockResolvedValue(['custom:f3'])
    await saveOnboardingFocus([], '控尿酸')
    expect(saveMock).toHaveBeenCalledWith(['custom:f3'])
  })

  it('still saves the built-in keys when the custom focus fails', async () => {
    addMock.mockRejectedValue(new Error('关注方向包含不适当内容'))
    saveMock.mockResolvedValue(['cardio'])
    await expect(saveOnboardingFocus(['cardio'], 'xx')).resolves.toBe(true)
    expect(saveMock).toHaveBeenCalledWith(['cardio'])
  })

  it('never throws when saving fails', async () => {
    saveMock.mockRejectedValue(Object.assign(new Error('Not Found'), { statusCode: 404 }))
    await expect(saveOnboardingFocus(['cardio'])).resolves.toBe(false)
  })

  it('sends nothing when only a failed custom focus was chosen', async () => {
    addMock.mockRejectedValue(new Error('offline'))
    await expect(saveOnboardingFocus([], '控尿酸')).resolves.toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
  })
})
