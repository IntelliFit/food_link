import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColorScheme } from '../providers/ColorSchemeProvider'

const hours = Array.from({ length: 24 }, (_, index) => index)
const minutes = Array.from({ length: 60 }, (_, index) => index)
const pad = (value: number) => String(value).padStart(2, '0')
const rowHeight = 56

/** Mounted only while editing: cancel/back never changes the saved form value. */
export function ReminderTimePicker({ label, value, onCancel, onConfirm }: {
  label: string
  value: string
  onCancel: () => void
  onConfirm: (value: string) => void
}) {
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const initial = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  const [hour, setHour] = useState(() => Number(initial?.[1] ?? 8))
  const [minute, setMinute] = useState(() => Number(initial?.[2] ?? 0))
  const palette = {
    card: isDark ? '#181f1d' : '#fff', surface: isDark ? '#222d27' : '#f4f8f6',
    text: isDark ? '#f2f7f4' : '#17201d', muted: isDark ? '#a8b6b0' : '#64748b',
    selected: isDark ? '#174834' : '#def7eb', brand: isDark ? '#7dd3b0' : '#008659',
  }
  const time = `${pad(hour)}:${pad(minute)}`

  return <Modal transparent animationType='slide' onRequestClose={onCancel} statusBarTranslucent>
    <View style={styles.overlay}>
      <Pressable accessibilityRole='button' accessibilityLabel='取消选择时间' style={StyleSheet.absoluteFill} onPress={onCancel} />
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: palette.card, paddingBottom: Math.max(insets.bottom, 16), maxHeight: '90%' }]}>
        <Text accessibilityRole='header' style={[styles.title, { color: palette.text }]}>{label}时间</Text>
        <Text style={[styles.preview, { color: palette.brand }]} accessibilityLiveRegion='polite'>{time}</Text>
        <Text style={[styles.hint, { color: palette.muted }]}>24 小时制 · 滚动并点选小时、分钟</Text>
        <View style={styles.columns}>
          {([
            { label: '小时', values: hours, value: hour, initial: Number(initial?.[1] ?? 8), select: setHour },
            { label: '分钟', values: minutes, value: minute, initial: Number(initial?.[2] ?? 0), select: setMinute },
          ] as const).map((column) => <View key={column.label} style={styles.column}>
            <Text style={[styles.columnTitle, { color: palette.muted }]}>{column.label}</Text>
            <ScrollView
              style={[styles.choices, { backgroundColor: palette.surface }]}
              contentOffset={{ x: 0, y: Math.max(0, column.initial - 1) * rowHeight }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps='handled'
            >
              {column.values.map((option) => <Pressable
                key={option}
                accessibilityRole='radio'
                accessibilityLabel={`${pad(option)}${column.label === '小时' ? '时' : '分'}`}
                accessibilityState={{ checked: column.value === option }}
                style={[styles.choice, column.value === option && { backgroundColor: palette.selected }]}
                onPress={() => column.select(option)}
              >
                <Text maxFontSizeMultiplier={1.5} style={[styles.choiceText, { color: column.value === option ? palette.brand : palette.text }, column.value === option && styles.selectedText]}>{pad(option)}</Text>
              </Pressable>)}
            </ScrollView>
          </View>)}
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole='button' style={[styles.button, { backgroundColor: palette.surface }]} onPress={onCancel}>
            <Text style={[styles.buttonText, { color: palette.text }]}>取消</Text>
          </Pressable>
          <Pressable accessibilityRole='button' accessibilityLabel={`确认${label}时间`} style={[styles.button, { backgroundColor: palette.brand }]} onPress={() => onConfirm(time)}>
            <Text style={[styles.buttonText, { color: isDark ? '#17201d' : '#fff' }]}>确认</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  preview: { fontSize: 32, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, textAlign: 'center', lineHeight: 20 },
  columns: { flexDirection: 'row', gap: 16 }, column: { flex: 1, gap: 8 },
  columnTitle: { fontSize: 14, textAlign: 'center' },
  choices: { height: rowHeight * 4, borderRadius: 14 },
  choice: { height: rowHeight, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  choiceText: { fontSize: 22, fontVariant: ['tabular-nums'] }, selectedText: { fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  button: { flex: 1, minHeight: 48, borderRadius: 14, padding: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
})
