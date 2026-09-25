import { fireEvent, render, screen } from '@testing-library/react'
import { InkHomeHero, InkShelfEntry, InkStatsOverview } from '../../src/components/InkWellness'

jest.mock('../../src/assets/ink-wellness/landscape.jpg', () => 'landscape.jpg')
jest.mock('../../src/assets/ink-wellness/header.jpg', () => 'header.jpg')
jest.mock('../../src/assets/ink-wellness/score.jpg', () => 'score.jpg')
jest.mock('../../src/assets/ink-wellness/taiji.jpg', () => 'taiji.jpg')
jest.mock('../../src/assets/ink-wellness/bookshelf.jpg', () => 'bookshelf.jpg')

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('missing intake stays unknown; known zero is not treated as missing', () => {
  const toggle = jest.fn()
  const { rerender } = render(<InkHomeHero onModeToggle={toggle} />)
  expect(screen.getAllByText('—')).toHaveLength(2)
  rerender(<InkHomeHero current={0} target={1800} onModeToggle={toggle} />)
  expect(screen.getByText('0')).toBeInTheDocument()
  expect(screen.getByText('1,800')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '养生模式，点击切换均衡' }))
  expect(toggle).toHaveBeenCalledTimes(1)
})

test('over-target intake keeps its meaning and opens the existing target editor', () => {
  const target = jest.fn()
  render(<InkHomeHero current={2100} target={1800} onModeToggle={jest.fn()} onTarget={target} />)
  expect(screen.getByText('超出目标 · 千卡')).toBeInTheDocument()
  expect(screen.getByText('300')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看和修改饮食目标' }))
  expect(target).toHaveBeenCalledTimes(1)
})

test('analysis uses supplied data, labels samples and routes to existing details', () => {
  const plan = jest.fn(); const structure = jest.fn(); const factor = jest.fn()
  const { unmount } = render(<InkStatsOverview score={74} label='示例状态' preview factors={[{ key: 'fiber', title: '膳食纤维', score: 63 }]} days={[]} advice='添一份蔬菜' meals={[{ label: '早餐', value: 100 }, { label: '午餐', value: 200 }, { label: '晚餐', value: 100 }]} onPlan={plan} onStructure={structure} onFactor={factor} />)
  expect(screen.getByText('74')).toBeInTheDocument()
  expect(screen.getByText('示例数据')).toBeInTheDocument()
  expect(screen.getAllByText('25%')).toHaveLength(2)
  expect(screen.getByText('50%')).toBeInTheDocument()
  fireEvent.click(screen.getByText('查看方案 →'))
  fireEvent.click(screen.getByText('查看详情 ›'))
  fireEvent.click(screen.getByText('膳食纤维'))
  expect(plan).toHaveBeenCalledTimes(1)
  expect(structure).toHaveBeenCalledTimes(1)
  expect(factor).toHaveBeenCalledWith('fiber')
  unmount()
  expect(jest.getTimerCount()).toBe(0)
})

test('the illustrated bookshelf remains an operable archive entrance', () => {
  const open = jest.fn()
  render(<InkShelfEntry onOpen={open} />)
  fireEvent.click(screen.getByRole('button', { name: '打开食探书架，查看周报月报年报' }))
  expect(open).toHaveBeenCalledTimes(1)
})
