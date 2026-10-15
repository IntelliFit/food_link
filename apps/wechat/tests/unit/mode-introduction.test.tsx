import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Taro, { useDidShow } from '@tarojs/taro'
import { ModeIntroduction } from '../../src/components/ModeIntroduction'
import { ModeIntroductionGate } from '../../src/components/ModeIntroductionGate'
import { MODE_INTRODUCTION_PREFIX } from '../../src/utils/mode-introduction'

jest.mock('@tarojs/components', () => {
  const React = require('react')
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Button: ({ children, ...props }: any) => React.createElement('button', props, children),
    PageMeta: () => null,
    ScrollView: ({ children }: any) => React.createElement('div', {}, children),
    SwiperItem: ({ children }: any) => React.createElement('div', {}, children),
    Swiper: ({ children, current }: any) => React.createElement('div', {}, React.Children.toArray(children)[current]),
  }
})

let store: Record<string, any>
const shows = new Set<() => void>(), listeners = new Map<string, Set<() => void>>()
beforeEach(() => {
  jest.clearAllMocks(); shows.clear(); listeners.clear()
  store = { user_id: 'a', access_token: 'token-a' }
  ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => store[key])
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => { store[key] = value })
  ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => { delete store[key] })
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'packageExtra/pages/reward-center/index', options: { from: '首页&我的', date: '2026-10-15' } }])
  ;(Taro.reLaunch as jest.Mock).mockResolvedValue(undefined)
  ;(Taro.eventCenter.on as jest.Mock).mockImplementation((name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name)!.add(fn)
  })
  ;(Taro.eventCenter.off as jest.Mock).mockImplementation((name, fn) => listeners.get(name)?.delete(fn))
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation(name => listeners.get(name)?.forEach(fn => fn()))
  ;(useDidShow as jest.Mock).mockImplementation(fn => React.useEffect(() => { shows.add(fn); return () => { shows.delete(fn) } }, [fn]))
})
const next = () => fireEvent.click(document.querySelector('#mode-introduction-next')!)

test('each mode gets a detailed introduction; final confirmation requires an explicit choice and commits once', async () => {
  const save = jest.fn(() => true)
  render(<ModeIntroduction onConfirm={save} />)
  expect(screen.getByText('八种主题，同一份记录')).toBeInTheDocument()
  expect(screen.getByText(/喜欢明确数字与目标/)).toBeInTheDocument()
  next()
  expect(screen.getByText('纸墨之间，记录一餐一饮')).toBeInTheDocument()
  expect(screen.getByText(/喜欢东方审美/)).toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
  next()
  expect(screen.getByRole('button', { name: '设为默认，开始记录' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '选择养生模式' }))
  expect(save).not.toHaveBeenCalled()
  await act(async () => { next(); next() })
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith('wellness')
})

test('failed persistence keeps the choice screen visible and allows retry', async () => {
  const save = jest.fn().mockReturnValueOnce(false).mockReturnValue(true)
  render(<ModeIntroduction onConfirm={save} />)
  next(); next()
  fireEvent.click(screen.getByRole('button', { name: '选择均衡模式' }))
  await act(async () => { next() })
  expect(screen.getByRole('alert')).toHaveTextContent('未能保存')
  await act(async () => { next() })
  expect(save).toHaveBeenCalledTimes(2)
})

test('resumed choice reopens the original route and query before business hooks mount for native onShow', async () => {
  let finishNavigation!: () => void
  ;(Taro.reLaunch as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finishNavigation = resolve }))
  const mounted = jest.fn()
  function Content() { React.useEffect(mounted, []); return <span>已有首页</span> }
  const first = render(<ModeIntroductionGate><Content /></ModeIntroductionGate>)
  expect(mounted).not.toHaveBeenCalled()
  next(); next()
  fireEvent.click(screen.getByRole('button', { name: '选择均衡模式' }))
  await act(async () => { next() })
  expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/packageExtra/pages/reward-center/index?from=%E9%A6%96%E9%A1%B5%26%E6%88%91%E7%9A%84&date=2026-10-15' })
  expect(mounted).not.toHaveBeenCalled()
  act(() => { [...shows].forEach(fn => fn()) })
  expect(mounted).not.toHaveBeenCalled()
  await act(async () => { finishNavigation() })
  expect(mounted).not.toHaveBeenCalled()
  first.unmount()
  render(<ModeIntroductionGate><Content /></ModeIntroductionGate>)
  expect(document.querySelector('#mode-introduction')).toBeNull()
  expect(mounted).toHaveBeenCalledTimes(1)
})

test('failed page reopening keeps business content gated and retries without losing the saved choice', async () => {
  ;(Taro.reLaunch as jest.Mock).mockRejectedValueOnce(new Error('navigation failed'))
  render(<ModeIntroductionGate><span>业务页面</span></ModeIntroductionGate>)
  next(); next(); fireEvent.click(screen.getByRole('button', { name: '选择养生模式' }))
  await act(async () => { next() })
  expect(screen.getByRole('alert')).toHaveTextContent('已保存，但页面未能打开')
  expect(store['home_experience_config_v2:a'].mode).toBe('wellness')
  act(() => { [...shows].forEach(fn => fn()) })
  expect(screen.queryByText('业务页面')).not.toBeInTheDocument()
  await act(async () => { next() })
  expect(Taro.reLaunch).toHaveBeenCalledTimes(2)
})

test('completion in another gate does not late-mount a hidden pending page; only its own next show reopens it', async () => {
  const previous = render(<ModeIntroductionGate><span>下层任务页面</span></ModeIntroductionGate>)
  const current = render(<ModeIntroductionGate><span>当前业务页面</span></ModeIntroductionGate>)
  ;(Taro.reLaunch as jest.Mock).mockRejectedValueOnce(new Error('navigation failed'))
  const currentNext = () => fireEvent.click(current.container.querySelector('#mode-introduction-next')!)
  currentNext(); currentNext()
  fireEvent.click(current.container.querySelector('#mode-introduction-wellness')!)
  await act(async () => { currentNext() })
  expect(previous.container.querySelector('#mode-introduction')).toBeInTheDocument()
  expect(screen.queryByText('下层任务页面')).not.toBeInTheDocument()
  expect(Taro.reLaunch).toHaveBeenCalledTimes(1)
  current.unmount()
  ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'packageExtra/pages/precision-confirm/index', options: { task_id: '123' } }])
  await act(async () => { [...shows].forEach(fn => fn()) })
  expect(Taro.reLaunch).toHaveBeenLastCalledWith({ url: '/packageExtra/pages/precision-confirm/index?task_id=123' })
  expect(screen.queryByText('下层任务页面')).not.toBeInTheDocument()
})

test.each(['renewed-token', 'completed-account'])('a previously blocked page still needs fresh lifecycle after %s', async change => {
  ;(Taro.reLaunch as jest.Mock).mockRejectedValueOnce(new Error('navigation failed'))
  render(<ModeIntroductionGate><span>仅原生初始化后显示</span></ModeIntroductionGate>)
  next(); next(); fireEvent.click(screen.getByRole('button', { name: '选择均衡模式' }))
  await act(async () => { next() })
  store.access_token = 'renewed-session'
  if (change === 'completed-account') {
    store.user_id = 'b'
    store[`${MODE_INTRODUCTION_PREFIX}b`] = { version: 1, completed: true }
    store['home_experience_config_v2:b'] = { version: 2, mode: 'wellness' }
  }
  act(() => { listeners.forEach(callbacks => callbacks.forEach(fn => fn())) })
  expect(screen.queryByText('仅原生初始化后显示')).not.toBeInTheDocument()
  expect(Taro.reLaunch).toHaveBeenCalledTimes(1)
  await act(async () => { [...shows].forEach(fn => fn()) })
  expect(Taro.reLaunch).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('仅原生初始化后显示')).not.toBeInTheDocument()
})

test('guest entry is untouched; changing to a fresh account on show resumes its own introduction', () => {
  delete store.access_token
  render(<ModeIntroductionGate><span>访客首页</span></ModeIntroductionGate>)
  expect(screen.getByText('访客首页')).toBeInTheDocument()
  store.user_id = 'b'; store.access_token = 'token-b'
  act(() => { [...shows].forEach(fn => fn()) })
  expect(document.querySelector('#mode-introduction')).toBeInTheDocument()
  expect(screen.queryByText('访客首页')).not.toBeInTheDocument()
})

test('login continuation runs once after choice, with completion stored before the next auth gate', async () => {
  const complete = jest.fn(() => { expect(store[`${MODE_INTRODUCTION_PREFIX}a`]?.completed).toBe(true) })
  render(<ModeIntroductionGate onCompleted={complete} />)
  next(); next(); fireEvent.click(screen.getByRole('button', { name: '选择养生模式' }))
  await act(async () => { next() })
  act(() => { [...shows].forEach(fn => fn()) })
  expect(complete).toHaveBeenCalledTimes(1)
  expect(Taro.reLaunch).not.toHaveBeenCalled()
})
