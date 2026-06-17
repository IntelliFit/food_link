import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect } from '@react-navigation/native'
import type { HealthProfile, HealthReportExtract } from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
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

const fieldLabels: Record<EditField, string> = {
  gender: '性别',
  birthday: '出生日期',
  height: '身高 cm',
  weight: '体重 kg',
  diet_goal: '饮食目标',
  daily_life_activity_level: '日常活动',
  execution_mode: '执行模式',
  medical_history: '既往病史',
  diet_preference: '饮食偏好',
  allergies: '过敏源',
  routine_type: '作息习惯',
  health_notes: '特殊情况和补充',
}

const fieldChoiceOptions = {
  gender: [
    { value: '', label: '暂不填写' },
    { value: 'female', label: '女' },
    { value: 'male', label: '男' },
    { value: 'other', label: '其他' },
  ],
  diet_goal: [
    { value: '', label: '暂不填写' },
    { value: 'fat_loss', label: '减脂' },
    { value: 'maintain', label: '保持' },
    { value: 'muscle_gain', label: '增肌' },
  ],
  daily_life_activity_level: [
    { value: '', label: '暂不填写' },
    { value: 'sedentary', label: '久坐办公' },
    { value: 'light', label: '日常走动' },
    { value: 'moderate', label: '经常运动' },
    { value: 'active', label: '体力劳动' },
    { value: 'very_active', label: '高强度' },
  ],
  execution_mode: [
    { value: 'standard', label: '普通模式' },
    { value: 'fast', label: '快速模式' },
    { value: 'strict', label: '精准模式' },
  ],
} as const

const REPORT_TASK_POLL_INTERVAL_MS = 4000
const REPORT_TASK_POLL_TIMEOUT_MS = 90000

export function HealthProfileViewScreen() {
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingField, setEditingField] = useState<EditField | null>(null)
  const [editValue, setEditValue] = useState('')
  const [reportImageUrls, setReportImageUrls] = useState<string[]>([])
  const [reportPolling, setReportPolling] = useState(false)
  const [reportNotice, setReportNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getHealthProfile()
      setProfile(data)
      const urls = data.health_condition?.report_extract?._image_urls || []
      setReportImageUrls(urls)
    } catch (error) {
      showError('获取健康档案失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const openEditor = (field: EditField, value: unknown) => {
    setEditingField(field)
    setEditValue(formatEditValue(value))
  }

  const saveField = async () => {
    if (!editingField) return
    setSaving(true)
    try {
      const input = buildHealthProfileFieldInput(editingField, editValue)
      const data = await apiClient.updateHealthProfile(input)
      setProfile(data)
      setEditingField(null)
      setEditValue('')
      Alert.alert('已保存', `${fieldLabels[editingField]}已更新`)
    } catch (error) {
      showError('保存健康档案失败', error)
    } finally {
      setSaving(false)
    }
  }

  const uploadReportImages = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请选择体检报告或病例图片。')
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
      Alert.alert('已提交识别', '报告正在后台识别，完成后会自动刷新到健康档案。')
      void pollReportTaskUntilSettled(task.taskId)
    } catch (error) {
      showError('上传报告失败', error)
    } finally {
      setSaving(false)
    }
  }

  const retryReportExtraction = async () => {
    const urls = reportImageUrls.length ? reportImageUrls : profile?.health_condition?.report_extract?._image_urls || []
    if (!urls.length) {
      Alert.alert('请先上传报告图片')
      return
    }
    setSaving(true)
    try {
      const task = await apiClient.submitReportExtractionTask({ imageUrl: urls[0], imageUrls: urls })
      applyReportProcessing(urls)
      setReportNotice('已重新提交报告识别，完成后会自动刷新。')
      Alert.alert('已重新提交', '报告正在后台识别，完成后会自动刷新到健康档案。')
      void pollReportTaskUntilSettled(task.taskId)
    } catch (error) {
      showError('重新识别失败', error)
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
      setReportNotice('报告识别仍在处理中，可稍后下拉刷新查看结果。')
    } finally {
      setReportPolling(false)
    }
  }

  const report = profile?.health_condition?.report_extract

  return (
    <Page title="健康档案详情" subtitle="基础信息、病史偏好、执行模式和体检报告" refreshing={loading} onRefresh={load}>
      {editingField ? (
        <Card>
          <Text style={styles.sectionTitle}>编辑{fieldLabels[editingField]}</Text>
          {choiceOptionsFor(editingField) ? (
            <ChoiceSegment value={editValue} options={choiceOptionsFor(editingField) || []} onChange={setEditValue} />
          ) : (
            <Field
              label={fieldHint(editingField)}
              value={editValue}
              onChangeText={setEditValue}
              multiline={editingField === 'health_notes'}
              keyboardType={editingField === 'height' || editingField === 'weight' ? 'decimal-pad' : 'default'}
            />
          )}
          <AppButton label="保存" loading={saving} onPress={saveField} />
          <Pressable style={styles.cancelEdit} onPress={() => setEditingField(null)}>
            <Text style={styles.cancelEditText}>取消</Text>
          </Pressable>
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>基础信息</Text>
        <EditableRow label="性别" value={labelValue(profile?.gender, genderLabel)} onPress={() => openEditor('gender', profile?.gender)} />
        <EditableRow label="出生日期" value={formatDateOnly(profile?.birthday)} onPress={() => openEditor('birthday', profile?.birthday)} />
        <EditableRow label="身高" value={profile?.height != null ? `${profile.height} cm` : '--'} onPress={() => openEditor('height', profile?.height)} />
        <EditableRow label="体重" value={profile?.weight != null ? `${profile.weight} kg` : '--'} onPress={() => openEditor('weight', profile?.weight)} />
        <EditableRow label="饮食目标" value={labelValue(profile?.diet_goal, goalLabel)} onPress={() => openEditor('diet_goal', profile?.diet_goal)} />
        <EditableRow label="日常活动" value={labelValue(profile?.health_condition?.daily_life_activity_level || profile?.activity_level, activityLabel)} onPress={() => openEditor('daily_life_activity_level', profile?.health_condition?.daily_life_activity_level || profile?.activity_level)} />
        <EditableRow label="执行模式" value={executionModeLabel(profile?.execution_mode)} onPress={() => openEditor('execution_mode', profile?.execution_mode || 'standard')} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>病史与饮食</Text>
        <EditableRow label="既往病史" value={listLabel(profile?.health_condition?.medical_history)} onPress={() => openEditor('medical_history', profile?.health_condition?.medical_history)} />
        <EditableRow label="饮食偏好" value={listLabel(profile?.health_condition?.diet_preference)} onPress={() => openEditor('diet_preference', profile?.health_condition?.diet_preference)} />
        <EditableRow label="过敏源" value={listLabel(profile?.health_condition?.allergies)} onPress={() => openEditor('allergies', profile?.health_condition?.allergies)} />
        <EditableRow label="作息习惯" value={String(profile?.health_condition?.routine_type || '--')} onPress={() => openEditor('routine_type', profile?.health_condition?.routine_type)} />
        <EditableRow label="特殊情况和补充" value={String(profile?.health_condition?.health_notes || '无')} onPress={() => openEditor('health_notes', profile?.health_condition?.health_notes)} column />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>代谢数据</Text>
        <InfoRow label="BMR" value={profile?.bmr != null ? `${Math.round(profile.bmr)} kcal/天` : '--'} />
        <InfoRow label="TDEE" value={profile?.tdee != null ? `${Math.round(profile.tdee)} kcal/天` : '--'} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>体检/病例识别</Text>
        {reportNotice ? (
          <View style={styles.reportStatusCard}>
            {reportPolling ? <ActivityIndicator size="small" color={colors.brand} /> : null}
            <Text style={styles.reportStatusText}>{reportNotice}</Text>
          </View>
        ) : null}
        <ReportSummary report={report} />
        {reportImageUrls.length ? (
          <View style={styles.reportGrid}>
            {reportImageUrls.slice(0, 9).map((url, index) => (
              <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.reportImage} />
            ))}
          </View>
        ) : null}
        <View style={styles.reportActionGroup}>
          <AppButton label={reportImageUrls.length ? '上传新报告图片' : '上传报告图片'} variant="secondary" loading={saving} onPress={uploadReportImages} />
          {reportImageUrls.length ? <AppButton label="重新识别当前报告" variant="ghost" loading={saving} onPress={retryReportExtraction} /> : null}
          <AppButton label="刷新识别结果" variant="ghost" loading={loading} onPress={load} />
        </View>
      </Card>
    </Page>
  )
}

function ReportSummary({ report }: { report?: HealthReportExtract }) {
  const status = report?._status || ''
  const indicators = report?.indicators || []
  const conclusions = report?.conclusions || []
  const suggestions = report?.suggestions || []
  if (!report) {
    return <Text style={styles.subtitle}>上传体检报告后，AI 会提取指标、结论和建议。</Text>
  }
  if (status === 'processing') {
    return <Text style={styles.subtitle}>报告识别中，完成后会自动写入档案。</Text>
  }
  if (status === 'failed') {
    return <Text style={styles.subtitle}>{report._error || '报告识别失败，请重新上传。'}</Text>
  }
  return (
    <View>
      {conclusions.length ? <ReportBlock title="诊断结论" lines={conclusions} /> : null}
      {suggestions.length ? <ReportBlock title="医学建议" lines={suggestions} /> : null}
      {report.medical_notes ? <ReportBlock title="其他记录" lines={[report.medical_notes]} /> : null}
      {indicators.length ? (
        <View style={styles.reportBlock}>
          <Text style={styles.reportTitle}>提取指标</Text>
          {indicators.slice(0, 8).map((indicator, index) => (
            <InfoRow
              key={`${indicator.name || index}`}
              label={String(indicator.name || `指标 ${index + 1}`)}
              value={`${indicator.value ?? '--'} ${indicator.unit || ''} ${indicator.flag || ''}`.trim()}
            />
          ))}
        </View>
      ) : null}
      {!conclusions.length && !suggestions.length && !indicators.length && !report.medical_notes ? (
        <Text style={styles.subtitle}>暂无识别结果。</Text>
      ) : null}
    </View>
  )
}

function ReportBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <View style={styles.reportBlock}>
      <Text style={styles.reportTitle}>{title}</Text>
      {lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={styles.subtitle}>• {line}</Text>
      ))}
    </View>
  )
}

function EditableRow({
  label,
  value,
  onPress,
  column,
}: {
  label: string
  value: string
  onPress: () => void
  column?: boolean
}) {
  return (
    <Pressable style={[styles.infoRow, column && styles.infoRowColumn]} onPress={onPress}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, column && styles.infoValueColumn]}>{value}</Text>
    </Pressable>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function ChoiceSegment({
  value,
  options,
  onChange,
}: {
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => (
        <Pressable key={option.value || 'empty'} style={[styles.segmentItem, value === option.value && styles.segmentItemActive]} onPress={() => onChange(option.value)}>
          <Text style={[styles.segmentText, value === option.value && styles.segmentTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
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
        placeholderTextColor={colors.textMuted}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  )
}

function buildHealthProfileFieldInput(field: EditField, value: string) {
  const trimmed = value.trim()
  switch (field) {
    case 'height':
    case 'weight':
      return { [field]: Number(trimmed) || undefined }
    case 'medical_history':
    case 'diet_preference':
    case 'allergies':
      return { [field]: splitList(trimmed) }
    case 'daily_life_activity_level':
      return { daily_life_activity_level: trimmed, activity_level: trimmed }
    default:
      return { [field]: trimmed }
  }
}

function splitList(value: string): string[] {
  return value.split(/[,\s，、]+/).map((item) => item.trim()).filter(Boolean)
}

function formatEditValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('、')
  return value == null ? '' : String(value)
}

function fieldHint(field: EditField): string {
  if (field === 'birthday') return 'YYYY-MM-DD'
  if (field === 'medical_history') return '用逗号分隔，例如：糖尿病、高血压；没有可填 none'
  if (field === 'diet_preference') return '用逗号分隔，例如：低盐、素食；没有可填 none'
  if (field === 'allergies') return '用逗号分隔，例如：牛奶、海鲜；没有可填 none'
  if (field === 'routine_type') return '例如：23:00-07:00'
  return fieldLabels[field]
}

function choiceOptionsFor(field: EditField): ReadonlyArray<{ value: string; label: string }> | undefined {
  if (field === 'gender') return fieldChoiceOptions.gender
  if (field === 'diet_goal') return fieldChoiceOptions.diet_goal
  if (field === 'daily_life_activity_level') return fieldChoiceOptions.daily_life_activity_level
  if (field === 'execution_mode') return fieldChoiceOptions.execution_mode
  return undefined
}

function formatDateOnly(value?: string | null): string {
  const raw = String(value || '').trim()
  if (!raw) return '--'
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : raw
}

function listLabel(value?: string[]): string {
  const list = (value || []).filter((item) => item && item !== 'none')
  return list.length ? list.join('、') : '无'
}

function labelValue(value: unknown, formatter: (value: string) => string): string {
  const raw = String(value || '').trim()
  return raw ? formatter(raw) : '--'
}

function genderLabel(value: string): string {
  return ({ male: '男', female: '女', other: '其他' } as Record<string, string>)[value] || value
}

function goalLabel(value: string): string {
  return ({ fat_loss: '减脂', maintain: '保持', muscle_gain: '增肌' } as Record<string, string>)[value] || value
}

function activityLabel(value: string): string {
  return ({
    sedentary: '久坐办公',
    light: '日常走动较多',
    moderate: '经常站立走动',
    active: '体力劳动',
    very_active: '高强度体力活动',
  } as Record<string, string>)[value] || value
}

function executionModeLabel(value?: string | null): string {
  const raw = String(value || 'standard')
  if (raw.includes('fast') || raw === 'lite') return '快速模式'
  if (raw.includes('strict') || raw.includes('gemini35')) return '精准模式'
  return '普通模式'
}

function showError(title: string, error: unknown) {
  Alert.alert(title, userFacingErrorMessage(error))
}

function isTerminalTaskStatus(status?: string): boolean {
  return status === 'done' || status === 'failed' || status === 'timed_out' || status === 'cancelled' || status === 'violated'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRowColumn: {
    flexDirection: 'column',
  },
  infoLabel: {
    color: colors.textSecondary,
  },
  infoValue: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'right',
  },
  infoValueColumn: {
    textAlign: 'left',
    lineHeight: 22,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  textarea: {
    minHeight: 104,
    paddingTop: 12,
    paddingBottom: 12,
  },
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  segmentItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  segmentItemActive: {
    backgroundColor: colors.brand,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },
  segmentTextActive: {
    color: '#fff',
  },
  cancelEdit: {
    alignItems: 'center',
    paddingTop: 12,
  },
  cancelEditText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  reportBlock: {
    marginBottom: 14,
  },
  reportTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 6,
  },
  reportStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.brandSoft,
    marginBottom: 12,
  },
  reportStatusText: {
    flex: 1,
    color: colors.brandDark,
    lineHeight: 20,
    fontWeight: '700',
  },
  reportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 12,
  },
  reportActionGroup: {
    gap: 10,
  },
  reportImage: {
    width: 88,
    height: 88,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
})
