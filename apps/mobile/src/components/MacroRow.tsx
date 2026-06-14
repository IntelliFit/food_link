import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

interface MacroRowProps {
  label: string
  value?: number
  target?: number
  unit?: string
}

export function MacroRow({ label, value, target, unit = 'g' }: MacroRowProps) {
  const current = Math.round(value || 0)
  const goal = Math.round(target || 0)
  const progress = goal > 0 ? Math.min(current / goal, 1) : 0
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{current} / {goal} {unit}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: colors.textSecondary,
  },
  value: {
    color: colors.text,
    fontWeight: '700',
  },
  track: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
})
