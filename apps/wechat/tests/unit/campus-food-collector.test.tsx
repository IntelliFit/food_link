import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Taro from '@tarojs/taro'
import CampusFoodCollectorPage from '../../src/packageExtra/pages/campus-food-collector/index'
import { getCampusCollectorProfile, showUnifiedApiError, uploadCampusFoodImageFile } from '../../src/utils/api'
import { chooseImageWithPrivacy } from '../../src/utils/weapp-privacy'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: any) => Component }))
jest.mock('../../src/components/AppColorSchemeContext', () => ({ useAppColorScheme: () => ({ scheme: 'light' }) }))
jest.mock('../../src/utils/theme-navigation-bar', () => ({ applyThemeNavigationBar: jest.fn() }))
jest.mock('../../src/components/SchoolPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CampusPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/CanteenPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/components/FloorPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('../../src/utils/weapp-privacy', () => ({
  chooseImageWithPrivacy: jest.fn(), isPrivacyAuthorizeError: jest.fn(() => false), showPrivacyAuthorizeFailure: jest.fn(),
}))
jest.mock('../../src/utils/api', () => ({
  applyCampusCollector: jest.fn(), createCampusCollectorBatch: jest.fn(), getCampusCollectorProfile: jest.fn(),
  getCanteenFloors: jest.fn(), showUnifiedApiError: jest.fn(), uploadCampusFoodImageFile: jest.fn(),
}))

describe('campus collector channel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useDidShow as jest.Mock).mockImplementation(callback => callback())
  })

  it('shows a school-scoped application instead of exposing Admin', async () => {
    ;(getCampusCollectorProfile as jest.Mock).mockResolvedValue({ applications: [], active_scopes: [], can_batch: false })
    render(<CampusFoodCollectorPage />)
    await waitFor(() => expect(screen.getByText('申请批量采集通道')).toBeInTheDocument())
    expect(screen.getByText('普通用户已经可以单菜上传；批量通道需按学校授权，不能访问后台其他数据。')).toBeInTheDocument()
  })

  it('shows shared location and multi-photo collection after approval', async () => {
    ;(getCampusCollectorProfile as jest.Mock).mockResolvedValue({
      applications: [{ id: 'app-1', status: 'approved', school_id: 'school-1' }],
      active_scopes: [{ id: 'scope-1', status: 'active', school_id: 'school-1', school_name: '示例大学' }],
      can_batch: true,
    })
    render(<CampusFoodCollectorPage />)
    await waitFor(() => expect(screen.getByText('已授权批量通道')).toBeInTheDocument())
    expect(screen.getByText('连续拍照 / 多选')).toBeInTheDocument()
    expect(screen.getByText('批量立即发布')).toBeInTheDocument()
    expect(screen.getByText('示例大学')).toBeInTheDocument()
  })

  it('keeps successfully uploaded photos when another photo fails', async () => {
    ;(getCampusCollectorProfile as jest.Mock).mockResolvedValue({
      applications: [],
      active_scopes: [{
        id: 'scope-1', status: 'active', school_id: 'school-1', school_name: '示例大学',
        campus_id: 'campus-1', campus_name: '主校区', canteen_id: 'canteen-1', canteen_name: '第一食堂',
      }],
      can_batch: true,
    })
    ;(chooseImageWithPrivacy as jest.Mock).mockResolvedValue({ tempFilePaths: ['ok.jpg', 'failed.jpg'] })
    ;(uploadCampusFoodImageFile as jest.Mock)
      .mockResolvedValueOnce({ imageUrl: 'campus-food/users/u1/ok.jpg' })
      .mockRejectedValueOnce(new Error('网络中断'))

    render(<CampusFoodCollectorPage />)
    await waitFor(() => expect(screen.getByText('连续拍照 / 多选')).toBeInTheDocument())
    fireEvent.click(screen.getByText('连续拍照 / 多选'))

    await waitFor(() => expect(uploadCampusFoodImageFile).toHaveBeenCalledTimes(2))
    expect(screen.getByPlaceholderText('第 1 道菜名称 *')).toBeInTheDocument()
    expect(showUnifiedApiError).toHaveBeenCalledWith(expect.any(Error), '部分照片上传失败，已保留成功项')
  })
})
