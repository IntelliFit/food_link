import { act, fireEvent, render } from '@testing-library/react'
import Taro from '@tarojs/taro'
import { WaitingPetCompanion } from '../../src/packageExtra/pages/analyze-loading/WaitingPetCompanion'
import { PET_FULL_LINE, PET_MAX_SNACKS } from '../../src/packageExtra/pages/analyze-loading/waiting-pet'
import { getPetSummary } from '../../src/utils/api'

jest.mock('../../src/utils/api', () => ({ getPetSummary: jest.fn() }))
jest.mock('../../src/components/PetAvatar', () => ({ PetAvatar: () => <div /> }))

const props = {
  elapsedSeconds: 0,
  taskType: 'food',
  isCorrection: false,
  isPrecision: false,
  recognitionReady: false,
  tip: '慢慢吃，细细嚼。',
}

describe('waiting pet interaction', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    jest.spyOn(Math, 'random').mockReturnValue(0)
    ;(Taro.getStorageSync as jest.Mock).mockReturnValue('')
    ;(getPetSummary as jest.Mock).mockResolvedValue({ pet: { name: '小麦' }, status: {} })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('replaces the food actually tapped while keeping four distinct choices', async () => {
    const view = render(<WaitingPetCompanion {...props} />)
    await act(async () => { await Promise.resolve() })
    const before = view.getAllByRole('button', { name: /^喂/ })
    const eaten = before[0].getAttribute('aria-label')
    fireEvent.click(before[0])
    const after = view.getAllByRole('button', { name: /^喂/ })
    const names = after.map(button => button.getAttribute('aria-label'))
    expect(after).toHaveLength(4)
    expect(new Set(names).size).toBe(4)
    expect(names).not.toContain(eaten)
    expect(view.container.querySelectorAll('.waiting-pet__floater')).toHaveLength(1)
  })

  it('stops eating after five foods and keeps the full reaction without adding animations', async () => {
    const view = render(<WaitingPetCompanion {...props} />)
    await act(async () => { await Promise.resolve() })
    for (let i = 0; i < PET_MAX_SNACKS; i += 1) fireEvent.click(view.getAllByRole('button', { name: /^喂/ })[0])
    expect(view.getByText('吃饱啦')).toBeInTheDocument()
    const fullTray = view.getAllByRole('button', { name: /^喂/ }).map(button => button.getAttribute('aria-label'))
    fireEvent.click(view.getAllByRole('button', { name: /^喂/ })[0])
    expect(view.getByText(PET_FULL_LINE)).toBeInTheDocument()
    expect(view.container.querySelectorAll('.waiting-pet__floater')).toHaveLength(PET_MAX_SNACKS)
    expect(view.getAllByRole('button', { name: /^喂/ }).map(button => button.getAttribute('aria-label'))).toEqual(fullTray)
  })

  it('bounds repeated tap animations and releases timers on unmount', async () => {
    const view = render(<WaitingPetCompanion {...props} />)
    await act(async () => { await Promise.resolve() })
    for (let i = 0; i < 30; i += 1) fireEvent.click(view.getByRole('button', { name: '摸摸小麦' }))
    expect(view.container.querySelectorAll('.waiting-pet__floater')).toHaveLength(6)
    expect(jest.getTimerCount()).toBeLessThanOrEqual(9)
    await act(async () => { jest.advanceTimersByTime(900) })
    expect(view.container.querySelectorAll('.waiting-pet__floater')).toHaveLength(0)
    view.unmount()
    expect(jest.getTimerCount()).toBe(0)
  })
})
