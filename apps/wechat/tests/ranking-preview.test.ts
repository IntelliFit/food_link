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
    expect(result.food.status).toBe('fulfilled')
  })
})
