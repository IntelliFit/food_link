import { View, Text, Input, Textarea, Picker, ScrollView } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  createFoodExpiryItem,
  getFoodExpiryItem,
  updateFoodExpiryItem,
  type FoodExpiryItem,
  type CreateFoodExpiryRequest,
} from '../../utils/api'

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
    // 优先使用 category，如果不存在则尝试从 storage_location 推断分类
    const storageLocationFromItem = item.storage_location || '冷藏'
    const inferredCategory = storageLocationFromItem === '常温' ? '主食' : '乳制品'
    const nextCategory = inferredCategory
    setCategory(nextCategory)
    setCustomCategory(CATEGORY_OPTIONS.includes(nextCategory) ? '' : nextCategory)
    setStorageLocation(storageLocationFromItem)
    setQuantityText(item.quantity_text || '')
    // 数据库使用 deadline_at，格式为 ISO 字符串，需要提取日期部分
    const deadlineAt = (item as any).deadline_at || addDays(3)
    const datePart = deadlineAt.split('T')[0]
    setDeadlineDate(datePart || addDays(3))
    setNote(item.note || '')
  }

  const loadDetail = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    try {
      const res = await getFoodExpiryItem(itemId)
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

    const payload: CreateFoodExpiryRequest = {
      food_name: foodName.trim(),
      quantity_text: quantityText.trim() || undefined,
      storage_location: storageLocation.trim() || undefined,
      note: note.trim() || undefined,
      deadline_precision: 'date',
      deadline_date: deadlineDate,
    }

    Taro.showLoading({ title: isEdit ? '保存中...' : '创建中...' })
    try {
      if (isEdit && itemId) {
        await updateFoodExpiryItem(itemId, payload)
      } else {
        await createFoodExpiryItem(payload)
      }
      Taro.hideLoading()
      Taro.showToast({ title: isEdit ? '保存成功' : '创建成功', icon: 'success' })
      setTimeout(() => {
        const pages = Taro.getCurrentPages()
        if (pages.length > 1) {
          Taro.navigateBack()
          return
        }
        Taro.redirectTo({ url: '/pages/expiry/index' })
      }, 300)
    } catch (error: any) {
      Taro.hideLoading()
      Taro.showToast({ title: error?.message || '提交失败', icon: 'none' })
    }
  }

  return (
    <View className='expiry-edit-page'>
      <ScrollView scrollY className='expiry-edit-scroll'>
        <View className='expiry-edit-panel'>
          <Text className='expiry-edit-title'>{pageTitle}</Text>
          <Text className='expiry-edit-desc'>先把常买的牛奶、水果、剩菜记进来，之后这里会帮你按到期时间排序。</Text>

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
  )
}
