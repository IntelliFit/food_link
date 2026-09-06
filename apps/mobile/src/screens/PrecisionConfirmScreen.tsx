import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type {
  AnalysisTask,
  PrecisionCaptureReferenceInput,
  PrecisionOptionsInput,
} from '@food-link/core'
import { AlertTriangle, Camera, Check, RefreshCcw } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'

type PrecisionConfirmRoute = RouteProp<RootStackParamList, 'PrecisionConfirm'>
type AnswerState = Record<string, string>
type ReferencePresence = 'present' | 'absent'
type ReferenceShape = 'rectangle' | 'circle' | 'custom'

type PrecisionQuestion = {
  id: string
  prompt: string
  options: Array<{ value: string; label: string }>
  allowFreeText: boolean
}

type RetakeRequirement = {
  role: 'top_down' | 'oblique_45' | 'both' | 'video'
  reason: string
  guidance: string
}

type PrecisionTheme = {
  page: string
  surface: string
  input: string
  text: string
  secondary: string
  muted: string
  border: string
  accent: string
  accentSoft: string
  warning: string
  warningText: string
  footer: string
}

const LIGHT_THEME: PrecisionTheme = {
  page: '#f4f8f6',
  surface: '#ffffff',
  input: '#f8fafc',
  text: '#0f172a',
  secondary: '#475569',
  muted: '#94a3b8',
  border: '#dbe4e0',
  accent: '#00bc7d',
  accentSoft: '#ecfdf5',
  warning: '#fff7ed',
  warningText: '#9a3412',
  footer: 'rgba(255,255,255,0.97)',
}

const DARK_THEME: PrecisionTheme = {
  page: '#0d1312',
  surface: '#181f1d',
  input: '#1e2624',
  text: '#f2f7f4',
  secondary: 'rgba(214,226,220,0.76)',
  muted: 'rgba(214,226,220,0.52)',
  border: 'rgba(255,255,255,0.10)',
  accent: '#6ee7b7',
  accentSoft: 'rgba(110,231,183,0.12)',
  warning: 'rgba(154,52,18,0.22)',
  warningText: '#fdba74',
  footer: 'rgba(24,31,29,0.97)',
}

export function PrecisionConfirmScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<PrecisionConfirmRoute>()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const theme = isDark ? DARK_THEME : LIGHT_THEME
  const [task, setTask] = useState<AnalysisTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [answers, setAnswers] = useState<AnswerState>({})
  const [freeTextAnswers, setFreeTextAnswers] = useState<AnswerState>({})
  const [additionalContext, setAdditionalContext] = useState('')
  const [referencePresence, setReferencePresence] = useState<ReferencePresence>('present')
  const [referenceShape, setReferenceShape] = useState<ReferenceShape>('rectangle')
  const [referenceKind, setReferenceKind] = useState('标准卡片')
  const [referenceLength, setReferenceLength] = useState('85.6')
  const [referenceWidth, setReferenceWidth] = useState('53.98')
  const [referenceDiameter, setReferenceDiameter] = useState('')
  const [referencePlacement, setReferencePlacement] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [answerErrorId, setAnswerErrorId] = useState('')

  const loadTask = useCallback(async () => {
    const taskId = String(route.params.taskId || '').trim()
    if (!taskId) {
      setLoadError('缺少精准任务编号')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const nextTask = await apiClient.getAnalyzeTask(taskId)
      setTask(nextTask)
      const reference = asRecord(nextTask.payload?.reference_object)
      const presence: ReferencePresence = reference.presence === 'absent' ? 'absent' : 'present'
      setReferencePresence(presence)
      if (presence === 'present') {
        const dimensions = asRecord(reference.dimensions_mm)
        const shape: ReferenceShape = reference.shape === 'circle' ? 'circle' : reference.shape === 'custom' ? 'custom' : 'rectangle'
        setReferenceShape(shape)
        setReferenceKind(asText(reference.kind) || '标准卡片')
        setReferenceLength(asText(dimensions.length) || '85.6')
        setReferenceWidth(asText(dimensions.width) || '53.98')
        setReferenceDiameter(asText(dimensions.diameter))
        setReferencePlacement(asText(reference.placement_note))
      }
    } catch (error) {
      setLoadError(userFacingErrorMessage(error, '精准确认信息获取失败'))
    } finally {
      setLoading(false)
    }
  }, [route.params.taskId])

  useEffect(() => {
    void loadTask()
  }, [loadTask])

  const result = useMemo(() => asRecord(task?.result), [task])
  const questions = useMemo(() => normalizeQuestions(result), [result])
  const retakeRequirements = useMemo(() => normalizeRetakeRequirements(result), [result])
  const sessionId = precisionSessionId(task, result)
  const status = asText(result.precisionStatus ?? result.precision_status)
  const needsRetake = status === 'needs_retake'
  const captureProtocol = asText(task?.payload?.capture_protocol)
  const isVideoCapture = captureProtocol === 'video_keyframes_v1'
  const imagePaths = useMemo(() => taskImagePaths(task, isVideoCapture), [isVideoCapture, task])
  const roundIndex = positiveInteger(result.precisionRoundIndex ?? result.precision_round_index) || 1

  const buildReferenceObject = (): PrecisionCaptureReferenceInput => {
    if (referencePresence === 'absent') return { presence: 'absent' }
    const dimensions: Record<string, number> = {}
    if (referenceShape === 'circle') {
      const diameter = positiveNumber(referenceDiameter)
      if (diameter != null) dimensions.diameter = diameter
    } else {
      const length = positiveNumber(referenceLength)
      const width = positiveNumber(referenceWidth)
      if (length != null) dimensions.length = length
      if (width != null) dimensions.width = width
    }
    return {
      presence: 'present',
      kind: referenceKind.trim() || '标准卡片',
      shape: referenceShape,
      dimensions_mm: dimensions,
      placement_note: referencePlacement.trim() || undefined,
    }
  }

  const submitConfirmation = async (continueWithUncertainty: boolean) => {
    const currentTask = task
    if (!currentTask || !sessionId || submitting) return
    if (!continueWithUncertainty) {
      const unanswered = questions.find((question) => (
        !String(answers[question.id] || '').trim()
        && !String(freeTextAnswers[question.id] || '').trim()
      ))
      if (unanswered) {
        setAnswerErrorId(unanswered.id)
        return
      }
    }
    setAnswerErrorId('')
    setSubmitting(true)
    try {
      const precisionOptions = asRecord(currentTask.payload?.precision_options) as unknown as PrecisionOptionsInput
      const response = await apiClient.continuePrecisionSession(sessionId, {
        source_type: 'image',
        additionalContext: additionalContext.trim() || undefined,
        precision_options: Object.keys(precisionOptions).length > 0 ? precisionOptions : undefined,
        reference_object: buildReferenceObject(),
        answers: questions.flatMap((question) => {
          const value = String(freeTextAnswers[question.id] || answers[question.id] || '').trim()
          return value ? [{ question_id: question.id, value }] : []
        }),
        continue_with_uncertainty: continueWithUncertainty,
      })
      navigation.replace('AnalyzeLoading', {
        taskId: response.task_id,
        mealType: route.params.mealType,
        date: route.params.date,
        taskType: 'food',
        executionMode: 'strict',
      })
    } catch (error) {
      await dialog.alert('提交精准确认失败', userFacingErrorMessage(error, '请检查网络后重试。'), 'danger')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRetake = async () => {
    const currentTask = task
    if (!sessionId || !currentTask) return
    const roles = retakeRequirements.map((item) => item.role)
    const useVideoCapture = isVideoCapture || roles.includes('video')
    const nextPaths: string[] = [imagePaths[0] || '', imagePaths[1] || '']
    if (useVideoCapture || roles.length === 0 || roles.includes('both')) {
      nextPaths[0] = ''
      nextPaths[1] = ''
    } else {
      if (roles.includes('top_down')) nextPaths[0] = ''
      if (roles.includes('oblique_45')) nextPaths[1] = ''
    }
    const existingOptions = asRecord(currentTask.payload?.precision_options) as unknown as PrecisionOptionsInput
    navigation.replace('Analyze', {
      mealType: route.params.mealType,
      date: route.params.date,
      precisionSessionId: sessionId,
      precisionImageUris: useVideoCapture ? undefined : nextPaths,
      precisionCaptureMode: useVideoCapture ? 'video' : 'photos',
      precisionOptions: Object.keys(existingOptions).length > 0 ? existingOptions : undefined,
      precisionRetakeRoles: roles,
    })
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.page }]}>
        <ActivityIndicator color={theme.accent} accessibilityLabel="正在获取精准确认信息" />
      </View>
    )
  }

  if (loadError || !task || !sessionId) {
    return (
      <View style={[styles.center, { backgroundColor: theme.page }]}>
        <AlertTriangle size={32} color="#dc2626" />
        <Text style={[styles.errorText, { color: theme.text }]}>{loadError || '精准确认信息不存在'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新获取精准确认信息"
          style={({ pressed }) => [styles.retryButton, { borderColor: theme.border, backgroundColor: theme.surface }, pressed && styles.pressed]}
          onPress={() => void loadTask()}
        >
          <RefreshCcw size={18} color={theme.accent} />
          <Text style={[styles.retryText, { color: theme.accent }]}>重试</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.page }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: 142 + Math.max(insets.bottom, 10) }]}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>精准模式 · 第 {roundIndex} 轮</Text>
          <Text style={styles.heroTitle}>{needsRetake ? (isVideoCapture ? '这段视频需要重录' : '这组照片需要重拍') : '确认几个关键信息'}</Text>
          <Text style={styles.heroSubtitle}>
            {needsRetake ? '画面质量是估重门槛，重拍不会重复扣积分。' : '只确认会明显影响食物身份或重量的内容，本轮最多 3 题。'}
          </Text>
        </View>

        {imagePaths.length > 0 ? (
          <View style={styles.imageGrid}>
            {imagePaths.map((path, index) => (
              <View key={`${path}-${index}`} style={[styles.imageCard, isVideoCapture && styles.videoImageCard]}>
                <Image source={{ uri: path }} style={styles.image} resizeMode="cover" accessibilityLabel={isVideoCapture ? `关键帧 ${index + 1}` : index === 0 ? '俯拍照片' : '45度斜拍照片'} />
                <Text style={styles.imageLabel}>{isVideoCapture ? `关键帧 ${index + 1}` : index === 0 ? '俯拍' : '45° 斜拍'}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {needsRetake ? (
          <Surface theme={theme}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>重拍要求</Text>
            {(retakeRequirements.length > 0 ? retakeRequirements : [fallbackRetakeRequirement(isVideoCapture)]).map((item, index) => (
              <View key={`${item.role}-${index}`} style={[styles.retakeItem, { backgroundColor: theme.warning }]}>
                <Text style={[styles.retakeRole, { color: theme.warningText }]}>{retakeRoleLabel(item.role)}</Text>
                <Text style={[styles.retakeReason, { color: theme.text }]}>{item.reason}</Text>
                <Text style={[styles.retakeGuidance, { color: theme.warningText }]}>{item.guidance}</Text>
              </View>
            ))}
          </Surface>
        ) : (
          <>
            {questions.map((question, index) => {
              const hasError = answerErrorId === question.id
              return (
                <Surface key={question.id} theme={theme}>
                  <Text style={[styles.questionIndex, { color: theme.accent }]}>问题 {index + 1}</Text>
                  <Text style={[styles.question, { color: theme.text }]}>{question.prompt}</Text>
                  {question.options.length > 0 ? (
                    <View accessibilityRole="radiogroup" style={styles.optionWrap}>
                      {question.options.map((option) => {
                        const selected = answers[question.id] === option.value
                        return (
                          <Pressable
                            key={option.value}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected }}
                            accessibilityLabel={option.label}
                            style={({ pressed }) => [
                              styles.pill,
                              { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accentSoft : theme.input },
                              pressed && styles.pressed,
                            ]}
                            onPress={() => {
                              setAnswers((current) => ({ ...current, [question.id]: option.value }))
                              if (hasError) setAnswerErrorId('')
                            }}
                          >
                            {selected ? <Check size={16} color={theme.accent} strokeWidth={3} /> : null}
                            <Text style={[styles.pillText, { color: selected ? theme.accent : theme.secondary }]}>{option.label}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : null}
                  {question.allowFreeText ? (
                    <LabeledInput
                      label="补充答案（可选）"
                      value={freeTextAnswers[question.id] || ''}
                      placeholder="也可以直接输入更准确的信息"
                      maxLength={120}
                      theme={theme}
                      onChangeText={(value) => {
                        setFreeTextAnswers((current) => ({ ...current, [question.id]: value }))
                        if (hasError && value.trim()) setAnswerErrorId('')
                      }}
                    />
                  ) : null}
                  {hasError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.inlineError}>请回答这个问题，或选择按当前信息继续估算。</Text> : null}
                </Surface>
              )
            })}

            <Surface theme={theme}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>参考物与补充说明</Text>
              <View style={styles.optionWrap}>
                <ChoicePill label="已放参考物" selected={referencePresence === 'present'} theme={theme} onPress={() => setReferencePresence('present')} />
                <ChoicePill label="没有参考物" selected={referencePresence === 'absent'} theme={theme} onPress={() => setReferencePresence('absent')} />
              </View>
              {referencePresence === 'present' ? (
                <>
                  <View style={styles.optionWrap}>
                    <ChoicePill label="标准卡片" selected={referenceShape === 'rectangle'} theme={theme} onPress={() => {
                      setReferenceShape('rectangle')
                      setReferenceKind('标准卡片')
                      setReferenceLength('85.6')
                      setReferenceWidth('53.98')
                    }} />
                    <ChoicePill label="圆形餐盘" selected={referenceShape === 'circle'} theme={theme} onPress={() => {
                      setReferenceShape('circle')
                      setReferenceKind('圆形餐盘')
                      if (!referenceDiameter) setReferenceDiameter('240')
                    }} />
                    <ChoicePill label="自定义" selected={referenceShape === 'custom'} theme={theme} onPress={() => setReferenceShape('custom')} />
                  </View>
                  <LabeledInput label="参考物名称" value={referenceKind} maxLength={30} theme={theme} onChangeText={setReferenceKind} />
                  {referenceShape === 'circle' ? (
                    <LabeledInput label="直径（mm）" value={referenceDiameter} placeholder="例如 240" keyboardType="decimal-pad" maxLength={8} theme={theme} onChangeText={setReferenceDiameter} />
                  ) : (
                    <View style={styles.dimensionRow}>
                      <View style={styles.dimensionCell}><LabeledInput label="长度（mm）" value={referenceLength} keyboardType="decimal-pad" maxLength={8} theme={theme} onChangeText={setReferenceLength} /></View>
                      <View style={styles.dimensionCell}><LabeledInput label="宽度（mm）" value={referenceWidth} keyboardType="decimal-pad" maxLength={8} theme={theme} onChangeText={setReferenceWidth} /></View>
                    </View>
                  )}
                  <LabeledInput label="摆放位置（可选）" value={referencePlacement} placeholder="例如：在盘子右下角，与食物同一平面" maxLength={80} theme={theme} onChangeText={setReferencePlacement} />
                </>
              ) : <Text style={[styles.warning, { color: theme.warningText, backgroundColor: theme.warning }]}>可继续分析，但结果会标记为尺度不足。</Text>}
              <LabeledInput label="其他补充（可选）" value={additionalContext} placeholder="例如：熟重、去骨、少油或隐藏配料" maxLength={160} theme={theme} onChangeText={setAdditionalContext} />
            </Surface>
          </>
        )}
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: theme.footer, borderTopColor: theme.border }]}>
        {needsRetake ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isVideoCapture ? '按要求重新采集' : '按要求重拍'}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={() => void handleRetake()}
          >
            <Camera size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>{isVideoCapture ? '改用双角度重拍' : '按要求重拍'}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting, busy: submitting }}
              disabled={submitting}
              style={({ pressed }) => [styles.primaryButton, submitting && styles.disabled, pressed && !submitting && styles.pressed]}
              onPress={() => void submitConfirmation(false)}
            >
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryButtonText}>提交确认并继续</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting }}
              disabled={submitting}
              style={({ pressed }) => [styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }, submitting && styles.disabled, pressed && !submitting && styles.pressed]}
              onPress={() => void submitConfirmation(true)}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.secondary }]}>按当前信息继续估算</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  )
}

function Surface({ theme, children }: { theme: PrecisionTheme; children: React.ReactNode }) {
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>
}

function ChoicePill({ label, selected, theme, onPress }: { label: string; selected: boolean; theme: PrecisionTheme; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [styles.pill, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accentSoft : theme.input }, pressed && styles.pressed]}
      onPress={onPress}
    >
      {selected ? <Check size={16} color={theme.accent} strokeWidth={3} /> : null}
      <Text style={[styles.pillText, { color: selected ? theme.accent : theme.secondary }]}>{label}</Text>
    </Pressable>
  )
}

function LabeledInput({ label, value, placeholder, maxLength, keyboardType, theme, onChangeText }: {
  label: string
  value: string
  placeholder?: string
  maxLength: number
  keyboardType?: 'default' | 'decimal-pad'
  theme: PrecisionTheme
  onChangeText: (value: string) => void
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.secondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        maxLength={maxLength}
        keyboardType={keyboardType || 'default'}
        multiline={keyboardType !== 'decimal-pad'}
        style={[styles.input, keyboardType !== 'decimal-pad' && styles.multilineInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.border }]}
        onChangeText={onChangeText}
      />
    </View>
  )
}

function normalizeQuestions(result: Record<string, unknown>): PrecisionQuestion[] {
  const raw = result.questions
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 3).flatMap((item, index) => {
    const record = asRecord(item)
    const prompt = asText(record.prompt ?? record.question ?? record.text)
    if (!prompt) return []
    const options = Array.isArray(record.options) ? record.options.flatMap((option) => {
      if (typeof option === 'string') return [{ value: option, label: option }]
      const source = asRecord(option)
      const value = asText(source.value ?? source.label)
      const label = asText(source.label ?? source.value)
      return value && label ? [{ value, label }] : []
    }) : []
    return [{
      id: asText(record.id ?? record.question_id ?? record.questionId) || `question_${index + 1}`,
      prompt,
      options,
      allowFreeText: record.allowFreeText !== false && record.allow_free_text !== false,
    }]
  })
}

function normalizeRetakeRequirements(result: Record<string, unknown>): RetakeRequirement[] {
  const raw = result.retakeRequirements ?? result.retake_requirements
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const record = asRecord(item)
    const rawRole = asText(record.role)
    const role: RetakeRequirement['role'] = rawRole === 'top_down' || rawRole === 'oblique_45' || rawRole === 'video' ? rawRole : 'both'
    const reason = asText(record.reason) || '画面信息不足'
    const guidance = asText(record.guidance) || '请保持食物主体完整清晰，并补足所需角度。'
    return [{ role, reason, guidance }]
  })
}

function fallbackRetakeRequirement(isVideo: boolean): RetakeRequirement {
  return {
    role: isVideo ? 'video' : 'both',
    reason: '画面信息不足',
    guidance: isVideo ? '请保持同一餐完整入镜，并从正上方缓慢移动到约 45°。' : '请保持主体完整、清晰，并让两个角度有明显差异。',
  }
}

function taskImagePaths(task: AnalysisTask | null, isVideo: boolean): string[] {
  const paths = Array.isArray(task?.image_paths) ? task.image_paths.map((item) => String(item || '').trim()).filter(Boolean) : []
  if (paths.length > 0) return paths.slice(0, isVideo ? 5 : 2)
  const single = String(task?.image_url || '').trim()
  return single ? [single] : []
}

function precisionSessionId(task: AnalysisTask | null, result: Record<string, unknown>): string {
  return asText(result.precisionSessionId ?? result.precision_session_id ?? task?.payload?.precision_session_id)
}

function retakeRoleLabel(role: RetakeRequirement['role']): string {
  if (role === 'video') return '环绕视频'
  if (role === 'top_down') return '俯拍'
  if (role === 'oblique_45') return '45° 斜拍'
  return '两个角度'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asText(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  errorText: { maxWidth: 320, textAlign: 'center', fontSize: 15, lineHeight: 23, fontWeight: '600' },
  retryButton: { minHeight: 48, minWidth: 128, paddingHorizontal: 20, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryText: { fontSize: 14, fontWeight: '800' },
  hero: { padding: 18, borderRadius: 18, backgroundColor: '#047857', elevation: 3, shadowColor: '#047857', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } },
  eyebrow: { color: 'rgba(255,255,255,0.82)', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  heroTitle: { marginTop: 5, color: '#fff', fontSize: 22, lineHeight: 29, fontWeight: '900' },
  heroSubtitle: { marginTop: 6, color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 21 },
  imageGrid: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imageCard: { width: '48.8%', aspectRatio: 1.45, borderRadius: 12, overflow: 'hidden', backgroundColor: '#e2e8f0' },
  videoImageCard: { width: '31.6%', aspectRatio: 1.1 },
  image: { width: '100%', height: '100%' },
  imageLabel: { position: 'absolute', left: 7, bottom: 7, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(15,23,42,0.72)', color: '#fff', fontSize: 10, lineHeight: 14, fontWeight: '700' },
  card: { marginTop: 10, padding: 14, borderRadius: 16, borderWidth: 1 },
  cardTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800' },
  questionIndex: { marginBottom: 4, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  question: { fontSize: 16, lineHeight: 24, fontWeight: '800' },
  optionWrap: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 48, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pillText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  field: { marginTop: 12 },
  fieldLabel: { marginBottom: 6, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  input: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, fontSize: 14, lineHeight: 20 },
  multilineInput: { minHeight: 62, textAlignVertical: 'top' },
  inlineError: { marginTop: 8, color: '#dc2626', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  dimensionRow: { flexDirection: 'row', gap: 10 },
  dimensionCell: { flex: 1 },
  warning: { marginTop: 12, padding: 10, borderRadius: 9, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  retakeItem: { marginTop: 10, padding: 12, borderRadius: 11, gap: 4 },
  retakeRole: { fontSize: 12, lineHeight: 17, fontWeight: '900' },
  retakeReason: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  retakeGuidance: { fontSize: 12, lineHeight: 19 },
  actions: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 9, paddingHorizontal: 12, borderTopWidth: 1, flexDirection: 'row', gap: 8 },
  primaryButton: { flex: 1, minHeight: 50, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#00bc7d', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryButtonText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '900' },
  secondaryButton: { flex: 1, minHeight: 50, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { textAlign: 'center', fontSize: 12, lineHeight: 17, fontWeight: '800' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
})
