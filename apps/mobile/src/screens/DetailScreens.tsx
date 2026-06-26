import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import qrcode from 'qrcode-generator'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Apple, Check, Coffee, Cookie, Dumbbell, ImagePlus, Inbox, Link2, MessageCircle, Moon, MoreHorizontal, MoreVertical, Plus, QrCode, RefreshCw, Search, Send, Share2, Soup, Trash2, Undo2, UserPlus, Users, Utensils, X, type LucideIcon } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type AnalysisTask,
  type BodyMetricWeightEntry,
  type BodyMetricsSummary,
  type CommunityFeedTargetType,
  type CommunityNotificationItem,
  type ExerciseLogItem,
  type FoodExpiryDashboard,
  type FoodExpiryItem,
  type FoodRecord,
  type FoodRecordItemPayload,
  type FriendBlockItem,
  type FriendRequestItem,
  type FriendUserItem,
  type HealthProfile,
  type ManualFoodBrowseResult,
  type ManualFoodItem,
  type MealType,
  type MembershipStatus,
  type Nutrients,
  type RewardCenterResponse,
} from '@food-link/core'
import { apiClient, getRecentRequestTraces, RECENT_REQUEST_TRACE_LIMIT } from '../api'
import { AppButton } from '../components/AppButton'
import { APP_VERSION } from '../config'
import { CONSOLE_LOG_BUFFER_LIMIT, getRecentConsoleLogs } from '../diagnostics/consoleLogBuffer'
import { IconfontText } from '../components/Iconfont'
import type { RootStackParamList } from '../navigation/types'
import { isNativeWechatShareAvailable, shareWebpageToWechat } from '../native/wechatAuth'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { formatDateTime, formatShortDate, todayKey } from '../utils/date'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'
import {
  emitFoodExpiryChangedEvent,
  emitHomeDashboardRefreshEvent,
  emitHomeIntakeDataChangedEvent,
} from '../utils/home-events'

const appIcon = require('../../assets/icon.png')

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
type NotificationTab = 'all' | 'like' | 'comment'
type FriendTab = 'friends' | 'received' | 'sent' | 'blocks'
type ExpoSharingModule = typeof import('expo-sharing')
type ViewShotModule = typeof import('react-native-view-shot')
const notificationPageSize = 20
const commonTextFoods = ['米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包']
type TextRecordDietGoal = 'fat_loss' | 'muscle_gain' | 'maintain' | 'none'
type TextRecordActivityTiming = 'post_workout' | 'daily' | 'before_sleep' | 'none'
const textRecordMealOptions: Array<{ id: MealType; name: string; iconClass: string }> = [
  { id: 'breakfast', name: '早餐', iconClass: 'icon-zaocan' },
  { id: 'morning_snack', name: '早加餐', iconClass: 'icon-lingshi' },
  { id: 'lunch', name: '午餐', iconClass: 'icon-wucan' },
  { id: 'afternoon_snack', name: '午加餐', iconClass: 'icon-lingshi' },
  { id: 'dinner', name: '晚餐', iconClass: 'icon-wancan' },
  { id: 'evening_snack', name: '晚加餐', iconClass: 'icon-lingshi' },
]
const textRecordDietGoalOptions: Array<{ value: TextRecordDietGoal; label: string }> = [
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无' },
]
const textRecordActivityTimingOptions: Array<{ value: TextRecordActivityTiming; label: string }> = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' },
]
const healthProfileSteps = ['gender', 'age', 'height', 'weight', 'goal', 'activity', 'routine', 'medical', 'diet', 'allergy', 'notes'] as const
type HealthProfileStep = (typeof healthProfileSteps)[number]
const healthGenderOptions = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
] as const
const healthActivityOptions = [
  { value: 'sedentary', label: '久坐办公', desc: '大部分时间坐着，日常走动少', icon: '🛋️' },
  { value: 'light', label: '日常走动', desc: '通勤、家务或走路较多', icon: '🚶' },
  { value: 'moderate', label: '经常站立', desc: '工作中站立、来回走动较多', icon: '🏃' },
  { value: 'active', label: '体力劳动', desc: '搬运、巡店、户外等体力消耗明显', icon: '💪' },
] as const
const healthDietGoalOptions = [
  { value: 'fat_loss', label: '减重', desc: '健康瘦身', icon: '🔥' },
  { value: 'maintain', label: '保持', desc: '维持当前体重', icon: '⚖️' },
  { value: 'muscle_gain', label: '增重', desc: '增加肌肉/体重', icon: '💪' },
] as const
const healthMedicalOptions = [
  { value: 'diabetes', label: '糖尿病' },
  { value: 'hypertension', label: '高血压' },
  { value: 'gout', label: '痛风' },
  { value: 'hyperlipidemia', label: '高血脂' },
  { value: 'thyroid', label: '甲状腺疾病' },
  { value: 'none', label: '无' },
] as const
const healthDietPreferenceOptions = [
  { value: 'keto', label: '生酮', icon: '🥑' },
  { value: 'vegetarian', label: '素食', icon: '🥬' },
  { value: 'vegan', label: '纯素', icon: '🌱' },
  { value: 'low_salt', label: '低盐', icon: '🧂' },
  { value: 'gluten_free', label: '无麸质', icon: '🌾' },
  { value: 'none', label: '无', icon: '✨' },
] as const
const healthAllergyOptions = [
  { value: 'seafood', label: '海鲜', icon: '🦐' },
  { value: 'peanut', label: '花生', icon: '🥜' },
  { value: 'milk', label: '牛奶', icon: '🥛' },
  { value: 'egg', label: '鸡蛋', icon: '🥚' },
  { value: 'mango', label: '芒果', icon: '🥭' },
  { value: 'alcohol', label: '酒精', icon: '🍺' },
  { value: 'spicy', label: '辣', icon: '🌶️' },
  { value: 'none', label: '无', icon: '' },
] as const
const expiryStorageOptions = [
  { value: 'refrigerated', label: '冷藏' },
  { value: 'room_temp', label: '常温' },
  { value: 'frozen', label: '冷冻' },
] as const

function dateKeyFromDateTime(value?: string | null): string | undefined {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0]
}
const waterPresets = [150, 250, 350, 500]
const exercisePresets = ['跑步30分钟', '游泳45分钟', '瑜伽1小时', '骑车20分钟', '健身40分钟', '跳绳15分钟', '散步45分钟', 'HIIT20分钟']
const CIRCLE_POST_MAX_IMAGES = 3
const CIRCLE_POST_TITLE_MAX_LENGTH = 120
const CIRCLE_POST_BODY_MAX_LENGTH = 2000
const CIRCLE_POST_DRAFT_STORAGE_KEY = 'circle_post_draft_v2'
const CIRCLE_POST_DRAFT_TIP_KEY = 'circle_post_draft_tip_shown_v1'
const FEEDBACK_MAX_IMAGES = 4
const OFFICIAL_EMAIL = 'jianwen_ma@stu.pku.edu.cn'
type FeedbackCategoryKey = 'bug' | 'suggestion' | 'experience' | 'other'

type CirclePostImageItem = {
  id: string
  url: string
  uploading?: boolean
}

type CirclePostNutritionKey =
  | 'total_calories'
  | 'total_protein'
  | 'total_carbs'
  | 'total_fat'
  | 'fiber'
  | 'sugar'
  | 'sodium_mg'
  | 'total_weight_grams'

type CirclePostNutritionFormState = Record<CirclePostNutritionKey, string>

const emptyCirclePostNutrition: CirclePostNutritionFormState = {
  total_calories: '',
  total_protein: '',
  total_carbs: '',
  total_fat: '',
  fiber: '',
  sugar: '',
  sodium_mg: '',
  total_weight_grams: '',
}

const circlePostNutritionFields: Array<{
  key: CirclePostNutritionKey
  label: string
  unit: string
  placeholder: string
  max?: number
}> = [
  { key: 'total_calories', label: '热量', unit: 'kcal', placeholder: '0', max: 20000 },
  { key: 'total_protein', label: '蛋白质', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'total_carbs', label: '碳水', unit: 'g', placeholder: '0', max: 5000 },
  { key: 'total_fat', label: '脂肪', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'fiber', label: '膳食纤维', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'sugar', label: '糖分', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'sodium_mg', label: '钠', unit: 'mg', placeholder: '0', max: 50000 },
  { key: 'total_weight_grams', label: '总重量', unit: 'g', placeholder: '0', max: 50000 },
]

type CirclePostDraft = {
  title?: string
  body?: string
  images?: string[] | CirclePostImageItem[]
  nutritionEnabled?: boolean
  nutrition?: Partial<CirclePostNutritionFormState>
  savedAt?: string
}

function normalizeCirclePostNutritionInput(key: CirclePostNutritionKey, value: string): string {
  const field = circlePostNutritionFields.find((item) => item.key === key)
  const numeric = value.replace(/[^\d.]/g, '')
  const parts = numeric.split('.')
  const normalized = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : numeric
  if (field?.max && Number(normalized) > field.max) return String(field.max)
  return normalized
}

function buildCirclePostNutritionInput(state: CirclePostNutritionFormState) {
  const nutrition: {
    total_calories?: number
    total_protein?: number
    total_carbs?: number
    total_fat?: number
    fiber?: number
    sugar?: number
    sodium_mg?: number
    total_weight_grams?: number
  } = {}
  let hasValue = false
  circlePostNutritionFields.forEach(({ key }) => {
    const value = numberOrUndefined(state[key])
    if (value !== undefined) {
      nutrition[key] = value
      hasValue = true
    }
  })
  return hasValue ? nutrition : undefined
}

function circlePostNutritionHasValue(state: CirclePostNutritionFormState): boolean {
  return circlePostNutritionFields.some(({ key }) => state[key].trim().length > 0)
}

const feedbackCategoryOptions: Array<{ value: FeedbackCategoryKey; label: string; desc: string }> = [
  { value: 'bug', label: '问题反馈', desc: '页面异常、识别失败、数据不对' },
  { value: 'suggestion', label: '功能建议', desc: '想要的新功能或体验优化' },
  { value: 'experience', label: '使用体验', desc: '流程、文案、交互上的感受' },
  { value: 'other', label: '其他', desc: '其他想告诉我们的内容' },
]

type EditableRecordItem = {
  name: string
  weight: string
  ratio: string
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  sugar: string
  waterMl: string
  sodiumMg: string
  source: FoodRecord['items'][number]
}
type AppDialog = ReturnType<typeof useAppDialog>
type FoodRecordShareTarget = 'wechat_session' | 'wechat_timeline' | 'poster' | 'poster_image' | 'copy_link' | 'system' | 'cancel'

type PendingFoodRecordShare = {
  record: FoodRecord
  shareUrl: string
  title: string
  description: string
  resolve: (shared: boolean) => void
  busyTarget?: FoodRecordShareTarget
}

function useFoodRecordShareSheet(dialog: AppDialog) {
  const insets = useSafeAreaInsets()
  const [pendingShare, setPendingShare] = useState<PendingFoodRecordShare | null>(null)
  const [posterShare, setPosterShare] = useState<PendingFoodRecordShare | null>(null)

  const finishShare = useCallback((current: PendingFoodRecordShare, shared: boolean) => {
    setPendingShare(null)
    current.resolve(shared)
  }, [])

  const shareFoodRecord = useCallback((record: FoodRecord) => {
    const shareUrl = apiClient.buildFoodRecordShareUrl(record.id)
    const title = buildRecordShareTitle(record)
    const description = buildRecordShareDescription(record)
    return new Promise<boolean>((resolve) => {
      setPendingShare({ record, shareUrl, title, description, resolve })
    })
  }, [])

  const closeShareSheet = useCallback(() => {
    if (!pendingShare || pendingShare.busyTarget) return
    finishShare(pendingShare, false)
  }, [finishShare, pendingShare])

  const runShareTarget = useCallback(async (target: FoodRecordShareTarget) => {
    const current = pendingShare
    if (!current || current.busyTarget || target === 'cancel') {
      if (current && target === 'cancel') finishShare(current, false)
      return
    }
    if (target === 'poster') {
      setPendingShare(null)
      setPosterShare(current)
      return
    }
    setPendingShare((value) => (value ? { ...value, busyTarget: target } : value))
    try {
      if (target === 'copy_link') {
        await Clipboard.setStringAsync(current.shareUrl)
        finishShare(current, true)
        await dialog.alert('链接已复制', '可以粘贴到微信聊天或其他 App。', 'success')
        return
      }
      if (target === 'wechat_session' || target === 'wechat_timeline') {
        try {
          await shareWebpageToWechat({
            webpageUrl: current.shareUrl,
            title: current.title,
            description: current.description,
            scene: target === 'wechat_timeline' ? 'timeline' : 'session',
          })
          finishShare(current, true)
          return
        } catch (error) {
          setPendingShare(null)
          const fallback = await dialog.confirm({
            title: '微信分享不可用',
            message: userFacingErrorMessage(error),
            confirmText: '用更多方式',
            cancelText: '取消',
          })
          if (fallback) {
            const shared = await shareTextToSystem(current.title, buildRecordShareMessage(current.record, current.shareUrl), current.shareUrl)
            current.resolve(shared)
          } else {
            current.resolve(false)
          }
          return
        }
      }
      const shared = await shareTextToSystem(current.title, buildRecordShareMessage(current.record, current.shareUrl), current.shareUrl)
      finishShare(current, shared)
    } catch (error) {
      finishShare(current, false)
      await dialog.alert('分享失败', userFacingErrorMessage(error), 'danger')
    }
  }, [dialog, finishShare, pendingShare])

  const closePoster = useCallback(() => {
    if (!posterShare || posterShare.busyTarget) return
    setPosterShare(null)
    posterShare.resolve(false)
  }, [posterShare])

  const finishPoster = useCallback((current: PendingFoodRecordShare, shared: boolean) => {
    setPosterShare(null)
    current.resolve(shared)
  }, [])

  const runPosterAction = useCallback(async (target: 'copy_link' | 'system') => {
    const current = posterShare
    if (!current || current.busyTarget) return
    setPosterShare((value) => (value ? { ...value, busyTarget: target } : value))
    try {
      if (target === 'copy_link') {
        await Clipboard.setStringAsync(current.shareUrl)
        finishPoster(current, true)
        await dialog.alert('链接已复制', '可以粘贴到微信聊天或其他 App。', 'success')
        return
      }
      const shared = await shareTextToSystem(current.title, buildRecordShareMessage(current.record, current.shareUrl), current.shareUrl)
      finishPoster(current, shared)
    } catch (error) {
      finishPoster(current, false)
      await dialog.alert('分享失败', userFacingErrorMessage(error), 'danger')
    }
  }, [dialog, finishPoster, posterShare])

  const runPosterImageShare = useCallback(async (imageUri: string) => {
    const current = posterShare
    if (!current || current.busyTarget) return
    setPosterShare((value) => (value ? { ...value, busyTarget: 'poster_image' } : value))
    try {
      const shared = await sharePosterImageToSystem(current.title, imageUri)
      finishPoster(current, shared)
    } catch (error) {
      setPosterShare((value) => (value ? { ...value, busyTarget: undefined } : value))
      await dialog.alert('海报分享不可用', `${userFacingErrorMessage(error)}\n\n可以先直接扫码，或复制链接分享。`, 'danger')
    }
  }, [dialog, finishPoster, posterShare])

  const handlePosterCaptureError = useCallback(async (error: unknown) => {
    await dialog.alert('海报生成失败', `${userFacingErrorMessage(error)}\n\n可以先直接扫码，或复制链接分享。`, 'danger')
  }, [dialog])

  const canShareToWechat = isNativeWechatShareAvailable()
  const shareSheet = (
    <>
      <Modal visible={Boolean(pendingShare)} transparent animationType="fade" onRequestClose={closeShareSheet}>
        <Pressable style={styles.foodShareBackdrop} onPress={closeShareSheet}>
          <Pressable style={[styles.foodShareSheet, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]} onPress={(event) => event.stopPropagation?.()}>
            <View style={styles.foodShareHandle} />
            <View style={styles.foodShareHeader}>
              <View style={styles.foodShareHeaderSpacer} />
              <Text style={styles.foodShareTitle}>分享至</Text>
              <Pressable hitSlop={10} style={styles.foodShareCloseButton} disabled={Boolean(pendingShare?.busyTarget)} onPress={closeShareSheet}>
                <X size={22} color="#374151" strokeWidth={2.4} />
              </Pressable>
            </View>
            <View style={styles.foodShareGrid}>
              {canShareToWechat ? (
                <>
                  <FoodShareSheetAction
                    label="微信好友"
                    Icon={MessageCircle}
                    color="#07c160"
                    disabled={!pendingShare || Boolean(pendingShare.busyTarget)}
                    busy={pendingShare?.busyTarget === 'wechat_session'}
                    onPress={() => void runShareTarget('wechat_session')}
                  />
                  <FoodShareSheetAction
                    label="朋友圈"
                    Icon={Users}
                    color="#63c62e"
                    disabled={!pendingShare || Boolean(pendingShare.busyTarget)}
                    busy={pendingShare?.busyTarget === 'wechat_timeline'}
                    onPress={() => void runShareTarget('wechat_timeline')}
                  />
                </>
              ) : null}
              <FoodShareSheetAction
                label="二维码海报"
                Icon={QrCode}
                color="#00bc7d"
                disabled={!pendingShare || Boolean(pendingShare.busyTarget)}
                busy={false}
                onPress={() => void runShareTarget('poster')}
              />
              <FoodShareSheetAction
                label="更多方式"
                Icon={MoreHorizontal}
                color="#38bdf8"
                disabled={!pendingShare || Boolean(pendingShare.busyTarget)}
                busy={pendingShare?.busyTarget === 'system'}
                onPress={() => void runShareTarget('system')}
              />
            </View>
            <View style={styles.foodShareDivider} />
            <View style={styles.foodShareGrid}>
              <FoodShareSheetAction
                label="复制链接"
                Icon={Link2}
                color="#94a3b8"
                disabled={!pendingShare || Boolean(pendingShare.busyTarget)}
                busy={pendingShare?.busyTarget === 'copy_link'}
                onPress={() => void runShareTarget('copy_link')}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <FoodRecordPosterModal
        share={posterShare}
        bottomInset={insets.bottom}
        onClose={closePoster}
        onCopy={() => void runPosterAction('copy_link')}
        onSharePoster={(uri) => void runPosterImageShare(uri)}
        onCaptureError={(error) => void handlePosterCaptureError(error)}
      />
    </>
  )

  return { shareFoodRecord, shareSheet }
}

function FoodShareSheetAction({
  label,
  Icon,
  color,
  disabled,
  busy,
  onPress,
}: {
  label: string
  Icon: LucideIcon
  color: string
  disabled?: boolean
  busy?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [styles.foodShareAction, pressed && styles.foodShareActionPressed, disabled && styles.foodShareActionDisabled]}
      onPress={onPress}
    >
      <View style={[styles.foodShareActionIcon, { backgroundColor: color }]}>
        {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <Icon size={28} color="#ffffff" strokeWidth={2.4} />}
      </View>
      <Text style={styles.foodShareActionText} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function FoodRecordPosterModal({
  share,
  bottomInset,
  onClose,
  onCopy,
  onSharePoster,
  onCaptureError,
}: {
  share: PendingFoodRecordShare | null
  bottomInset: number
  onClose: () => void
  onCopy: () => void
  onSharePoster: (imageUri: string) => void
  onCaptureError: (error: unknown) => void
}) {
  const posterCardRef = useRef<View>(null)
  const [capturing, setCapturing] = useState(false)
  const [posterProfile, setPosterProfile] = useState<{ nickname?: string; avatar?: string } | null>(null)
  const record = share?.record
  const imageUrl = recordImageUrls(record || null)[0]
  const posterDate = getPosterDateInfo(record?.record_time)
  const posterItems = (record?.items || []).slice(0, 4)
  const overflowItemCount = Math.max(0, (record?.items || []).length - posterItems.length)
  const protein = Math.round(Number(record?.total_protein || 0))
  const carbs = Math.round(Number(record?.total_carbs || 0))
  const fat = Math.round(Number(record?.total_fat || 0))
  const macroTotal = protein + carbs + fat
  const busy = Boolean(share?.busyTarget) || capturing

  useEffect(() => {
    if (!share) return
    let active = true
    apiClient.getUserProfile()
      .then((profile) => {
        if (!active) return
        setPosterProfile({ nickname: profile.nickname || '', avatar: profile.avatar || '' })
      })
      .catch(() => {
        if (active) setPosterProfile(null)
      })
    return () => { active = false }
  }, [share])

  const handleSharePoster = useCallback(async () => {
    if (!share || busy) return
    setCapturing(true)
    try {
      const viewShot = getViewShotModule()
      if (!viewShot?.captureRef) {
        throw new Error('当前安装包暂不支持生成海报图片，请更新到最新版 App')
      }
      const uri = await viewShot.captureRef(posterCardRef, {
        format: 'png',
        quality: 0.96,
        result: 'tmpfile',
        fileName: `foodlink-record-${String(share.record.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'poster'}`,
      })
      onSharePoster(uri)
    } catch (error) {
      onCaptureError(error)
    } finally {
      setCapturing(false)
    }
  }, [busy, onCaptureError, onSharePoster, share])

  return (
    <Modal visible={Boolean(share)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.foodPosterBackdrop}>
        <View style={[styles.foodPosterSheet, { paddingBottom: Math.max(bottomInset, 14) + 14 }]}>
          <View style={styles.foodPosterHeader}>
            <Text style={styles.foodPosterHeaderTitle}>二维码海报</Text>
            <Pressable hitSlop={10} style={styles.foodShareCloseButton} disabled={busy} onPress={onClose}>
              <X size={22} color="#374151" strokeWidth={2.4} />
            </Pressable>
          </View>
          <ScrollView style={styles.foodPosterScroll} contentContainerStyle={styles.foodPosterScrollContent} showsVerticalScrollIndicator={false}>
            <View ref={posterCardRef} collapsable={false} style={styles.foodPosterCard}>
              <View style={styles.foodPosterImageWrap}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.foodPosterImage} resizeMode='cover' />
                ) : (
                  <View style={styles.foodPosterImageFallback}>
                    <Text style={styles.foodPosterImageFallbackText}>{mealLabelForPoster(record?.meal_type)}</Text>
                  </View>
                )}
                <View style={styles.foodPosterImageScrim} />
                <View style={styles.foodPosterMealBadge}>
                  <Text style={styles.foodPosterMealBadgeText}>{mealLabelForPoster(record?.meal_type)}</Text>
                </View>
                <View style={styles.foodPosterDateRow}>
                  <Text style={styles.foodPosterDateDay}>{posterDate.day}</Text>
                  <Text style={styles.foodPosterDateMonth}> {posterDate.month}.</Text>
                </View>
              </View>

              <View style={styles.foodPosterBody}>
                <View style={styles.foodPosterCalorieRow}>
                  <View style={styles.foodPosterCalorieTextRow}>
                    <Text style={styles.foodPosterCalories}>{Math.round(Number(record?.total_calories || 0)).toLocaleString('en-US')}</Text>
                    <Text style={styles.foodPosterCaloriesUnit}> kcal</Text>
                  </View>
                  <View style={styles.foodPosterDotsChip}>
                    {[0, 1, 2].map((index) => (
                      <View key={`poster-dot-${index}`} style={styles.foodPosterDotOuter}>
                        {index < getPosterDotLevel(record) ? <View style={styles.foodPosterDotInner} /> : null}
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.foodPosterMacroLabels}>
                  <View style={styles.foodPosterMacroSide}>
                    <Text style={[styles.foodPosterMacroName, styles.foodPosterMacroProtein]}>蛋白质</Text>
                    <Text style={styles.foodPosterMacroValue}>{protein}g</Text>
                  </View>
                  <View style={styles.foodPosterMacroCenter}>
                    <Text style={[styles.foodPosterMacroName, styles.foodPosterMacroCarbs]}>碳水</Text>
                    <Text style={styles.foodPosterMacroValue}>{carbs}g</Text>
                  </View>
                  <View style={[styles.foodPosterMacroSide, styles.foodPosterMacroSideRight]}>
                    <Text style={[styles.foodPosterMacroName, styles.foodPosterMacroFat]}>脂肪</Text>
                    <Text style={styles.foodPosterMacroValue}>{fat}g</Text>
                  </View>
                </View>
                <View style={styles.foodPosterMacroBar}>
                  <View style={[styles.foodPosterMacroBarSegment, styles.foodPosterMacroBarProtein, { flex: macroTotal > 0 ? protein : 1 }]} />
                  <View style={[styles.foodPosterMacroBarSegment, styles.foodPosterMacroBarCarbs, { flex: macroTotal > 0 ? carbs : 1 }]} />
                  <View style={[styles.foodPosterMacroBarSegment, styles.foodPosterMacroBarFat, { flex: macroTotal > 0 ? fat : 1 }]} />
                </View>

                <View style={styles.foodPosterDivider} />
                <View style={styles.foodPosterItems}>
                  {posterItems.map((item, index) => (
                    <FoodPosterItemRow item={item} key={`${String(item.name || 'food')}-${index}`} />
                  ))}
                  {overflowItemCount > 0 ? (
                    <Text style={styles.foodPosterOverflowText}>还有 {overflowItemCount} 项</Text>
                  ) : null}
                </View>

                <View style={styles.foodPosterFooter}>
                  <PosterFooterAvatar profile={posterProfile} />
                  <View style={styles.foodPosterFooterText}>
                    <Text style={styles.foodPosterFooterTitle} numberOfLines={1}>
                      {posterProfile?.nickname ? `${posterProfile.nickname} 的饮食分享` : '智健食探'}
                    </Text>
                    <Text style={styles.foodPosterFooterHint} numberOfLines={1}>扫码注册食探，达标后各得15积分</Text>
                  </View>
                  <RecordShareQrCode value={share?.shareUrl || ''} />
                </View>
              </View>
            </View>
          </ScrollView>

          <View style={styles.foodPosterActions}>
            <Pressable
              disabled={busy}
              style={({ pressed }) => [styles.foodPosterActionButton, pressed && styles.pressed, busy && styles.foodShareActionDisabled]}
              onPress={handleSharePoster}
            >
              {capturing || share?.busyTarget === 'poster_image' ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.foodPosterActionText}>分享海报</Text>}
            </Pressable>
            <Pressable
              disabled={busy}
              style={({ pressed }) => [styles.foodPosterSecondaryButton, pressed && styles.pressed, busy && styles.foodShareActionDisabled]}
              onPress={onCopy}
            >
              {share?.busyTarget === 'copy_link' ? <ActivityIndicator color={colors.brand} size="small" /> : <Text style={styles.foodPosterSecondaryText}>复制链接</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function FoodPosterItemRow({ item }: { item: FoodRecord['items'][number] }) {
  const ratio = recordItemRatio(item)
  const intake = Math.round(recordItemIntake(item))
  const calories = Math.round(recordItemKcal(item))
  return (
    <View style={styles.foodPosterItemRow}>
      <Text style={styles.foodPosterItemNameWrap} numberOfLines={1}>
        <Text style={styles.foodPosterItemName}>{String(item.name || '食物')}</Text>
        <Text style={styles.foodPosterItemRatio}>（{formatPosterRatio(ratio)}）</Text>
      </Text>
      <Text style={styles.foodPosterItemMeta} numberOfLines={1}>{intake}g · {calories} kcal</Text>
    </View>
  )
}

function PosterFooterAvatar({ profile }: { profile: { nickname?: string; avatar?: string } | null }) {
  const nickname = String(profile?.nickname || '').trim()
  const avatar = String(profile?.avatar || '').trim()
  if (avatar) {
    return <Image source={{ uri: avatar }} style={styles.foodPosterFooterAvatar} resizeMode='cover' />
  }
  if (nickname) {
    return (
      <View style={styles.foodPosterFooterAvatarFallback}>
        <Text style={styles.foodPosterFooterAvatarInitial}>{nickname.slice(0, 1)}</Text>
      </View>
    )
  }
  return <Image source={appIcon} style={styles.foodPosterFooterAvatar} resizeMode='contain' />
}

function RecordShareQrCode({ value }: { value: string }) {
  const matrix = useMemo(() => {
    const link = value.trim()
    if (!link) return []
    const qr = qrcode(0, 'M')
    qr.addData(link)
    qr.make()
    const size = qr.getModuleCount()
    return Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => qr.isDark(row, col)),
    )
  }, [value])

  return (
    <View style={styles.foodPosterQrOuter}>
      <View style={styles.foodPosterQrMatrix}>
        {matrix.map((row, rowIndex) => (
          <View key={`record-qr-row-${rowIndex}`} style={styles.foodPosterQrRow}>
            {row.map((dark, colIndex) => (
              <View
                key={`record-qr-cell-${rowIndex}-${colIndex}`}
                style={[styles.foodPosterQrCell, dark ? styles.foodPosterQrCellDark : styles.foodPosterQrCellLight]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

const POSTER_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getPosterDateInfo(recordTime?: string | null): { day: string; month: string } {
  const date = new Date(recordTime || '')
  if (Number.isNaN(date.getTime())) return { day: '--', month: '--' }
  return {
    day: String(date.getDate()),
    month: POSTER_MONTH_NAMES[date.getMonth()] || 'Jan',
  }
}

function getPosterDotLevel(record?: FoodRecord | null): number {
  const calories = Number(record?.total_calories || 0)
  if (!Number.isFinite(calories) || calories <= 0) return 0
  if (calories >= 600) return 3
  if (calories >= 300) return 2
  return 1
}

function formatPosterRatio(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

function mealLabelForPoster(mealType?: string): string {
  return getMealTypeLabel((mealType || 'lunch') as MealType)
}

type SelectedManualFood = {
  key: string
  item: ManualFoodItem
  weight: string
}

const manualFoodSourceChannels = [
  { key: 'common', label: '常见' },
  { key: 'campus', label: '校园食堂' },
  { key: 'recent', label: '最近' },
  { key: 'favorites', label: '收藏' },
  { key: 'custom', label: '自定义' },
  { key: 'staple', label: '主食' },
  { key: 'protein', label: '肉蛋奶' },
  { key: 'vegetable', label: '蔬菜' },
  { key: 'fruit', label: '水果' },
  { key: 'beverage', label: '饮品' },
] as const

type ManualFoodSourceChannel = (typeof manualFoodSourceChannels)[number]['key']
type FoodLibraryTabMode = 'all' | 'custom' | 'results' | 'create'
type FoodLibrarySortMode = 'latest' | 'calories' | 'protein'
const foodLibrarySortOptions: Array<{ key: FoodLibrarySortMode; label: string }> = [
  { key: 'latest', label: '最新' },
  { key: 'calories', label: '热量' },
  { key: 'protein', label: '蛋白' },
]

const manualMealIcons: Record<MealType, string> = {
  breakfast: '早',
  morning_snack: '加',
  lunch: '午',
  afternoon_snack: '加',
  dinner: '晚',
  evening_snack: '宵',
  snack: '加',
}

const defaultExpireDate = () => {
  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)
  return todayKey(nextWeek)
}

export function DayRecordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'DayRecord'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const { shareFoodRecord, shareSheet } = useFoodRecordShareSheet(dialog)
  const date = route.params?.date || todayKey()
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [targetCalories, setTargetCalories] = useState(2000)
  const [errorMessage, setErrorMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')
    try {
      const [data, dashboard] = await Promise.all([
        apiClient.getFoodRecordList(date),
        apiClient.getHomeDashboard(date).catch(() => null),
      ])
      setRecords(data.records || [])
      const target = numberFrom(dashboard?.intakeData?.target, 0)
      if (target > 0) setTargetCalories(target)
    } catch (error) {
      setErrorMessage(userFacingErrorMessage(error))
      await showError(dialog, '获取记录失败', error)
    } finally {
      setLoading(false)
    }
  }, [date, dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const totalKcal = records.reduce((sum, record) => sum + Number(record.total_calories || 0), 0)
  const totalProtein = records.reduce((sum, record) => sum + Number(record.total_protein || 0), 0)
  const totalCarbs = records.reduce((sum, record) => sum + Number(record.total_carbs || 0), 0)
  const totalFat = records.reduce((sum, record) => sum + Number(record.total_fat || 0), 0)
  const initialLoading = loading && records.length === 0
  const dayCards = useMemo(() => sortFoodRecordsByTime(records).map((record) => {
    const imageUrls = recordImageUrls(record)
    return {
      record,
      imageUrls,
      foods: (record.items || []).map((item) => ({
        item,
        name: item.name || '未命名食物',
        intake: recordItemIntake(item),
        ratio: recordItemRatio(item),
        calories: recordItemKcal(item),
        protein: recordItemMacro(item, 'protein'),
        carbs: recordItemMacro(item, 'carbs'),
        fat: recordItemMacro(item, 'fat'),
      })),
    }
  }), [records])

  const shareDay = async () => {
    if (records.length === 0) {
      await dialog.alert('暂无可分享记录', '这一天还没有饮食记录。', 'warning')
      return
    }
    try {
      const shared = records.length === 1
        ? await shareFoodRecord(records[0])
        : await shareTextToSystem(`${date} 饮食记录`, buildDayShareMessage(date, records))
      if (!shared) return
      const reward = await apiClient.claimSharePosterReward({ shareScope: 'daily_food', shareDate: date })
      await showShareRewardAlert(dialog, reward)
    } catch (error) {
      await showError(dialog, '分享失败', error)
    }
  }

  const removeRecord = async (recordId: string) => {
    const confirmed = await dialog.confirm({
      title: '删除记录',
      message: '删除这条饮食记录后不可恢复，确定删除吗？',
      kind: 'danger',
      cancelText: '取消',
      confirmText: '删除',
    })
    if (!confirmed) return
    try {
      await apiClient.deleteFoodRecord(recordId)
      emitHomeIntakeDataChangedEvent({ date, force: true })
      await load()
    } catch (error) {
      await showError(dialog, '删除失败', error)
    }
  }

  const removeFoodItem = async (record: FoodRecord, index: number) => {
    const items = record.items || []
    const target = items[index]
    if (!target) return
    const isLastFood = items.length <= 1
    const confirmed = await dialog.confirm({
      title: isLastFood ? '删除记录' : '删除食物',
      message: isLastFood
        ? `「${target.name || '该食物'}」是这条记录里最后一个食物，删除后会一并删除整条记录。确定删除吗？`
        : `只删除「${target.name || '该食物'}」，其他食物会保留。确定删除吗？`,
      kind: 'danger',
      cancelText: '取消',
      confirmText: '删除',
    })
    if (!confirmed) return
    try {
      if (isLastFood) {
        await apiClient.deleteFoodRecord(record.id)
      } else {
        const nextItems = items.filter((_, itemIndex) => itemIndex !== index)
        await apiClient.updateFoodRecord(record.id, {
          items: nextItems.map(foodRecordItemRowPayload),
          ...summarizeFoodRecordRows(nextItems),
        })
      }
      emitHomeIntakeDataChangedEvent({ date: dateKeyFromDateTime(record.record_time) || date, force: true })
      await load()
    } catch (error) {
      await showError(dialog, '删除失败', error)
    }
  }

  return (
    <View style={styles.dayRecordPage}>
      <View style={styles.dayRecordTopWash} />
      <ScrollView
        style={styles.dayRecordScroll}
        contentContainerStyle={[styles.dayRecordContent, { paddingTop: Math.max(insets.top, 0) + 16, paddingBottom: Math.max(insets.bottom, 0) + 28 }]}
        refreshControl={<RefreshControl refreshing={loading && records.length > 0} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.dayRecordTop}>
          <Text style={styles.dayRecordDateLine}>{formatDayRecordDate(date)}</Text>
          {records.length > 0 ? (
            <Pressable style={styles.dayRecordShareButton} onPress={() => void shareDay()}>
              <Text style={styles.dayRecordShareIcon}>↗</Text>
              <Text style={styles.dayRecordShareText}>分享今日饮食</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.dayRecordSummary}>
          <View style={styles.dayRecordSummaryCard}>
            <Text style={styles.dayRecordSummaryLabel}>总摄入</Text>
            <Text style={styles.dayRecordSummaryValue}>{formatDisplayNumber(totalKcal)} kcal</Text>
          </View>
          <View style={styles.dayRecordSummaryCard}>
            <Text style={styles.dayRecordSummaryLabel}>目标</Text>
            <Text style={styles.dayRecordSummaryValue}>{formatDisplayNumber(targetCalories)} kcal</Text>
          </View>
          <View style={styles.dayRecordSummaryCard}>
            <Text style={styles.dayRecordSummaryLabel}>记录数</Text>
            <Text style={styles.dayRecordSummaryValue}>{records.length} 条</Text>
          </View>
        </View>

        {initialLoading ? (
          <View style={styles.dayRecordState}>
            <ActivityIndicator color={colors.brand} size="small" />
          </View>
        ) : null}

        {!initialLoading && errorMessage ? (
          <View style={styles.dayRecordEmpty}>
            <View style={styles.dayRecordEmptyIcon}>
              <Text style={styles.dayRecordEmptyIconText}>!</Text>
            </View>
            <Text style={styles.dayRecordEmptyTitle}>{errorMessage}</Text>
          </View>
        ) : null}

        {!initialLoading && !errorMessage && records.length === 0 ? (
          <View style={styles.dayRecordEmpty}>
            <View style={styles.dayRecordEmptyIcon}>
              <IconfontText className="iconfont icon-shiwu" size={32} color={colors.brand} />
            </View>
            <Text style={styles.dayRecordEmptyTitle}>这一天还没有饮食记录</Text>
            <Text style={styles.dayRecordEmptyDesc}>通过首页记录弹窗拍照或文字录入后，这里就会展示当天明细。</Text>
            <Pressable style={styles.dayRecordEmptyButton} onPress={() => navigation.navigate('ManualRecord', { date })}>
              <Text style={styles.dayRecordEmptyButtonText}>去记录</Text>
            </Pressable>
          </View>
        ) : null}

        {!initialLoading && !errorMessage && dayCards.length > 0 ? (
          <View style={styles.dayRecordList}>
            {dayCards.map(({ record, imageUrls, foods }) => {
              const mealTone = mealToneStyles(record.meal_type)
              return (
                <Pressable key={record.id} style={({ pressed }) => [styles.dayRecordCard, pressed && styles.dayRecordCardPressed]} onPress={() => navigation.navigate('RecordDetail', { recordId: record.id })}>
                  <View style={styles.dayRecordCardHeader}>
                    <View style={styles.dayRecordCardMain}>
                      <View style={[styles.dayRecordThumb, imageUrls.length === 0 && styles.dayRecordThumbPlaceholder]}>
                        {imageUrls[0] ? (
                          <Image source={{ uri: imageUrls[0] }} style={styles.dayRecordThumbImage} resizeMode="cover" />
                        ) : (
                          <IconfontText className="iconfont icon-shiwu" size={26} color={colors.brand} />
                        )}
                        {imageUrls.length === 0 ? (
                          <View style={[styles.dayRecordThumbBadge, styles.dayRecordThumbBadgePlaceholder]}>
                            <Text style={styles.dayRecordThumbBadgeText}>无照片</Text>
                          </View>
                        ) : imageUrls.length > 1 ? (
                          <View style={styles.dayRecordThumbBadge}>
                            <Text style={styles.dayRecordThumbBadgeText}>{imageUrls.length} 张</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={[styles.dayRecordMealIcon, mealTone.icon]}>
                        <Text style={[styles.dayRecordMealIconText, mealTone.text]}>{manualMealIcons[record.meal_type] || '食'}</Text>
                      </View>
                      <View style={styles.dayRecordCardCopy}>
                        <Text style={styles.dayRecordCardName}>{getMealTypeLabel(record.meal_type)}</Text>
                        <Text style={styles.dayRecordCardTime}>{formatRecordClock(record.record_time)}</Text>
                      </View>
                    </View>
                    <View style={styles.dayRecordCardActions}>
                      <Text style={styles.dayRecordCardCalorie}>{formatDisplayNumber(record.total_calories || 0)} kcal</Text>
                      <Pressable
                        hitSlop={8}
                        style={styles.dayRecordDeleteButton}
                        onPress={(event) => {
                          event.stopPropagation()
                          void removeRecord(record.id)
                        }}
                      >
                        <Trash2 size={17} color="#94a3b8" strokeWidth={2.1} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.dayRecordFoodList}>
                    {foods.map((food, index) => (
                      <View key={`${record.id}-${food.name}-${index}`} style={styles.dayRecordFoodItem}>
                        <View style={styles.dayRecordFoodMain}>
                          <Text style={styles.dayRecordFoodName} numberOfLines={1}>{food.name}</Text>
                          <Text style={styles.dayRecordFoodAmount}>{formatDisplayNumber(food.intake)}g</Text>
                          <Text style={styles.dayRecordFoodRatio}>{formatDisplayNumber(food.ratio)}%</Text>
                        </View>
                        <View style={styles.dayRecordFoodSide}>
                          <Text style={styles.dayRecordFoodCalorie}>{formatDisplayNumber(food.calories)} kcal</Text>
                          <Pressable
                            hitSlop={8}
                            style={styles.dayRecordFoodDelete}
                            onPress={(event) => {
                              event.stopPropagation()
                              void removeFoodItem(record, index)
                            }}
                          >
                            <Trash2 size={14} color="#94a3b8" strokeWidth={2.1} />
                          </Pressable>
                        </View>
                        <View style={styles.dayRecordFoodMacros}>
                          <Text style={styles.dayRecordFoodMacro}>蛋白质 <Text style={styles.dayRecordFoodProtein}>{Math.round(food.protein)}g</Text></Text>
                          <Text style={styles.dayRecordFoodMacro}>碳水 <Text style={styles.dayRecordFoodCarbs}>{Math.round(food.carbs)}g</Text></Text>
                          <Text style={styles.dayRecordFoodMacro}>脂肪 <Text style={styles.dayRecordFoodFat}>{Math.round(food.fat)}g</Text></Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </Pressable>
              )
            })}
          </View>
        ) : null}

        {records.length > 0 ? (
          <View style={styles.dayRecordMacroFooter}>
            <Text style={styles.dayRecordMacroFooterText}>
              蛋白质 {formatDisplayNumber(totalProtein)}g · 碳水 {formatDisplayNumber(totalCarbs)}g · 脂肪 {formatDisplayNumber(totalFat)}g
            </Text>
          </View>
        ) : null}
      </ScrollView>
      {shareSheet}
    </View>
  )
}

export function RecordDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RecordDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const { shareFoodRecord, shareSheet } = useFoodRecordShareSheet(dialog)
  const [record, setRecord] = useState<FoodRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editMealType, setEditMealType] = useState<MealType>('lunch')
  const [editDescription, setEditDescription] = useState('')
  const [editItems, setEditItems] = useState<EditableRecordItem[]>([])
  const [expandedNutrients, setExpandedNutrients] = useState<Record<string, boolean>>({})

  const syncEditor = useCallback((next: FoodRecord) => {
    setEditMealType(next.meal_type)
    setEditDescription(next.description || '')
    setEditItems((next.items || []).map(editableRecordItemFromRow))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getFoodRecordById(route.params.recordId)
      setRecord(data.record)
      if (!editing) syncEditor(data.record)
    } catch (error) {
      await showError(dialog, '获取详情失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog, editing, route.params.recordId, syncEditor])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const imageUrls = recordImageUrls(record)
  const editTotals = useMemo(() => summarizeEditableRecordItems(editItems), [editItems])
  const mealTone = record ? mealToneStyles(record.meal_type) : null
  const contextTags = record ? recordContextTags(record) : []
  const detailBlocks = record ? recordDetailBlocks(record) : []

  const shareRecord = async () => {
    if (!record) return
    try {
      const shared = await shareFoodRecord(record)
      if (!shared) return
      const reward = await apiClient.claimSharePosterReward({ recordId: record.id })
      await showShareRewardAlert(dialog, reward)
    } catch (error) {
      await showError(dialog, '分享失败', error)
    }
  }

  const openCommunityDetail = () => {
    if (!record) return
    navigation.navigate('CommunityFeedDetail', { targetId: record.id, targetType: 'food_record' })
  }

  const openEdit = () => {
    if (!record) return
    syncEditor(record)
    setEditing(true)
  }

  const updateEditItem = (index: number, patch: Partial<Omit<EditableRecordItem, 'source'>>) => {
    setEditItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }

  const removeEditItem = (index: number) => {
    if (editItems.length <= 1) {
      void dialog.alert('至少保留一个食物', '饮食记录需要保留一项食物明细。', 'warning')
      return
    }
    setEditItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const saveEdit = async () => {
    if (!record) return
    const items = editItems.map(editableRecordItemPayload)
    if (items.length === 0) {
      void dialog.alert('无法保存', '请至少保留一项食物明细。', 'warning')
      return
    }
    setSaving(true)
    try {
      const totals = summarizeEditableRecordItems(editItems)
      const data = await apiClient.updateFoodRecord(record.id, {
        meal_type: editMealType,
        description: editDescription.trim(),
        items,
        total_calories: totals.total_calories,
        total_protein: totals.total_protein,
        total_carbs: totals.total_carbs,
        total_fat: totals.total_fat,
        total_weight_grams: totals.total_weight_grams,
        image_path: record.image_path || undefined,
        image_paths: record.image_paths || undefined,
      })
      setRecord(data.record)
      syncEditor(data.record)
      setEditing(false)
      emitHomeIntakeDataChangedEvent({ date: dateKeyFromDateTime(data.record.record_time || record.record_time), force: true })
      void dialog.alert('已保存', '记录已更新', 'success')
    } catch (error) {
      void dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    const confirmed = await dialog.confirm({
      title: '删除记录',
      message: '确定删除这条饮食记录吗？',
      kind: 'danger',
      cancelText: '取消',
      confirmText: '删除',
    })
    if (!confirmed) return

    try {
      await apiClient.deleteFoodRecord(route.params.recordId)
      emitHomeIntakeDataChangedEvent({ date: dateKeyFromDateTime(record?.record_time), force: true })
      await dialog.alert('已删除', '记录已删除', 'success')
      navigation.goBack()
    } catch (error) {
      void dialog.alert('删除失败', userFacingErrorMessage(error), 'danger')
    }
  }

  return (
    <View style={styles.recordDetailRoot}>
      <ScrollView
        style={styles.recordDetailScroll}
        contentContainerStyle={[styles.recordDetailContent, { paddingTop: Math.max(insets.top, 0) + 16, paddingBottom: Math.max(insets.bottom, 0) + 36 }]}
        refreshControl={<RefreshControl refreshing={loading && !!record} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
        keyboardShouldPersistTaps="handled"
      >
        {loading && !record ? (
          <View style={styles.recordDetailLoading}>
            <ActivityIndicator color={colors.brand} size="small" />
          </View>
        ) : null}

        {!loading && !record ? (
          <View style={styles.recordDetailEmpty}>
            <IconfontText className="iconfont icon-shiwu" size={34} color={colors.brand} />
            <Text style={styles.recordDetailEmptyText}>暂无记录详情</Text>
          </View>
        ) : null}

        {record && !editing ? (
          <View style={styles.recordDetailBody}>
            <View style={styles.recordDetailHeader}>
              <View style={styles.recordDetailMealBadge}>
                <View style={[styles.recordDetailMealIcon, mealTone?.icon]}>
                  <Text style={[styles.recordDetailMealIconText, mealTone?.text]}>{manualMealIcons[record.meal_type] || '食'}</Text>
                </View>
                <View style={styles.recordDetailMealText}>
                  <Text style={styles.recordDetailMealName}>{getMealTypeLabel(record.meal_type)}</Text>
                  <Text style={styles.recordDetailMealTime}>{formatRecordDetailTime(record.record_time)}</Text>
                </View>
              </View>
              <View style={styles.recordDetailCalorieBox}>
                <Text style={styles.recordDetailCalorie}>{formatDisplayNumber(record.total_calories || 0)}</Text>
                <Text style={styles.recordDetailCalorieUnit}>kcal</Text>
              </View>
            </View>

            <View style={[styles.recordDetailImage, imageUrls.length === 0 && styles.recordDetailImagePlaceholder]}>
              {imageUrls[0] ? (
                <Image source={{ uri: imageUrls[0] }} style={styles.recordDetailHeroImage} resizeMode="cover" />
              ) : (
                <>
                  <View style={styles.recordDetailImageIconWrap}>
                    <Image source={appIcon} style={styles.recordDetailImageIcon} resizeMode="contain" />
                  </View>
                  <Text style={styles.recordDetailImageHint}>文字记录，未提供实物照片</Text>
                </>
              )}
            </View>

            {contextTags.length ? (
              <View style={styles.recordDetailContextTags}>
                {contextTags.map((tag) => (
                  <View key={tag.label} style={[styles.recordDetailContextTag, tag.tone === 'goal' ? styles.recordDetailGoalTag : styles.recordDetailTimingTag]}>
                    <Text style={styles.recordDetailContextTagIcon}>{tag.icon}</Text>
                    <Text style={[styles.recordDetailContextTagText, tag.tone === 'goal' ? styles.recordDetailGoalTagText : styles.recordDetailTimingTagText]}>{tag.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {detailBlocks.map((block) => (
              <View key={block.title} style={styles.recordDetailInfoBlock}>
                <Text style={styles.recordDetailInfoTitle}>{block.icon} {block.title}</Text>
                <Text style={styles.recordDetailInfoText}>{block.text}</Text>
              </View>
            ))}

            <View style={styles.recordDetailActions}>
              <Pressable style={styles.recordDetailSecondaryAction} onPress={openEdit}>
                <Text style={styles.recordDetailSecondaryActionText}>修改记录</Text>
              </Pressable>
              <Pressable style={styles.recordDetailPrimaryAction} onPress={() => void shareRecord()}>
                <Text style={styles.recordDetailPrimaryActionText}>分享这餐</Text>
              </Pressable>
              <View style={styles.recordDetailActionRow}>
                <Pressable style={styles.recordDetailPlainAction} onPress={openCommunityDetail}>
                  <Text style={styles.recordDetailPlainActionText}>圈子详情</Text>
                </Pressable>
                <Pressable style={styles.recordDetailPlainAction} onPress={remove}>
                  <Text style={styles.recordDetailDangerActionText}>删除记录</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.recordDetailFoodTitle}>食物明细</Text>
            {(record.items || []).length ? (record.items || []).map((item, index) => {
              const detailKey = `${record.id}-${index}`
              const detailsExpanded = Boolean(expandedNutrients[detailKey])
              const nutrientRows = recordItemNutrientRows(item)
              return (
                <View key={`${item.name}-${index}`} style={styles.recordDetailFoodItem}>
                  <View style={styles.recordDetailFoodInfo}>
                    <Text style={styles.recordDetailFoodName}>{item.name || '未命名食物'}</Text>
                    <Text style={styles.recordDetailFoodMeta}>摄入 {formatDisplayNumber(recordItemIntake(item))}g</Text>
                    <View style={styles.recordDetailRatioBadge}>
                      <Text style={styles.recordDetailRatioText}>摄入比例 {formatDisplayNumber(recordItemRatio(item))}%</Text>
                    </View>
                    <View style={styles.recordDetailFoodNutrients}>
                      <Text style={styles.recordDetailFoodNutrient}>蛋白 {formatDisplayNumber(recordItemMacro(item, 'protein'))}g</Text>
                      <Text style={styles.recordDetailFoodNutrient}>碳水 {formatDisplayNumber(recordItemMacro(item, 'carbs'))}g</Text>
                      <Text style={styles.recordDetailFoodNutrient}>脂肪 {formatDisplayNumber(recordItemMacro(item, 'fat'))}g</Text>
                      <Text style={styles.recordDetailFoodNutrient}>含水 {Math.round(recordItemWaterMl(item))}ml</Text>
                    </View>
                    <Pressable
                      style={styles.recordDetailNutrientToggle}
                      onPress={() => setExpandedNutrients((current) => ({ ...current, [detailKey]: !detailsExpanded }))}
                    >
                      <Text style={styles.recordDetailNutrientToggleText}>{detailsExpanded ? '收起更多营养' : '展开更多营养'}</Text>
                      <Text style={styles.recordDetailNutrientToggleIcon}>{detailsExpanded ? '⌃' : '⌄'}</Text>
                    </Pressable>
                    {detailsExpanded ? (
                      <View style={styles.recordDetailNutrientGrid}>
                        {nutrientRows.map((row) => (
                          <View key={row.key} style={styles.recordDetailNutrientCell}>
                            <Text style={styles.recordDetailNutrientLabel}>{row.label}</Text>
                            <Text style={styles.recordDetailNutrientValue}>{formatDisplayNumber(row.value)} <Text style={styles.recordDetailNutrientUnit}>{row.unit}</Text></Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.recordDetailFoodCalories}>
                    <Text style={styles.recordDetailFoodCalorieText}>{formatDisplayNumber(recordItemKcal(item))} kcal</Text>
                  </View>
                </View>
              )
            }) : (
              <View style={styles.recordDetailEmptyLine}>
                <Text style={styles.recordDetailEmptyLineText}>暂无食物明细</Text>
              </View>
            )}

            <View style={styles.recordDetailSummarySection}>
              <Text style={styles.recordDetailSummaryTitle}>营养汇总</Text>
              <View style={styles.recordDetailSummaryGrid}>
                <RecordDetailSummaryCell label="总热量" value={formatDisplayNumber(record.total_calories || 0)} unit="kcal" highlight />
                <RecordDetailSummaryCell label="总重量" value={formatDisplayNumber(record.total_weight_grams || 0)} unit="g" />
                <RecordDetailSummaryCell label="蛋白质" value={formatDisplayNumber(record.total_protein || 0)} unit="g" />
                <RecordDetailSummaryCell label="碳水" value={formatDisplayNumber(record.total_carbs || 0)} unit="g" />
                <RecordDetailSummaryCell label="脂肪" value={formatDisplayNumber(record.total_fat || 0)} unit="g" />
              </View>
            </View>
          </View>
        ) : null}

        {record && editing ? (
          <View style={styles.recordDetailEditPanel}>
            <Text style={styles.recordDetailEditTitle}>编辑记录</Text>
            <MealPicker value={editMealType} onChange={setEditMealType} />
            <Field label="记录描述" value={editDescription} onChangeText={setEditDescription} multiline placeholder="这餐吃了什么" />
            <View style={styles.recordDetailEditSummary}>
              <RecordDetailSummaryCell label="热量" value={formatDisplayNumber(editTotals.total_calories)} unit="kcal" highlight />
              <RecordDetailSummaryCell label="蛋白质" value={formatDisplayNumber(editTotals.total_protein)} unit="g" />
              <RecordDetailSummaryCell label="碳水" value={formatDisplayNumber(editTotals.total_carbs)} unit="g" />
              <RecordDetailSummaryCell label="脂肪" value={formatDisplayNumber(editTotals.total_fat)} unit="g" />
            </View>
            {editItems.map((item, index) => (
              <View key={`${item.source.name}-${index}`} style={styles.recordDetailEditItem}>
                <View style={styles.rowBetween}>
                  <Text style={styles.itemName}>食物 {index + 1}</Text>
                  <SmallButton label="移除" danger onPress={() => removeEditItem(index)} />
                </View>
                <Field label="名称" value={item.name} onChangeText={(value) => updateEditItem(index, { name: value })} />
                <Field label="估算重量 g" value={item.weight} onChangeText={(value) => updateEditItem(index, { weight: value })} keyboardType="decimal-pad" />
                <Field label="摄入比例 %" value={item.ratio} onChangeText={(value) => updateEditItem(index, { ratio: value })} keyboardType="decimal-pad" />
                <View style={styles.ratioGrid}>
                  {[25, 50, 75, 100].map((ratio) => (
                    <Pressable
                      key={ratio}
                      style={[styles.ratioButton, Math.round(editableItemRatio(item)) === ratio && styles.ratioButtonActive]}
                      onPress={() => updateEditItem(index, { ratio: String(ratio) })}
                    >
                      <Text style={[styles.ratioButtonText, Math.round(editableItemRatio(item)) === ratio && styles.ratioButtonTextActive]}>
                        {ratio}%
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.itemMeta}>
                  实际摄入 {round1(editableItemIntake(item))}g · 热量 {round1(editableItemScaledNutrient(item, 'calories'))} kcal
                </Text>
                <View style={styles.nutritionGrid}>
                  <Field label="热量 kcal" value={item.calories} onChangeText={(value) => updateEditItem(index, { calories: value })} keyboardType="decimal-pad" />
                  <Field label="蛋白质 g" value={item.protein} onChangeText={(value) => updateEditItem(index, { protein: value })} keyboardType="decimal-pad" />
                  <Field label="碳水 g" value={item.carbs} onChangeText={(value) => updateEditItem(index, { carbs: value })} keyboardType="decimal-pad" />
                  <Field label="脂肪 g" value={item.fat} onChangeText={(value) => updateEditItem(index, { fat: value })} keyboardType="decimal-pad" />
                  <Field label="膳食纤维 g" value={item.fiber} onChangeText={(value) => updateEditItem(index, { fiber: value })} keyboardType="decimal-pad" />
                  <Field label="糖 g" value={item.sugar} onChangeText={(value) => updateEditItem(index, { sugar: value })} keyboardType="decimal-pad" />
                  <Field label="饮水 ml" value={item.waterMl} onChangeText={(value) => updateEditItem(index, { waterMl: value })} keyboardType="decimal-pad" />
                  <Field label="钠 mg" value={item.sodiumMg} onChangeText={(value) => updateEditItem(index, { sodiumMg: value })} keyboardType="decimal-pad" />
                </View>
              </View>
            ))}
            <View style={styles.buttonRow}>
              <AppButton label="保存修改" loading={saving} onPress={saveEdit} />
              <AppButton label="取消" variant="secondary" onPress={() => setEditing(false)} />
            </View>
          </View>
        ) : null}
      </ScrollView>
      {shareSheet}
    </View>
  )
}

export function AnalyzeHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { shareFoodRecord, shareSheet } = useFoodRecordShareSheet(dialog)
  const [tasks, setTasks] = useState<AnalysisTask[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [menuTask, setMenuTask] = useState<AnalysisTask | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)
  const [sharingTaskId, setSharingTaskId] = useState<string | null>(null)

  const load = useCallback(async (keyword = '') => {
    setLoading(true)
    try {
      const data = await apiClient.listAnalyzeTasks({ limit: 80, search: keyword })
      const visibleTasks = (data.tasks || [])
        .filter(isVisibleAnalyzeHistoryTask)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setTasks(visibleTasks)
    } catch (error) {
      await showError(dialog, '获取识别历史失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  const refresh = useCallback(() => load(searchKeyword), [load, searchKeyword])
  const hasKeyword = searchKeyword.trim().length > 0
  const discardableTasks = useMemo(
    () => tasks.filter((task) => task.status === 'done' && task.is_recorded === false),
    [tasks],
  )

  const retryTask = useCallback(async (task: AnalysisTask) => {
    setRetryingTaskId(task.id)
    try {
      const result = await apiClient.retryAnalyzeTask(task.id)
      const nextTaskId = String(result.task_id || '').trim()
      if (!nextTaskId) {
        throw new Error('服务端未返回识别进度信息')
      }
      await load(searchKeyword)
      navigation.navigate('AnalyzeLoading', {
        taskId: nextTaskId,
        mealType: analyzeHistoryMealType(task),
        date: analyzeHistoryDate(task),
        taskType: isTextAnalysisTask(task) ? 'food_text' : 'food',
      })
    } catch (error) {
      await showError(dialog, '重新识别失败', error)
    } finally {
      setRetryingTaskId(null)
    }
  }, [dialog, load, navigation, searchKeyword])

  const confirmRetryTask = useCallback(async (task: AnalysisTask) => {
    const confirmed = await dialog.confirm({
      title: '重新识别',
      message: isTextAnalysisTask(task) ? '将使用这条记录的原文字内容重新识别。' : '将使用这条记录已上传的图片重新识别，不需要重新上传照片。',
      confirmText: '重新识别',
      cancelText: '取消',
    })
    if (confirmed) void retryTask(task)
  }, [dialog, retryTask])

  const deleteUnrecordedTasks = useCallback(async () => {
    if (discardableTasks.length === 0 || bulkDeleting) return
    const confirmed = await dialog.confirm({
      title: '删除未记录',
      message: `将删除 ${discardableTasks.length} 条已识别但还没有写入饮食记录的历史，不会影响已经保存的一餐。`,
      confirmText: '删除未记录',
      cancelText: '取消',
      kind: 'danger',
    })
    if (!confirmed) return
    setBulkDeleting(true)
    try {
      await Promise.all(discardableTasks.map((task) => apiClient.deleteAnalysisTask(task.id)))
      setTasks((current) => current.filter((task) => !discardableTasks.some((item) => item.id === task.id)))
    } catch (error) {
      await showError(dialog, '删除识别记录失败', error)
    } finally {
      setBulkDeleting(false)
    }
  }, [bulkDeleting, dialog, discardableTasks])

  const confirmDeleteTask = useCallback(async (task: AnalysisTask) => {
    if (deletingTaskId) return
    const confirmed = await dialog.confirm({
      title: '删除识别记录',
      message: '删除后不可恢复，确定删除这条识别记录吗？',
      confirmText: '删除',
      cancelText: '取消',
      kind: 'danger',
    })
    if (!confirmed) return
    setDeletingTaskId(task.id)
    try {
      await apiClient.deleteAnalysisTask(task.id)
      setTasks((current) => current.filter((item) => item.id !== task.id))
      await dialog.alert('已删除', '识别记录已删除', 'success')
    } catch (error) {
      await showError(dialog, '删除识别记录失败', error)
    } finally {
      setDeletingTaskId(null)
    }
  }, [deletingTaskId, dialog])

  const openTask = useCallback((task: AnalysisTask) => {
    if (isPackagedAnalyzeHistoryTask(task)) {
      navigation.navigate('PackagedFoodTaskDetail', { taskId: task.id })
      return
    }
    const taskType = isTextAnalysisTask(task) ? 'food_text' : 'food'
    const mealType = analyzeHistoryMealType(task)
    const date = analyzeHistoryDate(task)
    if (task.status === 'done' && taskType === 'food_text') {
      navigation.navigate('TextResult', { task, mealType, date })
      return
    }
    if (task.status === 'done') {
      navigation.navigate('Result', { task, mealType, date })
      return
    }
    if (isAnalyzeRetryable(task)) {
      void confirmRetryTask(task)
      return
    }
    navigation.navigate('AnalyzeLoading', {
      taskId: task.id,
      mealType,
      date,
      taskType,
    })
  }, [confirmRetryTask, navigation])

  const shareAnalyzeTask = useCallback(async (task: AnalysisTask) => {
    if (sharingTaskId) return
    if (task.status !== 'done' || isPackagedAnalyzeHistoryTask(task)) {
      await dialog.alert('暂时无法分享', '识别完成并保存为饮食记录后，才能生成微信分享卡片。', 'warning')
      return
    }
    setSharingTaskId(task.id)
    try {
      const record = await findFoodRecordForAnalyzeTask(task)
      if (!record) {
        setSharingTaskId(null)
        const confirmed = await dialog.confirm({
          title: '先保存后分享',
          message: '微信卡片需要一条已保存的饮食记录。请先打开识别结果并保存为饮食记录，再回来分享。',
          confirmText: '去保存',
          cancelText: '取消',
        })
        if (confirmed) openTask(task)
        return
      }
      const shared = await shareFoodRecord(record)
      if (!shared) return
      const reward = await apiClient.claimSharePosterReward({ recordId: record.id })
      await showShareRewardAlert(dialog, reward)
    } catch (error) {
      await showError(dialog, '分享失败', error)
    } finally {
      setSharingTaskId((current) => (current === task.id ? null : current))
    }
  }, [dialog, openTask, shareFoodRecord, sharingTaskId])

  const closeTaskMenu = useCallback(() => {
    setMenuTask(null)
  }, [])

  const openTaskMenu = useCallback((task: AnalysisTask) => {
    setMenuTask(task)
  }, [])

  const selectMenuOpenTask = useCallback(() => {
    const task = menuTask
    closeTaskMenu()
    if (task) openTask(task)
  }, [closeTaskMenu, menuTask, openTask])

  const selectMenuRetryTask = useCallback(() => {
    const task = menuTask
    closeTaskMenu()
    if (task && isAnalyzeRetryable(task)) void confirmRetryTask(task)
  }, [closeTaskMenu, confirmRetryTask, menuTask])

  const selectMenuShareTask = useCallback(() => {
    const task = menuTask
    closeTaskMenu()
    if (task) void shareAnalyzeTask(task)
  }, [closeTaskMenu, menuTask, shareAnalyzeTask])

  const selectMenuDeleteTask = useCallback(() => {
    const task = menuTask
    closeTaskMenu()
    if (task) void confirmDeleteTask(task)
  }, [closeTaskMenu, confirmDeleteTask, menuTask])

  const submitSearch = () => {
    void load(searchKeyword)
  }

  const clearSearch = () => {
    setSearchKeyword('')
    void load('')
  }

  useEffect(() => {
    void load('')
  }, [load])

  const initialLoading = loading && tasks.length === 0
  const menuTaskRetryable = menuTask ? isAnalyzeRetryable(menuTask) : false
  const menuTaskShareable = menuTask ? menuTask.status === 'done' && !isPackagedAnalyzeHistoryTask(menuTask) : false
  const menuTaskBusy = menuTask ? retryingTaskId === menuTask.id || deletingTaskId === menuTask.id || sharingTaskId === menuTask.id : false

  return (
    <View style={styles.analyzeHistoryPage}>
      <View style={styles.analyzeHistorySearchBar}>
        <View style={styles.analyzeHistorySearchInputWrap}>
          <Search size={16} color="#9ca3af" strokeWidth={2.4} />
          <TextInput
            value={searchKeyword}
            onChangeText={setSearchKeyword}
            placeholder="搜索食物名称"
            placeholderTextColor="#9ca3af"
            returnKeyType="search"
            onSubmitEditing={submitSearch}
            style={styles.analyzeHistorySearchInput}
          />
          {hasKeyword ? (
            <Pressable hitSlop={10} style={styles.analyzeHistorySearchClear} disabled={loading} onPress={clearSearch}>
              <X size={14} color="#9ca3af" strokeWidth={2.6} />
            </Pressable>
          ) : null}
        </View>
        <Pressable disabled={loading} style={[styles.analyzeHistorySearchButton, loading && styles.analyzeHistorySearchButtonDisabled]} onPress={submitSearch}>
          {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.analyzeHistorySearchButtonText}>搜索</Text>}
        </Pressable>
      </View>

      <ScrollView
        style={styles.analyzeHistoryScroll}
        contentContainerStyle={styles.analyzeHistoryList}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && tasks.length > 0} onRefresh={refresh} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        {initialLoading ? (
          <View style={styles.analyzeHistoryLoading}>
            <ActivityIndicator color={colors.brand} size="small" />
          </View>
        ) : null}

        {!initialLoading && tasks.length === 0 ? (
          <View style={styles.analyzeHistoryEmptyCard}>
            <View style={styles.analyzeHistoryEmptyIcon}>
              <ImagePlus size={30} color={colors.brand} strokeWidth={1.9} />
            </View>
            <Text style={styles.analyzeHistoryEmptyTitle}>{hasKeyword ? '没有找到匹配的记录' : '暂时没有记录，快去拍一张吧~'}</Text>
            <Text style={styles.analyzeHistoryEmptyDesc}>{hasKeyword ? '换个食物名称试试，或清除关键词查看全部。' : '拍照、相册上传和文字记录完成后都会出现在这里。'}</Text>
          </View>
        ) : null}

        {!initialLoading && tasks.length > 0 ? (
          <View style={styles.analyzeHistoryListHeader}>
            <View style={styles.flex} />
            {discardableTasks.length > 0 ? (
              <Pressable disabled={bulkDeleting} style={styles.analyzeHistoryBulkDelete} onPress={() => void deleteUnrecordedTasks()}>
                {bulkDeleting ? <ActivityIndicator size="small" color="#2f7f62" /> : <Trash2 size={13} color="#5cb896" strokeWidth={2.4} />}
                <Text style={styles.analyzeHistoryBulkDeleteText}>一键删除未记录</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!initialLoading && tasks.map((task) => {
          const imageUrl = analyzeHistoryImageUrl(task)
          const calories = analyzeHistoryCalories(task)
          const statusTone = analyzeHistoryStatusTone(task)
          const modeLabel = analyzeHistoryModeLabel(task)
          const retrying = retryingTaskId === task.id
          const deleting = deletingTaskId === task.id
          const sharing = sharingTaskId === task.id
          const busy = retrying || deleting || sharing
          return (
            <Pressable key={task.id} style={({ pressed }) => [styles.analyzeHistoryTaskWrapper, pressed && styles.analyzeHistoryPressed]} onPress={() => openTask(task)}>
              <View style={[styles.analyzeHistoryTaskCard, task.status === 'violated' && styles.analyzeHistoryTaskCardViolated]}>
                <View style={styles.analyzeHistoryThumb}>
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.analyzeHistoryThumbImage} />
                  ) : (
                    <View style={[styles.analyzeHistoryThumbFallback, isTextAnalysisTask(task) && styles.analyzeHistoryThumbFallbackText]}>
                      <Text style={styles.analyzeHistoryThumbText}>{analyzeHistoryAvatarText(task)}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.analyzeHistoryBody}>
                  <View style={styles.analyzeHistoryMainRow}>
                    <View style={styles.analyzeHistoryLeftContent}>
                      <Text style={styles.analyzeHistoryHeadline} numberOfLines={1}>{analyzeHistoryTitle(task)}</Text>
                      <Text style={styles.analyzeHistoryCalories}>{calories > 0 ? `${Math.round(calories)} kcal` : '-- kcal'}</Text>
                      <Text style={styles.analyzeHistoryMeta} numberOfLines={1}>{analyzeHistoryCompactMeta(task)}</Text>
                      {task.status === 'violated' ? (
                        <Text style={styles.analyzeHistoryViolationReason} numberOfLines={2}>{analyzeHistoryMeta(task)}</Text>
                      ) : null}
                      <View style={styles.analyzeHistoryTagRow}>
                        <Text style={styles.analyzeHistoryTime} numberOfLines={1}>{formatDateTime(task.created_at)}</Text>
                        <View style={styles.analyzeHistoryMiniTag}>
                          <Text style={styles.analyzeHistoryMiniTagText}>{getMealTypeLabel(analyzeHistoryMealType(task))}</Text>
                        </View>
                        {modeLabel ? (
                          <View style={styles.analyzeHistoryModeTag}>
                            <Text style={styles.analyzeHistoryModeTagText}>{modeLabel}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.analyzeHistoryRightContent}>
                      <View style={[styles.analyzeHistoryStatusBadge, statusTone.style]}>
                        {busy ? <ActivityIndicator size="small" color={statusTone.color} /> : <Text style={[styles.analyzeHistoryStatusText, { color: statusTone.color }]}>{analyzeHistoryStatusLabel(task)}</Text>}
                      </View>
                      <Pressable
                        hitSlop={8}
                        disabled={busy}
                        style={styles.analyzeHistoryMoreButton}
                        onPress={(event) => {
                          event.stopPropagation?.()
                          openTaskMenu(task)
                        }}
                      >
                        <MoreVertical size={18} color="#6b7280" strokeWidth={2.8} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>

      <Modal visible={Boolean(menuTask)} transparent animationType="fade" onRequestClose={closeTaskMenu}>
        <Pressable style={styles.analyzeHistoryMenuBackdrop} onPress={closeTaskMenu}>
          <Pressable style={styles.analyzeHistoryMenuSheet} onPress={(event) => event.stopPropagation?.()}>
            <View style={styles.analyzeHistoryMenuHandle} />
            <Text style={styles.analyzeHistoryMenuTitle}>识别记录操作</Text>
            <Text style={styles.analyzeHistoryMenuSubtitle} numberOfLines={1}>
              {menuTask ? analyzeHistoryTitle(menuTask) : ''}
            </Text>

            <View style={styles.analyzeHistoryMenuActions}>
              <Pressable
                disabled={!menuTask || menuTaskBusy}
                style={({ pressed }) => [
                  styles.analyzeHistoryMenuAction,
                  pressed && styles.analyzeHistoryMenuActionPressed,
                  (!menuTask || menuTaskBusy) && styles.analyzeHistoryMenuActionDisabled,
                ]}
                onPress={selectMenuOpenTask}
              >
                <View style={styles.analyzeHistoryMenuActionIcon}>
                  <Search size={17} color={colors.brand} strokeWidth={2.5} />
                </View>
                <View style={styles.analyzeHistoryMenuActionCopy}>
                  <Text style={styles.analyzeHistoryMenuActionText}>查看识别结果</Text>
                  <Text style={styles.analyzeHistoryMenuActionHint}>打开这条记录的详情页</Text>
                </View>
              </Pressable>

              <Pressable
                disabled={!menuTaskShareable || menuTaskBusy}
                style={({ pressed }) => [
                  styles.analyzeHistoryMenuAction,
                  pressed && styles.analyzeHistoryMenuActionPressed,
                  (!menuTaskShareable || menuTaskBusy) && styles.analyzeHistoryMenuActionDisabled,
                ]}
                onPress={selectMenuShareTask}
              >
                <View style={styles.analyzeHistoryMenuActionIcon}>
                  <Share2 size={17} color={colors.brand} strokeWidth={2.5} />
                </View>
                <View style={styles.analyzeHistoryMenuActionCopy}>
                  <Text style={styles.analyzeHistoryMenuActionText}>分享</Text>
                  <Text style={styles.analyzeHistoryMenuActionHint}>
                    {menuTask?.is_recorded === true ? '微信、复制链接或更多方式' : '需先保存成饮食记录'}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                disabled={!menuTaskRetryable || menuTaskBusy}
                style={({ pressed }) => [
                  styles.analyzeHistoryMenuAction,
                  pressed && styles.analyzeHistoryMenuActionPressed,
                  (!menuTaskRetryable || menuTaskBusy) && styles.analyzeHistoryMenuActionDisabled,
                ]}
                onPress={selectMenuRetryTask}
              >
                <View style={styles.analyzeHistoryMenuActionIcon}>
                  <RefreshCw size={17} color={colors.brand} strokeWidth={2.5} />
                </View>
                <View style={styles.analyzeHistoryMenuActionCopy}>
                  <Text style={styles.analyzeHistoryMenuActionText}>重新识别</Text>
                  <Text style={styles.analyzeHistoryMenuActionHint}>失败或超时的记录可重新提交</Text>
                </View>
              </Pressable>

              <Pressable
                disabled={!menuTask || menuTaskBusy}
                style={({ pressed }) => [
                  styles.analyzeHistoryMenuAction,
                  pressed && styles.analyzeHistoryMenuActionPressed,
                  (!menuTask || menuTaskBusy) && styles.analyzeHistoryMenuActionDisabled,
                ]}
                onPress={selectMenuDeleteTask}
              >
                <View style={[styles.analyzeHistoryMenuActionIcon, styles.analyzeHistoryMenuActionIconDanger]}>
                  <Trash2 size={17} color="#ef4444" strokeWidth={2.5} />
                </View>
                <View style={styles.analyzeHistoryMenuActionCopy}>
                  <Text style={[styles.analyzeHistoryMenuActionText, styles.analyzeHistoryMenuActionTextDanger]}>删除识别记录</Text>
                  <Text style={styles.analyzeHistoryMenuActionHint}>只删除历史，不影响已保存饮食</Text>
                </View>
              </Pressable>
            </View>

            <Pressable style={({ pressed }) => [styles.analyzeHistoryMenuCancel, pressed && styles.analyzeHistoryMenuActionPressed]} onPress={closeTaskMenu}>
              <Text style={styles.analyzeHistoryMenuCancelText}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {shareSheet}
    </View>
  )
}

export function TextRecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'TextRecord'>>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const [additionalContext, setAdditionalContext] = useState('')
  const [date, setDate] = useState(route.params?.date || todayKey())
  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const [dietGoal, setDietGoal] = useState<TextRecordDietGoal>('none')
  const [activityTiming, setActivityTiming] = useState<TextRecordActivityTiming>('none')
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshMembership = useCallback(async () => {
    const status = await apiClient.getMyMembership().catch(() => null)
    setMembership(status)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshMembership()
    }, [refreshMembership]),
  )

  const creditSummary = useMemo(() => {
    const max = Number(membership?.daily_credits_max ?? membership?.daily_limit ?? 0)
    const remaining = Number(membership?.total_credits_available ?? membership?.daily_credits_remaining ?? membership?.daily_remaining ?? 0)
    const used = Number(membership?.daily_credits_used ?? (max > 0 ? Math.max(0, max - remaining) : 0))
    return {
      max: Number.isFinite(max) ? max : 0,
      remaining: Number.isFinite(remaining) ? Math.max(0, remaining) : 0,
      used: Number.isFinite(used) ? Math.max(0, used) : 0,
    }
  }, [membership])

  const quotaExhausted = Boolean(membership && creditSummary.remaining < 2)
  const quotaWarn = Boolean(membership && !quotaExhausted && creditSummary.remaining <= 2)
  const quotaText = membership
    ? quotaExhausted
      ? `积分不足，文字分析需 2 积分 · 当前可用 ${creditSummary.remaining}`
      : creditSummary.max > 0
        ? `今日已用 ${creditSummary.used}/${creditSummary.max} 积分 · 剩余 ${creditSummary.remaining}${!membership.is_pro ? '  →开通会员享更高额度' : ''}`
        : `当前可用 ${creditSummary.remaining} 积分 · 文字分析消耗 2 积分${!membership.is_pro ? '  →开通会员享更高额度' : ''}`
    : '文字分析消耗 2 积分，描述越具体，估算越稳定'

  const selectedDietGoal = textRecordDietGoalOptions.find((option) => option.value === dietGoal)
  const selectedActivityTiming = textRecordActivityTimingOptions.find((option) => option.value === activityTiming)

  const submit = async () => {
    if (!text.trim()) {
      void dialog.alert('请输入食物描述', '可以先写下这餐吃了什么，例如“一碗米饭、番茄炒蛋”。', 'warning')
      return
    }
    if (quotaExhausted) {
      void dialog.alert('积分不足', quotaText, 'warning')
      return
    }
    setLoading(true)
    try {
      const contextLines = [
        additionalContext.trim(),
        dietGoal !== 'none' && selectedDietGoal ? `饮食目标：${selectedDietGoal.label}` : '',
        activityTiming !== 'none' && selectedActivityTiming ? `运动时机：${selectedActivityTiming.label}` : '',
      ].filter(Boolean)
      const data = await apiClient.submitTextTask({
        text,
        additionalContext: contextLines.join('\n') || undefined,
        mealType,
        date,
      })
      navigation.navigate('AnalyzeLoading', { taskId: data.task_id, mealType, date, taskType: 'food_text' })
    } catch (error) {
      void dialog.alert('提交失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.textRecordPage}>
      <ScrollView
        style={styles.textRecordScroll}
        contentContainerStyle={[styles.textRecordContent, { paddingBottom: 126 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          disabled={Boolean(membership?.is_pro)}
          style={[
            styles.textRecordQuotaBar,
            quotaWarn && styles.textRecordQuotaBarWarn,
            quotaExhausted && styles.textRecordQuotaBarExhausted,
          ]}
          onPress={() => {
            if (!membership?.is_pro) navigation.navigate('MembershipCenter')
          }}
        >
          <Text style={[styles.textRecordQuotaText, quotaExhausted && styles.textRecordQuotaTextExhausted]}>{quotaText}</Text>
        </Pressable>

        <View style={styles.textRecordInputSection}>
          <Text style={styles.textRecordSectionTitle}>描述您的饮食</Text>
          <View style={styles.textRecordInputCard}>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              maxLength={500}
              textAlignVertical="top"
              style={styles.textRecordFoodInput}
              placeholder={'今天吃了什么？例如：\n· 一碗红烧牛肉面\n· 一个苹果'}
              placeholderTextColor="#9ca3af"
            />
            <Text style={styles.textRecordCharCount}>{text.length}/500</Text>
          </View>
        </View>

        <View style={styles.textQuickTags}>
          <Text style={styles.textQuickTagsLabel}>常用：</Text>
          <View style={styles.textQuickTagsRow}>
            {commonTextFoods.map((food) => (
              <Pressable
                key={food}
                style={({ pressed }) => [styles.textQuickTag, pressed && styles.textRecordPressed]}
                onPress={() => setText((current) => (current.trim() ? `${current.trim()}、${food}` : food))}
              >
                <Text style={styles.textQuickTagText}>{food}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.textRecordInputSection}>
          <Text style={styles.textRecordSectionTitle}>补充份量（可选）</Text>
          <View style={styles.textRecordInputCard}>
            <TextInput
              value={additionalContext}
              onChangeText={setAdditionalContext}
              multiline
              maxLength={200}
              textAlignVertical="top"
              style={styles.textRecordAmountInput}
              placeholder="例如：200g；或一碗、半份"
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>

        <View style={styles.textRecordInputSection}>
          <Text style={styles.textRecordSectionTitle}>记录日期</Text>
          <View style={[styles.textRecordInputCard, styles.textRecordDateCard]}>
            <TextInput
              value={date}
              onChangeText={setDate}
              style={styles.textRecordDateInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
            />
          </View>
        </View>

        <View style={styles.textRecordInputSection}>
          <Text style={styles.textRecordSectionTitle}>选择餐次</Text>
          <View style={styles.textRecordMealGrid}>
            {textRecordMealOptions.map(({ id, name, iconClass }) => {
              const active = mealType === id
              return (
                <Pressable
                  key={id}
                  style={({ pressed }) => [
                    styles.textRecordMealItem,
                    active && styles.textRecordMealItemActive,
                    pressed && styles.textRecordPressed,
                  ]}
                  onPress={() => setMealType(id)}
                >
                  <IconfontText className={`iconfont ${iconClass}`} size={20} color={active ? colors.tabSelected : '#9ca3af'} />
                  <Text style={[styles.textRecordMealName, active && styles.textRecordMealNameActive]}>{name}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={styles.textRecordInputSection}>
          <Text style={styles.textRecordSectionTitle}>饮食目标</Text>
          <View style={styles.textRecordOptionWrap}>
            {textRecordDietGoalOptions.map((option) => {
              const active = dietGoal === option.value
              return (
                <Pressable
                  key={option.value}
                  style={({ pressed }) => [
                    styles.textRecordOption,
                    active && styles.textRecordOptionActive,
                    pressed && styles.textRecordPressed,
                  ]}
                  onPress={() => setDietGoal(option.value)}
                >
                  <Text style={[styles.textRecordOptionText, active && styles.textRecordOptionTextActive]}>{option.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={styles.textRecordInputSection}>
          <Text style={styles.textRecordSectionTitle}>运动时机</Text>
          <View style={styles.textRecordOptionWrap}>
            {textRecordActivityTimingOptions.map((option) => {
              const active = activityTiming === option.value
              return (
                <Pressable
                  key={option.value}
                  style={({ pressed }) => [
                    styles.textRecordOption,
                    active && styles.textRecordOptionActive,
                    pressed && styles.textRecordPressed,
                  ]}
                  onPress={() => setActivityTiming(option.value)}
                >
                  <Text style={[styles.textRecordOptionText, active && styles.textRecordOptionTextActive]}>{option.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.textRecordBottomBar, { paddingBottom: 12 + insets.bottom }]}>
        <Pressable
          disabled={loading || !text.trim() || quotaExhausted}
          style={[
            styles.textRecordSubmitButton,
            (!text.trim() || quotaExhausted) && styles.textRecordSubmitButtonDisabled,
          ]}
          onPress={submit}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={[styles.textRecordSubmitText, (!text.trim() || quotaExhausted) && styles.textRecordSubmitTextDisabled]}>
              {quotaExhausted ? '积分不足，暂不可分析' : '开始智能分析'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  )
}

export function ManualRecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'ManualRecord'>>()
  const dialog = useAppDialog()
  const [browse, setBrowse] = useState<ManualFoodBrowseResult | null>(null)
  const [sourceChannel, setSourceChannel] = useState<ManualFoodSourceChannel>(() => normalizeManualFoodSourceChannel(route.params?.sourceChannel))
  const [catalogItems, setCatalogItems] = useState<ManualFoodItem[]>([])
  const [results, setResults] = useState<ManualFoodItem[]>([])
  const [selectedItems, setSelectedItems] = useState<SelectedManualFood[]>([])
  const [query, setQuery] = useState('')
  const [date, setDate] = useState(route.params?.date || todayKey())
  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getManualFoodBrowse(20)
      setBrowse(data)
    } catch (error) {
      await showError(dialog, '获取食物库失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  const loadCatalog = useCallback(async (category: ManualFoodSourceChannel) => {
    setLoading(true)
    try {
      const data = await apiClient.getManualFoodCatalog(category, { page: 1, pageSize: 30 })
      setCatalogItems(data.items || [])
    } catch (error) {
      await showError(dialog, '获取食物来源失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useEffect(() => {
    const quickItem = route.params?.quickItem
    if (!quickItem) return
    const key = manualFoodKey(quickItem)
    setSourceChannel(normalizeManualFoodSourceChannel(route.params?.sourceChannel))
    setResults([])
    setSelectedItems((current) => {
      if (current.some((entry) => entry.key === key)) return current
      return [
        ...current,
        {
          key,
          item: quickItem,
          weight: manualFoodQuantityInputValue(quickItem, numberFrom(quickItem.default_weight_grams, 100)),
        },
      ]
    })
  }, [route.params?.quickItem, route.params?.sourceChannel])

  useEffect(() => {
    setResults([])
    void loadCatalog(sourceChannel)
  }, [loadCatalog, sourceChannel])

  const refreshManualFoods = useCallback(async () => {
    await load()
    await loadCatalog(sourceChannel)
  }, [load, loadCatalog, sourceChannel])

  const search = async () => {
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      await loadCatalog(sourceChannel)
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.searchManualFood(keyword, 30)
      setResults(data.results || [])
    } catch (error) {
      await showError(dialog, '搜索失败', error)
    } finally {
      setLoading(false)
    }
  }

  const addFood = (item: ManualFoodItem) => {
    const key = manualFoodKey(item)
    setSelectedItems((current) => {
      if (current.some((entry) => entry.key === key)) return current
      return [
        ...current,
        {
          key,
          item,
          weight: manualFoodQuantityInputValue(item, numberFrom(item.default_weight_grams, 100)),
        },
      ]
    })
  }

  const updateSelectedWeight = (key: string, nextWeight: string) => {
    setSelectedItems((current) => current.map((entry) => entry.key === key ? { ...entry, weight: nextWeight } : entry))
  }

  const adjustSelectedWeight = (key: string, delta: number) => {
    setSelectedItems((current) => current.map((entry) => {
      if (entry.key !== key) return entry
      const fallback = numberFrom(entry.item.default_weight_grams, 100)
      const next = Math.max(manualFoodMinQuantity(entry.item), numberFrom(entry.weight, fallback) + delta)
      return { ...entry, weight: manualFoodQuantityInputValue(entry.item, next) }
    }))
  }

  const applySelectedPreset = (key: string, ratio: number) => {
    setSelectedItems((current) => current.map((entry) => {
      if (entry.key !== key) return entry
      const baseWeight = numberFrom(entry.item.default_weight_grams, 100)
      const next = Math.max(manualFoodMinQuantity(entry.item), baseWeight * ratio)
      return { ...entry, weight: manualFoodQuantityInputValue(entry.item, next) }
    }))
  }

  const removeSelectedFood = (key: string) => {
    setSelectedItems((current) => current.filter((entry) => entry.key !== key))
  }

  const save = async () => {
    if (!selectedItems.length) {
      void dialog.alert('请选择食物', '先从下方搜索结果或推荐食物中添加到已选清单。', 'warning')
      return
    }
    const invalid = selectedItems.find((entry) => numberFrom(entry.weight) <= 0)
    if (invalid) {
      void dialog.alert('请检查份量', `请为「${manualFoodTitle(invalid.item)}」填写有效份量。`, 'warning')
      return
    }
    setLoading(true)
    try {
      const saved = await apiClient.saveManualFoodRecords({
        items: selectedItems.map((entry) => ({
          item: entry.item,
          weight: numberFrom(entry.weight, numberFrom(entry.item.default_weight_grams, 100)),
        })),
        mealType,
        date,
      })
      emitHomeIntakeDataChangedEvent({ date, force: true })
      const message = `已将 ${selectedItems.length} 项食物写入${getMealTypeLabel(mealType)}。`
      if (!saved.id) {
        const result = await dialog.showDialog({
          title: '已保存',
          message,
          kind: 'success',
          confirmText: '回到首页',
        })
        if (result === 'confirm') {
          setSelectedItems([])
          navigation.dispatch(CommonActions.navigate('MainTabs'))
        }
        return
      }
      const result = await dialog.showDialog({
        title: '已保存',
        message,
        kind: 'success',
        cancelText: '回到首页',
        confirmText: '查看记录',
      })
      if (result === 'confirm') {
        setSelectedItems([])
        navigation.navigate('RecordDetail', { recordId: saved.id })
      } else if (result === 'cancel') {
        setSelectedItems([])
        navigation.dispatch(CommonActions.navigate('MainTabs'))
      }
    } catch (error) {
      void dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const recommended = useMemo(() => flattenManualFoodBrowse(browse), [browse])
  const channelItems = catalogItems.length ? catalogItems : sourceChannel === 'common' ? recommended : catalogItems
  const list = results.length ? results : channelItems
  const listTitle = results.length
    ? '搜索结果'
    : manualFoodSourceChannels.find((channel) => channel.key === sourceChannel)?.label || '推荐'
  const emptyText = sourceChannel === 'campus' ? '暂无校园食堂菜品' : '没有可选食物'
  const selectedKeys = useMemo(() => new Set(selectedItems.map((entry) => entry.key)), [selectedItems])
  const totals = useMemo(() => {
    return selectedItems.reduce((sum, entry) => {
      const quantity = numberFrom(entry.weight, numberFrom(entry.item.default_weight_grams, 100))
      const nutrients = scaledManualFoodNutrition(entry.item, quantity)
      const isPortionUnit = manualFoodUsesPortionUnit(entry.item)
      return {
        calories: sum.calories + nutrients.calories,
        protein: sum.protein + nutrients.protein,
        carbs: sum.carbs + nutrients.carbs,
        fat: sum.fat + nutrients.fat,
        weight: sum.weight + (isPortionUnit ? 0 : nutrients.weight),
        portions: sum.portions + (isPortionUnit ? quantity : 0),
      }
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, weight: 0, portions: 0 })
  }, [selectedItems])
  const totalQuantityText = formatManualFoodTotalQuantity(totals)

  return (
    <View style={styles.manualRecordPage}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.manualRecordContent, selectedItems.length > 0 && styles.manualRecordContentWithBar]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refreshManualFoods} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.manualWorkspaceCard}>
          <View style={styles.manualWorkspaceHeader}>
            <View style={styles.flex}>
              <Text style={styles.manualWorkspaceTitle}>单餐工作台</Text>
              <Text style={styles.manualWorkspaceSubtitle}>{selectedItems.length ? `已选 ${selectedItems.length} 项 · ${totalQuantityText}` : '先选食物，再调整份量'}</Text>
            </View>
            <View style={styles.manualWorkspaceCalories}>
              <Text style={styles.manualWorkspaceCaloriesValue}>{Math.round(totals.calories)}</Text>
              <Text style={styles.manualWorkspaceCaloriesUnit}>kcal</Text>
            </View>
          </View>

          <View style={styles.manualMealGrid}>
            {mealOptions.map((meal) => (
              <Pressable
                key={meal}
                style={[styles.manualMealItem, mealType === meal && styles.manualMealItemActive]}
                onPress={() => setMealType(meal)}
              >
                <Text style={[styles.manualMealIcon, mealType === meal && styles.manualMealIconActive]}>{manualMealIcons[meal]}</Text>
                <Text style={[styles.manualMealName, mealType === meal && styles.manualMealNameActive]}>{getMealTypeLabel(meal)}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.manualDateRow}>
            <Text style={styles.manualDateLabel}>记录日期</Text>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              style={styles.manualDateInput}
            />
          </View>

          <View style={styles.manualSearchBar}>
            <Search size={18} color="#94a3b8" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索食物，找不到可自定义"
              placeholderTextColor="#94a3b8"
              returnKeyType="search"
              onSubmitEditing={search}
              style={styles.manualSearchInput}
            />
            {query.trim() ? (
              <Pressable
                style={styles.manualSearchIconButton}
                hitSlop={8}
                onPress={() => {
                  setQuery('')
                  setResults([])
                }}
              >
                <X size={16} color="#94a3b8" />
              </Pressable>
            ) : null}
            <Pressable style={styles.manualSearchAction} onPress={search}>
              {loading ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.manualSearchActionText}>搜索</Text>}
            </Pressable>
          </View>

          <Pressable style={styles.manualCustomEntryCard} onPress={() => navigation.navigate('FoodLibrary', { initialTab: 'create' })}>
            <View style={styles.flex}>
              <Text style={styles.manualCustomEntryTitle}>没有找到？直接自定义</Text>
              <Text style={styles.manualCustomEntrySubtitle}>不拍照，不走 AI，填一次后下次可复用</Text>
            </View>
            <View style={styles.manualCustomEntryButton}>
              <Text style={styles.manualCustomEntryButtonText} numberOfLines={1}>{query.trim() ? `新建“${query.trim()}”` : '新建'}</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.manualCatalogShell}>
          {!query.trim() ? (
            <ScrollView style={styles.manualCatalogSidebar} contentContainerStyle={styles.manualCatalogSidebarContent} showsVerticalScrollIndicator={false}>
              {manualFoodSourceChannels.map((channel) => (
                <Pressable
                  key={channel.key}
                  style={[styles.manualCatalogTab, sourceChannel === channel.key && styles.manualCatalogTabActive]}
                  onPress={() => setSourceChannel(channel.key)}
                >
                  <Text style={[styles.manualCatalogTabText, sourceChannel === channel.key && styles.manualCatalogTabTextActive]}>{channel.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.manualCatalogMain}>
            <View style={styles.manualLibraryHeader}>
              <View style={styles.flex}>
                <Text style={styles.manualSectionTitle}>{listTitle}</Text>
                <Text style={styles.manualLibrarySubtitle}>
                  {query.trim() ? `围绕“${query.trim()}”优先展示匹配食物` : selectedItems.length ? `已选 ${selectedItems.length} 项 · ${Math.round(totals.calories)} kcal` : '从食物库点选加入本餐'}
                </Text>
              </View>
            </View>

            {loading && !list.length ? (
              <View style={styles.manualLoadingState}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : list.length === 0 ? (
              <View style={styles.manualEmptyState}>
                <Text style={styles.manualEmptyText}>{emptyText}</Text>
              </View>
            ) : (
              <View style={styles.manualFoodList}>
                {list.map((item, index) => (
                  <ManualFoodChoiceRow
                    key={`${manualFoodTitle(item)}-${item.id || index}`}
                    item={item}
                    selected={selectedKeys.has(manualFoodKey(item))}
                    onPress={() => addFood(item)}
                  />
                ))}
              </View>
            )}
          </View>
        </View>

        {selectedItems.length > 0 ? (
          <View style={styles.manualSelectedSection}>
            <View style={styles.manualSectionHeader}>
              <View style={styles.flex}>
                <Text style={styles.manualSectionTitle}>已选食物</Text>
                <Text style={styles.manualLibrarySubtitle}>{selectedItems.length} 项 · {totalQuantityText}</Text>
              </View>
              <View style={styles.manualTotalCalories}>
                <Text style={styles.manualTotalCaloriesValue}>{Math.round(totals.calories)}</Text>
                <Text style={styles.manualTotalCaloriesUnit}>kcal</Text>
              </View>
            </View>
            <View style={styles.manualNutritionGrid}>
              <SummaryCell title="蛋白质" value={round1(totals.protein)} unit="g" />
              <SummaryCell title="碳水" value={round1(totals.carbs)} unit="g" />
              <SummaryCell title="脂肪" value={round1(totals.fat)} unit="g" />
              <SummaryCell title="份量" value={totalQuantityText} unit="" />
            </View>
            {selectedItems.map((entry) => (
              <ManualSelectedFoodItem
                key={entry.key}
                entry={entry}
                onWeightChange={(value) => updateSelectedWeight(entry.key, value)}
                onAdjust={(delta) => adjustSelectedWeight(entry.key, delta)}
                onPreset={(ratio) => applySelectedPreset(entry.key, ratio)}
                onRemove={() => removeSelectedFood(entry.key)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {selectedItems.length > 0 ? (
        <View style={styles.manualBottomBar}>
          <Pressable style={styles.manualBottomSummary}>
            <View style={styles.manualBottomSummaryMain}>
              <Text style={styles.manualBottomSummaryText}>已选 {selectedItems.length} 项 · {Math.round(totals.calories)} kcal</Text>
              <Text style={styles.manualBottomSummaryAction}>查看</Text>
            </View>
            <Text style={styles.manualBottomSummarySubtext}>继续调整后保存为{getMealTypeLabel(mealType)}记录</Text>
          </Pressable>
          <Pressable style={[styles.manualSaveButton, loading && styles.manualSaveButtonDisabled]} disabled={loading} onPress={save}>
            {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.manualSaveButtonText}>保存到今天记录</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

export function FoodLibraryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'FoodLibrary'>>()
  const dialog = useAppDialog()
  const [browse, setBrowse] = useState<ManualFoodBrowseResult | null>(null)
  const [customFoods, setCustomFoods] = useState<ManualFoodItem[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ManualFoodItem[]>([])
  const [tabMode, setTabMode] = useState<FoodLibraryTabMode>(route.params?.initialTab || 'all')
  const [sortBy, setSortBy] = useState<FoodLibrarySortMode>('latest')
  const [showMoreNutrients, setShowMoreNutrients] = useState(false)
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [defaultWeight, setDefaultWeight] = useState('100')
  const [portionLabel, setPortionLabel] = useState('')
  const [imageUrls, setImageUrls] = useState('')
  const [fiber, setFiber] = useState('')
  const [sugar, setSugar] = useState('')
  const [sodiumMg, setSodiumMg] = useState('')
  const [shareToPublic, setShareToPublic] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [browseData, customData] = await Promise.all([
        apiClient.getManualFoodBrowse(24),
        apiClient.getCustomFoods(50).catch(() => ({ items: [] })),
      ])
      setBrowse(browseData)
      setCustomFoods(customData.items || [])
    } catch (error) {
      await dialog.alert('获取食物库失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (route.params?.initialTab) {
      setTabMode(route.params.initialTab)
    }
  }, [route.params?.initialTab])

  const search = async () => {
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      setTabMode('all')
      return
    }
    setSearching(true)
    try {
      const data = await apiClient.searchManualFood(keyword, 40)
      setResults(data.results || [])
      setTabMode('results')
    } catch (error) {
      await dialog.alert('搜索失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSearching(false)
    }
  }

  const resetCustomDraft = () => {
    setName('')
    setCalories('')
    setProtein('')
    setCarbs('')
    setFat('')
    setDefaultWeight('100')
    setPortionLabel('')
    setImageUrls('')
    setFiber('')
    setSugar('')
    setSodiumMg('')
    setShareToPublic(false)
  }

  const saveCustom = async () => {
    const title = name.trim()
    const defaultWeightGrams = numberOrUndefined(defaultWeight) || 100
    const per100g = {
      calories: numberOrUndefined(calories) || 0,
      protein: numberOrUndefined(protein) || 0,
      carbs: numberOrUndefined(carbs) || 0,
      fat: numberOrUndefined(fat) || 0,
      fiber: numberOrUndefined(fiber) || 0,
      sugar: numberOrUndefined(sugar) || 0,
      sodium_mg: numberOrUndefined(sodiumMg) || 0,
    }
    const validationError = validateCustomFoodDraft(title, defaultWeightGrams, per100g)
    if (validationError) {
      await dialog.alert('请检查食物信息', validationError, 'warning')
      return
    }
    const imageList = splitImageUrls(imageUrls)
    const scale = defaultWeightGrams / 100
    setSaving(true)
    try {
      await apiClient.saveCustomFood({
        title,
        defaultWeightGrams,
        totalCalories: round1(per100g.calories * scale),
        totalProtein: round1(per100g.protein * scale),
        totalCarbs: round1(per100g.carbs * scale),
        totalFat: round1(per100g.fat * scale),
        nutrientsPer100g: per100g,
        extraNutrients: per100g,
        imagePath: imageList[0],
        imagePaths: imageList,
        portionLabel: portionLabel.trim() || `${Math.round(defaultWeightGrams)}g`,
        recommendReason: `自定义录入 / 每 100g`,
        shareToPublic,
      })
      resetCustomDraft()
      await load()
      setTabMode('custom')
      await dialog.alert('已保存', shareToPublic ? '自定义食物已保存，并同步提交到公共库审核。' : '自定义食物已加入食物库。', 'success')
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const openDetail = (item: ManualFoodItem) => {
    navigation.navigate('FoodLibraryDetail', {
      itemId: item.id ? String(item.id) : undefined,
      item,
    })
  }

  const quickRecord = (item: ManualFoodItem) => {
    navigation.navigate('ManualRecord', { quickItem: item })
  }

  const recommendedFoods = useMemo(() => flattenManualFoodBrowse(browse), [browse])
  const activeFoods = useMemo(() => {
    const source = tabMode === 'custom'
      ? customFoods
      : tabMode === 'results'
        ? results
        : recommendedFoods
    return sortFoodLibraryItems(source, sortBy)
  }, [customFoods, recommendedFoods, results, sortBy, tabMode])
  const draftImageUri = useMemo(() => manualFoodImageUri({ image_path: splitImageUrls(imageUrls)[0] }), [imageUrls])
  const tabs: Array<{ key: FoodLibraryTabMode; label: string; count?: number }> = [
    { key: 'all', label: '全部', count: recommendedFoods.length },
    { key: 'custom', label: '我的', count: customFoods.length },
    { key: 'results', label: '搜索', count: results.length },
    { key: 'create', label: '新建' },
  ]
  const activeSubtitle = tabMode === 'custom'
    ? (customFoods.length ? `${customFoods.length} 个自定义食物` : '暂无自定义食物，先新建一个常吃的')
    : tabMode === 'results'
      ? (query.trim() ? `围绕“${query.trim()}”展示匹配食物` : '输入关键词后查看搜索结果')
      : '标准食物、公共库和最近常用食物'

  return (
    <View style={styles.foodLibraryPage}>
      <View style={styles.foodLibraryTabs}>
        {tabs.map((tab) => {
          const active = tabMode === tab.key
          return (
            <Pressable key={tab.key} style={[styles.foodLibraryTab, active && styles.foodLibraryTabActive]} onPress={() => setTabMode(tab.key)}>
              <Text style={[styles.foodLibraryTabText, active && styles.foodLibraryTabTextActive]} numberOfLines={1}>
                {tab.label}{typeof tab.count === 'number' ? ` ${tab.count}` : ''}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor="#5cb896" colors={['#5cb896']} />}
        contentContainerStyle={styles.foodLibraryContent}
      >
        <View style={styles.foodLibraryFilterSection}>
          <View style={styles.foodLibrarySearchRow}>
            <View style={styles.foodLibrarySearchInputWrap}>
              <Search size={16} color="#9ca3af" />
              <TextInput
                style={styles.foodLibrarySearchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="搜索商家名称或食物"
                placeholderTextColor="#9ca3af"
                returnKeyType="search"
                onSubmitEditing={search}
              />
            </View>
            <Pressable style={[styles.foodLibrarySearchButton, searching && styles.foodLibraryActionDisabled]} disabled={searching} onPress={search}>
              {searching ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.foodLibrarySearchButtonText}>搜索</Text>}
            </Pressable>
          </View>
        </View>

        {tabMode !== 'create' ? (
          <View style={styles.foodLibrarySortSection}>
            <View style={styles.foodLibrarySortLeft}>
              {foodLibrarySortOptions.map((option) => {
                const active = sortBy === option.key
                return (
                  <Pressable key={option.key} style={styles.foodLibrarySortItem} onPress={() => setSortBy(option.key)}>
                    <Text style={[styles.foodLibrarySortText, active && styles.foodLibrarySortTextActive]}>{option.label}</Text>
                    {active ? <View style={styles.foodLibrarySortUnderline} /> : null}
                  </Pressable>
                )
              })}
            </View>
            <Pressable style={styles.foodLibraryNewButton} onPress={() => setTabMode('create')}>
              <Text style={styles.foodLibraryNewButtonText}>新建</Text>
            </Pressable>
          </View>
        ) : null}

        {tabMode === 'create' ? (
          <View style={styles.foodLibraryCustomPanel}>
            <View style={styles.foodLibraryCustomHeader}>
              <View style={styles.foodLibraryCustomHeaderCopy}>
                <Text style={styles.foodLibraryCustomTitle}>自定义食物</Text>
                <Text style={styles.foodLibraryCustomSubtitle}>不拍照，不走 AI，填一次后下次可复用</Text>
              </View>
              <Pressable style={styles.foodLibraryCollapseButton} onPress={() => setTabMode(customFoods.length ? 'custom' : 'all')}>
                <Text style={styles.foodLibraryCollapseButtonText}>收起</Text>
              </Pressable>
            </View>

            <View style={styles.foodLibraryImageRow}>
              <View style={styles.foodLibraryImagePreview}>
                {draftImageUri ? (
                  <Image source={{ uri: draftImageUri }} style={styles.foodLibraryImage} />
                ) : (
                  <View style={styles.foodLibraryImageEmpty}>
                    <ImagePlus size={24} color="#10b981" />
                  </View>
                )}
              </View>
              <View style={styles.foodLibraryImageActions}>
                <Text style={styles.foodLibraryImageTitle}>食物图片</Text>
                <TextInput
                  style={styles.foodLibraryImageInput}
                  value={imageUrls}
                  onChangeText={setImageUrls}
                  placeholder="图片 URL，可留空"
                  placeholderTextColor="#94a3b8"
                />
              </View>
            </View>

            <View style={styles.foodLibraryCustomGrid}>
              <View style={styles.foodLibraryCustomFieldFull}>
                <Text style={styles.foodLibraryCustomLabel}>名称</Text>
                <TextInput style={styles.foodLibraryCustomInput} value={name} onChangeText={setName} placeholder="例如 家里卤牛肉" placeholderTextColor="#94a3b8" />
              </View>
              <View style={styles.foodLibraryCustomField}>
                <Text style={styles.foodLibraryCustomLabel}>默认份量 g</Text>
                <TextInput style={styles.foodLibraryCustomInput} value={defaultWeight} onChangeText={setDefaultWeight} keyboardType="decimal-pad" />
              </View>
              <View style={styles.foodLibraryCustomField}>
                <Text style={styles.foodLibraryCustomLabel}>份量说明</Text>
                <TextInput style={styles.foodLibraryCustomInput} value={portionLabel} onChangeText={setPortionLabel} placeholder="如 一碗" placeholderTextColor="#94a3b8" />
              </View>
              <View style={styles.foodLibraryBasisPresets}>
                {['100', '60', '30'].map((basis) => (
                  <Pressable key={basis} style={[styles.foodLibraryBasisChip, defaultWeight === basis && styles.foodLibraryBasisChipActive]} onPress={() => setDefaultWeight(basis)}>
                    <Text style={[styles.foodLibraryBasisChipText, defaultWeight === basis && styles.foodLibraryBasisChipTextActive]}>每 {basis}g</Text>
                  </Pressable>
                ))}
              </View>
              <FoodLibraryCompactField label="热量 kcal/100g" value={calories} onChangeText={setCalories} />
              <FoodLibraryCompactField label="蛋白质 g/100g" value={protein} onChangeText={setProtein} />
              <FoodLibraryCompactField label="碳水 g/100g" value={carbs} onChangeText={setCarbs} />
              <FoodLibraryCompactField label="脂肪 g/100g" value={fat} onChangeText={setFat} />
            </View>

            <Pressable style={styles.foodLibraryMoreToggle} onPress={() => setShowMoreNutrients((prev) => !prev)}>
              <Text style={styles.foodLibraryMoreText}>维生素 / 矿物质</Text>
              <Text style={styles.foodLibraryMoreAction}>{showMoreNutrients ? '收起' : '展开'}</Text>
            </Pressable>
            {showMoreNutrients ? (
              <View style={styles.foodLibraryCustomGrid}>
                <FoodLibraryCompactField label="膳食纤维 g/100g" value={fiber} onChangeText={setFiber} />
                <FoodLibraryCompactField label="糖 g/100g" value={sugar} onChangeText={setSugar} />
                <FoodLibraryCompactField label="钠 mg/100g" value={sodiumMg} onChangeText={setSodiumMg} />
              </View>
            ) : null}

            <Pressable style={styles.foodLibraryPublicRow} onPress={() => setShareToPublic((prev) => !prev)}>
              <View style={styles.foodLibraryPublicCopy}>
                <Text style={styles.foodLibraryPublicTitle}>贡献到公共临时库</Text>
                <Text style={styles.foodLibraryPublicSubtitle}>审核通过后可给大家复用</Text>
              </View>
              <View style={[styles.foodLibraryPublicSwitch, shareToPublic && styles.foodLibraryPublicSwitchActive]}>
                <View style={[styles.foodLibraryPublicKnob, shareToPublic && styles.foodLibraryPublicKnobActive]} />
              </View>
            </Pressable>

            <View style={styles.foodLibraryCustomActions}>
              <Pressable style={styles.foodLibrarySecondaryButton} onPress={resetCustomDraft}>
                <Text style={styles.foodLibrarySecondaryButtonText}>清空</Text>
              </Pressable>
              <Pressable style={[styles.foodLibraryPrimaryButton, saving && styles.foodLibraryActionDisabled]} disabled={saving} onPress={saveCustom}>
                {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.foodLibraryPrimaryButtonText}>完成自定义</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.foodLibraryListContent}>
            <View style={styles.foodLibraryListHeader}>
              <View style={styles.foodLibraryListHeaderCopy}>
                <Text style={styles.foodLibraryListTitle}>{tabMode === 'custom' ? '我的食物' : tabMode === 'results' ? '搜索结果' : '推荐食物'}</Text>
                <Text style={styles.foodLibraryListSubtitle}>{activeSubtitle}</Text>
              </View>
              {loading ? <ActivityIndicator size="small" color="#5cb896" /> : null}
            </View>
            {loading && activeFoods.length === 0 ? (
              <FoodLibrarySkeleton />
            ) : activeFoods.length === 0 ? (
              <View style={styles.foodLibraryEmptyState}>
                <Text style={styles.foodLibraryEmptyIcon}>食</Text>
                <Text style={styles.foodLibraryEmptyText}>{tabMode === 'custom' ? '暂无自定义食物，先新建一个常吃的' : tabMode === 'results' ? '暂无匹配食物，换个关键词试试' : '暂无内容，稍后下拉刷新'}</Text>
                <Pressable style={styles.foodLibraryEmptyButton} onPress={() => setTabMode(tabMode === 'results' ? 'all' : 'create')}>
                  <Text style={styles.foodLibraryEmptyButtonText}>{tabMode === 'results' ? '去逛逛' : '去新建'}</Text>
                </Pressable>
              </View>
            ) : (
              activeFoods.slice(0, 40).map((item, index) => (
                <FoodLibraryCard
                  key={`${tabMode}-${manualFoodTitle(item)}-${item.id || index}`}
                  item={item}
                  latest={sortBy === 'latest' && index === 0}
                  onOpen={() => openDetail(item)}
                  onRecord={() => quickRecord(item)}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

export function HealthProfileScreen() {
  const dialog = useAppDialog()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [currentStep, setCurrentStep] = useState(0)
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [age, setAge] = useState('25')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [birthday, setBirthday] = useState('')
  const [gender, setGender] = useState('')
  const [activityLevel, setActivityLevel] = useState('')
  const [dietGoal, setDietGoal] = useState('')
  const [medicalHistory, setMedicalHistory] = useState<string[]>([])
  const [dietPreference, setDietPreference] = useState<string[]>([])
  const [allergyList, setAllergyList] = useState<string[]>([])
  const [sleepHour, setSleepHour] = useState('23')
  const [wakeHour, setWakeHour] = useState('7')
  const [healthNotes, setHealthNotes] = useState('')
  const [calorieTarget, setCalorieTarget] = useState('')
  const [proteinTarget, setProteinTarget] = useState('')
  const [carbsTarget, setCarbsTarget] = useState('')
  const [fatTarget, setFatTarget] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profileData, targets] = await Promise.all([
        apiClient.getHealthProfile(),
        apiClient.getDashboardTargets().catch((): Record<string, number> => ({})),
      ])
      setProfile(profileData)
      setHeight(stringFrom(profileData.height) || '170')
      setWeight(stringFrom(profileData.weight) || '60')
      const nextBirthday = stringFrom(profileData.birthday)
      setBirthday(nextBirthday)
      setAge(ageFromBirthday(nextBirthday) || '25')
      setGender(stringFrom(profileData.gender))
      const condition = profileData.health_condition || {}
      setActivityLevel(stringFrom(condition.daily_life_activity_level || profileData.daily_life_activity_level || profileData.activity_level))
      setDietGoal(stringFrom(profileData.diet_goal))
      setMedicalHistory(stringArrayFrom(condition.medical_history))
      setDietPreference(stringArrayFrom(condition.diet_preference))
      setAllergyList(stringArrayFrom(condition.allergies))
      const routine = parseHealthRoutine(condition.routine_type)
      setSleepHour(stringFrom(condition.routine_sleep_hour) || routine.sleep || '23')
      setWakeHour(stringFrom(condition.routine_wake_hour) || routine.wake || '7')
      setHealthNotes(stringFrom(condition.health_notes))
      setCalorieTarget(stringFrom(targets.calorie_target))
      setProteinTarget(stringFrom(targets.protein_target))
      setCarbsTarget(stringFrom(targets.carbs_target))
      setFatTarget(stringFrom(targets.fat_target))
    } catch (error) {
      await dialog.alert('获取健康档案失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useEffect(() => {
    void load()
  }, [load])

  const currentStepKey = healthProfileSteps[currentStep] || 'gender'
  const isLastStep = currentStep === healthProfileSteps.length - 1
  const ageNumber = Number(age)
  const heightNumber = Number(height)
  const weightNumber = Number(weight)
  const sleepNumber = Number(sleepHour)
  const wakeNumber = Number(wakeHour)
  const isAgeValid = Number.isFinite(ageNumber) && ageNumber >= 1 && ageNumber <= 100
  const isHeightValid = Number.isFinite(heightNumber) && heightNumber >= 100 && heightNumber <= 250
  const isWeightValid = Number.isFinite(weightNumber) && weightNumber >= 30 && weightNumber <= 200
  const isRoutineValid = Number.isFinite(sleepNumber) && sleepNumber >= 0 && sleepNumber <= 23 && Number.isFinite(wakeNumber) && wakeNumber >= 0 && wakeNumber <= 23

  const canProceed = useMemo(() => {
    switch (currentStepKey) {
      case 'gender':
        return !!gender
      case 'age':
        return isAgeValid
      case 'height':
        return isHeightValid
      case 'weight':
        return isWeightValid
      case 'goal':
        return !!dietGoal
      case 'activity':
        return !!activityLevel
      case 'routine':
        return isRoutineValid
      default:
        return true
    }
  }, [activityLevel, currentStepKey, dietGoal, gender, isAgeValid, isHeightValid, isRoutineValid, isWeightValid])

  const toggleMedical = useCallback((value: string) => {
    setMedicalHistory((current) => toggleHealthSelection(current, value))
  }, [])

  const toggleDietPreference = useCallback((value: string) => {
    setDietPreference((current) => toggleHealthSelection(current, value))
  }, [])

  const toggleAllergy = useCallback((value: string) => {
    setAllergyList((current) => toggleHealthSelection(current, value))
  }, [])

  const goNext = () => {
    if (!canProceed) return
    setCurrentStep((step) => Math.min(step + 1, healthProfileSteps.length - 1))
  }

  const goPrev = () => {
    setCurrentStep((step) => Math.max(step - 1, 0))
  }

  const save = async () => {
    if (!gender || !isAgeValid || !isHeightValid || !isWeightValid || !dietGoal || !activityLevel) {
      await dialog.alert('请完成必填信息', '性别、年龄、身高、体重、健康目标和日常活动会影响营养建议。', 'warning')
      return
    }
    const confirmed = await dialog.confirm({
      title: '确认保存',
      message: '确定将当前填写的健康信息保存到个人档案吗？',
      confirmText: '保存档案',
      cancelText: '取消',
      kind: 'info',
    })
    if (!confirmed) return
    setSaving(true)
    try {
      const finalBirthday = birthdayFromAge(age) || birthday.trim()
      const routineType = formatHealthRoutine(sleepHour, wakeHour)
      await apiClient.updateHealthProfile({
        height: isHeightValid ? heightNumber : numberOrUndefined(height),
        weight: isWeightValid ? weightNumber : numberOrUndefined(weight),
        birthday: finalBirthday,
        gender: gender.trim(),
        activity_level: activityLevel.trim(),
        daily_life_activity_level: activityLevel.trim(),
        diet_goal: dietGoal.trim(),
        execution_mode: 'standard',
        medical_history: healthListForSubmit(medicalHistory),
        diet_preference: healthListForSubmit(dietPreference),
        allergies: healthListForSubmit(allergyList),
        routine_type: routineType,
        routine_sleep_hour: Number(sleepHour),
        routine_wake_hour: Number(wakeHour),
        health_notes: healthNotes.trim() || undefined,
      })
      if (calorieTarget || proteinTarget || carbsTarget || fatTarget) {
        await apiClient.updateDashboardTargets({
          calorie_target: Number(calorieTarget) || 0,
          protein_target: Number(proteinTarget) || 0,
          carbs_target: Number(carbsTarget) || 0,
          fat_target: Number(fatTarget) || 0,
          target_date: todayKey(),
        })
      }
      await load()
      await dialog.alert('已保存', '健康档案已更新', 'success')
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const renderStep = () => {
    switch (currentStepKey) {
      case 'gender':
        return (
          <>
            <HealthProfileStepHeader title="基础信息" subtitle="选择你的性别，让我们更了解你。" />
            <View style={styles.healthProfileChoiceList}>
              {healthGenderOptions.map((option) => (
                <HealthProfileChoiceCard
                  key={option.value}
                  label={option.label}
                  active={gender === option.value}
                  size="big"
                  onPress={() => setGender(option.value)}
                />
              ))}
            </View>
          </>
        )
      case 'age':
        return (
          <>
            <HealthProfileStepHeader title="基础信息" subtitle="选择你的年龄，让我们更了解你。" />
            <HealthProfileNumberCard value={age} unit="岁" min="1" max="100" onChange={setAge} />
            <Text style={styles.healthProfileSkipHint}>保存时会按年龄换算为生日，用于能量与营养建议。</Text>
          </>
        )
      case 'height':
        return (
          <>
            <HealthProfileStepHeader title="身体数据" subtitle="你的身高是多少？" />
            <HealthProfileNumberCard value={height} unit="cm" min="100" max="250" onChange={setHeight} />
            <Text style={styles.healthProfileSkipHint}>建议填写 100-250 cm 之间的身高。</Text>
          </>
        )
      case 'weight':
        return (
          <>
            <HealthProfileStepHeader title="身体数据" subtitle="你的体重是多少？" />
            <HealthProfileNumberCard value={weight} unit="kg" min="30" max="200" onChange={setWeight} />
            <Text style={styles.healthProfileSkipHint}>建议填写 30-200 kg 之间的体重。</Text>
          </>
        )
      case 'goal':
        return (
          <>
            <HealthProfileStepHeader title="健康目标" subtitle="你希望达到什么样的身体状态？" />
            <View style={styles.healthProfileChoiceList}>
              {healthDietGoalOptions.map((option) => (
                <HealthProfileChoiceCard
                  key={option.value}
                  label={option.label}
                  desc={option.desc}
                  icon={option.icon}
                  active={dietGoal === option.value}
                  onPress={() => setDietGoal(option.value)}
                />
              ))}
            </View>
          </>
        )
      case 'activity':
        return (
          <>
            <HealthProfileStepHeader title="日常活动" subtitle="不算专门健身，你平时的一天更接近哪种状态？" />
            <View style={styles.healthProfileChoiceList}>
              {healthActivityOptions.map((option) => (
                <HealthProfileChoiceCard
                  key={option.value}
                  label={option.label}
                  desc={option.desc}
                  icon={option.icon}
                  active={activityLevel === option.value}
                  onPress={() => setActivityLevel(option.value)}
                />
              ))}
            </View>
          </>
        )
      case 'routine':
        return (
          <>
            <HealthProfileStepHeader title="作息习惯" subtitle="了解你的作息，让算法更加懂你。" />
            <View style={styles.healthProfileRoutineRow}>
              <HealthProfileRoutineField label="入睡" value={sleepHour} onChange={setSleepHour} />
              <HealthProfileRoutineField label="起床" value={wakeHour} onChange={setWakeHour} />
            </View>
            <View style={styles.healthProfileInputCard}>
              <Text style={styles.healthProfileInputHint}>常见示例：23 点睡，7 点起。只填 0-23 的小时数字。</Text>
            </View>
          </>
        )
      case 'medical':
        return (
          <>
            <HealthProfileStepHeader title="既往病史" subtitle="是否有以下病史？（可多选）" />
            <View style={styles.healthProfileOptionGrid}>
              {healthMedicalOptions.map((option) => (
                <HealthProfileChoiceCard
                  key={option.value}
                  label={option.label}
                  active={medicalHistory.includes(option.value)}
                  size="small"
                  onPress={() => toggleMedical(option.value)}
                />
              ))}
            </View>
          </>
        )
      case 'diet':
        return (
          <>
            <HealthProfileStepHeader title="饮食习惯" subtitle="你有特殊的饮食习惯吗？（可多选）" />
            <View style={styles.healthProfileOptionGrid}>
              {healthDietPreferenceOptions.map((option) => (
                <HealthProfileChoiceCard
                  key={option.value}
                  label={option.label}
                  icon={option.icon}
                  active={dietPreference.includes(option.value)}
                  size="small"
                  onPress={() => toggleDietPreference(option.value)}
                />
              ))}
            </View>
          </>
        )
      case 'allergy':
        return (
          <>
            <HealthProfileStepHeader title="过敏源" subtitle="有过敏源吗？（可多选）" />
            <View style={styles.healthProfileOptionGrid}>
              {healthAllergyOptions.map((option) => (
                <HealthProfileChoiceCard
                  key={option.value}
                  label={option.label}
                  icon={option.icon}
                  active={allergyList.includes(option.value)}
                  size="small"
                  onPress={() => toggleAllergy(option.value)}
                />
              ))}
            </View>
          </>
        )
      case 'notes':
      default:
        return (
          <>
            <HealthProfileStepHeader title="补充信息" subtitle="有其他特殊情况需要补充吗？（选填）" />
            <View style={styles.healthProfileInputCard}>
              <TextInput
                value={healthNotes}
                onChangeText={setHealthNotes}
                multiline
                maxLength={500}
                placeholder="例如：孕期、哺乳期、手术恢复期等"
                placeholderTextColor="#94a3b8"
                textAlignVertical="top"
                style={styles.healthProfileTextarea}
              />
            </View>
            <Text style={styles.healthProfileSkipHint}>记录身体的特殊情况，让分析更准确（没有可留空）</Text>

            <View style={styles.healthProfileTargetPanel}>
              <Text style={styles.healthProfileTargetTitle}>首页目标</Text>
              <Text style={styles.healthProfileTargetSubtitle}>同步首页热量和三大营养素目标。</Text>
              <View style={styles.healthProfileTargetGrid}>
                <HealthProfileTargetField label="热量" unit="kcal" value={calorieTarget} onChange={setCalorieTarget} />
                <HealthProfileTargetField label="蛋白质" unit="g" value={proteinTarget} onChange={setProteinTarget} />
                <HealthProfileTargetField label="碳水" unit="g" value={carbsTarget} onChange={setCarbsTarget} />
                <HealthProfileTargetField label="脂肪" unit="g" value={fatTarget} onChange={setFatTarget} />
              </View>
              <Pressable style={styles.healthProfileReportLink} onPress={() => navigation.navigate('HealthProfileView')}>
                <Text style={styles.healthProfileReportLinkText}>体检报告与详情在档案详情页继续管理</Text>
                <Text style={styles.healthProfileReportLinkArrow}>›</Text>
              </Pressable>
            </View>
          </>
        )
    }
  }

  if (loading && !profile) {
    return (
      <View style={styles.healthProfilePage}>
        <View style={styles.healthProfileLoading}>
          <ActivityIndicator color={colors.brand} size="small" />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.healthProfilePage}>
      <View style={styles.healthProfileProgressWrap}>
        <View style={styles.healthProfileProgressDots}>
          {healthProfileSteps.map((step, index) => (
            <View
              key={step}
              style={[
                styles.healthProfileProgressDot,
                index <= currentStep && styles.healthProfileProgressDotActive,
                index === currentStep && styles.healthProfileProgressDotCurrent,
              ]}
            />
          ))}
        </View>
        <Text style={styles.healthProfileProgressText}>{currentStep + 1} / {healthProfileSteps.length}</Text>
      </View>

      <ScrollView
        style={styles.healthProfileScroll}
        contentContainerStyle={[styles.healthProfileStepCard, { paddingBottom: Math.max(insets.bottom, 16) + 28 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && Boolean(profile)} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        {renderStep()}
        <View style={[styles.healthProfileFooter, currentStep === 0 && styles.healthProfileFooterSingle]}>
          {currentStep > 0 ? (
            <Pressable style={styles.healthProfilePrevButton} disabled={saving} onPress={goPrev}>
              <Text style={styles.healthProfilePrevText}>‹ 上一步</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[
              styles.healthProfileNextButton,
              !canProceed && styles.healthProfileNextButtonDisabled,
              isLastStep && styles.healthProfileNextButtonReady,
            ]}
            disabled={!canProceed || saving}
            onPress={isLastStep ? () => void save() : goNext}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={[styles.healthProfileNextText, (!canProceed && !isLastStep) && styles.healthProfileNextTextDisabled]}>
                {isLastStep ? '保存档案' : '下一步 ›'}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

export function BodyMetricRecordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'BodyMetricRecord'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const type = route.params?.type || 'weight'
  const initialDate = normalizeRouteDate(route.params?.date)
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [logs, setLogs] = useState<ExerciseLogItem[]>([])
  const [date] = useState(initialDate)
  const [value, setValue] = useState(type === 'water' ? '250' : '')
  const [exerciseDesc, setExerciseDesc] = useState('')
  const [exerciseImageUri, setExerciseImageUri] = useState('')
  const [exerciseImageUrl, setExerciseImageUrl] = useState('')
  const [exerciseTask, setExerciseTask] = useState<{ taskId: string; desc: string; status: string; errorMessage?: string } | null>(null)
  const [exercisePolling, setExercisePolling] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mutatingId, setMutatingId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const summaryData = await apiClient.getBodyMetricsSummary('month')
      setSummary(summaryData)
      if (type === 'exercise') {
        const logData = await apiClient.getExerciseLogs({ date })
        setLogs(logData.logs || [])
      }
    } catch (error) {
      await dialog.alert('获取身体记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [date, dialog, type])

  useEffect(() => {
    void load()
  }, [load])

  const waterDay = useMemo(() => {
    const normalizedDate = date.slice(0, 10)
    const matched = summary?.water_daily?.find((item) => item.date === normalizedDate)
    if (matched) return matched
    if (summary?.today_water?.date === normalizedDate) return summary.today_water
    return null
  }, [date, summary])

  const waterLogs = useMemo(() => getWaterLogItems(waterDay), [waterDay])
  const weightEntries = useMemo(
    () => [...(summary?.weight_entries || [])]
      .filter((item) => item.date === date.slice(0, 10))
      .sort((a, b) => String(b.recorded_at || b.date).localeCompare(String(a.recorded_at || a.date))),
    [date, summary],
  )
  const currentWaterTotal = Math.round(waterDay?.total || 0)
  const waterGoal = summary?.water_goal_ml || 2000
  const waterRemaining = Math.max(0, waterGoal - currentWaterTotal)

  const save = async (overrideValue?: number) => {
    setLoading(true)
    try {
      if (type === 'weight') {
        const nextValue = Number(value)
        if (!Number.isFinite(nextValue) || nextValue < 20 || nextValue > 300) {
          await dialog.alert('体重范围不正确', '请输入 20-300kg 的体重', 'warning')
          return
        }
        await apiClient.saveBodyWeightRecord(nextValue, date, `weight-${date}-${Date.now()}`)
        emitHomeDashboardRefreshEvent({ date, force: true })
      } else if (type === 'water') {
        const amount = overrideValue ?? Number(value)
        if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) {
          await dialog.alert('水量范围不正确', '请输入 1-5000ml', 'warning')
          return
        }
        await apiClient.addBodyWaterLog(Math.round(amount), date)
        emitHomeDashboardRefreshEvent({ date, force: true })
      } else {
        const result = await apiClient.createExerciseLog({ exerciseDesc, date, imageUrl: exerciseImageUrl })
        const taskId = String(result.task_id || result.taskId || '').trim()
        if (taskId) {
          const desc = exerciseDesc || '运动图片识别'
          setExerciseTask({ taskId, desc, status: 'pending' })
          void pollExerciseTask(taskId, desc)
        }
        setExerciseDesc('')
        setExerciseImageUri('')
        setExerciseImageUrl('')
      }
      await load()
      await dialog.alert(type === 'exercise' ? '已提交' : '已保存', type === 'exercise' ? '后台运动分析已提交，完成后会写入当天记录。' : '记录已更新', 'success')
    } catch (error) {
      await dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const pollExerciseTask = async (taskId: string, desc: string) => {
    setExercisePolling(true)
    try {
      const started = Date.now()
      while (Date.now() - started < 90000) {
        await new Promise((resolve) => setTimeout(resolve, 2200))
        try {
          const task = await apiClient.getAnalyzeTask(taskId)
          if (task.status === 'done') {
            setExerciseTask({ taskId, desc, status: 'done' })
            emitHomeDashboardRefreshEvent({ date, force: true })
            await load()
            return
          }
          if (['failed', 'violated', 'timed_out', 'cancelled'].includes(task.status)) {
            setExerciseTask({ taskId, desc, status: 'failed', errorMessage: exerciseTaskError(task) })
            return
          }
          setExerciseTask({ taskId, desc, status: task.status || 'pending' })
        } catch (error) {
          setExerciseTask({ taskId, desc, status: 'failed', errorMessage: userFacingErrorMessage(error, '刷新结果失败') })
          return
        }
      }
      setExerciseTask({ taskId, desc, status: 'failed', errorMessage: '分析时间较长，请稍后手动刷新。' })
    } finally {
      setExercisePolling(false)
    }
  }

  const refreshExerciseTask = async () => {
    if (!exerciseTask?.taskId || exercisePolling) return
    await pollExerciseTask(exerciseTask.taskId, exerciseTask.desc)
  }

  const pickExerciseImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('无法访问相册', '请在系统设置中允许访问相册后再添加运动截图。', 'warning')
        return
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.86,
      })
      if (picked.canceled || !picked.assets[0]) return
      const asset = picked.assets[0]
      setExerciseImageUri(asset.uri)
      setLoading(true)
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'exercise.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      setExerciseImageUrl(uploaded.imageUrl)
    } catch (error) {
      await dialog.alert('上传运动截图失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const deleteWeight = async (recordId?: string) => {
    if (!recordId) {
      await dialog.alert('无法删除', '这条体重记录信息不完整，请刷新后重试。', 'warning')
      return
    }
    setMutatingId(recordId)
    try {
      await apiClient.deleteBodyWeightRecord(recordId)
      emitHomeDashboardRefreshEvent({ date, force: true })
      await load()
    } catch (error) {
      await dialog.alert('删除体重记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteWeight = async (entry: BodyMetricWeightEntry) => {
    const recordId = String(entry.id || '').trim()
    if (!recordId) {
      await dialog.alert('无法删除', '这条体重记录信息不完整，请刷新后重试。', 'warning')
      return
    }
    const confirmed = await dialog.confirm({
      title: '删除体重记录',
      message: `确定删除 ${entry.date} 的 ${entry.value}kg 吗？`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) await deleteWeight(recordId)
  }

  const deleteWater = async (logId?: string) => {
    if (!logId) {
      await dialog.alert('无法删除', '这条喝水记录信息不完整，可刷新后重试，或使用清空当天。', 'warning')
      return
    }
    setMutatingId(logId)
    try {
      await apiClient.deleteBodyWaterLog(logId)
      emitHomeDashboardRefreshEvent({ date, force: true })
      await load()
    } catch (error) {
      await dialog.alert('删除喝水记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteWater = async (log: { id?: string; amount_ml: number }) => {
    const amount = Math.round(log.amount_ml || 0)
    const logId = String(log.id || '').trim()
    if (!logId) {
      await confirmResetWater('这条旧记录没有单次编号，只能清空当天喝水记录。')
      return
    }
    const confirmed = await dialog.confirm({
      title: '删除这次喝水',
      message: `确定删除 ${amount}ml 这次记录吗？`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) await deleteWater(logId)
  }

  const resetWater = async () => {
    if (currentWaterTotal <= 0) return
    setMutatingId('water-reset')
    try {
      await apiClient.resetBodyWaterLogs(date)
      emitHomeDashboardRefreshEvent({ date, force: true })
      await load()
    } catch (error) {
      await dialog.alert('清空喝水记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmResetWater = async (prefix?: string) => {
    if (currentWaterTotal <= 0) return
    const confirmed = await dialog.confirm({
      title: '清空喝水记录',
      message: `${prefix ? `${prefix}\n\n` : ''}确定清空 ${date} 的 ${currentWaterTotal}ml 喝水记录吗？`,
      kind: 'danger',
      confirmText: '清空',
      cancelText: '取消',
    })
    if (confirmed) await resetWater()
  }

  const deleteExercise = async (logId: string) => {
    setMutatingId(logId)
    try {
      await apiClient.deleteExerciseLog(logId)
      emitHomeDashboardRefreshEvent({ date, force: true })
      await load()
    } catch (error) {
      await dialog.alert('删除运动记录失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteExercise = async (log: ExerciseLogItem) => {
    const logId = String(log.id || '').trim()
    if (!logId) {
      await dialog.alert('无法删除', '这条运动记录信息不完整，请刷新后重试。', 'warning')
      return
    }
    const desc = log.exercise_desc || log.exercise_type || '这条运动'
    const confirmed = await dialog.confirm({
      title: '删除运动记录',
      message: `确定删除「${desc}」吗？`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) await deleteExercise(logId)
  }

  const isWeight = type === 'weight'
  const isWater = type === 'water'
  const isExercise = type === 'exercise'
  const title = isWater ? '记录喝水' : isExercise ? '记录运动' : '记录体重'
  const trendKind = type === 'weight' ? 'weight' : type === 'water' ? 'water' : 'exercise'
  const insets = useSafeAreaInsets()
  const routeDateLabel = date === todayKey() ? '今天' : formatShortDate(date)
  const accent = isWater ? '#5c9ed4' : isExercise ? '#f97316' : '#5cb896'
  const accentDeep = isWater ? '#3278ab' : isExercise ? '#ea580c' : '#3f9474'
  const pageBackground = isWater ? '#eef4f7' : isExercise ? '#f8fafc' : '#f0f3f6'
  const exerciseTotalCalories = logs.reduce((sum, log) => sum + Math.round(log.calories_burned || 0), 0)
  const waterProgress = waterGoal > 0 ? Math.min(100, Math.round((currentWaterTotal / waterGoal) * 100)) : 0
  const latestWeightChange = summary?.latest_weight && summary?.previous_weight
    ? Number(summary.latest_weight.value) - Number(summary.previous_weight.value)
    : summary?.weight_change
  const latestWeightHelper = summary?.latest_weight
    ? `最近一次 ${summary.latest_weight.value}kg${Number.isFinite(Number(latestWeightChange)) ? `，较上次 ${Number(latestWeightChange) >= 0 ? '+' : ''}${Number(latestWeightChange).toFixed(1)}kg` : ''}`
    : '保存后会同步更新首页和健康档案体重'
  const canSubmitExercise = Boolean(exerciseDesc.trim() || exerciseImageUrl)

  return (
    <View style={[styles.bodyRecordPage, { backgroundColor: pageBackground }]}>
      <ScrollView
        style={styles.bodyRecordScroll}
        contentContainerStyle={[styles.bodyRecordContent, { paddingTop: Math.max(insets.top + 12, 24), paddingBottom: insets.bottom + 96 }]}
        refreshControl={<RefreshControl refreshing={loading && Boolean(summary)} onRefresh={load} tintColor={accent} colors={[accent]} />}
        keyboardShouldPersistTaps="handled"
      >
        {isExercise ? (
          <View style={styles.exerciseStatsWrap}>
            <View style={styles.exerciseStatsCard}>
              <View style={styles.exerciseStatsIcon}>
                <Dumbbell size={22} color="#07c160" />
              </View>
              <View style={styles.flex}>
                <Text style={styles.exerciseStatsLabel}>{routeDateLabel}运动消耗</Text>
                <View style={styles.exerciseStatsValueRow}>
                  <Text style={styles.exerciseStatsValue}>{exerciseTotalCalories}</Text>
                  <Text style={styles.exerciseStatsUnit}>kcal</Text>
                </View>
              </View>
              <Text style={styles.exerciseStatsCount}>{logs.length} 次记录</Text>
            </View>
          </View>
        ) : (
          <View style={styles.bodyRecordTopbar}>
            <View style={styles.flex}>
              <Text style={[styles.bodyRecordKicker, { color: accentDeep }]}>{routeDateLabel}</Text>
              <Text style={styles.bodyRecordTitle}>{title}</Text>
            </View>
            <Pressable
              style={[styles.bodyRecordTrendLink, { backgroundColor: isWater ? 'rgba(92,158,212,0.1)' : 'rgba(92,184,150,0.1)' }]}
              onPress={() => navigation.navigate('TrendDetail', { kind: trendKind, date })}
            >
              <Text style={[styles.bodyRecordTrendText, { color: accentDeep }]}>查看趋势</Text>
            </Pressable>
          </View>
        )}

        {isWeight ? (
          <>
            <View style={styles.bodyMetricMainCard}>
              <Text style={styles.bodyMetricMainLabel}>{date} 的体重</Text>
              <View style={styles.weightInputRow}>
                <TextInput
                  value={value}
                  onChangeText={setValue}
                  keyboardType="decimal-pad"
                  placeholder="69.9"
                  placeholderTextColor="#9ca3af"
                  style={styles.weightMainInput}
                />
                <Text style={styles.weightMainUnit}>kg</Text>
              </View>
              <Pressable style={[styles.bodyMetricSaveButton, { backgroundColor: accent }, loading && styles.bodyMetricActionDisabled]} disabled={loading} onPress={() => save()}>
                {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.bodyMetricSaveText}>保存体重</Text>}
              </Pressable>
              <Text style={styles.bodyMetricHelper}>{latestWeightHelper}</Text>
            </View>

            <View style={styles.bodyMetricCard}>
              <View style={styles.bodyMetricSectionHead}>
                <Text style={styles.bodyMetricSectionTitle}>{routeDateLabel}记录</Text>
                {loading ? <ActivityIndicator color={accent} size="small" /> : null}
              </View>
              {weightEntries.length === 0 ? <Text style={styles.bodyMetricEmpty}>这一天还没有体重记录</Text> : null}
              {weightEntries.length > 0 ? (
                <View style={styles.weightDayList}>
                  {weightEntries.map((entry) => (
                    <View key={`${entry.id || entry.date}-${entry.recorded_at || entry.value}`} style={styles.weightDayRow}>
                      <View>
                        <Text style={styles.weightDayValue}>{entry.value}kg</Text>
                        <Text style={styles.weightDayDate}>{formatShortDate(entry.date)}</Text>
                      </View>
                      <Pressable
                        style={[styles.weightDeleteButton, mutatingId === entry.id && styles.bodyMetricActionDisabled]}
                        disabled={mutatingId === entry.id}
                        onPress={() => void confirmDeleteWeight(entry)}
                      >
                        {mutatingId === entry.id ? <ActivityIndicator color="#d45c5c" size="small" /> : <Text style={styles.weightDeleteText}>删除</Text>}
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {isWater ? (
          <>
            <View style={styles.bodyMetricCard}>
              <View style={styles.waterTotalRow}>
                <Text style={styles.waterTotalValue}>{currentWaterTotal}</Text>
                <Text style={styles.waterTotalUnit}>ml</Text>
              </View>
              <View style={styles.waterProgressTrack}>
                <View style={[styles.waterProgressFill, { width: `${waterProgress}%` }]} />
              </View>
              <Text style={styles.waterProgressNote}>{waterRemaining > 0 ? `距离目标还差 ${waterRemaining}ml` : '这一天已达到喝水目标'}</Text>
            </View>

            <View style={styles.bodyMetricCard}>
              <View style={styles.bodyMetricSectionHead}>
                <Text style={styles.bodyMetricSectionTitle}>快捷加水</Text>
                {loading ? <ActivityIndicator color={accent} size="small" /> : null}
              </View>
              <View style={styles.waterPresetGrid}>
                {waterPresets.map((amount) => (
                  <Pressable key={amount} style={[styles.waterPresetButton, loading && styles.bodyMetricActionDisabled]} disabled={loading} onPress={() => void save(amount)}>
                    <Text style={styles.waterPresetText}>+{amount}ml</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.waterCustomRow}>
                <TextInput
                  value={value}
                  onChangeText={setValue}
                  keyboardType="number-pad"
                  placeholder="自定义 ml"
                  placeholderTextColor="#9ca3af"
                  style={styles.waterCustomInput}
                />
                <Pressable style={[styles.waterCustomButton, loading && styles.bodyMetricActionDisabled]} disabled={loading} onPress={() => void save()}>
                  {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.waterCustomButtonText}>添加</Text>}
                </Pressable>
              </View>
            </View>

            <View style={styles.bodyMetricCard}>
              <View style={styles.bodyMetricSectionHead}>
                <Text style={styles.bodyMetricSectionTitle}>{routeDateLabel}记录</Text>
                {currentWaterTotal > 0 ? (
                  <Pressable
                    style={[styles.waterClearLink, mutatingId === 'water-reset' && styles.bodyMetricActionDisabled]}
                    disabled={mutatingId === 'water-reset'}
                    onPress={() => void confirmResetWater()}
                  >
                    {mutatingId === 'water-reset' ? <ActivityIndicator color="#d45c5c" size="small" /> : <Text style={styles.waterClearText}>清空</Text>}
                  </Pressable>
                ) : null}
              </View>
              {waterLogs.length === 0 ? <Text style={styles.bodyMetricEmpty}>这一天还没有喝水记录</Text> : null}
              {waterLogs.length > 0 ? (
                <View style={styles.waterLogList}>
                  {waterLogs.map((log, index) => {
                    const logId = String(log.id || `fallback-${index}`)
                    const deleting = Boolean(log.id && mutatingId === log.id)
                    return (
                      <Pressable key={logId} style={[styles.waterLogChip, deleting && styles.bodyMetricActionDisabled]} disabled={deleting} onPress={() => void confirmDeleteWater(log)}>
                        <Text style={styles.waterLogText}>+{Math.round(log.amount_ml)}ml</Text>
                        {deleting ? <ActivityIndicator color="#d45c5c" size="small" /> : <Text style={styles.waterLogDelete}>{log.id ? '删除' : '当天清空'}</Text>}
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {isExercise ? (
          <>
            <View style={styles.exerciseInputSection}>
              <View style={styles.exerciseComposeHeader}>
                <View style={styles.flex}>
                  <Text style={styles.exerciseComposeKicker}>{routeDateLabel}</Text>
                  <Text style={styles.exerciseComposeTitle}>记录运动</Text>
                </View>
                <Pressable style={styles.exerciseTrendLink} onPress={() => navigation.navigate('TrendDetail', { kind: trendKind, date })}>
                  <Text style={styles.exerciseTrendText}>查看趋势</Text>
                </Pressable>
              </View>
              <Text style={styles.exerciseQuickTitle}>试试这样说：</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.exerciseQuickRow}>
                {exercisePresets.map((preset) => (
                  <Pressable key={preset} style={styles.exerciseQuickChip} onPress={() => setExerciseDesc(preset)}>
                    <Text style={styles.exerciseQuickChipText}>{preset}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {exerciseImageUri ? (
                <View style={styles.exerciseImagePreviewWrap}>
                  <Image source={{ uri: exerciseImageUri }} style={styles.exerciseImagePreview} />
                  <Pressable style={styles.exerciseImageRemove} onPress={() => { setExerciseImageUri(''); setExerciseImageUrl('') }}>
                    <X size={16} color="#ffffff" />
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.exerciseInputWrap}>
                <Pressable style={styles.exerciseImageButton} onPress={() => void pickExerciseImage()}>
                  <ImagePlus size={17} color="#6b7280" />
                </Pressable>
                <TextInput
                  value={exerciseDesc}
                  onChangeText={setExerciseDesc}
                  multiline
                  maxLength={2000}
                  placeholder={exerciseImageUri ? '补充描述（可选）' : '今天做了什么运动？'}
                  placeholderTextColor="#9ca3af"
                  textAlignVertical="top"
                  style={styles.exerciseTextInput}
                />
                <Pressable
                  style={[styles.exerciseSendButton, (!canSubmitExercise || loading) && styles.exerciseSendButtonDisabled]}
                  disabled={!canSubmitExercise || loading}
                  onPress={() => save()}
                >
                  {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Send size={17} color="#ffffff" />}
                </Pressable>
              </View>
            </View>

            {exerciseTask ? (
              <View style={[styles.exerciseRecordCard, exerciseTask.status === 'failed' && styles.exerciseRecordCardFailed]}>
                <View style={styles.exerciseRecordTop}>
                  <Text style={styles.exerciseRecordTitle}>{exerciseTask.desc}</Text>
                  <Pill text={exerciseTaskStatusLabel(exerciseTask.status)} />
                </View>
                <View style={styles.exerciseRecordDivider} />
                <View style={styles.exerciseRecordBottom}>
                  <View style={styles.exercisePendingRow}>
                    {isTaskRunningStatus(exerciseTask.status) || exercisePolling ? <ActivityIndicator size="small" color="#f97316" /> : null}
                    <Text style={styles.exercisePendingText}>{exerciseTaskMessage(exerciseTask.status)}</Text>
                  </View>
                  <Pressable style={styles.exerciseRefreshLink} disabled={exercisePolling} onPress={() => void refreshExerciseTask()}>
                    <Text style={styles.exerciseRefreshText}>刷新结果</Text>
                  </Pressable>
                </View>
                {exerciseTask.errorMessage ? <Text style={styles.exerciseErrorText}>{exerciseTask.errorMessage}</Text> : null}
              </View>
            ) : null}

            {logs.length === 0 && !exerciseTask ? (
              <View style={styles.exerciseEmptyState}>
                <View style={styles.exerciseEmptyIcon}>
                  <Dumbbell size={36} color="#d1d5db" />
                </View>
                <Text style={styles.exerciseEmptyTitle}>{routeDateLabel}还没有运动记录</Text>
                <Text style={styles.exerciseEmptyDesc}>上方输入运动内容或添加图片，系统会估算消耗。</Text>
              </View>
            ) : null}

            {logs.length > 0 ? (
              <View style={styles.exerciseRecordsList}>
                {logs.map((log) => (
                  <View key={log.id} style={styles.exerciseRecordCard}>
                    {log.image_url ? <Image source={{ uri: log.image_url }} style={styles.exerciseImagePreview} /> : null}
                    <View style={styles.exerciseRecordTop}>
                      <Text style={styles.exerciseRecordTitle}>{log.exercise_desc || log.exercise_type || '运动'}</Text>
                      <Pressable disabled={mutatingId === log.id} onPress={() => void confirmDeleteExercise(log)}>
                        {mutatingId === log.id ? <ActivityIndicator color="#9ca3af" size="small" /> : <Text style={styles.exerciseDeleteText}>删除</Text>}
                      </Pressable>
                    </View>
                    <View style={styles.exerciseRecordDivider} />
                    <View style={styles.exerciseRecordBottom}>
                      <View style={styles.exerciseKcalRow}>
                        <Text style={styles.exerciseKcalValue}>{Math.round(log.calories_burned || 0)}</Text>
                        <Text style={styles.exerciseKcalUnit}>kcal</Text>
                      </View>
                      <Text style={styles.exerciseRecordTime}>{log.duration_min || 0} 分钟</Text>
                    </View>
                    {log.ai_reasoning ? <Text style={styles.exerciseReasoning}>{log.ai_reasoning}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {!isExercise ? (
          <View style={styles.bodyMetricOverviewCard}>
            <Text style={styles.bodyMetricSectionTitle}>本月概览</Text>
            <InfoRow label="最近体重" value={summary?.latest_weight ? `${summary.latest_weight.value} kg` : '--'} />
            <InfoRow label="今日喝水" value={`${Math.round(summary?.today_water?.total || 0)} ml`} />
            <InfoRow label="月均喝水" value={`${Math.round(summary?.avg_daily_water_ml || 0)} ml`} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

export function ExpiryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const [dashboard, setDashboard] = useState<FoodExpiryDashboard | null>(null)
  const [items, setItems] = useState<FoodExpiryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [processedExpanded, setProcessedExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchFailed(false)
    try {
      const [dashboardData, itemData] = await Promise.all([
        apiClient.getFoodExpiryDashboard(),
        apiClient.listFoodExpiryItems(),
      ])
      setDashboard(dashboardData)
      setItems(itemData.items || [])
    } catch (error) {
      setFetchFailed(true)
      setDashboard(null)
      setItems([])
      await dialog.alert('获取保质期失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const updateStatus = async (item: FoodExpiryItem, status: 'active' | 'consumed' | 'discarded') => {
    const actionLabel = status === 'active' ? '恢复提醒' : status === 'consumed' ? '标记为已吃完' : '标记为已丢弃'
    const confirmed = await dialog.confirm({
      title: actionLabel,
      message: `确认将“${item.food_name}”${actionLabel}吗？`,
      confirmText: '确认',
      cancelText: '取消',
      kind: status === 'discarded' ? 'danger' : 'warning',
    })
    if (!confirmed) return
    setLoading(true)
    try {
      await apiClient.updateFoodExpiryStatus(item.id, status)
      emitFoodExpiryChangedEvent({ force: true })
      await load()
    } catch (error) {
      await dialog.alert('更新失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const grouped = useMemo(() => groupFoodExpiryItems(items), [items])
  const previewItems = dashboard?.preview_items?.length ? dashboard.preview_items : grouped.urgent.slice(0, 3)

  return (
    <View style={styles.expiryPage}>
      <ScrollView
        style={styles.expiryScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.expiryContent, { paddingBottom: 28 + insets.bottom }]}
      >
        <View style={styles.expiryHero}>
          <View style={styles.flex}>
            <Text style={styles.expiryHeroKicker}>我的食物管理</Text>
            <Text style={styles.expiryHeroTitle}>保质期提醒</Text>
          </View>
          <Pressable style={styles.expiryHeroAdd} onPress={() => navigation.navigate('ExpiryEdit')}>
            <Plus size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.expiryHeroAddText}>新增</Text>
          </Pressable>
        </View>

        <View style={styles.expirySummaryGrid}>
          <ExpirySummaryCard label="今天优先吃" value={dashboard?.today_count ?? 0} />
          <ExpirySummaryCard label="即将过期" value={dashboard?.soon_count ?? 0} />
          <ExpirySummaryCard label="已过期" value={dashboard?.expired_count ?? 0} />
          <ExpirySummaryCard label="保鲜中" value={dashboard?.active_count ?? 0} />
        </View>

        {previewItems.length ? (
          <View style={styles.expiryPreviewPanel}>
            <Text style={styles.expirySectionTitle}>最需要先处理</Text>
            {previewItems.map((item) => (
              <Pressable key={item.id} style={styles.expiryPreviewRow} onPress={() => navigation.navigate('ExpiryEdit', { itemId: item.id })}>
                <Text style={styles.expiryPreviewName} numberOfLines={1}>{item.food_name}</Text>
                <Text style={styles.expiryPreviewHint} numberOfLines={1}>{formatExpiryHint(item)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {loading && items.length === 0 ? (
          <View style={styles.expiryEmptyCard}>
            <ActivityIndicator color="#00bc7d" />
          </View>
        ) : fetchFailed ? (
          <View style={[styles.expiryEmptyCard, styles.expiryFailedCard]}>
            <Text style={styles.expiryEmptyTitle}>加载失败</Text>
            <Text style={styles.expiryEmptyDesc}>网络或服务异常，请稍后重试。</Text>
            <Pressable style={styles.expiryRetryButton} onPress={() => void load()}>
              <Text style={styles.expiryRetryText}>重试</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.expiryEmptyCard}>
            <Text style={styles.expiryEmptyTitle}>还没有记录食物保质期</Text>
            <Text style={styles.expiryEmptyDesc}>先把家里的牛奶、水果、剩菜记进来，快到期时这里会提醒你。</Text>
          </View>
        ) : (
          <>
            {grouped.urgent.length ? (
              <View style={styles.expirySection}>
                <Text style={styles.expirySectionTitle}>优先处理</Text>
                {grouped.urgent.map((item) => (
                  <ExpiryItemCard
                    key={item.id}
                    item={item}
                    onPress={() => navigation.navigate('ExpiryEdit', { itemId: item.id, item })}
                    onUpdateStatus={updateStatus}
                  />
                ))}
              </View>
            ) : null}

            {grouped.fresh.length ? (
              <View style={styles.expirySection}>
                <Text style={styles.expirySectionTitle}>保鲜中</Text>
                {grouped.fresh.map((item) => (
                  <ExpiryItemCard
                    key={item.id}
                    item={item}
                    onPress={() => navigation.navigate('ExpiryEdit', { itemId: item.id, item })}
                    onUpdateStatus={updateStatus}
                  />
                ))}
              </View>
            ) : null}

            {grouped.processed.length ? (
              <View style={styles.expirySection}>
                <Pressable style={styles.expirySectionHeader} onPress={() => setProcessedExpanded((value) => !value)}>
                  <Text style={styles.expirySectionTitleNoMargin}>已处理 ({grouped.processed.length})</Text>
                  <Text style={styles.expirySectionToggle}>{processedExpanded ? '收起' : '展开'}</Text>
                </Pressable>
                {processedExpanded ? grouped.processed.map((item) => (
                  <ExpiryItemCard
                    key={item.id}
                    item={item}
                    onPress={() => navigation.navigate('ExpiryEdit', { itemId: item.id, item })}
                    onUpdateStatus={updateStatus}
                  />
                )) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}

export function RewardCenterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const [reward, setReward] = useState<RewardCenterResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReward(await apiClient.getRewardCenter())
    } catch (error) {
      await showError(dialog, '获取积分失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const tasks = reward?.tasks || []
  const quickTasks = tasks.filter(isRewardTaskAvailable).slice(0, 2)

  return (
    <View style={styles.rewardPage}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#0f9f6e" colors={['#0f9f6e']} />}
        contentContainerStyle={[styles.rewardPageContent, { paddingBottom: Math.max(insets.bottom, 12) + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.rewardHero}>
          <Text style={styles.rewardHeroTitle}>奖励积分</Text>
          <Text style={styles.rewardHeroSubtitle}>把今天能拿的积分都集中看清楚</Text>
          <View style={styles.rewardHeroStats}>
            <View style={styles.rewardStat}>
              <Text style={styles.rewardStatValue}>{reward?.earned_credits_balance ?? 0}</Text>
              <Text style={styles.rewardStatLabel}>当前余额</Text>
            </View>
            <View style={styles.rewardStat}>
              <Text style={styles.rewardStatValue}>{reward?.today_earned_credits ?? 0}</Text>
              <Text style={styles.rewardStatLabel}>今日已获得</Text>
            </View>
          </View>
        </View>

        {!loading && quickTasks.length ? (
          <View style={styles.rewardQuickSection}>
            <View style={styles.rewardQuickHead}>
              <Text style={styles.rewardQuickTitle}>最快拿分</Text>
              <Text style={styles.rewardQuickHint}>做完就能继续用奖励积分</Text>
            </View>
            <View style={styles.rewardQuickList}>
              {quickTasks.map((task) => (
                <Pressable
                  key={rewardTaskKey(task)}
                  style={({ pressed }) => [styles.rewardQuickCard, pressed ? styles.pressed : null]}
                  onPress={() => navigateRewardTask(navigation, task)}
                >
                  <View style={styles.flex}>
                    <Text style={styles.rewardQuickName} numberOfLines={2}>{rewardTaskName(task)}</Text>
                    <Text style={styles.rewardQuickDesc} numberOfLines={1}>
                      {formatRewardTaskProgress(task)} · +{task.reward_amount} 积分
                    </Text>
                  </View>
                  <Text style={styles.rewardQuickButton}>去完成</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.rewardSection}>
          <Text style={styles.rewardSectionTitle}>
            今日进度 {reward?.today_task_overview?.completed_count ?? 0}/{reward?.today_task_overview?.total_count ?? 0}
          </Text>
          {loading ? (
            <View style={styles.rewardLoading}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <View style={styles.rewardTaskList}>
              {tasks.length === 0 ? <EmptyState text="暂无奖励任务" /> : null}
              {tasks.map((task) => {
                const disabled = isRewardTaskDisabled(task)
                return (
                  <View key={rewardTaskKey(task)} style={styles.rewardTaskCard}>
                    <View style={styles.rewardTaskHead}>
                      <View style={styles.flex}>
                        <Text style={styles.rewardTaskName} numberOfLines={2}>{rewardTaskName(task)}</Text>
                        <Text style={styles.rewardTaskReward}>完成一次 +{task.reward_amount} 奖励积分</Text>
                      </View>
                      <Text style={styles.rewardTaskStatus} numberOfLines={1}>{rewardTaskStatus(task)}</Text>
                    </View>
                    <View style={styles.rewardTaskMeta}>
                      <Text style={styles.rewardTaskMetaText}>{formatRewardTaskMetaProgress(task)}</Text>
                      <Text style={styles.rewardTaskMetaText}>{formatRewardTaskLimit(task)}</Text>
                    </View>
                    <Pressable
                      style={({ pressed }) => [
                        styles.rewardTaskButton,
                        disabled ? styles.rewardTaskButtonDisabled : null,
                        pressed && !disabled ? styles.pressed : null,
                      ]}
                      disabled={disabled || !task.action_path}
                      onPress={() => navigateRewardTask(navigation, task)}
                    >
                      <Text style={styles.rewardTaskButtonText}>{disabled ? '今日已满' : '去完成'}</Text>
                    </Pressable>
                  </View>
                )
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}

export function CirclePostEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'CirclePostEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const postId = route.params?.postId
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [images, setImages] = useState<CirclePostImageItem[]>([])
  const [nutritionEnabled, setNutritionEnabled] = useState(false)
  const [nutrition, setNutrition] = useState<CirclePostNutritionFormState>({ ...emptyCirclePostNutrition })
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [drafting, setDrafting] = useState(false)

  useEffect(() => {
    navigation.setOptions({ title: postId ? '编辑动态' : '发布动态' })
  }, [navigation, postId])

  const load = useCallback(async () => {
    if (!postId) return
    setLoading(true)
    try {
      const data = await apiClient.communityGetContext(postId, 'circle_post')
      const record = (data.item.record || {}) as unknown as Record<string, unknown>
      setTitle(stringFrom(record.title))
      setBody(stringFrom(record.body || record.description))
      const sourceImages = Array.isArray(record.image_paths)
        ? record.image_paths
        : Array.isArray(record.image_urls)
          ? record.image_urls
          : []
      setImages(sourceImages.map(stringFrom).filter(Boolean).slice(0, CIRCLE_POST_MAX_IMAGES).map((url) => ({ id: url, url })))
      const nextNutrition: CirclePostNutritionFormState = {
        total_calories: numberField(record.total_calories ?? record.calories),
        total_protein: numberField(record.total_protein ?? record.protein),
        total_carbs: numberField(record.total_carbs ?? record.carbs),
        total_fat: numberField(record.total_fat ?? record.fat),
        fiber: numberField(record.fiber),
        sugar: numberField(record.sugar),
        sodium_mg: numberField(record.sodium_mg),
        total_weight_grams: numberField(record.total_weight_grams),
      }
      setNutrition(nextNutrition)
      setNutritionEnabled(circlePostNutritionHasValue(nextNutrition))
    } catch (error) {
      await dialog.alert('加载动态失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog, postId])

  const loadDraft = useCallback(async () => {
    if (postId) return
    try {
      const raw = await AsyncStorage.getItem(CIRCLE_POST_DRAFT_STORAGE_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as CirclePostDraft
      if (!draft || typeof draft !== 'object') return
      setTitle(typeof draft.title === 'string' ? draft.title : '')
      setBody(typeof draft.body === 'string' ? draft.body : '')
      const draftImages = Array.isArray(draft.images)
        ? draft.images
            .map((item) => (typeof item === 'string' ? item : item?.url))
            .map((url) => stringFrom(url))
            .filter(Boolean)
            .slice(0, CIRCLE_POST_MAX_IMAGES)
        : []
      setImages(draftImages.map((url) => ({ id: url, url })))
      const nextNutrition: CirclePostNutritionFormState = { ...emptyCirclePostNutrition }
      circlePostNutritionFields.forEach(({ key }) => {
        const value = draft.nutrition?.[key]
        nextNutrition[key] = typeof value === 'string' ? value : ''
      })
      setNutrition(nextNutrition)
      setNutritionEnabled(Boolean(draft.nutritionEnabled) && circlePostNutritionHasValue(nextNutrition))
    } catch {
      await AsyncStorage.removeItem(CIRCLE_POST_DRAFT_STORAGE_KEY).catch(() => undefined)
    }
  }, [postId])

  useEffect(() => {
    if (postId) void load()
    else void loadDraft()
  }, [load, loadDraft, postId])

  const pickImages = async () => {
    const remaining = CIRCLE_POST_MAX_IMAGES - images.length
    if (remaining <= 0) {
      await dialog.alert('图片已满', `最多上传 ${CIRCLE_POST_MAX_IMAGES} 张图片。`, 'warning')
      return
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      await dialog.alert('需要相册权限', '请选择动态图片。', 'warning')
      return
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      allowsEditing: false,
      quality: 0.86,
    })
    if (picked.canceled || !picked.assets.length) return
    const selected = picked.assets.slice(0, remaining)
    const pendingItems = selected.map((asset, index) => ({
      id: `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      url: asset.uri,
      uploading: true,
    }))
    setImages((current) => [...current, ...pendingItems].slice(0, CIRCLE_POST_MAX_IMAGES))
    setUploading(true)
    try {
      for (const [index, asset] of selected.entries()) {
        const pending = pendingItems[index]
        const data = await apiClient.uploadCirclePostImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || 'circle-post.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        })
        setImages((current) =>
          current.map((item) => (item.id === pending.id ? { id: data.imageUrl, url: data.imageUrl } : item))
        )
      }
    } catch (error) {
      setImages((current) => current.filter((item) => !pendingItems.some((pending) => pending.id === item.id && item.uploading)))
      await dialog.alert('上传动态图片失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setUploading(false)
    }
  }

  const removeImage = (index: number) => {
    setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const updateNutrition = (key: CirclePostNutritionKey, value: string) => {
    setNutrition((current) => ({
      ...current,
      [key]: normalizeCirclePostNutritionInput(key, value),
    }))
  }

  const saveDraft = async () => {
    const hasContent = title.trim().length > 0 || body.trim().length > 0 || images.length > 0 || nutritionEnabled
    if (!hasContent) {
      await dialog.alert('没有内容可保存', '写点文字或添加图片后再存草稿。', 'warning')
      return
    }
    setDrafting(true)
    try {
      const tipShown = await AsyncStorage.getItem(CIRCLE_POST_DRAFT_TIP_KEY)
      if (!tipShown) {
        await dialog.alert('草稿仅保存在本机', '当前草稿会存储在这台设备的本地缓存中，清理缓存或更换设备后将无法恢复。', 'info')
        await AsyncStorage.setItem(CIRCLE_POST_DRAFT_TIP_KEY, '1')
      }
      const draft: CirclePostDraft = {
        title,
        body,
        images: images.filter((item) => !item.uploading && item.url).map((item) => item.url),
        nutritionEnabled,
        nutrition,
        savedAt: new Date().toISOString(),
      }
      await AsyncStorage.setItem(CIRCLE_POST_DRAFT_STORAGE_KEY, JSON.stringify(draft))
      await dialog.alert('草稿已保存', undefined, 'success')
    } catch (error) {
      await dialog.alert('草稿保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setDrafting(false)
    }
  }

  const hasUploadingImages = uploading || images.some((item) => item.uploading)
  const canSubmit = useMemo(
    () => (title.trim().length > 0 || body.trim().length > 0 || images.length > 0) && !submitting && !hasUploadingImages,
    [body, hasUploadingImages, images.length, submitting, title],
  )

  const submit = async () => {
    if (!canSubmit) {
      if (hasUploadingImages) await dialog.alert('图片未准备好', '请等图片处理完成后再发布。', 'warning')
      else await dialog.alert('请填写动态内容', '可以填写标题、正文，或添加至少一张图片。', 'warning')
      return
    }
    setSubmitting(true)
    try {
      const uploadedImageUrls = images.filter((item) => !item.uploading).map((item) => item.url.trim()).filter(Boolean)
      const input = {
        title: title.trim(),
        body: body.trim(),
        imageUrls: uploadedImageUrls,
        nutrition: nutritionEnabled ? buildCirclePostNutritionInput(nutrition) : undefined,
      }
      if (postId) await apiClient.updateCirclePost(postId, input)
      else await apiClient.createCirclePost(input)
      if (!postId) await AsyncStorage.removeItem(CIRCLE_POST_DRAFT_STORAGE_KEY).catch(() => undefined)
      await dialog.alert(postId ? '已保存' : '已发布', postId ? '动态修改已保存' : '动态已发布到圈子', 'success')
      navigation.goBack()
    } catch (error) {
      await dialog.alert(postId ? '保存失败' : '发布失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.circlePostEditPage}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.circlePostEditScroll}
        contentContainerStyle={[styles.circlePostEditContent, { paddingBottom: Math.max(insets.bottom + 24, 36) }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={postId ? <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} /> : undefined}
      >
        {loading && postId ? (
          <View style={styles.circlePostEditLoadingCard}>
            <ActivityIndicator color={colors.brand} size="small" />
          </View>
        ) : null}

        <View style={[styles.circlePostEditCard, styles.circlePostEditImageSection]}>
          <View style={styles.circlePostEditTitleRow}>
            <Text style={styles.circlePostEditSectionTitle}>图片</Text>
            <Text style={styles.circlePostEditCount}>{images.length}/{CIRCLE_POST_MAX_IMAGES}</Text>
          </View>
          <CirclePostImageGrid images={images} loading={hasUploadingImages} onAdd={pickImages} onRemove={removeImage} />
        </View>

        <View style={[styles.circlePostEditCard, styles.circlePostEditEditor]}>
          <TextInput
            style={styles.circlePostEditTitleInput}
            value={title}
            onChangeText={(value) => setTitle(value.slice(0, CIRCLE_POST_TITLE_MAX_LENGTH))}
            placeholder="标题（选填）"
            placeholderTextColor="#9ca3af"
            editable={!loading}
            maxLength={CIRCLE_POST_TITLE_MAX_LENGTH}
            returnKeyType="next"
          />
          <TextInput
            style={styles.circlePostEditTextarea}
            value={body}
            onChangeText={(value) => setBody(value.slice(0, CIRCLE_POST_BODY_MAX_LENGTH))}
            placeholder="分享你的饮食心得、运动日常…"
            placeholderTextColor="#9ca3af"
            editable={!loading}
            multiline
            textAlignVertical="top"
            maxLength={CIRCLE_POST_BODY_MAX_LENGTH}
          />
          <Text style={styles.circlePostEditCount}>{body.length}/{CIRCLE_POST_BODY_MAX_LENGTH}</Text>
        </View>

        <View style={styles.circlePostEditCard}>
          <Pressable style={styles.circlePostEditTitleRow} onPress={() => setNutritionEnabled((value) => !value)}>
            <View style={styles.circlePostEditTitleLeft}>
              <Text style={styles.circlePostEditSectionTitle}>营养信息</Text>
              <Text style={styles.circlePostEditSectionSubtitle}>选填，展示在动态卡片</Text>
            </View>
            <View style={[styles.circlePostEditToggle, nutritionEnabled && styles.circlePostEditToggleOn]}>
              <View style={[styles.circlePostEditToggleKnob, nutritionEnabled && styles.circlePostEditToggleKnobOn]} />
            </View>
          </Pressable>
          {nutritionEnabled ? (
            <View style={styles.circlePostEditNutritionGrid}>
              {circlePostNutritionFields.map(({ key, label, unit, placeholder }) => (
                <View key={key} style={styles.circlePostEditNutritionItem}>
                  <Text style={styles.circlePostEditNutritionLabel}>{label}</Text>
                  <View style={styles.circlePostEditNutritionInputWrap}>
                    <TextInput
                      style={styles.circlePostEditNutritionInput}
                      value={nutrition[key]}
                      onChangeText={(value) => updateNutrition(key, value)}
                      placeholder={placeholder}
                      placeholderTextColor="#c7ccd1"
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.circlePostEditNutritionUnit}>{unit}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.circlePostEditFooter}>
          <Pressable
            style={({ pressed }) => [styles.circlePostEditDraftButton, (pressed || drafting) && styles.pressed]}
            onPress={saveDraft}
            disabled={drafting}
          >
            {drafting ? <ActivityIndicator size="small" color="#4b5563" /> : <Text style={styles.circlePostEditDraftText}>存草稿</Text>}
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.circlePostEditSubmitButton,
              (!canSubmit || pressed) && styles.circlePostEditSubmitButtonMuted,
            ]}
            onPress={submit}
            disabled={!canSubmit}
          >
            {submitting ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.circlePostEditSubmitText}>{postId ? '保存' : '发布动态'}</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export function FriendsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [activeTab, setActiveTab] = useState<FriendTab>('friends')
  const [friends, setFriends] = useState<FriendUserItem[]>([])
  const [received, setReceived] = useState<FriendRequestItem[]>([])
  const [sent, setSent] = useState<FriendRequestItem[]>([])
  const [blocks, setBlocks] = useState<FriendBlockItem[]>([])
  const [friendQuery, setFriendQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [mutatingId, setMutatingId] = useState<string | null>(null)

  const receivedPendingCount = useMemo(
    () => received.filter((item) => friendRequestStatus(item) === 'pending').length,
    [received],
  )
  const sentPendingCount = useMemo(
    () => sent.filter((item) => friendRequestStatus(item) === 'pending').length,
    [sent],
  )
  const filteredFriends = useMemo(() => {
    const q = friendQuery.trim().toLowerCase()
    if (!q) return friends
    return friends.filter((friend) => friendDisplayName(friend).toLowerCase().includes(q))
  }, [friendQuery, friends])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [friendData, requestData, blockData] = await Promise.all([
        apiClient.listFriends(),
        apiClient.getFriendRequestsOverview().catch(() => ({ received: [], sent: [] })),
        apiClient.listBlockedUsers().catch(() => ({ list: [] })),
      ])
      setFriends(friendData.list || [])
      setReceived(requestData.received || [])
      setSent(requestData.sent || [])
      setBlocks(blockData.list || [])
    } catch (error) {
      await showError(dialog, '获取好友失败', error)
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const openProfile = (userId?: string) => {
    const id = String(userId || '').trim()
    if (id) navigation.navigate('ProfileSettings', { userId: id })
  }

  const goToCommunity = () => {
    navigation.dispatch(CommonActions.navigate({ name: 'MainTabs', params: { screen: 'CommunityTab' } }))
  }

  const respond = async (request: FriendRequestItem, action: 'accept' | 'reject') => {
    if (friendRequestStatus(request) !== 'pending') return
    const key = `${action}:${request.id}`
    setMutatingId(key)
    try {
      await apiClient.respondFriendRequest(request.id, action)
      await load()
      await dialog.alert(action === 'accept' ? '已添加好友' : '已拒绝', undefined, 'success')
    } catch (error) {
      await showError(dialog, '处理失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const confirmDeleteFriend = async (friend: FriendUserItem) => {
    const id = friendUserId(friend)
    if (!id) return
    const confirmed = await dialog.confirm({
      title: '删除好友',
      message: `确定删除好友「${friendDisplayName(friend)}」吗？删除后需要重新添加。`,
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (confirmed) void deleteFriend(friend)
  }

  const deleteFriend = async (friend: FriendUserItem) => {
    const id = friendUserId(friend)
    if (!id) return
    setMutatingId(`delete:${id}`)
    try {
      await apiClient.deleteFriend(id)
      await load()
      await dialog.alert('已删除', undefined, 'success')
    } catch (error) {
      await showError(dialog, '删除失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const confirmBlockFriend = async (friend: FriendUserItem) => {
    const id = friendUserId(friend)
    if (!id) return
    const confirmed = await dialog.confirm({
      title: '拉黑用户',
      message: `拉黑后会自动解除与「${friendDisplayName(friend)}」的好友关系，双方将无法私信或重新加好友。`,
      kind: 'danger',
      confirmText: '拉黑',
      cancelText: '取消',
    })
    if (confirmed) void blockUser(id)
  }

  const blockUser = async (userId: string) => {
    setMutatingId(`block:${userId}`)
    try {
      await apiClient.blockUser(userId)
      await load()
      await dialog.alert('已加入黑名单', undefined, 'success')
    } catch (error) {
      await showError(dialog, '无法操作', error)
    } finally {
      setMutatingId(null)
    }
  }

  const confirmUnblockUser = async (user: FriendBlockItem) => {
    const id = friendBlockUserId(user)
    if (!id) return
    const confirmed = await dialog.confirm({
      title: '解除拉黑',
      message: `解除后，你们可以重新搜索、申请好友或发送私信。`,
      kind: 'warning',
      confirmText: '解除',
      cancelText: '取消',
    })
    if (confirmed) void unblockUser(id)
  }

  const unblockUser = async (userId: string) => {
    setMutatingId(`unblock:${userId}`)
    try {
      await apiClient.unblockUser(userId)
      await load()
      await dialog.alert('已解除拉黑', undefined, 'success')
    } catch (error) {
      await showError(dialog, '无法操作', error)
    } finally {
      setMutatingId(null)
    }
  }

  const confirmCancelSent = async (request: FriendRequestItem) => {
    if (friendRequestStatus(request) !== 'pending') return
    const confirmed = await dialog.confirm({
      title: '撤销申请',
      message: `确定撤销对「${friendRequestDisplayName(request)}」的好友申请吗？`,
      kind: 'danger',
      confirmText: '撤销',
      cancelText: '保留',
    })
    if (confirmed) void cancelSent(request)
  }

  const cancelSent = async (request: FriendRequestItem) => {
    setMutatingId(`cancel:${request.id}`)
    try {
      await apiClient.cancelSentFriendRequest(request.id)
      await load()
      await dialog.alert('已撤销', undefined, 'success')
    } catch (error) {
      await showError(dialog, '撤销失败', error)
    } finally {
      setMutatingId(null)
    }
  }

  const renderFriendsMini = () => (
    <>
      {friends.length > 0 ? (
        <View style={styles.friendsSearchCard}>
          <View style={styles.friendsSearchRow}>
            <Search size={16} color="#94a3b8" />
            <TextInput
              style={styles.friendsSearchInput}
              value={friendQuery}
              onChangeText={setFriendQuery}
              placeholder="搜索好友昵称"
              placeholderTextColor="#94a3b8"
              returnKeyType="search"
            />
            {friendQuery.trim() ? (
              <Pressable style={styles.friendsClearButton} onPress={() => setFriendQuery('')}>
                <X size={14} color="#64748b" />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {loading && friends.length === 0 ? (
        <View style={styles.friendsStateCard}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : null}
      {!loading && friends.length === 0 ? (
        <FriendsEmptyState
          variant="friends"
          title="还没有好友"
          subtitle="去圈子里发现更多志同道合的食友，一起记录健康饮食"
          actionLabel="去添加好友"
          onAction={goToCommunity}
        />
      ) : null}
      {!loading && friends.length > 0 && filteredFriends.length === 0 ? <FriendsEmptyState variant="search" title="未找到好友" subtitle="尝试搜索其他关键词" /> : null}

      {filteredFriends.map((friend) => {
        const id = friendUserId(friend)
        return (
          <FriendUserCard
            key={id || friendDisplayName(friend)}
            user={friend}
            subtitle="好友"
            onPress={() => openProfile(id)}
            actions={(
              <>
                <FriendTextActionButton
                  label="拉黑"
                  danger
                  loading={mutatingId === `block:${id}`}
                  disabled={mutatingId === `block:${id}`}
                  onPress={() => void confirmBlockFriend(friend)}
                />
                <FriendTextActionButton
                  label="删除"
                  danger
                  loading={mutatingId === `delete:${id}`}
                  disabled={mutatingId === `delete:${id}`}
                  onPress={() => void confirmDeleteFriend(friend)}
                />
              </>
            )}
          />
        )
      })}
    </>
  )

  const renderReceivedMini = () => (
    <>
      {loading && received.length === 0 ? (
        <View style={styles.friendsStateCard}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : null}
      {!loading && received.length === 0 ? <FriendsEmptyState variant="received" title="暂无好友请求" subtitle="当有人向你发送好友申请时，会显示在这里" /> : null}
      {received.map((request) => {
        const userId = friendRequestUserId(request)
        const pending = friendRequestStatus(request) === 'pending'
        return (
          <FriendRequestCard
            key={request.id}
            request={request}
            onPress={() => openProfile(userId)}
            actions={pending ? (
              <>
                <FriendActionButton label="拒绝" icon={X} tone="danger" disabled={mutatingId === `reject:${request.id}`} onPress={() => void respond(request, 'reject')} />
                <FriendActionButton label="接受" icon={Check} disabled={mutatingId === `accept:${request.id}`} onPress={() => void respond(request, 'accept')} />
              </>
            ) : (
              <Pill text={friendRequestStatusLabel(request.status)} />
            )}
          />
        )
      })}
    </>
  )

  const renderSentMini = () => (
    <>
      {loading && sent.length === 0 ? (
        <View style={styles.friendsStateCard}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : null}
      {!loading && sent.length === 0 ? <FriendsEmptyState variant="sent" title="没有待处理的申请" subtitle="你发起的好友申请会显示在这里，可随时撤销" /> : null}
      {sent.map((request) => {
        const userId = friendRequestUserId(request)
        const pending = friendRequestStatus(request) === 'pending'
        return (
          <FriendRequestCard
            key={request.id}
            request={request}
            onPress={() => openProfile(userId)}
            actions={!pending ? (
              <Pill text={friendRequestStatusLabel(request.status)} />
            ) : undefined}
            footerActions={pending ? (
              <FriendTextActionButton
                label="撤销申请"
                loading={mutatingId === `cancel:${request.id}`}
                disabled={mutatingId === `cancel:${request.id}`}
                onPress={() => void confirmCancelSent(request)}
              />
            ) : undefined}
          />
        )
      })}
    </>
  )

  const renderBlocksMini = () => (
    <>
      {loading && blocks.length === 0 ? (
        <View style={styles.friendsStateCard}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : null}
      {!loading && blocks.length === 0 ? (
        <FriendsEmptyState
          variant="blocks"
          title="暂无黑名单"
          subtitle="被拉黑的用户会显示在这里，可随时解除。"
        />
      ) : null}
      {blocks.map((user) => {
        const id = friendBlockUserId(user)
        return (
          <FriendBlockCard
            key={id || friendBlockDisplayName(user)}
            user={user}
            onPress={() => openProfile(id)}
            actions={(
              <FriendTextActionButton
                label="解除"
                loading={mutatingId === `unblock:${id}`}
                disabled={mutatingId === `unblock:${id}`}
                onPress={() => void confirmUnblockUser(user)}
              />
            )}
          />
        )
      })}
    </>
  )

  const currentPanel = activeTab === 'friends'
    ? renderFriendsMini()
    : activeTab === 'received'
      ? renderReceivedMini()
      : activeTab === 'sent'
        ? renderSentMini()
        : renderBlocksMini()

  return (
    <View style={styles.friendsPage}>
      <View pointerEvents="none" style={styles.friendsTopWash} />
      <ScrollView
        style={styles.friendsScroll}
        contentContainerStyle={styles.friendsContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.friendsHeader}>
          <Pressable style={[styles.friendsRefreshButton, loading && styles.friendsRefreshButtonActive]} onPress={load} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.brand} size="small" /> : <RefreshCw size={14} color={colors.brand} />}
            <Text style={styles.friendsRefreshText}>刷新</Text>
          </Pressable>
        </View>

        <View style={styles.friendsTabsWrapper}>
          <View style={styles.friendsTabs}>
            <FriendsTabButton label="好友列表" badge={friends.length} active={activeTab === 'friends'} onPress={() => setActiveTab('friends')} />
            <FriendsTabButton label="收到请求" badge={receivedPendingCount} active={activeTab === 'received'} onPress={() => setActiveTab('received')} />
            <FriendsTabButton label="我发起的" badge={sentPendingCount} active={activeTab === 'sent'} onPress={() => setActiveTab('sent')} />
            <FriendsTabButton label="黑名单" badge={blocks.length} active={activeTab === 'blocks'} onPress={() => setActiveTab('blocks')} />
          </View>
        </View>

        <View style={styles.friendsListContainer}>{currentPanel}</View>
      </ScrollView>
    </View>
  )
}

export function NotificationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [notifications, setNotifications] = useState<CommunityNotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [activeTab, setActiveTab] = useState<NotificationTab>('all')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingRead, setMarkingRead] = useState(false)

  const visibleNotifications = useMemo(
    () => notifications.filter((item) => notificationMatchesTab(item, activeTab)),
    [activeTab, notifications],
  )
  const likeCount = useMemo(() => notifications.filter((item) => notificationMatchesTab(item, 'like')).length, [notifications])
  const commentCount = useMemo(() => notifications.filter((item) => notificationMatchesTab(item, 'comment')).length, [notifications])

  const load = useCallback(async (tab: NotificationTab, offset = 0, append = false) => {
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    try {
      const data = await apiClient.listCommunityNotifications({
        limit: notificationPageSize,
        offset,
        type: notificationTabApiType(tab),
      })
      let nextList = data.list || []
      let nextUnread = data.unread_count || 0
      if (!append && nextUnread > 0) {
        const readResult = await apiClient.markCommunityNotificationsRead()
        nextUnread = readResult.unread_count || 0
        nextList = nextList.map((item) => ({ ...item, is_read: true }))
      }
      setNotifications((prev) => append ? [...prev, ...nextList] : nextList)
      setUnread(nextUnread)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      await showError(dialog, '获取互动消息失败', error)
    } finally {
      if (append) {
        setLoadingMore(false)
      } else {
        setLoading(false)
      }
    }
  }, [dialog])

  useEffect(() => {
    void load(activeTab, 0, false)
  }, [activeTab, load])

  const refresh = useCallback(() => {
    void load(activeTab, 0, false)
  }, [activeTab, load])

  const switchTab = (tab: NotificationTab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    setNotifications([])
    setHasMore(false)
  }

  const markRead = async () => {
    if (unread <= 0 || markingRead) return
    setMarkingRead(true)
    try {
      const data = await apiClient.markCommunityNotificationsRead()
      setUnread(data.unread_count || 0)
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })))
    } catch (error) {
      await showError(dialog, '标记已读失败', error)
    } finally {
      setMarkingRead(false)
    }
  }

  const loadMore = () => {
    if (loading || loadingMore || !hasMore) return
    void load(activeTab, notifications.length, true)
  }

  const handleListScroll = (event: {
    nativeEvent: {
      contentOffset: { y: number }
      contentSize: { height: number }
      layoutMeasurement: { height: number }
    }
  }) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 80) {
      loadMore()
    }
  }

  const openNotification = async (item: CommunityNotificationItem) => {
    const targetId = notificationTargetId(item)
    if (!targetId) {
      await dialog.alert('未找到对应动态', '这条互动消息缺少可跳转的动态信息。', 'warning')
      return
    }
    if (!item.is_read) {
      try {
        await apiClient.markCommunityNotificationsRead([item.id])
        setNotifications((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry))
        setUnread((value) => Math.max(0, value - 1))
      } catch {
        // Navigation is more important than read state here; ignore transient mark-read failures.
      }
    }
    navigation.navigate('CommunityFeedDetail', {
      targetId,
      targetType: notificationTargetType(item),
    })
  }

  return (
    <View style={styles.interactionNotificationsPage}>
      <View style={styles.notificationsHeader}>
        <View style={styles.notificationsHeaderCopy}>
          <Text style={styles.notificationsTitle}>互动消息</Text>
          <Text style={styles.notificationsSubtitle}>点赞、评论、回复和审核结果都会显示在这里</Text>
        </View>
        <Pressable
          style={[styles.markReadButton, (markingRead || unread <= 0) && styles.markReadButtonDisabled]}
          disabled={markingRead || unread <= 0}
          onPress={() => void markRead()}
        >
          {markingRead ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.markReadText}>全部已读</Text>}
        </Pressable>
      </View>

      <View style={styles.notificationTabs}>
        <NotificationTabButton label="全部" active={activeTab === 'all'} onPress={() => switchTab('all')} />
        <NotificationTabButton label="点赞" badge={likeCount} active={activeTab === 'like'} onPress={() => switchTab('like')} />
        <NotificationTabButton label="评论" badge={commentCount} active={activeTab === 'comment'} onPress={() => switchTab('comment')} />
      </View>

      <ScrollView
        style={styles.notificationsList}
        contentContainerStyle={[styles.notificationsListContent, visibleNotifications.length === 0 && styles.notificationsListContentEmpty]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.brand} colors={[colors.brand]} />}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {loading && visibleNotifications.length === 0 ? (
          <View style={styles.notificationsState}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : null}
        {!loading && visibleNotifications.length === 0 ? (
          <View style={styles.notificationsEmpty}>
            <Text style={styles.notificationsEmptyTitle}>{notificationEmptyText(activeTab)}</Text>
            <Text style={styles.notificationsEmptySubtitle}>
              {activeTab === 'all' ? '有人评论或回复你时，会出现在这里' : '切换到“全部”查看所有互动'}
            </Text>
          </View>
        ) : null}
        {visibleNotifications.map((item) => (
          <Pressable key={item.id} style={[styles.notificationCard, !item.is_read && styles.notificationCardUnread]} onPress={() => openNotification(item)}>
            <View style={styles.notificationRow}>
              <Pressable
                style={styles.notificationAvatar}
                onPress={(event) => {
                  event.stopPropagation()
                  const actorId = item.actor?.id
                  if (actorId) navigation.navigate('ProfileSettings', { userId: actorId })
                }}
              >
                {item.actor?.avatar ? (
                  <Image source={{ uri: item.actor.avatar }} style={styles.notificationAvatarImage} />
                ) : (
                  <Text style={styles.notificationAvatarText}>{notificationAvatarText(item)}</Text>
                )}
              </Pressable>
              <View style={styles.notificationMain}>
                <View style={styles.notificationTop}>
                  <Text style={styles.notificationTitle} numberOfLines={2}>{notificationTitle(item)}</Text>
                  {!item.is_read ? <View style={styles.notificationDot} /> : null}
                </View>
                <Text style={styles.notificationContent} numberOfLines={2}>{notificationContent(item)}</Text>
                <Text style={styles.notificationTime}>{notificationTimeLabel(item.created_at)}</Text>
              </View>
            </View>
          </Pressable>
        ))}
        {loadingMore ? (
          <View style={styles.loadMoreSpinner}>
            <ActivityIndicator color={colors.brand} size="small" />
          </View>
        ) : null}
        {visibleNotifications.length > 0 && !hasMore ? <Text style={styles.notificationListEnd}>— 没有更多了 —</Text> : null}
      </ScrollView>
    </View>
  )
}

export function AboutFeedbackScreen() {
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [category, setCategory] = useState<FeedbackCategoryKey>('bug')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [feedbackImageUrls, setFeedbackImageUrls] = useState<string[]>([])
  const [attachRecentRequests, setAttachRecentRequests] = useState(true)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [uploadingFeedbackImages, setUploadingFeedbackImages] = useState(false)
  const contentLength = content.length
  const trimmedContentLength = content.trim().length
  const contactLength = contact.length
  const canSubmitFeedback = trimmedContentLength >= 5 && !submittingFeedback && !uploadingFeedbackImages
  const traceCount = useMemo(() => getRecentRequestTraces().length, [])
  const consoleLogCount = useMemo(() => getRecentConsoleLogs().length, [])

  const submit = async () => {
    if (trimmedContentLength < 5) {
      await dialog.alert('请补充反馈内容', '请至少填写 5 个字，帮助我们定位问题或理解建议。', 'warning')
      return
    }
    if (uploadingFeedbackImages) {
      await dialog.alert('截图还在处理', '请等截图处理完成后再提交反馈。', 'warning')
      return
    }
    try {
      setSubmittingFeedback(true)
      await apiClient.submitFeedback({
        category,
        content,
        contact,
        pagePath: 'app://feedback',
        appVersion: APP_VERSION,
        clientInfo: {
          surface: 'expo',
          recent_request_limit: RECENT_REQUEST_TRACE_LIMIT,
          console_log_limit: CONSOLE_LOG_BUFFER_LIMIT,
          ...(attachRecentRequests ? { console_logs: getRecentConsoleLogs() } : {}),
        },
        recentRequests: attachRecentRequests ? getRecentRequestTraces() : [],
        imageUrls: feedbackImageUrls,
      })
      setContent('')
      setContact('')
      setFeedbackImageUrls([])
      await dialog.alert('已提交', '反馈已经进入处理队列。', 'success')
    } catch (error) {
      await dialog.alert('提交失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSubmittingFeedback(false)
    }
  }

  const pickFeedbackImages = async () => {
    const remaining = FEEDBACK_MAX_IMAGES - feedbackImageUrls.length
    if (remaining <= 0 || uploadingFeedbackImages) return
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('无法访问相册', '请在系统设置中允许访问相册后再添加截图。', 'warning')
        return
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.86,
      })
      if (picked.canceled || !picked.assets.length) return
      setUploadingFeedbackImages(true)
      const uploaded: string[] = []
      for (const asset of picked.assets.slice(0, remaining)) {
        const data = await apiClient.uploadFeedbackImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || 'feedback.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        })
        uploaded.push(data.imageUrl)
      }
      setFeedbackImageUrls((current) => [...current, ...uploaded].slice(0, FEEDBACK_MAX_IMAGES))
    } catch (error) {
      await dialog.alert('上传图片失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setUploadingFeedbackImages(false)
    }
  }

  const removeFeedbackImage = (index: number) => {
    setFeedbackImageUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <View style={styles.feedbackPage}>
      <ScrollView
        style={styles.feedbackScroll}
        contentContainerStyle={[styles.feedbackContent, { paddingBottom: 110 + Math.max(insets.bottom, 10) }]}
      >
        <View style={styles.feedbackHero}>
          <Text style={styles.feedbackHeroTitle}>告诉我们你遇到的问题</Text>
          <Text style={styles.feedbackHeroDesc}>提交后会进入排查列表，我们会结合请求 trace 与截图更快定位原因。</Text>
        </View>

        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackSectionTitle}>反馈类型</Text>
          <View style={styles.feedbackCategoryGrid}>
            {feedbackCategoryOptions.map((item) => (
              <Pressable
                key={item.value}
                style={[styles.feedbackCategoryCard, category === item.value && styles.feedbackCategoryCardActive]}
                onPress={() => setCategory(item.value)}
              >
                <Text style={styles.feedbackCategoryTitle}>{item.label}</Text>
                <Text style={styles.feedbackCategoryDesc}>{item.desc}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.feedbackCard}>
          <View style={styles.feedbackTitleRow}>
            <Text style={styles.feedbackSectionTitle}>反馈内容</Text>
            <Text style={styles.feedbackCount}>{contentLength}/500</Text>
          </View>
          <TextInput
            style={styles.feedbackTextArea}
            value={content}
            onChangeText={setContent}
            placeholder="请描述你遇到的问题、期望的效果，或告诉我们发生的大致时间。"
            placeholderTextColor="#98a2b3"
            maxLength={500}
            multiline
            textAlignVertical="top"
          />
          <Text style={[styles.feedbackCardHint, trimmedContentLength < 5 && styles.formHintWarning]}>至少 5 个字，页面、时间和期望效果越清楚越好。</Text>
        </View>

        <View style={styles.feedbackCard}>
          <View style={styles.feedbackTitleRow}>
            <Text style={styles.feedbackSectionTitle}>截图（选填）</Text>
            <Text style={styles.feedbackCount}>{feedbackImageUrls.length}/{FEEDBACK_MAX_IMAGES}</Text>
          </View>
          <Text style={styles.feedbackCardHint}>可上传页面报错、识别结果等截图，最多 {FEEDBACK_MAX_IMAGES} 张。</Text>
          <FeedbackImagePickerGrid
            urls={feedbackImageUrls}
            loading={uploadingFeedbackImages}
            onAdd={pickFeedbackImages}
            onRemove={removeFeedbackImage}
          />
        </View>

        <View style={styles.feedbackCard}>
          <View style={styles.feedbackTitleRow}>
            <Text style={styles.feedbackSectionTitle}>联系方式（选填）</Text>
            <Text style={styles.feedbackCount}>{contactLength}/120</Text>
          </View>
          <TextInput
            style={styles.feedbackContactArea}
            value={contact}
            onChangeText={setContact}
            placeholder="可填写微信号、手机号或邮箱，便于我们需要时联系你。"
            placeholderTextColor="#98a2b3"
            maxLength={120}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={[styles.feedbackCard, styles.feedbackDiagnosticCard]}>
          <View style={styles.feedbackDiagnosticMain}>
            <Text style={styles.feedbackSectionTitle}>附带请求诊断</Text>
            <Text style={styles.feedbackDiagnosticDesc}>
              {`将附带最近 ${Math.min(traceCount, RECENT_REQUEST_TRACE_LIMIT)} 条请求的 traceId、状态码和耗时，以及最近 ${Math.min(consoleLogCount, CONSOLE_LOG_BUFFER_LIMIT)} 条客户端日志，不包含 token、请求体或图片。`}
            </Text>
          </View>
          <Switch
            value={attachRecentRequests}
            onValueChange={setAttachRecentRequests}
            trackColor={{ false: '#d0d5dd', true: '#00bc7d' }}
            thumbColor="#ffffff"
          />
        </View>
      </ScrollView>

      <View style={[styles.feedbackSubmitBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable
          style={[styles.feedbackSubmitButton, !canSubmitFeedback && styles.feedbackSubmitButtonDisabled]}
          disabled={!canSubmitFeedback}
          onPress={submit}
        >
          {submittingFeedback ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <Send size={16} color="#ffffff" strokeWidth={2.4} />
              <Text style={styles.feedbackSubmitText}>提交反馈</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  )
}

export function AboutScreen() {
  const dialog = useAppDialog()

  const copyOfficialEmail = async () => {
    await Clipboard.setStringAsync(OFFICIAL_EMAIL)
    await dialog.alert('已复制邮箱', OFFICIAL_EMAIL, 'success')
  }

  return (
    <ScrollView style={styles.aboutPage} contentContainerStyle={styles.aboutContent} showsVerticalScrollIndicator={false}>
      <View style={styles.aboutHeaderSection}>
        <View style={styles.aboutLogoWrapper}>
          <Image source={appIcon} style={styles.aboutLogoImage} resizeMode="contain" />
        </View>
        <Text style={styles.aboutAppName}>智健食探</Text>
        <Text style={styles.aboutAppVersion}>Version {APP_VERSION}</Text>
      </View>

      <View style={styles.aboutCard}>
        <Text style={styles.aboutCardTitle}>关于食探</Text>
        <Text style={styles.aboutCardText}>
          「食探」是一款致力于帮助用户通过拍照识别食物卡路里、记录日常饮食与运动、管理健康档案的智能助手。我们希望通过 AI 技术，让健康管理变得更加简单、有趣且高效。无论你是想减脂、增肌还是维持健康，食探都能为你提供专业的分析与建议。
        </Text>
      </View>

      <Pressable style={({ pressed }) => [styles.aboutCellGroup, pressed && styles.aboutCellPressed]} onPress={() => void copyOfficialEmail()}>
        <Text style={styles.aboutCellTitle}>官方邮箱</Text>
        <View style={styles.aboutCellValueWrap}>
          <Text style={styles.aboutCellValue} numberOfLines={1}>{OFFICIAL_EMAIL}</Text>
          <Text style={styles.aboutCellArrow}>›</Text>
        </View>
      </Pressable>

      <View style={styles.aboutCard}>
        <Text style={styles.aboutCardTitle}>特别鸣谢</Text>
        <Text style={styles.aboutCardText}>
          感谢所有用户的支持与反馈，正是你们的建议让食探变得更好。如有任何问题或建议，欢迎随时通过意见反馈或联系客服告诉我们。
        </Text>
      </View>

      <Text style={styles.aboutCopyright}>Copyright © 2026 Food Link. All Rights Reserved.</Text>
    </ScrollView>
  )
}

function HealthProfileStepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View>
      <Text style={styles.healthProfileStepTitle}>{title}</Text>
      <Text style={styles.healthProfileStepSubtitle}>{subtitle}</Text>
    </View>
  )
}

function HealthProfileChoiceCard({
  label,
  desc,
  icon,
  active,
  size,
  onPress,
}: {
  label: string
  desc?: string
  icon?: string
  active: boolean
  size?: 'big' | 'small'
  onPress: () => void
}) {
  return (
    <Pressable
      style={[
        styles.healthProfileOptionCard,
        size === 'big' && styles.healthProfileOptionCardBig,
        size === 'small' && styles.healthProfileOptionCardSmall,
        active && styles.healthProfileOptionCardActive,
      ]}
      onPress={onPress}
    >
      <View style={[styles.healthProfileChoiceMark, active && styles.healthProfileChoiceMarkActive]}>
        {active ? <View style={styles.healthProfileChoiceMarkInner} /> : null}
      </View>
      {icon ? <Text style={[styles.healthProfileOptionIcon, size === 'small' && styles.healthProfileOptionIconSmall]}>{icon}</Text> : null}
      <View style={styles.healthProfileOptionCopy}>
        <Text style={[styles.healthProfileOptionLabel, active && styles.healthProfileOptionLabelActive]} numberOfLines={1}>{label}</Text>
        {desc ? <Text style={styles.healthProfileOptionDesc} numberOfLines={2}>{desc}</Text> : null}
      </View>
    </Pressable>
  )
}

function HealthProfileNumberCard({
  value,
  unit,
  min,
  max,
  onChange,
}: {
  value: string
  unit: string
  min: string
  max: string
  onChange: (value: string) => void
}) {
  return (
    <View style={styles.healthProfileNumberCard}>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder={min}
        placeholderTextColor="#cbd5e1"
        style={styles.healthProfileNumberInput}
        maxLength={3}
      />
      <Text style={styles.healthProfileNumberUnit}>{unit}</Text>
      <Text style={styles.healthProfileNumberRange}>{min} - {max}</Text>
    </View>
  )
}

function HealthProfileRoutineField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.healthProfileRoutineField}>
      <Text style={styles.healthProfileRoutineLabel}>{label}</Text>
      <View style={styles.healthProfileRoutineInputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor="#cbd5e1"
          style={styles.healthProfileRoutineInput}
          maxLength={2}
        />
        <Text style={styles.healthProfileRoutineUnit}>点</Text>
      </View>
    </View>
  )
}

function HealthProfileTargetField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <View style={styles.healthProfileTargetField}>
      <Text style={styles.healthProfileTargetLabel}>{label}</Text>
      <View style={styles.healthProfileTargetInputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          placeholder="--"
          placeholderTextColor="#cbd5e1"
          style={styles.healthProfileTargetInput}
          maxLength={5}
        />
        <Text style={styles.healthProfileTargetUnit}>{unit}</Text>
      </View>
    </View>
  )
}

function Field({
  label,
  rightLabel,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  maxLength,
  returnKeyType,
  onSubmitEditing,
}: {
  label: string
  rightLabel?: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
  maxLength?: number
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send'
  onSubmitEditing?: () => void
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {rightLabel ? <Text style={styles.fieldMeta}>{rightLabel}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  )
}

function MealPicker({ value, onChange }: { value: MealType; onChange: (value: MealType) => void }) {
  return (
    <View style={styles.segment}>
      {mealOptions.map((meal) => (
        <Pressable key={meal} style={[styles.segmentItem, value === meal && styles.segmentItemActive]} onPress={() => onChange(meal)}>
          <Text style={[styles.segmentText, value === meal && styles.segmentTextActive]}>{getMealTypeLabel(meal)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  )
}

function NotificationTabButton({ label, badge, active, onPress }: { label: string; badge?: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.notificationTabItem, active && styles.notificationTabItemActive]} onPress={onPress}>
      <Text style={[styles.notificationTabText, active && styles.notificationTabTextActive]}>{label}</Text>
      {badge && badge > 0 ? (
        <View style={[styles.notificationTabBadge, active && styles.notificationTabBadgeActive]}>
          <Text style={[styles.notificationTabBadgeText, active && styles.notificationTabBadgeTextActive]}>{formatBadgeCount(badge)}</Text>
        </View>
      ) : null}
      {active ? <View style={styles.notificationTabIndicator} /> : null}
    </Pressable>
  )
}

function OptionSegment({
  title,
  value,
  options,
  onChange,
}: {
  title: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{title}</Text>
      <View style={styles.segment}>
        {options.map((option) => (
          <SegmentButton key={option.value || 'empty'} label={option.label} active={value === option.value} onPress={() => onChange(option.value)} />
        ))}
      </View>
    </View>
  )
}

function ToggleRow({
  title,
  subtitle,
  value,
  disabled,
  onValueChange,
}: {
  title: string
  subtitle: string
  value: boolean
  disabled?: boolean
  onValueChange: (value: boolean) => void
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text style={styles.itemName}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} trackColor={{ true: colors.brandSoft, false: colors.border }} thumbColor={value ? colors.brand : '#fff'} />
    </View>
  )
}

function SelectedManualFoodCard({
  entry,
  onWeightChange,
  onAdjust,
  onPreset,
  onRemove,
}: {
  entry: SelectedManualFood
  onWeightChange: (value: string) => void
  onAdjust: (delta: number) => void
  onPreset: (ratio: number) => void
  onRemove: () => void
}) {
  const weight = numberFrom(entry.weight, numberFrom(entry.item.default_weight_grams, 100))
  const nutrients = scaledManualFoodNutrition(entry.item, weight)
  const usesPortionUnit = manualFoodUsesPortionUnit(entry.item)
  const quantityUnit = usesPortionUnit ? manualFoodPortionUnitLabel(entry.item) : 'g'
  const adjustOptions = usesPortionUnit
    ? [
      { label: `-0.5${quantityUnit}`, delta: -0.5 },
      { label: `-0.25${quantityUnit}`, delta: -0.25 },
      { label: `+0.25${quantityUnit}`, delta: 0.25 },
      { label: `+0.5${quantityUnit}`, delta: 0.5 },
    ]
    : [
      { label: '-50g', delta: -50 },
      { label: '-10g', delta: -10 },
      { label: '+10g', delta: 10 },
      { label: '+50g', delta: 50 },
    ]
  return (
    <View style={styles.selectedFoodBox}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.itemName}>{manualFoodTitle(entry.item)}</Text>
          <Text style={styles.subtitle}>{manualFoodSourceLabel(entry.item)} · {Math.round(nutrients.calories)} kcal</Text>
        </View>
        <Pressable style={[styles.smallButton, styles.smallButtonDanger]} onPress={onRemove}>
          <Text style={[styles.smallButtonText, styles.smallButtonDangerText]}>移除</Text>
        </Pressable>
      </View>
      <Field label={usesPortionUnit ? `数量 ${quantityUnit}` : '份量 g'} value={entry.weight} onChangeText={onWeightChange} keyboardType="decimal-pad" />
      <View style={styles.ratioGrid}>
        {[
          { label: '25%', ratio: 0.25 },
          { label: '50%', ratio: 0.5 },
          { label: '100%', ratio: 1 },
        ].map((preset) => (
          <Pressable key={preset.label} style={styles.ratioButton} onPress={() => onPreset(preset.ratio)}>
            <Text style={styles.ratioButtonText}>{preset.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.manualAdjustRow}>
        {adjustOptions.map((option) => (
          <Pressable key={option.label} style={styles.manualAdjustButton} onPress={() => onAdjust(option.delta)}>
            <Text style={styles.manualAdjustText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function ManualFoodThumb({ item, size = 44 }: { item: ManualFoodItem; size?: number }) {
  const uri = manualFoodImageUri(item)
  if (uri) {
    return <Image source={{ uri }} style={[styles.manualFoodThumb, { width: size, height: size }]} />
  }
  return (
    <View style={[styles.manualFoodThumbPlaceholder, { width: size, height: size }]}>
      <Text style={styles.manualFoodThumbText}>食</Text>
    </View>
  )
}

function ManualFoodChoiceRow({ item, selected, onPress }: { item: ManualFoodItem; selected?: boolean; onPress: () => void }) {
  const calories = Math.round(numberFrom(item.total_calories ?? item.calories))
  const protein = Math.round(numberFrom(item.total_protein ?? item.protein))
  const hint = String(item.recommend_reason || '')
  return (
    <Pressable style={styles.manualFoodRow} onPress={onPress}>
      <ManualFoodThumb item={item} />
      <View style={styles.manualFoodInfo}>
        <View style={styles.manualFoodNameRow}>
          <Text style={styles.manualFoodName} numberOfLines={1}>{manualFoodTitle(item)}</Text>
          <View style={styles.manualFoodSourceBadge}>
            <Text style={styles.manualFoodSourceBadgeText} numberOfLines={1}>{manualFoodSourceLabel(item)}</Text>
          </View>
        </View>
        <Text style={styles.manualFoodSub} numberOfLines={1}>{calories} kcal / {manualFoodPortionText(item)} · 蛋白 {protein}g</Text>
        {hint ? <Text style={styles.manualFoodHint} numberOfLines={1}>{hint}</Text> : null}
      </View>
      <View style={[styles.manualFoodAddButton, selected && styles.manualFoodAddButtonActive]}>
        <Text style={[styles.manualFoodAddText, selected && styles.manualFoodAddTextActive]}>{selected ? '已选' : '+'}</Text>
      </View>
    </Pressable>
  )
}

function FoodLibraryCompactField({
  label,
  value,
  onChangeText,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
}) {
  return (
    <View style={styles.foodLibraryCustomField}>
      <Text style={styles.foodLibraryCustomLabel}>{label}</Text>
      <TextInput style={styles.foodLibraryCustomInput} value={value} onChangeText={onChangeText} keyboardType="decimal-pad" placeholder="可选" placeholderTextColor="#94a3b8" />
    </View>
  )
}

function FoodLibraryCard({
  item,
  latest,
  onOpen,
  onRecord,
}: {
  item: ManualFoodItem
  latest?: boolean
  onOpen: () => void
  onRecord: () => void
}) {
  const calories = Math.round(numberFrom(item.total_calories ?? item.calories))
  const protein = Math.round(numberFrom(item.total_protein ?? item.protein))
  const carbs = Math.round(numberFrom(item.total_carbs ?? item.carbs))
  const fat = Math.round(numberFrom(item.total_fat ?? item.fat))
  const source = manualFoodSourceLabel(item)
  const reason = String(item.recommend_reason || '')

  return (
    <Pressable style={styles.foodLibraryCard} onPress={onOpen}>
      <View style={styles.foodLibraryCardMain}>
        <View style={styles.foodLibraryCardImageWrap}>
          <ManualFoodThumb item={item} size={110} />
          {latest ? <Text style={styles.foodLibraryLatestBadge}>最新</Text> : null}
        </View>
        <View style={styles.foodLibraryCardInfo}>
          <View style={styles.foodLibraryCardTitleRow}>
            <Text style={styles.foodLibraryCardTitle} numberOfLines={1}>{manualFoodTitle(item)}</Text>
            <View style={styles.foodLibrarySourcePill}>
              <Text style={styles.foodLibrarySourcePillText} numberOfLines={1}>{source}</Text>
            </View>
          </View>
          <Text style={styles.foodLibraryCardDesc} numberOfLines={2}>{reason || manualFoodPortionText(item)}</Text>
          <Text style={styles.foodLibraryCardCalories}>{calories} kcal</Text>
          <View style={styles.foodLibraryNutritionRow}>
            <Text style={styles.foodLibraryNutritionPill}>蛋白 {protein}g</Text>
            <Text style={styles.foodLibraryNutritionPill}>碳水 {carbs}g</Text>
            <Text style={styles.foodLibraryNutritionPill}>脂肪 {fat}g</Text>
          </View>
        </View>
      </View>
      <View style={styles.foodLibraryCardFooter}>
        <Text style={styles.foodLibraryCardFooterText} numberOfLines={1}>{source} · {manualFoodPortionText(item)}</Text>
        <View style={styles.foodLibraryCardActions}>
          <Pressable
            style={styles.foodLibraryCardGhostButton}
            onPress={(event) => {
              event.stopPropagation()
              onOpen()
            }}
          >
            <Text style={styles.foodLibraryCardGhostButtonText}>详情</Text>
          </Pressable>
          <Pressable
            style={styles.foodLibraryCardRecordButton}
            onPress={(event) => {
              event.stopPropagation()
              onRecord()
            }}
          >
            <Text style={styles.foodLibraryCardRecordButtonText}>记录</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  )
}

function FoodLibrarySkeleton() {
  return (
    <View>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.foodLibrarySkeletonCard}>
          <View style={styles.foodLibrarySkeletonMain}>
            <View style={styles.foodLibrarySkeletonImage} />
            <View style={styles.foodLibrarySkeletonInfo}>
              <View style={[styles.foodLibrarySkeletonLine, { width: '70%', height: 16 }]} />
              <View style={[styles.foodLibrarySkeletonLine, { width: '92%', height: 12 }]} />
              <View style={[styles.foodLibrarySkeletonLine, { width: '40%', height: 14 }]} />
            </View>
          </View>
          <View style={styles.foodLibrarySkeletonFooter}>
            <View style={[styles.foodLibrarySkeletonLine, { width: 88, height: 12 }]} />
            <View style={[styles.foodLibrarySkeletonLine, { width: 120, height: 12 }]} />
          </View>
        </View>
      ))}
    </View>
  )
}

function ManualSelectedFoodItem({
  entry,
  onWeightChange,
  onAdjust,
  onPreset,
  onRemove,
}: {
  entry: SelectedManualFood
  onWeightChange: (value: string) => void
  onAdjust: (delta: number) => void
  onPreset: (ratio: number) => void
  onRemove: () => void
}) {
  const weight = numberFrom(entry.weight, numberFrom(entry.item.default_weight_grams, 100))
  const nutrients = scaledManualFoodNutrition(entry.item, weight)
  const usesPortionUnit = manualFoodUsesPortionUnit(entry.item)
  const quantityUnit = usesPortionUnit ? manualFoodPortionUnitLabel(entry.item) : 'g'
  const adjustOptions = usesPortionUnit
    ? [
      { label: `-0.5${quantityUnit}`, delta: -0.5 },
      { label: `+0.5${quantityUnit}`, delta: 0.5 },
    ]
    : [
      { label: '-50g', delta: -50 },
      { label: '+50g', delta: 50 },
    ]

  return (
    <View style={styles.manualSelectedItem}>
      <View style={styles.manualSelectedMain}>
        <ManualFoodThumb item={entry.item} size={42} />
        <View style={styles.manualFoodInfo}>
          <Text style={styles.manualFoodName} numberOfLines={1}>{manualFoodTitle(entry.item)}</Text>
          <Text style={styles.manualFoodSub} numberOfLines={1}>{manualFoodSourceLabel(entry.item)} · {Math.round(nutrients.calories)} kcal</Text>
        </View>
        <Pressable style={styles.manualSelectedRemove} onPress={onRemove} hitSlop={8}>
          <Trash2 size={15} color="#ef4444" />
        </Pressable>
      </View>
      <View style={styles.manualSelectedControls}>
        <View style={styles.manualWeightInputWrap}>
          <TextInput
            value={entry.weight}
            onChangeText={onWeightChange}
            keyboardType="decimal-pad"
            style={styles.manualWeightInput}
          />
          <Text style={styles.manualWeightUnit}>{quantityUnit}</Text>
        </View>
        {[{ label: '25%', ratio: 0.25 }, { label: '50%', ratio: 0.5 }, { label: '100%', ratio: 1 }].map((preset) => (
          <Pressable key={preset.label} style={styles.manualQuickChip} onPress={() => onPreset(preset.ratio)}>
            <Text style={styles.manualQuickChipText}>{preset.label}</Text>
          </Pressable>
        ))}
        {adjustOptions.map((option) => (
          <Pressable key={option.label} style={styles.manualQuickChip} onPress={() => onAdjust(option.delta)}>
            <Text style={styles.manualQuickChipText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function FoodChoice({ item, selected, onPress }: { item: ManualFoodItem; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <View style={styles.foodChoiceLegacyCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.itemName}>{manualFoodTitle(item)}</Text>
            <Text style={styles.subtitle}>{manualFoodSourceLabel(item)} · {manualFoodPortionText(item)}</Text>
          </View>
          <View style={selected ? styles.foodChoiceAdded : styles.foodChoiceAdd}>
            <Text style={selected ? styles.foodChoiceAddedText : styles.foodChoiceAddText}>{selected ? '已选' : '+'}</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>{Math.round(numberFrom(item.total_calories ?? item.calories))} kcal · 蛋白 {Math.round(numberFrom(item.total_protein ?? item.protein))}g</Text>
      </View>
    </Pressable>
  )
}

function SectionList({
  title,
  items,
  onItemPress,
}: {
  title: string
  items: ManualFoodItem[]
  onItemPress?: (item: ManualFoodItem) => void
}) {
  if (!items.length) return null
  return (
    <>
      <Text style={styles.groupTitle}>{title}</Text>
      {items.slice(0, 12).map((item, index) => (
        <FoodChoice
          key={`${title}-${manualFoodTitle(item)}-${item.id || index}`}
          item={item}
          onPress={() => onItemPress?.(item)}
        />
      ))}
    </>
  )
}

function MiniStat({ title, value }: { title: string; value: number }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  )
}

function SummaryCell({ title, value, unit }: { title: string; value: number | string; unit: string }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryValue}>
        {value}
        {unit ? <Text style={styles.summaryUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.summaryTitle}>{title}</Text>
    </View>
  )
}

function RecordDetailSummaryCell({ label, value, unit, highlight }: { label: string; value: string; unit: string; highlight?: boolean }) {
  return (
    <View style={styles.recordDetailSummaryItem}>
      <Text style={styles.recordDetailSummaryLabel}>{label}</Text>
      <Text style={[styles.recordDetailSummaryValue, highlight && styles.recordDetailSummaryValueHighlight]}>{value}</Text>
      <Text style={styles.recordDetailSummaryUnit}>{unit}</Text>
    </View>
  )
}

function FriendUserCard({
  user,
  subtitle,
  onPress,
  actions,
}: {
  user: FriendUserItem
  subtitle?: string
  onPress?: () => void
  actions?: ReactNode
}) {
  return (
    <View style={styles.friendsCard}>
      <View style={styles.friendsCardRow}>
        <Pressable style={styles.friendsInfoRow} onPress={onPress}>
          <FriendAvatar uri={user.avatar} label={friendDisplayName(user)} />
          <View style={styles.friendsMeta}>
            <Text style={styles.friendsName} numberOfLines={1}>{friendDisplayName(user)}</Text>
            <Text style={styles.friendsSubtitle} numberOfLines={1}>{subtitle || friendUserSubtitle(user)}</Text>
          </View>
        </Pressable>
        {actions ? <View style={styles.friendsActionRow}>{actions}</View> : null}
      </View>
    </View>
  )
}

function FriendRequestCard({
  request,
  onPress,
  actions,
  footerActions,
}: {
  request: FriendRequestItem
  onPress?: () => void
  actions?: ReactNode
  footerActions?: ReactNode
}) {
  return (
    <View style={[styles.friendsCard, Boolean(footerActions) && styles.friendsCardVertical]}>
      <View style={styles.friendsCardRow}>
        <Pressable style={styles.friendsInfoRow} onPress={onPress}>
          <FriendAvatar uri={friendRequestAvatar(request)} label={friendRequestDisplayName(request)} />
          <View style={styles.friendsMeta}>
            <Text style={styles.friendsName} numberOfLines={1}>{friendRequestDisplayName(request)}</Text>
            <Text style={styles.friendsSubtitle} numberOfLines={1}>{friendRequestTimeLabel(request) || friendRequestStatusLabel(request.status)}</Text>
          </View>
        </Pressable>
        {actions ? <View style={styles.friendsActionRow}>{actions}</View> : null}
      </View>
      {footerActions ? <View style={styles.friendsCardFooterActions}>{footerActions}</View> : null}
    </View>
  )
}

function FriendBlockCard({
  user,
  onPress,
  actions,
}: {
  user: FriendBlockItem
  onPress?: () => void
  actions?: ReactNode
}) {
  return (
    <View style={styles.friendsCard}>
      <View style={styles.friendsCardRow}>
        <Pressable style={styles.friendsInfoRow} onPress={onPress}>
          <FriendAvatar uri={user.avatar} label={friendBlockDisplayName(user)} />
          <View style={styles.friendsMeta}>
            <Text style={styles.friendsName} numberOfLines={1}>{friendBlockDisplayName(user)}</Text>
            <Text style={styles.friendsSubtitle} numberOfLines={1}>
              {user.blocked_at || user.created_at ? `拉黑于 ${formatDateTime(user.blocked_at || user.created_at)}` : '已加入黑名单'}
            </Text>
          </View>
        </Pressable>
        {actions ? <View style={styles.friendsActionRow}>{actions}</View> : null}
      </View>
    </View>
  )
}

function FriendAvatar({ uri, label }: { uri?: string; label: string }) {
  if (uri) return <Image source={{ uri }} style={styles.friendAvatarImage} />
  return (
    <View style={styles.friendAvatarFallback}>
      <Text style={styles.friendAvatarText}>{(label.trim() || '友').slice(0, 1)}</Text>
    </View>
  )
}

function FriendsTabButton({ label, badge, active, onPress }: { label: string; badge?: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.friendsTabItem, active && styles.friendsTabItemActive]} onPress={onPress}>
      <Text style={[styles.friendsTabText, active && styles.friendsTabTextActive]} numberOfLines={1}>{label}</Text>
      {typeof badge === 'number' && badge > 0 ? (
        <View style={[styles.friendsTabBadge, active && styles.friendsTabBadgeActive]}>
          <Text style={[styles.friendsTabBadgeText, active && styles.friendsTabBadgeTextActive]}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function FriendActionButton({
  label,
  icon: Icon,
  tone = 'primary',
  disabled,
  onPress,
}: {
  label: string
  icon: LucideIcon
  tone?: 'primary' | 'danger'
  disabled?: boolean
  onPress: () => void
}) {
  const isDanger = tone === 'danger'
  const color = disabled ? '#cbd5e1' : isDanger ? '#ef4444' : colors.brand
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.friendsIconButton, isDanger && styles.friendsIconButtonDanger, disabled && styles.friendsIconButtonDisabled]}
    >
      <Icon size={16} color={color} strokeWidth={2.2} />
    </Pressable>
  )
}

function FriendTextActionButton({
  label,
  danger,
  loading,
  disabled,
  onPress,
}: {
  label: string
  danger?: boolean
  loading?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.friendsTextActionButton, danger && styles.friendsTextActionButtonDanger, disabled && styles.friendsTextActionButtonDisabled]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={danger ? '#ef4444' : '#64748b'} />
      ) : (
        <Text style={[styles.friendsTextActionButtonText, danger && styles.friendsTextActionButtonDangerText]}>{label}</Text>
      )}
    </Pressable>
  )
}

function FriendsEmptyState({
  title,
  subtitle,
  variant = 'friends',
  actionLabel,
  onAction,
}: {
  title: string
  subtitle: string
  variant?: 'friends' | 'received' | 'sent' | 'search' | 'blocks'
  actionLabel?: string
  onAction?: () => void
}) {
  const Icon = variant === 'received' ? Inbox : variant === 'sent' ? Send : variant === 'search' ? Search : variant === 'blocks' ? X : UserPlus
  return (
    <View style={styles.friendsEmptyCard}>
      <View style={styles.friendsEmptyIcon}>
        <Icon size={36} color={colors.brand} strokeWidth={1.6} />
      </View>
      <Text style={styles.friendsEmptyTitle}>{title}</Text>
      <Text style={styles.friendsEmptySubtitle}>{subtitle}</Text>
      {actionLabel && onAction ? (
        <Pressable style={styles.friendsEmptyAction} onPress={onAction}>
          <Text style={styles.friendsEmptyActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function SmallButton({ label, danger, disabled, onPress }: { label: string; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.smallButton, danger && styles.smallButtonDanger, disabled && styles.smallButtonDisabled]}>
      <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText, disabled && styles.smallButtonTextDisabled]}>{label}</Text>
    </Pressable>
  )
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  )
}

function ExpirySummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.expirySummaryCard}>
      <Text style={styles.expirySummaryValue}>{value}</Text>
      <Text style={styles.expirySummaryLabel}>{label}</Text>
    </View>
  )
}

function ExpiryItemCard({
  item,
  onPress,
  onUpdateStatus,
}: {
  item: FoodExpiryItem
  onPress: () => void
  onUpdateStatus: (item: FoodExpiryItem, status: 'active' | 'consumed' | 'discarded') => Promise<void>
}) {
  const badgeTone = expiryBadgeTone(item)
  const badgeStyle =
    badgeTone === 'expired' ? styles.expiryItemBadge_expired
      : badgeTone === 'today' ? styles.expiryItemBadge_today
        : badgeTone === 'soon' ? styles.expiryItemBadge_soon
          : badgeTone === 'consumed' ? styles.expiryItemBadge_consumed
            : badgeTone === 'discarded' ? styles.expiryItemBadge_discarded
              : styles.expiryItemBadge_fresh
  const badgeTextStyle =
    badgeTone === 'expired' ? styles.expiryItemBadgeText_expired
      : badgeTone === 'today' ? styles.expiryItemBadgeText_today
        : badgeTone === 'soon' ? styles.expiryItemBadgeText_soon
          : badgeTone === 'consumed' ? styles.expiryItemBadgeText_consumed
            : badgeTone === 'discarded' ? styles.expiryItemBadgeText_discarded
              : styles.expiryItemBadgeText_fresh
  return (
    <Pressable style={styles.expiryItemCard} onPress={onPress}>
      <View style={styles.expiryItemHead}>
        <View style={styles.expiryItemTitleWrap}>
          <Text style={styles.expiryItemTitle} numberOfLines={1}>{item.food_name}</Text>
          {item.category ? (
            <View style={styles.expiryItemCategory}>
              <Text style={styles.expiryItemCategoryText} numberOfLines={1}>{item.category}</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.expiryItemBadge, badgeStyle]}>
          <Text style={[styles.expiryItemBadgeText, badgeTextStyle]} numberOfLines={1}>
            {item.status === 'active' ? item.urgency_label || formatExpiryHint(item) : expiryStatusLabel(item.status)}
          </Text>
        </View>
      </View>

      <View style={styles.expiryItemMeta}>
        <Text style={styles.expiryItemMetaText}>到期日 {formatExpiryDate(item.expire_date)}</Text>
        <Text style={styles.expiryItemMetaText}>{expiryStorageLabel(item.storage_type)}</Text>
        {item.quantity_note ? <Text style={styles.expiryItemMetaText}>{item.quantity_note}</Text> : null}
      </View>

      <Text style={styles.expiryItemHint}>{formatExpiryHint(item)}</Text>
      {item.note ? <Text style={styles.expiryItemNote} numberOfLines={2}>{item.note}</Text> : null}

      <View style={styles.expiryItemActions}>
        {item.status === 'active' ? (
          <>
            <Pressable
              style={styles.expiryActionGhost}
              onPress={(event) => {
                event.stopPropagation()
                void onUpdateStatus(item, 'consumed')
              }}
            >
              <Check size={14} color="#314740" strokeWidth={2.4} />
              <Text style={styles.expiryActionGhostText}>已吃完</Text>
            </Pressable>
            <Pressable
              style={styles.expiryActionGhost}
              onPress={(event) => {
                event.stopPropagation()
                void onUpdateStatus(item, 'discarded')
              }}
            >
              <Trash2 size={14} color="#314740" strokeWidth={2.2} />
              <Text style={styles.expiryActionGhostText}>已丢弃</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={styles.expiryActionGhost}
            onPress={(event) => {
              event.stopPropagation()
              void onUpdateStatus(item, 'active')
            }}
          >
            <Undo2 size={14} color="#314740" strokeWidth={2.2} />
            <Text style={styles.expiryActionGhostText}>恢复提醒</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.expiryActionPrimary}
          onPress={(event) => {
            event.stopPropagation()
            onPress()
          }}
        >
          <Text style={styles.expiryActionPrimaryText}>编辑</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

function groupFoodExpiryItems(items: FoodExpiryItem[]) {
  const urgent = items.filter((item) => item.status === 'active' && item.urgency !== 'fresh')
  const fresh = items.filter((item) => item.status === 'active' && item.urgency === 'fresh')
  const processed = items.filter((item) => item.status !== 'active')
  return { urgent, fresh, processed }
}

function expiryStatusLabel(value?: string): string {
  const labels: Record<string, string> = {
    active: '保鲜中',
    consumed: '已吃完',
    discarded: '已丢弃',
    expired: '已过期',
  }
  return labels[value || ''] || '保鲜中'
}

function expiryBadgeTone(item: Pick<FoodExpiryItem, 'status' | 'urgency'>): 'expired' | 'today' | 'soon' | 'fresh' | 'consumed' | 'discarded' {
  if (item.status === 'consumed') return 'consumed'
  if (item.status === 'discarded') return 'discarded'
  if (item.urgency === 'expired') return 'expired'
  if (item.urgency === 'today') return 'today'
  if (item.urgency === 'soon') return 'soon'
  return 'fresh'
}

function formatExpiryHint(item: Pick<FoodExpiryItem, 'status' | 'days_until_expire'>): string {
  if (item.status !== 'active') {
    return item.status === 'consumed' ? '已标记吃完' : '已标记丢弃'
  }
  if (item.days_until_expire == null) return '保质期待确认'
  if (item.days_until_expire < 0) return `已过期 ${Math.abs(item.days_until_expire)} 天`
  if (item.days_until_expire === 0) return '今天到期'
  if (item.days_until_expire === 1) return '明天到期'
  return `${item.days_until_expire} 天后到期`
}

function formatExpiryDate(value?: string): string {
  if (!value) return '待确认'
  return value.slice(0, 10)
}

function expiryStorageLabel(value?: string): string {
  return expiryStorageOptions.find((option) => option.value === value)?.label || '储存方式待确认'
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function rewardTaskKey(task: { code?: string; action_type?: string; name?: string }): string {
  return task.action_type || task.code || task.name || 'reward-task'
}

function rewardTaskName(task: { name?: string; action_type?: string }): string {
  if (task.action_type === 'public_food_upload') return '上传公共食物/校园食堂菜品'
  if (task.action_type === 'packaged_food_upload') return '预包装零食/食物上传'
  if (task.action_type === 'share_poster') return '每日分享打卡'
  return task.name || '积分任务'
}

function isRewardTaskDisabled(task: { daily_limit?: number | null; today_count?: number }): boolean {
  return typeof task.daily_limit === 'number' && task.daily_limit > 0 && Number(task.today_count || 0) >= task.daily_limit
}

function isRewardTaskAvailable(task: { action_path?: string | null; daily_limit?: number | null; today_count?: number }): boolean {
  return Boolean(task.action_path) && !isRewardTaskDisabled(task)
}

function rewardTaskStatus(task: { status?: string; daily_limit?: number | null; today_count?: number }): string {
  if (isRewardTaskDisabled(task)) return '今日已满'
  return task.status || '可去完成'
}

function formatRewardTaskProgress(task: { daily_limit?: number | null; today_count?: number }): string {
  const count = Number(task.today_count || 0)
  if (typeof task.daily_limit === 'number' && task.daily_limit > 0) {
    return `今日 ${count}/${task.daily_limit}`
  }
  return `今日已提交 ${count}`
}

function formatRewardTaskMetaProgress(task: { daily_limit?: number | null; today_count?: number }): string {
  const count = Number(task.today_count || 0)
  if (typeof task.daily_limit === 'number' && task.daily_limit > 0) {
    return `今日进度 ${count}/${task.daily_limit}`
  }
  return `今日已提交 ${count}`
}

function formatRewardTaskLimit(task: { daily_limit?: number | null }): string {
  if (typeof task.daily_limit === 'number' && task.daily_limit > 0) return `每日上限 ${task.daily_limit}`
  return '不限次数，新内容才奖励'
}

function navigateRewardTask(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  task: { action_type?: string; action_path?: string | null; daily_limit?: number | null; today_count?: number },
) {
  if (isRewardTaskDisabled(task) || !task.action_path) return
  switch (task.action_type) {
    case 'share_poster':
      navigation.navigate('DayRecord', { date: todayKey() })
      return
    case 'packaged_food_upload':
      navigation.navigate('PackagedFoodEdit')
      return
    case 'public_food_upload':
      navigation.navigate('PublicFoodShare', { mode: 'campus' })
      return
    default:
      navigation.navigate('RewardCenter')
  }
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.rewardEmptyState}>
      <Text style={styles.rewardEmptyText}>{text}</Text>
    </View>
  )
}

function CirclePostImageGrid({
  images,
  loading,
  onAdd,
  onRemove,
}: {
  images: CirclePostImageItem[]
  loading: boolean
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <View style={styles.circlePostEditImageGrid}>
      {images.map((item, index) => (
        <View key={item.id || `${item.url}-${index}`} style={styles.circlePostEditImageItem}>
          <Image source={{ uri: item.url }} style={styles.circlePostEditImagePreview} />
          {item.uploading ? (
            <View style={styles.circlePostEditImageMask}>
              <ActivityIndicator color="#ffffff" size="small" />
            </View>
          ) : null}
          <Pressable style={styles.circlePostEditImageRemove} onPress={() => onRemove(index)} hitSlop={8}>
            <Text style={styles.circlePostEditImageRemoveIcon}>×</Text>
          </Pressable>
        </View>
      ))}
      {images.length < CIRCLE_POST_MAX_IMAGES ? (
        <Pressable style={styles.circlePostEditImageAdd} onPress={onAdd} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.brand} size="small" />
          ) : (
            <>
              <Text style={styles.circlePostEditImageAddIcon}>+</Text>
              <Text style={styles.circlePostEditImageAddText}>添加图片</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  )
}

function FeedbackImagePickerGrid({
  urls,
  loading,
  onAdd,
  onRemove,
}: {
  urls: string[]
  loading: boolean
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <View style={styles.feedbackImageGrid}>
      {urls.map((url, index) => (
        <View key={`${url}-${index}`} style={styles.feedbackImageItem}>
          <Image source={{ uri: url }} style={styles.feedbackImagePreview} />
          <Pressable style={styles.feedbackImageRemove} onPress={() => onRemove(index)} hitSlop={8}>
            <X size={14} color="#ffffff" strokeWidth={2.4} />
          </Pressable>
        </View>
      ))}
      {urls.length < FEEDBACK_MAX_IMAGES ? (
        <Pressable style={styles.feedbackImageAdd} onPress={onAdd} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.brand} size="small" />
          ) : (
            <>
              <ImagePlus size={25} color="#98a2b3" strokeWidth={2} />
              <Text style={styles.feedbackImageAddText}>添加图片</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  )
}

function flattenManualFoodBrowse(data: ManualFoodBrowseResult | null): ManualFoodItem[] {
  if (!data) return []
  return [
    ...(data.recent_items || []),
    ...(data.collected_public_library || []),
    ...(data.public_library || []),
    ...(data.nutrition_library || []),
  ]
}

function sortFoodLibraryItems(items: ManualFoodItem[], sortBy: FoodLibrarySortMode): ManualFoodItem[] {
  const cloned = [...items]
  if (sortBy === 'calories') {
    return cloned.sort((a, b) => numberFrom(b.total_calories ?? b.calories) - numberFrom(a.total_calories ?? a.calories))
  }
  if (sortBy === 'protein') {
    return cloned.sort((a, b) => numberFrom(b.total_protein ?? b.protein) - numberFrom(a.total_protein ?? a.protein))
  }
  return cloned
}

function normalizeManualFoodSourceChannel(value?: string): ManualFoodSourceChannel {
  if (value === 'recommended') return 'common'
  const matched = manualFoodSourceChannels.find((channel) => channel.key === value)
  return matched?.key || 'common'
}

function manualFoodImageUri(item: ManualFoodItem): string | undefined {
  const firstPath = Array.isArray(item.image_paths) ? item.image_paths.find(Boolean) : undefined
  const value = typeof item.image_path === 'string' && item.image_path ? item.image_path : firstPath
  if (!value) return undefined
  if (/^(https?:|file:|content:)/i.test(value)) return value
  return undefined
}

function manualFoodTitle(item: ManualFoodItem): string {
  return String(item.title || item.name || '食物')
}

function manualFoodKey(item: ManualFoodItem): string {
  const id = String(item.source_id || item.id || '').trim()
  if (id) return `${item.source || 'manual'}:${id}`
  return `${item.source || 'manual'}:${manualFoodTitle(item)}`
}

function manualFoodSourceLabel(item: ManualFoodItem): string {
  const sourceLabel = typeof item.source_label === 'string' ? item.source_label.trim() : ''
  if (sourceLabel) return sourceLabel
  if (item.source === 'public_library' && (item.is_campus_food === true || item.type === 'campus')) {
    return '校园食堂'
  }
  switch (item.source) {
    case 'public_library':
      return '真实餐食'
    case 'packaged_food':
      return '包装食品'
    case 'custom':
      return '自定义'
    case 'recent':
      return '最近记录'
    case 'nutrition_library':
    default:
      return '标准食物'
  }
}

function manualFoodPortionText(item: ManualFoodItem): string {
  const portion = typeof item.portion_label === 'string' ? item.portion_label.trim() : ''
  if (portion) return portion
  return `${Math.round(numberFrom(item.default_weight_grams, 100))}g`
}

function manualFoodUsesPortionUnit(item: ManualFoodItem): boolean {
  const portion = manualFoodPortionText(item)
  const defaultWeight = numberFrom(item.default_weight_grams, 100)
  return defaultWeight <= 1 && Boolean(portion) && !/(g|kg|ml|克|千克|毫升)/i.test(portion)
}

function manualFoodPortionUnitLabel(item: ManualFoodItem): string {
  const portion = manualFoodPortionText(item)
  const match = portion.match(/^[\d.]+\s*(.+)$/)
  const unit = match?.[1]?.trim()
  return unit || '份'
}

function manualFoodMinQuantity(item: ManualFoodItem): number {
  return manualFoodUsesPortionUnit(item) ? 0.25 : 1
}

function manualFoodQuantityInputValue(item: ManualFoodItem, value: number): string {
  if (!manualFoodUsesPortionUnit(item)) {
    return String(Math.max(1, Math.round(value)))
  }
  const rounded = Math.max(0.25, Math.round(value * 100) / 100)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function formatManualFoodTotalQuantity(totals: { weight: number; portions: number }): string {
  const parts: string[] = []
  if (totals.portions > 0) parts.push(`${manualFoodQuantityInputValue({ default_weight_grams: 1, portion_label: '1份' }, totals.portions)}份`)
  if (totals.weight > 0) parts.push(`${Math.round(totals.weight)}g`)
  return parts.join(' + ') || '0g'
}

function scaledManualFoodNutrition(item: ManualFoodItem, weight: number): Nutrients & { weight: number } {
  const baseWeight = numberFrom(item.default_weight_grams, 100) || 100
  const safeWeight = Math.max(0, weight)
  const ratio = baseWeight > 0 ? safeWeight / baseWeight : 1
  return {
    calories: numberFrom(item.total_calories ?? item.calories) * ratio,
    protein: numberFrom(item.total_protein ?? item.protein) * ratio,
    carbs: numberFrom(item.total_carbs ?? item.carbs) * ratio,
    fat: numberFrom(item.total_fat ?? item.fat) * ratio,
    fiber: numberFrom(item.nutrients_per_100g?.fiber) * (safeWeight / 100),
    sugar: numberFrom(item.nutrients_per_100g?.sugar) * (safeWeight / 100),
    sodium_mg: numberFrom(item.nutrients_per_100g?.sodium_mg) * (safeWeight / 100),
    weight: safeWeight,
  }
}

function numberFrom(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function numberOrUndefined(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && value.trim() !== '' ? n : undefined
}

function stringArrayFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function ageFromBirthday(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const match = raw.match(/^(\d{4})/)
  if (!match) return ''
  const birthYear = Number(match[1])
  if (!Number.isFinite(birthYear)) return ''
  const age = new Date().getFullYear() - birthYear
  return age >= 1 && age <= 100 ? String(age) : ''
}

function birthdayFromAge(value: string): string {
  const age = Number(value)
  if (!Number.isFinite(age) || age < 1 || age > 100) return ''
  const year = new Date().getFullYear() - Math.round(age)
  return `${year}-01-01`
}

function parseHealthRoutine(value: unknown): { sleep: string; wake: string } {
  const raw = String(value || '').trim()
  const match = raw.match(/(\d{1,2})(?::\d{2})?\D+(\d{1,2})(?::\d{2})?/)
  if (!match) return { sleep: '', wake: '' }
  return { sleep: match[1], wake: match[2] }
}

function formatHealthRoutine(sleep: string, wake: string): string {
  const sleepNumber = Number(sleep)
  const wakeNumber = Number(wake)
  if (!Number.isFinite(sleepNumber) || !Number.isFinite(wakeNumber)) return ''
  const pad = (value: number) => String(Math.max(0, Math.min(23, Math.round(value)))).padStart(2, '0')
  return `${pad(sleepNumber)}:00-${pad(wakeNumber)}:00`
}

function toggleHealthSelection(current: string[], value: string): string[] {
  if (value === 'none') return current.includes('none') ? [] : ['none']
  const withoutNone = current.filter((item) => item !== 'none')
  if (withoutNone.includes(value)) return withoutNone.filter((item) => item !== value)
  return [...withoutNone, value]
}

function healthListForSubmit(value: string[]): string[] | undefined {
  const list = value.map((item) => item.trim()).filter((item) => item && item !== 'none')
  return list.length ? list : undefined
}

function splitImageUrls(value: string): string[] {
  return value
    .split(/\r?\n|,|，/)
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 4)
}

function validateCustomFoodDraft(
  title: string,
  defaultWeightGrams: number,
  per100g: { calories: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; sodium_mg: number },
): string | null {
  if (!title) return '请输入食物名称。'
  if (!Number.isFinite(defaultWeightGrams) || defaultWeightGrams <= 0 || defaultWeightGrams > 5000) {
    return '默认份量需要在 1-5000g 之间。'
  }
  if (per100g.calories <= 0 || per100g.calories > 2000) {
    return '每 100g 热量需要在 1-2000 kcal 之间。'
  }
  const ranges: Array<[string, number, number]> = [
    ['蛋白质', per100g.protein, 300],
    ['碳水', per100g.carbs, 500],
    ['脂肪', per100g.fat, 300],
    ['膳食纤维', per100g.fiber, 200],
    ['糖', per100g.sugar, 300],
    ['钠', per100g.sodium_mg, 100000],
  ]
  const invalid = ranges.find(([, value, max]) => value < 0 || value > max)
  if (invalid) return `${invalid[0]}数值超出合理范围。`
  return null
}

function numberField(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return (Math.round(n * 10) / 10).toString()
}

function round1(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

function clampPercent(value: unknown): number {
  const n = numberFrom(value, 100)
  return Math.max(0, Math.min(100, n))
}

function recordImageUrls(record: FoodRecord | null): string[] {
  if (!record) return []
  const urls = [
    ...(Array.isArray(record.image_paths) ? record.image_paths : []),
    record.image_path,
  ]
  return urls.map((url) => String(url || '').trim()).filter(Boolean)
}

function buildRecordShareMessage(record: FoodRecord, shareUrl?: string): string {
  const lines = [
    `${getMealTypeLabel(record.meal_type)} · ${Math.round(record.total_calories || 0)} kcal`,
    `蛋白质 ${round1(record.total_protein || 0)}g · 碳水 ${round1(record.total_carbs || 0)}g · 脂肪 ${round1(record.total_fat || 0)}g`,
  ]
  const description = String(record.description || '').trim()
  if (description) lines.push(description)
  const foods = (record.items || []).slice(0, 6).map((item) => {
    const intake = Math.round(recordItemIntake(item))
    return `- ${item.name}${intake > 0 ? ` ${intake}g` : ''}`
  })
  if (foods.length) lines.push('食物明细:', ...foods)
  if (shareUrl) lines.push(shareUrl)
  lines.push('来自 Food Link')
  return lines.join('\n')
}

function buildDayShareMessage(date: string, records: FoodRecord[]): string {
  const totalKcal = records.reduce((sum, record) => sum + Number(record.total_calories || 0), 0)
  const totalProtein = records.reduce((sum, record) => sum + Number(record.total_protein || 0), 0)
  const totalCarbs = records.reduce((sum, record) => sum + Number(record.total_carbs || 0), 0)
  const totalFat = records.reduce((sum, record) => sum + Number(record.total_fat || 0), 0)
  const lines = [
    `${date} 饮食记录 · ${Math.round(totalKcal)} kcal`,
    `蛋白质 ${round1(totalProtein)}g · 碳水 ${round1(totalCarbs)}g · 脂肪 ${round1(totalFat)}g`,
    `共 ${records.length} 条记录`,
  ]
  records.slice(0, 8).forEach((record) => {
    const name = String(record.description || record.items?.map((item) => item.name).join('、') || '饮食记录').trim()
    lines.push(`- ${getMealTypeLabel(record.meal_type)} ${Math.round(record.total_calories || 0)} kcal ${name}`)
  })
  lines.push('来自 Food Link')
  return lines.join('\n')
}

const dietGoalLabels: Record<string, string> = {
  fat_loss: '减脂期',
  muscle_gain: '增肌期',
  maintain: '维持体重',
  none: '无特殊目标',
}

const activityTimingLabels: Record<string, string> = {
  post_workout: '练后',
  daily: '日常',
  before_sleep: '睡前',
  none: '无',
}

const recordNutrientMeta: Array<{ key: string; label: string; unit: string; altKey?: string }> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'sodiumMg', altKey: 'sodium_mg', label: '钠', unit: 'mg' },
  { key: 'potassiumMg', altKey: 'potassium_mg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', altKey: 'calcium_mg', label: '钙', unit: 'mg' },
  { key: 'ironMg', altKey: 'iron_mg', label: '铁', unit: 'mg' },
]

function formatDisplayNumber(value: unknown): string {
  const n = numberFrom(value, 0)
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function formatDayRecordDate(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(date.getTime())) return dateStr
  const month = date.getMonth() + 1
  const day = date.getDate()
  const today = todayKey()
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = todayKey(yesterdayDate)
  if (dateStr === today) return `${month}月${day}日 今天`
  if (dateStr === yesterday) return `${month}月${day}日 昨天`
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${month}月${day}日 ${weekdays[date.getDay()]}`
}

function formatRecordClock(recordTime?: string | null): string {
  const date = new Date(recordTime || '')
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatRecordDetailTime(recordTime?: string | null): string {
  const date = new Date(recordTime || '')
  if (Number.isNaN(date.getTime())) return '--'
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}月${day}日 ${formatRecordClock(recordTime)}`
}

function sortFoodRecordsByTime(records: FoodRecord[]): FoodRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const left = new Date(a.record.record_time || '').getTime()
      const right = new Date(b.record.record_time || '').getTime()
      const leftTime = Number.isFinite(left) ? left : Number.POSITIVE_INFINITY
      const rightTime = Number.isFinite(right) ? right : Number.POSITIVE_INFINITY
      if (leftTime !== rightTime) return leftTime - rightTime
      return a.index - b.index
    })
    .map(({ record }) => record)
}

function foodRecordItemRowPayload(item: FoodRecord['items'][number]): FoodRecordItemPayload {
  return editableRecordItemPayload(editableRecordItemFromRow(item))
}

function summarizeFoodRecordRows(items: FoodRecord['items']): {
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
} {
  return {
    total_calories: round1(items.reduce((sum, item) => sum + recordItemKcal(item), 0)),
    total_protein: round1(items.reduce((sum, item) => sum + recordItemMacro(item, 'protein'), 0)),
    total_carbs: round1(items.reduce((sum, item) => sum + recordItemMacro(item, 'carbs'), 0)),
    total_fat: round1(items.reduce((sum, item) => sum + recordItemMacro(item, 'fat'), 0)),
    total_weight_grams: round1(items.reduce((sum, item) => sum + recordItemIntake(item), 0)),
  }
}

function recordExtraText(record: FoodRecord, key: string): string {
  return String((record as FoodRecord & Record<string, unknown>)[key] || '').trim()
}

function recordContextTags(record: FoodRecord): Array<{ label: string; icon: string; tone: 'goal' | 'timing' }> {
  const tags: Array<{ label: string; icon: string; tone: 'goal' | 'timing' }> = []
  if (record.diet_goal && record.diet_goal !== 'none') {
    tags.push({ label: dietGoalLabels[record.diet_goal] || record.diet_goal, icon: '↑', tone: 'goal' })
  }
  if (record.activity_timing && record.activity_timing !== 'none') {
    tags.push({ label: activityTimingLabels[record.activity_timing] || record.activity_timing, icon: '时', tone: 'timing' })
  }
  return tags
}

function recordDetailBlocks(record: FoodRecord): Array<{ title: string; icon: string; text: string }> {
  return [
    { title: '识别描述', icon: '食', text: String(record.description || '').trim() },
    { title: 'AI 健康建议', icon: '叶', text: String(record.insight || '').trim() },
    { title: 'PFC 比例分析', icon: '比', text: recordExtraText(record, 'pfc_ratio_comment') },
    { title: '吸收与利用', icon: '热', text: recordExtraText(record, 'absorption_notes') },
    { title: '情境建议', icon: '时', text: recordExtraText(record, 'context_advice') },
  ].filter((item) => item.text)
}

function recordItemWaterMl(item: FoodRecord['items'][number]): number {
  const water = numberFrom(item.water_ml ?? item.waterMl ?? item.nutrients?.water_ml ?? item.nutrients?.waterMl, 0)
  return water * recordItemRatio(item) / 100
}

function recordItemNutrientRows(item: FoodRecord['items'][number]): Array<{ key: string; label: string; value: number; unit: string }> {
  const ratio = recordItemRatio(item) / 100
  return recordNutrientMeta.map((meta) => ({
    key: meta.key,
    label: meta.label,
    value: numberFrom(item.nutrients?.[meta.key] ?? (meta.altKey ? item.nutrients?.[meta.altKey] : undefined), 0) * ratio,
    unit: meta.unit,
  }))
}

function mealToneStyles(mealType: MealType): {
  icon: any
  text: any
} {
  switch (mealType) {
    case 'breakfast':
      return { icon: styles.mealToneBreakfast, text: styles.mealToneBreakfastText }
    case 'morning_snack':
      return { icon: styles.mealToneMorningSnack, text: styles.mealToneMorningSnackText }
    case 'lunch':
      return { icon: styles.mealToneLunch, text: styles.mealToneLunchText }
    case 'afternoon_snack':
    case 'snack':
      return { icon: styles.mealToneAfternoonSnack, text: styles.mealToneAfternoonSnackText }
    case 'dinner':
      return { icon: styles.mealToneDinner, text: styles.mealToneDinnerText }
    case 'evening_snack':
      return { icon: styles.mealToneEveningSnack, text: styles.mealToneEveningSnackText }
    default:
      return { icon: styles.mealToneLunch, text: styles.mealToneLunchText }
  }
}

async function showShareRewardAlert(dialog: AppDialog, result: Awaited<ReturnType<typeof apiClient.claimSharePosterReward>>) {
  await dialog.alert('分享完成', result.message || (result.claimed ? `分享奖励 +${result.credits || 0} 积分` : '分享已完成'), 'success')
}

async function shareTextToSystem(title: string, message: string, url?: string): Promise<boolean> {
  const result = await Share.share({
    title,
    message,
    ...(url ? { url } : {}),
  })
  return result.action !== Share.dismissedAction
}

function getExpoSharingModule(): ExpoSharingModule | null {
  try {
    return require('expo-sharing') as ExpoSharingModule
  } catch {
    return null
  }
}

function getViewShotModule(): ViewShotModule | null {
  try {
    return require('react-native-view-shot') as ViewShotModule
  } catch {
    return null
  }
}

async function sharePosterImageToSystem(title: string, imageUri: string): Promise<boolean> {
  const sharing = getExpoSharingModule()
  if (!sharing?.isAvailableAsync || !sharing?.shareAsync) {
    throw new Error('当前安装包暂不支持分享图片文件，请更新到最新版 App')
  }
  const available = await sharing.isAvailableAsync()
  if (!available) {
    throw new Error('当前运行环境暂时不支持分享图片文件')
  }
  await sharing.shareAsync(imageUri, {
    dialogTitle: title,
    mimeType: 'image/png',
    UTI: 'public.png',
  })
  return true
}

function buildRecordShareTitle(record: FoodRecord): string {
  const calories = Math.round(record.total_calories || 0)
  const prefix = `${getMealTypeLabel(record.meal_type)}饮食记录`
  return calories > 0 ? `${prefix} · ${calories} kcal` : prefix
}

function buildRecordShareDescription(record: FoodRecord): string {
  const foods = (record.items || [])
    .map((item) => String(item.name || '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('、')
  const macros = `蛋白质 ${round1(record.total_protein || 0)}g · 碳水 ${round1(record.total_carbs || 0)}g · 脂肪 ${round1(record.total_fat || 0)}g`
  return foods ? `${foods}。${macros}` : macros
}

function nutrientNumber(nutrients: Nutrients | undefined, key: keyof Nutrients): number {
  return numberFrom(nutrients?.[key], 0)
}

function recordItemRatio(item: FoodRecord['items'][number]): number {
  return clampPercent(item.ratio == null ? 100 : item.ratio)
}

function recordItemIntake(item: FoodRecord['items'][number]): number {
  const intake = numberFrom(item.intake, 0)
  if (intake > 0) return intake
  return numberFrom(item.weight, 0) * recordItemRatio(item) / 100
}

function recordItemMacro(item: FoodRecord['items'][number], key: keyof Nutrients): number {
  return nutrientNumber(item.nutrients, key) * recordItemRatio(item) / 100
}

function recordItemKcal(item: FoodRecord['items'][number]): number {
  return recordItemMacro(item, 'calories')
}

function editableRecordItemFromRow(item: FoodRecord['items'][number]): EditableRecordItem {
  return {
    name: item.name || '',
    weight: numberField(item.weight),
    ratio: numberField(recordItemRatio(item)) || '100',
    calories: numberField(item.nutrients?.calories),
    protein: numberField(item.nutrients?.protein),
    carbs: numberField(item.nutrients?.carbs),
    fat: numberField(item.nutrients?.fat),
    fiber: numberField(item.nutrients?.fiber),
    sugar: numberField(item.nutrients?.sugar),
    waterMl: numberField(item.water_ml ?? item.waterMl ?? item.nutrients?.water_ml ?? item.nutrients?.waterMl),
    sodiumMg: numberField(item.nutrients?.sodium_mg ?? item.nutrients?.sodiumMg),
    source: item,
  }
}

function editableItemRatio(item: EditableRecordItem): number {
  return clampPercent(item.ratio.trim() === '' ? 100 : item.ratio)
}

function editableItemWeight(item: EditableRecordItem): number {
  return Math.max(0, numberFrom(item.weight, 0))
}

function editableItemIntake(item: EditableRecordItem): number {
  return editableItemWeight(item) * editableItemRatio(item) / 100
}

function editableItemScaledNutrient(item: EditableRecordItem, key: keyof Nutrients): number {
  const raw: Partial<Record<keyof Nutrients, string>> = {
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    fiber: item.fiber,
    sugar: item.sugar,
  }
  return numberFrom(raw[key], 0) * editableItemRatio(item) / 100
}

function summarizeEditableRecordItems(items: EditableRecordItem[]): {
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
} {
  return {
    total_calories: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'calories'), 0)),
    total_protein: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'protein'), 0)),
    total_carbs: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'carbs'), 0)),
    total_fat: round1(items.reduce((sum, item) => sum + editableItemScaledNutrient(item, 'fat'), 0)),
    total_weight_grams: round1(items.reduce((sum, item) => sum + editableItemIntake(item), 0)),
  }
}

function compactString(value: unknown): string | undefined {
  const text = String(value || '').trim()
  return text || undefined
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function editableRecordItemPayload(item: EditableRecordItem): FoodRecordItemPayload {
  const source = item.source
  const waterMl = numberFrom(item.waterMl, 0)
  const sodiumMg = numberFrom(item.sodiumMg, 0)
  const nutrients: Nutrients = {
    ...(source.nutrients || {}),
    calories: numberFrom(item.calories, 0),
    protein: numberFrom(item.protein, 0),
    carbs: numberFrom(item.carbs, 0),
    fat: numberFrom(item.fat, 0),
    fiber: numberFrom(item.fiber, 0),
    sugar: numberFrom(item.sugar, 0),
    waterMl,
    water_ml: waterMl,
    sodiumMg,
    sodium_mg: sodiumMg,
  }

  return {
    name: item.name.trim() || source.name || '未命名食物',
    weight: editableItemWeight(item),
    ratio: editableItemRatio(item),
    intake: editableItemIntake(item),
    image_path: compactString(source.image_path),
    image_paths: Array.isArray(source.image_paths) ? source.image_paths.filter(Boolean) : undefined,
    gross_weight_grams: positiveNumberOrUndefined(source.gross_weight_grams),
    edible_portion_ratio: positiveNumberOrUndefined(source.edible_portion_ratio),
    edible_portion_reason: compactString(source.edible_portion_reason),
    edible_portion_source: compactString(source.edible_portion_source),
    suggested_ratio: positiveNumberOrUndefined(source.suggested_ratio),
    suggested_ratio_reason: compactString(source.suggested_ratio_reason),
    suggested_ratio_source: compactString(source.suggested_ratio_source),
    water_ml: waterMl,
    nutrition_source: source.nutrition_source ?? undefined,
    nutrition_source_category: source.nutrition_source_category ?? undefined,
    matched_food_id: source.matched_food_id ?? undefined,
    packaged_food_id: compactString(source.packaged_food_id),
    package_match_status: compactString(source.package_match_status),
    package_match_confidence: positiveNumberOrUndefined(source.package_match_confidence),
    package_weight_source: compactString(source.package_weight_source),
    package_weight_applied: boolOrUndefined(source.package_weight_applied),
    package_weight_reason: compactString(source.package_weight_reason),
    packaged_candidates: source.packaged_candidates,
    nutrients,
    manual_source: source.manual_source,
    manual_source_id: compactString(source.manual_source_id),
    manual_source_title: compactString(source.manual_source_title),
    manual_portion_label: compactString(source.manual_portion_label),
  }
}

function getWaterLogItems(day: BodyMetricsSummary['today_water'] | null | undefined): Array<{ id?: string; amount_ml: number; recorded_at?: string | null }> {
  if (!day) return []
  if (Array.isArray(day.log_items)) return day.log_items
  if (Array.isArray(day.logs)) {
    return day.logs.map((amount, index) => ({
      id: undefined,
      amount_ml: Number(amount) || 0,
      recorded_at: `${day.date}-${index}`,
    }))
  }
  return []
}

function normalizeRouteDate(value?: string): string {
  const raw = String(value || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  return todayKey()
}

function stringFrom(value: unknown): string {
  return value == null ? '' : String(value)
}

async function showError(dialog: AppDialog, title: string, error: unknown) {
  await dialog.alert(title, userFacingErrorMessage(error), 'danger')
}

function taskStatusLabel(status: AnalysisTask['status']): string {
  const labels: Record<string, string> = {
    pending: '排队',
    queued: '排队',
    running: '识别',
    processing: '识别',
    done: '完成',
    failed: '失败',
    violated: '未通过',
    timed_out: '超时',
    cancelled: '已取消',
  }
  return labels[status] || status
}

function exerciseTaskStatusLabel(status: string): string {
  return taskStatusLabel(status as AnalysisTask['status'])
}

function isTaskRunningStatus(status?: string): boolean {
  return ['pending', 'queued', 'running', 'processing'].includes(String(status || ''))
}

function exerciseTaskMessage(status: string): string {
  if (isTaskRunningStatus(status)) return '系统识别运动内容后会自动刷新当天记录。'
  if (status === 'done') return '分析已完成，页面已刷新当天运动记录。'
  if (['failed', 'violated', 'timed_out', 'cancelled'].includes(status)) return '本次分析没有完成，可以调整内容后重新提交，或稍后刷新结果。'
  return '可手动刷新查看最新结果。'
}

function exerciseTaskError(task: AnalysisTask): string {
  const raw = String(task.error_message || '').trim()
  if (!raw) return '运动分析失败'
  try {
    const parsed = JSON.parse(raw) as { message?: string }
    if (parsed.message) return userFacingMessage(parsed.message, '运动分析失败')
  } catch {
    // Plain text errors are sanitized below.
  }
  return userFacingMessage(raw, '运动分析失败')
}

function isTextAnalysisTask(task: AnalysisTask): boolean {
  if (task.task_type === 'food_text') return true
  return task.payload?.source_type === 'text'
}

function analyzeHistoryPayloadValue(task: AnalysisTask, ...keys: string[]): unknown {
  const payload = task.payload || {}
  for (const key of keys) {
    const value = payload[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function analyzeHistoryMealType(task: AnalysisTask): MealType {
  const value = String(analyzeHistoryPayloadValue(task, 'meal_type', 'mealType') || '')
  if (value === 'snack') return 'afternoon_snack'
  return mealOptions.includes(value as MealType) ? (value as MealType) : inferDefaultMealTypeFromLocalTime()
}

function analyzeHistoryDate(task: AnalysisTask): string {
  const value = String(analyzeHistoryPayloadValue(task, 'date', 'recorded_on', 'recordedOn') || '').trim()
  return value || todayKey()
}

function isPackagedAnalyzeHistoryTask(task: AnalysisTask): boolean {
  const taskType = String(task.task_type || '')
  return taskType.startsWith('packaged') || taskType.includes('packaged_food') || taskType.includes('nutrition_label')
}

function isVisibleAnalyzeHistoryTask(task: AnalysisTask): boolean {
  const taskType = String(task.task_type || '')
  const payload = task.payload || {}
  if (payload.expiry_recognition || payload.exercise) return false
  if (taskType === 'exercise' || taskType.startsWith('exercise')) return false
  if (taskType === 'health_report' || taskType === 'public_food_library_text') return false
  if (isPackagedAnalyzeHistoryTask(task)) return true
  if (taskType === 'food' || taskType.startsWith('food_')) return true
  if (taskType === 'food_text' || taskType.startsWith('food_text')) return true
  if (taskType.startsWith('precision_')) return true
  return false
}

async function findFoodRecordForAnalyzeTask(task: AnalysisTask): Promise<FoodRecord | null> {
  const recordId = String(task.record_id || '').trim()
  if (recordId) {
    const data = await apiClient.getFoodRecordById(recordId)
    return data.record
  }
  if (task.is_recorded !== true) return null
  const data = await apiClient.getFoodRecordList(analyzeHistoryDate(task))
  return (data.records || []).find((record) => String(record.source_task_id || '').trim() === task.id) || null
}

function isAnalyzeRetryable(task: AnalysisTask): boolean {
  if (isPackagedAnalyzeHistoryTask(task)) return false
  const status = String(task.status || '')
  return status === 'failed' || status === 'timed_out'
}

function analyzeHistoryImageUrl(task: AnalysisTask): string {
  const primary = String(task.image_url || '').trim()
  if (primary) return primary
  const imagePaths = Array.isArray(task.image_paths) ? task.image_paths : []
  return String(imagePaths[0] || '').trim()
}

function analyzeHistoryDisplayText(value: unknown): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized.includes('%')) return normalized
  try {
    return decodeURIComponent(normalized).replace(/\s+/g, ' ').trim() || normalized
  } catch {
    return normalized
  }
}

function analyzeHistoryTitle(task: AnalysisTask): string {
  if (task.status === 'violated') return '内容未通过审核'
  if (isTextAnalysisTask(task)) {
    const text = analyzeHistoryDisplayText(task.text_input)
    return text || '文字记录'
  }
  const result = (task.result || {}) as Record<string, any>
  const packaged = (result.packaged_product || result.nutrition || {}) as Record<string, any>
  if (isPackagedAnalyzeHistoryTask(task)) {
    return String(packaged.product_name || packaged.name || '包装食品识别').trim()
  }
  const firstItem = task.result?.items?.[0]?.name?.trim()
  if (firstItem) return firstItem
  const description = String(task.result?.description || '').trim()
  if (description) return description.slice(0, 24)
  return task.status === 'done' ? '饮食分析结果' : '图片记录'
}

function analyzeHistoryAvatarText(task: AnalysisTask): string {
  if (isPackagedAnalyzeHistoryTask(task)) return '包'
  if (!isTextAnalysisTask(task)) return '图'
  const text = analyzeHistoryDisplayText(task.text_input).replace(/\s+/g, '')
  return text ? text.slice(0, Math.min(2, text.length)) : '文'
}

function analyzeHistoryStatusLabel(task: AnalysisTask): string {
  const status = String(task.status || '')
  if (status === 'pending' || status === 'queued' || status === 'processing' || status === 'running') return '识别'
  if (status === 'done') {
    if (task.is_recorded === true) return '已经记录'
    if (task.is_recorded === false) return '等待记录'
    return '已完成'
  }
  if (status === 'failed' || status === 'timed_out') return '点我重试'
  if (status === 'violated') return '未通过'
  if (status === 'cancelled') return '已取消'
  return taskStatusLabel(task.status)
}

function analyzeHistoryCalories(task: AnalysisTask): number {
  const total = numberFrom(task.result?.total_calories, 0)
  if (total > 0) return total
  return (task.result?.items || []).reduce((sum, item) => sum + numberFrom(item.nutrients?.calories, 0), 0)
}

function analyzeHistoryMeta(task: AnalysisTask): string {
  const status = String(task.status || '')
  if (status === 'violated') return userFacingMessage(task.error_message, '该记录因内容问题不可查看')
  if (status === 'failed' || status === 'timed_out') return '识别没有成功 · 可用原内容重新识别'
  const kind = isPackagedAnalyzeHistoryTask(task) ? '包装食品' : isTextAnalysisTask(task) ? '文字记录' : '图片记录'
  const count = task.result?.items?.length || 0
  const calories = analyzeHistoryCalories(task)
  const parts = [formatDateTime(task.created_at), kind]
  if (count > 0) parts.push(`${count} 项食物`)
  if (calories > 0) parts.push(`${Math.round(calories)} kcal`)
  return parts.filter(Boolean).join(' · ')
}

function analyzeHistoryCompactMeta(task: AnalysisTask): string {
  const status = String(task.status || '')
  if (status === 'failed' || status === 'timed_out') return '识别没有成功，可用原内容重新识别'
  if (status === 'violated') return '内容审核未通过'
  const kind = isPackagedAnalyzeHistoryTask(task) ? '包装食品' : isTextAnalysisTask(task) ? '文字记录' : '图片记录'
  const count = task.result?.items?.length || 0
  const parts = [kind]
  if (count > 0) parts.push(`${count} 项食物`)
  if (task.is_recorded === true) parts.push('已写入饮食记录')
  if (task.is_recorded === false && status === 'done') parts.push('等待记录')
  return parts.join(' · ')
}

function analyzeHistoryModeLabel(task: AnalysisTask): string {
  const taskAny = task as AnalysisTask & { execution_mode?: unknown }
  const raw = String(taskAny.execution_mode || analyzeHistoryPayloadValue(task, 'execution_mode', 'executionMode') || '').trim()
  if (!raw) return ''
  if (raw.includes('packaged')) return '零食识别'
  if (raw.includes('strict') || raw.includes('gemini35')) {
    if (raw.includes('web_search')) return '精准联网'
    if (raw.includes('separate') || raw.includes('grouped')) return '精准分项'
    return '精准模式'
  }
  if (raw.includes('fast')) return raw.includes('web_search') ? '快速联网' : '快速模式'
  if (raw.includes('web_search')) return '联网校准'
  return ''
}

function analyzeHistoryStatusTone(task: AnalysisTask) {
  const status = String(task.status || '')
  if (status === 'pending' || status === 'queued' || status === 'processing' || status === 'running') {
    return { style: styles.analyzeHistoryStatusProcessing, color: '#2563eb' }
  }
  if (status === 'done') {
    if (task.is_recorded === true) return { style: styles.analyzeHistoryStatusRecorded, color: '#00bc7d' }
    if (task.is_recorded === false) return { style: styles.analyzeHistoryStatusWaiting, color: '#d97706' }
    return { style: styles.analyzeHistoryStatusDone, color: '#00bc7d' }
  }
  if (status === 'failed' || status === 'timed_out') return { style: styles.analyzeHistoryStatusRetry, color: '#c2410c' }
  if (status === 'violated') return { style: styles.analyzeHistoryStatusFailed, color: '#c53030' }
  return { style: styles.analyzeHistoryStatusDefault, color: '#4b5563' }
}

function notificationTabApiType(tab: NotificationTab): string | undefined {
  if (tab === 'like') return 'like_received'
  if (tab === 'comment') return 'comment_received'
  return undefined
}

function notificationMatchesTab(item: CommunityNotificationItem, tab: NotificationTab): boolean {
  if (tab === 'all') return true
  const type = notificationType(item)
  if (tab === 'like') return type === 'like_received' || type.includes('like')
  return type === 'comment_received' || type === 'reply_received' || type === 'comment_rejected'
}

function notificationEmptyText(tab: NotificationTab): string {
  if (tab === 'like') return '暂无点赞'
  if (tab === 'comment') return '暂无评论'
  return '暂无互动消息'
}

function notificationTitle(item: CommunityNotificationItem): string {
  const actor = item.actor?.nickname || '有人'
  const type = notificationType(item)
  if (type === 'like_received' || type.includes('like')) return `${actor}赞了你的动态`
  if (type === 'comment_received') return `${actor}评论了你的动态`
  if (type === 'reply_received') return `${actor}回复了你的评论`
  if (type === 'comment_rejected') return '你的评论未通过审核'
  return '你收到一条互动消息'
}

function notificationContent(item: CommunityNotificationItem): string {
  if (notificationType(item) === 'comment_rejected') {
    return item.content_preview || '系统拦截了一条评论，点击查看详情'
  }
  return item.content_preview || '点击查看详情'
}

function notificationTimeLabel(value?: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  const diff = Date.now() - parsed.getTime()
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 1000)))}分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 60 * 1000)))}小时前`
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${hours}:${minutes}`
}

function notificationType(item: CommunityNotificationItem): string {
  return String(item.notification_type || '').trim().toLowerCase()
}

function notificationTargetId(item: CommunityNotificationItem): string {
  return String(item.target_id || item.record_id || '').trim()
}

function notificationTargetType(item: CommunityNotificationItem): CommunityFeedTargetType {
  const raw = String(item.target_type || 'food_record').trim()
  return (raw || 'food_record') as CommunityFeedTargetType
}

function notificationAvatarText(item: CommunityNotificationItem): string {
  const actor = item.actor?.nickname?.trim()
  if (actor) return actor.slice(0, 1)
  if (notificationType(item) === 'comment_rejected') return '审'
  return '信'
}

function friendUserSubtitle(user: FriendUserItem): string {
  if (user.is_friend) return '已在好友列表'
  if (user.is_pending) return '好友请求已发送'
  return '可发送好友请求'
}

function friendUserId(user: FriendUserItem): string {
  return String(user.id || '').trim()
}

function friendDisplayName(user: FriendUserItem): string {
  return String(user.nickname || '').trim() || '用户'
}

function friendBlockUserId(user: FriendBlockItem): string {
  return String(user.blocked_user_id || user.id || '').trim()
}

function friendBlockDisplayName(user: FriendBlockItem): string {
  return String(user.nickname || '').trim() || '用户'
}

function friendRequestStatus(input?: string | FriendRequestItem): string {
  const status = typeof input === 'string' ? input : input?.status
  return String(status || 'pending').trim().toLowerCase() || 'pending'
}

function friendRequestStatusLabel(status?: string | FriendRequestItem): string {
  const labels: Record<string, string> = {
    pending: '等待对方处理',
    accepted: '已通过',
    rejected: '已拒绝',
    canceled: '已取消',
    cancelled: '已取消',
    expired: '已过期',
  }
  return labels[friendRequestStatus(status)] || '等待对方处理'
}

function friendRequestUserId(request: FriendRequestItem): string {
  return String(request.counterpart_user_id || request.from_user_id || request.to_user_id || '').trim()
}

function friendRequestDisplayName(request: FriendRequestItem): string {
  return String(request.counterpart_nickname || request.from_nickname || '').trim() || '用户'
}

function friendRequestAvatar(request: FriendRequestItem): string | undefined {
  return String(request.counterpart_avatar || request.from_avatar || '').trim() || undefined
}

function friendRequestTimeLabel(request: FriendRequestItem): string {
  return request.created_at ? formatDateTime(request.created_at) : ''
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  pressed: {
    opacity: 0.72,
  },
  foodShareBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  foodShareSheet: {
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#f8fafc',
    paddingTop: 10,
    paddingHorizontal: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  foodShareHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#d1d5db',
    marginBottom: 12,
  },
  foodShareHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foodShareHeaderSpacer: {
    width: 38,
  },
  foodShareTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#111827',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  foodShareCloseButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
  },
  foodShareGrid: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    rowGap: 16,
    paddingBottom: 2,
  },
  foodShareDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginTop: 16,
  },
  foodShareAction: {
    width: 78,
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  foodShareActionPressed: {
    opacity: 0.72,
  },
  foodShareActionDisabled: {
    opacity: 0.5,
  },
  foodShareActionIcon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  foodShareActionText: {
    marginTop: 9,
    color: '#4b5563',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  foodPosterBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.54)',
  },
  foodPosterSheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#f8fafc',
    paddingTop: 14,
    paddingHorizontal: 16,
  },
  foodPosterHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 4,
  },
  foodPosterHeaderTitle: {
    color: '#111827',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  foodPosterScroll: {
    marginTop: 6,
  },
  foodPosterScrollContent: {
    alignItems: 'center',
    paddingBottom: 14,
  },
  foodPosterCard: {
    width: 375,
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: '#f9f7f2',
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  foodPosterImageWrap: {
    height: 280,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
  },
  foodPosterImage: {
    width: '100%',
    height: '100%',
  },
  foodPosterImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8ece7',
  },
  foodPosterImageFallbackText: {
    color: '#94a3b8',
    fontSize: 32,
    lineHeight: 42,
    fontWeight: '900',
  },
  foodPosterImageScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  foodPosterMealBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    minWidth: 44,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  foodPosterMealBadgeText: {
    color: '#0f172a',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  foodPosterDateRow: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  foodPosterDateDay: {
    color: '#ffffff',
    fontSize: 40,
    lineHeight: 45,
    fontWeight: '900',
  },
  foodPosterDateMonth: {
    marginBottom: 6,
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
  },
  foodPosterBody: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 30,
  },
  foodPosterCalorieRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  foodPosterCalorieTextRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minWidth: 0,
    flexShrink: 1,
  },
  foodPosterCalories: {
    color: '#0f172a',
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '900',
  },
  foodPosterCaloriesUnit: {
    marginBottom: 7,
    color: '#64748b',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  foodPosterDotsChip: {
    marginTop: 8,
    minWidth: 68,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.12)',
    backgroundColor: '#e5c68d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },
  foodPosterDotOuter: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.35,
    borderColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodPosterDotInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#111827',
  },
  foodPosterMacroLabels: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  foodPosterMacroSide: {
    width: 92,
    alignItems: 'flex-start',
  },
  foodPosterMacroCenter: {
    width: 92,
    alignItems: 'center',
  },
  foodPosterMacroSideRight: {
    alignItems: 'flex-end',
  },
  foodPosterMacroName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  foodPosterMacroProtein: {
    color: '#3b82f6',
  },
  foodPosterMacroCarbs: {
    color: '#eab308',
  },
  foodPosterMacroFat: {
    color: '#f97316',
  },
  foodPosterMacroValue: {
    marginTop: 2,
    color: '#0f172a',
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
  },
  foodPosterMacroBar: {
    marginTop: 8,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    flexDirection: 'row',
  },
  foodPosterMacroBarSegment: {
    height: '100%',
  },
  foodPosterMacroBarProtein: {
    backgroundColor: '#3b82f6',
  },
  foodPosterMacroBarCarbs: {
    backgroundColor: '#eab308',
  },
  foodPosterMacroBarFat: {
    backgroundColor: '#f97316',
  },
  foodPosterDivider: {
    marginTop: 32,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  foodPosterItems: {
    marginTop: 20,
  },
  foodPosterItemRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  foodPosterItemNameWrap: {
    flex: 1,
    minWidth: 0,
  },
  foodPosterItemName: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  foodPosterItemRatio: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  foodPosterItemMeta: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  foodPosterOverflowText: {
    marginTop: 6,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  foodPosterFooter: {
    marginTop: 43,
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
  },
  foodPosterQrOuter: {
    width: 76,
    height: 76,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4d4d4',
    padding: 4,
    backgroundColor: '#ffffff',
  },
  foodPosterQrMatrix: {
    flex: 1,
  },
  foodPosterQrRow: {
    flex: 1,
    flexDirection: 'row',
  },
  foodPosterQrCell: {
    flex: 1,
  },
  foodPosterQrCellDark: {
    backgroundColor: '#0f172a',
  },
  foodPosterQrCellLight: {
    backgroundColor: '#ffffff',
  },
  foodPosterFooterAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dbece5',
  },
  foodPosterFooterAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dbece5',
  },
  foodPosterFooterAvatarInitial: {
    color: '#2f6b55',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  foodPosterFooterText: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 12,
    paddingRight: 12,
  },
  foodPosterFooterTitle: {
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  foodPosterFooterHint: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  foodPosterActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 4,
  },
  foodPosterActionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  foodPosterActionText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  foodPosterSecondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  foodPosterSecondaryText: {
    color: colors.brand,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  dayRecordPage: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  dayRecordTopWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 132,
    backgroundColor: '#f6fbf8',
  },
  dayRecordScroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  dayRecordContent: {
    paddingBottom: 28,
  },
  dayRecordTop: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dayRecordDateLine: {
    flex: 1,
    minWidth: 0,
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
  },
  dayRecordShareButton: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 188, 125, 0.1)',
  },
  dayRecordShareIcon: {
    color: colors.brand,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  dayRecordShareText: {
    color: colors.brand,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  dayRecordSummary: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  dayRecordSummaryCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 11,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  dayRecordSummaryLabel: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  dayRecordSummaryValue: {
    marginTop: 4,
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  dayRecordState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRecordEmpty: {
    minHeight: 270,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRecordEmptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.14)',
    marginBottom: 14,
  },
  dayRecordEmptyIconText: {
    color: colors.brand,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
  },
  dayRecordEmptyTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  dayRecordEmptyDesc: {
    marginTop: 8,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  dayRecordEmptyButton: {
    marginTop: 18,
    minWidth: 114,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  dayRecordEmptyButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  dayRecordList: {
    paddingHorizontal: 16,
  },
  dayRecordCard: {
    marginBottom: 10,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.98)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  dayRecordCardPressed: {
    opacity: 0.86,
  },
  dayRecordCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  dayRecordCardMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayRecordThumb: {
    position: 'relative',
    width: 56,
    height: 56,
    borderRadius: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  dayRecordThumbPlaceholder: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
  },
  dayRecordThumbImage: {
    width: '100%',
    height: '100%',
  },
  dayRecordThumbBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.74)',
  },
  dayRecordThumbBadgePlaceholder: {
    backgroundColor: 'rgba(100, 116, 139, 0.76)',
  },
  dayRecordThumbBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
  },
  dayRecordMealIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRecordMealIconText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  mealToneBreakfast: {
    backgroundColor: '#ffedd4',
  },
  mealToneBreakfastText: {
    color: '#ff6900',
  },
  mealToneMorningSnack: {
    backgroundColor: '#ede9fe',
  },
  mealToneMorningSnackText: {
    color: '#7b61ff',
  },
  mealToneLunch: {
    backgroundColor: '#dcfce7',
  },
  mealToneLunchText: {
    color: '#00a865',
  },
  mealToneAfternoonSnack: {
    backgroundColor: '#f3e8ff',
  },
  mealToneAfternoonSnackText: {
    color: '#ad46ff',
  },
  mealToneDinner: {
    backgroundColor: '#dbeafe',
  },
  mealToneDinnerText: {
    color: '#2b7fff',
  },
  mealToneEveningSnack: {
    backgroundColor: '#ede9fe',
  },
  mealToneEveningSnackText: {
    color: '#5b21b6',
  },
  dayRecordCardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  dayRecordCardName: {
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  dayRecordCardTime: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
  },
  dayRecordCardActions: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayRecordCardCalorie: {
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  dayRecordDeleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRecordFoodList: {
    marginTop: 4,
  },
  dayRecordFoodItem: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  dayRecordFoodMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayRecordFoodName: {
    flexShrink: 1,
    color: '#1e293b',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  dayRecordFoodAmount: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    backgroundColor: '#f8fafc',
  },
  dayRecordFoodRatio: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    backgroundColor: '#f8fafc',
  },
  dayRecordFoodSide: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  dayRecordFoodCalorie: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  dayRecordFoodDelete: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  dayRecordFoodMacros: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 3,
  },
  dayRecordFoodMacro: {
    color: '#1e293b',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  dayRecordFoodProtein: {
    color: '#5c9ed4',
  },
  dayRecordFoodCarbs: {
    color: '#00bc7d',
  },
  dayRecordFoodFat: {
    color: '#ff6900',
  },
  dayRecordMacroFooter: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  dayRecordMacroFooterText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  recordDetailRoot: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  recordDetailScroll: {
    flex: 1,
  },
  recordDetailContent: {
    paddingHorizontal: 12,
    paddingBottom: 36,
  },
  recordDetailLoading: {
    minHeight: 480,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDetailEmpty: {
    minHeight: 480,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  recordDetailEmptyText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '700',
  },
  recordDetailBody: {
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  recordDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  recordDetailMealBadge: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordDetailMealIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDetailMealIconText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  recordDetailMealText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  recordDetailMealName: {
    color: '#1e293b',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
  recordDetailMealTime: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
  recordDetailCalorieBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 0,
  },
  recordDetailCalorie: {
    color: colors.brand,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '900',
  },
  recordDetailCalorieUnit: {
    marginLeft: 3,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  recordDetailImage: {
    width: '100%',
    height: 190,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: '#f8fafc',
  },
  recordDetailHeroImage: {
    width: '100%',
    height: '100%',
  },
  recordDetailImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#d1fae5',
  },
  recordDetailImageIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  recordDetailImageIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  recordDetailImageHint: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
  recordDetailContextTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  recordDetailContextTag: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recordDetailGoalTag: {
    backgroundColor: '#d1fae5',
  },
  recordDetailTimingTag: {
    backgroundColor: '#dbeafe',
  },
  recordDetailContextTagIcon: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  recordDetailContextTagText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  recordDetailGoalTagText: {
    color: '#047857',
  },
  recordDetailTimingTagText: {
    color: '#1e40af',
  },
  recordDetailInfoBlock: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  recordDetailInfoTitle: {
    color: '#1e293b',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 6,
  },
  recordDetailInfoText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 25,
  },
  recordDetailActions: {
    paddingTop: 10,
    gap: 10,
  },
  recordDetailSecondaryAction: {
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  recordDetailSecondaryActionText: {
    color: '#1e293b',
    fontSize: 15,
    fontWeight: '800',
  },
  recordDetailPrimaryAction: {
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  recordDetailPrimaryActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  recordDetailActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  recordDetailPlainAction: {
    flex: 1,
    minHeight: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  recordDetailPlainActionText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  recordDetailDangerActionText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '800',
  },
  recordDetailFoodTitle: {
    marginTop: 10,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    color: '#1e293b',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  recordDetailFoodItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  recordDetailFoodInfo: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  recordDetailFoodName: {
    color: '#1e293b',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  recordDetailFoodMeta: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
  recordDetailRatioBadge: {
    alignSelf: 'flex-start',
    minHeight: 28,
    borderRadius: 8,
    paddingHorizontal: 8,
    justifyContent: 'center',
    backgroundColor: '#f5f3ff',
  },
  recordDetailRatioText: {
    color: '#7c3aed',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  recordDetailFoodNutrients: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  recordDetailFoodNutrient: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
  },
  recordDetailNutrientToggle: {
    alignSelf: 'flex-start',
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recordDetailNutrientToggleText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  recordDetailNutrientToggleIcon: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '800',
  },
  recordDetailNutrientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  recordDetailNutrientCell: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 8,
    paddingVertical: 7,
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  recordDetailNutrientLabel: {
    color: '#64748b',
    fontSize: 10,
    lineHeight: 13,
  },
  recordDetailNutrientValue: {
    marginTop: 3,
    color: '#1e293b',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  recordDetailNutrientUnit: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  recordDetailFoodCalories: {
    flexShrink: 0,
    alignItems: 'flex-end',
    paddingTop: 2,
  },
  recordDetailFoodCalorieText: {
    color: colors.brand,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  recordDetailEmptyLine: {
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDetailEmptyLineText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '700',
  },
  recordDetailSummarySection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  recordDetailSummaryTitle: {
    color: '#1e293b',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  recordDetailSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recordDetailSummaryItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 8,
  },
  recordDetailSummaryLabel: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
  },
  recordDetailSummaryValue: {
    color: '#1e293b',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  recordDetailSummaryValueHighlight: {
    color: colors.brand,
    fontSize: 18,
  },
  recordDetailSummaryUnit: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 12,
  },
  recordDetailEditPanel: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  recordDetailEditTitle: {
    color: '#1e293b',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
    marginBottom: 10,
  },
  recordDetailEditSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 8,
  },
  recordDetailEditItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 10,
    marginTop: 10,
    backgroundColor: '#f8fafc',
  },
  friendsPage: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  friendsTopWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: '#ecfdf5',
  },
  friendsScroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  friendsContent: {
    paddingBottom: 40,
  },
  friendsHeader: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: 'flex-end',
  },
  friendsRefreshButton: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 188, 125, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.14)',
  },
  friendsRefreshButtonActive: {
    opacity: 0.72,
  },
  friendsRefreshText: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '800',
  },
  friendsTabsWrapper: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  friendsTabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  friendsTabItem: {
    flex: 1,
    minHeight: 38,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 4,
  },
  friendsTabItemActive: {
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  friendsTabText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  friendsTabTextActive: {
    color: '#fff',
    fontWeight: '900',
  },
  friendsTabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#86efac',
  },
  friendsTabBadgeActive: {
    backgroundColor: '#fff',
  },
  friendsTabBadgeText: {
    color: '#166534',
    fontSize: 10,
    fontWeight: '900',
  },
  friendsTabBadgeTextActive: {
    color: colors.brand,
  },
  friendsListContainer: {
    paddingHorizontal: 16,
    gap: 10,
  },
  friendsSearchCard: {
    marginBottom: 12,
  },
  friendsSearchRow: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  friendsSearchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: '#0f172a',
    fontSize: 14,
  },
  friendsClearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  friendsStateCard: {
    minHeight: 86,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  friendsCard: {
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    marginBottom: 10,
  },
  friendsCardVertical: {
    paddingBottom: 12,
  },
  friendsCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  friendsInfoRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  friendsMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  friendsName: {
    color: '#1e293b',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  friendsSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
  },
  friendsActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  friendsCardFooterActions: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 23, 42, 0.05)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  friendsIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.24)',
  },
  friendsIconButtonDanger: {
    borderColor: 'rgba(239, 68, 68, 0.24)',
    backgroundColor: '#fff7f7',
  },
  friendsIconButtonDisabled: {
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  friendsTextActionButton: {
    minWidth: 54,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  friendsTextActionButtonDanger: {
    borderColor: '#fecaca',
  },
  friendsTextActionButtonDisabled: {
    opacity: 0.72,
  },
  friendsTextActionButtonText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '800',
  },
  friendsTextActionButtonDangerText: {
    color: '#ef4444',
  },
  friendsEmptyCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 52,
  },
  friendsEmptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 188, 125, 0.08)',
    marginBottom: 16,
    opacity: 0.7,
  },
  friendsEmptyTitle: {
    color: '#1e293b',
    fontSize: 16,
    fontWeight: '900',
  },
  friendsEmptySubtitle: {
    marginTop: 6,
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  friendsEmptyAction: {
    marginTop: 18,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  friendsEmptyActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  friendCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  friendInfoRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  friendActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    maxWidth: 172,
  },
  friendAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 188, 125, 0.14)',
  },
  friendAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 188, 125, 0.14)',
  },
  friendAvatarText: {
    color: colors.brandDark,
    fontSize: 18,
    fontWeight: '900',
  },
  historyTaskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  historyTaskThumb: {
    width: 62,
    height: 62,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  historyTaskThumbFallback: {
    width: 62,
    height: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  historyTaskThumbText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  historyTaskTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  historyTaskTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  analyzeHistoryPage: {
    flex: 1,
    backgroundColor: '#eef3f1',
  },
  analyzeHistorySearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: '#f6faf8',
  },
  analyzeHistorySearchInputWrap: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  analyzeHistorySearchInput: {
    flex: 1,
    minHeight: 40,
    paddingVertical: 0,
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '500',
  },
  analyzeHistorySearchClear: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#f3f4f6',
  },
  analyzeHistorySearchButton: {
    minWidth: 58,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.brand,
    paddingHorizontal: 14,
  },
  analyzeHistorySearchButtonDisabled: {
    opacity: 0.78,
  },
  analyzeHistorySearchButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  analyzeHistoryScroll: {
    flex: 1,
  },
  analyzeHistoryList: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 28,
  },
  analyzeHistoryLoading: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyzeHistoryEmptyCard: {
    minHeight: 240,
    marginTop: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  analyzeHistoryEmptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.16)',
  },
  analyzeHistoryEmptyTitle: {
    color: '#10211a',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  analyzeHistoryEmptyDesc: {
    marginTop: 8,
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  analyzeHistoryListHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  analyzeHistoryBulkDelete: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  analyzeHistoryBulkDeleteText: {
    color: '#2f7f62',
    fontSize: 12,
    fontWeight: '800',
  },
  analyzeHistoryTaskWrapper: {
    marginBottom: 10,
  },
  analyzeHistoryPressed: {
    opacity: 0.84,
  },
  analyzeHistoryTaskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 102,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.14)',
    backgroundColor: '#ffffff',
    padding: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  analyzeHistoryTaskCardViolated: {
    borderColor: '#f5d4d4',
    backgroundColor: '#fef8f8',
  },
  analyzeHistoryThumb: {
    width: 56,
    height: 56,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.2)',
  },
  analyzeHistoryThumbImage: {
    width: '100%',
    height: '100%',
  },
  analyzeHistoryThumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8f5e4',
  },
  analyzeHistoryThumbFallbackText: {
    backgroundColor: '#123327',
  },
  analyzeHistoryThumbText: {
    color: '#ecfff5',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'center',
    paddingHorizontal: 6,
  },
  analyzeHistoryBody: {
    flex: 1,
    minWidth: 0,
  },
  analyzeHistoryMainRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 8,
  },
  analyzeHistoryLeftContent: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  analyzeHistoryRightContent: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  analyzeHistoryHeadline: {
    color: '#10211a',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  analyzeHistoryCalories: {
    color: '#1f2937',
    fontSize: 22,
    lineHeight: 25,
    fontWeight: '900',
  },
  analyzeHistoryMeta: {
    color: '#4e6a5d',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  analyzeHistoryViolationReason: {
    color: '#c53030',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  analyzeHistoryTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  analyzeHistoryTime: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 16,
  },
  analyzeHistoryMiniTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  analyzeHistoryMiniTagText: {
    color: '#4b5563',
    fontSize: 10,
    fontWeight: '800',
  },
  analyzeHistoryModeTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    backgroundColor: '#ecfdf5',
  },
  analyzeHistoryModeTagText: {
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  analyzeHistoryStatusBadge: {
    minWidth: 68,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    backgroundColor: '#f3f4f6',
    borderColor: 'transparent',
  },
  analyzeHistoryStatusText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  analyzeHistoryStatusProcessing: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  analyzeHistoryStatusDone: {
    backgroundColor: '#d1fae5',
    borderColor: '#86efac',
  },
  analyzeHistoryStatusRecorded: {
    backgroundColor: '#d1fae5',
    borderColor: '#86efac',
  },
  analyzeHistoryStatusWaiting: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
  },
  analyzeHistoryStatusRetry: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  analyzeHistoryStatusFailed: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  analyzeHistoryStatusDefault: {
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
  },
  analyzeHistoryMoreButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  analyzeHistoryMenuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  analyzeHistoryMenuSheet: {
    borderRadius: 20,
    backgroundColor: '#ffffff',
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 20,
  },
  analyzeHistoryMenuHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    marginBottom: 12,
  },
  analyzeHistoryMenuTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  analyzeHistoryMenuSubtitle: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  analyzeHistoryMenuActions: {
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eef2f7',
    backgroundColor: '#ffffff',
  },
  analyzeHistoryMenuAction: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7',
  },
  analyzeHistoryMenuActionPressed: {
    backgroundColor: '#f8fafc',
  },
  analyzeHistoryMenuActionDisabled: {
    opacity: 0.42,
  },
  analyzeHistoryMenuActionIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(92, 184, 150, 0.12)',
  },
  analyzeHistoryMenuActionIconDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  analyzeHistoryMenuActionCopy: {
    flex: 1,
    minWidth: 0,
  },
  analyzeHistoryMenuActionText: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  analyzeHistoryMenuActionTextDanger: {
    color: '#ef4444',
  },
  analyzeHistoryMenuActionHint: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  analyzeHistoryMenuCancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
  },
  analyzeHistoryMenuCancelText: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  manualRecordPage: {
    flex: 1,
    backgroundColor: '#eef6f3',
  },
  manualRecordContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 32,
  },
  manualRecordContentWithBar: {
    paddingBottom: 180,
  },
  manualWorkspaceCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.14)',
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  manualWorkspaceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  manualWorkspaceTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  manualWorkspaceSubtitle: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
  },
  manualWorkspaceCalories: {
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.14)',
    backgroundColor: '#f4faf8',
  },
  manualWorkspaceCaloriesValue: {
    color: '#5cb896',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 26,
  },
  manualWorkspaceCaloriesUnit: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
  },
  manualMealGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  manualMealItem: {
    width: '31.7%',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  manualMealItemActive: {
    borderColor: '#5cb896',
    backgroundColor: '#f4faf8',
  },
  manualMealIcon: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '900',
  },
  manualMealIconActive: {
    color: '#5cb896',
  },
  manualMealName: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  manualMealNameActive: {
    color: '#5cb896',
  },
  manualDateRow: {
    minHeight: 38,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  manualDateLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  manualDateInput: {
    flex: 1,
    minHeight: 36,
    padding: 0,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  manualSearchBar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  manualSearchInput: {
    flex: 1,
    minHeight: 42,
    padding: 0,
    color: '#0f172a',
    fontSize: 13,
  },
  manualSearchIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  manualSearchAction: {
    minWidth: 54,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#10b981',
  },
  manualSearchActionText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  manualCustomEntryCard: {
    minHeight: 64,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.12)',
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  manualCustomEntryTitle: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },
  manualCustomEntrySubtitle: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
  },
  manualCustomEntryButton: {
    maxWidth: 104,
    minHeight: 30,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#10b981',
  },
  manualCustomEntryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  manualCatalogShell: {
    minHeight: 420,
    marginBottom: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eef2f7',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  manualCatalogSidebar: {
    width: 82,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 82,
    maxHeight: 560,
    backgroundColor: '#f4f6fb',
    borderRightWidth: 1,
    borderRightColor: '#eef2f7',
  },
  manualCatalogSidebarContent: {
    paddingTop: 8,
    paddingBottom: 10,
  },
  manualCatalogTab: {
    minHeight: 42,
    justifyContent: 'center',
    paddingLeft: 12,
    paddingRight: 8,
    marginBottom: 4,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  manualCatalogTabActive: {
    backgroundColor: '#ffffff',
    borderColor: '#eef2f7',
    borderLeftColor: 'transparent',
  },
  manualCatalogTabText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  manualCatalogTabTextActive: {
    color: '#0f172a',
    fontWeight: '900',
  },
  manualCatalogMain: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  manualLibraryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  manualSectionTitle: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 21,
  },
  manualLibrarySubtitle: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
  },
  manualFoodList: {
    borderTopWidth: 0,
  },
  manualFoodRow: {
    minHeight: 66,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15, 23, 42, 0.06)',
  },
  manualFoodThumb: {
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  manualFoodThumbPlaceholder: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  manualFoodThumbText: {
    color: '#5cb896',
    fontSize: 15,
    fontWeight: '900',
  },
  manualFoodInfo: {
    flex: 1,
    minWidth: 0,
  },
  manualFoodNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 2,
  },
  manualFoodName: {
    flex: 1,
    minWidth: 0,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  manualFoodSourceBadge: {
    maxWidth: 72,
    paddingHorizontal: 6,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#f4faf8',
  },
  manualFoodSourceBadgeText: {
    color: '#5cb896',
    fontSize: 9,
    fontWeight: '800',
  },
  manualFoodSub: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  manualFoodHint: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 10,
    lineHeight: 14,
  },
  manualFoodAddButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f8fafc',
  },
  manualFoodAddButtonActive: {
    borderColor: 'rgba(92, 184, 150, 0.24)',
    backgroundColor: '#f4faf8',
  },
  manualFoodAddText: {
    color: '#5cb896',
    fontSize: 15,
    fontWeight: '900',
  },
  manualFoodAddTextActive: {
    fontSize: 10,
  },
  manualLoadingState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualEmptyState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  manualEmptyText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  foodLibraryPage: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  foodLibraryTabs: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  foodLibraryTab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  foodLibraryTabActive: {
    borderBottomColor: '#5cb896',
  },
  foodLibraryTabText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '700',
  },
  foodLibraryTabTextActive: {
    color: '#5cb896',
    fontWeight: '900',
  },
  foodLibraryContent: {
    paddingBottom: 36,
  },
  foodLibraryFilterSection: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  foodLibrarySearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  foodLibrarySearchInputWrap: {
    flex: 1,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  foodLibrarySearchInput: {
    flex: 1,
    minHeight: 36,
    padding: 0,
    color: '#111827',
    fontSize: 14,
  },
  foodLibrarySearchButton: {
    minWidth: 64,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#5cb896',
  },
  foodLibrarySearchButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  foodLibraryActionDisabled: {
    opacity: 0.72,
  },
  foodLibrarySortSection: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  foodLibrarySortLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  foodLibrarySortItem: {
    minHeight: 30,
    justifyContent: 'center',
  },
  foodLibrarySortText: {
    color: '#6a7282',
    fontSize: 14,
    fontWeight: '700',
  },
  foodLibrarySortTextActive: {
    color: '#5cb896',
    fontWeight: '900',
  },
  foodLibrarySortUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#5cb896',
  },
  foodLibraryNewButton: {
    minHeight: 30,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#f9fafb',
  },
  foodLibraryNewButtonText: {
    color: '#5cb896',
    fontSize: 13,
    fontWeight: '800',
  },
  foodLibraryListContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  foodLibraryListHeader: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  foodLibraryListHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  foodLibraryListTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  foodLibraryListSubtitle: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
  },
  foodLibraryCard: {
    marginBottom: 12,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  foodLibraryCardMain: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  foodLibraryCardImageWrap: {
    width: 110,
    height: 110,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 10,
  },
  foodLibraryLatestBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#5cb896',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  foodLibraryCardInfo: {
    flex: 1,
    minWidth: 0,
  },
  foodLibraryCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
  },
  foodLibraryCardTitle: {
    flex: 1,
    minWidth: 0,
    color: '#1e2939',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  foodLibrarySourcePill: {
    maxWidth: 82,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: '#ecfdf5',
  },
  foodLibrarySourcePillText: {
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  foodLibraryCardDesc: {
    minHeight: 34,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
  },
  foodLibraryCardCalories: {
    marginTop: 4,
    color: '#5cb896',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  foodLibraryNutritionRow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  foodLibraryNutritionPill: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#ecfdf5',
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  foodLibraryCardFooter: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  foodLibraryCardFooterText: {
    flex: 1,
    minWidth: 0,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  foodLibraryCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  foodLibraryCardGhostButton: {
    minHeight: 30,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#f8fafc',
  },
  foodLibraryCardGhostButtonText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  foodLibraryCardRecordButton: {
    minHeight: 30,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#5cb896',
  },
  foodLibraryCardRecordButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  foodLibraryEmptyState: {
    minHeight: 230,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  foodLibraryEmptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    backgroundColor: '#ecfdf5',
    color: '#5cb896',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 54,
  },
  foodLibraryEmptyText: {
    marginTop: 10,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  foodLibraryEmptyButton: {
    marginTop: 12,
    minHeight: 34,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: '#5cb896',
  },
  foodLibraryEmptyButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  foodLibrarySkeletonCard: {
    marginBottom: 12,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  foodLibrarySkeletonMain: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  foodLibrarySkeletonImage: {
    width: 110,
    height: 110,
    borderRadius: 10,
    backgroundColor: '#eef2f7',
  },
  foodLibrarySkeletonInfo: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  foodLibrarySkeletonLine: {
    borderRadius: 7,
    backgroundColor: '#eef2f7',
  },
  foodLibrarySkeletonFooter: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foodLibraryCustomPanel: {
    margin: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    backgroundColor: '#ffffff',
  },
  foodLibraryCustomHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  foodLibraryCustomHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  foodLibraryCustomTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  foodLibraryCustomSubtitle: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
  },
  foodLibraryCollapseButton: {
    minHeight: 30,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#f8fafc',
  },
  foodLibraryCollapseButtonText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  foodLibraryImageRow: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  foodLibraryImagePreview: {
    width: 56,
    height: 56,
    borderRadius: 9,
    overflow: 'hidden',
  },
  foodLibraryImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e5e7eb',
  },
  foodLibraryImageEmpty: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  foodLibraryImageActions: {
    flex: 1,
    minWidth: 0,
  },
  foodLibraryImageTitle: {
    marginBottom: 6,
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '900',
  },
  foodLibraryImageInput: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: 13,
  },
  foodLibraryCustomGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  foodLibraryCustomField: {
    width: '48.5%',
  },
  foodLibraryCustomFieldFull: {
    width: '100%',
  },
  foodLibraryBasisPresets: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  foodLibraryBasisChip: {
    minHeight: 30,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    backgroundColor: '#f1f5f9',
  },
  foodLibraryBasisChipActive: {
    borderColor: 'rgba(16, 185, 129, 0.34)',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  foodLibraryBasisChipText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  foodLibraryBasisChipTextActive: {
    color: '#059669',
    fontWeight: '900',
  },
  foodLibraryCustomLabel: {
    marginBottom: 5,
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },
  foodLibraryCustomInput: {
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontSize: 13,
  },
  foodLibraryMoreToggle: {
    minHeight: 40,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foodLibraryMoreText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
  },
  foodLibraryMoreAction: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '900',
  },
  foodLibraryPublicRow: {
    minHeight: 58,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  foodLibraryPublicCopy: {
    flex: 1,
    minWidth: 0,
  },
  foodLibraryPublicTitle: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
  },
  foodLibraryPublicSubtitle: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 11,
  },
  foodLibraryPublicSwitch: {
    width: 42,
    height: 24,
    padding: 2,
    borderRadius: 12,
    backgroundColor: '#cbd5e1',
  },
  foodLibraryPublicSwitchActive: {
    backgroundColor: '#10b981',
  },
  foodLibraryPublicKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  foodLibraryPublicKnobActive: {
    transform: [{ translateX: 18 }],
  },
  foodLibraryCustomActions: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  foodLibraryPrimaryButton: {
    minHeight: 36,
    minWidth: 108,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#10b981',
  },
  foodLibraryPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  foodLibrarySecondaryButton: {
    minHeight: 36,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
  },
  foodLibrarySecondaryButtonText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  manualSelectedSection: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.14)',
    backgroundColor: '#ffffff',
  },
  manualSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  manualTotalCalories: {
    alignItems: 'flex-end',
  },
  manualTotalCaloriesValue: {
    color: '#5cb896',
    fontSize: 22,
    fontWeight: '900',
  },
  manualTotalCaloriesUnit: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
  },
  manualNutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  manualSelectedItem: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 23, 42, 0.06)',
  },
  manualSelectedMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 8,
  },
  manualSelectedRemove: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  manualSelectedControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  manualWeightInputWrap: {
    height: 34,
    minWidth: 86,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
  },
  manualWeightInput: {
    flex: 1,
    minWidth: 36,
    padding: 0,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  manualWeightUnit: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },
  manualQuickChip: {
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.14)',
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  manualQuickChipText: {
    color: '#5cb896',
    fontSize: 11,
    fontWeight: '800',
  },
  manualBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(16, 185, 129, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
  },
  manualBottomSummary: {
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.1)',
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
  },
  manualBottomSummaryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  manualBottomSummaryText: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },
  manualBottomSummaryAction: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '900',
  },
  manualBottomSummarySubtext: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 11,
  },
  manualSaveButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#5cb896',
  },
  manualSaveButtonDisabled: {
    opacity: 0.68,
  },
  manualSaveButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  manualHeroCard: {
    backgroundColor: colors.brandSoft,
  },
  manualHeroKcal: {
    minWidth: 92,
    alignItems: 'flex-end',
  },
  manualHeroKcalValue: {
    color: colors.brandDark,
    fontSize: 26,
    fontWeight: '900',
  },
  manualHeroKcalUnit: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  aboutPage: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  aboutContent: {
    paddingBottom: 28,
  },
  aboutHeaderSection: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 38,
    paddingBottom: 36,
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },
  aboutLogoWrapper: {
    width: 80,
    height: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: '#f0fdf4',
  },
  aboutLogoImage: {
    width: 80,
    height: 80,
  },
  aboutAppName: {
    color: '#1f2937',
    fontSize: 18,
    fontWeight: '700',
  },
  aboutAppVersion: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '500',
  },
  aboutCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  aboutCardTitle: {
    color: '#1f2937',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  aboutCardText: {
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'justify',
  },
  aboutCellGroup: {
    minHeight: 56,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 18,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  aboutCellPressed: {
    opacity: 0.76,
  },
  aboutCellTitle: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '600',
  },
  aboutCellValueWrap: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  aboutCellValue: {
    minWidth: 0,
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  aboutCellArrow: {
    color: '#9ca3af',
    fontSize: 22,
    lineHeight: 24,
  },
  aboutCopyright: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
  },
  feedbackPage: {
    flex: 1,
    backgroundColor: '#f6f8fb',
  },
  feedbackScroll: {
    flex: 1,
  },
  feedbackContent: {
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  feedbackHero: {
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 10,
    paddingBottom: 14,
  },
  feedbackHeroTitle: {
    color: '#111827',
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '900',
  },
  feedbackHeroDesc: {
    color: '#667085',
    fontSize: 13,
    lineHeight: 19,
  },
  feedbackCard: {
    marginBottom: 11,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.05)',
    borderRadius: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  feedbackSectionTitle: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  feedbackTitleRow: {
    minHeight: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 9,
  },
  feedbackCount: {
    color: '#98a2b3',
    fontSize: 12,
    fontWeight: '700',
  },
  feedbackCategoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 10,
  },
  feedbackCategoryCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 63,
    borderWidth: 1,
    borderColor: '#eef2f7',
    borderRadius: 11,
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  feedbackCategoryCardActive: {
    borderColor: '#d4a574',
    backgroundColor: '#fffaf2',
  },
  feedbackCategoryTitle: {
    color: '#101828',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  feedbackCategoryDesc: {
    color: '#667085',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  feedbackTextArea: {
    minHeight: 130,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
  },
  feedbackContactArea: {
    minHeight: 65,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
  },
  feedbackCardHint: {
    color: '#667085',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  formHintWarning: {
    color: colors.warning,
  },
  feedbackImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 10,
  },
  feedbackImageItem: {
    position: 'relative',
    width: 100,
    height: 100,
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
  },
  feedbackImagePreview: {
    width: '100%',
    height: '100%',
  },
  feedbackImageRemove: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
  },
  feedbackImageAdd: {
    width: 100,
    height: 100,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d0d5dd',
    backgroundColor: '#f8fafc',
  },
  feedbackImageAddText: {
    color: '#667085',
    fontSize: 11,
    fontWeight: '800',
  },
  feedbackDiagnosticCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  feedbackDiagnosticMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  feedbackDiagnosticDesc: {
    color: '#667085',
    fontSize: 12,
    lineHeight: 18,
  },
  feedbackSubmitBar: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: 'rgba(246, 248, 251, 0.94)',
  },
  feedbackSubmitButton: {
    height: 44,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#d4a574',
  },
  feedbackSubmitButtonDisabled: {
    backgroundColor: '#e8d5b3',
  },
  feedbackSubmitText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  circlePostEditPage: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  circlePostEditScroll: {
    flex: 1,
  },
  circlePostEditContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  circlePostEditLoadingCard: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    marginBottom: 12,
  },
  circlePostEditCard: {
    marginBottom: 12,
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  circlePostEditImageSection: {
    paddingBottom: 10,
  },
  circlePostEditTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  circlePostEditTitleLeft: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  circlePostEditSectionTitle: {
    color: '#1f2937',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  circlePostEditSectionSubtitle: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  circlePostEditCount: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  circlePostEditImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  circlePostEditImageItem: {
    width: 100,
    height: 100,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f3f4f6',
  },
  circlePostEditImagePreview: {
    width: '100%',
    height: '100%',
  },
  circlePostEditImageMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  circlePostEditImageRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  circlePostEditImageRemoveIcon: {
    color: '#ffffff',
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '700',
  },
  circlePostEditImageAdd: {
    width: 100,
    height: 100,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
  },
  circlePostEditImageAddIcon: {
    color: '#9ca3af',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
  },
  circlePostEditImageAddText: {
    marginTop: 6,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  circlePostEditEditor: {
    paddingBottom: 6,
  },
  circlePostEditTitleInput: {
    minHeight: 28,
    marginBottom: 10,
    paddingVertical: 0,
    color: '#1f2937',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
  },
  circlePostEditTextarea: {
    minHeight: 140,
    paddingTop: 0,
    paddingBottom: 0,
    color: '#1f2937',
    fontSize: 15,
    lineHeight: 25,
    fontWeight: '500',
  },
  circlePostEditToggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#d1d5db',
    position: 'relative',
    flexShrink: 0,
  },
  circlePostEditToggleOn: {
    backgroundColor: '#00bc7d',
  },
  circlePostEditToggleKnob: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  circlePostEditToggleKnobOn: {
    transform: [{ translateX: 18 }],
  },
  circlePostEditNutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  circlePostEditNutritionItem: {
    flexGrow: 1,
    flexBasis: '47%',
    gap: 5,
  },
  circlePostEditNutritionLabel: {
    color: '#4b5563',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  circlePostEditNutritionInputWrap: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#f9fafb',
  },
  circlePostEditNutritionInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: '#1f2937',
    fontSize: 15,
    textAlign: 'right',
    fontWeight: '700',
  },
  circlePostEditNutritionUnit: {
    minWidth: 24,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
    fontWeight: '700',
  },
  circlePostEditFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  circlePostEditDraftButton: {
    minWidth: 88,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  circlePostEditDraftText: {
    color: '#4b5563',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  circlePostEditSubmitButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  circlePostEditSubmitButtonMuted: {
    opacity: 0.72,
  },
  circlePostEditSubmitText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  imageBlock: {
    marginTop: 12,
    marginBottom: 6,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  imageTile: {
    width: 96,
    height: 112,
  },
  imageThumb: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  imageRemove: {
    alignItems: 'center',
    marginTop: 3,
  },
  imageRemoveText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  imageAdd: {
    width: 96,
    height: 96,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageAddIcon: {
    color: colors.brandDark,
    fontSize: 24,
    fontWeight: '900',
  },
  imageAddText: {
    color: colors.textSecondary,
    fontWeight: '800',
    marginTop: 4,
  },
  previewImage: {
    width: '100%',
    height: 210,
    borderRadius: 16,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: colors.surfaceMuted,
  },
  recordImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
    marginBottom: 4,
  },
  recordImageThumb: {
    width: 92,
    height: 92,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  interactionNotificationsPage: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  notificationsHeader: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  notificationsHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  notificationsTitle: {
    fontSize: 17,
    lineHeight: 24,
    color: '#0f172a',
    fontWeight: '900',
  },
  notificationsSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  markReadButton: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bc7d',
  },
  markReadButtonDisabled: {
    opacity: 0.55,
  },
  markReadText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  notificationTabs: {
    flexDirection: 'row',
    minHeight: 58,
    borderRadius: 8,
    marginBottom: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  notificationsList: {
    flex: 1,
  },
  notificationsListContent: {
    paddingBottom: 28,
  },
  notificationsListContentEmpty: {
    flexGrow: 1,
  },
  notificationTabItem: {
    flex: 1,
    minHeight: 58,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    position: 'relative',
  },
  notificationTabItemActive: {
    backgroundColor: '#fff',
  },
  notificationTabText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  notificationTabTextActive: {
    color: '#00bc7d',
    fontWeight: '900',
  },
  notificationTabBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  notificationTabBadgeActive: {
    backgroundColor: '#f0fdf4',
  },
  notificationTabBadgeText: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
  },
  notificationTabBadgeTextActive: {
    color: '#00bc7d',
  },
  notificationTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    width: 24,
    height: 3,
    marginLeft: -12,
    borderRadius: 2,
    backgroundColor: '#00bc7d',
  },
  notificationsState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationsEmpty: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  notificationsEmptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#334155',
  },
  notificationsEmptySubtitle: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
    textAlign: 'center',
  },
  notificationCard: {
    marginBottom: 10,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  notificationCardUnread: {
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.16)',
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  notificationAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
    overflow: 'hidden',
  },
  notificationAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  notificationAvatarText: {
    color: '#15803d',
    fontSize: 12,
    fontWeight: '900',
  },
  notificationMain: {
    flex: 1,
    minWidth: 0,
  },
  notificationTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notificationTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    color: '#1e293b',
  },
  notificationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00bc7d',
  },
  notificationContent: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 21,
    color: '#475569',
  },
  notificationTime: {
    marginTop: 6,
    fontSize: 11,
    color: '#94a3b8',
  },
  loadMoreSpinner: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationListEnd: {
    paddingVertical: 12,
    fontSize: 11,
    color: '#cbd5e1',
    textAlign: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
    marginBottom: 8,
  },
  summaryCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 72,
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.surfaceMuted,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  summaryUnit: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  summaryTitle: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  bodyRecordPage: {
    flex: 1,
  },
  bodyRecordScroll: {
    flex: 1,
  },
  bodyRecordContent: {
    paddingHorizontal: 14,
  },
  bodyRecordTopbar: {
    minHeight: 76,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(31, 41, 55, 0.05)',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  bodyRecordKicker: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  bodyRecordTitle: {
    marginTop: 4,
    color: '#1f2937',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
  },
  bodyRecordTrendLink: {
    minHeight: 31,
    borderRadius: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyRecordTrendText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  bodyMetricMainCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(31, 41, 55, 0.05)',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  bodyMetricCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(31, 41, 55, 0.05)',
    padding: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  bodyMetricOverviewCard: {
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  bodyMetricMainLabel: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  weightInputRow: {
    minHeight: 59,
    marginTop: 13,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  weightMainInput: {
    width: 150,
    height: 59,
    borderRadius: 12,
    paddingVertical: 0,
    color: '#111827',
    fontSize: 38,
    lineHeight: 45,
    fontWeight: '800',
    textAlign: 'center',
    backgroundColor: '#f3f7f6',
  },
  weightMainUnit: {
    marginLeft: 6,
    color: '#6b7280',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  bodyMetricSaveButton: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5cb896',
    shadowOpacity: 0.24,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  bodyMetricSaveText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  bodyMetricActionDisabled: {
    opacity: 0.55,
  },
  bodyMetricHelper: {
    marginTop: 9,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  bodyMetricSectionHead: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bodyMetricSectionTitle: {
    color: '#1f2937',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  bodyMetricEmpty: {
    paddingVertical: 24,
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  weightDayList: {
    marginTop: 9,
    borderTopWidth: 1,
    borderTopColor: '#eef2f4',
  },
  weightDayRow: {
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f4',
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  weightDayValue: {
    color: '#111827',
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '800',
  },
  weightDayDate: {
    marginTop: 4,
    color: '#9ca3af',
    fontSize: 11,
    lineHeight: 15,
  },
  weightDeleteButton: {
    minWidth: 48,
    minHeight: 30,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
  },
  weightDeleteText: {
    color: '#d45c5c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  waterTotalRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  waterTotalValue: {
    color: '#111827',
    fontSize: 39,
    lineHeight: 43,
    fontWeight: '900',
  },
  waterTotalUnit: {
    marginLeft: 5,
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  waterProgressTrack: {
    height: 9,
    borderRadius: 5,
    marginTop: 8,
    overflow: 'hidden',
    backgroundColor: '#e7eff5',
  },
  waterProgressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#5c9ed4',
  },
  waterProgressNote: {
    marginTop: 9,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  waterPresetGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  waterPresetButton: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef6fc',
  },
  waterPresetText: {
    color: '#3278ab',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  waterCustomRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waterCustomInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f8fafc',
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  waterCustomButton: {
    minWidth: 76,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5c9ed4',
  },
  waterCustomButtonText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  waterClearLink: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff1f2',
  },
  waterClearText: {
    color: '#d45c5c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  waterLogList: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  waterLogChip: {
    minHeight: 36,
    borderRadius: 18,
    paddingLeft: 12,
    paddingRight: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eef6fc',
  },
  waterLogText: {
    color: '#3278ab',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  waterLogDelete: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  exerciseStatsWrap: {
    marginBottom: 12,
  },
  exerciseStatsCard: {
    minHeight: 68,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  exerciseStatsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
  },
  exerciseStatsLabel: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  exerciseStatsValueRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  exerciseStatsValue: {
    color: '#111827',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  exerciseStatsUnit: {
    marginLeft: 5,
    color: '#f97316',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  exerciseStatsCount: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#fff7ed',
    color: '#ea580c',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  exerciseInputSection: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  exerciseComposeHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  exerciseComposeKicker: {
    color: '#f97316',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  exerciseComposeTitle: {
    marginTop: 2,
    color: '#111827',
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },
  exerciseTrendLink: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7ed',
  },
  exerciseTrendText: {
    color: '#ea580c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  exerciseQuickTitle: {
    marginTop: 6,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  exerciseQuickRow: {
    paddingTop: 8,
    paddingRight: 8,
    gap: 8,
  },
  exerciseQuickChip: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7ed',
  },
  exerciseQuickChipText: {
    color: '#ea580c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  exerciseImagePreviewWrap: {
    marginTop: 12,
    position: 'relative',
  },
  exerciseImagePreview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  exerciseImageRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.72)',
  },
  exerciseInputWrap: {
    minHeight: 74,
    marginTop: 12,
    borderRadius: 14,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: '#f8fafc',
  },
  exerciseImageButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  exerciseTextInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingVertical: 7,
    paddingHorizontal: 0,
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
  },
  exerciseSendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f97316',
  },
  exerciseSendButtonDisabled: {
    backgroundColor: '#fed7aa',
  },
  exerciseRecordCard: {
    marginTop: 12,
    borderRadius: 14,
    padding: 13,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  exerciseRecordCardFailed: {
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  exerciseRecordTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  exerciseRecordTitle: {
    flex: 1,
    minWidth: 0,
    color: '#111827',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '900',
  },
  exerciseRecordDivider: {
    height: 1,
    marginVertical: 10,
    backgroundColor: '#eef2f7',
  },
  exerciseRecordBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  exercisePendingRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exercisePendingText: {
    flex: 1,
    minWidth: 0,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
  exerciseRefreshLink: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7ed',
  },
  exerciseRefreshText: {
    color: '#ea580c',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  exerciseErrorText: {
    marginTop: 8,
    color: '#dc2626',
    fontSize: 12,
    lineHeight: 18,
  },
  exerciseEmptyState: {
    marginTop: 18,
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  exerciseEmptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  exerciseEmptyTitle: {
    color: '#374151',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  exerciseEmptyDesc: {
    marginTop: 6,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  exerciseRecordsList: {
    marginTop: 2,
  },
  exerciseDeleteText: {
    overflow: 'hidden',
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  exerciseKcalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  exerciseKcalValue: {
    color: '#f97316',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  exerciseKcalUnit: {
    marginLeft: 4,
    color: '#ea580c',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  exerciseRecordTime: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  exerciseReasoning: {
    marginTop: 8,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
  rewardPage: {
    flex: 1,
    backgroundColor: '#f6f7fb',
  },
  rewardPageContent: {
    flexGrow: 1,
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  rewardHero: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#0f9f6e',
    shadowColor: '#10b981',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  rewardHeroTitle: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  rewardHeroSubtitle: {
    marginTop: 5,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    lineHeight: 19,
  },
  rewardHeroStats: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 12,
  },
  rewardStat: {
    flex: 1,
    minHeight: 62,
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  rewardStatValue: {
    color: '#ffffff',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  rewardStatLabel: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    lineHeight: 17,
  },
  rewardQuickSection: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#172033',
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  rewardQuickHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  rewardQuickTitle: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  rewardQuickHint: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  rewardQuickList: {
    gap: 8,
    marginTop: 10,
  },
  rewardQuickCard: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 11,
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 9,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  rewardQuickName: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  rewardQuickDesc: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    lineHeight: 17,
  },
  rewardQuickButton: {
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    color: '#0f9f6e',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  rewardSection: {
    marginTop: 14,
  },
  rewardSectionTitle: {
    color: '#172033',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  rewardLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  rewardTaskList: {
    gap: 10,
    marginTop: 10,
  },
  rewardEmptyState: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d8f3e6',
    backgroundColor: '#f6fdf9',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rewardEmptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  rewardTaskCard: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  rewardTaskHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rewardTaskName: {
    color: '#172033',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  rewardTaskReward: {
    marginTop: 4,
    color: '#0f9f6e',
    fontSize: 12,
    lineHeight: 18,
  },
  rewardTaskStatus: {
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: '#ecfdf5',
    color: '#0f9f6e',
    fontSize: 11,
    lineHeight: 16,
  },
  rewardTaskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  rewardTaskMetaText: {
    flexShrink: 1,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
  rewardTaskButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: '#0f9f6e',
  },
  rewardTaskButtonDisabled: {
    backgroundColor: '#cbd5e1',
  },
  rewardTaskButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  editItemBox: {
    marginTop: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  selectedFoodBox: {
    paddingTop: 14,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ratioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  ratioButton: {
    minWidth: 62,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  ratioButtonActive: {
    backgroundColor: colors.brand,
  },
  ratioButtonText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  ratioButtonTextActive: {
    color: '#fff',
  },
  nutritionGrid: {
    marginTop: 8,
  },
  healthProfilePage: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  healthProfileLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  healthProfileProgressWrap: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  healthProfileProgressDots: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  healthProfileProgressDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
  },
  healthProfileProgressDotActive: {
    backgroundColor: '#00bc7d',
  },
  healthProfileProgressDotCurrent: {
    transform: [{ scale: 1.35 }],
  },
  healthProfileProgressText: {
    minWidth: 42,
    marginLeft: 12,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  healthProfileScroll: {
    flex: 1,
  },
  healthProfileStepCard: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  healthProfileStepTitle: {
    color: '#1a1a1a',
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '700',
  },
  healthProfileStepSubtitle: {
    marginTop: 6,
    marginBottom: 24,
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 21,
  },
  healthProfileChoiceList: {
    gap: 10,
  },
  healthProfileOptionGrid: {
    gap: 8,
  },
  healthProfileOptionCard: {
    width: '100%',
    minHeight: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
  },
  healthProfileOptionCardBig: {
    minHeight: 64,
    paddingVertical: 15,
  },
  healthProfileOptionCardSmall: {
    minHeight: 56,
    paddingVertical: 11,
  },
  healthProfileOptionCardActive: {
    borderColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  healthProfileChoiceMark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  healthProfileChoiceMarkActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#00bc7d',
  },
  healthProfileChoiceMarkInner: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  healthProfileOptionIcon: {
    width: 26,
    color: '#00bc7d',
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
  },
  healthProfileOptionIconSmall: {
    fontSize: 18,
    lineHeight: 24,
  },
  healthProfileOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  healthProfileOptionLabel: {
    color: '#334155',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  healthProfileOptionLabelActive: {
    color: '#1a1a1a',
    fontWeight: '700',
  },
  healthProfileOptionDesc: {
    marginTop: 3,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
  },
  healthProfileNumberCard: {
    minHeight: 176,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  healthProfileNumberInput: {
    minWidth: 120,
    color: '#1a1a1a',
    fontSize: 46,
    lineHeight: 58,
    fontWeight: '800',
    textAlign: 'center',
  },
  healthProfileNumberUnit: {
    marginTop: 2,
    color: '#00bc7d',
    fontSize: 14,
    fontWeight: '800',
  },
  healthProfileNumberRange: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  healthProfileInputCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  healthProfileInputHint: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
  healthProfileTextarea: {
    minHeight: 102,
    color: '#1a1a1a',
    fontSize: 14,
    lineHeight: 21,
  },
  healthProfileSkipHint: {
    marginTop: 12,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
  healthProfileRoutineRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  healthProfileRoutineField: {
    flex: 1,
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    backgroundColor: '#ffffff',
  },
  healthProfileRoutineLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  healthProfileRoutineInputRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  healthProfileRoutineInput: {
    flex: 1,
    color: '#1a1a1a',
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
    textAlign: 'center',
  },
  healthProfileRoutineUnit: {
    paddingBottom: 7,
    color: '#00bc7d',
    fontSize: 13,
    fontWeight: '800',
  },
  healthProfileTargetPanel: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    backgroundColor: '#ffffff',
  },
  healthProfileTargetTitle: {
    color: '#1a1a1a',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  healthProfileTargetSubtitle: {
    marginTop: 3,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
  },
  healthProfileTargetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  healthProfileTargetField: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 72,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  healthProfileTargetLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  healthProfileTargetInputRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  healthProfileTargetInput: {
    flex: 1,
    minWidth: 0,
    color: '#1a1a1a',
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
  },
  healthProfileTargetUnit: {
    paddingBottom: 3,
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
  },
  healthProfileReportLink: {
    minHeight: 42,
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#ecfdf5',
  },
  healthProfileReportLinkText: {
    flex: 1,
    color: '#047857',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  healthProfileReportLinkArrow: {
    color: '#047857',
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '600',
  },
  healthProfileFooter: {
    marginTop: 'auto',
    paddingTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  healthProfileFooterSingle: {
    justifyContent: 'flex-end',
  },
  healthProfilePrevButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  healthProfilePrevText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '700',
  },
  healthProfileNextButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#00bc7d',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  healthProfileNextButtonReady: {
    backgroundColor: '#00bc7d',
  },
  healthProfileNextButtonDisabled: {
    borderColor: '#e2e8f0',
    backgroundColor: '#e2e8f0',
    shadowOpacity: 0,
    elevation: 0,
  },
  healthProfileNextText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  healthProfileNextTextDisabled: {
    color: '#94a3b8',
  },
  expiryPage: {
    flex: 1,
    backgroundColor: '#f6f8fa',
  },
  expiryScroll: {
    flex: 1,
    backgroundColor: '#f6f8fa',
  },
  expiryContent: {
    paddingTop: 16,
  },
  expiryHero: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
    backgroundColor: '#e7faf3',
  },
  expiryHeroKicker: {
    marginBottom: 5,
    color: '#5b7b71',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  expiryHeroTitle: {
    color: '#16332a',
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
  },
  expiryHeroAdd: {
    minWidth: 72,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  expiryHeroAddText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  expirySummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  expirySummaryCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 86,
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  expirySummaryValue: {
    color: '#16332a',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
  },
  expirySummaryLabel: {
    marginTop: 5,
    color: '#61756d',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  expiryPreviewPanel: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  expiryPreviewRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f1',
  },
  expiryPreviewName: {
    flex: 1,
    color: '#16332a',
    fontSize: 14,
    fontWeight: '800',
  },
  expiryPreviewHint: {
    flexShrink: 0,
    color: '#ff7a00',
    fontSize: 12,
    fontWeight: '800',
  },
  expirySection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  expirySectionTitle: {
    marginBottom: 10,
    color: '#314740',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  expirySectionTitleNoMargin: {
    color: '#314740',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  expirySectionHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  expirySectionToggle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '800',
  },
  expiryItemCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  expiryItemHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  expiryItemTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  expiryItemTitle: {
    maxWidth: '100%',
    color: '#16332a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  expiryItemCategory: {
    maxWidth: 92,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#eef8f4',
  },
  expiryItemCategoryText: {
    color: '#4f6b62',
    fontSize: 11,
    fontWeight: '800',
  },
  expiryItemBadge: {
    maxWidth: 96,
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  expiryItemBadge_expired: {
    backgroundColor: '#ffe7e7',
  },
  expiryItemBadge_today: {
    backgroundColor: '#fff2df',
  },
  expiryItemBadge_soon: {
    backgroundColor: '#fff7db',
  },
  expiryItemBadge_fresh: {
    backgroundColor: '#ecfdf5',
  },
  expiryItemBadge_consumed: {
    backgroundColor: '#ecfdf5',
  },
  expiryItemBadge_discarded: {
    backgroundColor: '#f3f4f6',
  },
  expiryItemBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  expiryItemBadgeText_expired: {
    color: '#d9485f',
  },
  expiryItemBadgeText_today: {
    color: '#ff7a00',
  },
  expiryItemBadgeText_soon: {
    color: '#b7791f',
  },
  expiryItemBadgeText_fresh: {
    color: '#15803d',
  },
  expiryItemBadgeText_consumed: {
    color: '#15803d',
  },
  expiryItemBadgeText_discarded: {
    color: '#6b7280',
  },
  expiryItemMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 9,
  },
  expiryItemMetaText: {
    color: '#61756d',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  expiryItemHint: {
    marginTop: 8,
    color: '#16332a',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  expiryItemNote: {
    marginTop: 6,
    color: '#61756d',
    fontSize: 12,
    lineHeight: 18,
  },
  expiryItemActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  expiryActionGhost: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 9,
    backgroundColor: '#f3f7f5',
  },
  expiryActionGhostText: {
    color: '#314740',
    fontSize: 12,
    fontWeight: '800',
  },
  expiryActionPrimary: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#00bc7d',
  },
  expiryActionPrimaryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  expiryEmptyCard: {
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  expiryFailedCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fed7aa',
  },
  expiryEmptyTitle: {
    color: '#16332a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  expiryEmptyDesc: {
    marginTop: 7,
    color: '#61756d',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  expiryRetryButton: {
    minWidth: 116,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    borderRadius: 999,
    backgroundColor: '#00bc7d',
  },
  expiryRetryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  groupTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
    marginTop: 4,
  },
  bigNumber: {
    color: colors.brandDark,
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  notes: {
    marginTop: 6,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  errorText: {
    marginTop: 6,
    color: colors.danger,
    lineHeight: 20,
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  itemRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  itemMeta: {
    marginTop: 3,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  status: {
    color: colors.warning,
    fontWeight: '800',
  },
  exerciseTaskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  exerciseTaskTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  fieldMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  textarea: {
    minHeight: 88,
    paddingTop: 12,
    paddingBottom: 12,
  },
  textRecordPage: {
    flex: 1,
    backgroundColor: '#f0fdf4',
  },
  textRecordScroll: {
    flex: 1,
  },
  textRecordContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  textRecordQuotaBar: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1fae5',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 18,
  },
  textRecordQuotaBarWarn: {
    borderColor: '#fed7aa',
    backgroundColor: '#fff7ed',
  },
  textRecordQuotaBarExhausted: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  textRecordQuotaText: {
    color: '#374151',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  textRecordQuotaTextExhausted: {
    color: '#b91c1c',
  },
  textRecordInputSection: {
    marginBottom: 20,
  },
  textRecordSectionTitle: {
    marginBottom: 10,
    paddingLeft: 4,
    color: '#1a1a2e',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  textRecordInputCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.15)',
    backgroundColor: '#ffffff',
    padding: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  textRecordFoodInput: {
    minHeight: 116,
    paddingTop: 0,
    paddingBottom: 24,
    color: '#1a1a2e',
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '600',
  },
  textRecordAmountInput: {
    minHeight: 82,
    paddingTop: 0,
    color: '#1a1a2e',
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '600',
  },
  textRecordCharCount: {
    position: 'absolute',
    right: 14,
    bottom: 10,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  textRecordDateCard: {
    minHeight: 48,
    justifyContent: 'center',
  },
  textRecordDateInput: {
    paddingVertical: 0,
    color: '#1a1a2e',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  textRecordMealGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  textRecordMealItem: {
    width: '31.7%',
    minHeight: 78,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.12)',
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  textRecordMealItemActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#effdf7',
  },
  textRecordMealName: {
    color: '#4a5565',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  textRecordMealNameActive: {
    color: '#00bc7d',
  },
  textRecordOptionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  textRecordOption: {
    minHeight: 42,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.12)',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  textRecordOptionActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#00bc7d',
  },
  textRecordOptionText: {
    color: '#4a5565',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  textRecordOptionTextActive: {
    color: '#ffffff',
  },
  textRecordPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  textRecordBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 188, 125, 0.12)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  textRecordSubmitButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 3,
  },
  textRecordSubmitButtonDisabled: {
    backgroundColor: '#e5e7eb',
    shadowOpacity: 0,
    elevation: 0,
  },
  textRecordSubmitText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  textRecordSubmitTextDisabled: {
    color: '#9ca3af',
  },
  textQuickTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: -2,
    marginBottom: 20,
  },
  textQuickTagsLabel: {
    color: '#6a7282',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  textQuickTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  textQuickTag: {
    minHeight: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 125, 0.2)',
    backgroundColor: 'rgba(0, 188, 125, 0.08)',
  },
  textQuickTagText: {
    color: '#00a86b',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  segmentItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  segmentItemActive: {
    backgroundColor: colors.brand,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },
  segmentTextActive: {
    color: '#fff',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  quickButton: {
    minWidth: '47%',
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  quickButtonText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  manualAdjustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  manualAdjustButton: {
    minHeight: 36,
    minWidth: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  manualAdjustText: {
    color: colors.text,
    fontWeight: '800',
  },
  foodChoiceLegacyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    marginBottom: 10,
  },
  foodChoiceAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  foodChoiceAddText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  foodChoiceAdded: {
    minWidth: 48,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.brandSoft,
  },
  foodChoiceAddedText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  waterChip: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted,
  },
  waterChipText: {
    color: colors.text,
    fontWeight: '800',
  },
  waterChipDelete: {
    marginTop: 2,
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  miniStat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
  },
  statValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  statTitle: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
  },
  smallButton: {
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  smallButtonDanger: {
    backgroundColor: '#fee2e2',
  },
  smallButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  smallButtonDangerText: {
    color: colors.danger,
  },
  smallButtonTextDisabled: {
    color: colors.textMuted,
  },
  listEndText: {
    marginTop: 4,
    marginBottom: 10,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  qrWrap: {
    alignItems: 'center',
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  qrImage: {
    width: 220,
    height: 220,
    marginBottom: 10,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.brandSoft,
  },
  pillText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoLabel: {
    color: colors.textSecondary,
    flexShrink: 0,
  },
  infoValue: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'right',
    flexShrink: 1,
  },
  unreadCard: {
    borderWidth: 1,
    borderColor: colors.brand,
  },
})
