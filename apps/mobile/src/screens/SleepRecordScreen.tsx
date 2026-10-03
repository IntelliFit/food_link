import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { SleepQuality, SleepRecord } from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import type { RootStackParamList } from '../navigation/types'
import { buildSleepInput, shiftSleepDate, sleepToday, sleepLocalParts, sleepDurationLabel, SLEEP_QUALITIES, validSleepDate } from '../utils/sleepRecord'
import { userFacingErrorMessage } from '../utils/errors'
import { colors } from '../theme'

export function SleepCard({ date }: { date: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { isDark } = useColorScheme()
  const [record, setRecord] = useState<SleepRecord | null>(null)
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  useFocusEffect(useCallback(() => {
    let active = true
    setBusy(true)
    setFailed(false)
    setRecord(null)
    void getStoredUserId().then(async (owner) => {
      const value = await apiClient.getSleepRecord(date)
      if (active && owner === await getStoredUserId()) setRecord(value)
    }).catch(() => { if (active) setFailed(true) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [date]))
  return <Pressable accessibilityRole="button" accessibilityLabel="查看或记录睡眠" style={[styles.card, { backgroundColor: isDark ? '#181f1d' : '#fff' }]} onPress={() => navigation.navigate('SleepRecord', { date })}>
    <Text style={[styles.title, { color: isDark ? '#f2f7f4' : '#17201d' }]}>昨晚睡得怎么样</Text>
    {busy ? <ActivityIndicator color={colors.brand} /> : <Text style={[styles.note, { color: isDark ? '#a8b6b0' : '#64748b' }]}>{failed ? '记录读取失败，点击重试' : record ? `入睡到起床约 ${sleepDurationLabel(record.duration_minutes)} · 点击修改` : '未记录 · 点击记下睡眠'}</Text>}
  </Pressable>
}

export function SleepRecordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'SleepRecord'>>()
  const { isDark } = useColorScheme()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const [date, setDate] = useState(() => route.params?.date && validSleepDate(route.params.date) ? route.params.date : sleepToday())
  const [record, setRecord] = useState<SleepRecord | null>(null)
  const [bedDate, setBedDate] = useState(() => shiftSleepDate(date, -1))
  const [bedTime, setBedTime] = useState('23:00')
  const [wakeTime, setWakeTime] = useState('07:00')
  const [quality, setQuality] = useState<SleepQuality>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const owner = useRef<string | null>(null)
  const savingRef = useRef(false)
  const palette = { page: isDark ? '#0d1312' : '#f8faf9', card: isDark ? '#181f1d' : '#fff', text: isDark ? '#f2f7f4' : '#17201d', muted: isDark ? '#a8b6b0' : '#64748b' }
  const load = useCallback(async () => {
    const seq = ++sequence.current
    setBusy(true); setError(''); setRecord(null)
    try {
      const currentOwner = await getStoredUserId()
      const value = await apiClient.getSleepRecord(date)
      if (seq !== sequence.current || currentOwner !== await getStoredUserId()) return
      owner.current = currentOwner
      setRecord(value)
      setBedDate(value ? sleepLocalParts(value.bedtime).date : shiftSleepDate(date, -1))
      setBedTime(value ? sleepLocalParts(value.bedtime).time : '23:00')
      setWakeTime(value ? sleepLocalParts(value.wake_time).time : '07:00')
      setQuality(value?.quality || ''); setNote(value?.note || '')
    } catch (cause) { if (seq === sequence.current) setError(userFacingErrorMessage(cause)) }
    finally { if (seq === sequence.current) setBusy(false) }
  }, [date])
  useFocusEffect(useCallback(() => { void load(); return () => { sequence.current += 1 } }, [load]))
  const mutate = async (remove = false) => {
    if (savingRef.current || busy || error) return
    const seq = sequence.current
    savingRef.current = true; setSaving(true)
    try {
      if (remove && !await dialog.confirm({ title: '删除这天的睡眠记录？', message: '只删除这一日的睡眠记录。', kind: 'danger', confirmText: '删除' })) return
      if (seq !== sequence.current || owner.current !== await getStoredUserId()) return
      if (remove) { await apiClient.deleteSleepRecord(date); if (seq === sequence.current) await load() }
      else {
        const input = buildSleepInput(date, bedDate, bedTime, wakeTime, quality, note)
        const value = await apiClient.saveSleepRecord(date, input)
        if (seq === sequence.current && owner.current === await getStoredUserId()) { setRecord(value); void dialog.alert('已保存', '睡眠记录已与小程序共用数据同步。', 'success') }
      }
    } catch (cause) { if (seq === sequence.current) void dialog.alert(remove ? '删除失败' : '未保存', userFacingErrorMessage(cause), 'danger') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const minutes = (Date.parse(`${date}T${wakeTime}:00+08:00`) - Date.parse(`${bedDate}T${bedTime}:00+08:00`)) / 60000
  return <ScrollView style={{ backgroundColor: palette.page }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
    <Text style={[styles.title, { color: palette.text }]}>按起床当天记录 · {date}</Text>
    <View style={styles.row}><Pressable style={styles.choice} disabled={saving || date <= '1900-01-02'} onPress={() => setDate(shiftSleepDate(date, -1))}><Text style={{ color: colors.brand }}>前一天</Text></Pressable><Pressable style={styles.choice} disabled={saving || date >= sleepToday()} onPress={() => setDate(shiftSleepDate(date, 1))}><Text style={{ color: date >= sleepToday() ? palette.muted : colors.brand }}>后一天</Text></Pressable></View>
    {busy ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.brand} /> : error ? <Pressable style={styles.card} onPress={() => void load()}><Text style={{ color: palette.muted }}>{error} · 点击重试</Text></Pressable> : <>
      <View style={[styles.card, { backgroundColor: palette.card }]}><Text style={[styles.title, { color: palette.text }]}>入睡日期</Text><View style={styles.row}>{[shiftSleepDate(date, -1), date].map((value) => <Pressable key={value} disabled={saving} style={styles.choice} onPress={() => setBedDate(value)}><Text style={{ color: bedDate === value ? colors.brand : palette.muted }}>{value}</Text></Pressable>)}</View>
        <Text style={[styles.note, { color: palette.muted }]}>夜里零点后睡着，选择起床当天。</Text>
        {([['大约几点睡着', bedTime, setBedTime], ['起床时间', wakeTime, setWakeTime]] as const).map(([label, value, change]) => <View key={label} style={styles.row}><Text style={{ color: palette.text, flex: 1 }}>{label}</Text><TextInput accessibilityLabel={label} value={value} editable={!saving} onChangeText={change} maxLength={5} style={[styles.input, { color: palette.text }]} /></View>)}
        <Text style={[styles.note, { color: palette.muted }]}>{minutes > 0 && minutes <= 1440 ? `入睡到起床约 ${sleepDurationLabel(minutes)}，包含夜间醒来的时间。` : '请核对入睡日期与时间。'}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}><Text style={[styles.title, { color: palette.text }]}>睡得如何（选填）</Text><View style={styles.row}>{SLEEP_QUALITIES.map((item) => <Pressable key={item.value} disabled={saving} style={styles.choice} onPress={() => setQuality(item.value)}><Text style={{ color: quality === item.value ? colors.brand : palette.muted }}>{item.label}</Text></Pressable>)}</View><TextInput accessibilityLabel="睡眠补充说明" value={note} editable={!saving} onChangeText={setNote} maxLength={500} multiline placeholder="补充说明（选填）" placeholderTextColor={palette.muted} style={[styles.notesInput, { color: palette.text }]} /></View>
      <Pressable accessibilityRole="button" disabled={saving} style={styles.button} onPress={() => void mutate()}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>保存睡眠记录</Text>}</Pressable>
      {record ? <Pressable disabled={saving} style={styles.choice} onPress={() => void mutate(true)}><Text style={{ color: '#b45309' }}>删除这天的记录</Text></Pressable> : null}
    </>}
  </ScrollView>
}
const styles = StyleSheet.create({ card: { borderRadius: 16, padding: 16, marginVertical: 10 }, title: { fontSize: 17, fontWeight: '700', lineHeight: 25 }, note: { fontSize: 13, lineHeight: 21, marginTop: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }, choice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, input: { minWidth: 88, minHeight: 44, borderWidth: 1, borderColor: '#a8b6b0', borderRadius: 10, textAlign: 'center', fontSize: 16 }, notesInput: { minHeight: 100, marginTop: 12, textAlignVertical: 'top' }, button: { minHeight: 48, backgroundColor: colors.brand, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginVertical: 16 } })
