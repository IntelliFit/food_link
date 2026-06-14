const mockGetStorageSync = jest.fn()
const mockGetAccessToken = jest.fn()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: (...args: unknown[]) => mockGetStorageSync(...args),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn(),
  },
}))

jest.mock('../../src/utils/api', () => ({
  getAccessToken: () => mockGetAccessToken(),
}))

import {
  ONBOARDING_ANALYZE_PREP_GUIDE_KEY,
  ONBOARDING_HOME_RECORD_GUIDE_KEY,
  shouldOfferOnboardingGuide,
} from '../../src/utils/onboarding-guide-storage'

describe('shouldOfferOnboardingGuide', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetStorageSync.mockReturnValue(undefined)
  })

  it('未登录时不展示引导', () => {
    mockGetAccessToken.mockReturnValue(null)
    expect(shouldOfferOnboardingGuide(ONBOARDING_HOME_RECORD_GUIDE_KEY)).toBe(false)
    expect(shouldOfferOnboardingGuide(ONBOARDING_ANALYZE_PREP_GUIDE_KEY)).toBe(false)
  })

  it('已登录且未完成引导时应展示', () => {
    mockGetAccessToken.mockReturnValue('token-abc')
    mockGetStorageSync.mockReturnValue(undefined)
    expect(shouldOfferOnboardingGuide(ONBOARDING_HOME_RECORD_GUIDE_KEY)).toBe(true)
  })

  it('已登录但已完成引导时不展示', () => {
    mockGetAccessToken.mockReturnValue('token-abc')
    mockGetStorageSync.mockReturnValue(true)
    expect(shouldOfferOnboardingGuide(ONBOARDING_ANALYZE_PREP_GUIDE_KEY)).toBe(false)
  })
})
