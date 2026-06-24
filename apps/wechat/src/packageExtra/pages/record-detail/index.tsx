import { View, Text, Image, ScrollView, Canvas, Button, Swiper, SwiperItem } from '@tarojs/components'
import React, { useEffect, useCallback } from 'react'
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getSharedFoodRecord,
  getAccessToken,
  getShareQrEnvVersion,
  getUnlimitedQRCode,
  getFriendInviteProfile,
  acceptFriendInvite,
  getPosterCalorieCompare,
  getMyMembership,
  getUserProfile,
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
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { COMMUNITY_FEED_CHANGED_EVENT, HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { MealRecordEditModal } from '../../../pages/index/components/MealRecordEditModal'
import OnboardingGuide from '../../../components/OnboardingGuide'
import {
  ONBOARDING_RECORD_DETAIL_GUIDE_KEY,
  shouldOfferOnboardingGuide,
} from '../../../utils/onboarding-guide-storage'
import { RECORD_DETAIL_ONBOARDING_STEPS } from './record-detail-onboarding-steps'

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

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const normalizeDisplayNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  const rounded = roundToSingleDecimal(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

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
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0)
  const [calorieCompare, setCalorieCompare] = React.useState<PosterCalorieCompare | null>(null)
  const [isProUser, setIsProUser] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [isOwner, setIsOwner] = React.useState(false)
  const [showEditModal, setShowEditModal] = React.useState(false)
  const [ownerNickname, setOwnerNickname] = React.useState('')
  const [ownerAvatar, setOwnerAvatar] = React.useState('')
  const [ownerInviteCode, setOwnerInviteCode] = React.useState('')
  const [inviteLoading, setInviteLoading] = React.useState(false)
  const [expandedNutrientDetails, setExpandedNutrientDetails] = React.useState<Record<string, boolean>>({})
  const [showOnboardingGuide, setShowOnboardingGuide] = React.useState(false)
  const [publicRecords, setPublicRecords] = React.useState<boolean | null>(null)
  const sharePosterRewardClaimingRef = React.useRef(false)

  const offerRecordDetailOnboardingGuide = async () => {
    if (!shouldOfferOnboardingGuide(ONBOARDING_RECORD_DETAIL_GUIDE_KEY)) return
    try {
      const profile = await getUserProfile()
      const isPublic = profile.public_records !== false
      setPublicRecords(isPublic)
      if (isPublic) {
        setShowOnboardingGuide(true)
      }
    } catch {
      // 获取隐私设置失败时默认展示，避免用户错过引导
      setPublicRecords(true)
      setShowOnboardingGuide(true)
    }
  }

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
          // 判断当前用户是否为记录创建者（用于显示编辑按钮、控制好友邀请卡）
          try {
            const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()
            const recordOwnerId = String(fetchedRecord.user_id || '').trim()
            const shareOwnerId = String(router.params?.from_user_id || '').trim()
            if (currentUserId && (recordOwnerId === currentUserId || shareOwnerId === currentUserId)) {
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

  // 通过 localStorage 控制记录详情页引导：仅保存流程首次进入、未看过引导且公开饮食记录时展示
  const shouldOfferRecordDetailGuide = useCallback(() => {
    return (
      router.params?.from_save === '1' &&
      shouldOfferOnboardingGuide(ONBOARDING_RECORD_DETAIL_GUIDE_KEY)
    )
  }, [router.params?.from_save])

  useEffect(() => {
    if (loading) return
    if (!shouldOfferRecordDetailGuide()) return
    offerRecordDetailOnboardingGuide()
  }, [loading, shouldOfferRecordDetailGuide])

  Taro.useDidShow(() => {
    if (!shouldOfferRecordDetailGuide()) return
    offerRecordDetailOnboardingGuide()
  })

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
    const title = ownerNickname ? `${ownerNickname}邀你来食探，达标后各得一周轻度版会员` : '加入食探并完成2天打卡，双方各得一周轻度版会员'
    return {
      title,
      path: sharePath,
      imageUrl: posterImageUrl || record?.image_path || undefined
    }
  })

  useShareTimeline(() => {
    const title = ownerNickname ? `${ownerNickname}邀你来食探，达标后各得一周轻度版会员` : '加入食探并完成2天打卡，双方各得一周轻度版会员'
    return {
      title,
      query: `id=${encodeURIComponent(shareRecordId)}${shareOwnerId ? `&from_user_id=${encodeURIComponent(shareOwnerId)}` : ''}${inviteCode ? `&invite_code=${encodeURIComponent(inviteCode)}` : ''}`,
      imageUrl: posterImageUrl || record?.image_path || undefined
    }
  })

  /** 打开编辑弹窗 */
  const handleOpenEdit = useCallback(() => {
    if (!record) return
    setShowEditModal(true)
  }, [record])

  /** 编辑成功后的回调：刷新记录数据 */
  const handleEditSuccess = useCallback(async () => {
    if (!record?.id) return
    try {
      const res = await getSharedFoodRecord(record.id)
      setRecord(res.record)
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
        Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
      } catch {
        /* ignore */
      }
    } catch (e: any) {
      console.warn('[record-detail] 编辑后刷新记录失败', e)
    }
  }, [record?.id])

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
            const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', getShareQrEnvVersion())
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
        <View className='record-detail-below-nav record-detail-loading-placeholder'>
          <View className='empty-tip'>
            {loading ? <View className='loading-spinner-md' /> : '记录不存在'}
          </View>
        </View>
      </View>
    )
  }

  const mealName = MEAL_TYPE_NAMES[record.meal_type] || record.meal_type
  const mealIconConfig = MEAL_ICON_CONFIG[record.meal_type as keyof typeof MEAL_ICON_CONFIG] || MEAL_ICON_CONFIG.snack
  const timeStr = formatRecordTime(record.record_time)
  const items = record.items || []
  const recordImages = record.image_paths?.length
    ? record.image_paths
    : record.image_path
      ? [record.image_path]
      : []
  const hasRealRecordImage = recordImages.length > 0
  const recordDisplayImage = recordImages[0] || ''

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


  return (
    <View className={`record-detail-root ${scheme === 'dark' ? 'record-detail-root--dark' : ''}`}>
      {/*
        海报预览/离屏 Canvas 勿放在 ScrollView 内：真机上 fixed 全屏层会相对滚动容器错位；
        与首页「今日小结」分享层结构一致（根节点下独立一层）
      */}
      <View className='record-detail-below-nav'>
      <ScrollView className='record-detail-page' scrollY style={{ height: '100vh' }}>
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
            if (!recordImages.length) return
            Taro.previewImage({
              urls: recordImages,
              current: recordImages[currentImageIndex]
            })
          }}
        >
          {hasRealRecordImage ? (
            recordImages.length > 1 ? (
              <Swiper
                className='record-detail-swiper'
                circular
                indicatorDots={false}
                onChange={(e) => setCurrentImageIndex(e.detail.current)}
                current={currentImageIndex}
              >
                {recordImages.map((path, index) => (
                  <SwiperItem key={index} className='record-detail-swiper-item'>
                    <Image src={path} mode='aspectFill' className='record-detail-swiper-image' />
                  </SwiperItem>
                ))}
              </Swiper>
            ) : (
              <Image src={recordDisplayImage} mode='aspectFill' />
            )
          ) : (
            <>
              <View className='detail-image-icon-wrap'>
                <Text className='iconfont icon-shiwu' style={{ fontSize: '72rpx', color: '#00bc7d' }} />
              </View>
              <Text className='detail-image-placeholder-text'>文字记录，未提供实物照片</Text>
            </>
          )}
          {recordImages.length > 1 && (
            <View className='record-detail-image-counter'>
              <Text className='record-detail-image-counter-text'>{currentImageIndex + 1}/{recordImages.length}</Text>
            </View>
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
                {ownerNickname ? `${ownerNickname} 邀你来食探，达标后各得一周轻度版会员` : '注册食探并完成2天打卡，双方各得一周轻度版会员'}
              </Text>
            </View>
            <Text className='friend-invite-desc'>新用户注册后，7天内完成2个自然日饮食或运动记录即可获得会员奖励；老用户也能直接加好友</Text>
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

      <MealRecordEditModal
        visible={showEditModal}
        record={record}
        onClose={() => setShowEditModal(false)}
        onSuccess={handleEditSuccess}
      />

      <OnboardingGuide
        visible={showOnboardingGuide}
        steps={RECORD_DETAIL_ONBOARDING_STEPS}
        storageKey={ONBOARDING_RECORD_DETAIL_GUIDE_KEY}
        onClose={() => setShowOnboardingGuide(false)}
      />

      {/* 海报生成后直接调用微信官方图片菜单，无预览弹窗（对齐首页 MealRecordPosterModal） */}
    </View>
  )
}

export default withAuth(RecordDetailPage)
