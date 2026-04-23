import { Image, ScrollView, Text, View } from '@tarojs/components'
import { withAuth } from '../../utils/withAuth'
import { useCallback, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  deleteFoodRecord,
  getAccessToken,
  getFoodRecordList,
  getHomeDashboard,
  mapCalendarDateToApi,
  type FoodRecord,
} from '../../utils/api'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../utils/home-events'

import './index.scss'

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐',
}

const MEAL_TYPE_ICONS: Record<string, string> = {
  breakfast: 'icon-zaocan',
  morning_snack: 'icon-lingshi',
  lunch: 'icon-wucan',
  afternoon_snack: 'icon-lingshi',
  dinner: 'icon-wancan',
  evening_snack: 'icon-lingshi',
  snack: 'icon-lingshi',
}


function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDisplayDate(dateStr: string) {
  const date = new Date(`${dateStr}T12:00:00`)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdays[date.getDay()]
  const todayStr = formatDateKey(new Date())
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = formatDateKey(yesterday)

  if (dateStr === todayStr) return `${month}月${day}日 今天`
  if (dateStr === yesterdayStr) return `${month}月${day}日 昨天`
  return `${month}月${day}日 ${weekday}`
}

function formatRecordTime(recordTime: string) {
  try {
    const date = new Date(recordTime)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  } catch {
    return '--:--'
  }
}

type DayRecordCard = {
  id: string
  mealType: string
  mealName: string
  time: string
  imageUrls: string[]
  previewImage: string
  hasRealImage: boolean
  foods: Array<{ name: string; amount: string; calorie: number }>
  totalCalorie: number
}

function DayRecordPage() {
  /** 每次进入须从路由读 date；仅用 useState(initial) 会导致从首页带参跳转时仍停留在旧日期 */
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = Taro.getCurrentInstance()?.router?.params?.date
    return typeof d === 'string' && d.length >= 8 ? d : formatDateKey(new Date())
  })
  const [records, setRecords] = useState<DayRecordCard[]>([])
  const [historyTotalCalorie, setHistoryTotalCalorie] = useState(0)
  const [targetCalories, setTargetCalories] = useState(2000)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDayRecords = useCallback(async () => {
    if (!getAccessToken()) {
      setError('请先登录后查看当天记录')
      setRecords([])
      setHistoryTotalCalorie(0)
      setLoading(false)
      return
    }

    const raw = Taro.getCurrentInstance()?.router?.params?.date
    const dateParam = typeof raw === 'string' && raw.length >= 8 ? raw : formatDateKey(new Date())
    setSelectedDate(dateParam)
    const listDate = mapCalendarDateToApi(dateParam) || dateParam

    setLoading(true)
    setError(null)
    try {
      const [recordRes, dashboardRes] = await Promise.all([
        getFoodRecordList(listDate),
        getHomeDashboard(listDate).catch(() => null),
      ])
      const nextRecords = (recordRes.records || []).map((record: FoodRecord) => {
        const imageUrls = (record.image_paths && record.image_paths.length > 0)
          ? record.image_paths.filter(Boolean)
          : (record.image_path ? [record.image_path] : [])

        return {
          id: record.id,
          mealType: record.meal_type,
          mealName: MEAL_TYPE_NAMES[record.meal_type] || record.meal_type,
          time: formatRecordTime(record.record_time),
          imageUrls,
          previewImage: imageUrls[0] || '',
          hasRealImage: imageUrls.length > 0,
          foods: (record.items || []).map((item) => {
            const ratio = item.ratio ?? 100
            const fullCalorie = item.nutrients?.calories ?? 0
            const consumedCalorie = fullCalorie * (ratio / 100)
            return {
              name: item.name,
              amount: `${item.intake ?? 0}g`,
              calorie: Math.round(consumedCalorie * 10) / 10,
            }
          }),
          totalCalorie: Math.round((record.total_calories ?? 0) * 10) / 10,
        }
      })

      setRecords(nextRecords)
      setHistoryTotalCalorie(nextRecords.reduce((sum, item) => sum + item.totalCalorie, 0))
      if (dashboardRes?.intakeData?.target) {
        setTargetCalories(dashboardRes.intakeData.target)
      }
    } catch (e: any) {
      setError(e?.message || '获取当天记录失败')
      setRecords([])
      setHistoryTotalCalorie(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    loadDayRecords()
  })

  const openRecordDetail = (recordId: string) => {
    Taro.navigateTo({
      url: `/pages/record-detail/index?id=${encodeURIComponent(recordId)}&ui=home`
    })
  }

  const previewMealImages = (e: { stopPropagation: () => void }, meal: DayRecordCard) => {
    e.stopPropagation()
    if (!meal.hasRealImage) return
    Taro.previewImage({
      current: meal.previewImage,
      urls: meal.imageUrls,
    })
  }

  const handleDeleteRecord = (e: { stopPropagation: () => void }, recordId: string) => {
    e.stopPropagation()
    Taro.showActionSheet({
      itemList: ['删除该记录', '取消'],
      success: (res) => {
        if (res.tapIndex !== 0) return
        Taro.showModal({
          title: '确认删除',
          content: '删除这条饮食记录后不可恢复，确定删除吗？',
          confirmText: '删除',
          confirmColor: '#e53e3e',
          success: async (modalRes) => {
            if (!modalRes.confirm) return
            try {
              await deleteFoodRecord(recordId)
              try {
                Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
              } catch {
                /* ignore */
              }
              Taro.showToast({ title: '已删除', icon: 'success' })
              loadDayRecords()
            } catch (err: any) {
              Taro.showToast({ title: err?.message || '删除失败', icon: 'none' })
            }
          },
        })
      },
    })
  }

  const openRecordPage = () => {
    Taro.switchTab({ url: '/pages/record/index' })
  }

  return (
    <View className='day-record-page'>
      <ScrollView className='day-record-scroll' scrollY enhanced showScrollbar={false}>
        <View className='day-record-top'>
          <Text className='day-record-date-line'>{formatDisplayDate(selectedDate)}</Text>
        </View>

        <View className='day-record-summary'>
          <View className='summary-card'>
            <Text className='summary-label'>总摄入</Text>
            <Text className='summary-value'>{historyTotalCalorie} kcal</Text>
          </View>
          <View className='summary-card'>
            <Text className='summary-label'>目标</Text>
            <Text className='summary-value'>{targetCalories} kcal</Text>
          </View>
          <View className='summary-card'>
            <Text className='summary-label'>记录数</Text>
            <Text className='summary-value'>{records.length} 条</Text>
          </View>
        </View>

        {loading ? (
          <View className='day-record-empty'>
            <View className='loading-spinner-md' />
          </View>
        ) : error ? (
          <View className='day-record-empty'>
            <Text className='iconfont icon-jiesuo day-record-empty-icon'></Text>
            <Text className='day-record-empty-title'>{error}</Text>
          </View>
        ) : records.length > 0 ? (
          <View className='day-record-list'>
            {records.map((meal) => (
              <View
                key={meal.id}
                className='day-record-card'
                onClick={() => openRecordDetail(meal.id)}
              >
                <View className='day-record-card-header'>
                  <View className='day-record-card-main'>
                    <View
                      className={`day-record-card-thumb ${meal.hasRealImage ? '' : 'is-placeholder'}`}
                      onClick={(e) => previewMealImages(e as any, meal)}
                    >
                      {meal.hasRealImage ? (
                        <Image
                          className='day-record-card-thumb-image'
                          src={meal.previewImage}
                          mode='aspectFill'
                        />
                      ) : (
                        <Text className='iconfont icon-shiwu' style={{ fontSize: '48rpx', color: '#00bc7d' }} />
                      )}
                      {!meal.hasRealImage && (
                        <View className='day-record-card-thumb-badge placeholder'>
                          <Text className='day-record-card-thumb-badge-text'>无照片</Text>
                        </View>
                      )}
                      {meal.hasRealImage && meal.imageUrls.length > 1 && (
                        <View className='day-record-card-thumb-badge'>
                          <Text className='day-record-card-thumb-badge-text'>{meal.imageUrls.length} 张</Text>
                        </View>
                      )}
                    </View>
                    <View className={`day-record-card-icon ${meal.mealType}-icon`}>
                      <Text className={`iconfont ${MEAL_TYPE_ICONS[meal.mealType] || 'icon-shiwu'}`}></Text>
                    </View>
                    <View className='day-record-card-copy'>
                      <Text className='day-record-card-name'>{meal.mealName}</Text>
                      <Text className='day-record-card-time'>{meal.time}</Text>
                    </View>
                  </View>
                  <View className='day-record-card-actions'>
                    <Text className='day-record-card-calorie'>{meal.totalCalorie} kcal</Text>
                    <View
                      className='day-record-card-delete'
                      onClick={(e) => handleDeleteRecord(e as any, meal.id)}
                    >
                      <Text className='iconfont icon-shanchu day-record-card-delete-icon' />
                    </View>
                  </View>
                </View>

                <View className='day-record-food-list'>
                  {meal.foods.map((food, index) => (
                    <View key={`${meal.id}-${index}`} className='day-record-food-item'>
                      <View className='day-record-food-main'>
                        <Text className='day-record-food-name'>{food.name}</Text>
                        <Text className='day-record-food-amount'>{food.amount}</Text>
                      </View>
                      <Text className='day-record-food-calorie'>{food.calorie} kcal</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className='day-record-empty'>
            <Text className='iconfont icon-jishiben day-record-empty-icon'></Text>
            <Text className='day-record-empty-title'>这一天还没有饮食记录</Text>
            <Text className='day-record-empty-desc'>去记录页拍照或文字录入后，这里就会展示当天明细。</Text>
            <View className='day-record-empty-btn' onClick={openRecordPage}>
              <Text className='day-record-empty-btn-text'>去记录</Text>
            </View>
          </View>
        )}

        <View className='day-record-footer-space' />
      </ScrollView>
    </View>
  )
}

export default withAuth(DayRecordPage)
