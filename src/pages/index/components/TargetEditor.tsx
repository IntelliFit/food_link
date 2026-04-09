import { View, Text, Input } from '@tarojs/components'
import { Button } from '@taroify/core'
import { type TargetEditorProps } from '../types'

export function TargetEditor({
  visible,
  targetForm,
  saving,
  onTargetFormChange,
  onSave,
  onClose
}: TargetEditorProps) {
  if (!visible) return null

  const handleFormChange = (key: keyof typeof targetForm, value: string) => {
    onTargetFormChange({ ...targetForm, [key]: value })
  }

  // 固定步长：热量 100，蛋白质/碳水 50，脂肪 10
  const getStep = (key: keyof typeof targetForm): number => {
    if (key === 'calorieTarget') return 100
    if (key === 'fatTarget') return 10
    // 蛋白质/碳水
    return 50
  }

  const adjustValue = (key: keyof typeof targetForm, delta: number) => {
    const currentValue = parseFloat(targetForm[key]) || 0
    const step = getStep(key)
    const newValue = Math.max(0, currentValue + delta * step)
    handleFormChange(key, String(newValue))
  }

  return (
    <View className='target-modal' catchMove>
      <View className='target-modal-mask' onClick={() => !saving && onClose()} />
      <View className='target-modal-content'>
        <View className='target-modal-header'>
          <View className='target-modal-title-row'>
            <Text className='target-modal-title'>编辑今日目标</Text>
          </View>
          <Text className='target-modal-desc'>保存后会同步到账号，下次登录仍会保留。</Text>
        </View>

        {/* 精确模式：数字输入框 + 加减按钮 */}
        <View className='target-form-list'>
          {/* 热量目标 */}
          <View className='target-form-item'>
            <Text className='target-form-label'>今日摄入目标</Text>
            <View className='target-input-row'>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('calorieTarget', -1)}
              >
                <Text className='target-adjust-btn-text'>−</Text>
              </View>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.calorieTarget}
                  onInput={(e) => handleFormChange('calorieTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>kcal</Text>
              </View>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('calorieTarget', 1)}
              >
                <Text className='target-adjust-btn-text'>+</Text>
              </View>
            </View>
          </View>

          {/* 蛋白质目标 */}
          <View className='target-form-item'>
            <Text className='target-form-label'>蛋白质目标</Text>
            <View className='target-input-row'>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('proteinTarget', -1)}
              >
                <Text className='target-adjust-btn-text'>−</Text>
              </View>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.proteinTarget}
                  onInput={(e) => handleFormChange('proteinTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>g</Text>
              </View>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('proteinTarget', 1)}
              >
                <Text className='target-adjust-btn-text'>+</Text>
              </View>
            </View>
          </View>

          {/* 碳水目标 */}
          <View className='target-form-item'>
            <Text className='target-form-label'>碳水目标</Text>
            <View className='target-input-row'>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('carbsTarget', -1)}
              >
                <Text className='target-adjust-btn-text'>−</Text>
              </View>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.carbsTarget}
                  onInput={(e) => handleFormChange('carbsTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>g</Text>
              </View>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('carbsTarget', 1)}
              >
                <Text className='target-adjust-btn-text'>+</Text>
              </View>
            </View>
          </View>

          {/* 脂肪目标 */}
          <View className='target-form-item'>
            <Text className='target-form-label'>脂肪目标</Text>
            <View className='target-input-row'>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('fatTarget', -1)}
              >
                <Text className='target-adjust-btn-text'>−</Text>
              </View>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.fatTarget}
                  onInput={(e) => handleFormChange('fatTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>g</Text>
              </View>
              <View 
                className='target-adjust-btn'
                onClick={() => adjustValue('fatTarget', 1)}
              >
                <Text className='target-adjust-btn-text'>+</Text>
              </View>
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
