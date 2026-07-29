import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { EatingMood } from '@food-link/core'

const moodOptions: Array<{ value: EatingMood; emoji: string; label: string }> = [
  { value: 'happy', emoji: '😊', label: '开心' },
  { value: 'calm', emoji: '😌', label: '平静' },
  { value: 'stressed', emoji: '😣', label: '压力大' },
  { value: 'tired', emoji: '😮‍💨', label: '疲惫' },
  { value: 'bored', emoji: '😶', label: '无聊' },
  { value: 'treat', emoji: '✨', label: '犒劳自己' },
]

export function EatingMoodPicker({
  value,
  onChange,
}: {
  value: EatingMood | null
  onChange: (value: EatingMood | null) => void
}) {
  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.title}>此刻心情</Text>
        <Text style={styles.hint}>可选</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
        {moodOptions.map((option) => {
          const selected = value === option.value
          return (
            <Pressable
              key={option.value}
              accessibilityRole='button'
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.optionPressed,
              ]}
              onPress={() => onChange(selected ? null : option.value)}
            >
              <Text style={styles.emoji}>{option.emoji}</Text>
              <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dcf3e7',
    backgroundColor: '#f7fcf9',
    paddingVertical: 14,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  title: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '800',
  },
  hint: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  options: {
    gap: 8,
    paddingHorizontal: 14,
  },
  option: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  optionSelected: {
    borderColor: '#38c98d',
    backgroundColor: '#eafaf2',
  },
  optionPressed: {
    opacity: 0.75,
  },
  emoji: {
    fontSize: 16,
    lineHeight: 20,
  },
  label: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  labelSelected: {
    color: '#058b5e',
  },
})
