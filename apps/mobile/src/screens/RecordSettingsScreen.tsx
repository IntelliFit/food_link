import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'
import { readAutoRecordPreference, writeAutoRecordPreference } from '../utils/autoRecordPreference'
import { userFacingErrorMessage } from '../utils/errors'

export function RecordSettingsScreen() {
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const palette = {
    page: isDark ? '#0d1312' : '#f8faf9',
    card: isDark ? '#181f1d' : '#ffffff',
    text: isDark ? '#f2f7f4' : '#17201d',
    muted: isDark ? '#a8b6b0' : '#64748b',
    border: isDark ? 'rgba(255,255,255,0.08)' : '#e6ece9',
    note: isDark ? '#15231e' : '#effaf5',
  }

  useEffect(() => {
    let active = true
    void readAutoRecordPreference().then((value) => {
      if (active) setEnabled(value)
    }).catch((error) => {
      if (active) void dialog.alert('读取设置失败', userFacingErrorMessage(error), 'danger')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [dialog])

  const updatePreference = async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    setSaving(true)
    try {
      await writeAutoRecordPreference(next)
    } catch (error) {
      setEnabled(previous)
      void dialog.alert('保存设置失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={[styles.page, { backgroundColor: palette.page }]}>
      {loading ? (
        <View style={styles.loading} accessibilityLabel="正在读取记录设置">
          <ActivityIndicator size="small" color={colors.brand} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 32, 48) }]}>
          <View style={[styles.settingCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={styles.settingCopy}>
              <Text style={[styles.settingTitle, { color: palette.text }]}>识别完成后自动记录</Text>
              <Text style={[styles.settingDescription, { color: palette.muted }]}>拍照或文字识别提交后，按拍摄时选择的餐次自动写入饮食记录。</Text>
            </View>
            <View style={styles.switchWrap}>
              {saving ? <ActivityIndicator size="small" color={colors.brand} style={styles.savingSpinner} /> : null}
              <Switch
                accessibilityLabel="识别完成后自动记录"
                value={enabled}
                disabled={saving}
                onValueChange={(value) => void updatePreference(value)}
                trackColor={{ false: isDark ? '#39443f' : '#cbd5e1', true: colors.brandSoft }}
                thumbColor={enabled ? colors.brand : '#ffffff'}
              />
            </View>
          </View>

          <View style={[styles.noteCard, { backgroundColor: palette.note, borderColor: isDark ? 'rgba(110,231,183,0.16)' : '#d6f2e5' }]}>
            <Text style={[styles.noteTitle, { color: isDark ? '#7ee2b4' : '#17734d' }]}>自动记录说明</Text>
            <Text style={[styles.noteText, { color: palette.muted }]}>需要补拍、选择包装规格、识别失败或内容违规时不会自动记录，小宠物仍会提醒你处理。</Text>
          </View>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 18, paddingTop: 20 },
  settingCard: { minHeight: 116, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center' },
  settingCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  settingTitle: { fontSize: 16, lineHeight: 23, fontWeight: '800' },
  settingDescription: { marginTop: 6, fontSize: 13, lineHeight: 20 },
  switchWrap: { minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  savingSpinner: { position: 'absolute', top: -10 },
  noteCard: { marginTop: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  noteTitle: { fontSize: 13, lineHeight: 19, fontWeight: '800' },
  noteText: { marginTop: 5, fontSize: 13, lineHeight: 20 },
})
