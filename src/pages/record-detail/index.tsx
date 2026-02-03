import { View, Text, Image, ScrollView, Canvas, Button } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import type { FoodRecord } from '../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT } from '../../utils/poster'
import logoPng from '../../assets/icons/home-active.png'

import './index.scss'

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

const MEAL_TYPE_ICONS: Record<string, string> = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snack: '🍎'
}

const CONTEXT_STATE_LABELS: Record<string, string> = {
  post_workout: '刚健身完',
  fasting: '空腹/餐前',
  fat_loss: '减脂期',
  muscle_gain: '增肌期',
  maintain: '维持体重',
  none: '无特殊'
}

const STORAGE_KEY = 'recordDetail'

function formatContextState(value: string): string {
  return CONTEXT_STATE_LABELS[value] || value
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
  const [record, setRecord] = useState<FoodRecord | null>(null)
  const [posterGenerating, setPosterGenerating] = useState(false)
  const [posterImageUrl, setPosterImageUrl] = useState<string | null>(null)
  const [showPosterModal, setShowPosterModal] = useState(false)

  useEffect(() => {
    try {
      const stored = Taro.getStorageSync(STORAGE_KEY)
      if (stored) {
        setRecord(stored as FoodRecord)
        Taro.removeStorageSync(STORAGE_KEY)
      } else {
        Taro.showToast({ title: '记录不存在', icon: 'none' })
        setTimeout(() => Taro.navigateBack(), 1500)
      }
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 1500)
    }
  }, [])

  if (!record) {
    return (
      <View className="record-detail-page">
        <View className="empty-tip">加载中...</View>
      </View>
    )
  }

  const mealName = MEAL_TYPE_NAMES[record.meal_type] || record.meal_type
  const mealIcon = MEAL_TYPE_ICONS[record.meal_type] || '🍽️'
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
        const canvas = res[0].node as HTMLCanvasElement & { createImage?: () => { src: string; onload: () => void; onerror: () => void; width: number; height: number } }
        const dpr = 2
        canvas.width = POSTER_WIDTH * dpr
        canvas.height = POSTER_HEIGHT * dpr

        const exportCanvas = () => {
          Taro.canvasToTempFilePath({
            canvas,
            destWidth: POSTER_WIDTH * 2,
            destHeight: POSTER_HEIGHT * 2,
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
        }

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

        Promise.all([
          loadImage(record.image_path || ''),
          loadImage(logoPng)
        ]).then(([mainImg, logoImg]) => {
          try {
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              Taro.hideLoading()
              setPosterGenerating(false)
              Taro.showToast({ title: '画布不可用', icon: 'none' })
              return
            }
            ctx.scale(dpr, dpr)
            drawRecordPoster(ctx, {
              width: POSTER_WIDTH,
              height: POSTER_HEIGHT,
              record,
              image: mainImg,
              logoImage: logoImg,
              qrCodeImage: null // 暂时使用占位符
            })
            exportCanvas()
          } catch (e) {
            Taro.hideLoading()
            setPosterGenerating(false)
            Taro.showToast({ title: '绘制失败', icon: 'none' })
            console.error('drawRecordPoster error', e)
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
              <Text>{mealIcon}</Text>
            </View>
            <View>
              <Text className="meal-name">{mealName}</Text>
              <Text className="meal-time">{timeStr}</Text>
            </View>
          </View>
          <View className="total-calorie">
            {Math.round((record.total_calories ?? 0) * 10) / 10}
            <Text className="unit">kcal</Text>
          </View>
        </View>

        {record.image_path ? (
          <View className="detail-image">
            <Image src={record.image_path} mode="aspectFill" />
          </View>
        ) : null}

        {record.description ? (
          <View className="detail-desc">
            <Text className="label">识别描述</Text>
            <Text>{record.description}</Text>
          </View>
        ) : null}

        {record.insight ? (
          <View className="detail-insight">
            <Text className="label">健康建议</Text>
            <Text>{record.insight}</Text>
          </View>
        ) : null}
        {record.context_state ? (
          <View className="detail-insight">
            <Text className="label">当时状态</Text>
            <Text>{formatContextState(record.context_state)}</Text>
          </View>
        ) : null}
        {record.pfc_ratio_comment ? (
          <View className="detail-insight">
            <Text className="label">PFC 比例</Text>
            <Text>{record.pfc_ratio_comment}</Text>
          </View>
        ) : null}
        {record.absorption_notes ? (
          <View className="detail-insight">
            <Text className="label">吸收与利用</Text>
            <Text>{record.absorption_notes}</Text>
          </View>
        ) : null}
        {record.context_advice ? (
          <View className="detail-insight">
            <Text className="label">情境建议</Text>
            <Text>{record.context_advice}</Text>
          </View>
        ) : null}

        <View className="poster-actions">
          <Button className="poster-btn" onClick={handleGeneratePoster} disabled={posterGenerating}>
            {posterGenerating ? '生成中...' : '生成分享海报'}
          </Button>
        </View>
      </View>

      {/* 离屏 Canvas 用于绘制海报 */}
      <View className="poster-canvas-wrap">
        <Canvas type="2d" id="recordPosterCanvas" className="poster-canvas" />
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
            return (
              <View key={index} className="food-item">
                <View className="food-info">
                  <Text className="food-name">{item.name}</Text>
                  <Text className="food-meta">
                    摄入 {item.intake ?? 0}g
                    {ratio !== 100 ? ` · 约 ${ratio}%` : ''}
                  </Text>
                </View>
                <View className="food-nutrients">
                  <Text className="food-calorie">{Math.round(cal * 10) / 10} kcal</Text>
                  <Text className="food-macros">P {protein.toFixed(0)} · C {carbs.toFixed(0)} · F {fat.toFixed(0)}g</Text>
                </View>
              </View>
            )
          })
        ) : (
          <View className="empty-tip">暂无食物明细</View>
        )}

        <View className="summary-row">
          <Text>总重量</Text>
          <Text className="value">{record.total_weight_grams ?? 0} g</Text>
        </View>
        <View className="summary-row">
          <Text>蛋白质</Text>
          <Text className="value">{Math.round((record.total_protein ?? 0) * 10) / 10} g</Text>
        </View>
        <View className="summary-row">
          <Text>碳水</Text>
          <Text className="value">{Math.round((record.total_carbs ?? 0) * 10) / 10} g</Text>
        </View>
        <View className="summary-row">
          <Text>脂肪</Text>
          <Text className="value">{Math.round((record.total_fat ?? 0) * 10) / 10} g</Text>
        </View>
      </View>

      {/* 海报预览弹窗 */}
      {showPosterModal && posterImageUrl && (
        <View className="poster-modal" catchMove>
          <View className="poster-modal-mask" onClick={() => setShowPosterModal(false)} />
          <View className="poster-modal-content">
            <Text className="poster-modal-title">分享海报</Text>
            <ScrollView scrollY className="poster-scroll-area">
              <Image src={posterImageUrl} mode="widthFix" className="poster-modal-image" />
            </ScrollView>
            <View className="poster-modal-actions">
              <Button className="poster-modal-btn secondary" onClick={() => setShowPosterModal(false)}>关闭</Button>
              <Button className="poster-modal-btn primary" onClick={handleSavePoster}>保存到相册</Button>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  )
}
