import { View, Text, Input, Button } from '@tarojs/components'
import { type TargetEditorProps } from '../types'
import { formatMacroNutrient, formatMicroNutrient } from '../../../utils/number-format'
import { MICRONUTRIENT_PREFERENCE_CONFIGS } from '../utils/micronutrientPreferences'

export function TargetEditor({
  visible,
  targetForm,
  saving,
  calibrationSuggestion,
  onTargetFieldChange,
  onSave,
  onApplyCalibration,
  onDismissCalibration,
  hiddenMicronutrientKeys,
  onToggleMicronutrientVisibility,
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
    const micro = MICRONUTRIENT_PREFERENCE_CONFIGS.find((item) => item.targetFormKey === key)
    if (micro) return micro.step
    if (key === 'calorieTarget') return 100
    if (key === 'fatTarget') return 10
    // 蛋白质/碳水
    return 50
  }

  const visibleMicroConfigs = MICRONUTRIENT_PREFERENCE_CONFIGS.filter(
    (config) => !hiddenMicronutrientKeys.includes(config.nutrientKey)
  )
  const hiddenMicroConfigs = MICRONUTRIENT_PREFERENCE_CONFIGS.filter(
    (config) => hiddenMicronutrientKeys.includes(config.nutrientKey)
  )

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
            <View className='target-form-section-heading'>
              <View>
                <Text className='target-form-section-title'>微量元素目标</Text>
                <Text className='target-form-section-desc'>这里只保留首页关注项，隐藏后目标设置也会同步精简。</Text>
              </View>
              <Text className='target-form-section-count'>{visibleMicroConfigs.length}/{MICRONUTRIENT_PREFERENCE_CONFIGS.length}</Text>
            </View>
            <View className='target-micro-grid'>
              {visibleMicroConfigs.map((config) => (
                <View key={config.targetFormKey} className='target-form-item target-form-item--micro'>
                  <View className='target-micro-item-heading'>
                    <Text className='target-form-label'>{config.label}</Text>
                    <View
                      className='target-micro-hide-btn'
                      onClick={() => onToggleMicronutrientVisibility(config.nutrientKey)}
                    >
                      <Text>隐藏</Text>
                    </View>
                  </View>
                  <View className='target-input-row'>
                    <View
                      className='target-adjust-btn'
                      onClick={() => adjustValue(config.targetFormKey, -1)}
                    >
                      <Text className='target-adjust-btn-text'>−</Text>
                    </View>
                    <View className='target-input-wrap'>
                      <Input
                        className='target-input'
                        type='digit'
                        value={targetForm[config.targetFormKey]}
                        onInput={(e) => handleFormChange(config.targetFormKey, e.detail.value)}
                      />
                      <Text className='target-input-unit'>{config.unit}</Text>
                    </View>
                    <View
                      className='target-adjust-btn'
                      onClick={() => adjustValue(config.targetFormKey, 1)}
                    >
                      <Text className='target-adjust-btn-text'>+</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
            {hiddenMicroConfigs.length > 0 && (
              <View className='target-hidden-micros'>
                <Text className='target-hidden-micros-title'>已隐藏 · 点击添加回来</Text>
                <View className='target-hidden-micros-list'>
                  {hiddenMicroConfigs.map((config) => (
                    <View
                      key={config.nutrientKey}
                      className='target-hidden-micro-chip'
                      onClick={() => onToggleMicronutrientVisibility(config.nutrientKey)}
                    >
                      <Text className='target-hidden-micro-plus'>＋</Text>
                      <Text>{config.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        <View className='target-modal-footer'>
          <Button
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
