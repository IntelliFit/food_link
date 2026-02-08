import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { getHomeDashboard, getAccessToken, type HomeIntakeData, type HomeMealItem } from '../../utils/api'
import { IconCamera, IconText, IconClock, IconProtein, IconCarbs, IconFat } from '../../components/iconfont'
import { Empty, Button } from '@taroify/core'
import { FlowerOutlined, FireOutlined, HomeOutlined, BirthdayCakeOutlined } from '@taroify/icons'
import '@taroify/icons/style'

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

// 餐次对应的 Taroify 图标及颜色
const MEAL_ICON_CONFIG = {
  breakfast: { Icon: FlowerOutlined, color: '#ff6900' },
  lunch: { Icon: FireOutlined, color: '#00c950' },
  dinner: { Icon: HomeOutlined, color: '#2b7fff' },
  snack: { Icon: BirthdayCakeOutlined, color: '#ad46ff' }
} as const

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
    // 记录页面是 tabBar 页面，需要使用 switchTab
    // switchTab 不支持传参，通过 storage 传递
    if (type === 'text') {
      Taro.setStorageSync('recordPageTab', 'text')
    } else if (type === 'history') {
      Taro.setStorageSync('recordPageTab', 'history')
    } else {
      Taro.setStorageSync('recordPageTab', 'photo')
    }
    Taro.switchTab({ url: '/pages/record/index' })
  }

  const handleViewAllMeals = () => {
    Taro.setStorageSync('recordPageTab', 'history')
    Taro.switchTab({ url: '/pages/record/index' })
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
            <Text className='iconfont icon-shangzhang trend-icon-symbol' />
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
              <View className='macro-icon'>
                <IconProtein size={28} color="#ffffff" />
              </View>
              <Text className='macro-label'>蛋白质</Text>
              <Text className='macro-value'>{intakeData.macros.protein.current}</Text>
              <Text className='macro-target'>/{intakeData.macros.protein.target}g</Text>
            </View>
            <View className='macro-item'>
              <View className='macro-icon'>
                <IconCarbs size={28} color="#ffffff" />
              </View>
              <Text className='macro-label'>碳水</Text>
              <Text className='macro-value'>{intakeData.macros.carbs.current}</Text>
              <Text className='macro-target'>/{intakeData.macros.carbs.target}g</Text>
            </View>
            <View className='macro-item'>
              <View className='macro-icon'>
                <IconFat size={28} color="#ffffff" />
              </View>
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
              <IconCamera size={44} color="#ffffff" />
            </View>
            <Text className='button-text'>拍照识别</Text>
          </View>
          <View 
            className='quick-button text-btn'
            onClick={() => handleQuickRecord('text')}
          >
            <View className='button-icon text-icon'>
              <IconText size={44} color="#ffffff" />
            </View>
            <Text className='button-text'>文字记录</Text>
          </View>
          <View 
            className='quick-button history-btn'
            onClick={() => handleQuickRecord('history')}
          >
            <View className='button-icon history-icon'>
              <IconClock size={44} color="#ffffff" />
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
            <Empty>
              <Empty.Image />
              <Empty.Description>暂无今日餐食</Empty.Description>
              <Button 
                shape="round" 
                color="primary" 
                className="empty-record-btn"
                onClick={() => handleQuickRecord('photo')}
              >
                去记录一餐
              </Button>
            </Empty>
          ) : (
          meals.map((meal, index) => (
            <View key={`${meal.type}-${index}`} className='meal-card'>
              <View className='meal-header'>
                <View className='meal-info'>
                  <View className={`meal-icon ${meal.type}-icon`}>
                    {(() => {
                      const { Icon, color } = MEAL_ICON_CONFIG[meal.type as keyof typeof MEAL_ICON_CONFIG] ?? MEAL_ICON_CONFIG.snack
                      return <Icon size={28} color={color} />
                    })()}
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
    </View>
  )
}


