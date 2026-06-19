import { useCallback, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { ExecutionMode, HealthProfile, HealthReportExtract } from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'
import { readImageAsBase64DataUrl } from '../utils/image'

type EditField =
  | 'gender'
  | 'birthday'
  | 'height'
  | 'weight'
  | 'diet_goal'
  | 'daily_life_activity_level'
  | 'execution_mode'
  | 'medical_history'
  | 'diet_preference'
  | 'allergies'
  | 'routine_type'
  | 'health_notes'
  | 'report_extract'

type ChoiceOption = { value: string; label: string }

const fieldLabels: Record<EditField, string> = {
  gender: '性别',
  birthday: '出生日期',
  height: '身高',
  weight: '体重',
  diet_goal: '饮食目标',
  daily_life_activity_level: '日常活动',
  execution_mode: '执行模式',
  medical_history: '既往病史',
  diet_preference: '饮食偏好',
  allergies: '过敏源',
  routine_type: '作息习惯',
  health_notes: '特殊情况和补充',
  report_extract: '体检/病例识别结果',
}

const fieldChoiceOptions = {
  gender: [
    { value: '', label: '暂不填写' },
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
    { value: 'other', label: '其他' },
  ],
  diet_goal: [
    { value: '', label: '暂不填写' },
    { value: 'fat_loss', label: '减重' },
    { value: 'maintain', label: '保持' },
    { value: 'muscle_gain', label: '增重' },
  ],
  daily_life_activity_level: [
    { value: '', label: '暂不填写' },
    { value: 'sedentary', label: '久坐办公' },
    { value: 'light', label: '日常走动较多' },
    { value: 'moderate', label: '经常站立走动' },
    { value: 'active', label: '体力劳动' },
    { value: 'very_active', label: '高强度' },
  ],
  execution_mode: [
    { value: 'fast', label: '快速模式' },
    { value: 'standard', label: '普通模式' },
    { value: 'strict', label: '精准模式' },
  ],
} as const

const fieldMultiOptions = {
  medical_history: [
    { value: 'diabetes', label: '糖尿病' },
    { value: 'hypertension', label: '高血压' },
    { value: 'gout', label: '痛风' },
    { value: 'hyperlipidemia', label: '高血脂' },
    { value: 'thyroid', label: '甲状腺疾病' },
    { value: 'none', label: '无' },
  ],
  diet_preference: [
    { value: 'keto', label: '生酮' },
    { value: 'vegetarian', label: '素食' },
    { value: 'vegan', label: '纯素' },
    { value: 'low_salt', label: '低盐' },
    { value: 'gluten_free', label: '无麸质' },
    { value: 'none', label: '无' },
  ],
  allergies: [
    { value: 'seafood', label: '海鲜' },
    { value: 'peanut', label: '花生' },
    { value: 'milk', label: '牛奶' },
    { value: 'egg', label: '鸡蛋' },
    { value: 'mango', label: '芒果' },
    { value: 'alcohol', label: '酒精' },
    { value: 'spicy', label: '辣' },
    { value: 'none', label: '无' },
  ],
} as const

const REPORT_TASK_POLL_INTERVAL_MS = 4000
const REPORT_TASK_POLL_TIMEOUT_MS = 90000

export function HealthProfileViewScreen() {
  const dialog = useAppDialog()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'HealthProfileView'>>()
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingField, setEditingField] = useState<EditField | null>(null)
  const [editValue, setEditValue] = useState('')
  const [reportImageUrls, setReportImageUrls] = useState<string[]>([])
  const [reportPolling, setReportPolling] = useState(false)
  const [reportNotice, setReportNotice] = useState('')

  const showError = useCallback((title: string, error: unknown) => {
    return dialog.alert(title, userFacingErrorMessage(error), 'danger')
  }, [dialog])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getHealthProfile()
      setProfile(data)
      const urls = data.health_condition?.report_extract?._image_urls || []
      setReportImageUrls(urls)
    } catch (error) {
      await showError('获取健康档案失败', error)
    } finally {
      setLoading(false)
    }
  }, [showError])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const openEditor = (field: EditField, value: unknown) => {
    setEditingField(field)
    setEditValue(formatEditValue(value))
  }

  const closeEditor = () => {
    setEditingField(null)
    setEditValue('')
  }

  const saveField = async () => {
    if (!editingField) return
    if (editingField === 'report_extract') {
      closeEditor()
      return
    }
    setSaving(true)
    try {
      const input = buildHealthProfileFieldInput(editingField, editValue)
      const data = await apiClient.updateHealthProfile(input)
      setProfile(data)
      closeEditor()
      await dialog.alert('已保存', `${fieldLabels[editingField]}已更新`, 'success')
    } catch (error) {
      await showError('保存健康档案失败', error)
    } finally {
      setSaving(false)
    }
  }

  const handleRefill = async () => {
    const confirmed = await dialog.confirm({
      title: '重新填写',
      message: '将前往答题页面重新填写健康档案。确定继续吗？',
      confirmText: '继续',
      cancelText: '取消',
      kind: 'info',
    })
    if (confirmed) navigation.navigate('HealthProfile')
  }

  const uploadReportImages = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      await dialog.alert('需要相册权限', '请选择体检报告或病例图片。', 'warning')
      return
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 9,
      quality: 0.86,
    })
    if (picked.canceled || picked.assets.length === 0) return

    setSaving(true)
    try {
      const urls: string[] = []
      for (const asset of picked.assets.slice(0, 9)) {
        const base64Image = await readImageAsBase64DataUrl(asset.uri, asset.mimeType || 'image/jpeg')
        const uploaded = await apiClient.uploadHealthReportImage({ base64Image })
        urls.push(uploaded.imageUrl)
      }
      const task = await apiClient.submitReportExtractionTask({ imageUrl: urls[0], imageUrls: urls })
      applyReportProcessing(urls)
      setReportNotice(`已上传 ${urls.length} 张报告，识别完成后会自动刷新。`)
      await dialog.alert('已提交识别', '报告正在后台识别，完成后会自动刷新到健康档案。', 'success')
      void pollReportTaskUntilSettled(task.taskId)
    } catch (error) {
      await showError('上传报告失败', error)
    } finally {
      setSaving(false)
    }
  }

  const retryReportExtraction = async () => {
    const urls = reportImageUrls.length ? reportImageUrls : profile?.health_condition?.report_extract?._image_urls || []
    if (!urls.length) {
      await dialog.alert('请先上传报告图片', undefined, 'warning')
      return
    }
    setSaving(true)
    try {
      const task = await apiClient.submitReportExtractionTask({ imageUrl: urls[0], imageUrls: urls })
      applyReportProcessing(urls)
      setReportNotice('已重新提交报告识别，完成后会自动刷新。')
      await dialog.alert('已重新提交', '报告正在后台识别，完成后会自动刷新到健康档案。', 'success')
      void pollReportTaskUntilSettled(task.taskId)
    } catch (error) {
      await showError('重新识别失败', error)
    } finally {
      setSaving(false)
    }
  }

  const applyReportProcessing = (urls: string[]) => {
    const nextReport: HealthReportExtract = {
      indicators: [],
      conclusions: [],
      suggestions: [],
      medical_notes: '',
      _image_urls: urls,
      _status: 'processing',
      _error: '',
    }
    setReportImageUrls(urls)
    setProfile((current) => {
      if (!current) return current
      return {
        ...current,
        health_condition: {
          ...(current.health_condition || {}),
          report_extract: nextReport,
        },
      }
    })
  }

  const pollReportTaskUntilSettled = async (taskId: string) => {
    const id = taskId.trim()
    if (!id) return
    setReportPolling(true)
    const startedAt = Date.now()
    try {
      while (Date.now() - startedAt < REPORT_TASK_POLL_TIMEOUT_MS) {
        await sleep(REPORT_TASK_POLL_INTERVAL_MS)
        try {
          const task = await apiClient.getAnalyzeTask(id)
          if (isTerminalTaskStatus(task.status)) {
            await load().catch(() => undefined)
            if (task.status === 'done') {
              setReportNotice('报告识别完成，结果已刷新。')
            } else {
              setReportNotice(userFacingMessage(task.error_message, '报告识别没有成功，可以重新上传或重试。'))
            }
            return
          }
        } catch {
          // Network glitches should not abort the background polling loop.
        }
      }
      await load().catch(() => undefined)
      setReportNotice('报告识别尚未完成，可稍后下拉刷新查看结果。')
    } finally {
      setReportPolling(false)
    }
  }

  const report = profile?.health_condition?.report_extract
  const medicalHistory = profile?.health_condition?.medical_history || []
  const dietPreference = profile?.health_condition?.diet_preference || []
  const allergies = profile?.health_condition?.allergies || []
  const routineDisplay = profile?.health_condition?.routine_type || '--'
  const reportSummaryValue = reportStatusValue(report)

  const renderEditorBody = () => {
    if (!editingField) return null
    if (editingField === 'report_extract') {
      return (
        <View style={styles.editorReportBody}>
          <ReportSummary report={report} />
          {reportImageUrls.length ? <ReportImageGrid urls={reportImageUrls} /> : null}
          <ActionButton label={reportImageUrls.length ? '上传新报告' : '上传报告'} loading={saving} onPress={uploadReportImages} />
          {reportImageUrls.length ? <ActionButton label="重新识别当前报告" variant="secondary" loading={saving} onPress={retryReportExtraction} /> : null}
        </View>
      )
    }
    const choices = choiceOptionsFor(editingField)
    if (choices) {
      return <ChoiceList value={editValue} options={choices} onChange={setEditValue} />
    }
    const multiChoices = multiOptionsFor(editingField)
    if (multiChoices) {
      return (
        <View>
          <MultiChoiceGrid value={splitList(editValue)} options={multiChoices} onChange={(next) => setEditValue(next.join('、'))} />
          <Field
            label="补充项目"
            value={editValue}
            onChangeText={setEditValue}
            multiline
            placeholder="可用逗号分隔补充自定义项目"
          />
        </View>
      )
    }
    return (
      <Field
        label={fieldHint(editingField)}
        value={editValue}
        onChangeText={setEditValue}
        multiline={editingField === 'health_notes'}
        keyboardType={editingField === 'height' || editingField === 'weight' ? 'decimal-pad' : 'default'}
        placeholder={fieldHint(editingField)}
      />
    )
  }

  return (
    <View style={styles.page}>
      {loading && !profile ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : !profile ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>暂无健康档案</Text>
          <ActionButton label="去填写" onPress={() => navigation.navigate('HealthProfile')} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <InfoBlock title="基础信息">
            <EditableRow label="性别" value={labelValue(profile.gender, genderLabel)} onPress={() => openEditor('gender', profile.gender)} />
            <EditableRow label="出生日期" value={formatDateOnly(profile.birthday)} onPress={() => openEditor('birthday', profile.birthday)} />
            <EditableRow label="身高" value={profile.height != null ? `${profile.height} cm` : '--'} onPress={() => openEditor('height', profile.height)} />
            <EditableRow label="体重" value={profile.weight != null ? `${profile.weight} kg` : '--'} onPress={() => openEditor('weight', profile.weight)} />
            <EditableRow label="饮食目标" value={labelValue(profile.diet_goal, goalLabel)} highlight onPress={() => openEditor('diet_goal', profile.diet_goal)} />
            <EditableRow
              label="日常活动"
              value={labelValue(profile.health_condition?.daily_life_activity_level || profile.activity_level, activityLabel)}
              onPress={() => openEditor('daily_life_activity_level', profile.health_condition?.daily_life_activity_level || profile.activity_level)}
            />
            <EditableRow label="作息习惯" value={routineDisplay} onPress={() => openEditor('routine_type', routineDisplay)} />
            <EditableRow label="执行模式" value={executionModeLabel(profile.execution_mode)} onPress={() => openEditor('execution_mode', normalizeExecutionMode(profile.execution_mode))} />
          </InfoBlock>

          {profile.bmr != null || profile.tdee != null ? (
            <InfoBlock title="代谢数据">
              {profile.bmr != null ? <InfoRow label="BMR（基础代谢率）" value={`${Math.round(profile.bmr)} kcal/天`} /> : null}
              {profile.tdee != null ? <InfoRow label="日常消耗估算" value={`${Math.round(profile.tdee)} kcal/天`} /> : null}
            </InfoBlock>
          ) : null}

          <InfoBlock title="病史与饮食">
            <EditableRow label="既往病史" value={listLabel(medicalHistory, medicalLabel)} onPress={() => openEditor('medical_history', medicalHistory)} />
            <EditableRow label="饮食偏好" value={listLabel(dietPreference, dietPreferenceLabel)} onPress={() => openEditor('diet_preference', dietPreference)} />
            <EditableRow label="过敏源" value={listLabel(allergies, allergyLabel)} onPress={() => openEditor('allergies', allergies)} />
            <EditableRow label="特殊情况和补充" value={String(profile.health_condition?.health_notes || '无')} onPress={() => openEditor('health_notes', profile.health_condition?.health_notes)} column />
          </InfoBlock>

          <InfoBlock title="体检/病例识别结果">
            {reportNotice ? (
              <View style={styles.reportStatusCard}>
                {reportPolling ? <ActivityIndicator size="small" color={colors.brand} /> : null}
                <Text style={styles.reportStatusText}>{reportNotice}</Text>
              </View>
            ) : null}
            {reportSummaryValue ? (
              <EditableRow label="报告结果" value={reportSummaryValue} highlight={reportSummaryValue === '查看结果'} onPress={() => openEditor('report_extract', report)} />
            ) : (
              <Pressable style={styles.reportUploadTrigger} onPress={uploadReportImages}>
                <View style={styles.reportUploadIcon}>
                  <Text style={styles.reportUploadIconText}>+</Text>
                </View>
                <Text style={styles.reportUploadTitle}>点击上传体检报告</Text>
                <Text style={styles.reportUploadDesc}>支持 JPG / PNG 格式，最多 9 张</Text>
              </Pressable>
            )}
          </InfoBlock>

          <View style={styles.footerActions}>
            <ActionButton label="重新填写" variant="secondary" onPress={handleRefill} />
          </View>
        </ScrollView>
      )}

      <Modal visible={!!editingField} transparent animationType="fade" onRequestClose={closeEditor}>
        <View style={styles.editorModal}>
          <Pressable style={styles.editorMask} onPress={closeEditor} />
          <View style={styles.editorContent}>
            <View style={styles.editorHeader}>
              <Pressable onPress={closeEditor} style={styles.editorHeaderButton}>
                <Text style={styles.editorCancel}>取消</Text>
              </Pressable>
              <Text style={styles.editorTitle}>{editingField ? fieldLabels[editingField] : ''}</Text>
              <Pressable onPress={saveField} disabled={saving} style={styles.editorHeaderButton}>
                {saving ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={styles.editorConfirm}>{editingField === 'report_extract' ? '完成' : '确定'}</Text>}
              </Pressable>
            </View>
            <ScrollView style={styles.editorBody} showsVerticalScrollIndicator={false}>
              {renderEditorBody()}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      {children}
    </View>
  )
}

function EditableRow({
  label,
  value,
  onPress,
  column,
  highlight,
}: {
  label: string
  value: string
  onPress: () => void
  column?: boolean
  highlight?: boolean
}) {
  return (
    <Pressable style={[styles.row, column && styles.rowColumn]} onPress={onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={[styles.rowValueWrap, column && styles.rowValueWrapColumn]}>
        <Text style={[styles.rowValue, column && styles.rowValueColumn, highlight && styles.rowValueHighlight]} numberOfLines={column ? 3 : 2}>{value}</Text>
        <Text style={styles.rowArrow}>›</Text>
      </View>
    </Pressable>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  )
}

function ChoiceList({
  value,
  options,
  onChange,
}: {
  value: string
  options: ReadonlyArray<ChoiceOption>
  onChange: (value: string) => void
}) {
  return (
    <View style={styles.choiceList}>
      {options.map((option) => {
        const active = value === option.value
        return (
          <Pressable key={option.value || 'empty'} style={[styles.choiceItem, active && styles.choiceItemActive]} onPress={() => onChange(option.value)}>
            <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{option.label}</Text>
            {active ? <Text style={styles.choiceCheck}>✓</Text> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

function MultiChoiceGrid({
  value,
  options,
  onChange,
}: {
  value: string[]
  options: ReadonlyArray<ChoiceOption>
  onChange: (value: string[]) => void
}) {
  const selected = value.length ? value : ['none']
  const toggle = (option: ChoiceOption) => {
    if (option.value === 'none') {
      onChange(['none'])
      return
    }
    const withoutNone = selected.filter((item) => item !== 'none')
    const next = withoutNone.includes(option.value)
      ? withoutNone.filter((item) => item !== option.value)
      : [...withoutNone, option.value]
    onChange(next.length ? next : ['none'])
  }
  return (
    <View style={styles.multiGrid}>
      {options.map((option) => {
        const active = selected.includes(option.value)
        return (
          <Pressable key={option.value} style={[styles.multiItem, active && styles.multiItemActive]} onPress={() => toggle(option)}>
            <View style={[styles.multiDot, active && styles.multiDotActive]} />
            <Text style={[styles.multiText, active && styles.multiTextActive]}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
  placeholder,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
  placeholder?: string
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  )
}

function ActionButton({
  label,
  onPress,
  loading,
  variant = 'primary',
}: {
  label: string
  onPress: () => void
  loading?: boolean
  variant?: 'primary' | 'secondary'
}) {
  return (
    <Pressable
      style={[styles.actionButton, variant === 'secondary' && styles.actionButtonSecondary, loading && styles.actionButtonDisabled]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? <ActivityIndicator size="small" color={variant === 'secondary' ? colors.brand : '#fff'} /> : <Text style={[styles.actionButtonText, variant === 'secondary' && styles.actionButtonTextSecondary]}>{label}</Text>}
    </Pressable>
  )
}

function ReportSummary({ report }: { report?: HealthReportExtract }) {
  const status = report?._status || ''
  const indicators = report?.indicators || []
  const conclusions = report?.conclusions || []
  const suggestions = report?.suggestions || []
  if (!report) {
    return <Text style={styles.reportEmptyText}>上传体检报告后，AI 会提取指标、结论和建议。</Text>
  }
  if (status === 'processing') {
    return (
      <View style={styles.editorReportStatus}>
        <ActivityIndicator size="small" color={colors.brand} />
        <View style={styles.editorReportStatusCopy}>
          <Text style={styles.editorReportStatusTitle}>新报告识别中</Text>
          <Text style={styles.editorReportStatusDesc}>系统已收到报告，识别完成后会自动刷新当前结果。</Text>
        </View>
      </View>
    )
  }
  if (status === 'failed') {
    return (
      <View style={[styles.editorReportStatus, styles.editorReportStatusFailed]}>
        <Text style={styles.editorReportStatusTitleFailed}>识别失败</Text>
        <Text style={styles.editorReportStatusDescFailed}>{report._error || '这次报告识别没有成功，可以重新上传后再试。'}</Text>
      </View>
    )
  }
  return (
    <View>
      {conclusions.length ? <ReportBlock title="诊断结论" lines={conclusions} /> : null}
      {indicators.length ? (
        <View style={styles.reportBlock}>
          <Text style={styles.reportTitle}>提取指标</Text>
          {indicators.slice(0, 12).map((indicator, index) => (
            <View key={`${indicator.name || index}`} style={styles.indicatorRow}>
              <Text style={styles.indicatorName}>{String(indicator.name || `指标 ${index + 1}`)}</Text>
              <Text style={[styles.indicatorValue, indicator.flag ? styles.indicatorValueAbnormal : null]}>
                {`${indicator.value ?? '--'} ${indicator.unit || ''} ${indicator.flag || ''}`.trim()}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {suggestions.length ? <ReportBlock title="医学建议" lines={suggestions} /> : null}
      {report.medical_notes ? <ReportBlock title="其他记录" lines={[report.medical_notes]} /> : null}
      {!conclusions.length && !suggestions.length && !indicators.length && !report.medical_notes ? (
        <Text style={styles.reportEmptyText}>暂无识别结果。</Text>
      ) : null}
    </View>
  )
}

function ReportBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <View style={styles.reportBlock}>
      <Text style={styles.reportTitle}>{title}</Text>
      {lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={styles.reportLine}>• {line}</Text>
      ))}
    </View>
  )
}

function ReportImageGrid({ urls }: { urls: string[] }) {
  return (
    <View style={styles.reportGrid}>
      {urls.slice(0, 9).map((url, index) => (
        <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.reportImage} />
      ))}
    </View>
  )
}

function buildHealthProfileFieldInput(field: Exclude<EditField, 'report_extract'>, value: string) {
  const trimmed = value.trim()
  switch (field) {
    case 'height':
    case 'weight':
      return { [field]: Number(trimmed) || undefined }
    case 'medical_history':
    case 'diet_preference':
    case 'allergies':
      return { [field]: healthListForSubmit(splitList(trimmed)) }
    case 'daily_life_activity_level':
      return { daily_life_activity_level: trimmed, activity_level: trimmed }
    case 'execution_mode':
      return { execution_mode: normalizeExecutionMode(trimmed) }
    default:
      return { [field]: trimmed }
  }
}

function splitList(value: string): string[] {
  return value.split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean)
}

function healthListForSubmit(value: string[]): string[] {
  const list = value.filter((item) => item && item !== 'none')
  return list.length ? list : ['none']
}

function formatEditValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join('、') : 'none'
  return value == null ? '' : String(value)
}

function fieldHint(field: EditField): string {
  if (field === 'birthday') return 'YYYY-MM-DD'
  if (field === 'routine_type') return '例如：23:00-07:00'
  if (field === 'health_notes') return '例如：孕期、哺乳期、手术恢复期等'
  return fieldLabels[field]
}

function choiceOptionsFor(field: EditField): ReadonlyArray<ChoiceOption> | undefined {
  if (field === 'gender') return fieldChoiceOptions.gender
  if (field === 'diet_goal') return fieldChoiceOptions.diet_goal
  if (field === 'daily_life_activity_level') return fieldChoiceOptions.daily_life_activity_level
  if (field === 'execution_mode') return fieldChoiceOptions.execution_mode
  return undefined
}

function multiOptionsFor(field: EditField): ReadonlyArray<ChoiceOption> | undefined {
  if (field === 'medical_history') return fieldMultiOptions.medical_history
  if (field === 'diet_preference') return fieldMultiOptions.diet_preference
  if (field === 'allergies') return fieldMultiOptions.allergies
  return undefined
}

function reportStatusValue(report?: HealthReportExtract): string {
  if (!report) return ''
  const status = report._status || ''
  const hasData = Boolean(report.indicators?.length || report.conclusions?.length || report.suggestions?.length || report.medical_notes)
  if (status === 'failed') return '识别失败，请重试'
  if (status === 'processing') return '后台识别中...'
  return hasData ? '查看结果' : ''
}

function formatDateOnly(value?: string | null): string {
  const raw = String(value || '').trim()
  if (!raw) return '--'
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : raw
}

function listLabel(value: string[], formatter: (value: string) => string): string {
  const list = value.filter((item) => item && item !== 'none')
  return list.length ? list.map(formatter).join('、') : '无'
}

function labelValue(value: unknown, formatter: (value: string) => string): string {
  const raw = String(value || '').trim()
  return raw ? formatter(raw) : '--'
}

function genderLabel(value: string): string {
  return ({ male: '男', female: '女', other: '其他' } as Record<string, string>)[value] || value
}

function goalLabel(value: string): string {
  return ({ fat_loss: '减重', maintain: '保持', muscle_gain: '增重' } as Record<string, string>)[value] || value
}

function activityLabel(value: string): string {
  return ({
    sedentary: '久坐办公',
    light: '日常走动较多',
    moderate: '经常站立走动',
    active: '体力劳动',
    very_active: '高强度',
  } as Record<string, string>)[value] || value
}

function medicalLabel(value: string): string {
  return ({
    diabetes: '糖尿病',
    hypertension: '高血压',
    gout: '痛风',
    hyperlipidemia: '高血脂',
    thyroid: '甲状腺疾病',
  } as Record<string, string>)[value] || value
}

function dietPreferenceLabel(value: string): string {
  return ({
    keto: '生酮',
    vegetarian: '素食',
    vegan: '纯素',
    low_salt: '低盐',
    gluten_free: '无麸质',
  } as Record<string, string>)[value] || value
}

function allergyLabel(value: string): string {
  return ({
    seafood: '海鲜',
    peanut: '花生',
    milk: '牛奶',
    egg: '鸡蛋',
    mango: '芒果',
    alcohol: '酒精',
    spicy: '辣',
  } as Record<string, string>)[value] || value
}

function executionModeLabel(value?: string | null): string {
  const raw = normalizeExecutionMode(value)
  return ({ fast: '快速模式', standard: '普通模式', strict: '精准模式' } as Record<string, string>)[raw] || '普通模式'
}

function normalizeExecutionMode(value?: string | null): ExecutionMode {
  const raw = String(value || 'standard')
  if (raw.includes('fast') || raw === 'lite') return 'fast'
  if (raw.includes('strict') || raw.includes('gemini35')) return 'strict'
  return 'standard'
}

function isTerminalTaskStatus(status?: string): boolean {
  return status === 'done' || status === 'failed' || status === 'timed_out' || status === 'cancelled' || status === 'violated'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f5f6f8',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 36,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: 15,
    marginBottom: 18,
    textAlign: 'center',
  },
  block: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  blockTitle: {
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  rowColumn: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 8,
  },
  rowLabel: {
    width: 84,
    flexShrink: 0,
    marginRight: 14,
    color: '#6a7282',
    fontSize: 14,
  },
  rowValueWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowValueWrapColumn: {
    width: '100%',
  },
  rowValue: {
    flex: 1,
    minWidth: 0,
    color: '#1a1a1a',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'left',
  },
  rowValueColumn: {
    textAlign: 'left',
  },
  rowValueHighlight: {
    color: colors.brand,
    fontWeight: '700',
  },
  rowArrow: {
    color: '#a9b1c1',
    fontSize: 18,
    fontWeight: '800',
  },
  footerActions: {
    paddingVertical: 12,
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: colors.brand,
  },
  actionButtonSecondary: {
    backgroundColor: '#f5f7fa',
    borderWidth: 1,
    borderColor: '#e8eaed',
  },
  actionButtonDisabled: {
    opacity: 0.72,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  actionButtonTextSecondary: {
    color: '#666',
  },
  reportStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.brandSoft,
    marginBottom: 12,
  },
  reportStatusText: {
    flex: 1,
    color: colors.brandDark,
    lineHeight: 20,
    fontWeight: '700',
  },
  reportUploadTrigger: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  reportUploadIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2f7',
  },
  reportUploadIconText: {
    color: '#94a3b8',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
  },
  reportUploadTitle: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  reportUploadDesc: {
    color: '#94a3b8',
    fontSize: 12,
  },
  editorModal: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 12,
  },
  editorMask: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  editorContent: {
    maxHeight: '82%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: '#fff',
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  editorHeaderButton: {
    width: 64,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorCancel: {
    color: '#666',
    fontSize: 14,
  },
  editorTitle: {
    flex: 1,
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  editorConfirm: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '700',
  },
  editorBody: {
    paddingTop: 12,
  },
  choiceList: {
    gap: 0,
  },
  choiceItem: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  choiceItemActive: {},
  choiceText: {
    color: '#333',
    fontSize: 15,
  },
  choiceTextActive: {
    color: colors.brand,
    fontWeight: '700',
  },
  choiceCheck: {
    color: colors.brand,
    fontSize: 18,
    fontWeight: '800',
  },
  multiGrid: {
    gap: 8,
    marginBottom: 12,
  },
  multiItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  multiItemActive: {
    borderColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  multiDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
  },
  multiDotActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
    shadowColor: '#fff',
    shadowOpacity: 1,
  },
  multiText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  multiTextActive: {
    color: '#1a1a1a',
  },
  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  textarea: {
    minHeight: 96,
    paddingTop: 12,
    paddingBottom: 12,
  },
  editorReportBody: {
    gap: 12,
  },
  editorReportStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#eefbf6',
  },
  editorReportStatusFailed: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    backgroundColor: '#fff4f4',
  },
  editorReportStatusCopy: {
    flex: 1,
    gap: 3,
  },
  editorReportStatusTitle: {
    color: '#047857',
    fontWeight: '700',
  },
  editorReportStatusDesc: {
    color: '#059669',
    lineHeight: 20,
  },
  editorReportStatusTitleFailed: {
    color: '#b42318',
    fontWeight: '700',
  },
  editorReportStatusDescFailed: {
    color: '#d92d20',
    lineHeight: 20,
  },
  reportBlock: {
    marginBottom: 12,
  },
  reportTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 6,
  },
  reportLine: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  reportEmptyText: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    marginBottom: 6,
  },
  indicatorName: {
    flex: 1,
    color: '#374151',
    fontSize: 13,
  },
  indicatorValue: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'right',
  },
  indicatorValueAbnormal: {
    color: '#ef4444',
    fontWeight: '700',
  },
  reportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reportImage: {
    width: 88,
    height: 110,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
})
