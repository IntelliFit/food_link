import { View, Text, ScrollView, Image, Input, Textarea } from '@tarojs/components'
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
  sanitizeUserFacingErrorMessage,
  uploadAnalyzeImageFile,
  compressImagePathForUpload,
  showUnifiedApiError,
  type ExerciseLogItem,
  type ExerciseTaskResultPayload,
  type MembershipStatus,
} from '../../../utils/api'
import {
  getExerciseLogCreditBlockMessage,
  isExerciseLogCreditExhausted,
} from '../../../utils/membership'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import CreditShortageSheet from '../../../components/CreditShortageSheet'
import { formatDateKey } from '../../../pages/index/utils/helpers'
import { COMMUNITY_FEED_CHANGED_EVENT, HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { getTodayRecordDateKey, normalizeRecordDate, persistRecordTargetDate } from '../../../utils/record-date'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
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

const COLLAPSIBLE_TEXT_RUNE_THRESHOLD = 90

type ExerciseEstimationMode = 'standard' | 'precision'
type ExerciseIntensity = 'low' | 'moderate' | 'high'

const EXERCISE_INTENSITY_OPTIONS: Array<{ value: ExerciseIntensity; label: string }> = [
  { value: 'low', label: '轻松' },
  { value: 'moderate', label: '中等' },
  { value: 'high', label: '吃力' },
]

interface ExerciseRecord {
  id: string
  content: string
  calories: number
  createdAt: string
  recordDate: string
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
  recordDate: string
}

function mapLogToRecord(log: ExerciseLogItem): ExerciseRecord {
  const fallbackDate = getTodayRecordDateKey()
  return {
    id: log.id,
    content: log.exercise_desc,
    calories: log.calories_burned,
    createdAt: log.recorded_at || log.created_at || log.recorded_on || new Date().toISOString(),
    recordDate: normalizeRecordDate(log.recorded_on || fallbackDate),
    reasoning: log.ai_reasoning ?? undefined
  }
}

function dateKeyFromTimestamp(value: string | undefined, fallbackDate: string): string {
  if (!value) return fallbackDate
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallbackDate
  return normalizeRecordDate(formatDateKey(parsed))
}

function applyExerciseTaskResult(task: { result?: unknown }): ExerciseTaskResultPayload | null {
  const raw = task.result as ExerciseTaskResultPayload | undefined
  if (raw?.exercise_log) return raw
  return null
}

function shouldCollapseText(value: string): boolean {
  return Array.from(value.trim()).length > COLLAPSIBLE_TEXT_RUNE_THRESHOLD
}

/** API 可能把 error_message 存成对象序列化，统一成可读短句 */
function normalizeTaskErrorMessage(raw: unknown): string {
  if (raw == null) return '分析失败'
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.startsWith('{') && t.includes('"message"')) {
      try {
        const j = JSON.parse(t) as { message?: string }
        if (typeof j.message === 'string') return sanitizeUserFacingErrorMessage(j.message, '分析失败')
      } catch {
        /* ignore */
      }
    }
    return sanitizeUserFacingErrorMessage(t, '分析失败')
  }
  if (typeof raw === 'object' && raw !== null && 'message' in raw) {
    const m = (raw as { message?: unknown }).message
    return typeof m === 'string' ? sanitizeUserFacingErrorMessage(m, '分析失败') : sanitizeUserFacingErrorMessage(JSON.stringify(raw), '分析失败')
  }
  return sanitizeUserFacingErrorMessage(String(raw), '分析失败')
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
  const [expandedTextKeys, setExpandedTextKeys] = useState<Record<string, boolean>>({})
  const [creditSheet, setCreditSheet] = useState<{ visible: boolean; message?: string; status?: MembershipStatus | null }>({
    visible: false,
    status: null,
  })
  const [selectedImagePath, setSelectedImagePath] = useState('')
  const [estimationMode, setEstimationMode] = useState<ExerciseEstimationMode>('standard')
  const [precisionDuration, setPrecisionDuration] = useState('')
  const [precisionIntensity, setPrecisionIntensity] = useState<ExerciseIntensity>('moderate')
  const [precisionHeartRate, setPrecisionHeartRate] = useState('')
  const [precisionDistance, setPrecisionDistance] = useState('')
  const [precisionBreakdown, setPrecisionBreakdown] = useState('')
  const currentRecordDateRef = useRef(recordDate)
  const pollingTaskIdsRef = useRef<Set<string>>(new Set())

  const loadRecordsForDate = useCallback(async (targetDate: string): Promise<void> => {
    if (!getAccessToken()) {
      setRecords([])
      return
    }
    try {
      const normalizedDate = normalizeRecordDate(targetDate)
      const { logs } = await getExerciseLogs({ date: normalizedDate })
      if (currentRecordDateRef.current === normalizedDate) {
        setRecords(logs.map(mapLogToRecord).filter((log) => log.recordDate === normalizedDate))
      }
    } catch (e) {
      console.error('[exercise-record] load logs', e)
    }
  }, [])

  const persistPendingOnly = useCallback((items: PendingExerciseCard[]) => {
    try {
      const toSave = items.filter((p) => p.status === 'pending').map((p) => ({
        clientId: p.clientId,
        taskId: p.taskId,
        content: p.content,
        createdAt: p.createdAt,
        recordDate: p.recordDate
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
        recordDate?: string
      }>
      if (!Array.isArray(parsed)) return
      setPendingItems(
        parsed.map((row) => ({
          clientId: row.clientId,
          taskId: row.taskId,
          content: row.content,
          status: 'pending' as const,
          createdAt: row.createdAt,
          recordDate: normalizeRecordDate(row.recordDate || dateKeyFromTimestamp(row.createdAt, getTodayRecordDateKey()))
        }))
      )
    } catch (e) {
      console.error('[exercise-record] load pending storage', e)
    }
  }, [])

  const pollForTask = useCallback(
    async (taskId: string, clientId: string, taskRecordDate?: string): Promise<void> => {
      if (pollingTaskIdsRef.current.has(taskId)) return
      pollingTaskIdsRef.current.add(taskId)
      const maxAttempts = 120
      const targetDate = normalizeRecordDate(taskRecordDate || currentRecordDateRef.current)
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
            if (currentRecordDateRef.current === targetDate) {
              await loadRecordsForDate(targetDate)
            }
            Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
            Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
            Taro.showToast({
              title: `已记录 ${payload.estimated_calories} kcal`,
              icon: 'success'
            })
            return
          }
          if (['failed', 'violated', 'timed_out', 'cancelled'].includes(task.status)) {
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
    [loadRecordsForDate]
  )

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextDate = normalizeRecordDate(String(params?.date || ''))
    persistRecordTargetDate(nextDate)
    currentRecordDateRef.current = nextDate
    setRecordDate(nextDate)
    void loadRecordsForDate(nextDate)
    loadPendingFromStorage()
  }, [loadPendingFromStorage, loadRecordsForDate])

  useEffect(() => {
    pendingItems.filter((p) => p.status === 'pending').forEach((p) => {
      void pollForTask(p.taskId, p.clientId, p.recordDate)
    })
  }, [pendingItems, pollForTask])

  useDidShow(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextDate = normalizeRecordDate(String(params?.date || ''))
    persistRecordTargetDate(nextDate)
    currentRecordDateRef.current = nextDate
    setRecordDate(nextDate)
    void loadRecordsForDate(nextDate)
    if (getAccessToken()) {
      getMyMembership().then(setMembershipStatus).catch(() => {})
    }
    try {
      const raw = Taro.getStorageSync(EXERCISE_PENDING_TASKS_KEY)
      if (!raw || typeof raw !== 'string') return
      const parsed = JSON.parse(raw) as Array<{ taskId: string; clientId: string; createdAt?: string; recordDate?: string }>
      if (!Array.isArray(parsed)) return
      parsed.forEach((row) => {
        const taskDate = normalizeRecordDate(row.recordDate || dateKeyFromTimestamp(row.createdAt, nextDate))
        void pollForTask(row.taskId, row.clientId, taskDate)
      })
    } catch {
      /* ignore */
    }
  })

  const displayRows: DisplayRow[] = useMemo(() => {
    const rows: DisplayRow[] = []
    records.filter((r) => r.recordDate === recordDate).forEach((r) => rows.push({ key: `s-${r.id}`, kind: 'server', record: r }))
    pendingItems
      .filter((p) => p.recordDate === recordDate)
      .forEach((p) => rows.push({ key: `p-${p.clientId}`, kind: 'pending', item: p }))
    return rows.sort(
      (a, b) =>
        new Date(b.kind === 'server' ? b.record.createdAt : b.item.createdAt).getTime() -
        new Date(a.kind === 'server' ? a.record.createdAt : a.item.createdAt).getTime()
    )
  }, [records, pendingItems, recordDate])

  const visibleRecordCount = records.filter((r) => r.recordDate === recordDate).length
  const visiblePendingCount = pendingItems.filter((p) => p.status === 'pending' && p.recordDate === recordDate).length
  const totalCalories = records.filter((r) => r.recordDate === recordDate).reduce((sum, r) => sum + r.calories, 0)
  const recordCount = visibleRecordCount + visiblePendingCount
  const statsLabel = recordDate === getTodayRecordDateKey() ? '今日消耗' : `${recordDate} 消耗`

  const handleAddImage = (): void => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        const sourceType: Array<'album' | 'camera'> = res.tapIndex === 0 ? ['camera'] : ['album']
        void chooseImageWithPrivacy({
          count: 1,
          sizeType: ['compressed'],
          sourceType,
        }).then((chooseRes) => {
          const paths = chooseRes.tempFilePaths || []
          if (paths.length > 0) {
            setSelectedImagePath(paths[0])
          }
        }).catch((err) => {
          if (err.errMsg?.includes('cancel')) return
          if (isPrivacyAuthorizeError(err)) {
            showPrivacyAuthorizeFailure(err)
            return
          }
          console.error('[exercise-record] chooseImage', err)
        })
      }
    })
  }

  const clearSelectedImage = (): void => {
    setSelectedImagePath('')
  }

  const runSubmitFlow = async (): Promise<void> => {
    const content = inputValue.trim()
    const hasImage = !!selectedImagePath
    if (!content && !hasImage) {
      Taro.showToast({ title: '请输入运动描述或选择图片', icon: 'none' })
      return
    }
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    const precisionEnabled = estimationMode === 'precision'
    const totalDurationMin = Number(precisionDuration)
    const averageHeartRate = Number(precisionHeartRate)
    const distanceKm = Number(precisionDistance)
    if (precisionEnabled && (!Number.isFinite(totalDurationMin) || totalDurationMin < 1 || totalDurationMin > 480)) {
      Taro.showToast({ title: '请填写 1–480 分钟的总时长', icon: 'none' })
      return
    }
    if (precisionEnabled && precisionHeartRate && (!Number.isFinite(averageHeartRate) || averageHeartRate < 30 || averageHeartRate > 250)) {
      Taro.showToast({ title: '平均心率请填写 30–250', icon: 'none' })
      return
    }
    if (precisionEnabled && precisionDistance && (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 1000)) {
      Taro.showToast({ title: '运动距离填写有误', icon: 'none' })
      return
    }
    const targetRecordDate = persistRecordTargetDate(
      normalizeRecordDate(currentRecordDateRef.current || recordDate)
    )
    const isTodayRecord = targetRecordDate === getTodayRecordDateKey()
    if (isTodayRecord && isExerciseLogCreditExhausted(membershipStatus)) {
      setCreditSheet({
        visible: true,
        status: membershipStatus,
        message: getExerciseLogCreditBlockMessage(membershipStatus),
      })
      return
    }
    if (submitting) return

    setSubmitting(true)
    Taro.showLoading({ title: '提交中...', mask: true })
    let uploadedImageUrl = ''
    try {
      if (hasImage) {
        const compressedPath = await compressImagePathForUpload(selectedImagePath)
        const { imageUrl } = await uploadAnalyzeImageFile(compressedPath)
        uploadedImageUrl = imageUrl
      }
      const membership = await getMyMembership().catch(() => null)
      if (membership) {
        setMembershipStatus(membership)
        if (isTodayRecord && isExerciseLogCreditExhausted(membership)) {
          setCreditSheet({
            visible: true,
            status: membership,
            message: getExerciseLogCreditBlockMessage(membership),
          })
          return
        }
      }
      currentRecordDateRef.current = targetRecordDate
      setRecordDate(targetRecordDate)
      const displayContent = content || '图片识别运动'
      const { task_id: taskId } = await createExerciseLog({
        exercise_desc: content,
        image_url: uploadedImageUrl || undefined,
        date: targetRecordDate,
        estimation_mode: estimationMode,
        total_duration_min: precisionEnabled ? totalDurationMin : undefined,
        intensity: precisionEnabled ? precisionIntensity : undefined,
        average_heart_rate: precisionEnabled && precisionHeartRate ? averageHeartRate : undefined,
        distance_km: precisionEnabled && precisionDistance ? distanceKm : undefined,
        exercise_breakdown: precisionEnabled ? precisionBreakdown : undefined,
      })
      const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      const createdAt = new Date().toISOString()
      setInputValue('')
      setSelectedImagePath('')
      setPrecisionDuration('')
      setPrecisionHeartRate('')
      setPrecisionDistance('')
      setPrecisionBreakdown('')
      setPendingItems((prev) => [
        ...prev,
        { clientId, taskId, content: displayContent, status: 'pending', createdAt, recordDate: targetRecordDate }
      ])
      void pollForTask(taskId, clientId, targetRecordDate)
    } catch (e) {
      console.error('[exercise-record] send', e)
      const msg = e instanceof Error ? e.message : '提交失败'
      const isQuota =
        msg.includes('积分不足') ||
        msg.includes('明日再试') ||
        msg.includes('开通会员') ||
        msg.includes('升级更高套餐')
      if (isQuota) {
        setCreditSheet({ visible: true, status: membershipStatus, message: msg })
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
          Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
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
    if (Number.isNaN(date.getTime())) {
      return '--:--'
    }
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  const listEmpty = displayRows.length === 0
  const recordDateLabel = recordDate === getTodayRecordDateKey() ? '今天' : recordDate
  const openTrend = () => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/exercise-trend/index')}?date=${encodeURIComponent(recordDate)}` })
  }
  const toggleExpandedText = (key: string): void => {
    setExpandedTextKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const renderCollapsibleExerciseText = (key: string, text: string) => {
    const collapsed = shouldCollapseText(text) && !expandedTextKeys[key]
    const expandable = shouldCollapseText(text)
    return (
      <View className={`exercise-record-card__title-wrap ${collapsed ? 'is-collapsed' : ''}`}>
        <Text className='exercise-record-card__title'>{text}</Text>
        {expandable ? (
          <View
            className='exercise-record-card__text-toggle'
            onClick={() => toggleExpandedText(key)}
          >
            <Text className='exercise-record-card__text-toggle-text'>
              {collapsed ? '展开' : '收起'}
            </Text>
          </View>
        ) : null}
      </View>
    )
  }

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

      <View className='input-section'>
        <View className='exercise-compose-header'>
          <View>
            <Text className='exercise-compose-kicker'>{recordDateLabel}</Text>
            <Text className='exercise-compose-title'>记录运动</Text>
            <Text className='exercise-compose-cost'>消耗 1 积分</Text>
          </View>
          <View className='exercise-trend-link' onClick={openTrend}>
            <Text className='exercise-trend-link-text'>查看趋势</Text>
          </View>
        </View>
        <View className='exercise-mode-switch' data-testid='exercise-mode-switch'>
          <View
            className={`exercise-mode-option ${estimationMode === 'standard' ? 'is-active' : ''}`}
            onClick={() => setEstimationMode('standard')}
          >
            <Text className='exercise-mode-option__title'>标准估算</Text>
            <Text className='exercise-mode-option__desc'>按整次描述估算</Text>
          </View>
          <View
            className={`exercise-mode-option ${estimationMode === 'precision' ? 'is-active' : ''}`}
            onClick={() => setEstimationMode('precision')}
          >
            <Text className='exercise-mode-option__title'>精准估算</Text>
            <Text className='exercise-mode-option__desc'>补充训练细节</Text>
          </View>
        </View>
        {estimationMode === 'precision' ? (
          <View className='exercise-precision-panel' data-testid='exercise-precision-panel'>
            <View className='exercise-precision-heading'>
              <Text className='exercise-precision-title'>补充信息，减少猜测</Text>
              <Text className='exercise-precision-tip'>总时长只会用于整次训练，不会复制给每个动作</Text>
            </View>
            <View className='exercise-precision-field'>
              <Text className='exercise-precision-label'>整次总时长 *</Text>
              <View className='exercise-precision-input-wrap'>
                <Input
                  className='exercise-precision-input'
                  type='number'
                  value={precisionDuration}
                  onInput={(e) => setPrecisionDuration(e.detail.value)}
                  placeholder='例如 40'
                  disabled={submitting}
                />
                <Text className='exercise-precision-unit'>分钟</Text>
              </View>
            </View>
            <View className='exercise-precision-field'>
              <Text className='exercise-precision-label'>主观强度</Text>
              <View className='exercise-intensity-options'>
                {EXERCISE_INTENSITY_OPTIONS.map((option) => (
                  <View
                    key={option.value}
                    className={`exercise-intensity-option ${precisionIntensity === option.value ? 'is-active' : ''}`}
                    onClick={() => setPrecisionIntensity(option.value)}
                  >
                    <Text>{option.label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View className='exercise-precision-inline-fields'>
              <View className='exercise-precision-field exercise-precision-field--half'>
                <Text className='exercise-precision-label'>平均心率（选填）</Text>
                <View className='exercise-precision-input-wrap'>
                  <Input
                    className='exercise-precision-input'
                    type='number'
                    value={precisionHeartRate}
                    onInput={(e) => setPrecisionHeartRate(e.detail.value)}
                    placeholder='例如 135'
                    disabled={submitting}
                  />
                  <Text className='exercise-precision-unit'>次/分</Text>
                </View>
              </View>
              <View className='exercise-precision-field exercise-precision-field--half'>
                <Text className='exercise-precision-label'>距离（选填）</Text>
                <View className='exercise-precision-input-wrap'>
                  <Input
                    className='exercise-precision-input'
                    type='digit'
                    value={precisionDistance}
                    onInput={(e) => setPrecisionDistance(e.detail.value)}
                    placeholder='例如 5.2'
                    disabled={submitting}
                  />
                  <Text className='exercise-precision-unit'>公里</Text>
                </View>
              </View>
            </View>
            <View className='exercise-precision-field'>
              <Text className='exercise-precision-label'>动作时间或组次（选填）</Text>
              <Textarea
                className='exercise-precision-breakdown'
                value={precisionBreakdown}
                onInput={(e) => setPrecisionBreakdown(e.detail.value)}
                placeholder='例如：深蹲 4×12、俯卧撑 4×10；或深蹲15分钟、俯卧撑10分钟'
                maxlength={1000}
                autoHeight
                showConfirmBar={false}
                disabled={submitting}
              />
            </View>
          </View>
        ) : null}
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
        {selectedImagePath ? (
          <View className='image-preview-wrap'>
            <Image
              className='image-preview-thumb'
              src={selectedImagePath}
              mode='aspectFill'
            />
            <View className='image-preview-remove' onClick={clearSelectedImage}>
              <Text className='image-preview-remove-text'>×</Text>
            </View>
          </View>
        ) : null}
        <View className='input-wrap'>
          <View
            className='exercise-image-trigger'
            onClick={handleAddImage}
          >
            <Text className='exercise-image-trigger-text'>+</Text>
          </View>
          <Textarea
            className='chat-input'
            value={inputValue}
            onInput={(e) => setInputValue(e.detail.value)}
            placeholder={selectedImagePath ? '补充描述（可选）' : '今天做了什么运动？'}
            placeholderClass='input-placeholder'
            maxlength={2000}
            autoHeight
            showConfirmBar={false}
            disabled={submitting}
          />
          <View
            className={`exercise-send-trigger ${(!inputValue.trim() && !selectedImagePath) || submitting ? 'is-disabled' : ''}`}
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
            <Text className='empty-title'>{recordDateLabel}还没有运动记录</Text>
            <Text className='empty-desc'>上方输入运动内容或添加图片，系统会估算消耗。</Text>
          </View>
        ) : (
          <View className='records-list'>
            {displayRows.map((row) =>
              row.kind === 'server' ? (
                <View key={row.key} className='exercise-record-card'>
                  <View className='exercise-record-card__top'>
                    {renderCollapsibleExerciseText(row.key, row.record.content)}
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
                    {renderCollapsibleExerciseText(row.key, row.item.content)}
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
      <CreditShortageSheet
        visible={creditSheet.visible}
        membershipStatus={creditSheet.status ?? membershipStatus}
        requiredCredits={1}
        scenarioLabel='运动记录'
        message={creditSheet.message}
        onClose={() => setCreditSheet({ visible: false, status: null })}
      />
    </View>
  )
}
