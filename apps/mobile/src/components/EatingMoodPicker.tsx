import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { BatteryLow, CloudLightning, CloudSun, Meh, Smile, Sparkles, type LucideIcon } from 'lucide-react-native'
import type { EatingMood } from '@food-link/core'
import { useColorScheme } from '../providers/ColorSchemeProvider'

const moodOptions: Array<{ value: EatingMood; label: string; Icon: LucideIcon }> = [
  { value: 'happy', label: '开心', Icon: Smile },
  { value: 'calm', label: '平静', Icon: CloudSun },
  { value: 'stressed', label: '压力大', Icon: CloudLightning },
  { value: 'tired', label: '疲惫', Icon: BatteryLow },
  { value: 'bored', label: '无聊', Icon: Meh },
  { value: 'treat', label: '犒劳自己', Icon: Sparkles },
]

export function EatingMoodPicker({
  value,
  onChange,
}: {
  value: EatingMood | null
  onChange: (value: EatingMood | null) => void
}) {
  const { isDark } = useColorScheme()
  const palette = useMemo(() => createMoodPalette(isDark), [isDark])
  const styles = useMemo(() => createMoodStyles(palette), [palette])

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.title}>此刻心情</Text>
        <Text style={styles.hint}>可选</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
        {moodOptions.map((option) => {
          const selected = value === option.value
          const Icon = option.Icon
          return (
            <Pressable
              key={option.value}
              accessibilityRole='radio'
              accessibilityLabel={'此刻心情：' + option.label}
              accessibilityHint={selected ? '双击取消选择' : '双击选择'}
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.optionPressed,
              ]}
              onPress={() => onChange(selected ? null : option.value)}
            >
              <Icon size={18} color={selected ? palette.brand : palette.textSecondary} strokeWidth={2.2} />
              <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

type MoodPalette = {
  card: string
  surface: string
  border: string
  text: string
  textSecondary: string
  textMuted: string
  brand: string
  brandSoft: string
  brandBorder: string
}

function createMoodPalette(isDark: boolean): MoodPalette {
  return isDark
    ? {
        card: '#151b19', surface: '#202927', border: 'rgba(255,255,255,0.12)',
        text: '#f3f7f5', textSecondary: '#a9b7b1', textMuted: '#7f918a',
        brand: '#7dd3b0', brandSoft: '#18332a', brandBorder: 'rgba(125,211,176,0.32)',
      }
    : {
        card: '#f7fcf9', surface: '#ffffff', border: '#dcf3e7',
        text: '#1f2937', textSecondary: '#475569', textMuted: '#64748b',
        brand: '#058b5e', brandSoft: '#eafaf2', brandBorder: '#38c98d',
      }
}

function createMoodStyles(palette: MoodPalette) {
  return StyleSheet.create({
    card: {
      overflow: 'hidden', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border, backgroundColor: palette.card, paddingVertical: 14,
    },
    heading: {
      minHeight: 32, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
      paddingHorizontal: 14, marginBottom: 8,
    },
    title: { color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
    hint: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    options: { gap: 8, paddingHorizontal: 14 },
    option: {
      minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13,
      borderRadius: 22, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface,
    },
    optionSelected: { borderColor: palette.brandBorder, backgroundColor: palette.brandSoft },
    optionPressed: { opacity: 0.7 },
    label: { color: palette.textSecondary, fontSize: 12, fontWeight: '700' },
    labelSelected: { color: palette.brand, fontWeight: '900' },
  })
}