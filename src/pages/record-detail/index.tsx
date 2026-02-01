import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import type { FoodRecord } from '../../utils/api'

import './index.scss'

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

const MEAL_TYPE_ICONS: Record<string, string> = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snack: '🍎'
}

const CONTEXT_STATE_LABELS: Record<string, string> = {
  post_workout: '刚健身完',
  fasting: '空腹/餐前',
  fat_loss: '减脂期',
  muscle_gain: '增肌期',
  maintain: '维持体重',
  none: '无特殊'
}

const STORAGE_KEY = 'recordDetail'

function formatContextState(value: string): string {
  return CONTEXT_STATE_LABELS[value] || value
}

/** 格式化记录时间 */
function formatRecordTime(recordTime: string): string {
  try {
    const d = new Date(recordTime)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${month}月${day}日 ${h}:${m}`
  } catch {
    return '--'
  }
}

export default function RecordDetailPage() {
  const [record, setRecord] = useState<FoodRecord | null>(null)

  useEffect(() => {
    try {
      const stored = Taro.getStorageSync(STORAGE_KEY)
      if (stored) {
        setRecord(stored as FoodRecord)
        Taro.removeStorageSync(STORAGE_KEY)
      } else {
        Taro.showToast({ title: '记录不存在', icon: 'none' })
        setTimeout(() => Taro.navigateBack(), 1500)
      }
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 1500)
    }
  }, [])

  if (!record) {
    return (
      <View className="record-detail-page">
        <View className="empty-tip">加载中...</View>
      </View>
    )
  }

  const mealName = MEAL_TYPE_NAMES[record.meal_type] || record.meal_type
  const mealIcon = MEAL_TYPE_ICONS[record.meal_type] || '🍽️'
  const timeStr = formatRecordTime(record.record_time)
  const items = record.items || []

  /** 单条食物实际摄入热量（按 ratio） */
  const itemCalorie = (item: FoodRecord['items'][0]) => {
    const ratio = (item.ratio ?? 100) / 100
    return ((item.nutrients?.calories ?? 0) * ratio)
  }

  return (
    <ScrollView className="record-detail-page" scrollY>
      <View className="detail-card">
        <View className="detail-header">
          <View className="meal-badge">
            <View className="meal-icon">
              <Text>{mealIcon}</Text>
            </View>
            <View>
              <Text className="meal-name">{mealName}</Text>
              <Text className="meal-time">{timeStr}</Text>
            </View>
          </View>
          <View className="total-calorie">
            {Math.round((record.total_calories ?? 0) * 10) / 10}
            <Text className="unit">kcal</Text>
          </View>
        </View>

        {record.image_path ? (
          <View className="detail-image">
            <Image src={record.image_path} mode="aspectFill" />
          </View>
        ) : null}

        {record.description ? (
          <View className="detail-desc">
            <Text className="label">识别描述</Text>
            <Text>{record.description}</Text>
          </View>
        ) : null}

        {record.insight ? (
          <View className="detail-insight">
            <Text className="label">健康建议</Text>
            <Text>{record.insight}</Text>
          </View>
        ) : null}
        {record.context_state ? (
          <View className="detail-insight">
            <Text className="label">当时状态</Text>
            <Text>{formatContextState(record.context_state)}</Text>
          </View>
        ) : null}
        {record.pfc_ratio_comment ? (
          <View className="detail-insight">
            <Text className="label">PFC 比例</Text>
            <Text>{record.pfc_ratio_comment}</Text>
          </View>
        ) : null}
        {record.absorption_notes ? (
          <View className="detail-insight">
            <Text className="label">吸收与利用</Text>
            <Text>{record.absorption_notes}</Text>
          </View>
        ) : null}
        {record.context_advice ? (
          <View className="detail-insight">
            <Text className="label">情境建议</Text>
            <Text>{record.context_advice}</Text>
          </View>
        ) : null}
      </View>

      <View className="detail-card">
        <Text className="food-list-title">食物明细</Text>
        {items.length > 0 ? (
          items.map((item, index) => {
            const cal = itemCalorie(item)
            const ratio = item.ratio ?? 100
            const protein = ((item.nutrients?.protein ?? 0) * ratio) / 100
            const carbs = ((item.nutrients?.carbs ?? 0) * ratio) / 100
            const fat = ((item.nutrients?.fat ?? 0) * ratio) / 100
            return (
              <View key={index} className="food-item">
                <View className="food-info">
                  <Text className="food-name">{item.name}</Text>
                  <Text className="food-meta">
                    摄入 {item.intake ?? 0}g
                    {ratio !== 100 ? ` · 约 ${ratio}%` : ''}
                  </Text>
                </View>
                <View className="food-nutrients">
                  <Text className="food-calorie">{Math.round(cal * 10) / 10} kcal</Text>
                  <Text className="food-macros">P {protein.toFixed(0)} · C {carbs.toFixed(0)} · F {fat.toFixed(0)}g</Text>
                </View>
              </View>
            )
          })
        ) : (
          <View className="empty-tip">暂无食物明细</View>
        )}

        <View className="summary-row">
          <Text>总重量</Text>
          <Text className="value">{record.total_weight_grams ?? 0} g</Text>
        </View>
        <View className="summary-row">
          <Text>蛋白质</Text>
          <Text className="value">{Math.round((record.total_protein ?? 0) * 10) / 10} g</Text>
        </View>
        <View className="summary-row">
          <Text>碳水</Text>
          <Text className="value">{Math.round((record.total_carbs ?? 0) * 10) / 10} g</Text>
        </View>
        <View className="summary-row">
          <Text>脂肪</Text>
          <Text className="value">{Math.round((record.total_fat ?? 0) * 10) / 10} g</Text>
        </View>
      </View>
    </ScrollView>
  )
}
