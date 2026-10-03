import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DiningLocationItem, DiningLocationSiteItem } from '@food-link/api-client'
import { apiClient, getStoredUserId } from '../api'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'
import { colors } from '../theme'

/** Same profile fields/catalog as WeChat; identity does not grant campus access. */
export function CampusDiningSettingsScreen() {
  const { isDark } = useColorScheme()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const [student, setStudent] = useState<boolean | null>(null)
  const [school, setSchool] = useState<DiningLocationItem | null>(null)
  const [campus, setCampus] = useState<DiningLocationSiteItem | null>(null)
  const [keyword, setKeyword] = useState('')
  const [schools, setSchools] = useState<DiningLocationItem[]>([])
  const [campuses, setCampuses] = useState<DiningLocationSiteItem[]>([])
  const [busy, setBusy] = useState(true)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const searchSequence = useRef(0)
  const campusSequence = useRef(0)
  const owner = useRef<string | null>(null)
  const savingRef = useRef(false)
  const palette = { page: isDark ? '#0d1312' : '#f8faf9', card: isDark ? '#181f1d' : '#fff', text: isDark ? '#f2f7f4' : '#17201d', muted: isDark ? '#a8b6b0' : '#64748b' }

  const load = useCallback(async () => {
    const seq = ++epoch.current
    setBusy(true)
    setError('')
    owner.current = null
    try {
      const currentOwner = await getStoredUserId()
      const profile = await apiClient.getHealthProfile()
      if (seq !== epoch.current || currentOwner !== await getStoredUserId()) return
      owner.current = currentOwner
      const condition = profile.health_condition
      setStudent(typeof condition?.is_student === 'boolean' ? condition.is_student : null)
      const preference = condition?.campus_dining_preference as { school_id?: string; school_name?: string; campus_id?: string; campus_name?: string } | undefined
      setSchool(preference?.school_id ? { id: preference.school_id, name: preference.school_name || '已选学校', location_type: 'university' } : null)
      setCampus(preference?.school_id && preference.campus_id ? { id: preference.campus_id, name: preference.campus_name || '已选校区', school_id: preference.school_id } : null)
    } catch (cause) {
      if (seq === epoch.current) setError(userFacingErrorMessage(cause))
    } finally {
      if (seq === epoch.current) setBusy(false)
    }
  }, [])
  useFocusEffect(useCallback(() => { void load(); return () => { epoch.current += 1; searchSequence.current += 1; campusSequence.current += 1 } }, [load]))

  const search = async () => {
    if (keyword.trim().length < 2) { setError('请输入至少两个字的学校名称'); return }
    const seq = ++searchSequence.current
    const currentEpoch = epoch.current
    setSearching(true)
    setError('')
    try {
      const result = await apiClient.searchDiningLocations({ keyword: keyword.trim(), type: 'university', limit: 20 })
      if (seq === searchSequence.current && currentEpoch === epoch.current && owner.current === await getStoredUserId()) {
        setSchools(result)
        if (!result.length) setError('未找到学校，请核对名称后重试。')
      }
    } catch (cause) { if (seq === searchSequence.current && currentEpoch === epoch.current) setError(userFacingErrorMessage(cause)) }
    finally { if (seq === searchSequence.current && currentEpoch === epoch.current) setSearching(false) }
  }
  const selectSchool = async (value: DiningLocationItem) => {
    setSchool(value)
    setCampus(null)
    setCampuses([])
    const seq = ++campusSequence.current
    const currentEpoch = epoch.current
    try {
      const result = await apiClient.getDiningLocationSites(value.id)
      if (seq === campusSequence.current && currentEpoch === epoch.current && owner.current === await getStoredUserId()) setCampuses(result)
    } catch { if (seq === campusSequence.current && currentEpoch === epoch.current) setError('校区读取失败，可保存学校偏好后重试。') }
  }
  const save = async () => {
    if (savingRef.current || student == null) return
    if (student && !school) { setError('请选择学校后保存'); return }
    const seq = epoch.current
    savingRef.current = true
    setSaving(true)
    try {
      if (owner.current !== await getStoredUserId()) return
      await apiClient.updateHealthProfile({ is_student: student, campus_dining_preference: student ? { school_id: school!.id, campus_id: campus?.id || '' } : { school_id: '' } })
      if (seq !== epoch.current || owner.current !== await getStoredUserId()) return
      void dialog.alert('已保存', '就餐偏好已与小程序共用的健康档案同步。', 'success')
    } catch (cause) { if (seq === epoch.current) setError(userFacingErrorMessage(cause)) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <ScrollView style={{ backgroundColor: palette.page }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
    {busy ? <ActivityIndicator style={{ marginTop: 50 }} color={colors.brand} /> : <>
      <Text style={[styles.heading, { color: palette.text }]}>你目前是学生吗？</Text>
      <View style={styles.options}>{([true, false] as const).map((value) => <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected: student === value }} disabled={saving || !owner.current} style={[styles.choice, { backgroundColor: student === value ? colors.brand : palette.card }]} onPress={() => { setStudent(value); setError('') }}><Text style={{ color: student === value ? '#fff' : palette.text }}>{value ? '是学生' : '非学生'}</Text></Pressable>)}</View>
      {student ? <View style={[styles.card, { backgroundColor: palette.card }]}>
        <Text style={[styles.heading, { color: palette.text }]}>学校与校区</Text>
        <Text style={[styles.note, { color: palette.muted }]}>当前：{school?.name || '未选择'}{campus ? ` · ${campus.name}` : ''}</Text>
        <TextInput accessibilityLabel="学校名称" value={keyword} editable={!saving} onChangeText={setKeyword} placeholder="输入学校名称" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.text }]} maxLength={80} onSubmitEditing={() => void search()} />
        <Pressable accessibilityRole="button" disabled={searching || saving} style={styles.button} onPress={() => void search()}>{searching ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>搜索学校</Text>}</Pressable>
        {schools.map((value) => <Pressable key={value.id} style={styles.listRow} disabled={saving} accessibilityRole="button" onPress={() => void selectSchool(value)}><Text style={{ color: school?.id === value.id ? colors.brand : palette.text }}>{value.name}</Text><Text style={[styles.note, { color: palette.muted }]}>{[value.province, value.city].filter(Boolean).join(' · ')}</Text></Pressable>)}
        {campuses.map((value) => <Pressable key={value.id} style={styles.listRow} disabled={saving} accessibilityRole="button" onPress={() => setCampus(value)}><Text style={{ color: campus?.id === value.id ? colors.brand : palette.text }}>{value.name}</Text></Pressable>)}
      </View> : null}
      <Text style={[styles.note, { color: palette.muted }]}>身份与就餐偏好只用于相关餐食检索，不代表你拥有某校园的入校或就餐资格。非学生选项不会自动推荐仅限校内的食堂。</Text>
      {!!error && <Text style={[styles.note, { color: '#b45309' }]}>{error}</Text>}
      {!owner.current ? <Pressable style={styles.button} onPress={() => void load()}><Text style={{ color: '#fff' }}>重试</Text></Pressable> : <Pressable accessibilityRole="button" disabled={saving || student == null} style={[styles.button, (saving || student == null) && { opacity: 0.5 }]} onPress={() => void save()}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff' }}>保存就餐偏好</Text>}</Pressable>}
    </>}
  </ScrollView>
}
const styles = StyleSheet.create({ heading: { fontSize: 17, fontWeight: '700', marginBottom: 12 }, options: { flexDirection: 'row', gap: 14 }, choice: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, card: { borderRadius: 16, padding: 16, marginTop: 18 }, note: { fontSize: 13, lineHeight: 21, marginTop: 12 }, input: { minHeight: 48, borderWidth: 1, borderColor: '#a8b6b0', borderRadius: 10, paddingHorizontal: 12, marginTop: 16 }, button: { minHeight: 48, backgroundColor: colors.brand, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, listRow: { minHeight: 48, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#a8b6b0' } })
