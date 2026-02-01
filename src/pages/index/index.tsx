import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { getHomeDashboard, getAccessToken, type HomeIntakeData, type HomeMealItem } from '../../utils/api'

import './index.scss'

const DEFAULT_INTAKE: HomeIntakeData = {
  current: 0,
  target: 2000,
  progress: 0,
  macros: {
    protein: { current: 0, target: 120 },
    carbs: { current: 0, target: 250 },
    fat: { current: 0, target: 65 }
  }
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function getMealIcon(type: string): string {
  if (type === 'breakfast') return '🌅'
  if (type === 'lunch') return '☀️'
  if (type === 'dinner') return '🌙'
  return '🍎'
}

export default function IndexPage() {
  const [intakeData, setIntakeData] = useState<HomeIntakeData>(DEFAULT_INTAKE)
  const [meals, setMeals] = useState<HomeMealItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAccessToken()) {
      setLoading(false)
      return
    }
    getHomeDashboard()
      .then((res) => {
        setIntakeData(res.intakeData)
        setMeals(res.meals || [])
      })
      .catch(() => {
        setIntakeData(DEFAULT_INTAKE)
        setMeals([])
      })
      .finally(() => setLoading(false))
  }, [])

  const handleQuickRecord = (type: string) => {
    if (type === 'photo') {
      Taro.navigateTo({ url: '/pages/record/index' })
    } else if (type === 'text') {
      Taro.navigateTo({
        url: '/pages/record/index?type=text'
      })
    } else if (type === 'history') {
      Taro.navigateTo({
        url: '/pages/record/index?type=history'
      })
    }
  }

  const handleViewAllMeals = () => {
    Taro.navigateTo({
      url: '/pages/record/index'
    })
  }

  const handleAISuggestion = () => {
    Taro.navigateTo({
      url: '/pages/ai-assistant/index'
    })
  }

  const handleRecordExercise = () => {
    Taro.navigateTo({
      url: '/pages/record/index?type=exercise'
    })
  }

  return (
    <View className='home-page'>
      {/* 顶部渐变区域 */}
      <View className='header-section'>
        <View className='header-content'>
          <View className='greeting-section'>
            <Text className='greeting-title'>{getGreeting()}</Text>
            <Text className='greeting-subtitle'>今天也要健康饮食哦</Text>
          </View>
          <View className='trend-icon'>
            <View className='icon-placeholder' />
          </View>
        </View>

        {/* 今日摄入卡片 */}
        <View className='intake-card'>
          <View className='intake-header'>
            <Text className='intake-label'>今日摄入</Text>
            <Text className='target-label'>目标 {intakeData.target} kcal</Text>
          </View>
          <View className='calorie-section'>
            <Text className='calorie-value'>
              {loading ? '--' : intakeData.current}
            </Text>
            <Text className='calorie-target'>/{intakeData.target} kcal</Text>
          </View>
          <View className='progress-bar'>
            <View 
              className='progress-fill' 
              style={{ width: `${intakeData.progress}%` }}
            />
          </View>
          <View className='macros-section'>
            <View className='macro-item'>
              <Text className='macro-icon'>🥩</Text>
              <Text className='macro-label'>蛋白质</Text>
              <Text className='macro-value'>{intakeData.macros.protein.current}</Text>
              <Text className='macro-target'>/{intakeData.macros.protein.target}g</Text>
            </View>
            <View className='macro-item'>
              <Text className='macro-icon'>🍞</Text>
              <Text className='macro-label'>碳水</Text>
              <Text className='macro-value'>{intakeData.macros.carbs.current}</Text>
              <Text className='macro-target'>/{intakeData.macros.carbs.target}g</Text>
            </View>
            <View className='macro-item'>
              <Text className='macro-icon'>🥑</Text>
              <Text className='macro-label'>脂肪</Text>
              <Text className='macro-value'>{intakeData.macros.fat.current}</Text>
              <Text className='macro-target'>/{intakeData.macros.fat.target}g</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 快捷记录 */}
      <View className='quick-record-section'>
        <Text className='section-title'>快捷记录</Text>
        <View className='quick-buttons'>
          <View 
            className='quick-button photo-btn'
            onClick={() => handleQuickRecord('photo')}
          >
            <View className='button-icon photo-icon'>
              <Text>📷</Text>
            </View>
            <Text className='button-text'>拍照识别</Text>
          </View>
          <View 
            className='quick-button text-btn'
            onClick={() => handleQuickRecord('text')}
          >
            <View className='button-icon text-icon'>
              <Text>✏️</Text>
            </View>
            <Text className='button-text'>文字记录</Text>
          </View>
          <View 
            className='quick-button history-btn'
            onClick={() => handleQuickRecord('history')}
          >
            <View className='button-icon history-icon'>
              <Text>📋</Text>
            </View>
            <Text className='button-text'>历史记录</Text>
          </View>
        </View>
      </View>

      {/* 今日餐食 */}
      <View className='meals-section'>
        <View className='section-header'>
          <Text className='section-title'>今日餐食</Text>
          <View className='view-all-btn' onClick={handleViewAllMeals}>
            <Text className='view-all-text'>查看全部</Text>
            <Text className='arrow'>→</Text>
          </View>
        </View>
        <View className='meals-list'>
          {loading ? null : meals.length === 0 ? (
            <View className='meals-empty'>
              <Text className='meals-empty-text'>暂无今日餐食，去记录一餐吧</Text>
            </View>
          ) : (
          meals.map((meal, index) => (
            <View key={`${meal.type}-${index}`} className='meal-card'>
              <View className='meal-header'>
                <View className='meal-info'>
                  <View className={`meal-icon ${meal.type}-icon`}>
                    <Text>{getMealIcon(meal.type)}</Text>
                  </View>
                  <View className='meal-details'>
                    <Text className='meal-name'>{meal.name}</Text>
                    <Text className='meal-time'>{meal.time}</Text>
                  </View>
                </View>
                <View className='meal-calorie'>
                  <Text className='calorie-text'>{meal.calorie} kcal</Text>
                  <Text className='calorie-label'>目标 {meal.target} kcal</Text>
                </View>
              </View>
              <View className='meal-progress'>
                <View className='meal-progress-bar'>
                  <View 
                    className={`meal-progress-fill ${meal.type}-progress`}
                    style={{ width: `${meal.progress}%` }}
                  />
                </View>
                <Text className='progress-percent'>{Number(meal.progress).toFixed(0)}%</Text>
              </View>
              {meal.tags && meal.tags.length > 0 && (
                <View className='meal-tags'>
                  {meal.tags.map((tag, tagIndex) => (
                    <View
                      key={tagIndex}
                      className={`meal-tag ${meal.type}-tag`}
                    >
                      <Text className='tag-text'>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )))}
        </View>
      </View>

      {/* AI建议 */}
      <View className='ai-suggestion-section' onClick={handleAISuggestion}>
        <View className='ai-content'>
          <View className='ai-icon'>
            <Text>🤖</Text>
          </View>
          <View className='ai-text-content'>
            <Text className='ai-title'>AI 营养建议</Text>
            <Text className='ai-description'>根据您的饮食记录，为您推荐个性化建议</Text>
          </View>
        </View>
        <View className='ai-button'>
          <Text className='ai-button-text'>查看建议</Text>
        </View>
      </View>

      {/* 今日运动 */}
      <View className='exercise-section'>
        <View className='section-header'>
          <View className='exercise-header-left'>
            <View className='exercise-icon'>
              <Text>🏃</Text>
            </View>
            <Text className='section-title'>今日运动</Text>
          </View>
          <Text className='record-btn' onClick={handleRecordExercise}>记录</Text>
        </View>
        <View className='exercise-stats'>
          <View className='stat-card'>
            <Text className='stat-label'>运动时长</Text>
            <Text className='stat-value'>30 分钟</Text>
          </View>
          <View className='stat-card'>
            <Text className='stat-label'>消耗卡路里</Text>
            <Text className='stat-value'>180 kcal</Text>
          </View>
        </View>
      </View>
    </View>
  )
}


