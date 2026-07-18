import { Canvas, Image, ScrollView, Text, View } from '@tarojs/components'
import { withAuth } from '../../../utils/withAuth'
import { useCallback, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  deleteFoodRecord,
  getAccessToken,
  getFoodRecordList,
  getFriendInviteProfile,
  getHomeDashboard,
  getShareQrEnvVersion,
  getUnlimitedQRCode,
  mapCalendarDateToApi,
  showUnifiedApiError,
  updateFoodRecord,
  type FoodRecord,
} from '../../../utils/api'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { requestHomeRecordMenu } from '../../../utils/home-record-menu'
import { drawDayRecordPoster, computeDayRecordPosterHeight, POSTER_WIDTH, type DayRecordPosterMeal } from '../../../utils/poster'
import { isShowShareImageMenuCancel } from '../../../utils/weapp-share-image'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import { getCurrentPosterUserProfile, mergePosterUserProfile } from '../../../utils/poster-profile'
import { claimSharePosterRewardQuietly } from '../../../utils/share-reward'
import { collectFoodDisplayImageUrls } from '../../../utils/food-display-image'

/** 格式化数字，最多保留1位小数，避免浮点精度溢出 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function summarizeRecordItems(items: FoodRecord['items']) {
  const totals = items.reduce((acc, item) => {
    const ratio = normalizeNumber(item.ratio, 100) / 100
    acc.calories += normalizeNumber(item.nutrients?.calories) * ratio
    acc.protein += normalizeNumber(item.nutrients?.protein) * ratio
    acc.carbs += normalizeNumber(item.nutrients?.carbs) * ratio
    acc.fat += normalizeNumber(item.nutrients?.fat) * ratio
    acc.weight += normalizeNumber(item.intake)
    return acc
  }, {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    weight: 0,
  })

  return {
    total_calories: Math.round(totals.calories * 10) / 10,
    total_protein: Math.round(totals.protein * 10) / 10,
    total_carbs: Math.round(totals.carbs * 10) / 10,
    total_fat: Math.round(totals.fat * 10) / 10,
    total_weight_grams: Math.round(totals.weight),
  }
}

function resolveFoodItemIntakeRatio(item: FoodRecord['items'][number]): number {
  const explicitRatio = Number((item as any).ratio)
  if (Number.isFinite(explicitRatio) && explicitRatio >= 0) {
    return explicitRatio
  }
  const intake = Number((item as any).intake)
  const weight = Number((item as any).weight)
  if (Number.isFinite(intake) && intake >= 0 && Number.isFinite(weight) && weight > 0) {
    return (intake / weight) * 100
  }
  return 100
}

function computeFoodRecordIntakeRatio(record: FoodRecord): number {
  let weightTotal = 0
  let intakeTotal = 0
  ;(record.items || []).forEach((item) => {
    const weight = normalizeNumber((item as any).weight)
    if (weight <= 0) return
    weightTotal += weight
    const intake = Number((item as any).intake)
    if (Number.isFinite(intake) && intake >= 0) {
      intakeTotal += intake
      return
    }
    intakeTotal += weight * resolveFoodItemIntakeRatio(item) / 100
  })
  if (weightTotal <= 0) return 100
  return Math.round((intakeTotal / weightTotal) * 1000) / 10
}

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

function getRecordTimeValue(recordTime?: string) {
  const timestamp = new Date(recordTime || '').getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

type DayRecordCard = {
  id: string
  record: FoodRecord
  mealType: string
  mealName: string
  foodName: string
  time: string
  imageUrls: string[]
  previewImage: string
  hasRealImage: boolean
  foods: Array<{ name: string; amount: string; calorie: number; protein: number; carbs: number; fat: number; intakeRatio: number }>
  totalCalorie: number
  totalProtein: number
  totalCarbs: number
  totalFat: number
  intakeRatio: number
}

function sortDayRecordCardsByTime(items: DayRecordCard[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const timeDiff = getRecordTimeValue(a.item.record.record_time) - getRecordTimeValue(b.item.record.record_time)
      if (timeDiff !== 0) return timeDiff
      return a.index - b.index
    })
    .map(({ item }) => item)
}

function DayRecordPage() {
  const isRewardCenterMode = Taro.getCurrentInstance()?.router?.params?.task_mode === 'reward_center'
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
  const [yesterdayIntake, setYesterdayIntake] = useState<number | null>(null)

  /** 分享海报 */
  const [posterVisible, setPosterVisible] = useState(false)
  const [posterGenerating, setPosterGenerating] = useState(false)
  const [posterImageUrl, setPosterImageUrl] = useState<string | null>(null)

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
      // 计算昨天日期用于较昨对比
      const todayDate = new Date(`${listDate}T12:00:00`)
      const yesterdayDate = new Date(todayDate)
      yesterdayDate.setDate(yesterdayDate.getDate() - 1)
      const yesterdayStr = formatDateKey(yesterdayDate)

      const [recordRes, dashboardRes, yesterdayDashboardRes] = await Promise.all([
        getFoodRecordList(listDate),
        getHomeDashboard(listDate).catch(() => null),
        getHomeDashboard(yesterdayStr).catch(() => null),
      ])
      const nextRecords = sortDayRecordCardsByTime((recordRes.records || []).map((record: FoodRecord) => {
        const imageUrls = collectFoodDisplayImageUrls(record)

        const foodItems = (record.items || []).map((item) => {
          const ratio = resolveFoodItemIntakeRatio(item)
          const fullCalorie = item.nutrients?.calories ?? 0
          const consumedCalorie = fullCalorie * (ratio / 100)
          const fullProtein = item.nutrients?.protein ?? 0
          const fullCarbs = item.nutrients?.carbs ?? 0
          const fullFat = item.nutrients?.fat ?? 0
          return {
            name: item.name,
            amount: `${item.intake ?? 0}g`,
            calorie: Math.round(consumedCalorie * 10) / 10,
            protein: Math.round(fullProtein * (ratio / 100) * 10) / 10,
            carbs: Math.round(fullCarbs * (ratio / 100) * 10) / 10,
            fat: Math.round(fullFat * (ratio / 100) * 10) / 10,
            intakeRatio: Math.round(ratio * 10) / 10,
          }
        })
        const foodName = foodItems.map(f => f.name).filter(Boolean).join('、') || '未命名食物'

        return {
          id: record.id,
          record,
          mealType: record.meal_type,
          mealName: MEAL_TYPE_NAMES[record.meal_type] || record.meal_type,
          foodName,
          time: formatRecordTime(record.record_time),
          imageUrls,
          previewImage: imageUrls[0] || '',
          hasRealImage: imageUrls.length > 0,
          foods: foodItems,
          totalCalorie: Math.round((record.total_calories ?? 0) * 10) / 10,
          totalProtein: Math.round((record.total_protein ?? 0) * 10) / 10,
          totalCarbs: Math.round((record.total_carbs ?? 0) * 10) / 10,
          totalFat: Math.round((record.total_fat ?? 0) * 10) / 10,
          intakeRatio: computeFoodRecordIntakeRatio(record),
        }
      }))

      setRecords(nextRecords)
      setHistoryTotalCalorie(Math.round(nextRecords.reduce((sum, item) => sum + item.totalCalorie, 0) * 10) / 10)
      if (dashboardRes?.intakeData?.target) {
        setTargetCalories(dashboardRes.intakeData.target)
      }
      if (yesterdayDashboardRes?.intakeData?.current != null) {
        setYesterdayIntake(yesterdayDashboardRes.intakeData.current)
      }
    } catch (e: any) {
      setError('获取当天记录失败，请稍后重试')
      await showUnifiedApiError(e, '获取当天记录失败')
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
      url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(recordId)}`
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

  const notifyFoodRecordsChanged = () => {
    try {
      Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
    } catch {
      /* ignore */
    }
  }

  const deleteRecordAndRefresh = async (recordId: string) => {
    await deleteFoodRecord(recordId)
    notifyFoodRecordsChanged()
    Taro.showToast({ title: '已删除', icon: 'success' })
    loadDayRecords()
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
              await deleteRecordAndRefresh(recordId)
            } catch (err: any) {
              await showUnifiedApiError(err, '删除失败')
            }
          },
        })
      },
    })
  }

  const handleDeleteFoodItem = (
    e: { stopPropagation: () => void },
    meal: DayRecordCard,
    foodIndex: number
  ) => {
    e.stopPropagation()
    const currentItems = meal.record.items || []
    const targetFood = currentItems[foodIndex]
    const foodName = targetFood?.name || meal.foods[foodIndex]?.name || '该食物'
    if (!targetFood) return

    const willDeleteWholeRecord = currentItems.length <= 1
    Taro.showModal({
      title: willDeleteWholeRecord ? '删除记录' : '删除食物',
      content: willDeleteWholeRecord
        ? `「${foodName}」是这条记录里最后一个食物，删除后会一并删除整条记录。确定删除吗？`
        : `只删除「${foodName}」，其他食物会保留。确定删除吗？`,
      confirmText: '删除',
      confirmColor: '#e53e3e',
      success: async (modalRes) => {
        if (!modalRes.confirm) return
        try {
          if (willDeleteWholeRecord) {
            await deleteRecordAndRefresh(meal.id)
            return
          }

          const nextItems = currentItems.filter((_, index) => index !== foodIndex)
          const payloadItems = nextItems.map((item) => ({
            ...item,
            image_path: item.image_path ?? undefined,
            image_paths: item.image_paths ?? undefined,
          }))
          await updateFoodRecord(meal.id, {
            items: payloadItems,
            ...summarizeRecordItems(nextItems),
          })
          notifyFoodRecordsChanged()
          Taro.showToast({ title: '已删除', icon: 'success' })
          loadDayRecords()
        } catch (err: any) {
          await showUnifiedApiError(err, '删除失败')
        }
      },
    })
  }

  const openRecordPage = () => {
    requestHomeRecordMenu(selectedDate)
  }

  // ---- 分享海报 ----

  const closeDayRecordPoster = useCallback(() => {
    setPosterVisible(false)
    setPosterImageUrl(null)
    setPosterGenerating(false)
  }, [])

  const openOfficialDayRecordImageMenu = useCallback((path: string) => {
    if (!path) return
    Taro.showShareImageMenu({
      path,
      success: () => {
        void claimSharePosterRewardQuietly({ share_scope: 'daily_food', share_date: selectedDate })
        closeDayRecordPoster()
      },
      fail: (err: { errMsg?: string }) => {
        if (isShowShareImageMenuCancel(err)) {
          closeDayRecordPoster()
          return
        }
        console.error('showShareImageMenu fail', err)
        closeDayRecordPoster()
        void showUnifiedApiError(new Error('打开微信图片菜单失败，请重试'), '打开微信图片菜单失败，请重试')
      }
    })
  }, [closeDayRecordPoster, selectedDate])

  const handleShareDayRecord = useCallback(() => {
    if (posterGenerating) return
    if (records.length === 0) {
      Taro.showToast({ title: '暂无饮食记录可分享', icon: 'none' })
      return
    }
    setPosterVisible(false)
    setPosterImageUrl(null)
    handleGenerateDayRecordPoster()
  }, [posterGenerating, records, historyTotalCalorie, targetCalories])

  const handleGenerateDayRecordPoster = useCallback(() => {
    if (posterGenerating || records.length === 0) return
    setPosterGenerating(true)
    Taro.showLoading({ title: '生成海报中...' })

    const query = Taro.createSelectorQuery()
    query
      .select('#dayRecordPosterCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res?.[0]?.node) {
          Taro.hideLoading()
          setPosterGenerating(false)
          Taro.showToast({ title: '画布未就绪，请重试', icon: 'none' })
          return
        }
        const canvas = res[0].node as HTMLCanvasElement & { createImage?: () => { src: string; onload: () => void; onerror: (err?: any) => void; width: number; height: number } }
        const dpr = 2

        const loadImage = async (src: string): Promise<{ width: number; height: number } | null> => {
          if (!src || !canvas.createImage) return null
          let localSrc: string
          try {
            localSrc = await resolveCanvasImageSrc(src)
          } catch (e) {
            console.error('resolveCanvasImageSrc fail', src, e)
            return null
          }
          return new Promise<{ width: number; height: number } | null>((resolve) => {
            const img = canvas.createImage!()
            img.onload = () => resolve(img)
            img.onerror = (e) => {
              console.error('Load image fail', localSrc, e)
              resolve(null)
            }
            img.src = localSrc
          })
        }

        try {
          // 并行加载：餐次图片 + 用户资料 + 二维码
          const mealImagePromises = records.map((meal) =>
            meal.hasRealImage ? loadImage(meal.previewImage) : Promise.resolve(null)
          )
          const uid = (Taro.getStorageSync('user_id') as string) || ''

          const [mealImages, profile, qrImg] = await Promise.all([
            Promise.all(mealImagePromises),
            (async () => {
              const localProfile = await getCurrentPosterUserProfile(uid)
              if (!uid) return { nickname: '', avatar: '', invite_code: '' }
              try {
                const remoteProfile = await getFriendInviteProfile(uid)
                const mergedProfile = mergePosterUserProfile(remoteProfile, localProfile)
                return {
                  ...remoteProfile,
                  nickname: mergedProfile.nickname,
                  avatar: mergedProfile.avatar,
                }
              } catch {
                return { nickname: localProfile.nickname, avatar: localProfile.avatar, invite_code: '' }
              }
            })(),
            (async () => {
              const inviteCode = uid ? uid.replace(/-/g, '').toLowerCase().slice(0, 8) : ''
              const scene = inviteCode ? `fi=${inviteCode}` : 'share=1'
              try {
                const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', getShareQrEnvVersion())
                const img = await loadImage(base64)
                if (img) return img
              } catch {
                // Ignore QR failures; the poster can still render without a code.
              }
              return null
            })(),
          ])

          const avatarImg = profile.avatar ? await loadImage(profile.avatar).catch(() => null) : null

          const ctx = canvas.getContext('2d')
          if (!ctx) {
            Taro.hideLoading()
            setPosterGenerating(false)
            Taro.showToast({ title: '画布不可用', icon: 'none' })
            return
          }

          const totalProtein = records.reduce((s, m) => s + m.totalProtein, 0)
          const totalCarbs = records.reduce((s, m) => s + m.totalCarbs, 0)
          const totalFat = records.reduce((s, m) => s + m.totalFat, 0)

          const dynamicHeight = computeDayRecordPosterHeight(records.length)
          canvas.width = POSTER_WIDTH * dpr
          canvas.height = dynamicHeight * dpr
          ctx.scale(dpr, dpr)

          const posterMeals: DayRecordPosterMeal[] = records.map((meal) => ({
            foodName: meal.foodName,
            mealType: meal.mealName,  // "早餐"/"午餐" 等中文标签
            mealTime: meal.time,
            imageUrl: meal.previewImage,
            hasImage: meal.hasRealImage,
            calorie: meal.totalCalorie,
            protein: meal.totalProtein,
            carbs: meal.totalCarbs,
            fat: meal.totalFat,
            intakeRatio: meal.intakeRatio,
          }))

          drawDayRecordPoster(ctx, {
            width: POSTER_WIDTH,
            height: dynamicHeight,
            data: {
              dateLabel: formatDisplayDate(selectedDate),
              totalIntake: historyTotalCalorie,
              targetIntake: targetCalories,
              recordCount: records.length,
              totalProtein,
              totalCarbs,
              totalFat,
              deltaKcal: yesterdayIntake != null ? historyTotalCalorie - yesterdayIntake : undefined,
              meals: posterMeals,
            },
            mealImages,
            qrCodeImage: qrImg,
            sharerNickname: profile.nickname || '',
            sharerAvatarImage: avatarImg,
          })

          Taro.canvasToTempFilePath({
            canvas: canvas as any,
            destWidth: POSTER_WIDTH * 2,
            destHeight: dynamicHeight * 2,
            fileType: 'jpg',
            quality: 0.95,
            success: (resp) => {
              Taro.hideLoading()
              setPosterGenerating(false)
              setPosterImageUrl(resp.tempFilePath)
              openOfficialDayRecordImageMenu(resp.tempFilePath)
            },
            fail: (err) => {
              Taro.hideLoading()
              setPosterGenerating(false)
              Taro.showToast({ title: '生成失败', icon: 'none' })
              console.error('canvasToTempFilePath fail', err)
            }
          })
        } catch (e) {
          Taro.hideLoading()
          setPosterGenerating(false)
          Taro.showToast({ title: '生成失败，请重试', icon: 'none' })
          console.error('drawDayRecordPoster error', e)
        }
      })
  }, [records, historyTotalCalorie, targetCalories, selectedDate, yesterdayIntake, posterGenerating, openOfficialDayRecordImageMenu])

  const handleShareDayRecordPosterImage = useCallback(() => {
    if (!posterImageUrl) return
    Taro.showShareImageMenu({
      path: posterImageUrl,
      success: () => {
        void claimSharePosterRewardQuietly({ share_scope: 'daily_food', share_date: selectedDate })
      },
      fail: (err: { errMsg?: string }) => {
        if (isShowShareImageMenuCancel(err)) return
        console.error('showShareImageMenu fail', err)
        Taro.showToast({ title: '分享失败，请保存图片后手动发送', icon: 'none' })
      }
    })
  }, [posterImageUrl, selectedDate])

  const handleSaveDayRecordPoster = useCallback(() => {
    if (!posterImageUrl) return
    Taro.showShareImageMenu({
      path: posterImageUrl,
      fail: (err: { errMsg?: string }) => {
        if (isShowShareImageMenuCancel(err)) return
        console.error('showShareImageMenu fail', err)
        Taro.showToast({ title: '打开图片菜单失败，请重试', icon: 'none' })
      }
    })
  }, [posterImageUrl])

  return (
    <View className='day-record-page'>
      <ScrollView className='day-record-scroll' scrollY enhanced showScrollbar={false}>
        <View className='day-record-top'>
          <Text className='day-record-date-line'>{formatDisplayDate(selectedDate)}</Text>
          {records.length > 0 && (
            <View className='day-record-share-btn' onClick={handleShareDayRecord}>
              <Text className='iconfont icon-fenxiang1 day-record-share-icon' />
              <Text className='day-record-share-text'>分享今日饮食</Text>
            </View>
          )}
        </View>
        {isRewardCenterMode && (
          <View className='day-record-reward-hint'>
            分享单餐或今日饮食均可获得奖励积分，每日最多 3 次。
          </View>
        )}

        <View className='day-record-summary'>
          <View className='summary-card'>
            <Text className='summary-label'>总摄入</Text>
            <Text className='summary-value'>{formatNumber(historyTotalCalorie)} kcal</Text>
          </View>
          <View className='summary-card'>
            <Text className='summary-label'>目标</Text>
            <Text className='summary-value'>{formatNumber(targetCalories)} kcal</Text>
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
                    <Text className='day-record-card-calorie'>{formatNumber(meal.totalCalorie)} kcal</Text>
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
                        <Text className={`day-record-food-ratio ${food.intakeRatio > 100 ? 'is-over' : ''}`}>
                          {formatNumber(food.intakeRatio)}%
                        </Text>
                      </View>
                      <View className='day-record-food-side'>
                        <Text className='day-record-food-calorie'>{formatNumber(food.calorie)} kcal</Text>
                        <View
                          className='day-record-food-delete'
                          onClick={(e) => handleDeleteFoodItem(e as any, meal, index)}
                        >
                          <Text className='iconfont icon-shanchu day-record-food-delete-icon' />
                        </View>
                      </View>
                      <View className='day-record-food-macros'>
                        <View className='day-record-food-macro'>
                          <Text className='day-record-food-macro-label'>蛋白质</Text>
                          <Text className='day-record-food-macro-value macro-protein'>{Math.round(food.protein)}g</Text>
                        </View>
                        <View className='day-record-food-macro'>
                          <Text className='day-record-food-macro-label'>碳水</Text>
                          <Text className='day-record-food-macro-value macro-carbs'>{Math.round(food.carbs)}g</Text>
                        </View>
                        <View className='day-record-food-macro'>
                          <Text className='day-record-food-macro-label'>脂肪</Text>
                          <Text className='day-record-food-macro-value macro-fat'>{Math.round(food.fat)}g</Text>
                        </View>
                      </View>
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
            <Text className='day-record-empty-desc'>通过首页记录弹窗拍照或文字录入后，这里就会展示当天明细。</Text>
            <View className='day-record-empty-btn' onClick={openRecordPage}>
              <Text className='day-record-empty-btn-text'>去记录</Text>
            </View>
          </View>
        )}

        <View className='day-record-footer-space' />
      </ScrollView>

      {/* 海报隐藏 Canvas */}
      <View className='poster-canvas-wrap'>
        <Canvas
          type='2d'
          id='dayRecordPosterCanvas'
          className='poster-canvas'
          style={{ width: `${POSTER_WIDTH}px`, height: '800px' }}
        />
      </View>

      {/* 海报弹窗 */}
      {posterVisible && posterImageUrl && (() => {
        // 计算海报显示尺寸：等比缩放适配视窗高度
        const sysInfo = Taro.getSystemInfoSync()
        const windowHeight = sysInfo.windowHeight || 800
        const windowWidth = sysInfo.windowWidth || 375
        // 顶部标题栏 ~88rpx + 关闭区 ~100rpx + 底部操作栏 ~220rpx = ~408rpx ≈ 204px
        const chromeH = Math.round(windowHeight * 0.28)
        const availH = windowHeight - chromeH
        // 海报原生宽高比：POSTER_WIDTH / computedHeight
        const posterHeight = computeDayRecordPosterHeight(records.length)
        const posterAspect = POSTER_WIDTH / posterHeight
        // 可用区内等比缩放
        const maxDisplayW = Math.min(windowWidth - 40, 640 * (windowWidth / 750))
        let displayW = maxDisplayW
        let displayH = displayW / posterAspect
        if (displayH > availH) {
          displayH = availH
          displayW = displayH * posterAspect
        }
        return (
        <View className='poster-modal poster-modal--sheet' catchMove>
          <View className='poster-modal-shell' catchMove>
            <View className='poster-modal-topbar poster-modal-topbar--light poster-modal-topbar--title-only'>
              <Text className='poster-modal-title poster-modal-title--light'>分享饮食记录</Text>
            </View>
            <View className='poster-modal-dark-body'>
              <View className='poster-modal-inline-back' onClick={closeDayRecordPoster}>
                <View className='poster-modal-close poster-modal-inline-close-hit'>
                  <Text className='poster-modal-close-x'>×</Text>
                </View>
              </View>
              <View className='poster-scroll-area'>
                <View className='poster-modal-scroll-inner'>
                  <View className='poster-modal-card-wrap' style={{ width: `${displayW}px`, height: `${displayH}px` }}>
                    <Image
                      src={posterImageUrl}
                      mode='aspectFit'
                      className='poster-modal-image'
                      style={{ width: `${displayW}px`, height: `${displayH}px` }}
                    />
                  </View>
                </View>
              </View>
            </View>
            <View className='poster-modal-bottom-bar'>
              <View className='poster-share-channel' onClick={handleShareDayRecordPosterImage}>
                <View className='poster-share-channel-icon poster-share-channel-icon-wechat'>
                  <Text className='iconfont icon-wechat poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>微信</Text>
              </View>
              <View className='poster-share-channel' onClick={handleSaveDayRecordPoster}>
                <View className='poster-share-channel-icon poster-share-channel-icon-save'>
                  <Text className='iconfont icon-download poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>保存图片</Text>
              </View>
            </View>
          </View>
        </View>
        )
      })()}
    </View>
  )
}

export default withAuth(DayRecordPage)
