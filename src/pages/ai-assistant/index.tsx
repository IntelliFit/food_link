import { View, Text, Input, ScrollView } from '@tarojs/components'
import { useState } from 'react'

import './index.scss'

export default function AiAssistantPage() {
  const [inputValue, setInputValue] = useState('')

  // 专家列表
  const experts = [
    { icon: '🔥', name: '减脂专家' },
    { icon: '💪', name: '增肌教练' },
    { icon: '🥗', name: '营养分析师' },
    { icon: '🏃', name: '运动顾问' }
  ]

  // 健康档案数据
  const healthProfile = {
    goal: { label: '目标', value: '减脂', icon: '📉' },
    bmi: { label: 'BMI', value: '23.5', icon: '❤️' },
    progress: { label: '进度', value: '-3kg', icon: '📈' }
  }

  // 快捷提问
  const quickQuestions = [
    '今天吃什么好？',
    '如何控制卡路里？',
    '运动后怎么补充？',
    '减肥期间饮食建议'
  ]

  // 对话消息
  const [messages] = useState([
    {
      id: 1,
      type: 'ai',
      sender: 'AI助手',
      content: '您好！我是您的AI营养助手，可以根据您的饮食记录和健康目标，为您提供个性化的营养建议。',
      time: '10:30'
    },
    {
      id: 2,
      type: 'user',
      sender: '我',
      content: '今天我想减重，应该怎么安排饮食？',
      time: '10:32'
    },
    {
      id: 3,
      type: 'ai',
      sender: 'AI助手',
      content: '根据您的健康档案，建议您：\n1. 控制总热量在1500-1800kcal\n2. 增加蛋白质摄入，每餐至少30g\n3. 多吃蔬菜，保证膳食纤维\n4. 减少精制糖和加工食品',
      time: '10:33'
    }
  ])

  const handleSendMessage = () => {
    if (!inputValue.trim()) return
    
    // 这里应该调用API发送消息
    console.log('发送消息:', inputValue)
    setInputValue('')
  }

  const handleQuickQuestion = (question: string) => {
    setInputValue(question)
    // 可以自动发送或让用户确认
  }

  const handleExpertClick = (expert: { icon: string; name: string }) => {
    setInputValue(`我想咨询${expert.name}相关的问题`)
  }

  return (
    <View className='ai-assistant-page'>
      <ScrollView
        className='content-scroll'
        scrollY
        style={{ paddingBottom: '120rpx' }}
      >
        {/* 顶部渐变区域 */}
        <View className='header-section'>
          <View className='header-content'>
            <View className='header-text'>
              <Text className='header-title'>AI助手</Text>
              <Text className='header-subtitle'>你的智能健康顾问团队</Text>
            </View>
            <View className='header-icon'>
              <Text>✨</Text>
            </View>
          </View>

          {/* 专家列表 */}
          <View className='experts-list'>
            {experts.map((expert, index) => (
              <View
                key={index}
                className='expert-btn'
                onClick={() => handleExpertClick(expert)}
              >
                <View className='expert-icon'>
                  <Text>{expert.icon}</Text>
                </View>
                <Text className='expert-name'>{expert.name}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 健康档案卡片 */}
        <View className='health-profile-card'>
          <View className='card-header'>
            <Text className='card-title'>你的健康档案</Text>
            <View className='detail-btn'>
              <Text className='detail-text'>详情</Text>
              <Text className='detail-arrow'>{'>'}</Text>
            </View>
          </View>
          <View className='profile-metrics'>
            <View className='metric-item'>
              <View className='metric-icon goal-icon'>
                <Text>{healthProfile.goal.icon}</Text>
              </View>
              <Text className='metric-label'>{healthProfile.goal.label}</Text>
              <Text className='metric-value'>{healthProfile.goal.value}</Text>
            </View>
            <View className='metric-item'>
              <View className='metric-icon bmi-icon'>
                <Text>{healthProfile.bmi.icon}</Text>
              </View>
              <Text className='metric-label'>{healthProfile.bmi.label}</Text>
              <Text className='metric-value'>{healthProfile.bmi.value}</Text>
            </View>
            <View className='metric-item'>
              <View className='metric-icon progress-icon'>
                <Text>{healthProfile.progress.icon}</Text>
              </View>
              <Text className='metric-label'>{healthProfile.progress.label}</Text>
              <Text className='metric-value'>{healthProfile.progress.value}</Text>
            </View>
          </View>
        </View>

        {/* 今日智能建议 */}
        <View className='suggestion-card'>
          <View className='suggestion-content'>
            <View className='suggestion-icon'>
              <Text>💡</Text>
            </View>
            <View className='suggestion-text'>
              <Text className='suggestion-title'>今日智能建议</Text>
              <Text className='suggestion-desc'>
                你本周已坚持记录5天,表现很棒!💪 今天建议适量增加蔬菜摄入,晚餐后可以进行30分钟快走。
              </Text>
              <View className='suggestion-buttons'>
                <View className='suggestion-btn'>
                  <Text className='suggestion-btn-text'>查看食谱</Text>
                </View>
                <View className='suggestion-btn'>
                  <Text className='suggestion-btn-text'>运动计划</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* 快捷提问 */}
        <View className='quick-questions-section'>
          <Text className='section-title'>快捷提问</Text>
          <View className='questions-grid'>
            {quickQuestions.map((question, index) => (
              <View
                key={index}
                className='question-btn'
                onClick={() => handleQuickQuestion(question)}
              >
                <Text>{question}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 最近对话 */}
        <View className='conversations-section'>
          <View className='section-header'>
            <Text className='chat-icon'>💬</Text>
            <Text className='section-title'>最近对话</Text>
          </View>
          <View className='conversations-list'>
            {messages.map((message) => (
              <View
                key={message.id}
                className={`message-card ${message.type}-message`}
              >
                <View className='message-header'>
                  <Text className='message-icon'>
                    {message.type === 'ai' ? '🤖' : '👤'}
                  </Text>
                  <Text className='message-sender'>{message.sender}</Text>
                </View>
                <Text className='message-content'>{message.content}</Text>
                <Text className='message-time'>{message.time}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* 输入框区域 */}
      <View className='input-section'>
        <View className='input-container'>
          <View className='input-box'>
            <Input
              placeholder='输入您的问题...'
              placeholderClass='input-placeholder'
              value={inputValue}
              onInput={(e) => setInputValue(e.detail.value)}
              confirmType='send'
              onConfirm={handleSendMessage}
            />
          </View>
          <View className='send-btn' onClick={handleSendMessage}>
            <Text className='send-icon'>→</Text>
          </View>
        </View>
      </View>
    </View>
  )
}


