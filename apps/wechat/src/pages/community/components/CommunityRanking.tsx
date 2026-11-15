import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { IconTrendingUp } from '../../../components/iconfont'
import {
  getAccessToken,
  type CheckinLeaderboardItem,
  type FoodContributionLeaderboardItem,
  type FoodNutrientLeaderboardItem,
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { redirectToLogin } from '../../../utils/withAuth'
import './CommunityRanking.scss'

export type RankingPreviewKind = 'contribution' | 'user' | 'food'

interface CommunityRankingProps {
  contribution?: FoodContributionLeaderboardItem
  record?: CheckinLeaderboardItem
  food?: FoodNutrientLeaderboardItem
  loggedIn: boolean
  loading: boolean
  errors?: Partial<Record<RankingPreviewKind, boolean>>
}

export function CommunityRanking({ contribution, record, food, loggedIn, loading, errors = {} }: CommunityRankingProps) {
  const columns = [
    {
      kind: 'contribution' as const,
      title: '贡献榜',
      label: '查看食物贡献榜',
      period: '本月',
      route: 'section=user&ranking=contribution',
      row: contribution,
      name: contribution?.nickname,
      avatar: contribution?.avatar,
      value: contribution ? `${contribution.contribution_count}条` : '',
      empty: '暂无贡献',
    },
    {
      kind: 'user' as const,
      title: '记录榜',
      label: '查看饮食记录榜',
      period: '本周',
      route: 'section=user',
      row: record,
      name: record?.nickname,
      avatar: record?.avatar,
      value: record ? `${record.checkin_count}次` : '',
      empty: '暂无记录',
    },
    {
      kind: 'food' as const,
      title: '食物榜',
      label: '查看食物营养榜',
      period: '蛋白质 / 100g',
      route: 'section=food&nutrient=protein',
      row: food,
      name: food?.name,
      avatar: food?.image_url,
      value: food ? `${Number(food.value.toFixed(1))}g` : '',
      empty: '暂无食物',
    },
  ]

  const openRanking = (query: string) => {
    if (!getAccessToken()) return redirectToLogin()
    void Taro.navigateTo({ url: extraPkgUrl(`/pages/checkin-leaderboard/index?${query}`) })
  }

  return (
    <View className='community-ranking' onClick={event => event.stopPropagation()}>
      <View className='community-ranking__header'>
        <IconTrendingUp size={30} color='currentColor' />
        <Text className='community-ranking__title'>排行榜</Text>
        <Text
          className='community-ranking__all'
          aria-label='查看完整排行榜'
          onClick={() => openRanking('section=user')}
        >查看全部 ›</Text>
      </View>
      <View className='community-ranking__columns'>
        {columns.map(column => {
          const needsLogin = !loggedIn && column.kind !== 'food'
          const hasRow = !needsLogin && Boolean(column.row)
          return (
            <View
              key={column.kind}
              className={`community-ranking__column community-ranking__column--${column.kind}`}
              aria-label={column.label}
              onClick={() => openRanking(column.route)}
            >
              <Text className='community-ranking__column-title'>{column.title} ›</Text>
              <Text className='community-ranking__period'>{column.period}</Text>
              {hasRow ? (
                <View className='community-ranking__preview'>
                  <View className='community-ranking__avatar-wrap'>
                    {column.avatar ? (
                      <Image className='community-ranking__avatar' src={column.avatar} mode='aspectFill' />
                    ) : (
                      <Text className={`iconfont ${column.kind === 'food' ? 'icon-shiwu' : 'icon-duoren'}`} />
                    )}
                    {column.kind === 'contribution' && column.row?.rank === 1 && (
                      <Text className='community-ranking__first'>1</Text>
                    )}
                  </View>
                  <Text className='community-ranking__name' numberOfLines={1}>{column.name || '食探用户'}</Text>
                  <Text className='community-ranking__value' numberOfLines={1}>{column.value}</Text>
                </View>
              ) : loading && !needsLogin ? (
                <View className='community-ranking__skeleton' aria-label={`${column.title}正在获取`}>
                  <View className='community-ranking__skeleton-avatar' />
                  <View className='community-ranking__skeleton-line' />
                  <View className='community-ranking__skeleton-line' />
                </View>
              ) : (
                <View className='community-ranking__state'>
                  <Text>{needsLogin ? '登录查看' : errors[column.kind] ? '暂未获取' : column.empty}</Text>
                </View>
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}
