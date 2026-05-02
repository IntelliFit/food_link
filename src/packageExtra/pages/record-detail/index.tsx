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
  getPosterCalorieCompare,
  getMyMembership,
  claimSharePosterReward,
  showUnifiedApiError,
  type FoodRecord,
  type Nutrients
} from '../../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../../utils/poster'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'

import { IconBreakfast, IconLunch, IconDinner, IconSnack } from '../../../components/iconfont'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import CustomNavBar, { getNavBarHeight } from '../../../components/CustomNavBar'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'

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

type EditableNutrientField = 'calories' | 'protein' | 'carbs' | 'fat'

interface EditableFoodItem {
  name: string
  weight: number
  ratio: number
  intake: number
  nutrients: Nutrients
}

const EDITABLE_NUTRIENT_FIELDS: EditableNutrientField[] = ['calories', 'protein', 'carbs', 'fat']

const EDITABLE_NUTRIENT_META: Record<EditableNutrientField, { label: string; unit: string }> = {
  calories: { label: '热量', unit: 'kcal' },
  protein: { label: '蛋白质', unit: 'g' },
  carbs: { label: '碳水', unit: 'g' },
  fat: { label: '脂肪', unit: 'g' }
}

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const normalizeDisplayNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  const rounded = roundToSingleDecimal(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const getItemRatioFactor = (item: Pick<EditableFoodItem, 'ratio'>) => Math.max(0, item.ratio ?? 0) / 100

const getDisplayedNutrientValue = (item: EditableFoodItem, field: EditableNutrientField) => (
  roundToSingleDecimal((item.nutrients?.[field] ?? 0) * getItemRatioFactor(item))
)



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

type PosterCalorieCompare = {
  mealPlanKcal: number
  hasBaseline: boolean
  deltaKcal: number
  baselineKcal: number
}

/** 拉取海报胶囊数据：计划热量 + 可选「较昨」；无昨日同餐时仍返回计划用于右侧三点 */
async function fetchPosterCalorieCompareForRecord(record: FoodRecord): Promise<PosterCalorieCompare | null> {
  if (!getAccessToken() || !record.id) return null
  try {
    const data = await getPosterCalorieCompare(record.id)
    if (!data) return null
    return {
      mealPlanKcal: Number.isFinite(data.meal_plan_kcal) ? data.meal_plan_kcal : 0,
      hasBaseline: !!data.has_baseline,
      deltaKcal: Number.isFinite(data.delta_kcal) ? data.delta_kcal : 0,
      baselineKcal: Number.isFinite(data.baseline_kcal) ? data.baseline_kcal : 0,
    }
  } catch (error) {
    console.warn('[poster] poster-calorie-compare failed', error)
    return null
  }
}

function RecordDetailPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()
  const [record, setRecord] = React.useState<FoodRecord | null>(null)
  const [posterGenerating, setPosterGenerating] = React.useState(false)
  const [posterImageUrl, setPosterImageUrl] = React.useState<string | null>(null)
  const [showPosterModal, setShowPosterModal] = React.useState(false)
  const [isProUser, setIsProUser] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [isOwner, setIsOwner] = React.useState(false)
  const [showEditModal, setShowEditModal] = React.useState(false)
  const [editItems, setEditItems] = React.useState<EditableFoodItem[]>([])
  const [editSaving, setEditSaving] = React.useState(false)
  const [ownerNickname, setOwnerNickname] = React.useState('')
  const [ownerAvatar, setOwnerAvatar] = React.useState('')
  const [ownerInviteCode, setOwnerInviteCode] = React.useState('')
  const [inviteLoading, setInviteLoading] = React.useState(false)

  useEffect(() => {
    // 加载会员状态（用于海报样式判断）
    if (getAccessToken()) {
      getMyMembership().then(ms => setIsProUser(ms.is_pro)).catch(() => {})
    }

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
          await showUnifiedApiError(new Error(msg), '加载记录失败')
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
          void showUnifiedApiError(new Error('加载失败'), '加载失败')
          setTimeout(() => Taro.navigateBack(), 1500)
        }
      }
    }

    loadRecord()
  }, [router.params?.id])

  // 从首页餐食卡片跳转且带 autoPoster=1 时，自动触发生成海报
  const autoPosterTriggeredRef = React.useRef(false)
  useEffect(() => {
    if (record && router.params?.autoPoster === '1' && !autoPosterTriggeredRef.current) {
      autoPosterTriggeredRef.current = true
      const timer = setTimeout(() => {
        handleGeneratePoster()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [record, router.params?.autoPoster])

  const shareRecordId = record?.id || router.params?.id || ''
  const shareOwnerId = record?.user_id || router.params?.from_user_id || ''
  const inviteCode = ownerInviteCode || getInviteCodeFromUserId(shareOwnerId)
  const sharePath = `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(shareRecordId)}${shareOwnerId ? `&from_user_id=${encodeURIComponent(shareOwnerId)}` : ''}${inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : ''}`

  useShareAppMessage(() => {
    const title = ownerNickname ? `${ownerNickname}的饮食记录，邀你一起健康打卡` : '来看看我的健康饮食记录吧！'
    return {
      title,
      path: sharePath,
      imageUrl: posterImageUrl || record?.image_path || undefined
    }
  })

  useShareTimeline(() => {
    const title = ownerNickname ? `${ownerNickname}的饮食记录，邀你一起健康打卡` : '来看看我的健康饮食记录吧！'
    return {
      title,
      query: `id=${encodeURIComponent(shareRecordId)}${shareOwnerId ? `&from_user_id=${encodeURIComponent(shareOwnerId)}` : ''}${inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : ''}`,
      imageUrl: posterImageUrl || record?.image_path || undefined
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

  const updateEditItemName = useCallback((index: number, nextName: string) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = next[index]
      if (!item) return prev
      next[index] = { ...item, name: nextName }
      return next
    })
  }, [])

  const handleEditItemName = useCallback((index: number) => {
    const currentName = editItems[index]?.name || ''
    // @ts-ignore
    Taro.showModal({
      title: '修改食物名称',
      content: currentName,
      // @ts-ignore
      editable: true,
      placeholderText: '请输入新的食物名称',
      success: (res) => {
        if (!res.confirm) return
        const nextName = String((res as any).content ?? '').trim()
        if (!nextName) {
          Taro.showToast({ title: '名称不能为空', icon: 'none' })
          return
        }
        updateEditItemName(index, nextName)
      }
    })
  }, [editItems, updateEditItemName])

  const updateDisplayedNutrient = useCallback((index: number, field: EditableNutrientField, nextDisplayValue: number) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = next[index]
      if (!item) return prev
      const ratioFactor = getItemRatioFactor(item)
      const normalizedDisplayValue = Math.max(0, roundToSingleDecimal(nextDisplayValue))
      const nextNutrientValue = ratioFactor > 0
        ? roundToSingleDecimal(normalizedDisplayValue / ratioFactor)
        : normalizedDisplayValue

      next[index] = {
        ...item,
        nutrients: {
          ...item.nutrients,
          [field]: nextNutrientValue
        }
      }
      return next
    })
  }, [])

  const handleEditNutrient = useCallback((index: number, field: EditableNutrientField) => {
    const item = editItems[index]
    if (!item) return
    const meta = EDITABLE_NUTRIENT_META[field]
    const currentValue = getDisplayedNutrientValue(item, field)
    // @ts-ignore
    Taro.showModal({
      title: `修改${meta.label}${meta.unit === 'g' ? '(g)' : `(${meta.unit})`}`,
      content: normalizeDisplayNumber(currentValue),
      // @ts-ignore
      editable: true,
      placeholderText: `请输入${meta.label}`,
      success: (res) => {
        if (!res.confirm) return
        const nextText = String((res as any).content ?? '').trim()
        const parsed = Number(nextText)
        if (!nextText || !Number.isFinite(parsed) || parsed < 0) {
          Taro.showToast({ title: '请输入不小于0的数字', icon: 'none' })
          return
        }
        updateDisplayedNutrient(index, field, parsed)
      }
    })
  }, [editItems, updateDisplayedNutrient])

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

  const handleSharePosterImage = useCallback(() => {
    if (!posterImageUrl) return
    // @ts-ignore
    Taro.showShareImageMenu({
      path: posterImageUrl,
      fail: (err: { errMsg?: string }) => {
        console.error('showShareImageMenu fail', err)
        void showUnifiedApiError(new Error('分享失败，请保存图片后手动发送'), '分享失败，请保存图片后手动发送')
      }
    })
  }, [posterImageUrl])

  if (loading || !record) {
    return (
      <View className={`record-detail-root ${scheme === 'dark' ? 'record-detail-root--dark' : ''}`}>
        <CustomNavBar
          title='识别记录详情'
          showBack
          onBack={() => Taro.switchTab({ url: '/pages/index/index' })}
          color={scheme === 'dark' ? '#ffffff' : '#000000'}
          background={scheme === 'dark' ? '#101716' : '#f8fafc'}
        />
        <View className='record-detail-below-nav record-detail-loading-placeholder'>
          <View className='empty-tip'>
            {loading ? <View className='loading-spinner-md' /> : '记录不存在'}
          </View>
        </View>
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
      await showUnifiedApiError(e, '保存失败')
    } finally {
      setEditSaving(false)
    }
  }

  const mealName = MEAL_TYPE_NAMES[record.meal_type] || record.meal_type
  const mealIconConfig = MEAL_ICON_CONFIG[record.meal_type as keyof typeof MEAL_ICON_CONFIG] || MEAL_ICON_CONFIG.snack
  const timeStr = formatRecordTime(record.record_time)
  const items = record.items || []
  const hasRealRecordImage = Boolean(record.image_path)
  const recordDisplayImage = record.image_path || ''

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
        url: `${extraPkgUrl('/pages/login/index')}?invite_code=${encodeURIComponent(inviteCode)}&redirect=${encodeURIComponent(redirectUrl)}`
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

        const loadQRImage = async () => {
          // scene 最大 32 个字符，使用短邀请码承接「扫码加好友」
          const scene = inviteCode ? `fi=${inviteCode}` : 'share=1'
          // 部分账号/环境下 develop 码不可用，按优先级自动回退，确保尽量拿到真实二维码。
          const isDevelopmentEnv =
            typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development'
          const envCandidates: Array<'develop' | 'trial' | 'release'> =
            isDevelopmentEnv
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
          loadImage(ownerAvatar || ''),
          fetchPosterCalorieCompareForRecord(record)
        ]).then(([mainImg, qrImg, avatarImg, calorieCompare]) => {
          try {
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              Taro.hideLoading()
              setPosterGenerating(false)
              Taro.showToast({ title: '画布不可用', icon: 'none' })
              return
            }

            const dynamicHeight = computePosterHeight(
              ctx,
              record,
              POSTER_WIDTH,
              isProUser,
              calorieCompare || undefined
            )
            canvas.width = POSTER_WIDTH * dpr
            canvas.height = dynamicHeight * dpr
            ctx.scale(dpr, dpr)

            // 使用当前稳定海报绘制逻辑
            drawRecordPoster(ctx, {
              width: POSTER_WIDTH,
              height: dynamicHeight,
              record,
              calorieCompare: calorieCompare || undefined,
              image: mainImg,
              qrCodeImage: qrImg,
              sharerNickname: ownerNickname,
              sharerAvatarImage: avatarImg,
              isPro: isProUser,
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
                setShowPosterModal(true)
                if (isOwner && record?.id) {
                  claimSharePosterReward(record.id)
                    .then((rewardRes) => {
                      if (rewardRes.claimed && rewardRes.credits > 0) {
                        Taro.showToast({
                          title: `海报奖励 +${rewardRes.credits} 积分`,
                          icon: 'success'
                        })
                      }
                    })
                    .catch((rewardErr) => {
                      console.warn('claimSharePosterReward failed', rewardErr)
                    })
                }
              },
              fail: (err) => {
                Taro.hideLoading()
                setPosterGenerating(false)
                void showUnifiedApiError(new Error('生成失败'), '生成失败')
                console.error('canvasToTempFilePath fail', err)
              }
            })
          } catch (e) {
            Taro.hideLoading()
            setPosterGenerating(false)
            void showUnifiedApiError(e, '绘制失败')
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
          void showUnifiedApiError(new Error('保存失败'), '保存失败')
        }
      }
    })
  }

  const navBarHeight = getNavBarHeight()

  return (
    <View className={`record-detail-root ${scheme === 'dark' ? 'record-detail-root--dark' : ''}`}>
      <CustomNavBar
        title='识别记录详情'
        showBack
        onBack={() => Taro.switchTab({ url: '/pages/index/index' })}
        color={scheme === 'dark' ? '#ffffff' : '#000000'}
        background={scheme === 'dark' ? '#101716' : '#f8fafc'}
      />
      {/*
        海报预览/离屏 Canvas 勿放在 ScrollView 内：真机上 fixed 全屏层会相对滚动容器错位；
        与首页「今日小结」分享层结构一致（根节点下独立一层）
      */}
      <View className='record-detail-below-nav'>
      <ScrollView className='record-detail-page' scrollY style={{ height: `calc(100vh - ${navBarHeight}px)` }}>
      <View className='record-detail-body'>
        <View className='detail-header'>
          <View className='meal-badge'>
            <View className='meal-icon'>
              <mealIconConfig.Icon size={40} color={mealIconConfig.color} />
            </View>
            <View className='meal-badge-text'>
              <Text className='meal-name'>{mealName}</Text>
              <Text className='meal-time'>{timeStr}</Text>
            </View>
          </View>
          <View className='total-calorie'>
            <Text className='num'>{Math.round((record.total_calories ?? 0) * 10) / 10}</Text>
            <Text className='unit'>kcal</Text>
          </View>
        </View>

        <View
          className={`detail-image ${hasRealRecordImage ? '' : 'detail-image--logo'}`}
          onClick={() => {
            if (!record.image_path) return
            Taro.previewImage({
              urls: [record.image_path],
              current: record.image_path
            })
          }}
        >
          {hasRealRecordImage ? (
            <Image src={recordDisplayImage} mode='aspectFill' />
          ) : (
            <>
              <View className='detail-image-icon-wrap'>
                <Text className='iconfont icon-shiwu' style={{ fontSize: '72rpx', color: '#00bc7d' }} />
              </View>
              <Text className='detail-image-placeholder-text'>文字记录，未提供实物照片</Text>
            </>
          )}
        </View>

        {/* 用户选择的目标与状态 */}
        {(record.diet_goal || record.activity_timing) && (
          <View className='context-tags'>
            {record.diet_goal && record.diet_goal !== 'none' && (
              <View className='context-tag goal-tag'>
                <Text className='tag-icon iconfont icon-shangzhang'></Text>
                <Text className='tag-text'>{DIET_GOAL_NAMES[record.diet_goal] || record.diet_goal}</Text>
              </View>
            )}
            {record.activity_timing && record.activity_timing !== 'none' && (
              <View className='context-tag timing-tag'>
                <Text className='tag-icon iconfont icon-shizhong'></Text>
                <Text className='tag-text'>{ACTIVITY_TIMING_NAMES[record.activity_timing] || record.activity_timing}</Text>
              </View>
            )}
          </View>
        )}

        {
          record.description ? (
            <View className='detail-desc'>
              <Text className='label'>
                <Text className='iconfont icon-shiwu' style={{ marginRight: 6 }}></Text>
                识别描述
              </Text>
              <Text>{record.description}</Text>
            </View>
          ) : null
        }

        {
          record.insight ? (
            <View className='detail-insight'>
              <Text className='label'>
                <Text className='iconfont icon-a-144-lvye' style={{ marginRight: 6 }}></Text>
                AI 健康建议
              </Text>
              <Text>{record.insight}</Text>
            </View>
          ) : null
        }

        {
          record.pfc_ratio_comment ? (
            <View className='detail-insight'>
              <Text className='label'>
                <Text className='iconfont icon-tubiao-zhuzhuangtu' style={{ marginRight: 6 }}></Text>
                PFC 比例分析
              </Text>
              <Text>{record.pfc_ratio_comment}</Text>
            </View>
          ) : null
        }
        {
          record.absorption_notes ? (
            <View className='detail-insight'>
              <Text className='label'>
                <Text className='iconfont icon-huore' style={{ marginRight: 6 }}></Text>
                吸收与利用
              </Text>
              <Text>{record.absorption_notes}</Text>
            </View>
          ) : null
        }
        {
          record.context_advice ? (
            <View className='detail-insight'>
              <Text className='label'>
                <Text className='iconfont icon-shizhong' style={{ marginRight: 6 }}></Text>
                情境建议
              </Text>
              <Text>{record.context_advice}</Text>
            </View>
          ) : null
        }

        {!isOwner && inviteCode && (
          <View className='friend-invite-card'>
            <View className='friend-invite-header'>
              {ownerAvatar ? <Image className='friend-invite-avatar' src={ownerAvatar} mode='aspectFill' /> : null}
              <Text className='friend-invite-title'>
                {ownerNickname ? `${ownerNickname} 邀请你成为食探好友` : '邀请你成为食探好友'}
              </Text>
            </View>
            <Text className='friend-invite-desc'>未注册会先登录，登录后发送申请，需对方同意</Text>
            <Button className='friend-invite-btn' onClick={handleAcceptInvite} disabled={inviteLoading}>
              {inviteLoading ? <View className='btn-spinner' /> : (getAccessToken() ? '发送好友申请' : '登录并发送申请')}
            </Button>
          </View>
        )}

        <View className='poster-actions'>
          {isOwner && (
            <Button className='edit-record-btn' onClick={handleOpenEdit}>
              <Text className='iconfont icon-bianji' style={{ marginRight: 8 }}></Text>
              修改记录
            </Button>
          )}
          <Button className='poster-btn' onClick={handleGeneratePoster} disabled={posterGenerating}>
            {posterGenerating ? '生成中...' : '生成分享海报'}
          </Button>
        </View>

        <Text className='food-list-title'>食物明细</Text>
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
              <View key={index} className='food-item'>
                <View className='food-info'>
                  <Text className='food-name'>{item.name}</Text>
                  <Text className='food-meta'>
                    摄入 {item.intake ?? 0}g
                    {ratio !== 100 ? ` · 约 ${ratio}%` : ''}
                  </Text>
                  <View className='food-nutrients-detail'>
                    <Text className='nutrient-item'>蛋白 {protein.toFixed(1)}g</Text>
                    <Text className='nutrient-item'>碳水 {carbs.toFixed(1)}g</Text>
                    <Text className='nutrient-item'>脂肪 {fat.toFixed(1)}g</Text>
                    {fiber > 0 && <Text className='nutrient-item'>纤维 {fiber.toFixed(1)}g</Text>}
                    {sugar > 0 && <Text className='nutrient-item'>糖 {sugar.toFixed(1)}g</Text>}
                  </View>
                </View>
                <View className='food-nutrients'>
                  <Text className='food-calorie'>{Math.round(cal * 10) / 10} kcal</Text>
                </View>
              </View>
            )
          })
        ) : (
          <View className='empty-tip'>暂无食物明细</View>
        )}

        <View className='nutrition-summary-section'>
          <Text className='summary-title'>营养汇总</Text>
          <View className='summary-grid'>
            <View className='summary-item'>
              <Text className='summary-label'>总热量</Text>
              <Text className='summary-value highlight'>{Math.round((record.total_calories ?? 0) * 10) / 10}</Text>
              <Text className='summary-unit'>kcal</Text>
            </View>
            <View className='summary-item'>
              <Text className='summary-label'>总重量</Text>
              <Text className='summary-value'>{record.total_weight_grams ?? 0}</Text>
              <Text className='summary-unit'>g</Text>
            </View>
            <View className='summary-item'>
              <Text className='summary-label'>蛋白质</Text>
              <Text className='summary-value'>{Math.round((record.total_protein ?? 0) * 10) / 10}</Text>
              <Text className='summary-unit'>g</Text>
            </View>
            <View className='summary-item'>
              <Text className='summary-label'>碳水</Text>
              <Text className='summary-value'>{Math.round((record.total_carbs ?? 0) * 10) / 10}</Text>
              <Text className='summary-unit'>g</Text>
            </View>
            <View className='summary-item'>
              <Text className='summary-label'>脂肪</Text>
              <Text className='summary-value'>{Math.round((record.total_fat ?? 0) * 10) / 10}</Text>
              <Text className='summary-unit'>g</Text>
            </View>
            {(() => {
              const totalFiber = items.reduce((sum, item) => {
                const ratio = (item.ratio ?? 100) / 100
                return sum + ((item.nutrients?.fiber ?? 0) * ratio)
              }, 0)
              return totalFiber > 0 ? (
                <View className='summary-item'>
                  <Text className='summary-label'>膳食纤维</Text>
                  <Text className='summary-value'>{Math.round(totalFiber * 10) / 10}</Text>
                  <Text className='summary-unit'>g</Text>
                </View>
              ) : null
            })()}
            {(() => {
              const totalSugar = items.reduce((sum, item) => {
                const ratio = (item.ratio ?? 100) / 100
                return sum + ((item.nutrients?.sugar ?? 0) * ratio)
              }, 0)
              return totalSugar > 0 ? (
                <View className='summary-item'>
                  <Text className='summary-label'>糖分</Text>
                  <Text className='summary-value'>{Math.round(totalSugar * 10) / 10}</Text>
                  <Text className='summary-unit'>g</Text>
                </View>
              ) : null
            })()}
          </View>
        </View>
      </View>
      </ScrollView>
      </View>

      <View className='poster-canvas-wrap'>
        <Canvas type='2d' id='recordPosterCanvas' className='poster-canvas' style={{ width: `${POSTER_WIDTH}px`, height: `${POSTER_HEIGHT}px` }} />
      </View>

      {/* 编辑记录弹窗 */}
      {showEditModal && (
        <View className='edit-modal' catchMove>
          <View className='edit-modal-mask' onClick={() => setShowEditModal(false)} />
          <View className='edit-modal-content'>
            <View className='edit-modal-header'>
              <Text className='edit-modal-title'>修改食物参数</Text>
              <View className='edit-modal-close' onClick={() => setShowEditModal(false)} />
            </View>
            <ScrollView scrollY enhanced showScrollbar={false} className='edit-modal-body'>
              {editItems.map((item, idx) => {
                return (
                  <View key={idx} className='edit-food-card'>
                    <View className='edit-food-header'>
                      <View className='edit-food-title-wrap'>
                        <Text className='edit-food-name'>{item.name}</Text>
                        <View className='edit-food-name-btn' onClick={() => handleEditItemName(idx)}>
                          <Text className='iconfont icon-shouxieqianming'></Text>
                        </View>
                      </View>
                      {editItems.length > 1 && (
                        <View className='edit-food-delete' onClick={() => removeEditItem(idx)}>
                          <Text className='iconfont icon-shanchu'></Text>
                        </View>
                      )}
                    </View>

                    {/* 摄入克数：加减按钮 + 手动输入 */}
                    <View className='edit-intake-section'>
                      <Text className='edit-section-label'>摄入克数</Text>
                      <View className='intake-adjuster'>
                        <View className='adjust-btn minus' onClick={() => adjustIntake(idx, -10)}>
                          <Text className='adjust-btn-text'>−</Text>
                        </View>
                        <Input
                          className='intake-input'
                          type='digit'
                          value={String(item.intake)}
                          onBlur={(e) => updateIntake(idx, parseFloat(e.detail.value) || 0)}
                        />
                        <Text className='intake-unit'>g</Text>
                        <View className='adjust-btn plus' onClick={() => adjustIntake(idx, 10)}>
                          <Text className='adjust-btn-text'>+</Text>
                        </View>
                      </View>
                    </View>

                    {/* 比例：滑块 */}
                    <View className='edit-ratio-section'>
                      <View className='ratio-header'>
                        <Text className='edit-section-label'>摄入比例</Text>
                        <Text className={`ratio-value ${item.ratio > 100 ? 'over' : ''}`}>{item.ratio}%</Text>
                      </View>
                      <Slider
                        className='ratio-slider'
                        value={Math.min(100, item.ratio)}
                        min={0}
                        max={100}
                        step={5}
                        activeColor={item.ratio > 100 ? '#f59e0b' : '#00bc7d'}
                        blockSize={20}
                        onChange={(e) => updateRatio(idx, e.detail.value)}
                      />
                    </View>

                    <View className='edit-nutrients-header'>
                      <Text className='edit-section-label no-margin'>营养值</Text>
                      <Text className='edit-nutrients-tip'>点击任一项直接修改</Text>
                    </View>

                    <View className='edit-nutrients-grid'>
                      {EDITABLE_NUTRIENT_FIELDS.map((field) => {
                        const meta = EDITABLE_NUTRIENT_META[field]
                        const displayValue = getDisplayedNutrientValue(item, field)
                        return (
                          <View
                            key={`${idx}-${field}`}
                            className='nutrient-chip nutrient-chip-editable'
                            onClick={() => handleEditNutrient(idx, field)}
                          >
                            <Text className='nutrient-chip-label'>{meta.label}</Text>
                            <Text className='nutrient-chip-value'>
                              {normalizeDisplayNumber(displayValue)}
                              <Text className='nutrient-chip-unit'>{meta.unit}</Text>
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  </View>
                )
              })}
            </ScrollView>
            <View className='edit-modal-footer'>
              <Button className='edit-cancel-btn' onClick={() => setShowEditModal(false)}>取消</Button>
              <Button className='edit-save-btn' onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? <View className='btn-spinner' /> : '保存修改'}
              </Button>
            </View>
          </View>
        </View>
      )}

      {/* 海报预览弹窗 */}
      {
        showPosterModal && posterImageUrl && (
          <View className='poster-modal poster-modal--sheet' catchMove>
            <View className='poster-modal-shell' catchMove>
              <View className='poster-modal-topbar poster-modal-topbar--light poster-modal-topbar--title-only'>
                <Text className='poster-modal-title poster-modal-title--light'>分享今日卡片</Text>
              </View>
              <View className='poster-modal-dark-body'>
                <View className='poster-modal-inline-back' onClick={() => setShowPosterModal(false)}>
                  <View className='poster-modal-close poster-modal-inline-close-hit'>
                    <Text className='poster-modal-close-x'>×</Text>
                  </View>
                </View>
                <View className='poster-scroll-area'>
                  <View className='poster-modal-scroll-inner'>
                    <View className='poster-modal-card-wrap'>
                      <Image src={posterImageUrl} mode='widthFix' className='poster-modal-image' />
                    </View>
                  </View>
                </View>
              </View>
              <View className='poster-modal-bottom-bar'>
                <View className='poster-share-channel' onClick={handleSharePosterImage}>
                  <View className='poster-share-channel-icon poster-share-channel-icon-wechat'>
                    <Text className='iconfont icon-wechat poster-share-channel-glyph' />
                  </View>
                  <Text className='poster-share-channel-label'>微信</Text>
                </View>
                <View className='poster-share-channel' onClick={handleSavePoster}>
                  <View className='poster-share-channel-icon poster-share-channel-icon-save'>
                    <Text className='iconfont icon-download poster-share-channel-glyph' />
                  </View>
                  <Text className='poster-share-channel-label'>保存图片</Text>
                </View>
              </View>
            </View>
          </View>
        )
      }
    </View>
  )
}

export default withAuth(RecordDetailPage)
