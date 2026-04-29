import { withAuth } from '../../../utils/withAuth'
import { View, Text, ScrollView, Image } from '@tarojs/components'
import { useCallback, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { communityGetCheckinLeaderboard, getAccessToken, type CheckinLeaderboardItem } from '../../../utils/api'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

function CheckinLeaderboardPage() {
  const [list, setList] = useState<CheckinLeaderboardItem[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [weekEnd, setWeekEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setError('请先登录')
      setLoading(false)
      setList([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await communityGetCheckinLeaderboard()
      setWeekStart(res.week_start)
      setWeekEnd(res.week_end)
      setList(res.list || [])
    } catch (e: unknown) {
      setError((e as Error).message || '加载失败')
      setList([])
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    load()
  })

  const rankClass = (rank: number) => {
    if (rank === 1) return 'checkin-lb-rank top1'
    if (rank === 2) return 'checkin-lb-rank top2'
    if (rank === 3) return 'checkin-lb-rank top3'
    return 'checkin-lb-rank'
  }

  return (
    <View className='checkin-lb-page'>
      <View className='checkin-lb-header'>
        <Text className='checkin-lb-title'>好友本周打卡</Text>
        {weekStart && weekEnd ? (
          <Text className='checkin-lb-range'>
            统计周期 {weekStart} ~ {weekEnd}（北京时间）
          </Text>
        ) : null}
      </View>

      {loading ? (
        <View className='checkin-lb-state'><View className='loading-spinner-md' /></View>
      ) : error ? (
        <View className='checkin-lb-state'>
          <Text>{error}</Text>
          {error === '请先登录' ? (
            <View
              className='checkin-lb-retry'
              onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/login/index') })}
            >
              去登录
            </View>
          ) : (
            <View className='checkin-lb-retry' onClick={() => load()}>
              重试
            </View>
          )}
        </View>
      ) : list.length === 0 ? (
        <View className='checkin-lb-state'>暂无数据</View>
      ) : (
        <ScrollView scrollY className='checkin-lb-scroll' enhanced showScrollbar={false}>
          <View className='checkin-lb-list'>
            {list.map((row) => (
              <View
                key={row.user_id}
                className={`checkin-lb-row${row.is_me ? ' is-me' : ''}`}
              >
                <Text className={rankClass(row.rank)}>{row.rank}</Text>
                <View className='checkin-lb-avatar-wrap'>
                  {row.avatar ? (
                    <Image className='checkin-lb-avatar' src={row.avatar} mode='aspectFill' />
                  ) : (
                    <View className='checkin-lb-avatar-ph'>
                      <Text>👤</Text>
                    </View>
                  )}
                </View>
                <View className='checkin-lb-mid'>
                  <View className='checkin-lb-name-row'>
                    <Text className='checkin-lb-name' numberOfLines={1}>
                      {row.nickname}
                    </Text>
                    {row.is_me ? <Text className='checkin-lb-me-tag'>我</Text> : null}
                  </View>
                </View>
                <View className='checkin-lb-count'>
                  <Text className='checkin-lb-count-num'>{row.checkin_count}</Text>
                  <Text className='checkin-lb-count-unit'>次打卡</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

export default withAuth(CheckinLeaderboardPage)
