import { View, Text, Input, ScrollView } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  generatePetChat,
  getPetChatSession,
  getLatestPetChatSession,
  getPetSummary,
  getStatsSummary,
  listPetChatSessions,
  showUnifiedApiError,
  streamGeneratePetChat,
  type PetChatHistoryMessage,
  type PetChatSessionSummary,
  type PetChatStreamMeta,
  type PetSummary,
  type StatsSummary
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { PetAvatar } from '../../../components/PetAvatar'
import { PetMarkdown } from './pet-markdown'
import './index.scss'

type ChatRole = 'pet' | 'user'
type RangeMode = 'week' | 'month'

type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  kind?: 'intro' | 'analysis' | 'local'
  clues?: string[]
  actions?: string[]
}

const QUICK_QUESTIONS = [
  { text: '最近训练状态下滑了，帮我找原因', subtitle: '训练表现', range: 'week' as RangeMode },
  { text: '我最近总饿，是不是吃法有问题', subtitle: '饥饿感', range: 'week' as RangeMode },
  { text: '帮我找最该优化的一点', subtitle: '优先级', range: 'week' as RangeMode },
  { text: '看最近 30 天规律', subtitle: '长期趋势', range: 'month' as RangeMode },
]

const FOLLOW_UPS = [
  '能不能只看微量元素',
  '帮我安排训练日前一天怎么吃',
  '只看碳水是不是偏低',
  '给我一个明天能执行的小目标',
]

function nextID(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function rangeLabel(range: RangeMode): string {
  return range === 'month' ? '最近 30 天' : '最近 7 天'
}

function buildIntroMessage(petName: string): ChatMessage {
  return {
    id: 'intro',
    role: 'pet',
    kind: 'intro',
    text: `我是${petName}。你直接说最近哪里不对劲就行，比如训练没劲、总是饿、减脂卡住，或者想知道明天怎么吃。我只看你保存过的饮食文字和营养数据，不看图片，也不会替你下诊断。`,
    actions: ['先说一个最近的困惑', '也可以直接问训练和饥饿感'],
  }
}

function mapHistoryMessage(item: PetChatHistoryMessage): ChatMessage {
  const meta = item.meta || {}
  return {
    id: item.id || nextID('history'),
    role: item.role === 'user' ? 'user' : 'pet',
    kind: item.message_type === 'analysis' ? 'analysis' : item.message_type === 'local' ? 'local' : undefined,
    text: item.content || '',
    clues: Array.isArray(meta.clues) ? meta.clues.map(String) : undefined,
    actions: Array.isArray(meta.actions) ? meta.actions.map(String) : undefined,
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
  const busyRef = useRef(false)
  const historyLoadedRef = useRef(false)
  const [activeRange, setActiveRange] = useState<RangeMode>('week')
  const [lastAnalysis, setLastAnalysis] = useState<ChatMessage | null>(null)
  const [sessionID, setSessionID] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [sessions, setSessions] = useState<PetChatSessionSummary[]>([])
  const petName = petSummary?.pet?.name || '你的宠物'
  const [messages, setMessages] = useState<ChatMessage[]>([buildIntroMessage('你的宠物')])
  const streamingTextRef = useRef('')
  const activeStreamAbortRef = useRef<(() => void) | null>(null)
  const activeStreamMessageIDRef = useRef('')
  const analysisRunIDRef = useRef(0)
  const isEmptyConversation = !lastAnalysis && !sessionID && messages.length === 1 && messages[0]?.kind === 'intro'

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    void Promise.all([
      getStatsSummary('week').then(setSummary).catch(() => null),
      getPetSummary().then(setPetSummary).catch(() => null),
      (async () => {
        if (historyLoadedRef.current) return
        historyLoadedRef.current = true
        const history = await getLatestPetChatSession().catch(() => null)
        if (!history?.messages?.length) return
        const restored = history.messages.map(mapHistoryMessage).filter((item) => item.text.trim())
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
      if (prev.length === 1 && prev[0]?.kind === 'intro') return [buildIntroMessage(petName)]
      return prev
    })
  }, [petName])

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message])
  }, [])

  const updateMessage = useCallback((id: string, updater: (message: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)))
  }, [])

  const cancelActiveAnalysis = useCallback(() => {
    if (!busyRef.current) return false

    analysisRunIDRef.current += 1
    const streamingMessageID = activeStreamMessageIDRef.current
    activeStreamAbortRef.current?.()
    activeStreamAbortRef.current = null
    activeStreamMessageIDRef.current = ''
    streamingTextRef.current = ''
    busyRef.current = false
    setBusy(false)

    if (streamingMessageID) {
      updateMessage(streamingMessageID, (message) => (
        message.text.trim()
          ? message
          : { ...message, kind: 'local', text: '本次分析已停止，你可以继续提问。' }
      ))
    }
    return true
  }, [updateMessage])

  const startNewConversation = useCallback(() => {
    cancelActiveAnalysis()
    setHistoryOpen(false)
    setInput('')
    setLastAnalysis(null)
    setSessionID('')
    setMessages([buildIntroMessage(petName)])
    Taro.showToast({ title: '已新建对话', icon: 'none' })
  }, [cancelActiveAnalysis, petName])

  const applyHistory = useCallback((history: Awaited<ReturnType<typeof getLatestPetChatSession>>) => {
    const restored = history?.messages?.map(mapHistoryMessage).filter((item) => item.text.trim()) || []
    if (!restored.length) return false
    const restoredSessionID = history?.session?.id || history?.session?.ID || ''
    setSessionID(restoredSessionID)
    setMessages(restored)
    const latestPetMessage = [...restored].reverse().find((item) => item.role === 'pet') || null
    setLastAnalysis(latestPetMessage)
    const restoredRange = history?.session?.range_type || history?.session?.RangeType
    if (restoredRange === 'week' || restoredRange === 'month') setActiveRange(restoredRange)
    return true
  }, [])

  const openHistoryPanel = useCallback(async () => {
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

  const openSession = useCallback(async (session: PetChatSessionSummary) => {
    const targetSessionID = getHistorySessionID(session)
    if (!targetSessionID) return

    const activeQuestion = [...messages].reverse().find((message) => message.role === 'user')?.text.trim()
    const isCurrentStreamingSession = busyRef.current && (
      targetSessionID === sessionID ||
      (!sessionID && Boolean(activeQuestion) && (session.last_question === activeQuestion || session.title === activeQuestion))
    )
    if (targetSessionID === sessionID || isCurrentStreamingSession) {
      setHistoryOpen(false)
      return
    }

    cancelActiveAnalysis()
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
  }, [applyHistory, cancelActiveAnalysis, messages, sessionID])

  const runAnalysis = useCallback(async (question: string, range: RangeMode) => {
    if (busyRef.current) return
    const runID = analysisRunIDRef.current + 1
    analysisRunIDRef.current = runID
    busyRef.current = true
    setBusy(true)
    streamingTextRef.current = ''

    setActiveRange(range)
    appendMessage({ id: nextID('user'), role: 'user', text: question })
    const streamingMessageID = nextID('pet-stream')
    activeStreamMessageIDRef.current = streamingMessageID
    appendMessage({ id: streamingMessageID, role: 'pet', kind: 'analysis', text: '' })

    let nextSummary: StatsSummary | null = null
    getStatsSummary(range)
      .then((s) => {
        if (analysisRunIDRef.current !== runID) return
        nextSummary = s
        setSummary(s)
      })
      .catch(() => null)

    const finish = () => {
      if (analysisRunIDRef.current !== runID) return
      activeStreamAbortRef.current = null
      activeStreamMessageIDRef.current = ''
      busyRef.current = false
      setBusy(false)
      streamingTextRef.current = ''
    }

    const abort = streamGeneratePetChat(question, range, sessionID, !sessionID, {
      onStart: () => {
        // first chunk will arrive soon
      },
      onSessionReady: (meta) => {
        if (analysisRunIDRef.current !== runID) return
        if (meta.session_id) setSessionID(meta.session_id)
      },
      onChunk: (text) => {
        if (analysisRunIDRef.current !== runID) return
        streamingTextRef.current += text
        updateMessage(streamingMessageID, (m) => ({ ...m, text: m.text + text }))
      },
      onDone: (meta) => {
        if (analysisRunIDRef.current !== runID) return
        if (meta.session_id) setSessionID(meta.session_id)
        const finalText = streamingTextRef.current || '我看完了，但这次没有生成足够明确的结论。可以先多记录几餐再试。'
        const message: ChatMessage = {
          id: streamingMessageID,
          role: 'pet',
          kind: 'analysis',
          text: finalText,
          clues: buildClues(nextSummary, finalText),
          actions: buildActions(question),
        }
        setLastAnalysis(message)
        updateMessage(streamingMessageID, () => message)
        finish()
      },
      onError: async (error) => {
        if (analysisRunIDRef.current !== runID) return
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
    })
    if (analysisRunIDRef.current === runID) {
      activeStreamAbortRef.current = abort
    } else {
      abort()
    }
  }, [appendMessage, petName, sessionID, updateMessage])

  const handleQuickQuestion = useCallback((text: string, range: RangeMode) => {
    cancelActiveAnalysis()
    void runAnalysis(text, range)
  }, [cancelActiveAnalysis, runAnalysis])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    cancelActiveAnalysis()
    setInput('')
    const range: RangeMode = /30|月|长期/.test(text) ? 'month' : activeRange
    void runAnalysis(text, range)
  }, [activeRange, cancelActiveAnalysis, input, runAnalysis])

  return (
    <View className={`pet-chat-page ${scheme === 'dark' ? 'pet-chat-page--dark' : ''}`}>
      <View className='pet-chat-background-glow pet-chat-background-glow--one' />
      <View className='pet-chat-background-glow pet-chat-background-glow--two' />

      <View className='pet-chat-topbar'>
        <View className='pet-chat-top-actions'>
          <View className='pet-chat-history-button' onClick={openHistoryPanel}>
            <Text>最近</Text>
          </View>
          <View className={`pet-chat-new-button ${isEmptyConversation ? 'disabled' : ''}`} onClick={isEmptyConversation ? undefined : startNewConversation}>
            <Text>新对话</Text>
          </View>
        </View>
      </View>

      <ScrollView className='pet-chat-scroll' scrollY enhanced showScrollbar={false}>
        <View className='pet-chat-messages'>
          {messages.map((message) => (
            <View key={message.id} className={`pet-chat-message ${message.role}`}>
              {message.role === 'pet' ? <PetAvatar pet={petSummary?.pet} size={56} mood={petSummary?.status?.mood} state={petSummary?.status?.state} /> : null}
              <View className='pet-chat-bubble'>
                {message.role === 'pet' ? (
                  message.text ? (
                    <PetMarkdown text={message.text} />
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
                {message.clues?.length ? (
                  <View className='pet-chat-clues'>
                    {message.clues.map((clue, index) => (
                      <View key={`${message.id}-clue-${index}`} className='pet-chat-clue'>
                        <Text className='pet-chat-clue-index'>{index + 1}</Text>
                        <Text className='pet-chat-clue-text'>{clue}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          {isEmptyConversation ? (
            <View className='pet-chat-starter'>
              <Text className='pet-chat-starter-title'>可以从这些话题开始</Text>
              <View className='pet-chat-starter-grid'>
                {QUICK_QUESTIONS.map((item) => (
                  <View key={item.text} className='pet-chat-starter-card' onClick={() => handleQuickQuestion(item.text, item.range)}>
                    <Text className='pet-chat-starter-card-title'>{item.text}</Text>
                    <Text className='pet-chat-starter-card-subtitle'>{item.subtitle} · {rangeLabel(item.range)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {lastAnalysis ? (
        <ScrollView className='pet-chat-quick-row' scrollX enhanced showScrollbar={false}>
          <View className='pet-chat-quick-row-inner'>
            {FOLLOW_UPS.map((text) => (
              <View
                key={text}
                className='pet-chat-quick-chip follow'
                onClick={() => {
                  handleQuickQuestion(text, activeRange)
                }}
              >
                <Text>{text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View className='pet-chat-input-bar'>
        <Input
          className='pet-chat-input'
          value={input}
          placeholder={lastAnalysis ? '继续问它：微量元素、餐次、明天怎么吃...' : '问它：训练状态、饥饿感、碳水、减脂卡住...'}
          placeholderClass='pet-chat-input-placeholder'
          confirmType='send'
          onInput={(event) => setInput(String(event.detail.value || ''))}
          onConfirm={handleSend}
        />
        <View className={`pet-chat-send ${!input.trim() ? 'disabled' : ''}`} onClick={handleSend}>
          <Text>发送</Text>
        </View>
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
                <View className='pet-chat-history-empty'>
                  <Text>正在读取...</Text>
                </View>
              ) : sessions.length === 0 ? (
                <View className='pet-chat-history-empty'>
                  <Text>还没有历史对话</Text>
                </View>
              ) : sessions.map((session) => {
                const itemID = getHistorySessionID(session)
                const active = itemID && itemID === sessionID
                return (
                  <View key={itemID} className={`pet-chat-history-item ${active ? 'active' : ''}`} onClick={() => openSession(session)}>
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
