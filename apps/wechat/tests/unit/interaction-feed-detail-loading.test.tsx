import { act, render } from '@testing-library/react'
import Taro from '@tarojs/taro'

import { InteractionFeedDetailPage } from '../../src/packageExtra/pages/interaction-feed-detail'
import {
  communityGetComments,
  communityGetFeedContext,
  type CommunityFeedItem,
} from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: unknown) => Component,
  redirectToLogin: jest.fn(),
}))

jest.mock('../../src/utils/api', () => ({
  communityGetComments: jest.fn(),
  communityGetFeedContext: jest.fn(),
  communityLike: jest.fn(),
  communityPostComment: jest.fn(),
  communityUnlike: jest.fn(),
  deleteCirclePost: jest.fn(),
  deleteExerciseLog: jest.fn(),
  deleteFoodRecord: jest.fn(),
  deletePublicFoodLibraryItem: jest.fn(),
  getAccessToken: jest.fn(() => 'test-token'),
  showUnifiedApiError: jest.fn(),
}))

jest.mock('../../src/pages/community/components/CommunityFoodRecordEditSheet', () => ({
  CommunityFoodRecordEditSheet: () => null,
}))
jest.mock('../../src/pages/community/components/FeedActionSheet', () => ({
  FeedActionSheet: () => null,
}))
jest.mock('../../src/pages/community/components/FeedReportMask', () => ({
  FeedReportMask: () => null,
}))
jest.mock('../../src/pages/community/components/FeedReportSheet', () => ({
  FeedReportSheet: () => null,
}))
jest.mock('../../src/pages/community/components/ManualFoodCards', () => ({
  ManualFoodCards: () => null,
}))
jest.mock('../../src/pages/community/components/ExerciseActivityCards', () => ({
  ExerciseActivityCards: () => null,
  hasExerciseActivityCards: () => false,
}))

const feedItem = {
  target_type: 'food_record',
  target_id: 'record-1',
  record: {
    id: 'record-1',
    user_id: 'user-1',
    meal_type: 'dinner',
    description: '烤脆骨肉筋串',
    record_time: '2026-08-13T19:00:00+08:00',
    total_calories: 410,
    total_protein: 57,
    total_carbs: 0,
    total_fat: 20,
    total_weight_grams: 200,
    created_at: '2026-08-13T19:00:00+08:00',
    items: [],
  },
  author: { id: 'user-1', nickname: '魔法猫咪', avatar: '' },
  like_count: 2,
  liked: false,
  comments: [{
    id: 'comment-1',
    user_id: 'user-2',
    content: '看着真香',
    created_at: '2026-08-13T19:30:00+08:00',
    nickname: '快车奥斯卡',
    avatar: '',
  }],
  comment_count: 1,
} as CommunityFeedItem

describe('InteractionFeedDetailPage loading', () => {
  let loadPage: ((options: Record<string, string>) => void) | undefined

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    loadPage = undefined
    ;(Taro.useLoad as jest.Mock).mockImplementation((callback) => {
      loadPage = callback
    })
    ;(Taro.useDidShow as jest.Mock).mockImplementation(() => {})
    ;(communityGetFeedContext as jest.Mock).mockResolvedValue({ item: feedItem })
    ;(communityGetComments as jest.Mock).mockImplementation(() => new Promise(() => {}))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows the feed after context resolves without waiting for the full comments request', async () => {
    const view = render(<InteractionFeedDetailPage />)

    expect(view.container.querySelector('.interaction-feed-detail-loading-spinner')).toBeInTheDocument()

    await act(async () => {
      loadPage?.({ targetType: 'food_record', targetId: 'record-1', recordId: 'record-1' })
      await Promise.resolve()
    })

    expect(view.container.querySelector('.interaction-feed-detail-loading-spinner')).not.toBeInTheDocument()
    expect(view.container.querySelector('.interaction-feed-detail-content-pending')).toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(80)
      await Promise.resolve()
    })

    expect(view.getByText('烤脆骨肉筋串')).toBeInTheDocument()
    expect(communityGetComments).toHaveBeenCalledWith('record-1', 'food_record')
    expect(view.container.querySelector('.interaction-feed-detail-loading-spinner')).not.toBeInTheDocument()
  })
})
