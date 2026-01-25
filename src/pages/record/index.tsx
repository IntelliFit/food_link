import { View, Text, Image, Input } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'

import './index.scss'

export default function RecordPage() {
  const [activeMethod, setActiveMethod] = useState('photo')
  const [foodText, setFoodText] = useState('')
  const [foodAmount, setFoodAmount] = useState('')
  const [selectedMeal, setSelectedMeal] = useState('breakfast')
  const [selectedTime, setSelectedTime] = useState('')

  const recordMethods = [
    { id: 'photo', icon: '📷', text: '拍照识别', iconClass: 'photo-icon' },
    { id: 'text', icon: '✏️', text: '文字记录', iconClass: 'text-icon' },
    { id: 'history', icon: '📋', text: '历史记录', iconClass: 'history-icon' }
  ]

  const handleMethodClick = (methodId: string) => {
    setActiveMethod(methodId)
  }

  const handleChooseImage = () => {
    Taro.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const imagePath = res.tempFilePaths[0]
        console.log('选择的图片:', res.tempFilePaths)
        // 将图片路径存储到全局数据中
        Taro.setStorageSync('analyzeImagePath', imagePath)
        // 直接跳转到分析页面
        Taro.navigateTo({
          url: '/pages/analyze/index'
        })
      },
      fail: (err) => {
        console.error('选择图片失败:', err)
        Taro.showToast({
          title: '选择图片失败',
          icon: 'none'
        })
      }
    })
  }


  const meals = [
    { id: 'breakfast', name: '早餐', icon: '🌅', color: '#ff6900' },
    { id: 'lunch', name: '午餐', icon: '☀️', color: '#00c950' },
    { id: 'dinner', name: '晚餐', icon: '🌙', color: '#2b7fff' },
    { id: 'snack', name: '加餐', icon: '🍎', color: '#ad46ff' }
  ]

  const commonFoods = [
    '米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包',
    '蔬菜', '水果', '鱼', '牛肉', '豆腐', '酸奶', '坚果', '更多'
  ]

  const handleMealSelect = (mealId: string) => {
    setSelectedMeal(mealId)
  }

  const handleCommonFoodClick = (food: string) => {
    if (food === '更多') {
      // 可以打开更多食物选择
      return
    }
    setFoodText(food)
  }

  const handleTimeSelect = () => {
    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    
    // 如果没有选择时间，默认使用当前时间
    if (!selectedTime) {
      setSelectedTime(currentTime)
    } else {
      // 可以打开时间选择器
      Taro.showActionSheet({
        itemList: ['使用当前时间', '手动输入'],
        success: (res) => {
          if (res.tapIndex === 0) {
            setSelectedTime(currentTime)
          }
        }
      })
    }
  }

  const handleSubmitFood = () => {
    if (!foodText.trim()) {
      Taro.showToast({
        title: '请输入食物名称',
        icon: 'none'
      })
      return
    }
    
    const now = new Date()
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    
    const foodData = {
      name: foodText,
      amount: foodAmount || '1份',
      meal: selectedMeal,
      time: selectedTime || defaultTime
    }
    
    console.log('添加食物:', foodData)
    Taro.showToast({
      title: '添加成功',
      icon: 'success'
    })
    
    // 重置表单
    setFoodText('')
    setFoodAmount('')
    setSelectedTime('')
  }

  // 历史记录数据
  const getTodayDate = () => {
    return new Date().toISOString().split('T')[0]
  }
  
  const [selectedDate, setSelectedDate] = useState(getTodayDate())
  
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    const weekday = weekdays[date.getDay()]
    const today = new Date()
    const isToday = dateStr === today.toISOString().split('T')[0]
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = dateStr === yesterday.toISOString().split('T')[0]
    
    if (isToday) {
      return `${month}月${day}日 今天`
    } else if (isYesterday) {
      return `${month}月${day}日 昨天`
    }
    return `${month}月${day}日 周${weekday}`
  }
  
  const getYesterdayDate = () => {
    const date = new Date()
    date.setDate(date.getDate() - 1)
    return date.toISOString().split('T')[0]
  }
  
  const allHistoryRecords = [
    {
      id: 1,
      date: getTodayDate(),
      meals: [
        {
          id: 1,
          mealType: 'breakfast',
          mealName: '早餐',
          time: '08:30',
          foods: [
            { name: '鸡蛋', amount: '2个', calorie: 140 },
            { name: '全麦面包', amount: '2片', calorie: 160 },
            { name: '牛奶', amount: '200ml', calorie: 120 }
          ],
          totalCalorie: 420
        },
        {
          id: 2,
          mealType: 'lunch',
          mealName: '午餐',
          time: '12:15',
          foods: [
            { name: '米饭', amount: '1碗', calorie: 200 },
            { name: '鸡胸肉', amount: '150g', calorie: 250 },
            { name: '青菜', amount: '200g', calorie: 50 }
          ],
          totalCalorie: 500
        },
        {
          id: 3,
          mealType: 'dinner',
          mealName: '晚餐',
          time: '18:30',
          foods: [
            { name: '面条', amount: '1碗', calorie: 300 },
            { name: '牛肉', amount: '100g', calorie: 200 },
            { name: '蔬菜沙拉', amount: '150g', calorie: 60 }
          ],
          totalCalorie: 560
        }
      ],
      totalCalorie: 1480
    },
    {
      id: 2,
      date: getYesterdayDate(),
      meals: [
        {
          id: 4,
          mealType: 'breakfast',
          mealName: '早餐',
          time: '08:00',
          foods: [
            { name: '燕麦粥', amount: '1碗', calorie: 150 },
            { name: '香蕉', amount: '1根', calorie: 90 }
          ],
          totalCalorie: 240
        },
        {
          id: 5,
          mealType: 'lunch',
          mealName: '午餐',
          time: '12:30',
          foods: [
            { name: '米饭', amount: '1碗', calorie: 200 },
            { name: '鱼', amount: '150g', calorie: 180 },
            { name: '豆腐', amount: '100g', calorie: 80 }
          ],
          totalCalorie: 460
        }
      ],
      totalCalorie: 700
    }
  ]

  // 根据选中日期筛选记录
  const currentDateRecords = allHistoryRecords.find(record => record.date === selectedDate)
  const historyRecords = currentDateRecords ? [currentDateRecords] : []

  const handleEditRecord = (recordId: number) => {
    console.log('编辑记录:', recordId)
    // 可以跳转到编辑页面
  }

  const handleDeleteRecord = (recordId: number) => {
    Taro.showModal({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      success: (res) => {
        if (res.confirm) {
          console.log('删除记录:', recordId)
          Taro.showToast({
            title: '删除成功',
            icon: 'success'
          })
        }
      }
    })
  }

  const tips = [
    '拍照时请确保食物清晰可见，光线充足',
    '尽量将食物放在白色或浅色背景上',
    '一次可以识别多种食物，建议分开摆放',
    '识别结果可以手动调整和补充'
  ]

  return (
    <View className='record-page'>
      {/* 页面头部 */}
      <View className='page-header'>
        <Text className='page-title'>记录饮食</Text>
        <Text className='page-subtitle'>记录您的每一餐，让健康管理更简单</Text>
      </View>

      {/* 记录方式选择 */}
      <View className='record-methods'>
        {recordMethods.map((method) => (
          <View
            key={method.id}
            className={`method-card ${activeMethod === method.id ? 'active' : ''}`}
            onClick={() => handleMethodClick(method.id)}
          >
            <View className={`method-icon ${method.iconClass}`}>
              <Text>{method.icon}</Text>
            </View>
            <Text className='method-text'>{method.text}</Text>
          </View>
        ))}
      </View>

      {/* AI拍照识别区域 */}
      {activeMethod === 'photo' && (
        <View className='ai-recognition-section'>
          <View>
            <Text className='ai-title'>AI 拍照识别</Text>
            <Text className='ai-subtitle'>拍下您的食物，AI 帮您分析营养成分</Text>
          </View>

          <View className='upload-area' onClick={handleChooseImage}>
            <View className='upload-icon'>
              <Image
                src='/assets/page_icons/Take pictures-2.png'
                mode='aspectFit'
                className='upload-icon-image'
              />
            </View>
            <Text className='upload-text'>点击上传食物照片</Text>
            <Text className='upload-hint'>支持 JPG、PNG 格式，最大 10MB</Text>
          </View>
        </View>
      )}

      {/* Tips卡片 - 只在拍照识别页面显示 */}
      {activeMethod === 'photo' && (
        <View className='tips-section'>
          <View className='tips-header'>
            <View className='tips-badge'>
              <Text className='tips-badge-text'>Tips</Text>
            </View>
            <Text className='tips-title'>拍照识别技巧</Text>
          </View>
          <View className='tips-list'>
            {tips.map((tip, index) => (
              <View key={index} className='tip-item'>
                <Text className='tip-dot'>•</Text>
                <Text className='tip-text'>{tip}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 文字记录区域 */}
      {activeMethod === 'text' && (
        <View className='text-record-section'>
          {/* 餐次选择 */}
          <View className='meal-selector'>
            {meals.map((meal) => (
              <View
                key={meal.id}
                className={`meal-option ${selectedMeal === meal.id ? 'active' : ''}`}
                onClick={() => handleMealSelect(meal.id)}
                style={{ borderColor: selectedMeal === meal.id ? meal.color : '#e5e7eb' }}
              >
                <Text className='meal-icon'>{meal.icon}</Text>
                <Text className='meal-name'>{meal.name}</Text>
              </View>
            ))}
          </View>

          {/* 常用食物快速选择 */}
          <View className='common-foods-section'>
            <Text className='section-label'>常用食物</Text>
            <View className='common-foods-grid'>
              {commonFoods.map((food, index) => (
                <View
                  key={index}
                  className='common-food-item'
                  onClick={() => handleCommonFoodClick(food)}
                >
                  <Text className='common-food-text'>{food}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 输入卡片 */}
          <View className='text-input-card'>
            <Text className='input-label'>食物名称</Text>
            <Input
              className='food-name-input'
              placeholder='例如：一碗米饭、一个苹果'
              placeholderClass='input-placeholder'
              value={foodText}
              onInput={(e) => setFoodText(e.detail.value)}
              maxlength={50}
            />

            <View className='input-row'>
              <View className='input-group'>
                <Text className='input-label-small'>数量</Text>
                <Input
                  className='amount-input'
                  placeholder='例如：1碗、200g'
                  placeholderClass='input-placeholder'
                  value={foodAmount}
                  onInput={(e) => setFoodAmount(e.detail.value)}
                  maxlength={20}
                />
              </View>
              <View className='input-group'>
                <Text className='input-label-small'>时间</Text>
                <View className='time-picker' onClick={handleTimeSelect}>
                  <Text className={selectedTime ? 'time-text' : 'time-placeholder'}>
                    {selectedTime || '选择时间'}
                  </Text>
                  <Text className='time-icon'>🕐</Text>
                </View>
              </View>
            </View>

            <View className='action-buttons'>
              <View className='action-btn primary-btn' onClick={handleSubmitFood}>
                <Text className='btn-text'>确认添加</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 历史记录区域 */}
      {activeMethod === 'history' && (
        <View className='history-section'>
          {/* 日期选择 */}
          <View className='date-selector'>
            <View className='date-card'>
              <Text className='date-label'>选择日期</Text>
              <View className='date-display' onClick={() => {
                // 切换日期：今天、昨天、前天
                const today = new Date()
                const todayStr = today.toISOString().split('T')[0]
                const yesterday = new Date(today)
                yesterday.setDate(yesterday.getDate() - 1)
                const yesterdayStr = yesterday.toISOString().split('T')[0]
                const dayBefore = new Date(today)
                dayBefore.setDate(dayBefore.getDate() - 2)
                const dayBeforeStr = dayBefore.toISOString().split('T')[0]
                
                Taro.showActionSheet({
                  itemList: [
                    formatDate(todayStr),
                    formatDate(yesterdayStr),
                    formatDate(dayBeforeStr)
                  ],
                  success: (res) => {
                    if (res.tapIndex === 0) {
                      setSelectedDate(todayStr)
                    } else if (res.tapIndex === 1) {
                      setSelectedDate(yesterdayStr)
                    } else if (res.tapIndex === 2) {
                      setSelectedDate(dayBeforeStr)
                    }
                  }
                })
              }}>
                <Text className='date-text'>{formatDate(selectedDate)}</Text>
                <Text className='date-icon'>📅</Text>
              </View>
            </View>
            <View className='date-stats'>
              <View className='stat-item'>
                <Text className='stat-label'>总摄入</Text>
                <Text className='stat-value'>{historyRecords[0]?.totalCalorie || 0} kcal</Text>
              </View>
              <View className='stat-item'>
                <Text className='stat-label'>目标</Text>
                <Text className='stat-value'>2000 kcal</Text>
              </View>
            </View>
          </View>

          {/* 记录列表 */}
          {historyRecords.length > 0 && historyRecords[0].meals.length > 0 ? (
            <View className='history-list'>
              {historyRecords[0].meals.map((meal) => (
                <View key={meal.id} className='history-meal-card'>
                  <View className='meal-card-header'>
                    <View className='meal-header-left'>
                      <View className={`meal-type-icon ${meal.mealType}-icon`}>
                        <Text>{meal.mealType === 'breakfast' ? '🌅' : meal.mealType === 'lunch' ? '☀️' : meal.mealType === 'dinner' ? '🌙' : '🍎'}</Text>
                      </View>
                      <View className='meal-header-info'>
                        <Text className='meal-card-name'>{meal.mealName}</Text>
                        <Text className='meal-card-time'>{meal.time}</Text>
                      </View>
                    </View>
                    <View className='meal-header-right'>
                      <Text className='meal-calorie'>{meal.totalCalorie} kcal</Text>
                      <View className='meal-actions'>
                        <View className='action-icon' onClick={() => handleEditRecord(meal.id)}>
                          <Text>✏️</Text>
                        </View>
                        <View className='action-icon' onClick={() => handleDeleteRecord(meal.id)}>
                          <Text>🗑️</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                  <View className='food-list'>
                    {meal.foods.map((food, index) => (
                      <View key={index} className='food-item'>
                        <View className='food-info'>
                          <Text className='food-name'>{food.name}</Text>
                          <Text className='food-amount'>{food.amount}</Text>
                        </View>
                        <Text className='food-calorie'>{food.calorie} kcal</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className='empty-state'>
              <Text className='empty-icon'>📝</Text>
              <Text className='empty-text'>暂无记录</Text>
              <Text className='empty-hint'>开始记录您的饮食吧</Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}


