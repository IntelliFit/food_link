import { View, Text } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { saveHealthFocusKeys, showUnifiedApiError, type NutritionFocusChoice } from '../../utils/api'
import { experiments } from '../../utils/experiments'
import { PET_FOCUS_LIMIT, petFocusOptions, togglePetFocus } from './pet-focus'

/** 打开时让自定义底栏让位（custom-tab-bar 轮询这个标记），和圈子评论栏一个做法 */
const TAB_BAR_HIDDEN_KEY = 'pet_focus_sheet_visible'

function setTabBarHidden(hidden: boolean) {
  try {
    if (hidden) Taro.setStorageSync(TAB_BAR_HIDDEN_KEY, '1')
    else Taro.removeStorageSync(TAB_BAR_HIDDEN_KEY)
  } catch (_) {}
}

/** 「我在意的」：最多选 3 项，写 PUT /api/health/focus；小麦的排序、任务和分析页都跟着变 */
export function PetFocusSheet({ visible, current, onClose, onSaved }: {
  visible: boolean
  current: NutritionFocusChoice[]
  onClose: () => void
  onSaved: () => void
}) {
  const [keys, setKeys] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible) setKeys(current.map((item) => item.key))
    setTabBarHidden(visible)
    return () => setTabBarHidden(false)
  }, [visible, current])

  if (!visible) return null

  const toggle = (key: string) => {
    const result = togglePetFocus(keys, key)
    if (result.blocked) {
      Taro.showToast({ title: `最多选 ${PET_FOCUS_LIMIT} 项，先取消一项`, icon: 'none' })
      return
    }
    setKeys(result.keys)
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await saveHealthFocusKeys(keys)
      experiments.track('pet_focus_save', { count: keys.length })
      Taro.showToast({ title: '记下了，明天的任务按这个挑', icon: 'none' })
      onSaved()
    } catch (error) {
      await showUnifiedApiError(error, '保存关注失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className='pet-focus-sheet' catchMove>
      <View className='pet-focus-mask' onClick={saving ? undefined : onClose} />
      <View className='pet-focus-panel'>
        <Text className='pet-focus-title'>我在意的</Text>
        <Text className='pet-focus-desc'>最多选 {PET_FOCUS_LIMIT} 项。小麦每天先看这几项还差什么，推荐和任务都围着它们。</Text>
        <View className='pet-focus-options'>
          {petFocusOptions(current).map((option) => {
            const order = keys.indexOf(option.key)
            return (
              <View
                key={option.key}
                className={`pet-focus-option ${order >= 0 ? 'is-on' : ''}`}
                onClick={() => toggle(option.key)}
              >
                {order >= 0 ? <Text className='pet-focus-option-order'>{order + 1}</Text> : null}
                <Text className='pet-focus-option-label'>{option.label}</Text>
              </View>
            )
          })}
        </View>
        <View className='pet-focus-actions'>
          <View className='pet-focus-btn' onClick={saving ? undefined : onClose}>
            <Text className='pet-focus-btn-text'>取消</Text>
          </View>
          <View className='pet-focus-btn pet-focus-btn--primary' onClick={save}>
            {saving ? <View className='pet-tab-spinner pet-tab-spinner--light' /> : <Text className='pet-focus-btn-text'>保存</Text>}
          </View>
        </View>
      </View>
    </View>
  )
}
