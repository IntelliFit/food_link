import Taro from '@tarojs/taro'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../../src/utils/home-dashboard-local-cache'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../src/utils/home-events'
import { syncHomeAfterFoodRecordSave } from '../../src/utils/home-refresh-after-save'

jest.mock('../../src/utils/home-dashboard-local-cache', () => ({ refreshHomeDashboardLocalSnapshotFromCloud: jest.fn() }))

const date = '2026-11-26'

describe('syncHomeAfterFoodRecordSave', () => {
  beforeEach(() => jest.clearAllMocks())

  it('marks home stale at once and redraws it only after the snapshot refresh lands', async () => {
    let finishRefresh: (value: boolean) => void = () => undefined
    ;(refreshHomeDashboardLocalSnapshotFromCloud as jest.Mock).mockReturnValue(
      new Promise<boolean>((resolve) => { finishRefresh = resolve })
    )

    const pending = syncHomeAfterFoodRecordSave(date)
    expect(Taro.eventCenter.trigger).toHaveBeenCalledTimes(1)
    expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(HOME_INTAKE_DATA_CHANGED_EVENT, { date })
    expect(refreshHomeDashboardLocalSnapshotFromCloud).toHaveBeenCalledWith(date)

    finishRefresh(true)
    await pending
    expect(Taro.eventCenter.trigger).toHaveBeenLastCalledWith(HOME_INTAKE_DATA_CHANGED_EVENT, { date, force: true })
  })

  it('still tells home to reload when the snapshot refresh fails', async () => {
    ;(refreshHomeDashboardLocalSnapshotFromCloud as jest.Mock).mockRejectedValue(new Error('offline'))

    await expect(syncHomeAfterFoodRecordSave(date)).resolves.toBeUndefined()
    expect(Taro.eventCenter.trigger).toHaveBeenLastCalledWith(HOME_INTAKE_DATA_CHANGED_EVENT, { date, force: true })
  })

  it('does not throw when nobody listens on the event center', async () => {
    ;(refreshHomeDashboardLocalSnapshotFromCloud as jest.Mock).mockResolvedValue(true)
    ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation(() => { throw new Error('no listener') })

    await expect(syncHomeAfterFoodRecordSave(date)).resolves.toBeUndefined()
    ;(Taro.eventCenter.trigger as jest.Mock).mockReset()
  })
})
