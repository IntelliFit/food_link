import { View, Text, Input, ScrollView } from '@tarojs/components'
import { useState, useRef, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { Button } from '@taroify/core'
import { IconSend, IconExercise } from '../../components/iconfont'
import './index.scss'

// 模拟的运动记录类型
interface ExerciseRecord {
  id: string
  content: string
  calories: number
  duration?: number
  createdAt: string
}

// 模拟解析运动描述
function parseExerciseDescription(input: string): { type: string; calories: number; duration?: number } | null {
  const lowerInput = input.toLowerCase()
  
  // 简单的运动类型匹配和热量估算
  const exerciseTypes = [
    { keywords: ['跑步', '慢跑', '跑'], caloriesPerHour: 600, type: '跑步' },
    { keywords: ['游泳', '游'], caloriesPerHour: 500, type: '游泳' },
    { keywords: ['骑行', '骑车', '自行车'], caloriesPerHour: 400, type: '骑行' },
    { keywords: ['走路', '散步', '走'], caloriesPerHour: 250, type: '走路' },
    { keywords: ['健身', '力量训练', '举重'], caloriesPerHour: 350, type: '健身' },
    { keywords: ['瑜伽', '瑜伽'], caloriesPerHour: 200, type: '瑜伽' },
    { keywords: ['篮球', '打球'], caloriesPerHour: 450, type: '篮球' },
    { keywords: ['羽毛球', '羽毛球'], caloriesPerHour: 350, type: '羽毛球' },
    { keywords: ['跳绳', '跳绳'], caloriesPerHour: 700, type: '跳绳' },
    { keywords: ['爬楼梯', '爬楼'], caloriesPerHour: 500, type: '爬楼梯' },
    { keywords: ['跳舞', '舞蹈'], caloriesPerHour: 400, type: '跳舞' },
    { keywords: ['椭圆机', '椭圆仪'], caloriesPerHour: 450, type: '椭圆机' },
    { keywords: ['划船机', '划船'], caloriesPerHour: 500, type: '划船机' },
    { keywords: ['HIIT', '高强度'], caloriesPerHour: 800, type: 'HIIT' }
  ]
  
  // 匹配运动类型
  let matchedType = exerciseTypes.find(type => 
    type.keywords.some(keyword => lowerInput.includes(keyword))
  )
  
  if (!matchedType) {
    matchedType = { caloriesPerHour: 300, type: '运动' }
  }
  
  // 提取时长（分钟）
  let duration: number | undefined
  const durationMatch = input.match(/(\d+)\s*(分钟|分|min|小时|h)/i)
  if (durationMatch) {
    const value = parseInt(durationMatch[1])
    const unit = durationMatch[2]
    if (unit.includes('小时') || unit.includes('h')) {
      duration = value * 60
    } else {
      duration = value
    }
  }
  
  // 计算热量
  const calories = duration 
    ? Math.round((matchedType.caloriesPerHour / 60) * duration)
    : Math.round(matchedType.caloriesPerHour * 0.5) // 默认30分钟
  
  return {
    type: matchedType.type,
    calories,
    duration
  }
}

export default function ExerciseRecordPage() {
  const [inputValue, setInputValue] = useState('')
  const [records, setRecords] = useState<ExerciseRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<{ scrollTo: (params: { top: number; animated?: boolean }) => void } | null>(null)

  // 加载今日记录
  useEffect(() => {
    loadTodayRecords()
  }, [])

  const loadTodayRecords = () => {
    try {
      const stored = Taro.getStorageSync('exercise_records_today')
      if (stored) {
        setRecords(stored as ExerciseRecord[])
      }
    } catch {
      // ignore
    }
  }

  const saveRecords = (newRecords: ExerciseRecord[]) => {
    try {
      Taro.setStorageSync('exercise_records_today', newRecords)
    } catch {
      // ignore
    }
  }

  const handleSend = async () => {
    const content = inputValue.trim()
    if (!content) {
      Taro.showToast({ title: '请输入运动描述', icon: 'none' })
      return
    }

    setIsLoading(true)
    
    // 模拟解析延迟
    await new Promise(resolve => setTimeout(resolve, 800))
    
    const parsed = parseExerciseDescription(content)
    
    if (parsed) {
      const newRecord: ExerciseRecord = {
        id: Date.now().toString(),
        content,
        calories: parsed.calories,
        duration: parsed.duration,
        createdAt: new Date().toISOString()
      }
      
      const updatedRecords = [...records, newRecord]
      setRecords(updatedRecords)
      saveRecords(updatedRecords)
      setInputValue('')
      
      Taro.showToast({ 
        title: `已记录: ${parsed.type} ${parsed.calories}kcal`, 
        icon: 'success' 
      })
    } else {
      Taro.showToast({ title: '无法识别运动类型', icon: 'none' })
    }
    
    setIsLoading(false)
  }

  const handleDelete = (id: string) => {
    Taro.showModal({
      title: '确认删除',
      content: '确定要删除这条运动记录吗？',
      success: (res) => {
        if (res.confirm) {
          const updatedRecords = records.filter(r => r.id !== id)
          setRecords(updatedRecords)
          saveRecords(updatedRecords)
        }
      }
    })
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  const totalCalories = records.reduce((sum, r) => sum + r.calories, 0)

  return (
    <View className='exercise-record-page'>
      {/* 头部统计 */}
      <View className='header-stats'>
        <View className='stats-card'>
          <View className='stats-icon-wrap'>
            <IconExercise size={40} color='#f97316' />
          </View>
          <View className='stats-info'>
            <Text className='stats-label'>今日消耗</Text>
            <View className='stats-value-wrap'>
              <Text className='stats-value'>{totalCalories}</Text>
              <Text className='stats-unit'>kcal</Text>
            </View>
          </View>
          <Text className='stats-count'>{records.length} 次记录</Text>
        </View>
      </View>

      {/* 聊天记录区域 */}
      <ScrollView
        className='chat-container'
        scrollY
        scrollWithAnimation
        scrollTop={99999}
        enhanced
        showScrollbar={false}
      >
        {records.length === 0 ? (
          <View className='empty-state'>
            <View className='empty-icon-wrap'>
              <IconExercise size={80} color='#d1d5db' />
            </View>
            <Text className='empty-title'>还没有运动记录</Text>
            <Text className='empty-desc'>在下方输入你今天做了什么运动{'\n'}例如："跑步30分钟" 或 "游泳1小时"</Text>
            
            {/* 快捷示例 */}
            <View className='quick-examples'>
              <Text className='quick-examples-title'>试试这样说：</Text>
              <View className='example-tags'>
                {['跑步30分钟', '游泳45分钟', '瑜伽1小时', '骑车20分钟'].map((example) => (
                  <View 
                    key={example} 
                    className='example-tag'
                    onClick={() => setInputValue(example)}
                  >
                    <Text className='example-tag-text'>{example}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : (
          <View className='chat-list'>
            {records.map((record) => (
              <View key={record.id} className='chat-item user'>
                <View className='chat-bubble'>
                  <Text className='chat-content'>{record.content}</Text>
                </View>
                <View className='chat-meta'>
                  <View className='chat-result'>
                    <IconExercise size={14} color='#f97316' />
                    <Text className='chat-result-text'>
                      消耗 {record.calories} kcal
                      {record.duration ? ` · ${record.duration}分钟` : ''}
                    </Text>
                  </View>
                  <Text className='chat-time'>{formatTime(record.createdAt)}</Text>
                </View>
                <View 
                  className='chat-delete'
                  onClick={() => handleDelete(record.id)}
                >
                  <Text className='chat-delete-text'>删除</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: '20rpx' }} />
      </ScrollView>

      {/* 输入区域 */}
      <View className='input-section'>
        <View className='input-wrap'>
          <Input
            className='chat-input'
            value={inputValue}
            onInput={(e) => setInputValue(e.detail.value)}
            placeholder='今天做了什么运动？'
            placeholderClass='input-placeholder'
            confirmType='send'
            onConfirm={handleSend}
            disabled={isLoading}
          />
          <View 
            className={`send-btn ${!inputValue.trim() || isLoading ? 'disabled' : ''}`}
            onClick={handleSend}
          >
            {isLoading ? (
              <View className='send-spinner' />
            ) : (
              <IconSend size={28} color='#fff' />
            )}
          </View>
        </View>
        <Text className='input-hint'>输入运动描述，AI自动计算热量消耗</Text>
      </View>
    </View>
  )
}
