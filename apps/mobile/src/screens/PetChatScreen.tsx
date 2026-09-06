import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RouteProp } from '@react-navigation/native'
import { fetch as expoFetch } from 'expo/fetch'
import Svg, { Circle as SvgCircle, Defs, LinearGradient as SvgLinearGradient, Rect as SvgRect, Stop } from 'react-native-svg'
import { PetChatStreamError, type PetChatStreamFetch } from '@food-link/api-client'
import type {
  DietRecommendationOption,
  DietRecommendationResult,
  PetChatHistoryMessage,
  PetChatHistoryResponse,
  PetChatSessionSummary,
  PetSummary,
  StatsRange,
  StatsSummary,
} from '@food-link/core'
import { apiClient } from '../api'
import { PetAvatar } from '../components/PetAvatar'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'
import type { RootStackParamList } from '../navigation/types'

type ChatRole = 'pet' | 'user'

type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  clues?: string[]
  actions?: string[]
  recommendation?: DietRecommendationResult
}

const QUICK_QUESTIONS: Array<{ text: string; range: StatsRange }> = [
  { text: '今天吃什么', range: 'week' },
  { text: '最近训练状态下滑了，帮我找原因', range: 'week' },
  { text: '帮我找最该优化的一点', range: 'week' },
  { text: '最近总饿，是不是吃法有问题', range: 'week' },
  { text: '看最近 30 天规律', range: 'month' },
]

const FOLLOW_UPS = [
  '今天吃什么',
  '能不能只看微量元素',
  '帮我安排训练日前一天怎么吃',
  '碳水是不是偏低',
  '给我一个明天能执行的小目标',
]

const mobilePetChatStreamFetch: PetChatStreamFetch = (url, init) => expoFetch(url, init)

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function rangeLabel(range: StatsRange): string {
  return range === 'month' ? '最近 30 天' : '最近 7 天'
}

function buildIntroMessage(petName: string): ChatMessage {
  return {
    id: 'intro',
    role: 'pet',
    text: `我是${petName}。你直接说最近哪里不对劲就行，比如训练没劲、总是饿、减脂卡住，或者想知道明天怎么吃。我只看你保存过的饮食文字和营养数据，不看图片，也不会替你下诊断。`,
    actions: ['先说一个最近的困惑', '也可以直接问训练和饥饿感'],
  }
}

function historyRecommendation(item: PetChatHistoryMessage): DietRecommendationResult | undefined {
  const candidate = item.message_type === 'diet_recommendation' ? item.meta?.diet_recommendation : undefined
  return candidate && typeof candidate === 'object' ? candidate as DietRecommendationResult : undefined
}

function mapHistoryMessage(item: PetChatHistoryMessage): ChatMessage {
  const meta = item.meta || {}
  return {
    id: item.id || nextId('history'),
    role: item.role === 'user' ? 'user' : 'pet',
    text: item.content || '',
    clues: Array.isArray(meta.clues) ? meta.clues.map(String) : undefined,
    actions: Array.isArray(meta.actions) ? meta.actions.map(String) : undefined,
    recommendation: historyRecommendation(item),
  }
}

function isDietRecommendationQuestion(question: string): boolean {
  const normalized = question.replace(/\s+/g, '')
  return /吃什么|推荐(?:一道|一些|几个)?(?:菜|餐|食物)|食堂|校园餐|减脂餐|增肌餐/.test(normalized)
}

function isDietRecommendationContextQuestion(question: string, hasActiveRecommendation: boolean): boolean {
  const normalized = question.replace(/\s+/g, '')
  if (!hasActiveRecommendation) return isDietRecommendationQuestion(normalized)
  const switchesTopic = /训练|运动|跑步|力量|睡眠|作息|喝水|补剂|体检|体重趋势/.test(normalized)
    && !/吃|菜|餐|食堂|饮食/.test(normalized)
  if (switchesTopic) return false
  return isDietRecommendationQuestion(normalized)
    || /还有|其他|再来|换一批|更多|刚才|前面|上面|这些|这几个|你推荐的|哪个更好|热量|蛋白|碳水|脂肪|价格|哪里|在哪/.test(normalized)
}

function recommendationLocation(option: DietRecommendationOption): string {
  return [option.campus_name, option.canteen_name, option.floor, option.window_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · ')
}

function recommendationPrice(option: DietRecommendationOption): string {
  const price = Number(option.price || 0)
  if (!(price > 0)) return ''
  const unit = String(option.price_unit || '').trim().replace(/^元\/?/, '')
  return `¥${Number.isInteger(price) ? price : price.toFixed(1)}${unit ? `/${unit}` : ''}`
}

function recommendationSourceLabel(result: DietRecommendationResult): string {
  if (result.ai_used) return `真实校园食物库 · Agent 核对 ${result.ai_rerank_count || 0} 道`
  const hasCampusFood = (result.recommendations || []).some((option) => option.is_campus_food)
  if (hasCampusFood) {
    return result.generated_by === 'campus_agent_database_fallback'
      ? '真实校园食物库 · 数据库兜底 · 未扣积分'
      : '真实校园食物库 · 规则兜底'
  }
  return result.generated_by === 'campus_agent_database_fallback'
    ? '真实校园食物库 · 当前条件无匹配 · 未扣积分'
    : '本校暂无匹配菜品'
}

function sessionId(session?: PetChatSessionSummary | null): string {
  return String(session?.id || session?.ID || '')
}

function historySessionId(history?: PetChatHistoryResponse | null): string {
  return String(history?.session?.id || history?.session?.ID || '')
}

function sessionRange(history?: PetChatHistoryResponse | null): StatsRange | null {
  const range = history?.session?.range_type || history?.session?.RangeType
  return range === 'week' || range === 'month' ? range : null
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
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
}

function buildClues(summary: StatsSummary | null, insight: string): string[] {
  const clues: string[] = []
  if (summary) {
    clues.push(`${rangeLabel(summary.range)}有 ${summary.recorded_days || 0} 天饮食记录，日均约 ${Math.round(summary.avg_calories_per_day || 0)} kcal`)
    clues.push(`蛋白质 ${Math.round(summary.total_protein || 0)}g，碳水 ${Math.round(summary.total_carbs || 0)}g，脂肪 ${Math.round(summary.total_fat || 0)}g`)
    if (typeof summary.cal_surplus_deficit === 'number') {
      const diff = Math.round(summary.cal_surplus_deficit)
      clues.push(diff >= 0 ? `日均摄入约比 TDEE 高 ${diff} kcal` : `日均摄入约比 TDEE 低 ${Math.abs(diff)} kcal`)
    }
  }
  for (const line of splitInsightLines(insight)) {
    if (clues.length >= 4) break
    if (line.length >= 8 && line.length <= 44) clues.push(line)
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
  return ['先选一个最小改动执行 3 天', '继续记录训练和体感', '下次让我对比执行前后变化']
}

function shouldFallbackFromStream(error: unknown): boolean {
  if (!(error instanceof PetChatStreamError)) return true
  if (error.code === 'transport' || error.code === 'timeout' || error.code === 'protocol' || error.code === 'unsupported') return true
  return error.code === 'http' && [404, 405, 501].includes(error.status || 0)
}

function recoverPersistedPetAnswer(history: PetChatHistoryResponse | null | undefined, question: string): { answer: string; sessionId: string } | null {
  const items = history?.messages || []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.role !== 'user' || item.content.trim() !== question.trim()) continue
    const answer = items.slice(index + 1).find((candidate) => candidate.role === 'assistant' || candidate.role === 'pet')
    if (!answer?.content.trim()) return null
    return { answer: answer.content, sessionId: historySessionId(history) }
  }
  return null
}

export function PetChatScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'PetChat'>>()
  const route = useRoute<RouteProp<RootStackParamList, 'PetChat'>>()
  const dialog = useAppDialog()
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [statsSummary, setStatsSummary] = useState<StatsSummary | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState(() => String(route.params?.starterQuestion || '').trim())
  const [activeRange, setActiveRange] = useState<StatsRange>('week')
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sessions, setSessions] = useState<PetChatSessionSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enableThinking, setEnableThinking] = useState(false)
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null)
  const [estimatingCredits, setEstimatingCredits] = useState(false)
  const [savedSchoolIds, setSavedSchoolIds] = useState<string[]>([])
  const [streamingMessageId, setStreamingMessageId] = useState('')
  const busyRef = useRef(false)
  const estimateRequestRef = useRef(0)
  const historyLoadedRef = useRef(false)
  const chatScrollRef = useRef<ScrollView | null>(null)
  const activeRequestIdRef = useRef('')
  const streamingMessageIdRef = useRef('')
  const streamAbortRef = useRef<AbortController | null>(null)

  const petName = petSummary?.pet?.name || '成长伙伴'
  const hasAnalysis = useMemo(() => messages.some((item) => item.role === 'pet' && item.id !== 'intro'), [messages])
  const latestRecommendation = useMemo(
    () => [...messages].reverse().find((message) => message.recommendation)?.recommendation,
    [messages],
  )

  const showError = useCallback((title: string, error: unknown) => {
    void dialog.alert(title, userFacingErrorMessage(error), 'danger')
  }, [dialog])

  const applyHistory = useCallback((history: PetChatHistoryResponse | null | undefined) => {
    const restored = history?.messages?.map(mapHistoryMessage).filter((item) => item.text.trim()) || []
    if (!restored.length) return false
    setMessages(restored)
    setActiveSessionId(historySessionId(history))
    const restoredRange = sessionRange(history)
    if (restoredRange) setActiveRange(restoredRange)
    return true
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [petData, statsData, healthProfile] = await Promise.all([
        apiClient.getPetSummary(),
        apiClient.getStatsSummary(activeRange).catch(() => null),
        apiClient.getHealthProfile().catch(() => null),
      ])
      const condition = healthProfile?.health_condition as Record<string, unknown> | undefined
      const preference = condition?.campus_dining_preference as Record<string, unknown> | undefined
      const savedSchoolId = String(preference?.school_id || '').trim()
      if (savedSchoolId) setSavedSchoolIds((previous) => (
        previous.includes(savedSchoolId) ? previous : [...previous, savedSchoolId]
      ))
      setPetSummary(petData)
      setStatsSummary(statsData)
      if (!historyLoadedRef.current) {
        historyLoadedRef.current = true
        const history = await apiClient.getLatestPetChatSession().catch(() => null)
        if (!applyHistory(history)) {
          setMessages([buildIntroMessage(petData.pet?.name || '成长伙伴')])
        }
      }
    } catch (error) {
      showError('获取伙伴对话失败', error)
      setMessages((prev) => prev.length ? prev : [buildIntroMessage(petName)])
    } finally {
      setLoading(false)
    }
  }, [activeRange, applyHistory, petName, showError])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useEffect(() => {
    navigation.setOptions({ title: `和${petName}聊聊` })
    setMessages((prev) => {
      if (prev.length === 0) return [buildIntroMessage(petName)]
      if (prev.length === 1 && prev[0]?.id === 'intro') return [buildIntroMessage(petName)]
      return prev
    })
  }, [navigation, petName])

  useEffect(() => () => {
    activeRequestIdRef.current = ''
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    busyRef.current = false
  }, [])

  useEffect(() => {
    const question = input.trim()
    const requestId = estimateRequestRef.current + 1
    estimateRequestRef.current = requestId
    if (!question) {
      setEstimatedCredits(null)
      setEstimatingCredits(false)
      return
    }
    if (isDietRecommendationContextQuestion(question, Boolean(latestRecommendation))) {
      setEstimatedCredits(1)
      setEstimatingCredits(false)
      return
    }
    setEstimatedCredits(null)
    setEstimatingCredits(true)
    const timer = setTimeout(() => {
      void apiClient.estimatePetChat(question, /30|月|长期/.test(question) ? 'month' : activeRange, enableThinking)
        .then((result) => {
          if (estimateRequestRef.current !== requestId) return
          setEstimatedCredits(Number(result.pricing?.credits_charged ?? result.estimated_credits ?? 0))
        })
        .catch((error) => {
          if (estimateRequestRef.current !== requestId) return
          const match = userFacingErrorMessage(error).match(/需要\s*(\d+)\s*积分/)
          setEstimatedCredits(match ? Number(match[1]) : null)
        })
        .finally(() => {
          if (estimateRequestRef.current === requestId) setEstimatingCredits(false)
        })
    }, 350)
    return () => clearTimeout(timer)
  }, [activeRange, enableThinking, input, latestRecommendation])

  const openHistory = useCallback(async () => {
    if (busyRef.current) return
    const nextOpen = !historyOpen
    setHistoryOpen(nextOpen)
    if (!nextOpen) return
    setHistoryLoading(true)
    try {
      const data = await apiClient.listPetChatSessions()
      setSessions(data.sessions || [])
    } catch (error) {
      showError('读取最近对话失败', error)
    } finally {
      setHistoryLoading(false)
    }
  }, [historyOpen, showError])

  const openSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId || busyRef.current) return
    setHistoryLoading(true)
    try {
      const history = await apiClient.getPetChatSession(targetSessionId)
      if (applyHistory(history)) setHistoryOpen(false)
      else void dialog.alert('这条对话暂无内容', '可以新建一次对话，再让伙伴继续分析。', 'info')
    } catch (error) {
      showError('打开对话失败', error)
    } finally {
      setHistoryLoading(false)
    }
  }, [applyHistory, dialog, showError])

  const startNewConversation = useCallback(() => {
    if (busyRef.current) return
    setInput('')
    setActiveSessionId('')
    setHistoryOpen(false)
    setMessages([buildIntroMessage(petName)])
  }, [petName])

  const openRecommendationDetail = useCallback((option: DietRecommendationOption) => {
    const itemId = String(option.source_id || '').trim()
    if (!itemId || option.source !== 'public_food_library') return
    navigation.navigate('PublicFoodDetail', { itemId, isCampus: Boolean(option.is_campus_food) })
  }, [navigation])

  const saveCampusPreference = useCallback(async (result: DietRecommendationResult) => {
    const school = result.resolved_school
    if (!school?.id || savedSchoolIds.includes(school.id)) return
    const confirmed = await dialog.confirm({
      title: '设为常用学校',
      message: `以后没有特别说明时，优先推荐${school.name}的校园餐。`,
      cancelText: '暂不保存',
      confirmText: '确认保存',
    })
    if (!confirmed) return
    try {
      await apiClient.updateHealthProfile({
        campus_dining_preference: {
          school_id: school.id,
          campus_id: result.campus_id || undefined,
        },
      })
      setSavedSchoolIds((previous) => previous.includes(school.id) ? previous : [...previous, school.id])
      await dialog.alert('已设为常用学校', `之后会优先推荐${school.name}的校园餐。`, 'success')
    } catch (error) {
      showError('保存常用学校失败', error)
    }
  }, [dialog, savedSchoolIds, showError])

  const cancelGeneration = useCallback(() => {
    if (!busyRef.current) return
    const messageId = streamingMessageIdRef.current
    activeRequestIdRef.current = ''
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    busyRef.current = false
    setBusy(false)
    setStreamingMessageId('')
    streamingMessageIdRef.current = ''
    if (messageId) {
      setMessages((previous) => previous.map((message) => {
        if (message.id !== messageId) return message
        const partial = message.text.trim()
        return {
          ...message,
          text: partial ? `${partial}\n\n（已停止生成）` : `${petName}已停止生成。你可以调整问题后重新发送。`,
          actions: partial ? ['内容未生成完整，可重新提问'] : ['重新发送问题'],
        }
      }))
    }
  }, [petName])

  const runAnalysis = useCallback(async (question: string, range: StatsRange) => {
    const text = question.trim()
    if (!text || busyRef.current) return
    const requestId = nextId('pet-request')
    const streamingId = nextId('pet-stream')
    const abortController = new AbortController()
    let streamedText = ''
    let dietRecommendation: DietRecommendationResult | undefined
    let dietAnswer = ''
    let nextSummary = statsSummary?.range === range ? statsSummary : null
    let allowLateSummary = false

    activeRequestIdRef.current = requestId
    streamingMessageIdRef.current = streamingId
    streamAbortRef.current = abortController
    busyRef.current = true
    setBusy(true)
    setStreamingMessageId(streamingId)
    setActiveRange(range)
    setMessages((previous) => [
      ...previous,
      { id: nextId('user'), role: 'user', text },
      { id: streamingId, role: 'pet', text: '' },
    ])

    const isActive = () => activeRequestIdRef.current === requestId
    const updateStreamingMessage = (updater: (message: ChatMessage) => ChatMessage) => {
      if (!isActive()) return
      setMessages((previous) => previous.map((message) => message.id === streamingId ? updater(message) : message))
    }
    const finishMessage = (answer: string) => {
      allowLateSummary = true
      updateStreamingMessage((message) => ({
        ...message,
        text: answer,
        clues: dietRecommendation ? undefined : buildClues(nextSummary, answer),
        actions: dietRecommendation ? undefined : buildActions(text),
        recommendation: dietRecommendation,
      }))
    }
    const failMessage = () => {
      updateStreamingMessage((message) => ({
        ...message,
        text: `${petName}这次没能顺利读完记录。你可以稍后再试，或先换成最近 7 天的小范围分析。`,
        clues: undefined,
        actions: ['换最近 7 天', '稍后再试'],
      }))
    }
    const summaryPromise = apiClient.getStatsSummary(range)
      .then((summary) => {
        nextSummary = summary
        if (!isActive() && !allowLateSummary) return summary
        setStatsSummary(summary)
        if (allowLateSummary) {
          setMessages((previous) => previous.map((message) => (
            message.id === streamingId && message.text.trim() && !message.recommendation && !message.text.includes('（已停止生成）')
              ? { ...message, clues: buildClues(summary, message.text) }
              : message
          )))
        }
        return summary
      })
      .catch(() => null)

    try {
      const meta = await apiClient.streamGeneratePetChat(
        text,
        range,
        activeSessionId,
        !activeSessionId,
        {
          onProgress: (progress) => {
            if (!isActive() || streamedText) return
            updateStreamingMessage((message) => ({ ...message, text: progress.label }))
          },
          onDietResult: (result) => {
            if (!isActive()) return
            dietRecommendation = result.recommendation
            dietAnswer = result.answer || ''
            updateStreamingMessage((message) => ({
              ...message,
              recommendation: result.recommendation,
            }))
          },
          onChunk: (chunk) => {
            if (!isActive() || !chunk) return
            streamedText += chunk
            updateStreamingMessage((message) => ({ ...message, text: streamedText }))
          },
        },
        {
          fetch: mobilePetChatStreamFetch,
          signal: abortController.signal,
          timeoutMs: 180000,
          enableThinking,
        },
      )
      if (!isActive()) return
      if (meta.session_id) setActiveSessionId(meta.session_id)
      const answer = streamedText || dietAnswer || '我看完了，但这次没有生成足够明确的结论。可以先多记录几餐再试。'
      finishMessage(answer)
    } catch (error) {
      if (!isActive()) return
      if (error instanceof PetChatStreamError && error.code === 'cancelled') {
        failMessage()
        return
      }
      if (!shouldFallbackFromStream(error)) {
        showError(`${petName}分析失败`, error)
        failMessage()
        return
      }

      try {
        let recovered: { answer: string; sessionId: string } | null = null
        if (streamedText) {
          const history = activeSessionId
            ? await apiClient.getPetChatSession(activeSessionId).catch(() => null)
            : await apiClient.getLatestPetChatSession().catch(() => null)
          recovered = recoverPersistedPetAnswer(history, text)
        }
        if (!isActive()) return
        if (recovered) {
          if (recovered.sessionId) setActiveSessionId(recovered.sessionId)
          streamedText = recovered.answer
          finishMessage(recovered.answer)
          return
        }

        const chat = await apiClient.generatePetChat(text, range, activeSessionId, !activeSessionId, enableThinking)
        if (!isActive()) return
        if (chat.session_id) setActiveSessionId(chat.session_id)
        streamedText = chat.answer || ''
        finishMessage(chat.answer || '我看完了，但这次没有生成足够明确的结论。可以先多记录几餐再试。')
      } catch (fallbackError) {
        if (!isActive()) return
        showError(`${petName}分析失败`, fallbackError)
        failMessage()
      }
    } finally {
      void summaryPromise
      if (streamAbortRef.current === abortController) streamAbortRef.current = null
      if (isActive()) {
        activeRequestIdRef.current = ''
        streamingMessageIdRef.current = ''
        busyRef.current = false
        setStreamingMessageId('')
        setBusy(false)
      }
    }
  }, [activeSessionId, enableThinking, petName, showError, statsSummary])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || busy || estimatingCredits || estimatedCredits === null) return
    setInput('')
    const range: StatsRange = /30|月|长期/.test(text) ? 'month' : activeRange
    void runAnalysis(text, range)
  }, [activeRange, busy, estimatedCredits, estimatingCredits, input, runAnalysis])

  const canSend = Boolean(input.trim()) && !busy && !estimatingCredits && estimatedCredits !== null

  return (
    <View style={styles.page}>
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <SvgLinearGradient id="petChatBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#f5fff8" />
            <Stop offset="1" stopColor="#fff8ec" />
          </SvgLinearGradient>
        </Defs>
        <SvgRect x="0" y="0" width="390" height="844" fill="url(#petChatBg)" />
        <SvgCircle cx="40" cy="70" r="118" fill="#b5eed3" opacity="0.52" />
        <SvgCircle cx="340" cy="46" r="104" fill="#f8da99" opacity="0.42" />
        <SvgCircle cx="-44" cy="184" r="140" fill="#5cb896" opacity="0.18" />
        <SvgCircle cx="438" cy="606" r="154" fill="#f5bc5b" opacity="0.16" />
      </Svg>
      <View style={styles.topbar}>
        <MiniButton label="最近" active={historyOpen} disabled={busy} onPress={openHistory} />
        <MiniButton label="新对话" disabled={busy} onPress={startNewConversation} />
      </View>

      <View style={styles.stage}>
        <PetAvatar pet={petSummary?.pet} size={56} mood={petSummary?.status.mood} state={petSummary?.status.state} mealState={petSummary?.status.meal_state} motion="companion" />
        <View style={styles.stageBubble}>
          <Text style={styles.stageTitle}>{petName}在读你的饮食记录</Text>
          <Text style={styles.stageCopy}>
            {hasAnalysis
              ? '继续追问不会重新读记录；想重新分析就点上方新对话。'
              : statsSummary
                ? `默认先看最近 7 天。你提到 30 天、最近一个月、长期，我会自动把范围放大。现在已有 ${statsSummary.recorded_days || 0} 天饮食记录。`
                : '默认先看最近 7 天。你提到 30 天、最近一个月、长期，我会自动把范围放大。'}
          </Text>
        </View>
      </View>

      {historyOpen ? (
        <View style={styles.historyPanel}>
          <Pressable style={styles.historyMask} onPress={() => setHistoryOpen(false)} />
          <View style={styles.historySheet}>
            <View style={styles.historyHead}>
              <Text style={styles.historyTitle}>最近对话</Text>
              <MiniButton label="新对话" onPress={startNewConversation} />
            </View>
            {historyLoading ? (
              <View style={styles.historyLoading}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : null}
            {!historyLoading && sessions.length === 0 ? <Text style={styles.historyEmpty}>还没有历史对话</Text> : null}
            <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>
              {sessions.map((session) => {
                const id = sessionId(session)
                const active = Boolean(id) && id === activeSessionId
                return (
                  <Pressable key={id || `${session.title}-${session.updated_at}`} style={[styles.sessionRow, active && styles.sessionRowActive]} onPress={() => void openSession(id)}>
                    <View style={styles.flex}>
                      <Text style={styles.itemName} numberOfLines={1}>{session.title || session.last_question || '未命名对话'}</Text>
                      <Text style={styles.sessionDesc} numberOfLines={1}>{session.last_question || session.last_answer || '饮食分析对话'}</Text>
                    </View>
                    <Text style={styles.sessionTime}>{formatSessionTime(session.last_message_at || session.updated_at)}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={chatScrollRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.messages}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: false })}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.messageList}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.messageRow, message.role === 'user' && styles.messageRowUser]}>
              {message.role === 'pet' ? <PetAvatar pet={petSummary?.pet} size={30} mood={petSummary?.status.mood} state={petSummary?.status.state} mealState={petSummary?.status.meal_state} /> : null}
              <View style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.petBubble]}>
                {busy && message.id === streamingMessageId && !message.text ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Text style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>{message.text}</Text>
                )}
                {message.role === 'pet' && message.recommendation ? (
                  <DietRecommendationCards
                    result={message.recommendation}
                    savedSchoolIds={savedSchoolIds}
                    onSave={(result) => void saveCampusPreference(result)}
                    onOpen={openRecommendationDetail}
                  />
                ) : null}
                {message.clues?.length ? (
                  <View style={styles.clueList}>
                    {message.clues.map((clue, index) => (
                      <View key={`${message.id}-clue-${index}`} style={styles.clue}>
                        <Text style={styles.clueIndex}>{index + 1}</Text>
                        <Text style={styles.clueText}>{clue}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {message.actions?.length ? (
                  <View style={styles.actionList}>
                    {message.actions.map((action) => <Text key={`${message.id}-${action}`} style={styles.actionChip}>{action}</Text>)}
                  </View>
                ) : null}
            </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.thinkingRow}>
        <View style={styles.thinkingCopy}>
          <Text style={styles.thinkingTitle}>深度思考</Text>
          <Text style={styles.thinkingNote}>更细致，回复会更慢</Text>
        </View>
        <Switch
          accessibilityLabel="深度思考开关"
          value={enableThinking}
          disabled={busy}
          onValueChange={setEnableThinking}
          trackColor={{ false: '#d6e2da', true: '#85c9a9' }}
          thumbColor={enableThinking ? colors.brandDark : '#ffffff'}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickScroll} contentContainerStyle={styles.quickRow}>
        {(!hasAnalysis ? QUICK_QUESTIONS : FOLLOW_UPS.map((text) => ({ text, range: activeRange }))).map((item) => (
          <MiniButton key={item.text} label={item.text} disabled={busy} onPress={() => setInput(item.text)} />
        ))}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={hasAnalysis ? '继续问它：微量元素、餐次、明天怎么吃...' : '问它：训练状态、饥饿感、碳水、减脂卡住...'}
          placeholderTextColor={colors.textMuted}
          returnKeyType="send"
          style={styles.input}
          onSubmitEditing={() => {
            if (canSend) send()
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? '停止生成' : '发送消息'}
          style={[styles.sendButton, busy && styles.stopButton, (!busy && !canSend) && styles.sendButtonDisabled]}
          disabled={!busy && !canSend}
          onPress={busy ? cancelGeneration : send}
        >
          <Text style={[styles.sendText, busy && styles.stopText]}>{busy ? '停止' : '发送'}</Text>
        </Pressable>
      </View>
      {input.trim() ? (
        <Text style={styles.creditCost}>
          {estimatedCredits === null ? '预计消耗 -- 积分' : `预计消耗 ${estimatedCredits} 积分`}
        </Text>
      ) : null}
    </View>
  )
}

function DietRecommendationCards({
  result,
  savedSchoolIds,
  onSave,
  onOpen,
}: {
  result: DietRecommendationResult
  savedSchoolIds: string[]
  onSave: (result: DietRecommendationResult) => void
  onOpen: (option: DietRecommendationOption) => void
}) {
  const school = result.resolved_school
  const saved = Boolean(school?.id && savedSchoolIds.includes(school.id))
  return (
    <View style={styles.dietResult}>
      {school ? (
        <View style={styles.dietContext}>
          <View style={styles.dietContextCopy}>
            <Text style={styles.dietSchool}>{school.name}</Text>
            <Text style={styles.dietSource}>{recommendationSourceLabel(result)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saved ? `${school.name}已设为常用学校` : `将${school.name}设为常用学校`}
            disabled={saved}
            onPress={() => onSave(result)}
            style={[styles.schoolSave, saved && styles.schoolSaveSaved]}
          >
            <Text style={[styles.schoolSaveText, saved && styles.schoolSaveTextSaved]}>
              {saved ? '已设为常用' : '设为常用学校'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.dietOptions}>
        {(result.recommendations || []).slice(0, 5).map((option, index) => {
          const location = recommendationLocation(option)
          const price = recommendationPrice(option)
          const canOpen = option.source === 'public_food_library' && Boolean(option.source_id)
          const estimated = option.nutrition_basis === 'library_estimate'
          const portion = String(option.items?.[0]?.amount || '').trim()
          const weightMethod = option.weight_method === 'visual_estimate'
            ? '视觉估重'
            : option.weight_method === 'ai_estimate' ? 'AI 估重' : ''
          return (
            <Pressable
              key={`${option.source || 'option'}-${option.source_id || index}`}
              accessibilityRole={canOpen ? 'button' : undefined}
              accessibilityLabel={canOpen ? `查看${option.title}详情` : undefined}
              disabled={!canOpen}
              onPress={() => onOpen(option)}
              style={({ pressed }) => [styles.dietCard, canOpen && styles.dietCardOpen, pressed && canOpen && styles.dietCardPressed]}
            >
              <View style={styles.dietCardHead}>
                <Text style={styles.dietRank}>{index + 1}</Text>
                <Text style={styles.dietCardTitle} numberOfLines={2}>{option.title}</Text>
                {price ? <Text style={styles.dietPrice}>{price}</Text> : null}
              </View>
              {location ? <Text style={styles.dietLocation}>{location}</Text> : null}
              <View style={styles.dietMacros}>
                <Text style={styles.dietMacro}>{estimated ? '≈' : ''}{Math.round(option.calories || 0)} kcal</Text>
                <Text style={styles.dietMacro}>蛋白 {estimated ? '≈' : ''}{Math.round(option.protein || 0)}g</Text>
                <Text style={styles.dietMacro}>碳水 {estimated ? '≈' : ''}{Math.round(option.carbs || 0)}g</Text>
                <Text style={styles.dietMacro}>脂肪 {estimated ? '≈' : ''}{Math.round(option.fat || 0)}g</Text>
              </View>
              <Text style={styles.dietEvidence}>
                {estimated ? `库内估算${portion ? ` · 份量 ${portion}` : ''}${weightMethod ? ` · ${weightMethod}` : ''}${option.weight_confidence ? ` · 置信度 ${Math.round(option.weight_confidence * 100)}%` : ''}` : option.nutrition_basis === 'nutrition_label' ? '包装营养标签记录' : '校园库营养记录'}
              </Text>
              <Text style={styles.dietReason}>{option.reason}</Text>
              {canOpen ? <Text style={styles.dietLink}>查看菜品详情 ›</Text> : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function MiniButton({ label, active, disabled, onPress }: { label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.miniButton, active && styles.miniButtonActive, disabled && styles.disabled]}>
      <Text style={[styles.miniButtonText, active && styles.miniButtonTextActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  page: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#f5fff8',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
  topbar: {
    zIndex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 5,
    marginBottom: 4,
  },
  stage: {
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingTop: 7,
    paddingRight: 5,
    paddingBottom: 7,
    paddingLeft: 1,
    marginBottom: 9,
  },
  stageBubble: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.84)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#3a5e4c',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  stageTitle: {
    color: '#17382f',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  stageCopy: {
    color: 'rgba(23, 56, 47, 0.58)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  miniButton: {
    maxWidth: 190,
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.18)',
    justifyContent: 'center',
  },
  miniButtonActive: {
    backgroundColor: '#e8f6ee',
    borderColor: 'rgba(92, 184, 150, 0.36)',
  },
  miniButtonText: {
    color: 'rgba(34, 111, 85, 0.78)',
    fontSize: 12,
    fontWeight: '900',
  },
  miniButtonTextActive: {
    color: colors.brandDark,
  },
  disabled: {
    opacity: 0.55,
  },
  chatScroll: {
    zIndex: 1,
    flex: 1,
    minHeight: 0,
  },
  messages: {
    paddingBottom: 9,
  },
  messageList: {
    gap: 9,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: 14,
    padding: 11,
    shadowColor: '#3a5e4c',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  petBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    borderBottomLeftRadius: 5,
  },
  userBubble: {
    backgroundColor: colors.brandDark,
    borderBottomRightRadius: 5,
  },
  messageText: {
    color: '#264036',
    fontSize: 13,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  clueList: {
    marginTop: 9,
    gap: 6,
  },
  clue: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 8,
    borderRadius: 9,
    backgroundColor: 'rgba(238, 248, 235, 0.92)',
  },
  clueIndex: {
    width: 17,
    height: 17,
    borderRadius: 9,
    overflow: 'hidden',
    textAlign: 'center',
    color: '#ffffff',
    backgroundColor: colors.brandDark,
    fontSize: 10,
    lineHeight: 17,
    fontWeight: '900',
  },
  clueText: {
    flex: 1,
    minWidth: 0,
    color: '#355247',
    fontSize: 12,
    lineHeight: 17,
  },
  actionList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 8,
  },
  actionChip: {
    color: 'rgba(128, 91, 22, 0.9)',
    backgroundColor: 'rgba(255, 240, 200, 0.82)',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '900',
  },
  dietResult: {
    marginTop: 10,
    gap: 8,
  },
  dietContext: {
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(232, 246, 238, 0.9)',
  },
  dietContextCopy: {
    gap: 2,
  },
  dietSchool: {
    color: '#1f4e3d',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  dietSource: {
    color: '#6d8278',
    fontSize: 10,
    lineHeight: 15,
  },
  schoolSave: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(47, 143, 111, 0.22)',
  },
  schoolSaveSaved: {
    backgroundColor: 'rgba(47, 143, 111, 0.08)',
  },
  schoolSaveText: {
    color: '#2f8f6f',
    fontSize: 12,
    fontWeight: '900',
  },
  schoolSaveTextSaved: {
    color: '#6f8178',
  },
  dietOptions: {
    gap: 8,
  },
  dietCard: {
    minHeight: 48,
    padding: 10,
    gap: 6,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(68, 100, 84, 0.13)',
  },
  dietCardOpen: {
    borderColor: 'rgba(47, 143, 111, 0.28)',
  },
  dietCardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.99 }],
  },
  dietCardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  dietRank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    textAlign: 'center',
    color: '#ffffff',
    backgroundColor: '#2f8f6f',
    fontSize: 11,
    lineHeight: 22,
    fontWeight: '900',
  },
  dietCardTitle: {
    flex: 1,
    minWidth: 0,
    color: '#244438',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  dietPrice: {
    color: '#a66a16',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '900',
  },
  dietLocation: {
    color: '#6d8278',
    fontSize: 11,
    lineHeight: 16,
  },
  dietMacros: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  dietMacro: {
    color: '#355247',
    backgroundColor: 'rgba(232, 246, 238, 0.78)',
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  dietEvidence: {
    color: '#809087',
    fontSize: 10,
    lineHeight: 15,
  },
  dietReason: {
    color: '#405a50',
    fontSize: 11,
    lineHeight: 17,
  },
  dietLink: {
    minHeight: 28,
    color: '#2f8f6f',
    fontSize: 11,
    lineHeight: 28,
    fontWeight: '900',
  },
  thinkingRow: {
    zIndex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  thinkingCopy: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  thinkingTitle: {
    color: '#315044',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  thinkingNote: {
    color: '#829188',
    fontSize: 11,
    lineHeight: 16,
  },
  quickScroll: {
    zIndex: 1,
    flexShrink: 0,
    flexGrow: 0,
    maxHeight: 48,
    marginTop: 2,
    marginBottom: 7,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  inputBar: {
    zIndex: 1,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#3a5e4c',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 2,
  },
  input: {
    flex: 1,
    height: 48,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 0,
    color: '#1d382f',
    backgroundColor: 'rgba(243, 247, 242, 0.92)',
    lineHeight: 18,
    fontSize: 13,
  },
  sendButton: {
    width: 56,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#c4eacb',
  },
  sendButtonDisabled: {
    opacity: 0.46,
  },
  stopButton: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  sendText: {
    color: '#1d5a45',
    fontSize: 13,
    fontWeight: '900',
  },
  stopText: {
    color: '#b45353',
  },
  creditCost: {
    zIndex: 1,
    alignSelf: 'flex-end',
    minHeight: 24,
    paddingTop: 3,
    paddingHorizontal: 8,
    color: '#6f8178',
    fontSize: 10,
    lineHeight: 16,
  },
  historyPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
  },
  historyMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(16, 24, 20, 0.28)',
  },
  historySheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    maxHeight: '72%',
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#213930',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  historyTitle: {
    color: '#17382f',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  historyLoading: {
    paddingVertical: 18,
  },
  historyEmpty: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 18,
    fontSize: 12,
  },
  historyList: {
    maxHeight: 420,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 9,
  },
  sessionRowActive: {
    backgroundColor: 'rgba(92, 184, 150, 0.11)',
  },
  itemName: {
    color: '#17382f',
    fontSize: 13,
    fontWeight: '900',
  },
  sessionDesc: {
    color: 'rgba(23, 56, 47, 0.52)',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  sessionTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
})
