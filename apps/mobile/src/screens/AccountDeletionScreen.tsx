import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ACCOUNT_DELETION_COPY as copy, formatDeletionTime, type AccountDeletionStatus } from '@food-link/core'
import { apiClient } from '../api'
import { useAuth } from '../providers/AuthProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'

export function AccountDeletionScreen() {
  const { refreshAccountStatus, accountStatusError, logout } = useAuth()
  const { isDark } = useColorScheme()
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null)
  const [days, setDays] = useState<0 | 7>(7)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const load = async () => {
    try { setFailed(false); setStatus(await apiClient.getAccountDeletionStatus()) }
    catch { setFailed(true) }
  }
  useEffect(() => { void load() }, [])
  const request = async () => {
    if (busy || confirmation.trim() !== '注销账号') return
    setBusy(true)
    try { const result = await apiClient.deleteAccount(days); setStatus(result.status); await refreshAccountStatus() }
    catch (error) { Alert.alert('申请失败', error instanceof Error ? error.message : '请稍后重试') }
    finally { setBusy(false) }
  }
  const confirmRequest = () => {
    if (days === 7) { void request(); return }
    Alert.alert('跳过冷静期？', '确认后即进入永久清理，无法撤销。', [{ text: '返回', style: 'cancel' }, { text: '立即注销', style: 'destructive', onPress: () => { void request() } }])
  }
  const cancel = () => Alert.alert('撤销注销并恢复账号？', '原有记录将保留，恢复后请重新登录。', [
    { text: '返回', style: 'cancel' },
    { text: '撤销注销', onPress: () => { void (async () => {
      setBusy(true)
      try { await apiClient.cancelAccountDeletion(); await logout() }
      catch (error) { Alert.alert('撤销失败', error instanceof Error ? error.message : '请重试'); await load() }
      finally { setBusy(false) }
    })() } },
  ])
  const active = status?.state === 'active' || status?.state === 'cancelled'
  const text = { color: isDark ? '#eef5f1' : '#1f2937' }
  const button = (label: string, action: () => void, danger = false, disabled = false) => <Pressable accessibilityRole='button' accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={[styles.button, danger && styles.danger, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>
  return <ScrollView contentContainerStyle={[styles.page, { backgroundColor: isDark ? '#0d1312' : '#f7f8fa' }]} keyboardShouldPersistTaps='handled'>
    <Text style={[styles.title, text]}>{!status || active ? copy.title : status.state === 'completed' ? copy.completed : status.state === 'cleaning' ? copy.cleaning : copy.pending}</Text>
    {failed || accountStatusError ? <View><Text style={text}>暂时无法读取注销状态</Text>{button('重试', () => { void load(); void refreshAccountStatus() })}</View> : !status ? <ActivityIndicator color='#008d60' /> : active ? <>
      <Text style={[styles.paragraph, text]}>{copy.warning}</Text><Text style={[styles.paragraph, text]}>{copy.rights}</Text>
      {[7, 0].map(value => <Pressable key={value} accessibilityRole='radio' accessibilityState={{ checked: days === value }} onPress={() => setDays(value as 0 | 7)} style={[styles.choice, days === value && styles.selected]}><Text style={text}>{days === value ? '● ' : '○ '}{value === 7 ? copy.cooling : copy.immediate}</Text></Pressable>)}
      <Text style={[styles.paragraph, text]}>{days === 7 ? copy.note : '确认后无法撤销，请先保存需要的记录。'}</Text>
      <TextInput accessibilityLabel='输入注销账号确认' style={[styles.input, text]} placeholder='输入“注销账号”确认' placeholderTextColor='#89958f' value={confirmation} onChangeText={setConfirmation} />
      {busy ? <ActivityIndicator color='#008d60' /> : button(days === 7 ? '申请注销，保留 7 天撤销机会' : '确认立即注销', confirmRequest, true, confirmation.trim() !== '注销账号')}
    </> : <>
      {status.state === 'pending' && <><Text style={[styles.paragraph, text]}>永久清理时间：{formatDeletionTime(status.execute_at)}</Text><Text style={[styles.paragraph, text]}>{copy.note}</Text></>}
      {status.state === 'cleaning' && <Text style={[styles.paragraph, text]}>账号已停用，数据清理完成前将保持此状态。此时无法撤销。</Text>}
      {status.state === 'completed' && <Text style={[styles.paragraph, text]}>个人记录已清理，原账号无法恢复。必要凭证与共享资料按规则单独处理。</Text>}
      {status.can_cancel && button('撤销注销并恢复账号', cancel, false, busy)}
      {button('刷新状态', () => { void load() }, false, busy)}
    </>}
    {!active && button('退出登录', () => { void logout() }, false, busy)}
  </ScrollView>
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 24, paddingTop: 58, gap: 16 },
  title: { fontSize: 25, fontWeight: '600', marginBottom: 12 },
  paragraph: { fontSize: 15, lineHeight: 25 },
  choice: { borderWidth: 1, borderColor: '#91a79b', borderRadius: 14, padding: 18 },
  selected: { borderColor: '#00a86b', borderWidth: 2 },
  input: { borderWidth: 1, borderColor: '#91a79b', borderRadius: 12, padding: 16, fontSize: 16 },
  button: { backgroundColor: '#008d60', padding: 16, borderRadius: 12, alignItems: 'center' },
  danger: { backgroundColor: '#c93434' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
