import { View, Text, PickerView, PickerViewColumn } from '@tarojs/components'
import { useEffect, useMemo, useState } from 'react'
import './index.scss'

export type RoutineHours = {
  sleepHour: number
  wakeHour: number
}

export type RoutinePreset = {
  label: string
  desc: string
  sleepHour: number
  wakeHour: number
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export const DEFAULT_ROUTINE_HOURS: RoutineHours = {
  sleepHour: 23,
  wakeHour: 7,
}

export const COMMON_ROUTINE_PRESETS: RoutinePreset[] = [
  { label: '早睡早起', desc: '22 点睡 / 6 点起', sleepHour: 22, wakeHour: 6 },
  { label: '标准作息', desc: '23 点睡 / 7 点起', sleepHour: 23, wakeHour: 7 },
  { label: '晚睡晚起', desc: '1 点睡 / 9 点起', sleepHour: 1, wakeHour: 9 },
  { label: '轮班作息', desc: '3 点睡 / 11 点起', sleepHour: 3, wakeHour: 11 },
]

function clampHour(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(23, Math.round(value)))
}

export function normalizeRoutineHours(value: Partial<RoutineHours> | null | undefined): RoutineHours {
  return {
    sleepHour: clampHour(Number(value?.sleepHour), DEFAULT_ROUTINE_HOURS.sleepHour),
    wakeHour: clampHour(Number(value?.wakeHour), DEFAULT_ROUTINE_HOURS.wakeHour),
  }
}

export function formatRoutineHour(hour: number): string {
  return `${clampHour(hour, 0).toString().padStart(2, '0')}:00`
}

export function formatRoutineHours(value: RoutineHours): string {
  const normalized = normalizeRoutineHours(value)
  return `${formatRoutineHour(normalized.sleepHour)} 睡，${formatRoutineHour(normalized.wakeHour)} 起`
}

export function parseRoutineHours(raw: unknown): RoutineHours {
  const text = String(raw || '').trim()
  if (!text) return DEFAULT_ROUTINE_HOURS
  switch (text) {
    case 'early_bird':
      return { sleepHour: 22, wakeHour: 6 }
    case 'regular':
      return { sleepHour: 23, wakeHour: 7 }
    case 'night_owl':
      return { sleepHour: 1, wakeHour: 9 }
    case 'irregular':
      return { sleepHour: 0, wakeHour: 8 }
    default:
      break
  }

  const matches: number[] = []
  const pattern = /(\d{1,2})(?::\d{1,2})?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const hour = Number(match[1])
    if (Number.isFinite(hour)) {
      matches.push(hour)
    }
  }
  if (matches.length >= 2) {
    return {
      sleepHour: clampHour(matches[0], DEFAULT_ROUTINE_HOURS.sleepHour),
      wakeHour: clampHour(matches[1], DEFAULT_ROUTINE_HOURS.wakeHour),
    }
  }
  return DEFAULT_ROUTINE_HOURS
}

interface RoutineHourPickerProps {
  value: RoutineHours
  onChange: (value: RoutineHours) => void
  presets?: RoutinePreset[]
  compact?: boolean
}

export default function RoutineHourPicker({
  value,
  onChange,
  presets = [],
  compact = false,
}: RoutineHourPickerProps) {
  const normalized = normalizeRoutineHours(value)
  const [sleepPick, setSleepPick] = useState<number[]>([normalized.sleepHour])
  const [wakePick, setWakePick] = useState<number[]>([normalized.wakeHour])

  useEffect(() => {
    const next = normalizeRoutineHours(value)
    setSleepPick([next.sleepHour])
    setWakePick([next.wakeHour])
  }, [value.sleepHour, value.wakeHour])

  const summary = useMemo(() => formatRoutineHours(normalized), [normalized.sleepHour, normalized.wakeHour])

  const applyChange = (patch: Partial<RoutineHours>) => {
    onChange(normalizeRoutineHours({ ...normalized, ...patch }))
  }

  return (
    <View className={`routine-hour-picker ${compact ? 'routine-hour-picker--compact' : ''}`}>
      {presets.length > 0 ? (
        <View className='routine-presets'>
          {presets.map((preset) => {
            const active = normalized.sleepHour === preset.sleepHour && normalized.wakeHour === preset.wakeHour
            return (
              <View
                key={`${preset.sleepHour}-${preset.wakeHour}`}
                className={`routine-preset ${active ? 'active' : ''}`}
                onClick={() => onChange({ sleepHour: preset.sleepHour, wakeHour: preset.wakeHour })}
              >
                <Text className='routine-preset-title'>{preset.label}</Text>
                <Text className='routine-preset-desc'>{preset.desc}</Text>
              </View>
            )
          })}
        </View>
      ) : null}

      <View className='routine-picker-summary'>
        <Text className='routine-picker-summary-label'>当前作息</Text>
        <Text className='routine-picker-summary-value'>{summary}</Text>
      </View>

      <View className='routine-wheel-row'>
        <View className='routine-wheel-card'>
          <Text className='routine-wheel-title'>入睡</Text>
          <PickerView
            className='routine-wheel-view'
            indicatorClass='routine-wheel-indicator'
            indicatorStyle='height: 88rpx;'
            value={sleepPick}
            onChange={(e) => {
              const hour = Number(e.detail.value?.[0] ?? normalized.sleepHour)
              setSleepPick([hour])
              applyChange({ sleepHour: hour })
            }}
          >
            <PickerViewColumn>
              {HOURS.map(hour => (
                <View key={hour} className='routine-wheel-item'>
                  <Text className={`routine-wheel-hour ${hour === normalized.sleepHour ? 'active' : ''}`}>{hour}</Text>
                  <Text className='routine-wheel-unit'>点</Text>
                </View>
              ))}
            </PickerViewColumn>
          </PickerView>
        </View>

        <View className='routine-wheel-card'>
          <Text className='routine-wheel-title'>起床</Text>
          <PickerView
            className='routine-wheel-view'
            indicatorClass='routine-wheel-indicator'
            indicatorStyle='height: 88rpx;'
            value={wakePick}
            onChange={(e) => {
              const hour = Number(e.detail.value?.[0] ?? normalized.wakeHour)
              setWakePick([hour])
              applyChange({ wakeHour: hour })
            }}
          >
            <PickerViewColumn>
              {HOURS.map(hour => (
                <View key={hour} className='routine-wheel-item'>
                  <Text className={`routine-wheel-hour ${hour === normalized.wakeHour ? 'active' : ''}`}>{hour}</Text>
                  <Text className='routine-wheel-unit'>点</Text>
                </View>
              ))}
            </PickerViewColumn>
          </PickerView>
        </View>
      </View>
    </View>
  )
}
