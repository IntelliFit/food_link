import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { getReminderChannelStatus, hasNotificationPermission, openReminderNotificationSettings } from '../utils/businessNotifications'
import {
  clearNotificationDiagnostics, diagnosticLabels, notificationDiagnosticReport, readNotificationDiagnostics,
  recordDiagnostic, scheduleLocalNotificationCheck, type NativeDiagnosticSnapshot,
} from '../diagnostics/notificationDiagnostics'
import { colors } from '../theme'

export function NotificationDiagnosticsScreen() {
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [snapshot, setSnapshot] = useState<NativeDiagnosticSnapshot | null>(null)
  const [permitted, setPermitted] = useState(false)
  const [channel, setChannel] = useState('unknown')
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState(false)
  const [error, setError] = useState('')
  const [localId, setLocalId] = useState('')
  const sequence = useRef(0)
  const actionRef = useRef(false)
  const palette = { page: isDark ? '#0d1312' : '#f8faf9', card: isDark ? '#181f1d' : '#fff',
    text: isDark ? '#f2f7f4' : '#17201d', muted: isDark ? '#a8b6b0' : '#64748b' }

  const refresh = useCallback(async () => {
    const seq = ++sequence.current
    setBusy(true)
    setError('')
    try {
      const [next, permission, status] = await Promise.all([readNotificationDiagnostics(), hasNotificationPermission(), getReminderChannelStatus()])
      if (seq !== sequence.current) return
      setSnapshot(next); setPermitted(permission); setChannel(status)
    } catch {
      if (seq === sequence.current) { setSnapshot(null); setError('无法读取诊断。请确认安装的是 Android 诊断包，或稍后重试。') }
    } finally { if (seq === sequence.current) setBusy(false) }
  }, [])

  useFocusEffect(useCallback(() => {
    void refresh()
    const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh() })
    return () => { sequence.current += 1; foreground.remove() }
  }, [refresh]))

  const runAction = async (work: () => Promise<void>) => {
    if (actionRef.current) return
    actionRef.current = true; setAction(true)
    try { await work() } catch (cause) {
      void dialog.alert('操作未完成', cause instanceof Error ? cause.message : '请稍后重试', 'danger')
    } finally { actionRef.current = false; setAction(false) }
  }
  const check = () => runAction(async () => {
    const id = await scheduleLocalNotificationCheck()
    setLocalId(id)
    await refresh()
    void dialog.alert('本地自检已安排', '已安排约 10 秒后触发，也可以现在锁屏。系统可能延后调度，请等候并返回刷新；“仍待触发”不等于显示失败。它不发送远程推送、不改提醒设置。')
  })
  const feedback = (seen: boolean) => runAction(async () => {
    await recordDiagnostic(seen ? 'local_seen' : 'local_not_seen', localId || 'local-feedback')
    await refresh()
    void dialog.alert('反馈已记在本机', seen ? '本地通知能显示；这不代表远程推送网络正常。' : '本地通知未看到。复制诊断后可继续检查系统通道、免打扰与调度状态。')
  })
  const lastRemote = snapshot?.events.filter((item) => ['fcm_received', 'foreground_received', 'opened'].includes(item.kind)).at(-1)
  const localScheduled = snapshot?.events.some((item) => item.kind === 'local_scheduled')
  const stamp = (at: number) => new Date(at).toLocaleString()
  const button = (label: string, onPress: () => void, disabled = false) => <Pressable
    accessibilityRole='button' accessibilityLabel={label} disabled={disabled || action || busy}
    onPress={onPress} style={[styles.button, (disabled || action || busy) && styles.disabled]}
  >
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>

  return <ScrollView style={{ flex: 1, backgroundColor: palette.page }} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <Text style={[styles.title, { color: palette.text }]}>通知自检与诊断</Text>
      <Text style={[styles.note, { color: palette.muted }]}>先查手机本地展示，再查远程收件。仅在你点按钮后产生一条本地测试通知，不会自动补发远程测试。</Text>
      {busy || action ? <ActivityIndicator color={colors.brand} /> : null}
      {error ? <Text style={[styles.note, { color: palette.muted }]}>{error}</Text> : null}
      {button('刷新诊断状态', () => void refresh())}
    </View>
    {snapshot ? <>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.text }]}>当前手机状态</Text>
        <Text style={[styles.note, { color: palette.text }]}>安装包 {snapshot.version}（{snapshot.versionCode}）{ '\n' }
          系统通知：{permitted ? '已允许' : '未允许'}{ '\n' }
          提醒通道：{{ banner: '高优先级', standard: '普通通知', blocked: '已关闭', 'not-created': '尚未创建', 'not-applicable': '不适用', unknown: '未知' }[channel] || '未知'}{ '\n' }
          Google Play 服务：{{ enabled: '已安装且启用', disabled: '已安装但停用', 'not-installed': '未检测到' }[snapshot.googleServices]}{ '\n' }
          当前网络：{snapshot.network.join(' / ') || '未检测到连接'}（系统互联网验证{snapshot.networkValidated ? '通过' : '未通过'}）{ '\n' }
          省电模式：{snapshot.powerSave ? '开启' : '关闭'}；设备休眠：{snapshot.deviceIdle ? '是' : '否'}{ '\n' }
          电池优化豁免：{snapshot.batteryExempt ? '是' : '否'}{ '\n' }
          精确闹钟调度：{snapshot.exactAlarmAllowed ? '可用' : '未允许（本地自检可能延后）'}{ '\n' }
          本地自检仍待触发：{snapshot.pendingLocalCheckCount ?? 0} 条{ '\n' }
          当前系统已发布的提醒：{snapshot.postedReminderCount} 条</Text>
        <Text style={[styles.note, { color: palette.muted }]}>服务启用、网络验证通过，都不代表谷歌推送连接正常。已发布条数是系统当前保留的提醒，不证明你看见；已清除的通知不会出现在此数量中。</Text>
        {button('打开系统通知设置', () => void runAction(openReminderNotificationSettings))}
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.text }]}>第一步：本地通知自检</Text>
        <Text style={[styles.note, { color: palette.muted }]}>沿用“饮食与保质期提醒”通道，不依赖 Google 或网络。安排约 10 秒后触发，系统省电或非精确调度可能延后；仍待触发不能算显示失败。返回此页刷新并记录实际结果。</Text>
        {button('10 秒后发一条本地通知', () => void check())}
        {button('我看到了本地通知', () => void feedback(true), !localScheduled)}
        {button('我没看到本地通知', () => void feedback(false), !localScheduled)}
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.text }]}>第二步：远程收件记录</Text>
        <Text style={[styles.note, { color: palette.text }]}>{lastRemote ? `最近本机观察：${stamp(lastRemote.at)}，${diagnosticLabels[lastRemote.kind]}` : '尚无远程收件记录；不能据此断言消息从未到达。'}</Text>
        <Text style={[styles.note, { color: palette.muted }]}>仅记录安装诊断包后的消息。后台原生接收、前台处理及点击分开记录；FCM 通知型消息的后台自动展示可能绕过接收回调。转交 Expo 成功也不等于通知已经显示。</Text>
        {snapshot.events.slice(-15).reverse().map((entry, index) => <View key={`${entry.at}-${entry.kind}-${index}`} style={styles.event}>
          <Text style={{ color: palette.text }}>{diagnosticLabels[entry.kind] || '通知事件'}</Text>
          <Text style={[styles.meta, { color: palette.muted }]}>{stamp(entry.at)} · {entry.state}{entry.code ? ' · ' + entry.code : ''} · {entry.id}</Text>
        </View>)}
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.text }]}>复制给开发者定位</Text>
        <Text style={[styles.note, { color: palette.muted }]}>最近 7 天最多 50 条元数据，仅保存在本机。不记录通知正文、健康数据、token 或账号原文；退出或切换账号会清除。复制后由你决定发给谁。</Text>
        {button('复制通知诊断', () => void runAction(async () => {
          const [latest, permission, status] = await Promise.all([readNotificationDiagnostics(), hasNotificationPermission(), getReminderChannelStatus()])
          await Clipboard.setStringAsync(notificationDiagnosticReport(latest, permission, status))
          void dialog.alert('已复制', '可粘贴到当前对话。没有上传到后端。', 'success')
        }))}
        {button('清除本机诊断记录', () => void runAction(async () => { await clearNotificationDiagnostics(); setLocalId(''); await refresh() }))}
      </View>
    </> : null}
  </ScrollView>
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16 }, card: { borderRadius: 18, padding: 16, gap: 12 },
  title: { fontSize: 16, fontWeight: '700' }, note: { fontSize: 13, lineHeight: 22 },
  button: { backgroundColor: colors.brand, minHeight: 48, borderRadius: 12, padding: 12, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' }, disabled: { opacity: 0.5 },
  event: { gap: 4, paddingVertical: 5 }, meta: { fontSize: 11, lineHeight: 17 },
})
