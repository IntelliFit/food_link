import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { listAnalyzeTasks, type AnalysisTask, type AnalyzeResponse } from '../../utils/api'
import './index.scss'

const STATUS_MAP: Record<string, string> = {
  pending: '排队中',
  processing: '识别中',
  done: '已完成',
  failed: '识别失败'
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function AnalyzeHistoryPage() {
  const [tasks, setTasks] = useState<AnalysisTask[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const { tasks: list } = await listAnalyzeTasks({ task_type: 'food' })
      setTasks(list || [])
    } catch (e: any) {
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const onTaskTap = (task: AnalysisTask) => {
    if (task.status === 'done' && task.result) {
      const result = task.result as AnalyzeResponse
      const payload = task.payload || {}
      Taro.setStorageSync('analyzeImagePath', task.image_url)
      Taro.setStorageSync('analyzeResult', JSON.stringify(result))
      Taro.setStorageSync('analyzeCompareMode', false)
      Taro.setStorageSync('analyzeMealType', payload.meal_type || 'breakfast')
      Taro.setStorageSync('analyzeDietGoal', payload.diet_goal || 'none')
      Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing || 'none')
      Taro.setStorageSync('analyzeSourceTaskId', task.id)
      Taro.navigateTo({ url: '/pages/result/index' })
      return
    }
    if (task.status === 'pending' || task.status === 'processing') {
      Taro.showToast({ title: '任务仍在处理中，请稍后再看', icon: 'none' })
      return
    }
    if (task.status === 'failed') {
      Taro.showToast({ title: task.error_message || '识别失败', icon: 'none' })
    }
  }

  return (
    <View className="analyze-history-page">
      <View className="header">
        <Text className="title">分析历史</Text>
        <Text className="desc">可在此查看识别结果，并将结果保存为饮食记录</Text>
      </View>
      <ScrollView className="list" scrollY>
        {loading ? (
          <View className="loading-wrap">加载中...</View>
        ) : tasks.length === 0 ? (
          <View className="empty">
            <View className="empty-icon">📷</View>
            <Text className="empty-text">暂时没有记录，快去拍一张吧~</Text>
          </View>
        ) : (
          tasks.map(t => (
            <View
              key={t.id}
              className="task-card"
              onClick={() => onTaskTap(t)}
            >
              <View className="thumb">
                {t.image_url ? (
                  <Image src={t.image_url} mode="aspectFill" />
                ) : null}
              </View>
              <View className="body">
                <Text className="time">{formatTime(t.created_at)}</Text>
                <View className={`status-row status-${t.status}`}>
                  <View className="status-dot"></View>
                  <Text className="status-text">{STATUS_MAP[t.status] || t.status}</Text>
                </View>
              </View>
              {(t.status === 'done' || t.status === 'failed') && (
                <Text className="arrow">›</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}
