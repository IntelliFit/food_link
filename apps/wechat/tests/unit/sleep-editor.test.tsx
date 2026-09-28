import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Taro from '@tarojs/taro'
import SleepRecordPage from '../../src/packageExtra/pages/sleep-record/index'
import { getAccessToken } from '../../src/utils/api'
import { getSleepRecord, saveSleepRecord, deleteSleepRecord } from '../../src/utils/sleep-record'

jest.mock('../../src/utils/withAuth', () => ({ withAuth: (Component: unknown) => Component }))
jest.mock('../../src/utils/api', () => ({ getAccessToken: jest.fn(), showUnifiedApiError: jest.fn() }))
jest.mock('../../src/utils/sleep-record', () => ({ ...jest.requireActual('../../src/utils/sleep-record'), getSleepRecord: jest.fn(), saveSleepRecord: jest.fn(), deleteSleepRecord: jest.fn() }))

describe('sleep editor', () => {
  const record = { id: 'sleep-one', date: '2026-09-26', bedtime: '2026-09-25T23:30:00+08:00', wake_time: '2026-09-26T07:00:00+08:00', quality: 'good', note: '原有备注', source: 'manual', duration_minutes: 450 }
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Taro.useRouter as jest.Mock).mockReturnValue({ params: { date: record.date } })
    ;(getAccessToken as jest.Mock).mockReturnValue('account-token')
    ;(getSleepRecord as jest.Mock).mockResolvedValue(record)
    ;(saveSleepRecord as jest.Mock).mockResolvedValue(record)
    ;(deleteSleepRecord as jest.Mock).mockResolvedValue(undefined)
  })
  it('loads the saved period and updates quality without replacing its times', async () => {
    render(<SleepRecordPage />)
    await screen.findByText('入睡到起床约 7小时30分')
    fireEvent.click(screen.getByText('差'))
    fireEvent.click(screen.getByText('保存记录'))
    await waitFor(() => expect(saveSleepRecord).toHaveBeenCalledWith('2026-09-26', { bedtime: record.bedtime, wake_time: record.wake_time, quality: 'poor', note: '原有备注' }))
    expect(Taro.eventCenter.trigger).toHaveBeenCalledWith('sleep-record-changed')
  })
  it('does not offer saving when existing data failed to load', async () => {
    ;(getSleepRecord as jest.Mock).mockRejectedValueOnce(new Error('offline'))
    render(<SleepRecordPage />)
    await screen.findByText('记录未能读取，点此重试')
    expect(screen.queryByText('保存记录')).toBeNull()
    expect(saveSleepRecord).not.toHaveBeenCalled()
  })
  it('requires confirmation and deletes only the selected day', async () => {
    ;(Taro.showModal as jest.Mock).mockResolvedValueOnce({ confirm: false }).mockResolvedValueOnce({ confirm: true })
    render(<SleepRecordPage />)
    fireEvent.click(await screen.findByText('删除这天的记录'))
    await waitFor(() => expect(screen.getByText('删除这天的记录')).not.toBeDisabled())
    expect(deleteSleepRecord).not.toHaveBeenCalled()
    ;(getSleepRecord as jest.Mock).mockResolvedValueOnce(null)
    fireEvent.click(screen.getByText('删除这天的记录'))
    await waitFor(() => expect(deleteSleepRecord).toHaveBeenCalledWith(record.date))
    await waitFor(() => expect(screen.queryByText('删除这天的记录')).toBeNull())
  })
})
