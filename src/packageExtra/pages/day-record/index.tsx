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
  getUnlimitedQRCode,
  mapCalendarDateToApi,
  type FoodRecord,
} from '../../../utils/api'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { drawDayRecordPoster, computeDayRecordPosterHeight, POSTER_WIDTH, type DayRecordPosterMeal } from '../../../utils/poster'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'

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
  foodName: string
  time: string
  imageUrls: string[]
  previewImage: string
  hasRealImage: boolean
  foods: Array<{ name: string; amount: string; calorie: number }>
  totalCalorie: number
  totalProtein: number
  totalCarbs: number
  totalFat: number
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
      const nextRecords = (recordRes.records || []).map((record: FoodRecord) => {
        const imageUrls = (record.image_paths && record.image_paths.length > 0)
          ? record.image_paths.filter(Boolean)
          : (record.image_path ? [record.image_path] : [])

        const foodItems = (record.items || []).map((item) => {
          const ratio = item.ratio ?? 100
          const fullCalorie = item.nutrients?.calories ?? 0
          const consumedCalorie = fullCalorie * (ratio / 100)
          return {
            name: item.name,
            amount: `${item.intake ?? 0}g`,
            calorie: Math.round(consumedCalorie * 10) / 10,
          }
        })
        const foodName = foodItems.map(f => f.name).filter(Boolean).join('、') || '未命名食物'

        return {
          id: record.id,
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
        }
      })

      setRecords(nextRecords)
      setHistoryTotalCalorie(nextRecords.reduce((sum, item) => sum + item.totalCalorie, 0))
      if (dashboardRes?.intakeData?.target) {
        setTargetCalories(dashboardRes.intakeData.target)
      }
      if (yesterdayDashboardRes?.intakeData?.current != null) {
        setYesterdayIntake(yesterdayDashboardRes.intakeData.current)
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

  // ---- 分享海报 ----

  const handleShareDayRecord = useCallback(() => {
    if (posterGenerating) return
    setPosterVisible(true)
    // 延迟触发生成，让弹窗先出现
    setTimeout(() => {
      handleGenerateDayRecordPoster()
    }, 100)
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
              if (!uid) return { nickname: '', avatar: '', invite_code: '' }
              try {
                return await getFriendInviteProfile(uid)
              } catch {
                return { nickname: '', avatar: '', invite_code: '' }
              }
            })(),
            (async () => {
              const inviteCode = uid ? uid.replace(/-/g, '').toLowerCase().slice(0, 8) : ''
              const scene = inviteCode ? `fi=${inviteCode}` : 'share=1'
              const isDev = typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development'
              const envCandidates: Array<'develop' | 'trial' | 'release'> = isDev
                ? ['develop', 'trial', 'release']
                : ['release', 'trial', 'develop']
              for (const envVersion of envCandidates) {
                try {
                  const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', envVersion)
                  const img = await loadImage(base64)
                  if (img) return img
                } catch { /* try next env */ }
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
  }, [records, historyTotalCalorie, targetCalories, selectedDate, yesterdayIntake, posterGenerating])

  const closeDayRecordPoster = useCallback(() => {
    setPosterVisible(false)
    setPosterImageUrl(null)
    setPosterGenerating(false)
  }, [])

  const handleShareDayRecordPosterImage = useCallback(() => {
    if (!posterImageUrl) return
    Taro.showShareImageMenu({
      path: posterImageUrl,
      fail: (err: { errMsg?: string }) => {
        console.error('showShareImageMenu fail', err)
        Taro.showToast({ title: '分享失败，请保存图片后手动发送', icon: 'none' })
      }
    })
  }, [posterImageUrl])

  const handleSaveDayRecordPoster = useCallback(() => {
    if (!posterImageUrl) return
    Taro.saveImageToPhotosAlbum({
      filePath: posterImageUrl,
      success: () => {
        Taro.showToast({ title: '已保存到相册', icon: 'success' })
        closeDayRecordPoster()
      },
      fail: (err) => {
        if (err.errMsg?.includes('auth deny') || err.errMsg?.includes('authorize')) {
          Taro.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) Taro.openSetting()
            }
          })
        } else {
          Taro.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  }, [posterImageUrl, closeDayRecordPoster])

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

                <View className='day-record-macro-row'>
                  <View className='day-record-macro-item'>
                    <Text className='day-record-macro-label'>蛋白质</Text>
                    <Text className='day-record-macro-value macro-protein'>{Math.round(meal.totalProtein)}g</Text>
                  </View>
                  <View className='day-record-macro-item'>
                    <Text className='day-record-macro-label'>碳水</Text>
                    <Text className='day-record-macro-value macro-carbs'>{Math.round(meal.totalCarbs)}g</Text>
                  </View>
                  <View className='day-record-macro-item'>
                    <Text className='day-record-macro-label'>脂肪</Text>
                    <Text className='day-record-macro-value macro-fat'>{Math.round(meal.totalFat)}g</Text>
                  </View>
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
