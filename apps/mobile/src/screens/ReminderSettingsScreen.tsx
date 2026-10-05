import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReminderPreferences } from '@food-link/core'
import { FoodLinkApiError } from '@food-link/api-client'
import { apiClient, getStoredUserId } from '../api'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { enableReminderDevice, hasNotificationPermission } from '../utils/businessNotifications'
import { userFacingErrorMessage } from '../utils/errors'
import { colors } from '../theme'

const timeFields = [
  ['breakfast_time', '早餐'], ['lunch_time', '午餐'], ['dinner_time', '晚餐'],
  ['log_time', '当天漏记'], ['expiry_time', '临期检查'], ['quiet_start', '免打扰开始'], ['quiet_end', '免打扰结束'],
] as const

export function ReminderSettingsScreen() {
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [form, setForm] = useState<ReminderPreferences | null>(null)
  const [available, setAvailable] = useState(false)
  const [permitted, setPermitted] = useState(false)
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const owner = useRef<string | null>(null)
  const savingRef = useRef(false)
  const palette = {
    page: isDark ? '#0d1312' : '#f8faf9', card: isDark ? '#181f1d' : '#ffffff',
    text: isDark ? '#f2f7f4' : '#17201d', muted: isDark ? '#a8b6b0' : '#64748b', border: isDark ? '#39443f' : '#e6ece9',
  }

  const load = useCallback(async () => {
    const seq = ++sequence.current
    setBusy(true)
    setError('')
    try {
      const currentOwner = await getStoredUserId()
      const [settings, permission] = await Promise.all([apiClient.getReminderSettings(), hasNotificationPermission()])
      if (seq !== sequence.current || currentOwner !== await getStoredUserId()) return
      owner.current = currentOwner
      setForm(settings.preferences)
      setAvailable(settings.push_available)
      setPermitted(permission)
    } catch (cause) {
      if (seq === sequence.current) {
        setForm(null)
        setError(cause instanceof FoodLinkApiError && cause.status === 404 ? '提醒服务尚未部署，请稍后再试。' : userFacingErrorMessage(cause))
      }
    } finally {
      if (seq === sequence.current) setBusy(false)
    }
  }, [])

  useFocusEffect(useCallback(() => {
    void load()
    return () => { sequence.current += 1 }
  }, [load]))

  const change = <K extends keyof ReminderPreferences>(key: K, value: ReminderPreferences[K]) => {
    setForm((previous) => previous ? { ...previous, [key]: value } : previous)
  }

  const save = async () => {
    if (!form || savingRef.current) return
    if (form.enabled && !available) { void dialog.alert('暂未启用', '后端提醒服务尚未启用，请稍后再试。'); return }
    savingRef.current = true
    setSaving(true)
    const seq = sequence.current
    try {
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      if (form.enabled) await enableReminderDevice()
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      const result = await apiClient.saveReminderSettings(form)
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      setForm(result.preferences)
      setPermitted(await hasNotificationPermission())
      void dialog.alert('已保存', form.enabled ? '将按所选时间提醒。已记录的餐次不会重复提醒。' : '业务提醒已关闭。', 'success')
    } catch (cause) {
      if (seq === sequence.current) void dialog.alert('未保存', userFacingErrorMessage(cause), 'danger')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const toggles = [
    ['enabled', '开启消息提醒', '默认关闭；保存后才生效'],
    ['meal_enabled', '用餐与餐食建议', '早、中、晚餐；已记录该餐则跳过'],
    ['log_enabled', '当天漏记提醒', '当天没有饮食记录时提醒一次'],
    ['expiry_enabled', '临期食物提醒', '汇总未来两天内标注到期、尚未处理的食物'],
  ] as const

  return <View style={[styles.page, { backgroundColor: palette.page }]}>
    {busy ? <View style={styles.center}><ActivityIndicator color={colors.brand} /></View> : !form ? <View style={styles.center}>
      <Text style={{ color: palette.muted }}>{error || '无法读取提醒设置'}</Text>
      <Pressable style={styles.button} onPress={() => void load()}><Text style={styles.buttonText}>重试</Text></Pressable>
    </View> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      {!available ? <Text style={[styles.note, { color: palette.muted }]}>后端服务尚未启用，暂时不能开启提醒。现有设置可关闭或修改。</Text> : null}
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        {toggles.map(([key, title, detail]) => <View key={key} style={styles.row}>
          <View style={styles.copy}><Text style={[styles.title, { color: palette.text }]}>{title}</Text><Text style={[styles.detail, { color: palette.muted }]}>{detail}</Text></View>
          <Switch accessibilityLabel={title} value={form[key]} disabled={saving || (key === 'enabled' && !available && !form.enabled)} onValueChange={(value) => change(key, value)} trackColor={{ false: palette.border, true: colors.brandSoft }} thumbColor={form[key] ? colors.brand : '#fff'} />
        </View>)}
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.text }]}>时间与免打扰</Text>
        <Text style={[styles.detail, { color: palette.muted }]}>24 小时制 HH:mm。提醒时间必须在免打扰时段以外。</Text>
        {timeFields.map(([key, label]) => <View key={key} style={styles.row}>
          <Text style={[styles.copy, { color: palette.text }]}>{label}</Text>
          <TextInput accessibilityLabel={`${label}时间`} value={form[key]} editable={!saving} onChangeText={(value) => change(key, value)} maxLength={5} autoCorrect={false} style={[styles.time, { color: palette.text, borderColor: palette.border }]} />
        </View>)}
        <Text style={[styles.detail, { color: palette.muted }]}>时区（例如 Asia/Shanghai）</Text>
        <TextInput accessibilityLabel="提醒时区" value={form.timezone} editable={!saving} onChangeText={(value) => change('timezone', value.trim())} maxLength={80} autoCorrect={false} autoCapitalize="none" style={[styles.zone, { color: palette.text, borderColor: palette.border }]} />
      </View>
      <Text style={[styles.note, { color: palette.muted }]}>系统通知：{permitted ? '已允许' : '未允许'}。仅在点击保存并开启提醒时申请权限。锁屏不展示私人健康数据，不自动调用付费 AI 或扣积分。到达时间可能受网络、省电模式及系统限制影响。</Text>
      {!permitted ? <Pressable accessibilityRole="button" style={styles.link} onPress={() => void Linking.openSettings()}><Text style={{ color: colors.brand }}>打开系统通知设置</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="保存消息提醒" disabled={saving} style={[styles.button, saving && { opacity: 0.65 }]} onPress={() => void save()}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>保存设置</Text>}
      </Pressable>
    </ScrollView>}
  </View>
}

const styles = StyleSheet.create({
  page: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  content: { padding: 18, gap: 16 }, card: { borderRadius: 18, padding: 16 }, row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  copy: { flex: 1 }, title: { fontSize: 16, fontWeight: '700' }, detail: { fontSize: 12, lineHeight: 19, marginTop: 5 },
  time: { minWidth: 82, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, textAlign: 'center', fontSize: 16 },
  zone: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, marginTop: 8 },
  note: { fontSize: 13, lineHeight: 21 }, link: { minHeight: 44, justifyContent: 'center' },
  button: { backgroundColor: colors.brand, minHeight: 48, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
