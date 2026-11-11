import { withAuth } from '../../../utils/withAuth'
import { View, Text, ScrollView, Image } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  communityGetCheckinLeaderboard,
  communityGetFoodNutrientLeaderboard,
  communityGetHealthLeaderboard,
  communityGetFoodContributionLeaderboard,
  getAccessToken,
  showUnifiedApiError,
  type CheckinLeaderboardItem,
  type FoodNutrientLeaderboardItem,
  type HealthLeaderboardItem,
  type HealthLeaderboardScoringRule,
} from '../../../utils/api'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

type LeaderboardSection = 'user' | 'food'
type UserRankingType = 'checkin' | 'health' | 'contribution'

type UserRankingRow = {
  rank: number
  userId: string
  nickname: string
  avatar: string
  value: number
  detail: string
  isMe: boolean
  dietQualityPoints?: number
  continuityPoints?: number
  stabilityPoints?: number
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
    dietQualityPoints: row.diet_quality_points,
    continuityPoints: row.continuity_points,
    stabilityPoints: row.stability_points,
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
    router.params.ranking === 'contribution' ? 'contribution' : router.params.ranking === 'health' ? 'health' : 'checkin'
  )
  const [contributionPeriod, setContributionPeriod] = useState<'month' | 'all'>('month')
  const loadSeq = useRef(0)
  const [nutrient, setNutrient] = useState<string>(router.params.nutrient || 'protein')
  const [userRows, setUserRows] = useState<UserRankingRow[]>([])
  const [foodRows, setFoodRows] = useState<FoodNutrientLeaderboardItem[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [weekEnd, setWeekEnd] = useState('')
  const [foodUnit, setFoodUnit] = useState('g')
  const [healthScoringRule, setHealthScoringRule] = useState<HealthLeaderboardScoringRule | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const request = ++loadSeq.current
    const isCurrent = () => request === loadSeq.current
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
        if (!isCurrent()) return
        setFoodRows(result.list || [])
        setFoodUnit(result.unit)
      } else if (userRankingType === 'contribution') {
        const result = await communityGetFoodContributionLeaderboard(contributionPeriod)
        if (!isCurrent()) return
        setWeekStart(result.start_date || '')
        setWeekEnd(result.end_date || '')
        setUserRows((result.list || []).map(row => ({
          rank: row.rank, userId: row.user_id, nickname: row.nickname, avatar: row.avatar,
          value: row.contribution_count, isMe: row.is_me,
          detail: [row.standard_count ? `标准${row.standard_count}` : '', row.packaged_count ? `包装${row.packaged_count}` : '', row.meal_count ? `餐食${row.meal_count}` : '', row.custom_count ? `自定义${row.custom_count}` : ''].filter(Boolean).join(' · '),
        })))
      } else if (userRankingType === 'health') {
        const result = await communityGetHealthLeaderboard()
        if (!isCurrent()) return
        setWeekStart(result.week_start)
        setWeekEnd(result.week_end)
        setHealthScoringRule(result.scoring_rule)
        setUserRows(normalizeHealthRows(result.list || []))
      } else {
        const result = await communityGetCheckinLeaderboard()
        if (!isCurrent()) return
        setWeekStart(result.week_start)
        setWeekEnd(result.week_end)
        setUserRows(normalizeCheckinRows(result.list || []))
      }
    } catch (loadError: unknown) {
      if (!isCurrent()) return
      setError('加载失败，请稍后重试')
      await showUnifiedApiError(loadError, '加载失败')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [contributionPeriod, nutrient, section, userRankingType])

  useEffect(() => {
    void load()
    return () => { loadSeq.current += 1 }
  }, [load])

  const topUsers = useMemo(() => userRows.slice(0, 3), [userRows])
  const remainingUsers = useMemo(() => userRows.slice(3), [userRows])
  const me = useMemo(() => userRows.find(row => row.isMe), [userRows])
  const selectedNutrient = NUTRIENT_OPTIONS.find(item => item.key === nutrient) || NUTRIENT_OPTIONS[0]
  const isHealth = userRankingType === 'health'
  const isContribution = userRankingType === 'contribution'
  const userUnit = isContribution ? '项' : isHealth ? '分' : '次'

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
      return <View className='leaderboard-state'>{isContribution ? '暂无有效公开贡献，来补充第一条食物数据吧' : isHealth ? '本周暂无满足条件的健康饮食分' : '本周暂无饮食记录'}</View>
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
              <Text className='podium-value'>{row.value}{userUnit}</Text>
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
                <Text className='leaderboard-unit'>{userUnit}</Text>
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
        <Text className='leaderboard-title'>{section === 'food' ? '食物排行榜' : isContribution ? '食物贡献榜' : '用户排行榜'}</Text>
        {section === 'user' ? (
          <View className='leaderboard-segments'>
            <View
              className={`leaderboard-segment${userRankingType === 'checkin' ? ' active' : ''}`}
              onClick={() => setUserRankingType('checkin')}
            >饮食记录榜</View>
            <View
              className={`leaderboard-segment${userRankingType === 'health' ? ' active' : ''}`}
              onClick={() => setUserRankingType('health')}
            >健康饮食榜</View>
            <View
              className={`leaderboard-segment${isContribution ? ' active' : ''}`}
              onClick={() => setUserRankingType('contribution')}
            >食物贡献榜</View>
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
        {isContribution && section === 'user' && (
          <View className='contribution-periods'>
            <View className={contributionPeriod === 'month' ? 'active' : ''} onClick={() => setContributionPeriod('month')}>本月</View>
            <View className={contributionPeriod === 'all' ? 'active' : ''} onClick={() => setContributionPeriod('all')}>总榜</View>
          </View>
        )}
        <View className='leaderboard-period-row'>
          <Text className='iconfont icon-rili leaderboard-period-icon' />
          <Text>{section === 'food'
            ? `${selectedNutrient.label} · 标准食物库 · 每100g`
            : isContribution ? (contributionPeriod === 'all' ? '累计有效贡献' : `本月 ${weekStart}${weekEnd ? ` – ${weekEnd}` : ''}`)
              : `${isHealth ? '好友' : '全体用户'} · 本周 ${weekStart}${weekEnd ? ` – ${weekEnd}` : ''}`}</Text>
        </View>
        {isContribution && section === 'user' && <Text className='contribution-ranking-rule'>仅统计有效公开新增，同一条目只计一次。</Text>}
        {section === 'user' && isHealth ? (
          <View className='health-score-explanation'>
            <View className='health-score-explanation-head'>
              <Text className='health-score-explanation-title'>计分说明</Text>
              <Text className='health-score-explanation-total'>满分{healthScoringRule?.total_points || 100}分</Text>
            </View>
            <Text className='health-score-formula'>
              饮食质量{healthScoringRule?.diet_quality_points || 75}分
              {' + '}记录连续性{healthScoringRule?.continuity_points || 15}分
              {' + '}日间稳定性{healthScoringRule?.stability_points || 10}分
            </Text>
            <Text className='health-score-rule'>
              {healthScoringRule?.continuity_description || '历史连续记录3天后长期有效；本周按已有记录计算'}
            </Text>
            {me?.dietQualityPoints != null && me.continuityPoints != null && me.stabilityPoints != null ? (
              <Text className='health-score-my-breakdown'>
                我的得分：饮食质量 {me.dietQualityPoints}/75 · 连续性 {me.continuityPoints}/15 · 稳定性 {me.stabilityPoints}/10
              </Text>
            ) : null}
          </View>
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
          <Text className='leaderboard-me-summary'>第{me.rank}名 · {me.value}{userUnit}</Text>
        </View>
      ) : null}
      {section === 'user' && isContribution && !loading && !error && !me && (
        <View className='leaderboard-me-bar'>
          <Text className='leaderboard-me-summary'>还未上榜 · 0项有效贡献</Text>
          <Text className='contribution-create-link' onClick={() => void Taro.navigateTo({ url: extraPkgUrl('/pages/food-contribution/index') })}>去贡献 ›</Text>
        </View>
      )}
    </View>
  )
}

export default withAuth(CheckinLeaderboardPage)
