import { View, Text, ScrollView } from '@tarojs/components'
import { useCallback, useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getFoodExpiryList,
  completeFoodExpiryItem,
  deleteFoodExpiryItem,
  type FoodExpiryItem
} from '../../utils/api'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../utils/food-expiry-events'
import './index.scss'

type TabKey = 'pending' | 'completed'

function getUrgencyText(item: FoodExpiryItem): string {
  if (item.urgency_level === 'overdue') return '已过期'
  if (item.urgency_level === 'today') return '今天截止'
  if (item.urgency_level === 'soon') return `${Math.max(1, Number(item.days_left ?? 1))}天内到期`
  if (item.completed_at) return '已吃完'
  return '待处理'
}

function buildMeta(item: FoodExpiryItem): string {
  return [item.deadline_label, item.storage_location || '', item.quantity_text || '']
    .filter(Boolean)
    .join(' · ')
}

export default function FoodExpiryPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [items, setItems] = useState<FoodExpiryItem[]>([])
  const [loading, setLoading] = useState(false)

  const loadList = useCallback(async (tab: TabKey = activeTab) => {
    setLoading(true)
    try {
      const res = await getFoodExpiryList(tab)
      setItems(res.items || [])
    } catch (error: any) {
      Taro.showToast({ title: error.message || '加载失败', icon: 'none' })
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useDidShow(() => {
    loadList(activeTab)
  })

  useEffect(() => {
    const refreshList = () => {
      loadList(activeTab)
    }
    Taro.eventCenter.on(FOOD_EXPIRY_CHANGED_EVENT, refreshList)
    return () => {
      Taro.eventCenter.off(FOOD_EXPIRY_CHANGED_EVENT, refreshList)
    }
  }, [activeTab, loadList])

  const switchTab = (tab: TabKey) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    loadList(tab)
  }

  const openEdit = (id?: string) => {
    const url = id ? `/pages/food-expiry-edit/index?id=${encodeURIComponent(id)}` : '/pages/food-expiry-edit/index'
    Taro.navigateTo({ url })
  }

  const handleComplete = async (id: string) => {
    const { confirm } = await Taro.showModal({
      title: '标记已吃完',
      content: '确认这份食物已经吃完了吗？',
    })
    if (!confirm) return
    try {
      await completeFoodExpiryItem(id)
      Taro.eventCenter.trigger(FOOD_EXPIRY_CHANGED_EVENT)
      Taro.showToast({ title: '已标记', icon: 'success' })
      loadList('pending')
    } catch (error: any) {
      Taro.showToast({ title: error.message || '操作失败', icon: 'none' })
    }
  }

  const handleDelete = async (id: string) => {
    const { confirm } = await Taro.showModal({
      title: '删除食物',
      content: '删除后无法恢复，确定继续吗？',
    })
    if (!confirm) return
    try {
      await deleteFoodExpiryItem(id)
      Taro.eventCenter.trigger(FOOD_EXPIRY_CHANGED_EVENT)
      Taro.showToast({ title: '已删除', icon: 'success' })
      loadList(activeTab)
    } catch (error: any) {
      Taro.showToast({ title: error.message || '删除失败', icon: 'none' })
    }
  }

  return (
    <View className='food-expiry-page'>
      <View className='expiry-header'>
        <Text className='expiry-title'>食物保质期</Text>
        <Text className='expiry-subtitle'>记录家中现有食物和预计吃完时间，首页会展示快到期内容。</Text>
      </View>

      <View className='expiry-tabs'>
        <View className={`expiry-tab ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => switchTab('pending')}>
          <Text className='expiry-tab-text'>待吃完</Text>
        </View>
        <View className={`expiry-tab ${activeTab === 'completed' ? 'active' : ''}`} onClick={() => switchTab('completed')}>
          <Text className='expiry-tab-text'>已吃完</Text>
        </View>
      </View>

      <ScrollView className='expiry-scroll' scrollY>
        {loading ? (
          <View className='expiry-empty'>
            <Text className='expiry-empty-title'>加载中...</Text>
          </View>
        ) : items.length === 0 ? (
          <View className='expiry-empty'>
            <Text className='expiry-empty-title'>{activeTab === 'pending' ? '还没有待吃完的食物' : '还没有已吃完记录'}</Text>
            <Text className='expiry-empty-desc'>
              {activeTab === 'pending' ? '添加食物后，首页会展示最紧急的几项。' : '标记已吃完后会出现在这里。'}
            </Text>
          </View>
        ) : (
          <View className='expiry-list'>
            {items.map((item) => (
              <View key={item.id} className='expiry-card'>
                <View className='expiry-card-top'>
                  <View className='expiry-card-title-wrap'>
                    <Text className='expiry-card-title'>{item.food_name}</Text>
                    <Text className={`expiry-card-tag ${item.urgency_level}`}>{getUrgencyText(item)}</Text>
                  </View>
                  <Text className='expiry-card-edit' onClick={() => openEdit(item.id)}>编辑</Text>
                </View>

                <Text className='expiry-card-meta'>{buildMeta(item) || '未填写附加信息'}</Text>
                {item.note ? <Text className='expiry-card-note'>{item.note}</Text> : null}

                <View className='expiry-card-actions'>
                  {activeTab === 'pending' ? (
                    <View className='expiry-action primary' onClick={() => handleComplete(item.id)}>
                      <Text className='expiry-action-text primary'>标记已吃完</Text>
                    </View>
                  ) : null}
                  <View className='expiry-action danger' onClick={() => handleDelete(item.id)}>
                    <Text className='expiry-action-text danger'>删除</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View className='expiry-bottom-bar'>
        <View className='expiry-add-btn' onClick={() => openEdit()}>
          <Text className='expiry-add-btn-text'>添加食物</Text>
        </View>
      </View>
    </View>
  )
}
