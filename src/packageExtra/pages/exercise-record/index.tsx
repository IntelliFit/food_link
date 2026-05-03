import { View, Text, Input, ScrollView } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { IconExercise } from '../../../components/iconfont'
import {
  getAccessToken,
  createExerciseLog,
  getExerciseLogs,
  deleteExerciseLog,
  getAnalyzeTask,
  getMyMembership,
  type ExerciseLogItem,
  type ExerciseTaskResultPayload,
  type MembershipStatus,
} from '../../../utils/api'
import {
  getExerciseLogBlockedActionText,
  getExerciseLogCreditBlockMessage,
  isExerciseLogCreditExhausted,
} from '../../../utils/membership'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { showUnifiedApiError } from '../../../utils/error-modal'
import { formatDateKey } from '../../../pages/index/utils/helpers'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { getTodayRecordDateKey, normalizeRecordDate, persistRecordTargetDate } from '../../../utils/record-date'
import './index.scss'

/** 仅 status=pending 的项会写入，用于杀进程后恢复轮询 */
const EXERCISE_PENDING_TASKS_KEY = 'exercise_pending_tasks_v1'

const EXERCISE_QUICK_PRESETS: string[] = [
  '跑步30分钟',
  '游泳45分钟',
  '瑜伽1小时',
  '骑车20分钟',
  '健身40分钟',
  '跳绳15分钟',
  '散步45分钟',
  'HIIT20分钟'
]

interface ExerciseRecord {
  id: string
  content: string
  calories: number
  createdAt: string
  /** 模型思考过程（有则展示） */
  reasoning?: string | null
}

/** 本地「分析中 / 失败」卡片（不跳转页面） */
interface PendingExerciseCard {
  clientId: string
  taskId: string
  content: string
  status: 'pending' | 'failed'
  errorMessage?: string
  createdAt: string
}

function mapLogToRecord(log: ExerciseLogItem): ExerciseRecord {
  return {
    id: log.id,
    content: log.exercise_desc,
    calories: log.calories_burned,
    createdAt: log.recorded_at,
    reasoning: log.ai_reasoning ?? undefined
  }
}

function applyExerciseTaskResult(task: { result?: unknown }): ExerciseTaskResultPayload | null {
  const raw = task.result as ExerciseTaskResultPayload | undefined
  if (raw?.exercise_log) return raw
  return null
}

/** API 可能把 error_message 存成对象序列化，统一成可读短句 */
function normalizeTaskErrorMessage(raw: unknown): string {
  if (raw == null) return '分析失败'
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.startsWith('{') && t.includes('"message"')) {
      try {
        const j = JSON.parse(t) as { message?: string }
        if (typeof j.message === 'string') return j.message
      } catch {
        /* ignore */
      }
    }
    return t || '分析失败'
  }
  if (typeof raw === 'object' && raw !== null && 'message' in raw) {
    const m = (raw as { message?: unknown }).message
    return typeof m === 'string' ? m : JSON.stringify(raw)
  }
  return String(raw)
}

type DisplayRow =
  | { key: string; kind: 'server'; record: ExerciseRecord }
  | { key: string; kind: 'pending'; item: PendingExerciseCard }

export default function ExerciseRecordPage() {
  const [recordDate, setRecordDate] = useState(() =>
    normalizeRecordDate(String(Taro.getCurrentInstance().router?.params?.date || ''))
  )
  const [inputValue, setInputValue] = useState('')
  const [records, setRecords] = useState<ExerciseRecord[]>([])
  const [pendingItems, setPendingItems] = useState<PendingExerciseCard[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const pollingTaskIdsRef = useRef<Set<string>>(new Set())

  const loadTodayRecords = useCallback(async (): Promise<void> => {
    if (!getAccessToken()) {
      setRecords([])
      return
    }
    try {
      const { logs } = await getExerciseLogs({ date: recordDate })
      setRecords(logs.map(mapLogToRecord))
    } catch (e) {
      console.error('[exercise-record] load logs', e)
    }
  }, [recordDate])

  const persistPendingOnly = useCallback((items: PendingExerciseCard[]) => {
    try {
      const toSave = items.filter((p) => p.status === 'pending').map((p) => ({
        clientId: p.clientId,
        taskId: p.taskId,
        content: p.content,
        createdAt: p.createdAt
      }))
      Taro.setStorageSync(EXERCISE_PENDING_TASKS_KEY, JSON.stringify(toSave))
    } catch (e) {
      console.error('[exercise-record] persist pending', e)
    }
  }, [])

  useEffect(() => {
    persistPendingOnly(pendingItems)
  }, [pendingItems, persistPendingOnly])

  const loadPendingFromStorage = useCallback((): void => {
    try {
      const raw = Taro.getStorageSync(EXERCISE_PENDING_TASKS_KEY)
      if (!raw || typeof raw !== 'string') return
      const parsed = JSON.parse(raw) as Array<{
        clientId: string
        taskId: string
        content: string
        createdAt: string
      }>
      if (!Array.isArray(parsed)) return
      setPendingItems(
        parsed.map((row) => ({
          clientId: row.clientId,
          taskId: row.taskId,
          content: row.content,
          status: 'pending' as const,
          createdAt: row.createdAt
        }))
      )
    } catch (e) {
      console.error('[exercise-record] load pending storage', e)
    }
  }, [])

  const pollForTask = useCallback(
    async (taskId: string, clientId: string): Promise<void> => {
      if (pollingTaskIdsRef.current.has(taskId)) return
      pollingTaskIdsRef.current.add(taskId)
      const maxAttempts = 120
      try {
        for (let i = 0; i < maxAttempts; i++) {
          if (i > 0) {
            await new Promise<void>((resolve) => setTimeout(() => resolve(), 2000))
          }
          const task = await getAnalyzeTask(taskId)
          const payload = applyExerciseTaskResult(task)
          if (task.status === 'done' && payload) {
            setPendingItems((prev) => prev.filter((p) => p.clientId !== clientId))
            setInputValue('')
            await loadTodayRecords()
            Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
            Taro.showToast({
              title: `已记录 ${payload.estimated_calories} kcal`,
              icon: 'success'
            })
            return
          }
          if (task.status === 'failed' || task.status === 'violated') {
            const msg = normalizeTaskErrorMessage(task.error_message)
            setPendingItems((prev) =>
              prev.map((p) =>
                p.clientId === clientId ? { ...p, status: 'failed' as const, errorMessage: msg } : p
              )
            )
            return
          }
        }
        setPendingItems((prev) =>
          prev.map((p) =>
            p.clientId === clientId
              ? { ...p, status: 'failed' as const, errorMessage: '分析超时，请稍后下拉刷新' }
              : p
          )
        )
      } catch (e) {
        console.error('[exercise-record] poll', e)
        setPendingItems((prev) =>
          prev.map((p) =>
            p.clientId === clientId
              ? {
                  ...p,
                  status: 'failed' as const,
                  errorMessage: e instanceof Error ? e.message : '网络异常'
                }
              : p
          )
        )
      } finally {
        pollingTaskIdsRef.current.delete(taskId)
      }
    },
    [loadTodayRecords]
  )

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextDate = normalizeRecordDate(String(params?.date || ''))
    persistRecordTargetDate(nextDate)
    setRecordDate(nextDate)
    void loadTodayRecords()
    loadPendingFromStorage()
  }, [loadPendingFromStorage, loadTodayRecords])

  useEffect(() => {
    pendingItems.filter((p) => p.status === 'pending').forEach((p) => {
      void pollForTask(p.taskId, p.clientId)
    })
  }, [pendingItems, pollForTask])

  useDidShow(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextDate = normalizeRecordDate(String(params?.date || ''))
    persistRecordTargetDate(nextDate)
    setRecordDate(nextDate)
    void loadTodayRecords()
    if (getAccessToken()) {
      getMyMembership().then(setMembershipStatus).catch(() => {})
    }
    try {
      const raw = Taro.getStorageSync(EXERCISE_PENDING_TASKS_KEY)
      if (!raw || typeof raw !== 'string') return
      const parsed = JSON.parse(raw) as Array<{ taskId: string; clientId: string }>
      if (!Array.isArray(parsed)) return
      parsed.forEach((row) => void pollForTask(row.taskId, row.clientId))
    } catch {
      /* ignore */
    }
  })

  const displayRows: DisplayRow[] = useMemo(() => {
    const rows: DisplayRow[] = []
    records.forEach((r) => rows.push({ key: `s-${r.id}`, kind: 'server', record: r }))
    pendingItems.forEach((p) => rows.push({ key: `p-${p.clientId}`, kind: 'pending', item: p }))
    return rows.sort(
      (a, b) =>
        new Date(a.kind === 'server' ? a.record.createdAt : a.item.createdAt).getTime() -
        new Date(b.kind === 'server' ? b.record.createdAt : b.item.createdAt).getTime()
    )
  }, [records, pendingItems])

  const totalCalories = records.reduce((sum, r) => sum + r.calories, 0)
  const recordCount = records.length + pendingItems.filter((p) => p.status === 'pending').length
  const statsLabel = recordDate === getTodayRecordDateKey() ? '今日消耗' : `${recordDate} 消耗`

  const runSubmitFlow = async (): Promise<void> => {
    const content = inputValue.trim()
    if (!content) {
      Taro.showToast({ title: '请输入运动描述', icon: 'none' })
      return
    }
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    if (isExerciseLogCreditExhausted(membershipStatus)) {
      const content = getExerciseLogCreditBlockMessage(membershipStatus)
      const confirmText = getExerciseLogBlockedActionText(membershipStatus)
      const showUpgrade = content.includes('开通') || content.includes('升级') || membershipStatus?.is_pro
      Taro.showModal({
        title: '积分不足',
        content,
        showCancel: showUpgrade,
        confirmText: showUpgrade ? confirmText : '知道了',
        cancelText: '取消',
        success: (res) => {
          if (showUpgrade && res.confirm) {
            Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
          }
        }
      })
      return
    }
    if (submitting) return

    setSubmitting(true)
    Taro.showLoading({ title: '提交中...', mask: true })
    try {
      const membership = await getMyMembership().catch(() => null)
      if (membership) {
        setMembershipStatus(membership)
        if (isExerciseLogCreditExhausted(membership)) {
          const content = getExerciseLogCreditBlockMessage(membership)
          const confirmText = getExerciseLogBlockedActionText(membership)
          const showUpgrade = content.includes('开通') || content.includes('升级') || membership.is_pro
          Taro.showModal({
            title: '积分不足',
            content,
            showCancel: showUpgrade,
            confirmText: showUpgrade ? confirmText : '知道了',
            cancelText: '取消',
            success: (res) => {
              if (showUpgrade && res.confirm) {
                Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
              }
            }
          })
          return
        }
      }
      const { task_id: taskId } = await createExerciseLog({ exercise_desc: content, date: recordDate })
      const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      const createdAt = new Date().toISOString()
      setInputValue('')
      setPendingItems((prev) => [
        ...prev,
        { clientId, taskId, content, status: 'pending', createdAt }
      ])
      void pollForTask(taskId, clientId)
    } catch (e) {
      console.error('[exercise-record] send', e)
      const msg = e instanceof Error ? e.message : '提交失败'
      const isQuota =
        msg.includes('积分不足') ||
        msg.includes('明日再试') ||
        msg.includes('开通会员') ||
        msg.includes('升级更高套餐')
      if (isQuota) {
        const suggestUpgrade = msg.includes('开通') || msg.includes('升级')
        Taro.showModal({
          title: '积分不足',
          content: msg,
          showCancel: suggestUpgrade,
          confirmText: suggestUpgrade ? getExerciseLogBlockedActionText(membershipStatus) : '知道了',
          cancelText: '取消',
          success: (res) => {
            if (suggestUpgrade && res.confirm) {
              Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
            }
          }
        })
      } else {
        await showUnifiedApiError(e, '提交失败')
      }
    } finally {
      Taro.hideLoading()
      setSubmitting(false)
    }
  }

  const handleDelete = (id: string): void => {
    Taro.showModal({
      title: '确认删除',
      content: '确定要删除这条运动记录吗？',
      success: async (res) => {
        if (!res.confirm) return
        if (!getAccessToken()) {
          Taro.navigateTo({ url: '/pages/login/index' })
          return
        }
        Taro.showLoading({ title: '删除中...', mask: true })
        try {
          await deleteExerciseLog(id)
          setRecords((prev) => prev.filter((r) => r.id !== id))
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
          Taro.showToast({ title: '已删除', icon: 'success' })
        } catch (e) {
          await showUnifiedApiError(e, '删除失败')
        } finally {
          Taro.hideLoading()
        }
      }
    })
  }

  const dismissFailedCard = (clientId: string): void => {
    setPendingItems((prev) => prev.filter((p) => p.clientId !== clientId))
  }

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString)
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  const listEmpty = displayRows.length === 0

  return (
    <View className='exercise-record-page'>
      <View className='header-stats'>
        <View className='stats-card'>
          <View className='stats-icon-wrap stats-icon-wrap--tab-stats'>
            {/* 与 custom-tab-bar「分析」相同的 CSS 柱状图（选中绿 #07c160） */}
            <View className='exercise-header-stats-icon' />
          </View>
          <View className='stats-info'>
            <Text className='stats-label'>{statsLabel}</Text>
            <View className='stats-value-wrap'>
              <Text className='stats-value'>{totalCalories}</Text>
              <Text className='stats-unit'>kcal</Text>
            </View>
          </View>
          <Text className='stats-count'>{recordCount} 次记录</Text>
        </View>
      </View>

      <ScrollView
        className={`records-scroll ${listEmpty ? 'records-scroll--empty' : ''}`}
        scrollY
        scrollWithAnimation
        scrollTop={99999}
        enhanced
        showScrollbar={false}
      >
        {listEmpty ? (
          <View className='empty-state'>
            <View className='empty-icon-wrap'>
              <IconExercise size={80} color='#d1d5db' />
            </View>
            <Text className='empty-title'>还没有运动记录</Text>
            <Text className='empty-desc'>在下方输入你今天做了什么运动{'\n'}例如：&quot;跑步30分钟&quot; 或 &quot;游泳1小时&quot;</Text>
          </View>
        ) : (
          <View className='records-list'>
            {displayRows.map((row) =>
              row.kind === 'server' ? (
                <View key={row.key} className='exercise-record-card'>
                  <View className='exercise-record-card__top'>
                    <Text className='exercise-record-card__title'>{row.record.content}</Text>
                    <View
                      className='exercise-record-card__delete'
                      onClick={() => handleDelete(row.record.id)}
                    >
                      <Text className='exercise-record-card__delete-text'>删除</Text>
                    </View>
                  </View>
                  <View className='exercise-record-card__divider' />
                  <View className='exercise-record-card__bottom'>
                    <View className='exercise-record-card__kcal'>
                      <IconExercise size={28} color='#f97316' />
                      <Text className='exercise-record-card__kcal-num'>{row.record.calories}</Text>
                      <Text className='exercise-record-card__kcal-unit'>kcal</Text>
                    </View>
                    <Text className='exercise-record-card__time'>{formatTime(row.record.createdAt)}</Text>
                  </View>
                </View>
              ) : (
                <View
                  key={row.key}
                  className={`exercise-record-card ${row.item.status === 'failed' ? 'exercise-record-card--failed' : ''}`}
                >
                  <View className='exercise-record-card__top'>
                    <Text className='exercise-record-card__title'>{row.item.content}</Text>
                  </View>
                  {row.item.status === 'pending' ? (
                    <>
                      <View className='exercise-record-card__divider' />
                      <View className='exercise-record-card__bottom'>
                        <View className='exercise-record-card__pending'>
                          <View className='exercise-record-card__spinner' />
                          <Text className='exercise-record-card__pending-text'>分析中，估算消耗…</Text>
                        </View>
                        <Text className='exercise-record-card__time'>{formatTime(row.item.createdAt)}</Text>
                      </View>
                    </>
                  ) : (
                    <View className='exercise-record-card__fail'>
                      <Text className='exercise-record-card__fail-msg'>
                        {row.item.errorMessage || '分析失败'}
                      </Text>
                      <View className='exercise-record-card__fail-row'>
                        <Text className='exercise-record-card__time'>{formatTime(row.item.createdAt)}</Text>
                        <Text
                          className='exercise-record-card__dismiss'
                          onClick={() => dismissFailedCard(row.item.clientId)}
                        >
                          关闭
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )
            )}
          </View>
        )}
        <View style={{ height: '20rpx' }} />
      </ScrollView>

      <View className='input-section'>
        <View className='quick-examples-strip'>
          <Text className='quick-examples-title'>试试这样说：</Text>
          <ScrollView
            className='quick-chips-scroll'
            scrollX
            enhanced
            showScrollbar={false}
          >
            <View className='quick-chips-inner'>
              {EXERCISE_QUICK_PRESETS.map((example) => (
                <View
                  key={example}
                  className='example-tag'
                  onClick={() => setInputValue(example)}
                >
                  <Text className='example-tag-text'>{example}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
        <View className='input-wrap'>
          <Input
            className='chat-input'
            value={inputValue}
            onInput={(e) => setInputValue(e.detail.value)}
            placeholder='今天做了什么运动？'
            placeholderClass='input-placeholder'
            confirmType='send'
            onConfirm={runSubmitFlow}
            disabled={submitting}
          />
          <View
            className={`exercise-send-trigger ${!inputValue.trim() || submitting ? 'is-disabled' : ''}`}
            onClick={runSubmitFlow}
          >
            {submitting ? (
              <View className='exercise-send-spinner' />
            ) : (
              <Text className='iconfont icon-send' />
            )}
          </View>
        </View>
      </View>
    </View>
  )
}
