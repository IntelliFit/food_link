import { View, Text, Input, ScrollView, Image } from '@tarojs/components'
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
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
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
  const [creditSheet, setCreditSheet] = useState<{ visible: boolean; message?: string; status?: MembershipStatus | null }>({
    visible: false,
    status: null,
  })
  const [selectedImagePath, setSelectedImagePath] = useState('')
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
        date: targetRecordDate
      })
      const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      const createdAt = new Date().toISOString()
      setInputValue('')
      setSelectedImagePath('')
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
          </View>
          <View className='exercise-trend-link' onClick={openTrend}>
            <Text className='exercise-trend-link-text'>查看趋势</Text>
          </View>
        </View>
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
          <Input
            className='chat-input'
            value={inputValue}
            onInput={(e) => setInputValue(e.detail.value)}
            placeholder={selectedImagePath ? '补充描述（可选）' : '今天做了什么运动？'}
            placeholderClass='input-placeholder'
            confirmType='send'
            onConfirm={runSubmitFlow}
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
