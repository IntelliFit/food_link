import { View, Text, ScrollView } from '@tarojs/components'
import { useCallback, useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getFoodExpiryDashboard,
  listManagedFoodExpiryItems,
  updateManagedFoodExpiryStatus,
  type FoodExpiryDashboard,
  type FoodExpiryItem,
  type FoodExpiryStatus,
} from '../../../utils/api'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../../utils/food-expiry-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'

import './index.scss'

function formatExpireHint(item: FoodExpiryItem): string {
  if (item.status !== 'active') {
    return item.status === 'consumed' ? '已标记吃完' : '已标记丢弃'
  }
  if (item.days_until_expire == null) return '保质期待确认'
  if (item.days_until_expire < 0) return `已过期 ${Math.abs(item.days_until_expire)} 天`
  if (item.days_until_expire === 0) return '今天到期'
  if (item.days_until_expire === 1) return '明天到期'
  return `${item.days_until_expire} 天后到期`
}

function groupItems(items: FoodExpiryItem[]) {
  const urgent = items.filter((item) => item.status === 'active' && item.urgency !== 'fresh')
  const fresh = items.filter((item) => item.status === 'active' && item.urgency === 'fresh')
  const processed = items.filter((item) => item.status !== 'active')
  return { urgent, fresh, processed }
}

export default function ExpiryPage() {
  const scheme = useAppColorScheme()
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<FoodExpiryDashboard | null>(null)
  const [items, setItems] = useState<FoodExpiryItem[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [dashboardRes, listRes] = await Promise.all([
        getFoodExpiryDashboard(),
        listManagedFoodExpiryItems(),
      ])
      setDashboard(dashboardRes)
      setItems(listRes.items || [])
    } catch (error: any) {
      console.error('[expiry] loadData failed:', error)
      Taro.showToast({ title: error?.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    loadData()
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  const grouped = useMemo(() => groupItems(items), [items])

  const navigateToEditor = (itemId?: string) => {
    const base = extraPkgUrl('/pages/expiry-edit/index')
    const url = itemId ? `${base}?id=${itemId}` : base
    Taro.navigateTo({ url })
  }

  const handleUpdateStatus = async (item: FoodExpiryItem, status: FoodExpiryStatus) => {
    const actionText =
      status === 'consumed'
        ? '标记为已吃完'
        : status === 'discarded'
          ? '标记为已丢弃'
          : '恢复到保鲜中'

    const confirm = await Taro.showModal({
      title: actionText,
      content: `确认将「${item.food_name}」${actionText}吗？`,
      confirmColor: '#00bc7d',
    })
    if (!confirm.confirm) return

    Taro.showLoading({ title: '处理中...' })
    try {
      await updateManagedFoodExpiryStatus(item.id, status)
      Taro.hideLoading()
      Taro.eventCenter.trigger(FOOD_EXPIRY_CHANGED_EVENT)
      Taro.showToast({ title: '更新成功', icon: 'success' })
      loadData()
    } catch (error: any) {
      Taro.hideLoading()
      Taro.showToast({ title: error?.message || '更新失败', icon: 'none' })
    }
  }

  const renderItemCard = (item: FoodExpiryItem) => (
    <View key={item.id} className='expiry-item-card' onClick={() => navigateToEditor(item.id)}>
      <View className='expiry-item-head'>
        <View className='expiry-item-title-wrap'>
          <Text className='expiry-item-title'>{item.food_name}</Text>
          {item.category ? <Text className='expiry-item-category'>{item.category}</Text> : null}
        </View>
        <Text className={`expiry-item-badge expiry-item-badge--${item.status === 'active' ? item.urgency : item.status}`}>
          {item.status === 'active' ? item.urgency_label : item.status_label}
        </Text>
      </View>

      <View className='expiry-item-meta'>
        <Text>到期日 {item.expire_date}</Text>
        <Text>{item.storage_type_label}</Text>
        {item.quantity_note ? <Text>{item.quantity_note}</Text> : null}
      </View>

      <Text className='expiry-item-hint'>{formatExpireHint(item)}</Text>
      {item.note ? <Text className='expiry-item-note'>{item.note}</Text> : null}

      <View className='expiry-item-actions'>
        {item.status === 'active' ? (
          <>
            <View
              className='expiry-action expiry-action--ghost'
              onClick={(e) => {
                e.stopPropagation?.()
                handleUpdateStatus(item, 'consumed')
              }}
            >
              <Text>已吃完</Text>
            </View>
            <View
              className='expiry-action expiry-action--ghost'
              onClick={(e) => {
                e.stopPropagation?.()
                handleUpdateStatus(item, 'discarded')
              }}
            >
              <Text>已丢弃</Text>
            </View>
          </>
        ) : (
          <View
            className='expiry-action expiry-action--ghost'
            onClick={(e) => {
              e.stopPropagation?.()
              handleUpdateStatus(item, 'active')
            }}
          >
            <Text>恢复提醒</Text>
          </View>
        )}
        <View
          className='expiry-action expiry-action--primary'
          onClick={(e) => {
            e.stopPropagation?.()
            navigateToEditor(item.id)
          }}
        >
          <Text>编辑</Text>
        </View>
      </View>
    </View>
  )

  return (
    <FlPageThemeRoot>
    <View className='expiry-page'>
      <ScrollView scrollY className='expiry-scroll'>
        <View className='expiry-hero'>
          <View>
            <Text className='expiry-hero-kicker'>我的食物管理</Text>
            <Text className='expiry-hero-title'>保质期提醒</Text>
          </View>
          <View className='expiry-hero-add' onClick={() => navigateToEditor()}>
            <Text>新增</Text>
          </View>
        </View>

        <View className='expiry-summary-grid'>
          <View className='expiry-summary-card'>
            <Text className='expiry-summary-value'>{dashboard?.today_count ?? 0}</Text>
            <Text className='expiry-summary-label'>今天优先吃</Text>
          </View>
          <View className='expiry-summary-card'>
            <Text className='expiry-summary-value'>{dashboard?.soon_count ?? 0}</Text>
            <Text className='expiry-summary-label'>即将过期</Text>
          </View>
          <View className='expiry-summary-card'>
            <Text className='expiry-summary-value'>{dashboard?.expired_count ?? 0}</Text>
            <Text className='expiry-summary-label'>已过期</Text>
          </View>
          <View className='expiry-summary-card'>
            <Text className='expiry-summary-value'>{dashboard?.active_count ?? 0}</Text>
            <Text className='expiry-summary-label'>保鲜中</Text>
          </View>
        </View>

        {!!dashboard?.preview_items?.length && (
          <View className='expiry-preview-panel'>
            <Text className='expiry-section-title'>最需要先处理</Text>
            {dashboard.preview_items.map((item) => (
              <View key={item.id} className='expiry-preview-row' onClick={() => navigateToEditor(item.id)}>
                <Text className='expiry-preview-name'>{item.food_name}</Text>
                <Text className='expiry-preview-hint'>{formatExpireHint(item)}</Text>
              </View>
            ))}
          </View>
        )}

        {loading ? (
          <View className='expiry-empty'>
            <Text>正在加载保质期数据...</Text>
          </View>
        ) : items.length === 0 ? (
          <View className='expiry-empty'>
            <Text className='expiry-empty-title'>还没有记录食物保质期</Text>
            <Text className='expiry-empty-desc'>先把家里的牛奶、水果、剩菜记进来，快到期时这里会提醒你。新增入口保留在右上角。</Text>
          </View>
        ) : (
          <>
            {!!grouped.urgent.length && (
              <View className='expiry-section'>
                <Text className='expiry-section-title'>优先处理</Text>
                {grouped.urgent.map(renderItemCard)}
              </View>
            )}

            {!!grouped.fresh.length && (
              <View className='expiry-section'>
                <Text className='expiry-section-title'>保鲜中</Text>
                {grouped.fresh.map(renderItemCard)}
              </View>
            )}

            {!!grouped.processed.length && (
              <View className='expiry-section'>
                <Text className='expiry-section-title'>已处理</Text>
                {grouped.processed.map(renderItemCard)}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
    </FlPageThemeRoot>
  )
}
