import { View, Text, Input, Textarea, Picker, ScrollView } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  createFoodExpiryItem,
  getFoodExpiryItem,
  updateFoodExpiryItem,
  type FoodExpiryItem,
  type FoodExpiryStorageType,
} from '../../utils/api'

import './index.scss'

const STORAGE_OPTIONS: Array<{ value: FoodExpiryStorageType; label: string }> = [
  { value: 'room_temp', label: '常温' },
  { value: 'refrigerated', label: '冷藏' },
  { value: 'frozen', label: '冷冻' },
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
  const [storageType, setStorageType] = useState<FoodExpiryStorageType>('refrigerated')
  const [quantityNote, setQuantityNote] = useState('')
  const [expireDate, setExpireDate] = useState(addDays(3))
  const [openedDate, setOpenedDate] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<FoodExpiryItem['status']>('active')

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
    const nextCategory = item.category || '乳制品'
    setCategory(nextCategory)
    setCustomCategory(CATEGORY_OPTIONS.includes(nextCategory) ? '' : nextCategory)
    setStorageType(item.storage_type || 'refrigerated')
    setQuantityNote(item.quantity_note || '')
    setExpireDate(item.expire_date || addDays(3))
    setOpenedDate(item.opened_date || '')
    setNote(item.note || '')
    setStatus(item.status || 'active')
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
    setStorageType(preset.storage_type)
    setExpireDate(addDays(preset.days))
  }

  const handleSubmit = async () => {
    if (!foodName.trim()) {
      Taro.showToast({ title: '请输入食物名称', icon: 'none' })
      return
    }
    if (!expireDate) {
      Taro.showToast({ title: '请选择到期日期', icon: 'none' })
      return
    }
    if (openedDate && openedDate > expireDate) {
      Taro.showToast({ title: '开封日期不能晚于到期日期', icon: 'none' })
      return
    }

    const payload = {
      food_name: foodName.trim(),
      category: normalizedCategory,
      storage_type: storageType,
      quantity_note: quantityNote.trim(),
      expire_date: expireDate,
      opened_date: openedDate || undefined,
      note: note.trim(),
      source_type: 'manual' as const,
      status,
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
                  className={`expiry-choice-chip ${storageType === option.value ? 'is-active' : ''}`}
                  onClick={() => setStorageType(option.value)}
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
              value={quantityNote}
              onInput={(e) => setQuantityNote(e.detail.value)}
            />
          </View>

          <View className='expiry-edit-block'>
            <Text className='expiry-edit-label'>到期日期</Text>
            <Picker mode='date' value={expireDate} onChange={(e) => setExpireDate(e.detail.value)}>
              <View className='expiry-picker'>
                <Text>{expireDate || '请选择到期日期'}</Text>
              </View>
            </Picker>
          </View>

          <View className='expiry-edit-block'>
            <View className='expiry-inline-head'>
              <Text className='expiry-edit-label'>开封日期</Text>
              {!!openedDate && (
                <Text className='expiry-clear-text' onClick={() => setOpenedDate('')}>
                  清空
                </Text>
              )}
            </View>
            <Picker mode='date' value={openedDate || formatDate(new Date())} onChange={(e) => setOpenedDate(e.detail.value)}>
              <View className='expiry-picker'>
                <Text>{openedDate || '可选，用于记录已开封食物'}</Text>
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
