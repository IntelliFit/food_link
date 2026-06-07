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
  showUnifiedApiError,
  type FoodRecord,
  type Nutrients
} from '../../../utils/api'
import { drawRecordPoster, POSTER_WIDTH, POSTER_HEIGHT, computePosterHeight } from '../../../utils/poster'
import { isShowShareImageMenuCancel } from '../../../utils/weapp-share-image'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import { getCurrentPosterUserProfile, getLocalPosterUserProfile, mergePosterUserProfile } from '../../../utils/poster-profile'
import { claimSharePosterRewardQuietly } from '../../../utils/share-reward'

import { IconBreakfast, IconCollapse, IconExpand, IconLunch, IconDinner, IconSnack } from '../../../components/iconfont'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import CustomNavBar, { getNavBarHeight } from '../../../components/CustomNavBar'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { COMMUNITY_FEED_CHANGED_EVENT, HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import {
  MealTypeField,
  normalizeSelectableMealType,
  type SelectableMealType
} from '../../../components/MealTypeSelector'
import { buildFoodRecordItemPayloadFromResultItem } from '../../../utils/food-record-item-payload'

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
  grossWeight?: number
  ediblePortionRatio?: number
  ediblePortionReason?: string
  ediblePortionSource?: string
  ratio: number
  intake: number
  waterMl?: number
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
  nutritionSource?: string | null
  matchedFoodId?: string | null
  packagedFoodId?: string
  packageMatchStatus?: string
  packageMatchConfidence?: number
  packageWeightSource?: string
  packageWeightApplied?: boolean
  packageWeightReason?: string
  packagedCandidates?: Array<Record<string, unknown>>
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

const resolveRecordItemRatio = (item: Pick<FoodRecord['items'][0], 'ratio' | 'intake' | 'weight'>): number => {
  const ratio = Number(item.ratio)
  if (Number.isFinite(ratio) && ratio > 0) return Math.min(100, ratio)
  const intake = Number(item.intake)
  const weight = Number(item.weight)
  if (Number.isFinite(intake) && Number.isFinite(weight) && intake >= 0 && weight > 0) {
    return Math.min(100, Math.round((intake / weight) * 1000) / 10)
  }
  return 100
}

const resolveRecordItemIntake = (item: Pick<FoodRecord['items'][0], 'ratio' | 'intake' | 'weight'>): number => {
  const intake = Number(item.intake)
  if (Number.isFinite(intake) && intake > 0) return intake
  const weight = Number(item.weight)
  if (!Number.isFinite(weight) || weight <= 0) return 0
  return Math.round((weight * resolveRecordItemRatio(item) / 100) * 10) / 10
}

type NutrientDetailKey = keyof Pick<Nutrients,
  'fiber' | 'sugar' | 'saturatedFat' | 'cholesterolMg' | 'sodiumMg' | 'potassiumMg' |
  'calciumMg' | 'ironMg' | 'magnesiumMg' | 'zincMg' | 'vitaminARaeMcg' | 'vitaminCMg' |
  'vitaminDMcg' | 'vitaminEMg' | 'vitaminKMcg' | 'thiaminMg' | 'riboflavinMg' |
  'niacinMg' | 'vitaminB6Mg' | 'folateMcg' | 'vitaminB12Mcg'
>

const NUTRIENT_DETAIL_META: Array<{ key: NutrientDetailKey; label: string; unit: string }> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { key: 'sodiumMg', label: '钠', unit: 'mg' },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' }
]

const normalizeNutrientValue = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

const formatNutrientDetailValue = (value: number) => {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

const getRecordItemWaterMl = (item: FoodRecord['items'][0]) => {
  const value = Number(item.water_ml ?? item.nutrients?.water_ml ?? item.nutrients?.waterMl ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

const getRecordItemNutrientDetailRows = (item: FoodRecord['items'][0]) => {
  const ratio = Math.max(0, resolveRecordItemRatio(item)) / 100
  return NUTRIENT_DETAIL_META.map((meta) => ({
    ...meta,
    value: normalizeNutrientValue(
      item.nutrients?.[meta.key] ?? (meta.key === 'sodiumMg' ? item.nutrients?.sodium_mg : undefined)
    ) * ratio
  }))
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
  const [calorieCompare, setCalorieCompare] = React.useState<PosterCalorieCompare | null>(null)
  const [isProUser, setIsProUser] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [isOwner, setIsOwner] = React.useState(false)
  const [showEditModal, setShowEditModal] = React.useState(false)
  const [editItems, setEditItems] = React.useState<EditableFoodItem[]>([])
  const [editMealType, setEditMealType] = React.useState<SelectableMealType>('afternoon_snack')
  const [editSaving, setEditSaving] = React.useState(false)
  const [ownerNickname, setOwnerNickname] = React.useState('')
  const [ownerAvatar, setOwnerAvatar] = React.useState('')
  const [ownerInviteCode, setOwnerInviteCode] = React.useState('')
  const [inviteLoading, setInviteLoading] = React.useState(false)
  const [expandedNutrientDetails, setExpandedNutrientDetails] = React.useState<Record<string, boolean>>({})
  const sharePosterRewardClaimingRef = React.useRef(false)

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
          // 预加载海报胶囊数据（对齐首页：提前请求，生成时直接使用）
          if (fetchedRecord.id && getAccessToken()) {
            fetchPosterCalorieCompareForRecord(fetchedRecord)
              .then(data => {
                if (data) setCalorieCompare(data)
              })
              .catch(() => {})
          }
          const localProfile = await getCurrentPosterUserProfile(fetchedRecord.user_id)
          if (localProfile.nickname) setOwnerNickname(localProfile.nickname)
          if (localProfile.avatar) setOwnerAvatar(localProfile.avatar)
          try {
            const inviterProfile = await getFriendInviteProfile(fetchedRecord.user_id)
            const mergedProfile = mergePosterUserProfile(inviterProfile, localProfile)
            setOwnerNickname(mergedProfile.nickname)
            setOwnerAvatar(mergedProfile.avatar)
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
  const handleGeneratePosterRef = React.useRef<(() => void) | null>(null)
  useEffect(() => {
    if (record && router.params?.autoPoster === '1' && !autoPosterTriggeredRef.current) {
      autoPosterTriggeredRef.current = true
      const timer = setTimeout(() => {
        handleGeneratePosterRef.current?.()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [record, router.params?.autoPoster])

  const shareRecordId = record?.id || router.params?.id || ''
  const shareOwnerId = record?.user_id || router.params?.from_user_id || ''
  const inviteCode = ownerInviteCode || getInviteCodeFromUserId(shareOwnerId)
  const sharePath = `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(shareRecordId)}${shareOwnerId ? `&from_user_id=${encodeURIComponent(shareOwnerId)}` : ''}${inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : ''}`

  useShareAppMessage(() => {
    const title = ownerNickname ? `${ownerNickname}邀你来食探，达标后各得15积分` : '加入食探并完成2天打卡，双方各得15积分'
    return {
      title,
      path: sharePath,
      imageUrl: posterImageUrl || record?.image_path || undefined
    }
  })

  useShareTimeline(() => {
    const title = ownerNickname ? `${ownerNickname}邀你来食探，达标后各得15积分` : '加入食探并完成2天打卡，双方各得15积分'
    return {
      title,
      query: `id=${encodeURIComponent(shareRecordId)}${shareOwnerId ? `&from_user_id=${encodeURIComponent(shareOwnerId)}` : ''}${inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : ''}`,
      imageUrl: posterImageUrl || record?.image_path || undefined
    }
  })

  /** 打开编辑弹窗，复制当前食物项数据 */
  const handleOpenEdit = useCallback(() => {
    if (!record) return
    setEditMealType(normalizeSelectableMealType(record.meal_type))
    setEditItems(
      (record.items || []).map(item => ({
        name: item.name,
        weight: item.weight,
        grossWeight: item.gross_weight_grams ?? item.grossWeightGrams ?? item.weight,
        ediblePortionRatio: item.edible_portion_ratio ?? item.ediblePortionRatio,
        ediblePortionReason: item.edible_portion_reason ?? item.ediblePortionReason,
        ediblePortionSource: item.edible_portion_source ?? item.ediblePortionSource,
        ratio: resolveRecordItemRatio(item),
        intake: resolveRecordItemIntake(item),
        waterMl: item.water_ml ?? item.waterMl,
        suggestedRatio: item.suggested_ratio ?? item.suggestedRatio,
        suggestedRatioReason: item.suggested_ratio_reason ?? item.suggestedRatioReason,
        suggestedRatioSource: item.suggested_ratio_source ?? item.suggestedRatioSource,
        nutritionSource: item.nutrition_source ?? item.nutritionSource,
        matchedFoodId: item.matched_food_id ?? item.matchedFoodId,
        packagedFoodId: item.packaged_food_id ?? item.packagedFoodId,
        packageMatchStatus: item.package_match_status ?? item.packageMatchStatus,
        packageMatchConfidence: item.package_match_confidence ?? item.packageMatchConfidence,
        packageWeightSource: item.package_weight_source ?? item.packageWeightSource,
        packageWeightApplied: item.package_weight_applied ?? item.packageWeightApplied,
        packageWeightReason: item.package_weight_reason ?? item.packageWeightReason,
        packagedCandidates: item.packaged_candidates ?? item.packagedCandidates,
        nutrients: { ...(item.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }) }
      }))
    )
    setShowEditModal(true)
  }, [record])

  /** 更新摄入克数，联动比例 */
  const updateIntake = useCallback((index: number, newIntake: number) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = { ...next[index] }
      item.intake = Math.max(0, Math.min(item.weight, Math.round(newIntake * 10) / 10))
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

  /** 摄入克数加减按钮 */
  const adjustIntake = useCallback((index: number, delta: number) => {
    setEditItems(prev => {
      const item = prev[index]
      if (!item) return prev
      const next = [...prev]
      const updated = { ...next[index] }
      updated.intake = Math.max(0, Math.min(updated.weight, Math.round(((item.intake || 0) + delta) * 10) / 10))
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

  const resolvePosterOwnerProfile = useCallback(async () => {
    const ownerUserId = String(shareOwnerId || Taro.getStorageSync('user_id') || '').trim()
    const fallbackInviteCode = ownerUserId ? getInviteCodeFromUserId(ownerUserId) : ''
    const currentProfile = await getCurrentPosterUserProfile(ownerUserId)
    if (!ownerUserId) {
      return { nickname: currentProfile.nickname, avatar: currentProfile.avatar, inviteCode: '' }
    }

    try {
      const remoteProfile = await getFriendInviteProfile(ownerUserId)
      const mergedProfile = mergePosterUserProfile(remoteProfile, currentProfile)
      return {
        nickname: mergedProfile.nickname,
        avatar: mergedProfile.avatar,
        inviteCode: remoteProfile.invite_code || fallbackInviteCode,
      }
    } catch {
      return {
        nickname: currentProfile.nickname,
        avatar: currentProfile.avatar,
        inviteCode: fallbackInviteCode,
      }
    }
  }, [shareOwnerId])

  const openOfficialImageMenu = useCallback(async (path: string) => {
    if (!path) return
    Taro.showShareImageMenu({
      path,
      success: () => {
        // 分享成功后领取积分奖励（record-detail 页面特有业务）
        if (!isOwner || !record?.id || sharePosterRewardClaimingRef.current) return
        sharePosterRewardClaimingRef.current = true
        claimSharePosterRewardQuietly(record.id)
          .finally(() => { sharePosterRewardClaimingRef.current = false })
      },
      fail: (err: { errMsg?: string }) => {
        if (isShowShareImageMenuCancel(err)) return
        console.error('showShareImageMenu fail', err)
        void showUnifiedApiError(new Error('打开微信图片菜单失败，请重试'), '打开微信图片菜单失败，请重试')
      }
    })
  }, [isOwner, record?.id])


  /** 生成海报并导出为临时图片（完全对齐首页 MealRecordPosterModal 逻辑） */
  const handleGeneratePoster = useCallback(() => {
    if (!record || posterGenerating) return
    setPosterGenerating(true)
    Taro.showLoading({ title: '生成海报中...' })

    const query = Taro.createSelectorQuery()
    query
      .select('#recordPosterCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res?.[0]?.node) {
          Taro.hideLoading()
          setPosterGenerating(false)
          void showUnifiedApiError(new Error('画布未就绪，请重试'), '画布未就绪，请重试')
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

        const resolvedProfile = await resolvePosterOwnerProfile()
        const posterNickname = resolvedProfile.nickname
        const posterAvatar = resolvedProfile.avatar
        const posterInviteCode = resolvedProfile.inviteCode || ownerInviteCode
        if (posterNickname) setOwnerNickname(posterNickname)
        if (posterAvatar) setOwnerAvatar(posterAvatar)
        if (posterInviteCode) setOwnerInviteCode(posterInviteCode)

        const loadQRImage = async () => {
          const scene = posterInviteCode ? `fi=${posterInviteCode}` : 'share=1'
          try {
            const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', 'release')
            const img = await loadImage(base64)
            if (img) return img
          } catch (e) {
            console.warn('QR code load failed for env=release', e)
          }
          return null
        }

        Promise.all([
          loadImage(record.image_path || ''),
          loadQRImage(),
          loadImage(posterAvatar)
        ]).then(([mainImg, qrImg, avatarImg]) => {
          try {
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              Taro.hideLoading()
              setPosterGenerating(false)
              void showUnifiedApiError(new Error('画布不可用'), '画布不可用')
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

            drawRecordPoster(ctx, {
              width: POSTER_WIDTH,
              height: dynamicHeight,
              record,
              calorieCompare: calorieCompare || undefined,
              image: mainImg,
              qrCodeImage: qrImg,
              sharerNickname: posterNickname,
              sharerAvatarImage: avatarImg,
              isPro: isProUser,
            })

            // JPG + 不透明：海报本身有底色，交给微信官方图片菜单处理分享/保存。
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
                void openOfficialImageMenu(resp.tempFilePath)
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
  }, [record, posterGenerating, isProUser, ownerInviteCode, calorieCompare, openOfficialImageMenu, resolvePosterOwnerProfile])
  handleGeneratePosterRef.current = handleGeneratePoster

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
        meal_type: editMealType,
        items: editItems.map((item) => buildFoodRecordItemPayloadFromResultItem(item, item.nutrients)),
        total_calories: Math.round(totalCalories * 10) / 10,
        total_protein: Math.round(totalProtein * 10) / 10,
        total_carbs: Math.round(totalCarbs * 10) / 10,
        total_fat: Math.round(totalFat * 10) / 10,
        total_weight_grams: Math.round(totalWeight)
      })
      setRecord(updated)
      setShowEditModal(false)
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
        Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
      } catch {
        /* ignore */
      }
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
    const ratio = resolveRecordItemRatio(item) / 100
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

  const toggleNutrientDetails = (key: string) => {
    setExpandedNutrientDetails(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
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
                {ownerNickname ? `${ownerNickname} 邀你来食探，达标后各得15积分` : '注册食探并完成2天打卡，双方各得15积分'}
              </Text>
            </View>
            <Text className='friend-invite-desc'>新用户注册后，7天内完成2个自然日饮食或运动记录即可到账；老用户也能直接加好友</Text>
            <Button className='friend-invite-btn' onClick={handleAcceptInvite} disabled={inviteLoading}>
              {inviteLoading ? <View className='btn-spinner' /> : (getAccessToken() ? '直接加好友' : '登录注册并领取邀请')}
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
            {posterGenerating ? '生成中...' : '生成分享卡片'}
          </Button>
        </View>

        <Text className='food-list-title'>食物明细</Text>
        {items.length > 0 ? (
          items.map((item, index) => {
            const cal = itemCalorie(item)
            const ratio = resolveRecordItemRatio(item)
            const protein = ((item.nutrients?.protein ?? 0) * ratio) / 100
            const carbs = ((item.nutrients?.carbs ?? 0) * ratio) / 100
            const fat = ((item.nutrients?.fat ?? 0) * ratio) / 100
            const waterMl = (getRecordItemWaterMl(item) * ratio) / 100
            const detailRows = getRecordItemNutrientDetailRows(item)
            const detailKey = `${record.id || 'record'}-${index}`
            const detailsExpanded = Boolean(expandedNutrientDetails[detailKey])
            return (
              <View key={index} className='food-item'>
                <View className='food-info'>
                  <Text className='food-name'>{item.name}</Text>
                  <Text className='food-meta'>
                    摄入 {item.intake ?? 0}g
                  </Text>
                  <View className={`food-ratio-badge ${ratio > 100 ? 'food-ratio-badge--over' : ''}`}>
                    <Text className='iconfont icon-tubiao-zhuzhuangtu food-ratio-icon' />
                    <Text className='food-ratio-text'>摄入比例 {normalizeDisplayNumber(ratio)}%</Text>
                  </View>
                  <View className='food-nutrients-detail'>
                    <Text className='nutrient-item'>蛋白 {protein.toFixed(1)}g</Text>
                    <Text className='nutrient-item'>碳水 {carbs.toFixed(1)}g</Text>
                    <Text className='nutrient-item'>脂肪 {fat.toFixed(1)}g</Text>
                    <Text className='nutrient-item'>含水 {Math.round(waterMl)}ml</Text>
                  </View>
                  <View
                    className='food-nutrient-toggle'
                    onClick={() => toggleNutrientDetails(detailKey)}
                  >
                    <Text className='food-nutrient-toggle-text'>
                      {detailsExpanded ? '收起更多营养' : '展开更多营养'}
                    </Text>
                    {detailsExpanded ? (
                      <IconCollapse size={22} color='#94a3b8' className='food-nutrient-toggle-icon' />
                    ) : (
                      <IconExpand size={22} color='#94a3b8' className='food-nutrient-toggle-icon' />
                    )}
                  </View>
                  {detailsExpanded && (
                    <View className='food-nutrient-detail-grid'>
                      {detailRows.map((row) => (
                        <View key={row.key} className='food-nutrient-detail-cell'>
                          <Text className='food-nutrient-detail-label'>{row.label}</Text>
                          <Text className='food-nutrient-detail-value'>
                            {formatNutrientDetailValue(row.value)}
                            <Text className='food-nutrient-detail-unit'>{row.unit}</Text>
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
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
                const ratio = resolveRecordItemRatio(item) / 100
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
                const ratio = resolveRecordItemRatio(item) / 100
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
              <Text className='edit-modal-title'>修改记录</Text>
              <View className='edit-modal-close' onClick={() => setShowEditModal(false)} />
            </View>
            <ScrollView scrollY enhanced showScrollbar={false} className='edit-modal-body'>
              <MealTypeField value={editMealType} onChange={setEditMealType} />
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

      {/* 海报生成后直接调用微信官方图片菜单，无预览弹窗（对齐首页 MealRecordPosterModal） */}
    </View>
  )
}

export default withAuth(RecordDetailPage)
