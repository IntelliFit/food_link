import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation/types'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReminderPreferences } from '@food-link/core'
import { FoodLinkApiError } from '@food-link/api-client'
import { apiClient, getStoredUserId } from '../api'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { enableReminderDevice, saveBusinessReminderSettings, refreshLocalMealRecords, getReminderChannelStatus, hasNotificationPermission, openReminderNotificationSettings, type ReminderChannelStatus } from '../utils/businessNotifications'
import { localMealSnapshot, supportsLocalMeals, openExactAlarmSettings, type LocalMealSnapshot } from '../native/localMeals'
import { userFacingErrorMessage } from '../utils/errors'
import { colors } from '../theme'
import { ReminderTimePicker } from '../components/ReminderTimePicker'

const timeFields = [
  ['breakfast_time', '早餐'], ['lunch_time', '午餐'], ['dinner_time', '晚餐'],
  ['log_time', '当天漏记'], ['expiry_time', '临期检查'], ['quiet_start', '免打扰开始'], ['quiet_end', '免打扰结束'],
] as const
type TimeField = typeof timeFields[number][0]

export function ReminderSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [form, setForm] = useState<ReminderPreferences | null>(null)
  const [available, setAvailable] = useState(false)
  const [eventsSupported, setEventsSupported] = useState(false)
  const [localSupported, setLocalSupported] = useState(false)
  const [localStatus, setLocalStatus] = useState<LocalMealSnapshot | null>(null)
  const [savedTimezone, setSavedTimezone] = useState('Asia/Shanghai')
  const [remoteStatus, setRemoteStatus] = useState('远程通道尚未在此页面验证')
  const [permitted, setPermitted] = useState(false)
  const [channelStatus, setChannelStatus] = useState<ReminderChannelStatus>('unknown')
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingTime, setEditingTime] = useState<{ key: TimeField; label: string; value: string } | null>(null)
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
    setEditingTime(null)
    try {
      const currentOwner = await getStoredUserId()
      const [settings, permission, channel, local] = await Promise.all([apiClient.getReminderSettings(), hasNotificationPermission(), getReminderChannelStatus(), localMealSnapshot()])
      if (seq !== sequence.current || currentOwner !== await getStoredUserId()) return
      owner.current = currentOwner
      setForm(settings.preferences)
      setSavedTimezone(settings.preferences.timezone)
      setAvailable(settings.push_available)
      setEventsSupported(settings.event_notifications_supported === true)
      setLocalSupported(supportsLocalMeals() && settings.local_meal_supported === true)
      setLocalStatus(local?.owner === currentOwner ? local : null)
      setPermitted(permission)
      setChannelStatus(channel)
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
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      const seq = sequence.current
      // Returning from Android settings must not discard unsaved reminder times.
      void Promise.all([hasNotificationPermission(), getReminderChannelStatus()]).then(([permission, channel]) => {
        if (seq !== sequence.current) return
        setPermitted(permission)
        setChannelStatus(channel)
      }).catch(() => undefined)
      void localMealSnapshot().then(value => { if (seq === sequence.current) setLocalStatus(value) }).catch(() => undefined)
    })
    return () => { subscription.remove(); sequence.current += 1; setEditingTime(null) }
  }, [load]))

  const change = <K extends keyof ReminderPreferences>(key: K, value: ReminderPreferences[K]) => {
    setForm((previous) => previous ? { ...previous, [key]: value } : previous)
  }

  const save = async () => {
    if (!form || savingRef.current) return
    if (form.enabled && !available && (!localSupported || form.log_enabled || form.expiry_enabled || form.private_message_enabled || form.analysis_completed_enabled)) { void dialog.alert('暂未启用', '远程服务尚未启用；本机三餐可单独开启，请先关闭其他远程提醒。'); return }
    savingRef.current = true
    setSaving(true)
    const seq = sequence.current
    try {
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      const result = await saveBusinessReminderSettings(form)
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      setForm(result.preferences)
      setSavedTimezone(result.preferences.timezone)
      const [permission, channel] = await Promise.all([hasNotificationPermission(), getReminderChannelStatus()])
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      setPermitted(permission)
      setChannelStatus(channel)
      const local = await localMealSnapshot()
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      setLocalStatus(local)
      void refreshLocalMealRecords().catch(() => undefined)
      void dialog.alert('已保存', !form.enabled ? '业务提醒已关闭。' : localSupported
        ? `${form.meal_enabled ? '三餐已交给手机定时，无需 VPN 或网络。' : '本机三餐已关闭。'}${local?.enabled && !local.exactAlarmAllowed ? '尚未允许准时提醒，系统可能延后；请在下方开启。' : ''}其他业务提醒使用远程通道，请查看下方状态。`
        : '远程提醒设置已保存；实际送达仍受网络与手机设置影响。', 'success')
      if (form.enabled && available && (form.log_enabled || form.expiry_enabled || form.private_message_enabled || form.analysis_completed_enabled)) {
        setRemoteStatus('远程设备注册尚未确认；不影响本机三餐')
        void enableReminderDevice().then(() => { if (seq === sequence.current) setRemoteStatus('远程设备已注册；不代表每条消息已送达') })
          .catch(() => { if (seq === sequence.current) setRemoteStatus('远程通道暂不可用；本机三餐不受影响，其他业务提醒可能收不到') })
      }
    } catch (cause) {
      if (seq === sequence.current) void dialog.alert('未完成设置', userFacingErrorMessage(cause), 'danger')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const toggles = [
    ['enabled', '开启消息提醒', '默认关闭；保存后才生效'],
    ['meal_enabled', '用餐与餐食建议', localSupported ? '手机本机定时，无需网络；本机已同步的用餐记录会跳过' : '早、中、晚餐；已记录该餐则跳过'],
    ['log_enabled', '当天漏记提醒', '远程提醒：当天没有饮食记录时提醒一次'],
    ['expiry_enabled', '临期食物提醒', '远程提醒：汇总未来两天内到期、尚未处理的食物'],
    ['private_message_enabled', '私信提醒', eventsSupported ? '默认关闭；开启后新收到的未读私信会提醒，不展示消息内容' : '需要更新后端后才能开启'],
    ['analysis_completed_enabled', '分析完成提醒', eventsSupported ? '默认关闭；开启后新提交的食物分析成功时提醒，点击查看分析历史' : '需要更新后端后才能开启'],
  ] as const

  // The editable timezone may be incomplete. Existing alarms use saved settings.
  const scheduledTime = (due: number) => {
    try { return new Date(due).toLocaleString('zh-CN', { timeZone: savedTimezone }) }
    catch { return `${new Date(due).toLocaleString('zh-CN')}（手机时间）` }
  }

  return <View style={[styles.page, { backgroundColor: palette.page }]}>
    {busy ? <View style={styles.center}><ActivityIndicator color={colors.brand} /></View> : !form ? <View style={styles.center}>
      <Text style={{ color: palette.muted }}>{error || '无法读取提醒设置'}</Text>
      <Pressable style={styles.button} onPress={() => void load()}><Text style={styles.buttonText}>重试</Text></Pressable>
    </View> : <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
      {!available ? <Text style={[styles.note, { color: palette.muted }]}>远程服务尚未启用。{localSupported ? '本机三餐仍可单独开启。' : '现有设置可关闭或修改。'}</Text> : null}
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        {toggles.map(([key, title, detail]) => <View key={key} style={styles.row}>
          <View style={styles.copy}><Text style={[styles.title, { color: palette.text }]}>{title}</Text><Text style={[styles.detail, { color: palette.muted }]}>{detail}</Text></View>
          <Switch accessibilityLabel={title} value={form[key] === true} disabled={saving || (!eventsSupported && (key === 'private_message_enabled' || key === 'analysis_completed_enabled')) || (key === 'enabled' && !available && !localSupported && !form.enabled)} onValueChange={(value) => change(key, value)} trackColor={{ false: palette.border, true: colors.brandSoft }} thumbColor={form[key] ? colors.brand : '#fff'} />
        </View>)}
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.text }]}>时间与免打扰</Text>
        <Text style={[styles.detail, { color: palette.muted }]}>点击时间选择小时和分钟，无需手动输入。提醒时间须在免打扰时段以外。</Text>
        {timeFields.map(([key, label]) => <View key={key} style={styles.row}>
          <Text style={[styles.copy, { color: palette.text }]}>{label}</Text>
          <Pressable accessibilityRole='button' accessibilityLabel={`${label}时间，${form[key]}`} accessibilityHint='打开时间选择器' accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => { Keyboard.dismiss(); setEditingTime({ key, label, value: form[key] }) }} style={[styles.time, { borderColor: palette.border }, saving && { opacity: 0.65 }]}>
            <Text style={[styles.timeValue, { color: palette.text }]}>{form[key]}</Text>
            <Text style={{ color: palette.muted }}>⌄</Text>
          </Pressable>
        </View>)}
        <Text style={[styles.detail, { color: palette.muted }]}>时区（例如 Asia/Shanghai）</Text>
        <TextInput accessibilityLabel='提醒时区' value={form.timezone} editable={!saving} onChangeText={(value) => change('timezone', value.trim())} maxLength={80} autoCorrect={false} autoCapitalize='none' style={[styles.zone, { color: palette.text, borderColor: palette.border }]} />
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.text }]}>手机通知状态</Text>
        {localSupported ? <>
          <Text style={[styles.note, { color: palette.muted }]}>本机三餐：{localStatus?.enabled ? `已安排 ${localStatus.next.length} 个餐次，每日重复` : '尚未开启'}。{localStatus?.exactAlarmAllowed ? '准时提醒已允许。' : '未允许准时提醒，锁屏省电时可能延后。'}</Text>
          {localStatus?.next.map(item => <Text key={item.meal} style={[styles.detail, { color: palette.muted }]}>{({ breakfast: '下次早餐', lunch: '下次午餐', dinner: '下次晚餐' } as Record<string, string>)[item.meal]}：{scheduledTime(item.due)}</Text>)}
          {!localStatus?.exactAlarmAllowed ? <Pressable accessibilityRole='button' style={styles.link} onPress={() => { void openExactAlarmSettings().catch(() => { void dialog.alert('无法打开设置', '请在系统设置 → 特殊应用权限 → 闹钟和提醒中允许食探。') }) }}><Text style={{ color: colors.brand }}>允许准时提醒</Text></Pressable> : null}
          <Text style={[styles.note, { color: palette.muted }]}>{remoteStatus}</Text>
        </> : null}
        <Pressable accessibilityRole='button' style={styles.link} onPress={() => navigation.navigate('NotificationDiagnostics')}><Text style={{ color: colors.brand }}>打开通知自检与诊断</Text></Pressable>
        <Text style={[styles.note, { color: palette.muted }]}>系统通知：{permitted ? '已允许' : '未允许'}。仅在开启提醒并点击保存时申请权限、注册本机。</Text>
        {channelStatus !== 'not-applicable' ? <Text style={[styles.note, { color: palette.muted }]}>{
          channelStatus === 'banner' ? '提醒通道已设为高优先级；顶部弹窗仍由手机系统和免打扰设置决定。'
            : channelStatus === 'standard' ? '提醒通道当前为普通通知，可能只出现在通知栏。要弹出提示，请在系统设置开启横幅或悬浮通知。'
              : channelStatus === 'blocked' ? '饮食与保质期提醒通道已被系统关闭，请在系统设置中开启。'
                : channelStatus === 'not-created' ? '本机尚未创建提醒通道；开启提醒并保存后配置。'
                  : '暂时无法读取提醒通道，请到系统设置检查横幅或悬浮通知。'
        }</Text> : null}
        <Pressable accessibilityRole='button' style={styles.link} onPress={() => { void openReminderNotificationSettings().catch(() => { void dialog.alert('无法打开设置', '请从手机设置中找到食探的通知权限。') }) }}><Text style={{ color: colors.brand }}>打开系统通知设置</Text></Pressable>
      </View>
      <Text style={[styles.note, { color: palette.muted }]}>{localSupported
        ? '本机三餐不依赖 Google 或 VPN；断网期间其他设备新增的记录须联网同步后才能跳过。强行停止应用、系统关闭通知或省电限制可能影响提醒。私信、分析完成、漏记和临期仍依赖远程通道。'
        : '当前使用远程提醒，需要设备注册及可连接的推送网络。通知权限开启不代表消息已经送达；网络和系统限制可能影响提醒。'}私信与分析完成提醒遵守免打扰；私信发送或分析任务提交超过24小时后不补发，请在站内查看完整记录。通知不展示私信内容或私人健康数据、不扣积分。</Text>
      <Pressable accessibilityRole='button' accessibilityLabel='保存消息提醒' disabled={saving} style={[styles.button, saving && { opacity: 0.65 }]} onPress={() => void save()}>
        {saving ? <ActivityIndicator color='#fff' /> : <Text style={styles.buttonText}>保存设置</Text>}
      </Pressable>
    </ScrollView>}
    {editingTime && form && !busy && !saving ? <ReminderTimePicker
      key={editingTime.key}
      label={editingTime.label}
      value={editingTime.value}
      onCancel={() => setEditingTime(null)}
      onConfirm={(value) => { change(editingTime.key, value); setEditingTime(null) }}
    /> : null}
  </View>
}

const styles = StyleSheet.create({
  page: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 },
  content: { padding: 18, gap: 16 }, card: { borderRadius: 18, padding: 16 }, row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  copy: { flex: 1 }, title: { fontSize: 16, fontWeight: '700' }, detail: { fontSize: 12, lineHeight: 19, marginTop: 5 },
  time: { minWidth: 108, minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', gap: 12, justifyContent: 'center', alignItems: 'center' },
  timeValue: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  zone: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, marginTop: 8 },
  note: { fontSize: 13, lineHeight: 21 }, link: { minHeight: 44, justifyContent: 'center' },
  button: { backgroundColor: colors.brand, minHeight: 48, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
