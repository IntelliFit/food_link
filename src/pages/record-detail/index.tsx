import { View, Text, Image, ScrollView, Canvas, Button, Input, Slider } from '@tarojs/components'
import React, { useEffect, useCallback } from 'react'
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getSharedFoodRecord,
  getAccessToken,
  getUnlimitedQRCode,
  getFriendInviteProfile,
  acceptFriendInvite,
  updateFoodRecord,
  type FoodRecord,
  type Nutrients
} from '../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../utils/poster'
import { IconBreakfast, IconLunch, IconDinner, IconSnack } from '../../components/iconfont'

import './index.scss'

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const MEAL_ICON_CONFIG = {
  breakfast: { Icon: IconBreakfast, color: '#ff6900' },
  morning_snack: { Icon: IconSnack, color: '#7b61ff' },
  lunch: { Icon: IconLunch, color: '#00c950' },
  afternoon_snack: { Icon: IconSnack, color: '#ad46ff' },
  dinner: { Icon: IconDinner, color: '#2b7fff' },
  evening_snack: { Icon: IconSnack, color: '#5b21b6' },
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

function getInviteCodeFromUserId(userId: string): string {
  const raw = (userId || '').replace(/-/g, '').toLowerCase()
  return raw.length >= 8 ? raw.slice(0, 8) : ''
}

export default function RecordDetailPage() {
  const router = useRouter()
  const [record, setRecord] = React.useState<FoodRecord | null>(null)
  const [posterGenerating, setPosterGenerating] = React.useState(false)
  const [posterImageUrl, setPosterImageUrl] = React.useState<string | null>(null)
  const [showPosterModal, setShowPosterModal] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [isOwner, setIsOwner] = React.useState(false)
  const [showEditModal, setShowEditModal] = React.useState(false)
  const [editItems, setEditItems] = React.useState<Array<{
    name: string
    weight: number
    ratio: number
    intake: number
    nutrients: Nutrients
  }>>([])
  const [editSaving, setEditSaving] = React.useState(false)
  const [ownerNickname, setOwnerNickname] = React.useState('')
  const [ownerAvatar, setOwnerAvatar] = React.useState('')
  const [ownerInviteCode, setOwnerInviteCode] = React.useState('')
  const [inviteLoading, setInviteLoading] = React.useState(false)

  useEffect(() => {
    const loadRecord = async () => {
      const recordId = router.params?.id

      // 优先从 URL 参数获取 recordId（真实记录），否则从 storage 读取（食谱等特殊情况）
      if (recordId) {
        try {
          setLoading(true)
          // 统一使用公开分享接口加载记录（无需登录，任何人可访问）
          const res = await getSharedFoodRecord(recordId)
          const fetchedRecord = res.record
          setRecord(fetchedRecord)
          try {
            const inviterProfile = await getFriendInviteProfile(fetchedRecord.user_id)
            setOwnerNickname(inviterProfile.nickname || '')
            setOwnerAvatar(inviterProfile.avatar || '')
            setOwnerInviteCode(inviterProfile.invite_code || getInviteCodeFromUserId(fetchedRecord.user_id))
          } catch {
            setOwnerInviteCode(getInviteCodeFromUserId(fetchedRecord.user_id))
          }
          // 判断当前用户是否为记录创建者（用于显示编辑按钮）
          try {
            const currentUserId = Taro.getStorageSync('user_id')
            if (currentUserId && fetchedRecord.user_id === currentUserId) {
              setIsOwner(true)
            }
          } catch { /* ignore */ }
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

  const shareRecordId = record?.id || router.params?.id || ''
  const shareOwnerId = record?.user_id || router.params?.from_user_id || ''
  const inviteCode = ownerInviteCode || getInviteCodeFromUserId(shareOwnerId)
  const sharePath = `/pages/record-detail/index?id=${encodeURIComponent(shareRecordId)}${shareOwnerId ? `&from_user_id=${encodeURIComponent(shareOwnerId)}` : ''}${inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : ''}`

  useShareAppMessage(() => {
    const title = ownerNickname ? `${ownerNickname}的饮食记录，邀你一起健康打卡` : '来看看我的健康饮食记录吧！'
    return {
      title,
      path: sharePath,
      imageUrl: posterImageUrl || undefined
    }
  })

  useShareTimeline(() => {
    const title = ownerNickname ? `${ownerNickname}的饮食记录，邀你一起健康打卡` : '来看看我的健康饮食记录吧！'
    return {
      title,
      query: `id=${encodeURIComponent(shareRecordId)}${shareOwnerId ? `&from_user_id=${encodeURIComponent(shareOwnerId)}` : ''}${inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : ''}`,
      imageUrl: posterImageUrl || undefined
    }
  })

  /** 打开编辑弹窗，复制当前食物项数据 */
  const handleOpenEdit = useCallback(() => {
    if (!record) return
    setEditItems(
      (record.items || []).map(item => ({
        name: item.name,
        weight: item.weight,
        ratio: item.ratio ?? 100,
        intake: item.intake ?? 0,
        nutrients: { ...(item.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }) }
      }))
    )
    setShowEditModal(true)
  }, [record])

  /** 更新摄入克数，联动比例（允许超过 100%） */
  const updateIntake = useCallback((index: number, newIntake: number) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = { ...next[index] }
      item.intake = Math.max(0, Math.round(newIntake * 10) / 10)
      if (item.weight > 0) {
        item.ratio = Math.round((item.intake / item.weight) * 100)
      }
      next[index] = item
      return next
    })
  }, [])

  /** 更新比例（滑块 0-100），联动摄入克数 */
  const updateRatio = useCallback((index: number, newRatio: number) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = { ...next[index] }
      item.ratio = Math.max(0, Math.min(100, newRatio))
      item.intake = Math.round(item.weight * item.ratio / 100 * 10) / 10
      next[index] = item
      return next
    })
  }, [])

  /** 摄入克数加减按钮（允许超过原始重量） */
  const adjustIntake = useCallback((index: number, delta: number) => {
    setEditItems(prev => {
      const item = prev[index]
      if (!item) return prev
      const next = [...prev]
      const updated = { ...next[index] }
      updated.intake = Math.max(0, Math.round(((item.intake || 0) + delta) * 10) / 10)
      if (updated.weight > 0) {
        updated.ratio = Math.round((updated.intake / updated.weight) * 100)
      }
      next[index] = updated
      return next
    })
  }, [])

  /** 删除编辑中的某个食物项（需用户确认） */
  const removeEditItem = useCallback(async (index: number) => {
    const { confirm } = await Taro.showModal({
      title: '删除确认',
      content: `确定删除「${editItems[index]?.name || '该食物'}」吗？`,
      confirmText: '删除',
      confirmColor: '#ef4444'
    })
    if (!confirm) return
    setEditItems(prev => prev.filter((_, i) => i !== index))
  }, [editItems])

  if (loading || !record) {
    return (
      <View className="record-detail-page">
        <View className="empty-tip">{loading ? '加载中...' : '记录不存在'}</View>
      </View>
    )
  }

  /** 提交编辑 */
  const handleSaveEdit = async () => {
    if (editItems.length === 0) {
      Taro.showToast({ title: '至少保留一项食物', icon: 'none' })
      return
    }
    if (!record) return
    const { confirm } = await Taro.showModal({
      title: '确认修改',
      content: '确定保存对食物参数的修改吗？',
      confirmText: '确定',
      confirmColor: '#00bc7d'
    })
    if (!confirm) return
    setEditSaving(true)
    Taro.showLoading({ title: '保存中...', mask: true })
    try {
      const totalCalories = editItems.reduce((sum, item) => {
        return sum + (item.nutrients.calories * (item.ratio / 100))
      }, 0)
      const totalProtein = editItems.reduce((sum, item) => {
        return sum + (item.nutrients.protein * (item.ratio / 100))
      }, 0)
      const totalCarbs = editItems.reduce((sum, item) => {
        return sum + (item.nutrients.carbs * (item.ratio / 100))
      }, 0)
      const totalFat = editItems.reduce((sum, item) => {
        return sum + (item.nutrients.fat * (item.ratio / 100))
      }, 0)
      const totalWeight = editItems.reduce((sum, item) => sum + item.intake, 0)

      const { record: updated } = await updateFoodRecord(record.id, {
        items: editItems,
        total_calories: Math.round(totalCalories * 10) / 10,
        total_protein: Math.round(totalProtein * 10) / 10,
        total_carbs: Math.round(totalCarbs * 10) / 10,
        total_fat: Math.round(totalFat * 10) / 10,
        total_weight_grams: Math.round(totalWeight)
      })
      setRecord(updated)
      setShowEditModal(false)
      Taro.hideLoading()
      Taro.showToast({ title: '修改成功', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      setEditSaving(false)
    }
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

  const handleAcceptInvite = async () => {
    if (!inviteCode) {
      Taro.showToast({ title: '邀请码无效', icon: 'none' })
      return
    }
    if (!getAccessToken()) {
      const redirectUrl = sharePath
      Taro.navigateTo({
        url: `/pages/login/index?invite_code=${encodeURIComponent(inviteCode)}&redirect=${encodeURIComponent(redirectUrl)}`
      })
      return
    }
    if (inviteLoading) return
    setInviteLoading(true)
    try {
      const res = await acceptFriendInvite(inviteCode)
      Taro.showToast({
        title: res.status === 'request_sent' ? `已向${res.nickname || '对方'}发送申请` : '你们已是好友',
        icon: 'success'
      })
    } catch (e: any) {
      const msg = e?.message || '添加好友失败'
      Taro.showModal({
        title: '添加好友失败',
        content: msg.length > 280 ? `${msg.slice(0, 280)}...` : msg,
        showCancel: false,
        confirmText: '我知道了'
      })
    } finally {
      setInviteLoading(false)
    }
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
          // scene 最大 32 个字符，使用短邀请码承接「扫码加好友」
          const scene = inviteCode ? `fi=${inviteCode}` : 'share=1'
          // 部分账号/环境下 develop 码不可用，按优先级自动回退，确保尽量拿到真实二维码。
          const envCandidates: Array<'develop' | 'trial' | 'release'> =
            process.env.NODE_ENV === 'development'
              ? ['develop', 'trial', 'release']
              : ['release', 'trial', 'develop']

          for (const envVersion of envCandidates) {
            try {
              const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', envVersion)
              const img = await loadImage(base64)
              if (img) return img
            } catch (e) {
              console.warn(`QR code load failed for env=${envVersion}`, e)
            }
          }
          return null // fallback to fake QR code in poster
        }

        Promise.all([
          loadImage(record.image_path || ''),
          loadQRImage(),
          loadImage(ownerAvatar || '')
        ]).then(([mainImg, qrImg, avatarImg]) => {
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
              sharerNickname: ownerNickname,
              sharerAvatarImage: avatarImg,
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

        {!isOwner && inviteCode && (
          <View className="friend-invite-card">
            <View className="friend-invite-header">
              {ownerAvatar ? <Image className="friend-invite-avatar" src={ownerAvatar} mode="aspectFill" /> : null}
              <Text className="friend-invite-title">
                {ownerNickname ? `${ownerNickname} 邀请你成为食探好友` : '邀请你成为食探好友'}
              </Text>
            </View>
            <Text className="friend-invite-desc">未注册会先登录，登录后发送申请，需对方同意</Text>
            <Button className="friend-invite-btn" onClick={handleAcceptInvite} disabled={inviteLoading}>
              {inviteLoading ? '处理中...' : (getAccessToken() ? '发送好友申请' : '登录并发送申请')}
            </Button>
          </View>
        )}

        <View className="poster-actions">
          {isOwner && (
            <Button className="edit-record-btn" onClick={handleOpenEdit}>
              <Text className="iconfont icon-bianji" style={{ marginRight: 8 }}></Text>
              修改记录
            </Button>
          )}
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

      {/* 编辑记录弹窗 */}
      {showEditModal && (
        <View className="edit-modal" catchMove>
          <View className="edit-modal-mask" onClick={() => setShowEditModal(false)} />
          <View className="edit-modal-content">
            <View className="edit-modal-header">
              <Text className="edit-modal-title">修改食物参数</Text>
              <View className="edit-modal-close" onClick={() => setShowEditModal(false)} />
            </View>
            <ScrollView scrollY enhanced showScrollbar={false} className="edit-modal-body">
              {editItems.map((item, idx) => {
                const r = (item.ratio ?? 100) / 100
                const cal = Math.round(item.nutrients.calories * r * 10) / 10
                const pro = Math.round(item.nutrients.protein * r * 10) / 10
                const carb = Math.round(item.nutrients.carbs * r * 10) / 10
                const fat = Math.round(item.nutrients.fat * r * 10) / 10
                return (
                  <View key={idx} className="edit-food-card">
                    <View className="edit-food-header">
                      <Text className="edit-food-name">{item.name}</Text>
                      {editItems.length > 1 && (
                        <View className="edit-food-delete" onClick={() => removeEditItem(idx)}>
                          <Text className="iconfont icon-shanchu"></Text>
                        </View>
                      )}
                    </View>

                    {/* 摄入克数：加减按钮 + 手动输入 */}
                    <View className="edit-intake-section">
                      <Text className="edit-section-label">摄入克数</Text>
                      <View className="intake-adjuster">
                        <View className="adjust-btn minus" onClick={() => adjustIntake(idx, -10)}>
                          <Text className="adjust-btn-text">−</Text>
                        </View>
                        <Input
                          className="intake-input"
                          type="digit"
                          value={String(item.intake)}
                          onBlur={(e) => updateIntake(idx, parseFloat(e.detail.value) || 0)}
                        />
                        <Text className="intake-unit">g</Text>
                        <View className="adjust-btn plus" onClick={() => adjustIntake(idx, 10)}>
                          <Text className="adjust-btn-text">+</Text>
                        </View>
                      </View>
                    </View>

                    {/* 比例：滑块 */}
                    <View className="edit-ratio-section">
                      <View className="ratio-header">
                        <Text className="edit-section-label">摄入比例</Text>
                        <Text className={`ratio-value ${item.ratio > 100 ? 'over' : ''}`}>{item.ratio}%</Text>
                      </View>
                      <Slider
                        className="ratio-slider"
                        value={Math.min(100, item.ratio)}
                        min={0}
                        max={100}
                        step={5}
                        activeColor={item.ratio > 100 ? '#f59e0b' : '#00bc7d'}
                        blockSize={20}
                        onChange={(e) => updateRatio(idx, e.detail.value)}
                      />
                    </View>

                    {/* 营养值只读展示 */}
                    <View className="edit-nutrients-readonly">
                      <View className="nutrient-chip">
                        <Text className="nutrient-chip-label">热量</Text>
                        <Text className="nutrient-chip-value">{cal}<Text className="nutrient-chip-unit">kcal</Text></Text>
                      </View>
                      <View className="nutrient-chip">
                        <Text className="nutrient-chip-label">蛋白质</Text>
                        <Text className="nutrient-chip-value">{pro}<Text className="nutrient-chip-unit">g</Text></Text>
                      </View>
                      <View className="nutrient-chip">
                        <Text className="nutrient-chip-label">碳水</Text>
                        <Text className="nutrient-chip-value">{carb}<Text className="nutrient-chip-unit">g</Text></Text>
                      </View>
                      <View className="nutrient-chip">
                        <Text className="nutrient-chip-label">脂肪</Text>
                        <Text className="nutrient-chip-value">{fat}<Text className="nutrient-chip-unit">g</Text></Text>
                      </View>
                    </View>
                  </View>
                )
              })}
            </ScrollView>
            <View className="edit-modal-footer">
              <Button className="edit-cancel-btn" onClick={() => setShowEditModal(false)}>取消</Button>
              <Button className="edit-save-btn" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? '保存中...' : '保存修改'}
              </Button>
            </View>
          </View>
        </View>
      )}

      {/* 海报预览弹窗 */}
      {
        showPosterModal && posterImageUrl && (
          <View className="poster-modal">
            <View className="poster-modal-mask" onClick={() => setShowPosterModal(false)} catchMove />
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
