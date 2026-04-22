import { View, Text, Input, Textarea, Picker, ScrollView } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  createManagedFoodExpiryItem,
  getManagedFoodExpiryItem,
  updateManagedFoodExpiryItem,
  subscribeManagedFoodExpiryItem,
  EXPIRY_SUBSCRIBE_TEMPLATE_ID,
  type FoodExpiryItem,
  type FoodExpiryStorageType,
  type UpsertFoodExpiryItemRequest,
} from '../../../utils/api'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../../utils/food-expiry-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

import './index.scss'

const STORAGE_OPTIONS = [
  { value: '常温', label: '常温' },
  { value: '冷藏', label: '冷藏' },
  { value: '冷冻', label: '冷冻' },
]

const CATEGORY_OPTIONS = [
  '乳制品',
  '水果',
  '蔬菜',
  '肉类',
  '海鲜',
  '蛋类',
  '豆制品',
  '熟食',
  '剩菜',
  '主食',
  '面包',
  '零食',
  '饮料',
  '冷冻食品',
  '调味品',
  '其他',
]

const PRESET_ITEMS = [
  { food_name: '牛奶', category: '乳制品', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 3 },
  { food_name: '酸奶', category: '乳制品', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 5 },
  { food_name: '水果', category: '水果', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 3 },
  { food_name: '面包', category: '面包', storage_type: 'room_temp' as FoodExpiryStorageType, days: 3 },
  { food_name: '剩菜', category: '剩菜', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 1 },
  { food_name: '熟食', category: '熟食', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 2 },
]

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

export default function ExpiryEditPage() {
  const router = useRouter()
  const itemId = router.params?.id
  const isEdit = !!itemId

  const [loading, setLoading] = useState(!!itemId)
  const [foodName, setFoodName] = useState('')
  const [category, setCategory] = useState('乳制品')
  const [customCategory, setCustomCategory] = useState('')
  const [storageLocation, setStorageLocation] = useState('冷藏')
  const [quantityText, setQuantityText] = useState('')
  const [deadlineDate, setDeadlineDate] = useState(addDays(3))
  const [note, setNote] = useState('')

  const pageTitle = useMemo(() => (isEdit ? '编辑保质期' : '新增保质期'), [isEdit])
  const isCustomCategory = useMemo(() => !CATEGORY_OPTIONS.includes(category), [category])
  const normalizedCategory = useMemo(() => {
    const next = isCustomCategory ? customCategory.trim() : category.trim()
    return next || '其他'
  }, [category, customCategory, isCustomCategory])

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: pageTitle })
  }, [pageTitle])

  const hydrateForm = (item: FoodExpiryItem) => {
    setFoodName(item.food_name || '')
    const cat = item.category?.trim() || '其他'
    if (CATEGORY_OPTIONS.includes(cat)) {
      setCategory(cat)
      setCustomCategory('')
    } else {
      setCustomCategory(cat)
      setCategory(cat)
    }
    const locationMap: Record<FoodExpiryStorageType, string> = {
      room_temp: '常温',
      refrigerated: '冷藏',
      frozen: '冷冻',
    }
    setStorageLocation(locationMap[item.storage_type] || '冷藏')
    setQuantityText(item.quantity_note || '')
    const datePart = item.expire_date?.split('T')[0] || addDays(3)
    setDeadlineDate(datePart)
    setNote(item.note || '')
  }

  const loadDetail = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    try {
      const res = await getManagedFoodExpiryItem(itemId)
      hydrateForm(res.item)
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const handleApplyPreset = (preset: typeof PRESET_ITEMS[number]) => {
    setFoodName(preset.food_name)
    setCategory(preset.category)
    setCustomCategory('')
    // 映射 storage_type 到 storage_location 标签
    const locationMap: Record<string, string> = {
      'room_temp': '常温',
      'refrigerated': '冷藏',
      'frozen': '冷冻',
    }
    setStorageLocation(locationMap[preset.storage_type] || '冷藏')
    setDeadlineDate(addDays(preset.days))
  }

  const handleSubmit = async () => {
    if (!foodName.trim()) {
      Taro.showToast({ title: '请输入食物名称', icon: 'none' })
      return
    }
    if (!deadlineDate) {
      Taro.showToast({ title: '请选择到期日期', icon: 'none' })
      return
    }

    const storageTypeFromLabel: Record<string, FoodExpiryStorageType> = {
      常温: 'room_temp',
      冷藏: 'refrigerated',
      冷冻: 'frozen',
    }
    const payload: UpsertFoodExpiryItemRequest = {
      food_name: foodName.trim(),
      category: normalizedCategory,
      storage_type: storageTypeFromLabel[storageLocation.trim()] || 'refrigerated',
      quantity_note: quantityText.trim() || undefined,
      expire_date: deadlineDate,
      note: note.trim() || undefined,
      source_type: 'manual',
    }

    Taro.showLoading({ title: isEdit ? '保存中...' : '创建中...' })
    try {
      let savedItem: FoodExpiryItem | null = null
      if (isEdit && itemId) {
        const res = await updateManagedFoodExpiryItem(itemId, payload)
        savedItem = res.item
      } else {
        const res = await createManagedFoodExpiryItem(payload)
        savedItem = res.item
      }
      Taro.hideLoading()

      if (!isEdit && savedItem?.id) {
        await promptExpirySubscribe(savedItem)
      }

      Taro.eventCenter.trigger(FOOD_EXPIRY_CHANGED_EVENT)
      Taro.showToast({ title: isEdit ? '保存成功' : '创建成功', icon: 'success' })
      setTimeout(() => {
        const pages = Taro.getCurrentPages()
        if (pages.length > 1) {
          Taro.navigateBack()
          return
        }
        Taro.redirectTo({ url: extraPkgUrl('/pages/expiry/index') })
      }, 300)
    } catch (error: any) {
      Taro.hideLoading()
      Taro.showToast({ title: error?.message || '提交失败', icon: 'none' })
    }
  }

  const promptExpirySubscribe = async (item: FoodExpiryItem) => {
    if (!EXPIRY_SUBSCRIBE_TEMPLATE_ID) {
      console.warn('[expiry] 未配置订阅消息模板 ID，跳过提醒订阅')
      return
    }

    const modalRes = await Taro.showModal({
      title: '订阅到期提醒',
      content: '是否订阅到期提醒？到期当天会通过微信服务通知提醒你。',
      confirmText: '去订阅',
      cancelText: '暂不',
      confirmColor: '#00bc7d',
    })
    if (!modalRes.confirm) return

    try {
      const subscribeRes = await (Taro as any).requestSubscribeMessage({
        tmplIds: [EXPIRY_SUBSCRIBE_TEMPLATE_ID],
      })
      const subscribeStatus = String((subscribeRes as any)?.[EXPIRY_SUBSCRIBE_TEMPLATE_ID] || '')
      const result = await subscribeManagedFoodExpiryItem(item.id, {
        subscribe_status: subscribeStatus || 'unknown',
        err_msg: (subscribeRes as any)?.errMsg,
      })

      if (result.subscribed && result.schedule_created) {
        Taro.showToast({ title: '已订阅当天提醒', icon: 'none' })
        return
      }

      if (!result.subscribed) {
        Taro.showToast({ title: '未订阅提醒', icon: 'none' })
      }
    } catch (error: any) {
      console.error('[expiry] requestSubscribeMessage failed:', error)
      Taro.showToast({ title: error?.message || '订阅提醒失败', icon: 'none' })
    }
  }

  return (
    <FlPageThemeRoot>
    <View className='expiry-edit-page'>
      <ScrollView scrollY className='expiry-edit-scroll'>
        <View className='expiry-edit-panel'>
          {!isEdit && (
            <View className='expiry-edit-block'>
              <Text className='expiry-edit-label'>常用模板</Text>
              <View className='expiry-preset-list'>
                {PRESET_ITEMS.map((preset) => (
                  <View
                    key={preset.food_name}
                    className='expiry-preset-chip'
                    onClick={() => handleApplyPreset(preset)}
                  >
                    <Text>{preset.food_name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View className='expiry-edit-block'>
            <Text className='expiry-edit-label'>食物名称</Text>
            <Input
              className='expiry-input'
              placeholder='例如 纯牛奶 / 苹果 / 昨晚剩菜'
              value={foodName}
              onInput={(e) => setFoodName(e.detail.value)}
            />
          </View>

          <View className='expiry-edit-block'>
            <Text className='expiry-edit-label'>分类</Text>
            <View className='expiry-choice-list'>
              {CATEGORY_OPTIONS.map((option) => (
                <View
                  key={option}
                  className={`expiry-choice-chip ${!isCustomCategory && category === option ? 'is-active' : ''}`}
                  onClick={() => {
                    setCategory(option)
                    setCustomCategory('')
                  }}
                >
                  <Text>{option}</Text>
                </View>
              ))}
              <View
                className={`expiry-choice-chip ${isCustomCategory ? 'is-active' : ''}`}
                onClick={() => {
                  const nextCategory = customCategory.trim() || '自定义'
                  setCategory(nextCategory)
                }}
              >
                <Text>自定义</Text>
              </View>
            </View>
            {isCustomCategory && (
              <View className='expiry-custom-category-wrap'>
                <Input
                  className='expiry-input'
                  placeholder='输入自定义分类，例如 菌菇 / 预制菜 / 宠物食品'
                  value={customCategory}
                  maxlength={20}
                  onInput={(e) => {
                    const value = e.detail.value
                    setCustomCategory(value)
                    setCategory(value.trim() || '自定义')
                  }}
                />
              </View>
            )}
          </View>

          <View className='expiry-edit-block'>
            <Text className='expiry-edit-label'>储存方式</Text>
            <View className='expiry-choice-list'>
              {STORAGE_OPTIONS.map((option) => (
                <View
                  key={option.value}
                  className={`expiry-choice-chip ${storageLocation === option.value ? 'is-active' : ''}`}
                  onClick={() => setStorageLocation(option.value)}
                >
                  <Text>{option.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='expiry-edit-block'>
            <Text className='expiry-edit-label'>数量说明</Text>
            <Input
              className='expiry-input'
              placeholder='例如 2 盒 / 半袋 / 3 个'
              value={quantityText}
              onInput={(e) => setQuantityText(e.detail.value)}
            />
          </View>

          <View className='expiry-edit-block'>
            <Text className='expiry-edit-label'>到期日期</Text>
            <Picker mode='date' value={deadlineDate} onChange={(e) => setDeadlineDate(e.detail.value)}>
              <View className='expiry-picker'>
                <Text>{deadlineDate || '请选择到期日期'}</Text>
              </View>
            </Picker>
          </View>

          <View className='expiry-edit-block'>
            <Text className='expiry-edit-label'>备注</Text>
            <Textarea
              className='expiry-textarea'
              placeholder='例如 已经开封、准备周末吃掉、放在冰箱第二层'
              value={note}
              maxlength={200}
              onInput={(e) => setNote(e.detail.value)}
            />
          </View>

          {loading ? (
            <View className='expiry-loading'>
              <Text>正在加载...</Text>
            </View>
          ) : (
            <View className='expiry-submit-btn' onClick={handleSubmit}>
              <Text>{isEdit ? '保存修改' : '创建提醒'}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
    </FlPageThemeRoot>
  )
}
