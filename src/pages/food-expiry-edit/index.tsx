import { View, Text, Input, Textarea, Picker } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  createFoodExpiryItem,
  getFoodExpiryItem,
  updateFoodExpiryItem,
} from '../../utils/api'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../utils/food-expiry-events'
import './index.scss'

const STORAGE_OPTIONS = ['常温', '冷藏', '冷冻']

function getDateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCurrentTimeValue(): string {
  const date = new Date()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export default function FoodExpiryEditPage() {
  const router = useRouter()
  const itemId = router.params?.id || ''
  const isEdit = !!itemId

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [foodName, setFoodName] = useState('')
  const [quantityText, setQuantityText] = useState('')
  const [storageLocation, setStorageLocation] = useState('')
  const [note, setNote] = useState('')
  const [deadlinePrecision, setDeadlinePrecision] = useState<'date' | 'datetime'>('date')
  const [deadlineDate, setDeadlineDate] = useState(getDateOffset(1))
  const [deadlineTime, setDeadlineTime] = useState(getCurrentTimeValue())

  useEffect(() => {
    if (!itemId) return
    const loadDetail = async () => {
      setLoading(true)
      try {
        const { item } = await getFoodExpiryItem(itemId)
        const localDeadline = new Date(item.deadline_at)
        const year = localDeadline.getFullYear()
        const month = String(localDeadline.getMonth() + 1).padStart(2, '0')
        const day = String(localDeadline.getDate()).padStart(2, '0')
        const hours = String(localDeadline.getHours()).padStart(2, '0')
        const minutes = String(localDeadline.getMinutes()).padStart(2, '0')
        setFoodName(item.food_name || '')
        setQuantityText(item.quantity_text || '')
        setStorageLocation(item.storage_location || '')
        setNote(item.note || '')
        setDeadlinePrecision(item.deadline_precision || 'date')
        setDeadlineDate(`${year}-${month}-${day}`)
        setDeadlineTime(`${hours}:${minutes}`)
        Taro.setNavigationBarTitle({ title: '编辑食物' })
      } catch (error: any) {
        Taro.showToast({ title: error.message || '加载失败', icon: 'none' })
      } finally {
        setLoading(false)
      }
    }
    loadDetail()
  }, [itemId])

  const handleSave = async () => {
    if (!foodName.trim()) {
      Taro.showToast({ title: '请输入食物名称', icon: 'none' })
      return
    }

    if (!isEdit) {
      const { confirm } = await Taro.showModal({
        title: '确认添加',
        content: `确认添加「${foodName.trim()}」到食物保质期吗？`
      })
      if (!confirm) return
    }

    setSaving(true)
    try {
      const payload = {
        food_name: foodName.trim(),
        quantity_text: quantityText.trim() || undefined,
        storage_location: storageLocation.trim() || undefined,
        note: note.trim() || undefined,
        deadline_precision: deadlinePrecision,
        deadline_date: deadlineDate,
        ...(deadlinePrecision === 'datetime' ? { deadline_time: deadlineTime } : {})
      }
      if (isEdit) {
        await updateFoodExpiryItem(itemId, payload)
      } else {
        await createFoodExpiryItem(payload)
      }
      Taro.eventCenter.trigger(FOOD_EXPIRY_CHANGED_EVENT)
      Taro.showToast({ title: isEdit ? '已更新' : '已添加', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 500)
    } catch (error: any) {
      Taro.showToast({ title: error.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className='food-expiry-edit-page'>
      <View className='expiry-form-card'>
        <View className='form-item'>
          <Text className='form-label'>食物名称</Text>
          <View className='form-input-wrap'>
            <Input
              className='form-input'
              placeholder='如：鲜牛奶、鸡蛋、吐司'
              placeholderClass='food-expiry-input-placeholder'
              value={foodName}
              maxlength={100}
              onInput={(e) => setFoodName(e.detail.value)}
            />
          </View>
        </View>

        <View className='form-item'>
          <Text className='form-label'>数量</Text>
          <View className='form-input-wrap'>
            <Input
              className='form-input'
              placeholder='可选，如 2盒、半袋'
              placeholderClass='food-expiry-input-placeholder'
              value={quantityText}
              maxlength={50}
              onInput={(e) => setQuantityText(e.detail.value)}
            />
          </View>
        </View>

        <View className='form-item'>
          <Text className='form-label'>存放位置</Text>
          <View className='storage-options'>
            {STORAGE_OPTIONS.map((option) => (
              <View
                key={option}
                className={`storage-chip ${storageLocation === option ? 'active' : ''}`}
                onClick={() => setStorageLocation(option)}
              >
                <Text className='storage-chip-text'>{option}</Text>
              </View>
            ))}
          </View>
          <View className='form-input-wrap'>
            <Input
              className='form-input'
              placeholder='也可以手动填写，如 冰箱上层'
              placeholderClass='food-expiry-input-placeholder'
              value={storageLocation}
              maxlength={50}
              onInput={(e) => setStorageLocation(e.detail.value)}
            />
          </View>
        </View>
      </View>

      <View className='expiry-form-card'>
        <View className='form-item'>
          <Text className='form-label'>截止方式</Text>
          <View className='precision-tabs'>
            <View
              className={`precision-tab ${deadlinePrecision === 'date' ? 'active' : ''}`}
              onClick={() => setDeadlinePrecision('date')}
            >
              <Text className='precision-tab-text'>只填日期</Text>
            </View>
            <View
              className={`precision-tab ${deadlinePrecision === 'datetime' ? 'active' : ''}`}
              onClick={() => setDeadlinePrecision('datetime')}
            >
              <Text className='precision-tab-text'>日期+时间</Text>
            </View>
          </View>
        </View>

        <View className='form-item'>
          <Text className='form-label'>截止日期</Text>
          <Picker mode='date' value={deadlineDate} onChange={(e) => setDeadlineDate(e.detail.value)}>
            <View className='picker-field'>
              <Text className='picker-field-text'>{deadlineDate}</Text>
            </View>
          </Picker>
        </View>

        {deadlinePrecision === 'datetime' ? (
          <View className='form-item'>
            <Text className='form-label'>截止时间</Text>
            <Picker mode='time' value={deadlineTime} onChange={(e) => setDeadlineTime(e.detail.value)}>
              <View className='picker-field'>
                <Text className='picker-field-text'>{deadlineTime}</Text>
              </View>
            </Picker>
          </View>
        ) : null}

        <View className='form-item'>
          <Text className='form-label'>备注</Text>
          <Textarea
            className='form-textarea'
            placeholder='可选，如 开封后尽快喝完'
            maxlength={300}
            value={note}
            onInput={(e) => setNote(e.detail.value)}
          />
        </View>
      </View>

      {loading ? (
        <View className='form-loading'>
          <Text className='form-loading-text'>加载中...</Text>
        </View>
      ) : (
        <View className='form-save-btn' onClick={handleSave}>
          <Text className='form-save-btn-text'>{saving ? '保存中...' : isEdit ? '保存修改' : '添加食物'}</Text>
        </View>
      )}
    </View>
  )
}
