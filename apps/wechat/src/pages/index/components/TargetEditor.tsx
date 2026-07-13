import { View, Text, Input } from '@tarojs/components'
import { Button } from '@taroify/core'
import { type TargetEditorProps } from '../types'
import { formatMacroNutrient, formatMicroNutrient } from '../../../utils/number-format'

type MicroTargetKey =
  | 'fiberTarget'
  | 'sugarTarget'
  | 'saturatedFatTarget'
  | 'cholesterolMgTarget'
  | 'sodiumMgTarget'
  | 'potassiumMgTarget'
  | 'calciumMgTarget'
  | 'ironMgTarget'
  | 'magnesiumMgTarget'
  | 'zincMgTarget'
  | 'vitaminARaeMcgTarget'
  | 'vitaminCMgTarget'
  | 'vitaminDMcgTarget'
  | 'vitaminEMgTarget'
  | 'vitaminKMcgTarget'
  | 'thiaminMgTarget'
  | 'riboflavinMgTarget'
  | 'niacinMgTarget'
  | 'vitaminB6MgTarget'
  | 'folateMcgTarget'
  | 'vitaminB12McgTarget'

const MICRO_TARGET_CONFIGS: Array<{
  key: MicroTargetKey
  label: string
  unit: string
  step: number
}> = [
  { key: 'fiberTarget', label: '膳食纤维', unit: 'g', step: 1 },
  { key: 'sugarTarget', label: '糖', unit: 'g', step: 1 },
  { key: 'saturatedFatTarget', label: '饱和脂肪', unit: 'g', step: 1 },
  { key: 'cholesterolMgTarget', label: '胆固醇', unit: 'mg', step: 50 },
  { key: 'sodiumMgTarget', label: '钠', unit: 'mg', step: 50 },
  { key: 'potassiumMgTarget', label: '钾', unit: 'mg', step: 50 },
  { key: 'calciumMgTarget', label: '钙', unit: 'mg', step: 50 },
  { key: 'ironMgTarget', label: '铁', unit: 'mg', step: 1 },
  { key: 'magnesiumMgTarget', label: '镁', unit: 'mg', step: 50 },
  { key: 'zincMgTarget', label: '锌', unit: 'mg', step: 1 },
  { key: 'vitaminARaeMcgTarget', label: '维A', unit: 'mcg', step: 10 },
  { key: 'vitaminCMgTarget', label: '维C', unit: 'mg', step: 10 },
  { key: 'vitaminDMcgTarget', label: '维D', unit: 'mcg', step: 1 },
  { key: 'vitaminEMgTarget', label: '维E', unit: 'mg', step: 5 },
  { key: 'vitaminKMcgTarget', label: '维K', unit: 'mcg', step: 10 },
  { key: 'thiaminMgTarget', label: '维B1', unit: 'mg', step: 0.1 },
  { key: 'riboflavinMgTarget', label: '维B2', unit: 'mg', step: 0.1 },
  { key: 'niacinMgTarget', label: '烟酸', unit: 'mg', step: 1 },
  { key: 'vitaminB6MgTarget', label: '维B6', unit: 'mg', step: 0.1 },
  { key: 'folateMcgTarget', label: '叶酸', unit: 'mcg', step: 50 },
  { key: 'vitaminB12McgTarget', label: '维B12', unit: 'mcg', step: 0.1 },
]

export function TargetEditor({
  visible,
  targetForm,
  saving,
  calibrationSuggestion,
  onTargetFieldChange,
  onSave,
  onApplyCalibration,
  onDismissCalibration,
  onClose
}: TargetEditorProps) {
  if (!visible) return null

  const formatTargetValue = (key: keyof typeof targetForm, value: number) => {
    const macroKeys = new Set(['calorieTarget', 'proteinTarget', 'carbsTarget', 'fatTarget'])
    if (macroKeys.has(key)) return formatMacroNutrient(Math.max(0, value))
    return formatMicroNutrient(Math.max(0, value))
  }

  const handleFormChange = (key: keyof typeof targetForm, value: string) => {
    onTargetFieldChange(key, value)
  }

  // 固定步长：热量 100，蛋白质/碳水 50，脂肪 10
  const getStep = (key: keyof typeof targetForm): number => {
    const micro = MICRO_TARGET_CONFIGS.find((item) => item.key === key)
    if (micro) return micro.step
    if (key === 'calorieTarget') return 100
    if (key === 'fatTarget') return 10
    // 蛋白质/碳水
    return 50
  }

  const adjustValue = (key: keyof typeof targetForm, delta: number) => {
    const currentValue = parseFloat(targetForm[key]) || 0
    const step = getStep(key)
    const newValue = Math.max(0, currentValue + delta * step)
    handleFormChange(key, formatTargetValue(key, newValue))
  }

  const renderMacroItem = (
    key: keyof typeof targetForm,
    label: string,
    unit: string
  ) => (
    <View key={key} className='target-form-item'>
      <Text className='target-form-label'>{label}</Text>
      <View className='target-input-row'>
        <View
          className='target-adjust-btn'
          onClick={() => adjustValue(key, -1)}
        >
          <Text className='target-adjust-btn-text'>−</Text>
        </View>
        <View className='target-input-wrap'>
          <Input
            className='target-input'
            type='digit'
            value={targetForm[key]}
            onInput={(e) => handleFormChange(key, e.detail.value)}
          />
          <Text className='target-input-unit'>{unit}</Text>
        </View>
        <View
          className='target-adjust-btn'
          onClick={() => adjustValue(key, 1)}
        >
          <Text className='target-adjust-btn-text'>+</Text>
        </View>
      </View>
    </View>
  )

  return (
    <View className='target-modal'>
      <View className='target-modal-mask' catchMove onClick={() => !saving && onClose()} />
      <View className='target-modal-content'>
        <View className='target-modal-header'>
          <View className='target-modal-title-row'>
            <Text className='target-modal-title'>基础目标设置</Text>
          </View>
          <Text className='target-modal-desc'>这是长期基础目标，不会因为当天运动自动变化。</Text>
        </View>

        <View className='target-modal-scroll'>
          {calibrationSuggestion?.available && (
            <View className='target-calibration-card'>
              <Text className='target-calibration-title'>
                建议调整到 {Math.round(calibrationSuggestion.suggested_kcal)} kcal
              </Text>
              <Text className='target-calibration-desc'>
                {calibrationSuggestion.reason || '根据最近14天的饮食和体重变化，建议小幅调整基础目标。'}
              </Text>
              <View className='target-calibration-actions'>
                <View
                  className='target-calibration-btn secondary'
                  onClick={() => onDismissCalibration?.()}
                >
                  <Text className='target-calibration-btn-text secondary'>暂不调整</Text>
                </View>
                <View
                  className='target-calibration-btn primary'
                  onClick={() => onApplyCalibration?.(calibrationSuggestion)}
                >
                  <Text className='target-calibration-btn-text primary'>应用建议</Text>
                </View>
              </View>
            </View>
          )}

          {/* 精确模式：数字输入框 + 加减按钮 */}
          <View className='target-form-list'>
            {renderMacroItem('calorieTarget', '基础摄入目标', 'kcal')}
            {renderMacroItem('proteinTarget', '蛋白质目标', 'g')}
            {renderMacroItem('carbsTarget', '碳水目标', 'g')}
            {renderMacroItem('fatTarget', '脂肪目标', 'g')}
          </View>

          <View className='target-form-section'>
            <Text className='target-form-section-title'>微量元素目标</Text>
            <View className='target-micro-grid'>
              {MICRO_TARGET_CONFIGS.map((config) => (
                <View key={config.key} className='target-form-item target-form-item--micro'>
                  <Text className='target-form-label'>{config.label}</Text>
                  <View className='target-input-row'>
                    <View
                      className='target-adjust-btn'
                      onClick={() => adjustValue(config.key, -1)}
                    >
                      <Text className='target-adjust-btn-text'>−</Text>
                    </View>
                    <View className='target-input-wrap'>
                      <Input
                        className='target-input'
                        type='digit'
                        value={targetForm[config.key]}
                        onInput={(e) => handleFormChange(config.key, e.detail.value)}
                      />
                      <Text className='target-input-unit'>{config.unit}</Text>
                    </View>
                    <View
                      className='target-adjust-btn'
                      onClick={() => adjustValue(config.key, 1)}
                    >
                      <Text className='target-adjust-btn-text'>+</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View className='target-modal-footer'>
          <Button
            block
            color='primary'
            shape='round'
            className='target-save-btn'
            onClick={onSave}
            loading={saving}
          >
            保存目标
          </Button>
        </View>
      </View>
    </View>
  )
}
