import { withAuth } from '../../../utils/withAuth'
import { View, Text, ScrollView, Image } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  communityGetCheckinLeaderboard,
  communityGetFoodNutrientLeaderboard,
  communityGetHealthLeaderboard,
  getAccessToken,
  showUnifiedApiError,
  type CheckinLeaderboardItem,
  type FoodNutrientLeaderboardItem,
  type HealthLeaderboardItem,
} from '../../../utils/api'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

type LeaderboardSection = 'user' | 'food'
type UserRankingType = 'checkin' | 'health'

type UserRankingRow = {
  rank: number
  userId: string
  nickname: string
  avatar: string
  value: number
  detail: string
  isMe: boolean
}

const NUTRIENT_OPTIONS = [
  { key: 'protein', label: '蛋白质' },
  { key: 'fiber', label: '膳食纤维' },
  { key: 'calcium', label: '钙' },
  { key: 'iron', label: '铁' },
  { key: 'potassium', label: '钾' },
  { key: 'magnesium', label: '镁' },
  { key: 'zinc', label: '锌' },
  { key: 'vitamin_a', label: '维生素A' },
  { key: 'vitamin_c', label: '维生素C' },
  { key: 'vitamin_d', label: '维生素D' },
  { key: 'vitamin_e', label: '维生素E' },
  { key: 'vitamin_k', label: '维生素K' },
  { key: 'vitamin_b12', label: '维生素B12' },
  { key: 'folate', label: '叶酸' },
] as const

function normalizeCheckinRows(list: CheckinLeaderboardItem[]): UserRankingRow[] {
  return list.map(row => ({
    rank: row.rank,
    userId: row.user_id,
    nickname: row.nickname,
    avatar: row.avatar,
    value: row.checkin_count,
    detail: `${row.checkin_count}次饮食记录`,
    isMe: row.is_me,
  }))
}

function normalizeHealthRows(list: HealthLeaderboardItem[]): UserRankingRow[] {
  return list.map(row => ({
    rank: row.rank,
    userId: row.user_id,
    nickname: row.nickname,
    avatar: row.avatar,
    value: row.health_index,
    detail: `本周记录${row.recorded_days}天`,
    isMe: row.is_me,
  }))
}

function formatFoodValue(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 100) return String(Math.round(value))
  return String(Number(value.toFixed(1)))
}

function Avatar({ src, food = false }: { src: string; food?: boolean }) {
  return src ? (
    <Image className='leaderboard-avatar' src={src} mode='aspectFill' />
  ) : (
    <View className={`leaderboard-avatar-placeholder${food ? ' is-food' : ''}`}>
      <Text className={`iconfont ${food ? 'icon-shiwu' : 'icon-duoren'}`} />
    </View>
  )
}

function CheckinLeaderboardPage() {
  const router = useRouter()
  const section: LeaderboardSection = router.params.section === 'food' ? 'food' : 'user'
  const [userRankingType, setUserRankingType] = useState<UserRankingType>(
    router.params.ranking === 'health' ? 'health' : 'checkin'
  )
  const [nutrient, setNutrient] = useState<string>(router.params.nutrient || 'protein')
  const [userRows, setUserRows] = useState<UserRankingRow[]>([])
  const [foodRows, setFoodRows] = useState<FoodNutrientLeaderboardItem[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [weekEnd, setWeekEnd] = useState('')
  const [foodUnit, setFoodUnit] = useState('g')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setError('请先登录')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      if (section === 'food') {
        const result = await communityGetFoodNutrientLeaderboard(nutrient)
        setFoodRows(result.list || [])
        setFoodUnit(result.unit)
      } else if (userRankingType === 'health') {
        const result = await communityGetHealthLeaderboard()
        setWeekStart(result.week_start)
        setWeekEnd(result.week_end)
        setUserRows(normalizeHealthRows(result.list || []))
      } else {
        const result = await communityGetCheckinLeaderboard()
        setWeekStart(result.week_start)
        setWeekEnd(result.week_end)
        setUserRows(normalizeCheckinRows(result.list || []))
      }
    } catch (loadError: unknown) {
      setError('加载失败，请稍后重试')
      await showUnifiedApiError(loadError, '加载失败')
    } finally {
      setLoading(false)
    }
  }, [nutrient, section, userRankingType])

  useEffect(() => {
    void load()
  }, [load])

  const topUsers = useMemo(() => userRows.slice(0, 3), [userRows])
  const remainingUsers = useMemo(() => userRows.slice(3), [userRows])
  const me = useMemo(() => userRows.find(row => row.isMe), [userRows])
  const selectedNutrient = NUTRIENT_OPTIONS.find(item => item.key === nutrient) || NUTRIENT_OPTIONS[0]
  const isHealth = userRankingType === 'health'

  const renderState = () => {
    if (loading) {
      return <View className='leaderboard-state'><View className='loading-spinner-md' /></View>
    }
    if (error) {
      return (
        <View className='leaderboard-state'>
          <Text>{error}</Text>
          <View
            className='leaderboard-retry'
            onClick={() => error === '请先登录'
              ? Taro.navigateTo({ url: extraPkgUrl('/pages/login/index') })
              : void load()}
          >
            {error === '请先登录' ? '去登录' : '重试'}
          </View>
        </View>
      )
    }
    if (section === 'food') {
      if (foodRows.length === 0) return <View className='leaderboard-state'>暂无食物数据</View>
      return (
        <View className='leaderboard-list food-ranking-list'>
          {foodRows.map(row => (
            <View className='leaderboard-row' key={row.food_id}>
              <Text className={`leaderboard-rank rank-${row.rank}`}>{row.rank}</Text>
              <View className='leaderboard-avatar-wrap'><Avatar src={row.image_url} food /></View>
              <Text className='leaderboard-name' numberOfLines={1}>{row.name}</Text>
              <View className='leaderboard-value-wrap'>
                <Text className='leaderboard-value'>{formatFoodValue(row.value)}</Text>
                <Text className='leaderboard-unit'>{foodUnit}/100g</Text>
              </View>
            </View>
          ))}
        </View>
      )
    }
    if (userRows.length === 0) {
      return <View className='leaderboard-state'>{isHealth ? '本周暂无满足条件的健康指数' : '本周暂无饮食记录'}</View>
    }
    return (
      <>
        <View className='leaderboard-podium'>
          {[topUsers[1], topUsers[0], topUsers[2]]
            .filter((row): row is UserRankingRow => Boolean(row))
            .map(row => (
            <View className={`podium-item podium-rank-${row.rank}`} key={row.userId}>
              <Text className='podium-medal'>{row.rank}</Text>
              <View className='podium-avatar-wrap'><Avatar src={row.avatar} /></View>
              <Text className='podium-name' numberOfLines={1}>{row.nickname}</Text>
              <Text className='podium-value'>{row.value}{isHealth ? '分' : '次'}</Text>
            </View>
            ))}
        </View>
        <View className='leaderboard-list'>
          {remainingUsers.map(row => (
            <View className={`leaderboard-row${row.isMe ? ' is-me' : ''}`} key={row.userId}>
              <Text className='leaderboard-rank'>{row.rank}</Text>
              <View className='leaderboard-avatar-wrap'><Avatar src={row.avatar} /></View>
              <View className='leaderboard-user-copy'>
                <View className='leaderboard-user-name-row'>
                  <Text className='leaderboard-name' numberOfLines={1}>{row.nickname}</Text>
                  {row.isMe ? <Text className='leaderboard-me-tag'>我</Text> : null}
                </View>
                <Text className='leaderboard-detail'>{row.detail}</Text>
              </View>
              <View className='leaderboard-value-wrap'>
                <Text className='leaderboard-value'>{row.value}</Text>
                <Text className='leaderboard-unit'>{isHealth ? '分' : '次'}</Text>
              </View>
            </View>
          ))}
        </View>
      </>
    )
  }

  return (
    <View className='leaderboard-page'>
      <View className='leaderboard-header'>
        <Text className='leaderboard-title'>{section === 'food' ? '食物排行榜' : '用户排行榜'}</Text>
        {section === 'user' ? (
          <View className='leaderboard-segments'>
            <View
              className={`leaderboard-segment${userRankingType === 'checkin' ? ' active' : ''}`}
              onClick={() => setUserRankingType('checkin')}
            >饮食记录榜</View>
            <View
              className={`leaderboard-segment${userRankingType === 'health' ? ' active' : ''}`}
              onClick={() => setUserRankingType('health')}
            >健康榜</View>
          </View>
        ) : (
          <ScrollView scrollX enhanced showScrollbar={false} className='nutrient-scroll'>
            <View className='nutrient-options'>
              {NUTRIENT_OPTIONS.map(item => (
                <View
                  key={item.key}
                  className={`nutrient-option${nutrient === item.key ? ' active' : ''}`}
                  onClick={() => setNutrient(item.key)}
                >{item.label}</View>
              ))}
            </View>
          </ScrollView>
        )}
        <View className='leaderboard-period-row'>
          <Text className='iconfont icon-rili leaderboard-period-icon' />
          <Text>{section === 'food'
            ? `${selectedNutrient.label} · 标准食物库 · 每100g`
            : `${isHealth ? '好友' : '全体用户'} · 本周 ${weekStart}${weekEnd ? ` – ${weekEnd}` : ''}`}</Text>
        </View>
        {section === 'user' && isHealth ? (
          <Text className='leaderboard-source'>按「分析」页的综合健康指数排名</Text>
        ) : null}
      </View>

      <ScrollView scrollY enhanced showScrollbar={false} className='leaderboard-scroll'>
        {renderState()}
        <View className='leaderboard-bottom-space' />
      </ScrollView>

      {section === 'user' && !loading && !error && me ? (
        <View className='leaderboard-me-bar'>
          <View className='leaderboard-me-avatar'><Avatar src={me.avatar} /></View>
          <Text className='leaderboard-me-word'>我</Text>
          <Text className='leaderboard-me-summary'>第{me.rank}名 · {me.value}{isHealth ? '分' : '次'}</Text>
        </View>
      ) : null}
    </View>
  )
}

export default withAuth(CheckinLeaderboardPage)
