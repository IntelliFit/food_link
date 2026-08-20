import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import FoodLibrarySharePage from '../../src/packageExtra/pages/food-library-share/index'
import { getFoodRecordList, getMyMembership } from '../../src/utils/api'

jest.mock('../../src/utils/withAuth', () => ({
  withAuth: (Component: any) => Component,
}))

jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))

jest.mock('../../src/components/SchoolPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CampusPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CanteenPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CampusMembershipGate', () => ({ __esModule: true, default: () => null }))

jest.mock('@taroify/core', () => ({
  Popup: ({ children }: any) => children,
  AreaPicker: () => null,
}))
jest.mock('@taroify/core/popup/style', () => ({}))
jest.mock('@taroify/core/picker/style', () => ({}))

jest.mock('../../src/utils/api', () => ({
  analyzeFoodImage: jest.fn(),
  createPublicFoodLibraryItem: jest.fn(),
  getFoodRecordById: jest.fn(),
  getFoodRecordList: jest.fn(),
  getMyMembership: jest.fn(),
  getPublicFoodLibraryItem: jest.fn(),
  imageToBase64: jest.fn(),
  resolveCurrentGeoContext: jest.fn(),
  showUnifiedApiError: jest.fn(),
  updatePublicFoodLibraryItem: jest.fn(),
  uploadAnalyzeImage: jest.fn(),
}))

describe('public food location selection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const taroRuntime = (Taro as any).default ?? Taro
    taroRuntime.getCurrentInstance = jest.fn(() => ({ router: { params: {} } }))
    taroRuntime.chooseLocation = jest.fn().mockResolvedValue({
      name: '北京饭店',
      address: '北京市东城区东长安街33号',
      latitude: 39.9097,
      longitude: 116.4174,
    })
    ;(getFoodRecordList as jest.Mock).mockResolvedValue({ records: [] })
    ;(getMyMembership as jest.Mock).mockResolvedValue({ is_pro: false })
  })

  it('uses the native WeChat location picker and applies its address', async () => {
    render(<FoodLibrarySharePage />)

    fireEvent.click(await screen.findByText('搜索地址'))

    const taroRuntime = (Taro as any).default ?? Taro
    await waitFor(() => expect(taroRuntime.chooseLocation).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('北京市 东城区')).toBeInTheDocument()
    expect(screen.getByDisplayValue('东长安街33号 北京饭店')).toBeInTheDocument()
    expect(Taro.navigateTo).not.toHaveBeenCalled()
  })
})
