import { View, Text } from '@tarojs/components'
import { IconProtein, IconCarbs, IconFat } from '../../../components/iconfont'
import { formatDisplayNumber } from '../utils/helpers'
import type { MacroKey } from '../types'

const MACRO_CONFIGS: Array<{
  key: MacroKey
  label: string
  subLabel: string
  color: string
  unit: string
  Icon: typeof IconProtein
}> = [
  { key: 'protein', label: '蛋白质', subLabel: '剩余', color: '#3b82f6', unit: 'g', Icon: IconProtein },
  { key: 'carbs', label: '碳水', subLabel: '剩余', color: '#eab308', unit: 'g', Icon: IconCarbs },
  { key: 'fat', label: '脂肪', subLabel: '剩余', color: '#f97316', unit: 'g', Icon: IconFat }
]

export interface MacrosSectionProps {
  intakeData: {
    macros: Record<MacroKey, { current: number; target: number }>
  }
  isSwitchingDate: boolean
  animatedMacroValues: Record<MacroKey, number>
  animatedMacroProgress: Record<MacroKey, number>
}

export function MacrosSection({
  intakeData,
  isSwitchingDate,
  animatedMacroValues,
  animatedMacroProgress
}: MacrosSectionProps) {
  return (
    <View className='macros-section'>
      {MACRO_CONFIGS.map(({ key, label, color, unit, Icon }) => {
        const animatedValue = animatedMacroValues[key]
        const animatedProgress = animatedMacroProgress[key]
        
        return (
          <View key={key} className='macro-card'>
            <View className='macro-card-header'>
              <View className='macro-title-wrap'>
                <View className='macro-icon'>
                  <Icon size={16} color='#9ca3af' />
                </View>
                <Text className='macro-label'>{label}</Text>
              </View>
            </View>
            
            <View className='macro-gauge-wrap'>
              <View className='macro-gauge-box'>
                <View className='macro-gauge'>
                  <View
                    className='macro-ring-bg'
                    style={{
                      backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='none' stroke='#f0f0f0' stroke-width='14'/><circle cx='50' cy='50' r='40' fill='none' stroke='${color}' stroke-width='14' stroke-linecap='round' stroke-dasharray='${2 * Math.PI * 40}' stroke-dashoffset='${2 * Math.PI * 40 * (1 - animatedProgress / 100)}'/></svg>`
                      )}")`,
                      backgroundSize: '100% 100%'
                    }}
                  />
                  <View className='macro-gauge-center'>
                    {isSwitchingDate ? (
                      <View className='loading-dots'>
                        <View className='loading-dot' />
                        <View className='loading-dot' />
                        <View className='loading-dot' />
                      </View>
                    ) : (
                      <>
                        <Text className='macro-gauge-value' style={{ color }}>
                          {formatDisplayNumber(animatedValue)}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )
}
