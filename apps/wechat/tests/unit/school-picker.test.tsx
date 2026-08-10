import { render, screen, waitFor } from '@testing-library/react'
import SchoolPicker from '../../src/components/SchoolPicker'
import {
  getSchoolProvinces,
  getUserLocation,
  searchSchools,
} from '../../src/utils/api'

jest.mock('../../src/components/AppColorSchemeContext', () => ({
  useAppColorScheme: () => ({ scheme: 'light' }),
}))

jest.mock('../../src/utils/api', () => ({
  getSchoolProvinces: jest.fn(),
  getUserLocation: jest.fn(),
  searchSchools: jest.fn(),
}))

describe('SchoolPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getSchoolProvinces as jest.Mock).mockResolvedValue([])
    ;(getUserLocation as jest.Mock).mockResolvedValue({})
    ;(searchSchools as jest.Mock).mockResolvedValue([])
  })

  it('only exposes and requests university schools', async () => {
    render(
      <SchoolPicker
        visible
        onSelect={jest.fn()}
        onCancel={jest.fn()}
      />,
    )

    expect(screen.getByText('选择学校')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索学校名称')).toBeInTheDocument()
    expect(screen.queryByText('公司')).not.toBeInTheDocument()
    expect(screen.queryByText('社区')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(getSchoolProvinces).toHaveBeenCalledWith('university')
      expect(searchSchools).toHaveBeenCalledWith('', undefined, 50, 'university')
    })
  })
})
