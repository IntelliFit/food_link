import { Image, Text, Textarea, View } from '@tarojs/components'
import Taro, { useLoad } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import {
  AnalyzeResponse,
  AnalysisTask,
  PrecisionCaptureReferenceInput,
  PrecisionOptionsInput,
  PrecisionQuestion,
  PrecisionRetakeRequirement,
  continuePrecisionSession,
  getAnalyzeTask,
  showUnifiedApiError,
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import './index.scss'

type AnswerState = Record<string, string>

const positiveNumber = (value: string): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const normalizeQuestions = (result?: AnalyzeResponse): PrecisionQuestion[] => (
  Array.isArray(result?.questions) ? result.questions.slice(0, 3) : []
)

const normalizeRetakeRequirements = (result?: AnalyzeResponse): PrecisionRetakeRequirement[] => (
  Array.isArray(result?.retakeRequirements) ? result.retakeRequirements : []
)

function PrecisionConfirmPage() {
  const [task, setTask] = useState<AnalysisTask | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [answers, setAnswers] = useState<AnswerState>({})
  const [freeTextAnswers, setFreeTextAnswers] = useState<AnswerState>({})
  const [additionalContext, setAdditionalContext] = useState('')
  const [referencePresence, setReferencePresence] = useState<'present' | 'absent'>('present')
  const [referenceShape, setReferenceShape] = useState<'rectangle' | 'circle' | 'custom'>('rectangle')
  const [referenceKind, setReferenceKind] = useState('标准卡片')
  const [referenceLength, setReferenceLength] = useState('85.6')
  const [referenceWidth, setReferenceWidth] = useState('53.98')
  const [referenceDiameter, setReferenceDiameter] = useState('')
  const [referencePlacement, setReferencePlacement] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const loadTask = async (taskId: string) => {
    setIsLoading(true)
    setLoadError('')
    try {
      const nextTask = await getAnalyzeTask(taskId)
      setTask(nextTask)
      const reference = (nextTask.payload?.reference_object || {}) as Record<string, any>
      const presence = reference.presence === 'absent' ? 'absent' : 'present'
      setReferencePresence(presence)
      if (presence === 'present') {
        const dimensions = (reference.dimensions_mm || {}) as Record<string, number>
        const shape = reference.shape === 'circle' ? 'circle' : reference.shape === 'custom' ? 'custom' : 'rectangle'
        setReferenceShape(shape)
        setReferenceKind(String(reference.kind || '标准卡片'))
        setReferenceLength(String(dimensions.length || 85.6))
        setReferenceWidth(String(dimensions.width || 53.98))
        setReferenceDiameter(String(dimensions.diameter || ''))
        setReferencePlacement(String(reference.placement_note || ''))
      }
    } catch (error) {
      setLoadError((error as Error)?.message || '精准确认信息获取失败')
    } finally {
      setIsLoading(false)
    }
  }

  useLoad((params) => {
    const taskId = String(params?.task_id || '').trim()
    if (!taskId) {
      setLoadError('缺少精准任务编号')
      setIsLoading(false)
      return
    }
    void loadTask(taskId)
  })

  const result = (task?.result || {}) as AnalyzeResponse
  const questions = useMemo(() => normalizeQuestions(result), [result])
  const retakeRequirements = useMemo(() => normalizeRetakeRequirements(result), [result])
  const sessionId = String(result.precisionSessionId || task?.payload?.precision_session_id || '').trim()
  const captureProtocol = String(task?.payload?.capture_protocol || '')
  const isVideoCapture = captureProtocol === 'video_keyframes_v1'
  const imagePaths = useMemo(() => {
    const paths = Array.isArray(task?.image_paths) ? task?.image_paths.filter(Boolean) : []
    if (paths.length > 0) return paths.slice(0, isVideoCapture ? 5 : 2)
    return task?.image_url ? [task.image_url] : []
  }, [isVideoCapture, task])
  const needsRetake = result.precisionStatus === 'needs_retake'

  const buildReferenceObject = (): PrecisionCaptureReferenceInput => {
    if (referencePresence === 'absent') return { presence: 'absent' }
    const dimensions: Record<string, number> = {}
    const length = positiveNumber(referenceLength)
    const width = positiveNumber(referenceWidth)
    const diameter = positiveNumber(referenceDiameter)
    if (referenceShape === 'circle') {
      if (diameter != null) dimensions.diameter = diameter
    } else {
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
    if (!task || !sessionId || isSubmitting) return
    if (!continueWithUncertainty) {
      const unanswered = questions.find((question) => {
        const selected = String(answers[question.id] || '').trim()
        const freeText = String(freeTextAnswers[question.id] || '').trim()
        return !selected && !freeText
      })
      if (unanswered) {
        Taro.showToast({ title: '请先回答本轮问题，或按当前信息继续', icon: 'none' })
        return
      }
    }
    const precisionOptions = task.payload?.precision_options as PrecisionOptionsInput | undefined
    setIsSubmitting(true)
    try {
      const response = await continuePrecisionSession(sessionId, {
        source_type: 'image',
        additionalContext: additionalContext.trim() || undefined,
        precision_options: precisionOptions,
        reference_object: buildReferenceObject(),
        answers: questions.flatMap((question) => {
          const value = String(freeTextAnswers[question.id] || answers[question.id] || '').trim()
          return value ? [{ question_id: question.id, value }] : []
        }),
        continue_with_uncertainty: continueWithUncertainty,
      })
      Taro.redirectTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${encodeURIComponent(response.task_id)}&task_type=food&execution_mode=strict`,
      })
    } catch (error) {
      await showUnifiedApiError(error, '提交精准确认失败，请重试')
      setIsSubmitting(false)
    }
  }

  const handleRetake = () => {
    if (!sessionId) return
    if (isVideoCapture || retakeRequirements.some((item) => item.role === 'video')) {
      Taro.removeStorageSync('analyzePrecisionRetakeImagePaths')
      Taro.redirectTo({
        url: `${extraPkgUrl('/pages/analyze/index')}?precision_session_id=${encodeURIComponent(sessionId)}&capture_mode=video`,
      })
      return
    }
    const nextPaths = [imagePaths[0] || '', imagePaths[1] || '']
    const roles = retakeRequirements.map((item) => item.role)
    if (roles.length === 0 || roles.includes('both')) {
      nextPaths[0] = ''
      nextPaths[1] = ''
    } else {
      if (roles.includes('top_down')) nextPaths[0] = ''
      if (roles.includes('oblique_45')) nextPaths[1] = ''
    }
    Taro.setStorageSync('analyzePrecisionRetakeImagePaths', nextPaths)
    Taro.redirectTo({
      url: `${extraPkgUrl('/pages/analyze/index')}?precision_session_id=${encodeURIComponent(sessionId)}`,
    })
  }

  if (isLoading) {
    return <View className='precision-confirm-page precision-confirm-page--center'><View className='precision-confirm-spinner' /></View>
  }

  if (loadError || !task) {
    return (
      <View className='precision-confirm-page precision-confirm-page--center'>
        <Text className='precision-confirm-error'>{loadError || '精准确认信息不存在'}</Text>
        <View className='precision-confirm-secondary-btn' onClick={() => Taro.navigateBack()}>返回</View>
      </View>
    )
  }

  return (
    <View className='precision-confirm-page'>
      <View className='precision-confirm-hero'>
        <Text className='precision-confirm-eyebrow'>精准模式 · 第 {result.precisionRoundIndex || 1} 轮</Text>
        <Text className='precision-confirm-title'>{needsRetake ? (isVideoCapture ? '这段视频需要重录' : '这组照片需要重拍') : '确认几个关键信息'}</Text>
        <Text className='precision-confirm-subtitle'>
          {needsRetake ? '画面质量是估重门槛，重拍不会重复扣积分。' : '只确认会明显影响食物身份或重量的内容，本轮最多 3 题。'}
        </Text>
      </View>

      {imagePaths.length > 0 && (
        <View className={`precision-confirm-images ${isVideoCapture ? 'precision-confirm-images--video' : ''}`}>
          {imagePaths.map((path, index) => (
            <View key={`${path}-${index}`} className='precision-confirm-image-card'>
              <Image className='precision-confirm-image' src={path} mode='aspectFill' />
              <Text className='precision-confirm-image-label'>
                {isVideoCapture ? `关键帧 ${index + 1}` : index === 0 ? '俯拍' : '45° 斜拍'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {needsRetake ? (
        <View className='precision-confirm-card'>
          <Text className='precision-confirm-card-title'>重拍要求</Text>
          {(retakeRequirements.length > 0 ? retakeRequirements : [{
            role: isVideoCapture ? 'video' as const : 'both' as const,
            reason: '画面信息不足',
            guidance: isVideoCapture
              ? '请保持同一餐完整入镜，并从正上方缓慢移动到约 45°。'
              : '请保持主体完整、清晰，并让两个角度有明显差异。',
          }]).map((item, index) => (
            <View key={`${item.role}-${index}`} className='precision-retake-item'>
              <Text className='precision-retake-role'>
                {item.role === 'video' ? '环绕视频' : item.role === 'top_down' ? '俯拍' : item.role === 'oblique_45' ? '45° 斜拍' : '两个角度'}
              </Text>
              <Text className='precision-retake-reason'>{item.reason}</Text>
              <Text className='precision-retake-guidance'>{item.guidance}</Text>
            </View>
          ))}
        </View>
      ) : (
        <>
          {questions.map((question, index) => (
            <View key={question.id} className='precision-confirm-card'>
              <Text className='precision-confirm-question-index'>问题 {index + 1}</Text>
              <Text className='precision-confirm-question'>{question.prompt}</Text>
              {!!question.options?.length && (
                <View className='precision-answer-options'>
                  {question.options.map((option) => (
                    <View
                      key={option.value}
                      className={`precision-answer-option ${answers[question.id] === option.value ? 'active' : ''}`}
                      onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.value }))}
                    >
                      {option.label}
                    </View>
                  ))}
                </View>
              )}
              {question.allowFreeText !== false && (
                <Textarea
                  className='precision-confirm-input'
                  value={freeTextAnswers[question.id] || ''}
                  placeholder='也可以直接输入更准确的信息'
                  placeholderClass='precision-confirm-placeholder'
                  maxlength={120}
                  autoHeight
                  showConfirmBar={false}
                  onInput={(event) => setFreeTextAnswers((current) => ({ ...current, [question.id]: event.detail.value }))}
                />
              )}
            </View>
          ))}

          <View className='precision-confirm-card'>
            <Text className='precision-confirm-card-title'>参考物与补充说明</Text>
            <View className='precision-presence-row'>
              <View className={`precision-presence-option ${referencePresence === 'present' ? 'active' : ''}`} onClick={() => setReferencePresence('present')}>已放参考物</View>
              <View className={`precision-presence-option ${referencePresence === 'absent' ? 'active' : ''}`} onClick={() => setReferencePresence('absent')}>没有参考物</View>
            </View>
            {referencePresence === 'present' ? (
              <>
                <View className='precision-presence-row'>
                  <View
                    className={`precision-presence-option ${referenceShape === 'rectangle' ? 'active' : ''}`}
                    onClick={() => {
                      setReferenceShape('rectangle')
                      setReferenceKind('标准卡片')
                      setReferenceLength('85.6')
                      setReferenceWidth('53.98')
                    }}
                  >标准卡片</View>
                  <View
                    className={`precision-presence-option ${referenceShape === 'circle' ? 'active' : ''}`}
                    onClick={() => {
                      setReferenceShape('circle')
                      setReferenceKind('圆形餐盘')
                      if (!referenceDiameter) setReferenceDiameter('240')
                    }}
                  >圆形餐盘</View>
                  <View className={`precision-presence-option ${referenceShape === 'custom' ? 'active' : ''}`} onClick={() => setReferenceShape('custom')}>自定义</View>
                </View>
                <Textarea className='precision-confirm-input' value={referenceKind} maxlength={30} autoHeight showConfirmBar={false} onInput={(event) => setReferenceKind(event.detail.value)} />
                {referenceShape === 'circle' ? (
                  <Textarea className='precision-confirm-input' value={referenceDiameter} placeholder='直径(mm)' maxlength={8} autoHeight showConfirmBar={false} onInput={(event) => setReferenceDiameter(event.detail.value)} />
                ) : <View className='precision-dimension-row'>
                  <Textarea className='precision-confirm-input precision-dimension-input' value={referenceLength} placeholder='长(mm)' maxlength={8} autoHeight showConfirmBar={false} onInput={(event) => setReferenceLength(event.detail.value)} />
                  <Textarea className='precision-confirm-input precision-dimension-input' value={referenceWidth} placeholder='宽(mm)' maxlength={8} autoHeight showConfirmBar={false} onInput={(event) => setReferenceWidth(event.detail.value)} />
                </View>}
                <Textarea className='precision-confirm-input' value={referencePlacement} placeholder='参考物摆放位置（可选）' maxlength={80} autoHeight showConfirmBar={false} onInput={(event) => setReferencePlacement(event.detail.value)} />
              </>
            ) : <Text className='precision-reference-warning'>可继续分析，但结果会标记为尺度不足。</Text>}
            <Textarea
              className='precision-confirm-input'
              value={additionalContext}
              placeholder='其他补充，例如熟重、去骨、少油或隐藏配料'
              maxlength={160}
              autoHeight
              showConfirmBar={false}
              onInput={(event) => setAdditionalContext(event.detail.value)}
            />
          </View>
        </>
      )}

      <View className='precision-confirm-actions'>
        {needsRetake ? (
          <View className='precision-confirm-primary-btn' onClick={handleRetake}>按要求{isVideoCapture ? '重录' : '重拍'}</View>
        ) : (
          <>
            <View className={`precision-confirm-primary-btn ${isSubmitting ? 'disabled' : ''}`} onClick={() => void submitConfirmation(false)}>
              {isSubmitting ? <View className='precision-confirm-btn-spinner' /> : '提交确认并继续'}
            </View>
            <View className={`precision-confirm-secondary-btn ${isSubmitting ? 'disabled' : ''}`} onClick={() => void submitConfirmation(true)}>按当前信息继续估算</View>
          </>
        )}
      </View>
    </View>
  )
}

export default withAuth(PrecisionConfirmPage)
