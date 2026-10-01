import { View, Text, Input, ScrollView, Switch, Image } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow, useLoad } from '@tarojs/taro'
import {
  getAccessToken,
  getPetChatSession,
  getLatestPetChatSession,
  getHealthProfile,
  getPetSummary,
  getStatsSummary,
  compressImagePathForUpload,
  estimatePetChat,
  listPetChatSessions,
  showUnifiedApiError,
  streamGeneratePetChat,
  uploadAnalyzeImageFile,
  updateHealthProfile,
  type DietRecommendationOption,
  type DietRecommendationResult,
  type PetChatEntryContext,
  type PetChatLocation,
  type PetChatHistoryMessage,
  type PetChatSessionSummary,
  type PetSummary,
  type StatsSummary,
  type StreamGeneratePetChatCallbacks,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { openPetSettings } from '../../../utils/pet-navigation'
import { PetAvatar } from '../../../components/PetAvatar'
import { PetMarkdown } from './pet-markdown'
import { MealSuggestions } from './MealSuggestions'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { chooseImageWithPrivacy, ensureWeappPrivacyAuthorized, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { currentMealLocation, rememberMealLocation } from '../../../utils/meal-location'
import './index.scss'

type ChatRole = 'pet' | 'user'
type RangeMode = 'week' | 'month'

type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  kind?: 'intro' | 'analysis' | 'local' | 'diet_recommendation'
  clues?: string[]
  actions?: string[]
  recommendation?: DietRecommendationResult
  imageUrls?: string[]
}

type PendingChatImage = {
  id: string
  localPath: string
  remoteUrl?: string
  uploading: boolean
}

const PET_CHAT_MAX_IMAGES = 3
const DEFAULT_IMAGE_QUESTION = '帮我看看这张图里与饮食和健康有关的重点'

const FOLLOW_UPS = [
  '今天吃什么',
  '饮食怎么调整？',
  '推荐食谱',
  '训练怎么安排？',
]

const HOME_MEAL_CONTEXT_CHIPS = [
  '刚训练完',
  '想吃清淡',
  '换个口味',
]

type HomeMealChatContext = PetChatEntryContext & {
  meal_label: string
}

function nextID(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function rangeLabel(range: RangeMode): string {
  return range === 'month' ? '最近 30 天' : '最近 7 天'
}

function questionRange(question: string, fallback: RangeMode): RangeMode {
  return /30|月|长期/.test(question) ? 'month' : fallback
}

export function isDietRecommendationQuestion(question: string): boolean {
  const normalized = question.replace(/\s+/g, '')
  return /吃什么|推荐(?:一道|一些|几个)?(?:菜|餐|食物)|附近.*(?:吃|餐|饭|菜)|外卖|(?:北大|清华|大学|学院|学校).*学生|学生.*(?:北大|清华|大学|学院|学校)/.test(normalized)
}

export type DietRecommendationIntent = 'initial' | 'refine' | 'more' | 'location' | 'compare' | 'context'

export function classifyDietRecommendationIntent(question: string, hasActiveRecommendation: boolean): DietRecommendationIntent | null {
  const normalized = question.replace(/\s+/g, '')
  if (/自己做|自炊|家里做|食谱|菜谱/.test(normalized) && !/历史|吃过|记录/.test(normalized)) return null
  if (hasActiveRecommendation) {
    const explicitTopicSwitch = /训练计划|运动计划|训练怎么|训练建议|怎么练|跑步计划|睡眠|作息|喝水|补剂|体检|体重趋势/.test(normalized)
      && !/吃|菜|餐|食堂|饮食/.test(normalized)
    if (explicitTopicSwitch) return null
    if (/在哪|在哪里|哪里|哪个食堂|什么食堂|位置|几楼|楼层|窗口|档口|怎么去/.test(normalized)) return 'location'
    if (/还有|其他|再来|再换|换一批|更多|多推荐|再推荐|别的|另外/.test(normalized)) return 'more'
    if (/(?:哪个|哪道|哪款).*(?:适合|更好|优先|减脂|蛋白|热量)|更适合|热量最低|蛋白最高/.test(normalized)) return 'compare'
    if (/(?:\d+(?:\.\d+)?)(?:元|块|千卡|大卡|卡路里|kcal|卡)|太贵|贵了|便宜|实惠|预算|减脂|减肥|增肌|高蛋白|低脂|清淡|少油|不要|不吃|想吃|刚.*(?:训练|健身|跑)|附近|我在/.test(normalized)) return 'refine'
    if (/刚才|前面|上面|这些|这(?:几|三|五|[0-9０-９]+)个|你推荐的|那几个|各自|分别|解释|为什么|热量|卡路里|蛋白|碳水|脂肪|营养|价格/.test(normalized)) return 'context'
    return 'context'
  }
  return isDietRecommendationQuestion(question) ? 'initial' : null
}

function recommendationSourceIDs(result?: DietRecommendationResult): string[] {
  const ids = (result?.recommendations || [])
    .filter((option) => option.source === 'public_food_library')
    .map((option) => String(option.source_id || '').trim())
    .filter(Boolean)
  return Array.from(new Set(ids))
}

function activeDietRecommendationContext(messages: ChatMessage[]): { latest?: DietRecommendationResult; sourceIDs: string[] } {
  let latest: DietRecommendationResult | undefined
  let sourceIDs: string[] = []
  for (const message of messages) {
    if (message.recommendation) {
      latest = message.recommendation
      sourceIDs = Array.from(new Set([...sourceIDs, ...recommendationSourceIDs(message.recommendation)]))
      continue
    }
    if (latest && message.role === 'user' && !classifyDietRecommendationIntent(message.text, true)) {
      latest = undefined
      sourceIDs = []
    }
  }
  return { latest, sourceIDs }
}

export function inferMealType(question: string, now = new Date()): 'breakfast' | 'lunch' | 'dinner' {
  if (/早餐|早饭|早上/.test(question)) return 'breakfast'
  if (/午餐|午饭|中午/.test(question)) return 'lunch'
  if (/晚餐|晚饭|晚上|夜宵/.test(question)) return 'dinner'
  const minute = now.getHours() * 60 + now.getMinutes()
  if (minute < 10 * 60 + 30) return 'breakfast'
  if (minute < 15 * 60) return 'lunch'
  return 'dinner'
}

function localDateString(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function recommendationLocation(option: DietRecommendationOption): string {
  return [option.school_name, option.campus_name, option.canteen_name || option.merchant_name, option.floor, option.window_name, !option.canteen_name ? option.address : '']
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · ')
}

export function recommendationPrice(option: DietRecommendationOption): string {
  const price = Number(option.price || 0)
  if (!(price > 0)) return ''
  const unit = String(option.price_unit || '').trim().replace(/^元\/?/, '')
  return `¥${Number.isInteger(price) ? price : price.toFixed(1)}${unit ? `/${unit}` : ''}`
}

function creditCostFromError(error: unknown): number | null {
  const match = String((error as Error)?.message || error || '').match(/需要\s*(\d+)\s*积分/)
  if (!match) return null
  const cost = Number(match[1])
  return Number.isFinite(cost) && cost > 0 ? cost : null
}

function buildIntroMessage(petName: string): ChatMessage {
  return {
    id: 'intro',
    role: 'pet',
    kind: 'intro',
    text: `我是${petName}。告诉我最近最想改善的一件事，我会结合你保存的饮食、运动和身体趋势，帮你找出最值得调整的一点。`,
  }
}

function mapHistoryMessage(item: PetChatHistoryMessage): ChatMessage {
  const meta = item.meta || {}
  const recommendation = item.message_type === 'diet_recommendation' && meta.diet_recommendation && typeof meta.diet_recommendation === 'object'
    ? meta.diet_recommendation as DietRecommendationResult
    : undefined
  return {
    id: item.id || nextID('history'),
    role: item.role === 'user' ? 'user' : 'pet',
    kind: item.message_type === 'analysis' ? 'analysis' : item.message_type === 'local' ? 'local' : item.message_type === 'diet_recommendation' ? 'diet_recommendation' : undefined,
    text: item.content || '',
    clues: Array.isArray(meta.clues) ? meta.clues.map(String) : undefined,
    actions: Array.isArray(meta.actions) ? meta.actions.map(String) : undefined,
    recommendation,
    imageUrls: Array.isArray(meta.image_urls) ? meta.image_urls.map(String).filter(Boolean).slice(0, PET_CHAT_MAX_IMAGES) : undefined,
  }
}

export function hasPaidMealRecommendation(messages: PetChatHistoryMessage[] = []): boolean {
  return messages.some((message) => message.message_type === 'diet_recommendation' && Number(message.credits_charged || 0) > 0)
}

function buildHomeMealIntroMessage(context: HomeMealChatContext): ChatMessage {
  return {
    id: 'home-meal-intro',
    role: 'pet',
    kind: 'intro',
    text: context.basic_advice ? `选了${context.basic_advice}。有什么想调整的？` : '这餐想吃什么？也可以告诉我预算或忌口。',
  }
}

function decodeRouteValue(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function getHistorySessionID(session: PetChatSessionSummary): string {
  return String(session.id || '')
}

function formatSessionTime(value?: string): string {
  if (!value) return ''
  const normalized = value.replace('T', ' ')
  return normalized.length >= 16 ? normalized.slice(5, 16) : normalized
}

function splitInsightLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n|。|；|;/)
    .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim())
    .filter(Boolean)
}

function buildClues(summary: StatsSummary | null, insight: string): string[] {
  const clues: string[] = []
  if (summary) {
    clues.push(`${rangeLabel(summary.range === 'month' ? 'month' : 'week')}有 ${summary.recorded_days || 0} 天饮食记录，日均约 ${Math.round(summary.avg_calories_per_day || 0)} kcal`)
    clues.push(`蛋白质 ${Math.round(summary.total_protein || 0)}g，碳水 ${Math.round(summary.total_carbs || 0)}g，脂肪 ${Math.round(summary.total_fat || 0)}g`)
    if (typeof summary.cal_surplus_deficit === 'number') {
      const diff = Math.round(summary.cal_surplus_deficit)
      clues.push(diff >= 0 ? `日均摄入约比 TDEE 高 ${diff} kcal` : `日均摄入约比 TDEE 低 ${Math.abs(diff)} kcal`)
    }
  }
  for (const line of splitInsightLines(insight)) {
    if (clues.length >= 4) break
    if (line.length >= 8 && line.length <= 42) clues.push(line)
  }
  return clues.slice(0, 4)
}

function buildActions(question: string): string[] {
  const q = question.trim()
  if (/微量|钠|钾|钙|铁|镁|锌|纤维|维生素/.test(q)) {
    return ['先看记录里已有的微量字段', '重点盯钠、钾、钙、铁和膳食纤维', '缺字段时不要硬编结论']
  }
  if (/训练|状态|运动/.test(q)) {
    return ['训练日前一餐优先补主食', '训练后 2 小时内补蛋白和碳水', '连续观察 3 天训练体感']
  }
  if (/碳水|主食/.test(q)) {
    return ['把主食集中到早餐和训练前后', '先增加半碗饭或一份土豆', '避免晚餐完全无碳水']
  }
  if (/减脂|体重|卡住/.test(q)) {
    return ['先稳定记录 7 天', '看日均热量而不是单日波动', '保留蛋白质，优先微调零食和饮料']
  }
  return ['先选一个最小改动执行 3 天', '继续记录训练和体感', '下一次让我对比执行前后变化']
}

function PetChatPage() {
  const { scheme } = useAppColorScheme()
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null)
  const [estimatingCredits, setEstimatingCredits] = useState(false)
  const [enableThinking, setEnableThinking] = useState(false)
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([])
  const busyRef = useRef(false)
  const estimateRequestRef = useRef(0)
  const historyLoadedRef = useRef(false)
  const routeLoadedRef = useRef(false)
  const [activeRange, setActiveRange] = useState<RangeMode>('week')
  const [mealLocation, setMealLocation] = useState<PetChatLocation | undefined>(() => currentMealLocation(getAccessToken() || ''))
  const [locatingMeal, setLocatingMeal] = useState(false)
  const [lastAnalysis, setLastAnalysis] = useState<ChatMessage | null>(null)
  const [sessionID, setSessionID] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sessions, setSessions] = useState<PetChatSessionSummary[]>([])
  const [savedSchoolIDs, setSavedSchoolIDs] = useState<string[]>([])
  const [homeMealContext, setHomeMealContext] = useState<HomeMealChatContext | null>(null)
  const [mealUnlocked, setMealUnlocked] = useState(false)
  const homeMealContextRef = useRef<HomeMealChatContext | null>(null)
  const petName = petSummary?.pet?.name || '你的宠物'
  const [messages, setMessages] = useState<ChatMessage[]>([buildIntroMessage('你的宠物')])
  const streamingTextRef = useRef('')
  const streamingDietRecommendationRef = useRef<DietRecommendationResult | null>(null)
  const activeDietContext = useMemo(
    () => activeDietRecommendationContext(messages),
    [messages],
  )
  const latestDietRecommendation = activeDietContext.latest
  const isEmptyConversation = !lastAnalysis && !sessionID && messages.length === 1 && messages[0]?.kind === 'intro'
  const latestMessageID = messages.length > 0 ? `pet-chat-message-${messages[messages.length - 1].id}` : ''
  const imageUploading = pendingImages.some((item) => item.uploading)
  const readyImageURLs = useMemo(
    () => pendingImages.map((item) => item.remoteUrl).filter((value): value is string => Boolean(value)),
    [pendingImages],
  )
  const draftQuestion = input.trim() || (readyImageURLs.length > 0 ? DEFAULT_IMAGE_QUESTION : '')

  useLoad((options) => {
    if (routeLoadedRef.current) return
    routeLoadedRef.current = true
    const starter = decodeRouteValue(options?.starter)
    if (options?.entry === 'home_next_meal') {
      const mealType = decodeRouteValue(options?.meal_type)
      if (mealType === 'breakfast' || mealType === 'lunch' || mealType === 'dinner') {
        const context: HomeMealChatContext = {
          source: 'home_next_meal',
          date: decodeRouteValue(options?.date),
          meal_type: mealType,
          meal_label: decodeRouteValue(options?.meal_label) || (mealType === 'breakfast' ? '早餐' : mealType === 'lunch' ? '午餐' : '晚餐'),
          basic_advice: decodeRouteValue(options?.advice),
          selected_source_id: decodeRouteValue(options?.meal_id),
        }
        homeMealContextRef.current = context
        setHomeMealContext(context)
        setMessages([buildHomeMealIntroMessage(context)])
      }
    }
    if (starter) setInput(starter)
  })

  useDidShow(() => {
    setMealLocation(currentMealLocation(getAccessToken() || ''))
    applyThemeNavigationBar(scheme)
    void Promise.all([
      getStatsSummary('week').then(setSummary).catch(() => null),
      getPetSummary().then(setPetSummary).catch(() => null),
      getHealthProfile().then((profile) => {
        const health = profile.health_condition
        const schoolID = health?.is_student === true
          ? health.campus_dining_preference?.school_id
          : ''
        setSavedSchoolIDs(schoolID ? [schoolID] : [])
      }).catch(() => null),
      (async () => {
        if (historyLoadedRef.current) return
        historyLoadedRef.current = true
        // A homepage meal is a new explicit focus, not just today's meal type.
        // Restoring a session by date/type can replace this meal with an old
        // recommendation or failure. Keep old sessions available in Recent;
        // follow-ups in this page still reuse the session created on first send.
        if (homeMealContextRef.current) return
        const history = await getLatestPetChatSession().catch(() => null)
        if (!history?.messages?.length) return
        const restored = history.messages.map(mapHistoryMessage).filter((item) => item.text.trim() || item.imageUrls?.length)
        if (!restored.length) return
        const restoredSessionID = history.session?.id || history.session?.ID || ''
        setSessionID(restoredSessionID)
        setMessages(restored)
        const latestPetMessage = [...restored].reverse().find((item) => item.role === 'pet') || null
        setLastAnalysis(latestPetMessage)
        const restoredRange = history.session?.range_type || history.session?.RangeType
        if (restoredRange === 'week' || restoredRange === 'month') setActiveRange(restoredRange)
      })(),
    ])
  })

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: `和${petName}聊聊` })
    setMessages((prev) => {
      if (homeMealContextRef.current) return prev
      if (prev.length === 1 && prev[0]?.kind === 'intro') return [buildIntroMessage(petName)]
      return prev
    })
  }, [petName])

  useEffect(() => {
    const question = draftQuestion
    const requestID = estimateRequestRef.current + 1
    estimateRequestRef.current = requestID
    if (!question) {
      setEstimatedCredits(null)
      setEstimatingCredits(false)
      return
    }
    if (readyImageURLs.length === 0 && classifyDietRecommendationIntent(question, Boolean(homeMealContext || latestDietRecommendation))) {
      setEstimatedCredits(homeMealContext || mealUnlocked ? 0 : 1)
      setEstimatingCredits(false)
      return
    }

    setEstimatedCredits(null)
    setEstimatingCredits(true)
    const timer = setTimeout(() => {
      void estimatePetChat(question, questionRange(question, activeRange), enableThinking, readyImageURLs)
        .then((result) => {
          if (estimateRequestRef.current !== requestID) return
          setEstimatedCredits(result.pricing.credits_charged)
        })
        .catch((error) => {
          if (estimateRequestRef.current !== requestID) return
          setEstimatedCredits(creditCostFromError(error))
        })
        .finally(() => {
          if (estimateRequestRef.current === requestID) setEstimatingCredits(false)
        })
    }, 350)

    return () => clearTimeout(timer)
  }, [activeRange, draftQuestion, enableThinking, homeMealContext, latestDietRecommendation, mealUnlocked, readyImageURLs])

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message])
  }, [])

  const updateMessage = useCallback((id: string, updater: (message: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)))
  }, [])

  const startNewConversation = useCallback(() => {
    if (busyRef.current) return
    setHistoryOpen(false)
    setInput('')
    setPendingImages([])
    setLastAnalysis(null)
    setSessionID('')
    setMealUnlocked(false)
    setHomeMealContext(null)
    homeMealContextRef.current = null
    setMessages([buildIntroMessage(petName)])
    Taro.showToast({ title: '已新建对话', icon: 'none' })
  }, [petName])

  const applyHistory = useCallback((history: Awaited<ReturnType<typeof getLatestPetChatSession>>) => {
    const restored = history?.messages?.map(mapHistoryMessage).filter((item) => item.text.trim() || item.imageUrls?.length) || []
    if (!restored.length) return false
    const restoredSessionID = history?.session?.id || history?.session?.ID || ''
    setSessionID(restoredSessionID)
    setMessages(restored)
    const latestPetMessage = [...restored].reverse().find((item) => item.role === 'pet') || null
    setLastAnalysis(latestPetMessage)
    setMealUnlocked(Boolean(homeMealContextRef.current) && hasPaidMealRecommendation(history?.messages))
    const restoredRange = history?.session?.range_type || history?.session?.RangeType
    if (restoredRange === 'week' || restoredRange === 'month') setActiveRange(restoredRange)
    return true
  }, [])

  const openHistoryPanel = useCallback(async () => {
    if (busyRef.current) return
    setHistoryOpen(true)
    setHistoryLoading(true)
    try {
      const data = await listPetChatSessions()
      setSessions(data.sessions || [])
    } catch (error) {
      await showUnifiedApiError(error, '读取对话列表失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const openSession = useCallback(async (targetSessionID: string) => {
    if (!targetSessionID || busyRef.current) return
    setHistoryLoading(true)
    try {
      const history = await getPetChatSession(targetSessionID)
      if (applyHistory(history)) {
        setHistoryOpen(false)
      } else {
        Taro.showToast({ title: '这条对话暂无内容', icon: 'none' })
      }
    } catch (error) {
      await showUnifiedApiError(error, '打开对话失败')
    } finally {
      setHistoryLoading(false)
    }
  }, [applyHistory])

  const runAnalysis = useCallback(async (question: string, range: RangeMode, imageUrls: string[]) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    streamingTextRef.current = ''
    streamingDietRecommendationRef.current = null

    setActiveRange(range)
    appendMessage({ id: nextID('user'), role: 'user', text: question, imageUrls })
    const streamingMessageID = nextID('pet-stream')
    appendMessage({ id: streamingMessageID, role: 'pet', kind: 'analysis', text: '' })

    let nextSummary: StatsSummary | null = summary?.range === range ? summary : null

    const finish = () => {
      busyRef.current = false
      setBusy(false)
      streamingTextRef.current = ''
      streamingDietRecommendationRef.current = null
    }

    const callbacks: StreamGeneratePetChatCallbacks = {
      onStart: () => {
        // first chunk will arrive soon
      },
      // Keep the visual thinking animation until answer text arrives.
      // Internal retrieval steps are not assistant replies.
      onDietResult: (result) => {
        streamingDietRecommendationRef.current = result.recommendation
        updateMessage(streamingMessageID, (message) => ({
          ...message,
          kind: 'diet_recommendation',
          recommendation: result.recommendation,
        }))
      },
      onChunk: (text) => {
        streamingTextRef.current += text
        updateMessage(streamingMessageID, (message) => ({ ...message, text: streamingTextRef.current }))
      },
      onDone: (meta) => {
        if (meta.session_id) setSessionID(meta.session_id)
        const finalText = streamingTextRef.current || '我看完了，但这次没有生成足够明确的结论。可以先多记录几餐再试。'
        const recommendation = streamingDietRecommendationRef.current || undefined
        const message: ChatMessage = {
          id: streamingMessageID,
          role: 'pet',
          kind: recommendation ? 'diet_recommendation' : 'analysis',
          text: finalText,
          clues: recommendation ? undefined : buildClues(nextSummary, finalText),
          actions: recommendation ? undefined : buildActions(question),
          recommendation,
        }
        if (homeMealContext && recommendation && meta.credits_charged > 0) setMealUnlocked(true)
        setLastAnalysis(message)
        updateMessage(streamingMessageID, () => message)
        finish()
        if (!recommendation && !nextSummary) {
          getStatsSummary(range)
            .then((next) => {
              nextSummary = next
              setSummary(next)
              updateMessage(streamingMessageID, (current) => ({
                ...current,
                clues: buildClues(next, finalText),
              }))
            })
            .catch(() => null)
        }
      },
      onError: async (error) => {
        await showUnifiedApiError(error, `${petName}分析失败`)
        updateMessage(streamingMessageID, () => ({
          id: nextID('pet'),
          role: 'pet',
          kind: 'local',
          text: `${petName}这次没能顺利读完记录。你可以稍后再试，或者先换成最近 7 天的小范围分析。`,
          actions: ['换最近 7 天', '稍后再试'],
        }))
        finish()
      },
    }
    const location = currentMealLocation(getAccessToken() || '')
    if (mealLocation && !location) setMealLocation(undefined)
    streamGeneratePetChat(question, range, sessionID, !sessionID, callbacks, enableThinking, imageUrls, homeMealContext || undefined, location)
  }, [appendMessage, enableThinking, homeMealContext, mealLocation, petName, sessionID, summary, updateMessage])

  const locateForMeal = useCallback(async () => {
    if (busyRef.current || locatingMeal) return
    setLocatingMeal(true)
    const owner = getAccessToken() || ''
    try {
      await ensureWeappPrivacyAuthorized()
      const fix = await Taro.getLocation({ type: 'gcj02' })
      if (owner !== getAccessToken()) return
      const location = rememberMealLocation(owner, { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy, captured_at: Date.now(), coordinate_type: 'gcj02' })
      if (!location) throw new Error('定位精度不足，请重新定位或直接输入学校和校区')
      setMealLocation(location)
      setInput((current) => current.trim() || '帮我结合近期饮食和当前目标，选一下附近这餐吃什么')
    } catch (error) {
      rememberMealLocation(owner)
      setMealLocation(undefined)
      await showUnifiedApiError(error, '无法获取位置，也可以直接输入学校和校区')
    } finally {
      setLocatingMeal(false)
    }
  }, [locatingMeal])

  const uploadChatImage = useCallback(async (image: PendingChatImage) => {
    try {
      const uploadPath = await compressImagePathForUpload(image.localPath, { maxLongEdge: 2048 })
      const { imageUrl } = await uploadAnalyzeImageFile(uploadPath || image.localPath)
      setEstimatedCredits(null)
      setPendingImages((current) => current.map((item) => (
        item.id === image.id ? { ...item, remoteUrl: imageUrl, uploading: false } : item
      )))
    } catch (error) {
      setPendingImages((current) => current.filter((item) => item.id !== image.id))
      await showUnifiedApiError(error, '图片上传失败')
    }
  }, [])

  const handleChooseImages = useCallback(async () => {
    if (busyRef.current) return
    const remaining = PET_CHAT_MAX_IMAGES - pendingImages.length
    if (remaining <= 0) {
      Taro.showToast({ title: `最多添加 ${PET_CHAT_MAX_IMAGES} 张图片`, icon: 'none' })
      return
    }
    try {
      const chosen = await chooseImageWithPrivacy({
        count: remaining,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const additions = (chosen.tempFilePaths || []).slice(0, remaining).map((localPath) => ({
        id: nextID('pet-image'),
        localPath,
        uploading: true,
      }))
      if (!additions.length) return
      setEstimatedCredits(null)
      setPendingImages((current) => [...current, ...additions].slice(0, PET_CHAT_MAX_IMAGES))
      await Promise.all(additions.map(uploadChatImage))
    } catch (error) {
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
        return
      }
      await showUnifiedApiError(error, '选择图片失败')
    }
  }, [pendingImages.length, uploadChatImage])

  const previewImage = useCallback((current: string, urls: string[]) => {
    if (!current || !urls.length) return
    void Taro.previewImage({ current, urls })
  }, [])

  const removePendingImage = useCallback((id: string) => {
    setEstimatedCredits(null)
    setPendingImages((current) => current.filter((item) => item.id !== id))
  }, [])

  const openRecommendationDetail = useCallback(async (option: DietRecommendationOption) => {
    let target = option
    if (option.source === 'meal_plan' && option.meal_components?.length) {
      const components = option.meal_components.slice(0, 4)
      try {
        const { tapIndex } = await Taro.showActionSheet({ itemList: components.map((item) => item.title) })
        target = components[tapIndex]
      } catch { return }
    }
    const itemID = String(target?.source_id || '').trim()
    if (!itemID || target.source !== 'public_food_library') return
    Taro.navigateTo({
      url: `${extraPkgUrl('/pages/food-library-detail/index')}?id=${encodeURIComponent(itemID)}${target.is_campus_food ? '&scene=campus' : ''}`,
    })
  }, [])

  const saveCampusPreference = useCallback(async (result: DietRecommendationResult) => {
    const school = result.resolved_school
    if (!school?.id || savedSchoolIDs.includes(school.id)) return
    const { confirm } = await Taro.showModal({
      title: '确认学生学校',
      content: `如果你是${school.name}在校学生，确认后会优先为你推荐本校食堂。`,
      confirmText: '我是本校学生',
    })
    if (!confirm) return
    try {
      await updateHealthProfile({
        is_student: true,
        campus_dining_preference: {
          school_id: school.id,
          campus_id: result.campus_id || undefined,
        },
      })
      setSavedSchoolIDs((previous) => [...previous, school.id])
      Taro.showToast({ title: '学生学校已确认', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '保存常用学校失败')
    }
  }, [savedSchoolIDs])

  const handleSend = useCallback(() => {
    const text = draftQuestion
    if (!text || busy || busyRef.current || imageUploading || estimatingCredits || estimatedCredits === null) return
    const imageUrls = [...readyImageURLs]
    setInput('')
    setPendingImages([])
    const range = questionRange(text, activeRange)
    void runAnalysis(text, range, imageUrls)
  }, [activeRange, busy, draftQuestion, estimatedCredits, estimatingCredits, imageUploading, readyImageURLs, runAnalysis])

  const appendHomeMealContext = useCallback((label: string) => {
    setInput((current) => {
      const base = current.trim()
      if (!base) return label
      if (base.includes(label)) return base
      return /[。！？!?]$/.test(base) ? `${base} 补充：${label}` : `${base}，${label}`
    })
  }, [])

  const canSend = Boolean(draftQuestion) && !busy && !imageUploading && !estimatingCredits && estimatedCredits !== null

  return (
    <View className={`pet-chat-page ${scheme === 'dark' ? 'pet-chat-page--dark' : ''}`}>
      <View className='pet-chat-topbar'>
        <View className='pet-chat-identity' onClick={openPetSettings}>
          <PetAvatar pet={petSummary?.pet} size={72} mood={petSummary?.status?.mood} state={petSummary?.status?.state} />
          <View className='pet-chat-identity-copy'>
            <Text className='pet-chat-identity-name'>{petName}</Text>
          </View>
        </View>
        <View className='pet-chat-top-actions'>
          <View className='pet-chat-history-button' onClick={openHistoryPanel}>
            <Text>最近</Text>
          </View>
          <View className={`pet-chat-new-button ${isEmptyConversation ? 'disabled' : ''}`} onClick={isEmptyConversation ? undefined : startNewConversation}>
            <Text>新对话</Text>
          </View>
        </View>
      </View>

      <ScrollView className='pet-chat-scroll' scrollY enhanced showScrollbar={false} scrollIntoView={latestMessageID}>
        <View className='pet-chat-messages'>
          {messages.map((message) => (
            <View id={`pet-chat-message-${message.id}`} key={message.id} className={`pet-chat-message ${message.role}`}>
              <View className='pet-chat-bubble'>
                {message.role === 'user' && message.imageUrls?.length ? (
                  <View className='pet-chat-message-images'>
                    {message.imageUrls.map((url) => (
                      <Image
                        key={url}
                        className='pet-chat-message-image'
                        src={url}
                        mode='aspectFill'
                        onClick={() => previewImage(url, message.imageUrls || [])}
                      />
                    ))}
                  </View>
                ) : null}
                {message.role === 'pet' ? (
                  message.text ? (
                    <PetMarkdown text={message.recommendation?.generated_by === 'foodlink-grounded-meals-v1' && message.recommendation.recommendations?.length ? '这几份可以参考。想换口味，还是调整份量？' : message.text} />
                  ) : (
                    <View className='pet-chat-thinking-bubble'>
                      <View className='pet-chat-thinking-dot' />
                      <View className='pet-chat-thinking-dot' />
                      <View className='pet-chat-thinking-dot' />
                    </View>
                  )
                ) : (
                  <Text className='pet-chat-message-text'>{message.text}</Text>
                )}
                {message.role === 'pet' && message.recommendation ? (
                  <MealSuggestions result={message.recommendation} onOpen={openRecommendationDetail} onSaveSchool={result => void saveCampusPreference(result)} savedSchoolIDs={savedSchoolIDs} />
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View className='pet-chat-bottom-dock'>
        {toolsOpen && <View className='pet-chat-composer-options'>
        <View className='pet-chat-location-row'>
          <View className='pet-chat-location-button' onClick={() => void locateForMeal()}>
            {locatingMeal ? <View className='pet-chat-location-spinner' /> : <Text>{mealLocation ? '更新位置' : '使用当前位置'}</Text>}
          </View>
          {mealLocation ? <Text className='pet-chat-location-clear' onClick={() => { rememberMealLocation(getAccessToken() || ''); setMealLocation(undefined) }}>取消定位</Text> : null}
        </View>
        <View className='pet-chat-thinking-switch-row'>
          <View className='pet-chat-thinking-switch-copy'>
            <Text className='pet-chat-thinking-switch-title'>深度思考</Text>
          </View>
          <Switch
            className='pet-chat-thinking-switch'
            checked={enableThinking}
            disabled={busy}
            color='#55a77c'
            aria-label='深度思考开关'
            onChange={(event) => setEnableThinking(Boolean(
              event.detail?.value ?? (event.currentTarget as unknown as { checked?: boolean }).checked
            ))}
          />
        </View>
        </View>}
        {isEmptyConversation && <ScrollView className='pet-chat-quick-row' scrollX enhanced showScrollbar={false}>
          <View className='pet-chat-quick-row-inner'>
            {(homeMealContext ? HOME_MEAL_CONTEXT_CHIPS : FOLLOW_UPS).map((text) => (
              <View
                key={text}
                className='pet-chat-quick-chip follow'
                onClick={() => homeMealContext ? appendHomeMealContext(text) : setInput(text)}
              >
                <Text>{text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>}

        {pendingImages.length > 0 ? (
          <ScrollView className='pet-chat-image-draft-scroll' scrollX enhanced showScrollbar={false}>
            <View className='pet-chat-image-draft-list'>
              {pendingImages.map((image) => (
                <View key={image.id} className='pet-chat-image-draft'>
                  <Image
                    className='pet-chat-image-draft-preview'
                    src={image.localPath}
                    mode='aspectFill'
                    onClick={() => previewImage(image.localPath, pendingImages.map((item) => item.localPath))}
                  />
                  {image.uploading ? (
                    <View className='pet-chat-image-upload-mask' aria-label='图片正在上传'>
                      <View className='pet-chat-image-upload-spinner' />
                    </View>
                  ) : null}
                  <View className='pet-chat-image-remove' onClick={() => removePendingImage(image.id)}>
                    <Text>×</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}

        <View className='pet-chat-input-bar'>
          <View aria-label='上传照片' className={`pet-chat-image-button ${busy || pendingImages.length >= PET_CHAT_MAX_IMAGES ? 'disabled' : ''}`} onClick={() => void handleChooseImages()}>
            <Text className='iconfont icon-picture' />
          </View>
          <Input
            className='pet-chat-input'
            value={input}
            placeholder={lastAnalysis ? `继续问${petName}...` : `和${petName}聊聊...`}
            placeholderClass='pet-chat-input-placeholder'
            confirmType='send'
            onInput={(event) => setInput(String(event.detail.value || ''))}
            onConfirm={handleSend}
            disabled={busy}
          />
          <View className={`pet-chat-tools-button${toolsOpen ? ' is-active' : ''}`} aria-label='定位与深度思考选项' onClick={() => setToolsOpen(value => !value)}><Text>···</Text></View>
          <View aria-label='发送' className={`pet-chat-send ${canSend ? '' : 'disabled'}`} onClick={handleSend}>
            {busy ? <View className='pet-chat-location-spinner' /> : <Text>↑</Text>}
          </View>
        </View>
        {draftQuestion && estimatedCredits !== null && estimatedCredits > 0 ? (
          <Text className='pet-chat-credit-cost'>
            预计消耗 {estimatedCredits} 积分
          </Text>
        ) : null}
      </View>

      {historyOpen ? (
        <View className='pet-chat-history-panel'>
          <View className='pet-chat-history-mask' onClick={() => setHistoryOpen(false)} />
          <View className='pet-chat-history-sheet'>
            <View className='pet-chat-history-head'>
              <Text className='pet-chat-history-title'>最近对话</Text>
              <View className='pet-chat-history-new' onClick={startNewConversation}>
                <Text>新对话</Text>
              </View>
            </View>
            <ScrollView className='pet-chat-history-list' scrollY enhanced showScrollbar={false}>
              {historyLoading ? (
                <View className='pet-chat-history-skeleton' aria-label='正在读取最近对话'>
                  {[0, 1, 2].map((item) => (
                    <View key={item} className='pet-chat-history-skeleton-item'>
                      <View className='pet-chat-history-skeleton-title' />
                      <View className='pet-chat-history-skeleton-line' />
                    </View>
                  ))}
                </View>
              ) : sessions.length === 0 ? (
                <View className='pet-chat-history-empty'>
                  <Text>还没有历史对话</Text>
                </View>
              ) : sessions.map((session) => {
                const itemID = getHistorySessionID(session)
                const active = itemID && itemID === sessionID
                return (
                  <View key={itemID} className={`pet-chat-history-item ${active ? 'active' : ''}`} onClick={() => openSession(itemID)}>
                    <Text className='pet-chat-history-item-title' numberOfLines={1}>{session.title || session.last_question || '未命名对话'}</Text>
                    <Text className='pet-chat-history-item-desc' numberOfLines={1}>{session.last_question || session.last_answer || '饮食分析对话'}</Text>
                    <Text className='pet-chat-history-item-meta'>{formatSessionTime(session.last_message_at || session.updated_at)}</Text>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export default withAuth(PetChatPage)
