import { View, Text, Image, ScrollView, Canvas, Button } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { getFoodRecordById, getUnlimitedQRCode, type FoodRecord } from '../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../utils/poster'
import { IconBreakfast, IconLunch, IconDinner, IconSnack } from '../../components/iconfont'

import './index.scss'

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

const MEAL_ICON_CONFIG = {
  breakfast: { Icon: IconBreakfast, color: '#ff6900' },
  lunch: { Icon: IconLunch, color: '#00c950' },
  dinner: { Icon: IconDinner, color: '#2b7fff' },
  snack: { Icon: IconSnack, color: '#ad46ff' }
} as const

const DIET_GOAL_NAMES: Record<string, string> = {
  fat_loss: '减脂期',
  muscle_gain: '增肌期',
  maintain: '维持体重',
  none: '无特殊目标'
}

const ACTIVITY_TIMING_NAMES: Record<string, string> = {
  post_workout: '练后',
  daily: '日常',
  before_sleep: '睡前',
  none: '无'
}



/** 格式化记录时间 */
function formatRecordTime(recordTime: string): string {
  try {
    const d = new Date(recordTime)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${month}月${day}日 ${h}:${m}`
  } catch {
    return '--'
  }
}

export default function RecordDetailPage() {
  const router = useRouter()
  const [record, setRecord] = useState<FoodRecord | null>(null)
  const [posterGenerating, setPosterGenerating] = useState(false)
  const [posterImageUrl, setPosterImageUrl] = useState<string | null>(null)
  const [showPosterModal, setShowPosterModal] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadRecord = async () => {
      const recordId = router.params?.id

      // 优先从 URL 参数获取 recordId（真实记录），否则从 storage 读取（食谱等特殊情况）
      if (recordId) {
        // 从数据库获取真实记录
        try {
          setLoading(true)
          const { record: fetchedRecord } = await getFoodRecordById(recordId)
          setRecord(fetchedRecord)
        } catch (e: any) {
          const msg = e.message || '加载记录失败'
          Taro.showToast({ title: msg, icon: 'none' })
          setTimeout(() => Taro.navigateBack(), 1500)
        } finally {
          setLoading(false)
        }
      } else {
        // 兼容旧方式：从 storage 读取（用于食谱等非真实记录场景）
        try {
          const stored = Taro.getStorageSync('recordDetail')
          if (stored) {
            setRecord(stored as FoodRecord)
            Taro.removeStorageSync('recordDetail')
            setLoading(false)
          } else {
            Taro.showToast({ title: '记录不存在', icon: 'none' })
            setTimeout(() => Taro.navigateBack(), 1500)
          }
        } catch {
          Taro.showToast({ title: '加载失败', icon: 'none' })
          setTimeout(() => Taro.navigateBack(), 1500)
        }
      }
    }

    loadRecord()
  }, [router.params?.id])

  useShareAppMessage(() => {
    return {
      title: '来看看我的健康饮食记录吧！',
      path: `/pages/record-detail/index?id=${record?.id || router.params?.id || ''}`,
      imageUrl: posterImageUrl || undefined
    }
  })

  useShareTimeline(() => {
    return {
      title: '来看看我的健康饮食记录吧！',
      query: `id=${record?.id || router.params?.id || ''}`,
      imageUrl: posterImageUrl || undefined
    }
  })

  if (loading || !record) {
    return (
      <View className="record-detail-page">
        <View className="empty-tip">{loading ? '加载中...' : '记录不存在'}</View>
      </View>
    )
  }

  const mealName = MEAL_TYPE_NAMES[record.meal_type] || record.meal_type
  const mealIconConfig = MEAL_ICON_CONFIG[record.meal_type as keyof typeof MEAL_ICON_CONFIG] || MEAL_ICON_CONFIG.snack
  const timeStr = formatRecordTime(record.record_time)
  const items = record.items || []

  /** 单条食物实际摄入热量（按 ratio） */
  const itemCalorie = (item: FoodRecord['items'][0]) => {
    const ratio = (item.ratio ?? 100) / 100
    return ((item.nutrients?.calories ?? 0) * ratio)
  }

  /** 生成海报并导出为临时图片 */
  const handleGeneratePoster = () => {
    if (!record || posterGenerating) return
    setPosterGenerating(true)
    Taro.showLoading({ title: '生成海报中...' })

    const query = Taro.createSelectorQuery()
    query
      .select('#recordPosterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res?.[0]?.node) {
          Taro.hideLoading()
          setPosterGenerating(false)
          Taro.showToast({ title: '画布未就绪，请重试', icon: 'none' })
          return
        }
        const canvas = res[0].node as HTMLCanvasElement & { createImage?: () => { src: string; onload: () => void; onerror: (err?: any) => void; width: number; height: number } }
        const dpr = 2
        canvas.width = POSTER_WIDTH * dpr
        canvas.height = POSTER_HEIGHT * dpr

        const loadImage = (src: string) => {
          return new Promise<{ width: number; height: number } | null>((resolve) => {
            if (!src || !canvas.createImage) {
              resolve(null)
              return
            }
            const img = canvas.createImage()
            img.onload = () => resolve(img)
            img.onerror = (e) => {
              console.error('Load image fail', src, e)
              resolve(null)
            }
            img.src = src
          })
        }

        const loadQRImage = async () => {
          try {
            // scene 最大 32 个可见字符。当前 UUID 太长，改用简短字符串（例如 share=1）
            const { base64 } = await getUnlimitedQRCode('share=1', 'pages/index/index')
            return await loadImage(base64)
          } catch (e) {
            console.error('Failed to load real QR code', e)
            return null // fallback to fake QR code in poster
          }
        }

        Promise.all([
          loadImage(record.image_path || ''),
          loadQRImage()
        ]).then(([mainImg, qrImg]) => {
          try {
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              Taro.hideLoading()
              setPosterGenerating(false)
              Taro.showToast({ title: '画布不可用', icon: 'none' })
              return
            }

            const dynamicHeight = computePosterHeight(ctx, record, POSTER_WIDTH)
            canvas.width = POSTER_WIDTH * dpr
            canvas.height = dynamicHeight * dpr
            ctx.scale(dpr, dpr)

            // 使用当前稳定海报绘制逻辑
            drawRecordPoster(ctx, {
              width: POSTER_WIDTH,
              height: dynamicHeight,
              record,
              image: mainImg,
              qrCodeImage: qrImg,
            })

            Taro.canvasToTempFilePath({
              canvas: canvas as any,
              destWidth: POSTER_WIDTH * 2,
              destHeight: dynamicHeight * 2,
              fileType: 'png',
              success: (resp) => {
                Taro.hideLoading()
                setPosterGenerating(false)
                setPosterImageUrl(resp.tempFilePath)
                setShowPosterModal(true)
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
            Taro.showToast({ title: '绘制失败', icon: 'none' })
            console.error('drawSmartPoster error', e)
          }
        })
      })
  }

  const handleSavePoster = () => {
    if (!posterImageUrl) return
    Taro.saveImageToPhotosAlbum({
      filePath: posterImageUrl,
      success: () => {
        Taro.showToast({ title: '已保存到相册', icon: 'success' })
        setShowPosterModal(false)
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
  }

  return (
    <ScrollView className="record-detail-page" scrollY>
      <View className="detail-card">
        <View className="detail-header">
          <View className="meal-badge">
            <View className="meal-icon">
              <mealIconConfig.Icon size={40} color={mealIconConfig.color} />
            </View>
            <View className="meal-badge-text">
              <Text className="meal-name">{mealName}</Text>
              <Text className="meal-time">{timeStr}</Text>
            </View>
          </View>
          <View className="total-calorie">
            <Text className="num">{Math.round((record.total_calories ?? 0) * 10) / 10}</Text>
            <Text className="unit">kcal</Text>
          </View>
        </View>

        {
          record.image_path ? (
            <View
              className="detail-image"
              onClick={() => {
                Taro.previewImage({
                  urls: [record.image_path!],
                  current: record.image_path!
                })
              }}
            >
              <Image src={record.image_path} mode="aspectFill" />
            </View>
          ) : null
        }

        {/* 用户选择的目标与状态 */}
        {(record.diet_goal || record.activity_timing) && (
          <View className="context-tags">
            {record.diet_goal && record.diet_goal !== 'none' && (
              <View className="context-tag goal-tag">
                <Text className="tag-icon iconfont icon-shangzhang"></Text>
                <Text className="tag-text">{DIET_GOAL_NAMES[record.diet_goal] || record.diet_goal}</Text>
              </View>
            )}
            {record.activity_timing && record.activity_timing !== 'none' && (
              <View className="context-tag timing-tag">
                <Text className="tag-icon iconfont icon-shizhong"></Text>
                <Text className="tag-text">{ACTIVITY_TIMING_NAMES[record.activity_timing] || record.activity_timing}</Text>
              </View>
            )}
          </View>
        )}

        {
          record.description ? (
            <View className="detail-desc">
              <Text className="label">
                <Text className="iconfont icon-shiwu" style={{ marginRight: 6 }}></Text>
                识别描述
              </Text>
              <Text>{record.description}</Text>
            </View>
          ) : null
        }

        {
          record.insight ? (
            <View className="detail-insight">
              <Text className="label">
                <Text className="iconfont icon-a-144-lvye" style={{ marginRight: 6 }}></Text>
                AI 健康建议
              </Text>
              <Text>{record.insight}</Text>
            </View>
          ) : null
        }

        {
          record.pfc_ratio_comment ? (
            <View className="detail-insight">
              <Text className="label">
                <Text className="iconfont icon-tubiao-zhuzhuangtu" style={{ marginRight: 6 }}></Text>
                PFC 比例分析
              </Text>
              <Text>{record.pfc_ratio_comment}</Text>
            </View>
          ) : null
        }
        {
          record.absorption_notes ? (
            <View className="detail-insight">
              <Text className="label">
                <Text className="iconfont icon-huore" style={{ marginRight: 6 }}></Text>
                吸收与利用
              </Text>
              <Text>{record.absorption_notes}</Text>
            </View>
          ) : null
        }
        {
          record.context_advice ? (
            <View className="detail-insight">
              <Text className="label">
                <Text className="iconfont icon-shizhong" style={{ marginRight: 6 }}></Text>
                情境建议
              </Text>
              <Text>{record.context_advice}</Text>
            </View>
          ) : null
        }

        <View className="poster-actions">
          <Button className="poster-btn" onClick={handleGeneratePoster} disabled={posterGenerating}>
            {posterGenerating ? '生成中...' : '生成分享海报'}
          </Button>
        </View>
      </View>

      <View className="poster-canvas-wrap">
        <Canvas type="2d" id="recordPosterCanvas" className="poster-canvas" style={{ width: `${POSTER_WIDTH}px`, height: `${POSTER_HEIGHT}px` }} />
      </View>

      <View className="detail-card">
        <Text className="food-list-title">食物明细</Text>
        {items.length > 0 ? (
          items.map((item, index) => {
            const cal = itemCalorie(item)
            const ratio = item.ratio ?? 100
            const protein = ((item.nutrients?.protein ?? 0) * ratio) / 100
            const carbs = ((item.nutrients?.carbs ?? 0) * ratio) / 100
            const fat = ((item.nutrients?.fat ?? 0) * ratio) / 100
            const fiber = ((item.nutrients?.fiber ?? 0) * ratio) / 100
            const sugar = ((item.nutrients?.sugar ?? 0) * ratio) / 100
            return (
              <View key={index} className="food-item">
                <View className="food-info">
                  <Text className="food-name">{item.name}</Text>
                  <Text className="food-meta">
                    摄入 {item.intake ?? 0}g
                    {ratio !== 100 ? ` · 约 ${ratio}%` : ''}
                  </Text>
                  <View className="food-nutrients-detail">
                    <Text className="nutrient-item">蛋白 {protein.toFixed(1)}g</Text>
                    <Text className="nutrient-item">碳水 {carbs.toFixed(1)}g</Text>
                    <Text className="nutrient-item">脂肪 {fat.toFixed(1)}g</Text>
                    {fiber > 0 && <Text className="nutrient-item">纤维 {fiber.toFixed(1)}g</Text>}
                    {sugar > 0 && <Text className="nutrient-item">糖 {sugar.toFixed(1)}g</Text>}
                  </View>
                </View>
                <View className="food-nutrients">
                  <Text className="food-calorie">{Math.round(cal * 10) / 10} kcal</Text>
                </View>
              </View>
            )
          })
        ) : (
          <View className="empty-tip">暂无食物明细</View>
        )}

        <View className="nutrition-summary-section">
          <Text className="summary-title">营养汇总</Text>
          <View className="summary-grid">
            <View className="summary-item">
              <Text className="summary-label">总热量</Text>
              <Text className="summary-value highlight">{Math.round((record.total_calories ?? 0) * 10) / 10}</Text>
              <Text className="summary-unit">kcal</Text>
            </View>
            <View className="summary-item">
              <Text className="summary-label">总重量</Text>
              <Text className="summary-value">{record.total_weight_grams ?? 0}</Text>
              <Text className="summary-unit">g</Text>
            </View>
            <View className="summary-item">
              <Text className="summary-label">蛋白质</Text>
              <Text className="summary-value">{Math.round((record.total_protein ?? 0) * 10) / 10}</Text>
              <Text className="summary-unit">g</Text>
            </View>
            <View className="summary-item">
              <Text className="summary-label">碳水</Text>
              <Text className="summary-value">{Math.round((record.total_carbs ?? 0) * 10) / 10}</Text>
              <Text className="summary-unit">g</Text>
            </View>
            <View className="summary-item">
              <Text className="summary-label">脂肪</Text>
              <Text className="summary-value">{Math.round((record.total_fat ?? 0) * 10) / 10}</Text>
              <Text className="summary-unit">g</Text>
            </View>
            {(() => {
              const totalFiber = items.reduce((sum, item) => {
                const ratio = (item.ratio ?? 100) / 100
                return sum + ((item.nutrients?.fiber ?? 0) * ratio)
              }, 0)
              return totalFiber > 0 ? (
                <View className="summary-item">
                  <Text className="summary-label">膳食纤维</Text>
                  <Text className="summary-value">{Math.round(totalFiber * 10) / 10}</Text>
                  <Text className="summary-unit">g</Text>
                </View>
              ) : null
            })()}
            {(() => {
              const totalSugar = items.reduce((sum, item) => {
                const ratio = (item.ratio ?? 100) / 100
                return sum + ((item.nutrients?.sugar ?? 0) * ratio)
              }, 0)
              return totalSugar > 0 ? (
                <View className="summary-item">
                  <Text className="summary-label">糖分</Text>
                  <Text className="summary-value">{Math.round(totalSugar * 10) / 10}</Text>
                  <Text className="summary-unit">g</Text>
                </View>
              ) : null
            })()}
          </View>
        </View>
      </View>

      {/* 海报预览弹窗 */}
      {
        showPosterModal && posterImageUrl && (
          <View className="poster-modal" catchMove>
            <View className="poster-modal-mask" onClick={() => setShowPosterModal(false)} />
            <View className="poster-modal-content">
              <Text className="poster-modal-title">分享海报</Text>
              <ScrollView scrollY className="poster-scroll-area">
                <Image src={posterImageUrl} mode="widthFix" className="poster-modal-image" />
              </ScrollView>
              <View className="poster-modal-actions-col">
                <View className="share-row">
                  <Button className="poster-modal-btn share-chat-btn" openType="share">
                    微信好友/群聊
                  </Button>
                  <Button className="poster-modal-btn share-moments-btn" onClick={handleSavePoster}>
                    保存图片
                  </Button>
                </View>
                <Button className="poster-modal-btn close-btn" onClick={() => setShowPosterModal(false)}>关闭</Button>
              </View>
            </View>
          </View>
        )
      }
    </ScrollView>
  )
}
