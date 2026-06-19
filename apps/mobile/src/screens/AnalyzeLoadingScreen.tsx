import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { AnalysisTask, ExecutionMode, MealType } from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'

type AnalyzeLoadingRoute = RouteProp<RootStackParamList, 'AnalyzeLoading'>
type AnalyzeTaskKind = 'food' | 'food_text' | 'exercise'
type FailureState = {
  title: string
  message: string
  tone: 'failed' | 'violated'
  traceId?: string
}

const FOOD_STANDARD_STAGE_LABELS = ['图像校验', '食物识别', '份量估算', '营养计算']
const FOOD_STRICT_STAGE_LABELS = ['细节校验', '食材拆分', '精准估重', '营养复核']
const FOOD_TEXT_STAGE_LABELS = ['读取描述', '拆分食物', '估算份量', '营养计算']
const EXERCISE_STAGE_LABELS = ['内容校验', '动作识别', '消耗估算', '写入记录']

const HEALTH_TIPS = [
  '吃饭顺序可以先蔬菜、再蛋白质、最后主食，更容易稳住餐后血糖。',
  '包装袋上的 kJ 除以 4.184，差不多就是 kcal。',
  '外卖备注少油少酱，比只说少辣更能减少隐藏热量。',
  '同一碗面，汤少喝一点，通常比纠结面条根数更有用。',
  '减脂期不是不吃主食，关键是主食、蛋白质和蔬菜一起配好。',
  '训练后补一点蛋白质和主食，更利于恢复，也不容易很快再饿。',
]

type WaitingInteractionCard = {
  eyebrow: string
  title: string
  options: [string, string]
  answerIndex: 0 | 1
  reveal: string
}

const WAITING_INTERACTION_CARDS: WaitingInteractionCard[] = [
  {
    eyebrow: '快问快答',
    title: '包装袋写 418 kJ，大约是多少 kcal？',
    options: ['约 100 kcal', '约 418 kcal'],
    answerIndex: 0,
    reveal: '约 100 kcal。1 kcal 约等于 4.184 kJ，把 kJ 除以 4.184 就行。',
  },
  {
    eyebrow: '快问快答',
    title: '同样 100g，哪个通常热量更高？',
    options: ['米饭', '油条'],
    answerIndex: 1,
    reveal: '油条通常更高。油炸会带来额外脂肪，热量密度会明显上去。',
  },
  {
    eyebrow: '快问快答',
    title: '吃盖饭时，哪个小动作更利于控量？',
    options: ['酱汁少浇一点', '先把饭拌匀'],
    answerIndex: 0,
    reveal: '少浇酱汁更稳。很多油、糖、盐都藏在酱汁里。',
  },
]

export function AnalyzeLoadingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<AnalyzeLoadingRoute>()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const scanProgress = useRef(new Animated.Value(0)).current
  const params = route.params
  const taskId = params?.taskId
  const routeTask = params?.task
  const mealType = (params?.mealType || 'lunch') as MealType
  const date = params?.date || todayKey()
  const previewImageUri = params?.imageUri || params?.imageUris?.[0] || ''
  const taskKind = resolveTaskKind(routeTask, params?.taskType)
  const isTextAnalysis = taskKind === 'food_text'
  const isExerciseAnalysis = taskKind === 'exercise'
  const executionMode = resolveExecutionMode(params?.executionMode, routeTask)
  const textRecordPreview = resolveTextPreview(routeTask)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [taskStatusText, setTaskStatusText] = useState('已提交')
  const [failure, setFailure] = useState<FailureState | null>(null)
  const [tipIndex, setTipIndex] = useState(0)
  const [interactionIndex, setInteractionIndex] = useState(0)
  const [selectedQuizOption, setSelectedQuizOption] = useState<number | null>(null)
  const frameSize = Math.min(Math.max(width - 40, 260), 320)
  const scanTranslateY = scanProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.round(frameSize * 0.08), Math.round(frameSize * 0.86)],
  })
  const scanOpacity = scanProgress.interpolate({
    inputRange: [0, 0.12, 0.88, 1],
    outputRange: [0, 1, 1, 0],
  })
  const stageLabels = useMemo(
    () => resolveStageLabels(taskKind, executionMode),
    [executionMode, taskKind],
  )
  const currentStageIndex = resolveStageIndex(taskStatusText, elapsedSeconds, stageLabels.length)
  const currentStage = stageLabels[currentStageIndex] || stageLabels[0]
  const interactionCard = WAITING_INTERACTION_CARDS[interactionIndex]
  const modeLabel = resolveModeLabel(taskKind, executionMode)
  const title = isExerciseAnalysis ? '食探正在整理运动' : isTextAnalysis ? '食探正在理解记录' : '食探正在看这餐'
  const subtitle = isExerciseAnalysis
    ? '运动消耗会在后台继续计算'
    : isTextAnalysis
      ? '文字记录会在后台继续分析'
      : '识别会在后台继续完成'

  useEffect(() => {
    scanProgress.setValue(0)
    const animation = Animated.loop(
      Animated.timing(scanProgress, {
        toValue: 1,
        duration: 2500,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    )
    animation.start()
    return () => animation.stop()
  }, [scanProgress])

  useEffect(() => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }, 1000)
    return () => clearInterval(timer)
  }, [taskId])

  useEffect(() => {
    const timer = setInterval(() => {
      setTipIndex((current) => (current + 1) % HEALTH_TIPS.length)
    }, 4500)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false

    const navigateWithTask = (task: AnalysisTask) => {
      if (resolveTaskKind(task, params?.taskType) === 'exercise') {
        navigation.replace('BodyMetricRecord', { type: 'exercise' })
        return
      }
      if (isTextFoodTask(task, params?.taskType)) {
        navigation.replace('TextResult', { task, mealType, date })
        return
      }
      navigation.replace('Result', {
        task,
        imageUri: previewImageUri,
        mealType,
        date,
      })
    }

    const pollTask = async () => {
      if (routeTask) {
        navigateWithTask(routeTask)
        return
      }
      if (!taskId) {
        setFailure({
          title: '缺少识别进度',
          message: '这次任务没有带上进度信息，请回到记录入口重新提交。',
          tone: 'failed',
        })
        return
      }

      let consecutivePollFailures = 0
      while (!cancelled) {
        try {
          const task = await apiClient.getAnalyzeTask(taskId)
          if (cancelled) return
          consecutivePollFailures = 0
          setTaskStatusText(statusLabel(task.status))

          if (task.status === 'done') {
            navigateWithTask(task)
            return
          }

          if (task.status === 'violated') {
            setFailure({
              title: '内容审核未通过',
              message: userFacingMessage(task.error_message, '请换一张与食物或运动相关的图片，或调整文字后再提交。'),
              tone: 'violated',
              traceId: task.trace_id || task.traceId || undefined,
            })
            return
          }

          if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
            setFailure({
              title: task.status === 'timed_out' ? '分析用时过长' : '分析没有成功',
              message: userFacingMessage(task.error_message, '可以稍后在识别记录查看，或重新提交一次。'),
              tone: 'failed',
              traceId: task.trace_id || task.traceId || undefined,
            })
            return
          }
        } catch (error) {
          consecutivePollFailures += 1
          setTaskStatusText('网络波动')
          if (consecutivePollFailures >= 3) {
            setFailure({
              title: '暂时连不上任务',
              message: userFacingErrorMessage(error, '网络暂时不稳定，可以稍后到识别记录查看结果。'),
              tone: 'failed',
            })
            return
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2500))
      }
    }

    void pollTask()
    return () => {
      cancelled = true
    }
  }, [date, mealType, navigation, params?.taskType, previewImageUri, routeTask, taskId])

  const handleNextInteraction = () => {
    setInteractionIndex((current) => (current + 1) % WAITING_INTERACTION_CARDS.length)
    setSelectedQuizOption(null)
  }

  if (failure) {
    return (
      <OutcomeScreen
        failure={failure}
        isExercise={isExerciseAnalysis}
        onPrimary={() => {
          if (isExerciseAnalysis) {
            navigation.replace('BodyMetricRecord', { type: 'exercise' })
            return
          }
          navigation.replace('AnalyzeHistory')
        }}
        onSecondary={() => navigation.replace('MainTabs')}
      />
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.backgroundLayer}>
        {isTextAnalysis ? (
          <View style={styles.textBackground}>
            <View style={styles.textBgHalo} />
            <View style={styles.textBgCard}>
              <Text style={styles.textBgIcon}>食</Text>
              <Text style={styles.textBgLabel} numberOfLines={4}>{textRecordPreview}</Text>
            </View>
          </View>
        ) : previewImageUri ? (
          <Image source={{ uri: previewImageUri }} style={styles.fullscreenImage} resizeMode="cover" />
        ) : (
          <View style={styles.fallbackBackground} />
        )}
        <View style={styles.screenWash} />
        <View style={styles.bottomReadability} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            minHeight: height,
            paddingTop: Math.max(insets.top + 18, 42),
            paddingBottom: Math.max(insets.bottom + 22, 40),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heroTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>{title}</Text>
        <Text style={styles.heroSubtitle}>{subtitle}</Text>

        <View style={styles.scannerFrameContainer}>
          <View style={[styles.scannerFrame, { width: frameSize, height: frameSize, borderRadius: Math.round(frameSize * 0.125) }]}>
            {isExerciseAnalysis ? (
              <View style={styles.framePlaceholder}>
                <Text style={styles.frameIcon}>动</Text>
                <Text style={styles.frameLabel}>运动记录</Text>
              </View>
            ) : isTextAnalysis ? (
              <View style={styles.framePlaceholder}>
                <Text style={styles.frameIcon}>食</Text>
                <Text style={styles.frameLabel} numberOfLines={4}>{textRecordPreview}</Text>
              </View>
            ) : previewImageUri ? (
              <Image source={{ uri: previewImageUri }} style={styles.frameImage} resizeMode="cover" />
            ) : (
              <View style={styles.framePlaceholder}>
                <Text style={styles.frameIcon}>食</Text>
                <Text style={styles.frameLabel}>识别任务</Text>
              </View>
            )}
            <Animated.View style={[styles.scanLine, { opacity: scanOpacity, transform: [{ translateY: scanTranslateY }] }]} />
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
        </View>

        <View style={styles.tipBox}>
          <Text style={styles.tipLabel}>小贴士</Text>
          <Text style={styles.tipText}>{HEALTH_TIPS[tipIndex]}</Text>
        </View>

        <View style={styles.stepsPanel}>
          <View style={styles.stageSummary}>
            <Text style={styles.stageSummaryTitle} numberOfLines={1}>{currentStage}</Text>
            <Text style={styles.stageSummaryTime}>已等待 {formatElapsed(elapsedSeconds)}</Text>
          </View>
          <View style={styles.stageMetaRow}>
            <Text style={styles.stageStatus}>任务{taskStatusText}</Text>
            <Text style={styles.stageFlow} numberOfLines={1}>{stageLabels.join('  >  ')}</Text>
          </View>
          {executionMode.includes('strict') && taskKind === 'food' ? (
            <Text style={styles.precisionNotice}>
              精准模式会更细致地识别食物和份量，可以先离开，完成后到识别记录查看。
            </Text>
          ) : null}
        </View>

        <View style={styles.waitingCard}>
          <View style={styles.waitingHead}>
            <Text style={styles.waitingEyebrow}>{interactionCard.eyebrow}</Text>
            <Pressable hitSlop={8} onPress={handleNextInteraction}>
              <Text style={styles.waitingSkip}>换一个</Text>
            </Pressable>
          </View>
          <Text style={styles.waitingTitle}>{interactionCard.title}</Text>
          <View style={styles.quizOptions}>
            {interactionCard.options.map((option, index) => {
              const chosen = selectedQuizOption === index
              const revealed = selectedQuizOption !== null
              const correct = interactionCard.answerIndex === index
              return (
                <Pressable
                  key={option}
                  style={({ pressed }) => [
                    styles.quizOption,
                    chosen && styles.quizOptionChosen,
                    revealed && correct && styles.quizOptionCorrect,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setSelectedQuizOption(index)}
                >
                  <Text style={styles.quizOptionText} numberOfLines={1}>{option}</Text>
                </Pressable>
              )
            })}
          </View>
          {selectedQuizOption !== null ? <Text style={styles.revealText}>{interactionCard.reveal}</Text> : null}
        </View>

        <View style={styles.modeBadge}>
          <Text style={styles.modeBadgeText}>{modeLabel}</Text>
        </View>

        <View style={styles.bottomActions}>
          <Pressable style={({ pressed }) => [styles.leaveButton, pressed && styles.pressed]} onPress={() => navigation.navigate('MainTabs')}>
            <Text style={styles.leaveButtonText}>先离开，稍后查看</Text>
          </Pressable>
          {!isExerciseAnalysis ? (
            <Pressable style={({ pressed }) => [styles.historyButton, pressed && styles.pressed]} onPress={() => navigation.navigate('AnalyzeHistory')}>
              <Text style={styles.historyButtonText}>识别记录</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.brandFooter}>食探 · 智能饮食记录</Text>
      </ScrollView>
    </View>
  )
}

function OutcomeScreen({
  failure,
  isExercise,
  onPrimary,
  onSecondary,
}: {
  failure: FailureState
  isExercise: boolean
  onPrimary: () => void
  onSecondary: () => void
}) {
  return (
    <View style={styles.outcomeRoot}>
      <StatusBar style="dark" />
      <View style={[styles.outcomeIcon, failure.tone === 'violated' && styles.outcomeIconDanger]}>
        <Text style={[styles.outcomeIconText, failure.tone === 'violated' && styles.outcomeIconTextDanger]}>!</Text>
      </View>
      <Text style={styles.outcomeTitle}>{failure.title}</Text>
      <Text style={styles.outcomeMessage}>{failure.message}</Text>
      {failure.traceId ? <Text selectable style={styles.traceText}>traceId: {failure.traceId}</Text> : null}
      <Pressable style={({ pressed }) => [styles.outcomePrimary, pressed && styles.pressed]} onPress={onPrimary}>
        <Text style={styles.outcomePrimaryText}>{isExercise ? '返回运动记录' : '去识别记录'}</Text>
      </Pressable>
      <Pressable style={({ pressed }) => [styles.outcomeSecondary, pressed && styles.pressed]} onPress={onSecondary}>
        <Text style={styles.outcomeSecondaryText}>回到首页</Text>
      </Pressable>
      <Text style={styles.outcomeFooter}>食探 · 智能健康管理助手</Text>
    </View>
  )
}

function resolveTaskKind(task?: AnalysisTask, routeTaskType?: string): AnalyzeTaskKind {
  if (routeTaskType === 'food_text' || routeTaskType === 'exercise') return routeTaskType
  if (task?.task_type === 'food_text') return 'food_text'
  if (task?.task_type === 'exercise') return 'exercise'
  if (task?.payload?.source_type === 'text') return 'food_text'
  return 'food'
}

function isTextFoodTask(task: { task_type?: string; payload?: Record<string, unknown> }, routeTaskType?: string): boolean {
  if (routeTaskType === 'food_text') return true
  if (task.task_type === 'food_text') return true
  return task.payload?.source_type === 'text'
}

function resolveExecutionMode(routeMode?: ExecutionMode, task?: AnalysisTask): ExecutionMode {
  if (routeMode) return routeMode
  const fromPayload = task?.payload?.execution_mode || task?.payload?.executionMode
  if (isExecutionMode(fromPayload)) return fromPayload
  return 'standard'
}

function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === 'string' && [
    'lite',
    'standard',
    'standard_web_search',
    'fast',
    'fast_web_search',
    'standard_packaged_experiment',
    'strict',
    'strict_separate',
    'strict_web_search',
    'experimental',
    'gemini35_flash',
    'gemini35_flash_grouped',
  ].includes(value)
}

function resolveTextPreview(task?: AnalysisTask): string {
  const raw = String(task?.text_input || task?.payload?.text_input || task?.payload?.text || '').trim()
  return raw || '文字记录，未提供实物照片'
}

function resolveStageLabels(kind: AnalyzeTaskKind, mode: ExecutionMode): string[] {
  if (kind === 'exercise') return EXERCISE_STAGE_LABELS
  if (kind === 'food_text') return FOOD_TEXT_STAGE_LABELS
  if (mode.includes('strict') || mode.includes('gemini35')) return FOOD_STRICT_STAGE_LABELS
  return FOOD_STANDARD_STAGE_LABELS
}

function resolveStageIndex(statusText: string, elapsedSeconds: number, stageCount: number): number {
  if (stageCount <= 1) return 0
  if (statusText.includes('排队') || statusText.includes('已提交')) return 0
  if (statusText.includes('网络')) return Math.min(1, stageCount - 1)
  return Math.min(Math.max(1, Math.floor(elapsedSeconds / 9)), stageCount - 1)
}

function resolveModeLabel(kind: AnalyzeTaskKind, mode: ExecutionMode): string {
  if (kind === 'exercise') return '运动识别'
  if (kind === 'food_text') return '文字分析'
  if (mode === 'fast') return '快速模式'
  if (mode === 'fast_web_search') return '快速联网'
  if (mode === 'standard_web_search') return '联网校准'
  if (mode === 'strict') return '精准模式'
  if (mode === 'strict_separate') return '精准分项'
  if (mode === 'strict_web_search') return '精准联网'
  return '普通模式'
}

function statusLabel(status: AnalysisTask['status']): string {
  if (status === 'pending') return '排队'
  if (status === 'processing') return '处理'
  if (status === 'done') return '完成'
  if (status === 'timed_out') return '超时'
  if (status === 'cancelled') return '已取消'
  if (status === 'violated') return '审核拦截'
  return '失败'
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#101827',
  },
  backgroundLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  fullscreenImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  fallbackBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#1f2937',
  },
  textBackground: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e7faef',
  },
  textBgHalo: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(92, 184, 150, 0.22)',
  },
  textBgCard: {
    width: '78%',
    minHeight: 220,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },
  textBgIcon: {
    width: 74,
    height: 74,
    borderRadius: 22,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 74,
    color: colors.brandDark,
    fontSize: 34,
    fontWeight: '900',
    backgroundColor: '#f0fdf4',
  },
  textBgLabel: {
    marginTop: 12,
    color: '#64748b',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  screenWash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(145, 151, 155, 0.34)',
  },
  bottomReadability: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '68%',
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
  },
  scroll: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  heroSubtitle: {
    marginTop: 4,
    color: 'rgba(255, 255, 255, 0.76)',
    fontSize: 12,
    lineHeight: 18,
  },
  scannerFrameContainer: {
    marginTop: 18,
    marginBottom: 24,
  },
  scannerFrame: {
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#e7f8f0',
  },
  frameImage: {
    width: '100%',
    height: '100%',
  },
  framePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#ecfdf5',
  },
  frameIcon: {
    width: 70,
    height: 70,
    borderRadius: 22,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 70,
    color: colors.brandDark,
    fontSize: 30,
    fontWeight: '900',
    backgroundColor: '#ffffff',
  },
  frameLabel: {
    marginTop: 12,
    color: '#64748b',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'center',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 2,
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  corner: {
    position: 'absolute',
    width: 74,
    height: 74,
    borderColor: '#fcfffe',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: 38,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 38,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 38,
  },
  cornerBottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 5,
    borderBottomWidth: 5,
    borderBottomRightRadius: 38,
  },
  tipBox: {
    width: '100%',
    maxWidth: 315,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 18,
  },
  tipLabel: {
    color: 'rgba(255, 255, 255, 0.95)',
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '700',
  },
  tipText: {
    flex: 1,
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 12,
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  stepsPanel: {
    width: '100%',
    maxWidth: 315,
    marginBottom: 14,
  },
  stageSummary: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.24)',
    gap: 10,
  },
  stageSummaryTitle: {
    flex: 1,
    color: 'rgba(255, 255, 255, 0.96)',
    fontSize: 13,
    fontWeight: '800',
  },
  stageSummaryTime: {
    color: 'rgba(209, 250, 229, 0.92)',
    fontSize: 12,
    fontWeight: '700',
  },
  stageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingTop: 9,
  },
  stageStatus: {
    color: 'rgba(167, 243, 208, 0.94)',
    fontSize: 12,
    fontWeight: '800',
  },
  stageFlow: {
    flex: 1,
    color: 'rgba(255, 255, 255, 0.68)',
    fontSize: 11,
    textAlign: 'right',
  },
  precisionNotice: {
    marginTop: 9,
    color: 'rgba(254, 240, 138, 0.94)',
    fontSize: 11,
    lineHeight: 17,
  },
  waitingCard: {
    width: '100%',
    maxWidth: 315,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.24)',
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginTop: 2,
    marginBottom: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  waitingHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  waitingEyebrow: {
    color: 'rgba(167, 243, 208, 0.96)',
    fontSize: 11,
    fontWeight: '800',
  },
  waitingSkip: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 11,
    fontWeight: '700',
  },
  waitingTitle: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  quizOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  quizOption: {
    flex: 1,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  quizOptionChosen: {
    borderColor: 'rgba(251, 191, 36, 0.92)',
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
  },
  quizOptionCorrect: {
    borderColor: 'rgba(110, 231, 183, 0.95)',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  quizOptionText: {
    color: 'rgba(255, 255, 255, 0.94)',
    fontSize: 12,
    fontWeight: '800',
  },
  revealText: {
    marginTop: 9,
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: 12,
    lineHeight: 18,
  },
  modeBadge: {
    marginBottom: 12,
  },
  modeBadgeText: {
    color: 'rgba(186, 230, 253, 0.95)',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  bottomActions: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
  },
  leaveButton: {
    minHeight: 44,
    minWidth: 190,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  leaveButtonText: {
    color: 'rgba(255, 255, 255, 0.95)',
    fontSize: 14,
    fontWeight: '700',
  },
  historyButton: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  historyButtonText: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 12,
    fontWeight: '700',
  },
  brandFooter: {
    marginTop: 10,
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    textAlign: 'center',
  },
  outcomeRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: '#f8fafc',
  },
  outcomeIcon: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    backgroundColor: '#fff7ed',
  },
  outcomeIconDanger: {
    backgroundColor: '#fef2f2',
  },
  outcomeIconText: {
    color: '#c2410c',
    fontSize: 34,
    fontWeight: '900',
  },
  outcomeIconTextDanger: {
    color: '#c53030',
  },
  outcomeTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '900',
    textAlign: 'center',
  },
  outcomeMessage: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  traceText: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  outcomePrimary: {
    minHeight: 44,
    minWidth: 170,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 26,
    paddingHorizontal: 24,
    backgroundColor: colors.brand,
  },
  outcomePrimaryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  outcomeSecondary: {
    minHeight: 38,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 18,
  },
  outcomeSecondaryText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  outcomeFooter: {
    marginTop: 32,
    color: colors.textMuted,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.72,
  },
})
