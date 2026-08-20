import { View, Text, Input, ScrollView } from '@tarojs/components'
import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getPetChatSession,
  getLatestPetChatSession,
  getPetSummary,
  getStatsSummary,
  estimatePetChat,
  listPetChatSessions,
  showUnifiedApiError,
  streamGeneratePetChat,
  type PetChatHistoryMessage,
  type PetChatSessionSummary,
  type PetSummary,
  type StatsSummary
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { openPetSettings } from '../../../utils/pet-navigation'
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

const FOLLOW_UPS = [
  '饮食怎么调整？',
  '推荐食谱',
  '训练怎么安排？',
]

function nextID(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function rangeLabel(range: RangeMode): string {
  return range === 'month' ? '最近 30 天' : '最近 7 天'
}

function questionRange(question: string, fallback: RangeMode): RangeMode {
  return /30|月|长期/.test(question) ? 'month' : fallback
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
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null)
  const [estimatingCredits, setEstimatingCredits] = useState(false)
  const busyRef = useRef(false)
  const estimateRequestRef = useRef(0)
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
  const isEmptyConversation = !lastAnalysis && !sessionID && messages.length === 1 && messages[0]?.kind === 'intro'
  const latestMessage = messages[messages.length - 1]
  const latestMessageToken = latestMessage?.id.replace(/[^a-zA-Z0-9_-]/g, '-') || 'empty'
  const latestMessageID = `pet-chat-bottom-${latestMessageToken}-${latestMessage?.text.length || 0}`

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

  useEffect(() => {
    const question = input.trim()
    const requestID = estimateRequestRef.current + 1
    estimateRequestRef.current = requestID
    if (!question) {
      setEstimatedCredits(null)
      setEstimatingCredits(false)
      return
    }

    setEstimatedCredits(null)
    setEstimatingCredits(true)
    const timer = setTimeout(() => {
      void estimatePetChat(question, questionRange(question, activeRange))
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
  }, [activeRange, input])

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
    setLastAnalysis(null)
    setSessionID('')
    setMessages([buildIntroMessage(petName)])
    Taro.showToast({ title: '已新建对话', icon: 'none' })
  }, [petName])

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

  const runAnalysis = useCallback(async (question: string, range: RangeMode) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    streamingTextRef.current = ''

    setActiveRange(range)
    appendMessage({ id: nextID('user'), role: 'user', text: question })
    const streamingMessageID = nextID('pet-stream')
    appendMessage({ id: streamingMessageID, role: 'pet', kind: 'analysis', text: '' })

    let nextSummary: StatsSummary | null = summary?.range === range ? summary : null

    const finish = () => {
      busyRef.current = false
      setBusy(false)
      streamingTextRef.current = ''
    }

    streamGeneratePetChat(question, range, sessionID, !sessionID, {
      onStart: () => {
        // first chunk will arrive soon
      },
      onChunk: (text) => {
        streamingTextRef.current += text
        updateMessage(streamingMessageID, (m) => ({ ...m, text: m.text + text }))
      },
      onDone: (meta) => {
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
        if (!nextSummary) {
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
    })
  }, [appendMessage, petName, sessionID, summary, updateMessage])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || busy || busyRef.current || estimatingCredits || estimatedCredits === null) return
    setInput('')
    const range = questionRange(text, activeRange)
    void runAnalysis(text, range)
  }, [activeRange, busy, estimatedCredits, estimatingCredits, input, runAnalysis])

  const canSend = Boolean(input.trim()) && !busy && !estimatingCredits && estimatedCredits !== null

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
              </View>
            </View>
          ))}
        </View>
        <View id={latestMessageID} className='pet-chat-bottom-anchor' />
      </ScrollView>

      <View className='pet-chat-bottom-dock'>
        <ScrollView className='pet-chat-quick-row' scrollX enhanced showScrollbar={false}>
          <View className='pet-chat-quick-row-inner'>
            {FOLLOW_UPS.map((text) => (
              <View
                key={text}
                className='pet-chat-quick-chip follow'
                onClick={() => setInput(text)}
              >
                <Text>{text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View className='pet-chat-input-bar'>
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
          <View className={`pet-chat-send ${canSend ? '' : 'disabled'}`} onClick={handleSend}>
            <Text>发送</Text>
          </View>
        </View>
        {input.trim() ? (
          <Text className='pet-chat-credit-cost'>
            {estimatedCredits === null ? '预计消耗 -- 积分' : <>预计消耗 {estimatedCredits} 积分</>}
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
