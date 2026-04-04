import { View, Text, Slider, Input } from '@tarojs/components'
import { Button } from '@taroify/core'
import { IconProtein, IconCarbs, IconFat } from '../../../components/iconfont'
import { type TargetEditorProps } from '../types'
import { getGramsFromLevel, calculateCaloriesFromLevels } from '../utils/helpers'
import { CalorieWavePool } from './CalorieWavePool'

export function TargetEditor({
  visible,
  mode,
  targetMode,
  simpleTarget,
  targetForm,
  saving,
  intakeData,
  onModeChange,
  onSimpleTargetChange,
  onTargetFormChange,
  onSave,
  onClose
}: TargetEditorProps) {
  if (!visible) return null

  const handleSimpleChange = (key: keyof typeof simpleTarget, value: number) => {
    onSimpleTargetChange({ ...simpleTarget, [key]: value })
  }

  const handleFormChange = (key: keyof typeof targetForm, value: string) => {
    onTargetFormChange({ ...targetForm, [key]: value })
  }

  return (
    <View className='target-modal' catchMove>
      <View className='target-modal-mask' onClick={() => !saving && onClose()} />
      <View className='target-modal-content'>
        <View className='target-modal-header'>
          <View className='target-modal-title-row'>
            <Text className='target-modal-title'>编辑今日目标</Text>
            <View className='target-mode-switch'>
              <View 
                className={`target-mode-option ${targetMode === 'simple' ? 'active' : ''}`}
                onClick={() => onModeChange('simple')}
              >
                <Text className='target-mode-text'>普通</Text>
              </View>
              <View 
                className={`target-mode-option ${targetMode === 'precise' ? 'active' : ''}`}
                onClick={() => onModeChange('precise')}
              >
                <Text className='target-mode-text'>精确</Text>
              </View>
            </View>
          </View>
          <Text className='target-modal-desc'>
            {targetMode === 'simple' ? '滑动选择档位快速设置目标' : '保存后会同步到账号，下次登录仍会保留。'}
          </Text>
        </View>

        {/* 普通模式：横向滑块卡片 */}
        {targetMode === 'simple' && (
          <View className='target-simple-mode'>
            {/* 蛋白质卡片 */}
            <View className='target-slider-card'>
              <View className='target-slider-card-header'>
                <View className='target-slider-icon-wrap'>
                  <View className='target-slider-icon protein'>
                    <IconProtein size={28} color='#fff' />
                  </View>
                </View>
                <Text className='target-slider-card-title'>蛋白质</Text>
                <Text className='target-slider-card-value'>
                  {getGramsFromLevel('protein', simpleTarget.proteinLevel)}g
                </Text>
              </View>
              <View className='target-slider-bar-wrap'>
                <View 
                  className='target-slider-bar protein'
                  style={{ width: `${(simpleTarget.proteinLevel / 20) * 100}%` }}
                >
                  <Text className='target-slider-bar-text'>
                    {Math.round((simpleTarget.proteinLevel / 20) * 100)}%
                  </Text>
                </View>
                <Slider
                  className='target-slider-input'
                  value={simpleTarget.proteinLevel}
                  min={1}
                  max={20}
                  step={1}
                  showValue={false}
                  activeColor='transparent'
                  backgroundColor='transparent'
                  blockSize={28}
                  onChange={(e) => handleSimpleChange('proteinLevel', e.detail.value)}
                />
              </View>
            </View>

            {/* 碳水卡片 */}
            <View className='target-slider-card'>
              <View className='target-slider-card-header'>
                <View className='target-slider-icon-wrap'>
                  <View className='target-slider-icon carbs'>
                    <IconCarbs size={28} color='#fff' />
                  </View>
                </View>
                <Text className='target-slider-card-title'>碳水</Text>
                <Text className='target-slider-card-value'>
                  {getGramsFromLevel('carbs', simpleTarget.carbsLevel)}g
                </Text>
              </View>
              <View className='target-slider-bar-wrap'>
                <View 
                  className='target-slider-bar carbs'
                  style={{ width: `${(simpleTarget.carbsLevel / 20) * 100}%` }}
                >
                  <Text className='target-slider-bar-text'>
                    {Math.round((simpleTarget.carbsLevel / 20) * 100)}%
                  </Text>
                </View>
                <Slider
                  className='target-slider-input'
                  value={simpleTarget.carbsLevel}
                  min={1}
                  max={20}
                  step={1}
                  showValue={false}
                  activeColor='transparent'
                  backgroundColor='transparent'
                  blockSize={28}
                  onChange={(e) => handleSimpleChange('carbsLevel', e.detail.value)}
                />
              </View>
            </View>

            {/* 脂肪卡片 */}
            <View className='target-slider-card'>
              <View className='target-slider-card-header'>
                <View className='target-slider-icon-wrap'>
                  <View className='target-slider-icon fat'>
                    <IconFat size={28} color='#fff' />
                  </View>
                </View>
                <Text className='target-slider-card-title'>脂肪</Text>
                <Text className='target-slider-card-value'>
                  {getGramsFromLevel('fat', simpleTarget.fatLevel)}g
                </Text>
              </View>
              <View className='target-slider-bar-wrap'>
                <View 
                  className='target-slider-bar fat'
                  style={{ width: `${(simpleTarget.fatLevel / 20) * 100}%` }}
                >
                  <Text className='target-slider-bar-text'>
                    {Math.round((simpleTarget.fatLevel / 20) * 100)}%
                  </Text>
                </View>
                <Slider
                  className='target-slider-input'
                  value={simpleTarget.fatLevel}
                  min={1}
                  max={20}
                  step={1}
                  showValue={false}
                  activeColor='transparent'
                  backgroundColor='transparent'
                  blockSize={28}
                  onChange={(e) => handleSimpleChange('fatLevel', e.detail.value)}
                />
              </View>
            </View>

            {/* 卡路里预览 */}
            <CalorieWavePool calories={calculateCaloriesFromLevels(simpleTarget)} />
          </View>
        )}

        {/* 精确模式：数字输入框 */}
        {targetMode === 'precise' && (
          <View className='target-form-list'>
            <View className='target-form-item'>
              <Text className='target-form-label'>今日摄入目标</Text>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.calorieTarget}
                  onInput={(e) => handleFormChange('calorieTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>kcal</Text>
              </View>
            </View>

            <View className='target-form-item'>
              <Text className='target-form-label'>蛋白质目标</Text>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.proteinTarget}
                  onInput={(e) => handleFormChange('proteinTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>g</Text>
              </View>
            </View>

            <View className='target-form-item'>
              <Text className='target-form-label'>碳水目标</Text>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.carbsTarget}
                  onInput={(e) => handleFormChange('carbsTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>g</Text>
              </View>
            </View>

            <View className='target-form-item'>
              <Text className='target-form-label'>脂肪目标</Text>
              <View className='target-input-wrap'>
                <Input
                  className='target-input'
                  type='digit'
                  value={targetForm.fatTarget}
                  onInput={(e) => handleFormChange('fatTarget', e.detail.value)}
                />
                <Text className='target-input-unit'>g</Text>
              </View>
            </View>
          </View>
        )}

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
