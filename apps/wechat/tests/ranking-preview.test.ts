import { settleRankingPreviewRequests } from '../src/pages/community/ranking-preview'

describe('settleRankingPreviewRequests', () => {
  it('keeps food data when the user ranking request fails', async () => {
    const result = await settleRankingPreviewRequests(
      Promise.reject(new Error('用户榜失败')),
      Promise.resolve({ list: [{ name: '金枪鱼', value: 29 }] })
    )

    expect(result.user?.status).toBe('rejected')
    expect(result.food.status).toBe('fulfilled')
    if (result.food.status === 'fulfilled') {
      expect(result.food.value.list).toHaveLength(1)
    }
  })

  it('loads the public food ranking without a user request', async () => {
    const result = await settleRankingPreviewRequests(
      null,
      Promise.resolve({ list: [{ name: '鸡胸肉', value: 31.02 }] })
    )

    expect(result.user).toBeNull()
    expect(result.contribution).toBeNull()
    expect(result.food.status).toBe('fulfilled')
  })

  it('keeps the other previews when the contribution ranking fails', async () => {
    const result = await settleRankingPreviewRequests(
      Promise.resolve({ list: [{ checkin_count: 24 }] }),
      Promise.resolve({ list: [{ name: '鸡胸肉', value: 31 }] }),
      Promise.reject(new Error('贡献榜失败')),
    )

    expect(result.user?.status).toBe('fulfilled')
    expect(result.food.status).toBe('fulfilled')
    expect(result.contribution?.status).toBe('rejected')
  })

  it('keeps the contribution preview when the food request fails', async () => {
    const result = await settleRankingPreviewRequests(
      Promise.resolve({ list: [] }),
      Promise.reject(new Error('营养榜失败')),
      Promise.resolve({ list: [{ contribution_count: 128 }] }),
    )

    expect(result.food.status).toBe('rejected')
    expect(result.contribution?.status).toBe('fulfilled')
    if (result.contribution?.status === 'fulfilled') {
      expect(result.contribution.value.list[0].contribution_count).toBe(128)
    }
  })
})
