import { act, render, screen } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import InteractionNotificationsPage from '../../src/packageExtra/pages/interaction-notifications/index'
import {
  communityGetNotifications,
  communityMarkNotificationsRead,
  showUnifiedApiError,
} from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/utils/api', () => ({
  communityGetNotifications: jest.fn(),
  communityMarkNotificationsRead: jest.fn(),
  showUnifiedApiError: jest.fn(),
}))

describe('interaction notifications loading state', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(Taro.useDidShow as jest.Mock)
      .mockImplementationOnce((callback) => callback())
      .mockImplementation(() => {})
    ;(showUnifiedApiError as jest.Mock).mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    jest.useRealTimers()
  })

  it('shows notifications without waiting for the automatic mark-read request', async () => {
    ;(communityGetNotifications as jest.Mock).mockResolvedValue({
      list: Array.from({ length: 20 }, (_, index) => ({
        id: `notification-${index}`,
        notification_type: 'comment_received',
        target_type: 'food_record',
        target_id: `record-${index}`,
        content_preview: `评论内容 ${index + 1}`,
        is_read: false,
        created_at: '2026-08-12T02:00:00+08:00',
        actor: { id: `user-${index}`, nickname: `用户${index + 1}`, avatar: '' },
      })),
      unread_count: 20,
      has_more: false,
    })
    ;(communityMarkNotificationsRead as jest.Mock).mockReturnValue(new Promise(() => {}))

    render(<InteractionNotificationsPage />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('20')).toBeInTheDocument()
    expect(document.querySelector('.loading-spinner-md')).not.toBeInTheDocument()
    expect(screen.getByText('评论内容 1')).toBeInTheDocument()
  })

  it('replaces the spinner with a retry state when the list request times out', async () => {
    ;(communityGetNotifications as jest.Mock)
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({
        list: [{
          id: 'notification-retry',
          notification_type: 'comment_received',
          target_type: 'food_record',
          target_id: 'record-retry',
          content_preview: '重试后加载成功',
          is_read: true,
          created_at: '2026-08-12T02:00:00+08:00',
          actor: { id: 'user-retry', nickname: '用户', avatar: '' },
        }],
        unread_count: 0,
        has_more: false,
      })

    render(<InteractionNotificationsPage />)

    await act(async () => {
      jest.advanceTimersByTime(12_000)
      await Promise.resolve()
    })

    expect(document.querySelector('.loading-spinner-md')).not.toBeInTheDocument()
    expect(screen.getByText('互动消息加载失败')).toBeInTheDocument()

    await act(async () => {
      screen.getByText('重新加载').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(communityGetNotifications).toHaveBeenCalledTimes(2)
    expect(screen.getByText('重试后加载成功')).toBeInTheDocument()
  })
})
