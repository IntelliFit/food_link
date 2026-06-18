import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type {
  PetChatHistoryMessage,
  PetChatHistoryResponse,
  PetChatSessionSummary,
  PetSummary,
  StatsRange,
  StatsSummary,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { PetAvatar, petMoodLabel, petStateLabel } from '../components/PetAvatar'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, radius } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type ChatRole = 'pet' | 'user'

type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  clues?: string[]
  actions?: string[]
}

const QUICK_QUESTIONS: Array<{ text: string; range: StatsRange }> = [
  { text: '最近训练状态下滑了，帮我找原因', range: 'week' },
  { text: '帮我找最该优化的一点', range: 'week' },
  { text: '最近总饿，是不是吃法有问题', range: 'week' },
  { text: '看最近 30 天规律', range: 'month' },
]

const FOLLOW_UPS = [
  '只看微量元素',
  '明天训练前怎么吃',
  '碳水是不是偏低',
  '给我一个明天能执行的小目标',
]

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
    text: `我是${petName}。你可以直接问我最近训练、饥饿感、碳水、减脂卡住、明天怎么吃这类问题。我会结合你保存过的记录来回答。`,
    actions: ['先说一个最近的困扰', '也可以直接问训练和饮食'],
  }
}

function mapHistoryMessage(item: PetChatHistoryMessage): ChatMessage {
  const meta = item.meta || {}
  return {
    id: item.id || nextId('history'),
    role: item.role === 'user' ? 'user' : 'pet',
    text: item.content || '',
    clues: Array.isArray(meta.clues) ? meta.clues.map(String) : undefined,
    actions: Array.isArray(meta.actions) ? meta.actions.map(String) : undefined,
  }
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
    clues.push(`蛋白 ${Math.round(summary.total_protein || 0)}g，碳水 ${Math.round(summary.total_carbs || 0)}g，脂肪 ${Math.round(summary.total_fat || 0)}g`)
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
    return ['先稳定记录 7 天', '看日均热量而不是单日波动', '保留蛋白，优先微调零食和饮料']
  }
  return ['先选一个最小改动执行 3 天', '继续记录训练和体感', '下次让我对比执行前后变化']
}

export function PetChatScreen() {
  const dialog = useAppDialog()
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [statsSummary, setStatsSummary] = useState<StatsSummary | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [activeRange, setActiveRange] = useState<StatsRange>('week')
  const [activeSessionId, setActiveSessionId] = useState('')
  const [sessions, setSessions] = useState<PetChatSessionSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const historyLoadedRef = useRef(false)

  const petName = petSummary?.pet?.name || '成长伙伴'
  const hasAnalysis = useMemo(() => messages.some((item) => item.role === 'pet' && item.id !== 'intro'), [messages])

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
      const [petData, statsData] = await Promise.all([
        apiClient.getPetSummary(),
        apiClient.getStatsSummary(activeRange).catch(() => null),
      ])
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
    setMessages((prev) => {
      if (prev.length === 0) return [buildIntroMessage(petName)]
      if (prev.length === 1 && prev[0]?.id === 'intro') return [buildIntroMessage(petName)]
      return prev
    })
  }, [petName])

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

  const runAnalysis = useCallback(async (question: string, range: StatsRange) => {
    const text = question.trim()
    if (!text || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setActiveRange(range)
    setMessages((prev) => [...prev, { id: nextId('user'), role: 'user', text }])
    try {
      const [nextSummary, chat] = await Promise.all([
        apiClient.getStatsSummary(range).catch(() => null),
        apiClient.generatePetChat(text, range, activeSessionId, !activeSessionId),
      ])
      if (chat.session_id) setActiveSessionId(chat.session_id)
      if (nextSummary) setStatsSummary(nextSummary)
      const answer = chat.answer || '我看完了，但这次没有生成足够明确的结论。可以先多记录几餐再试。'
      setMessages((prev) => [
        ...prev,
        {
          id: nextId('pet'),
          role: 'pet',
          text: answer,
          clues: buildClues(nextSummary, answer),
          actions: buildActions(text),
        },
      ])
    } catch (error) {
      showError(`${petName}分析失败`, error)
      setMessages((prev) => [
        ...prev,
        {
          id: nextId('pet'),
          role: 'pet',
          text: `${petName}这次没能顺利读完记录。你可以稍后再试，或先换成最近 7 天的小范围分析。`,
          actions: ['换最近 7 天', '稍后再试'],
        },
      ])
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [activeSessionId, petName, showError])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const range: StatsRange = /30|月|长期/.test(text) ? 'month' : activeRange
    void runAnalysis(text, range)
  }, [activeRange, busy, input, runAnalysis])

  const rangeOptions: StatsRange[] = ['week', 'month']
  const moodText = `${petMoodLabel(petSummary?.status.mood)} · ${petStateLabel(petSummary?.status.state)}`

  return (
    <Page title={`和${petName}聊聊`} subtitle="同一只成长伙伴会结合你的饮食、运动和健康记录回答。" refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.hero}>
          <PetAvatar pet={petSummary?.pet} size="large" mood={petSummary?.status.mood} state={petSummary?.status.state} />
          <View style={styles.flex}>
            <Text style={styles.heroTitle}>{petName}</Text>
            <Text style={styles.subtitle}>{moodText}</Text>
            <Text style={styles.subtitle}>
              {statsSummary ? `${rangeLabel(statsSummary.range)}已记录 ${statsSummary.recorded_days || 0} 天` : '会优先读取最近记录'}
            </Text>
          </View>
        </View>
        <View style={styles.buttonRow}>
          <MiniButton label="最近" active={historyOpen} onPress={openHistory} />
          <MiniButton label="新对话" onPress={startNewConversation} />
        </View>
      </Card>

      {historyOpen ? (
        <Card>
          <Text style={styles.sectionTitle}>最近对话</Text>
          {historyLoading ? <ActivityIndicator color={colors.brand} /> : null}
          {!historyLoading && sessions.length === 0 ? <Text style={styles.empty}>还没有历史对话</Text> : null}
          {sessions.map((session) => {
            const id = sessionId(session)
            const active = Boolean(id) && id === activeSessionId
            return (
              <Pressable key={id || `${session.title}-${session.updated_at}`} style={[styles.sessionRow, active && styles.sessionRowActive]} onPress={() => void openSession(id)}>
                <View style={styles.flex}>
                  <Text style={styles.itemName} numberOfLines={1}>{session.title || session.last_question || '未命名对话'}</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>{session.last_question || session.last_answer || '饮食分析对话'}</Text>
                </View>
                <Text style={styles.sessionTime}>{formatSessionTime(session.last_message_at || session.updated_at)}</Text>
              </Pressable>
            )
          })}
        </Card>
      ) : null}

      <Card>
        <View style={styles.segment}>
          {rangeOptions.map((range) => (
            <Pressable key={range} style={[styles.segmentItem, activeRange === range && styles.segmentItemActive]} onPress={() => setActiveRange(range)}>
              <Text style={[styles.segmentText, activeRange === range && styles.segmentTextActive]}>{rangeLabel(range)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.messages}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.messageRow, message.role === 'user' && styles.messageRowUser]}>
              {message.role === 'pet' ? <PetAvatar pet={petSummary?.pet} size="small" mood={petSummary?.status.mood} state={petSummary?.status.state} /> : null}
              <View style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.petBubble]}>
                <Text style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>{message.text}</Text>
                {message.clues?.length ? (
                  <View style={styles.clueList}>
                    {message.clues.map((clue, index) => (
                      <Text key={`${message.id}-clue-${index}`} style={styles.clueText}>{index + 1}. {clue}</Text>
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
          {busy ? (
            <View style={styles.thinkingRow}>
              <PetAvatar pet={petSummary?.pet} size="small" mood={petSummary?.status.mood} state={petSummary?.status.state} />
              <View style={styles.thinkingBubble}>
                <ActivityIndicator color={colors.brand} />
              </View>
            </View>
          ) : null}
        </View>
      </Card>

      <View style={styles.quickRow}>
        {(!hasAnalysis ? QUICK_QUESTIONS : FOLLOW_UPS.map((text) => ({ text, range: activeRange }))).map((item) => (
          <MiniButton key={item.text} label={item.text} disabled={busy} onPress={() => void runAnalysis(item.text, item.range)} />
        ))}
      </View>

      <Card>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={hasAnalysis ? '继续问它：微量元素、餐次、明天怎么吃...' : '问它：训练状态、饥饿感、碳水、减脂卡住...'}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          returnKeyType="send"
          style={styles.input}
        />
        <AppButton label="发送给伙伴" disabled={busy || !input.trim()} loading={busy} onPress={send} />
      </Card>
    </Page>
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
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 10,
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  miniButton: {
    maxWidth: '100%',
    minHeight: 36,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  miniButtonActive: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
  },
  miniButtonText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  miniButtonTextActive: {
    color: colors.brandDark,
  },
  disabled: {
    opacity: 0.55,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 12,
    marginTop: 10,
    backgroundColor: colors.surface,
  },
  sessionRowActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  sessionTime: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  segment: {
    flexDirection: 'row',
    gap: 8,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 16,
  },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.surface,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: colors.brandDark,
  },
  messages: {
    gap: 14,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.md,
    padding: 12,
  },
  petBubble: {
    backgroundColor: colors.surfaceMuted,
  },
  userBubble: {
    backgroundColor: colors.brand,
  },
  messageText: {
    color: colors.text,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#fff',
    fontWeight: '700',
  },
  clueList: {
    marginTop: 10,
    gap: 6,
  },
  clueText: {
    color: colors.textSecondary,
    lineHeight: 20,
    fontSize: 13,
  },
  actionList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  actionChip: {
    color: colors.brandDark,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '800',
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thinkingBubble: {
    minWidth: 66,
    minHeight: 42,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 12,
    lineHeight: 22,
  },
})
