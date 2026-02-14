import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { listAnalyzeTasks, type AnalysisTask, type AnalyzeResponse } from '../../utils/api'
import './index.scss'

const STATUS_MAP: Record<string, string> = {
  pending: '排队中',
  processing: '识别中',
  done: '已完成',
  failed: '识别失败',
  violated: '内容违规'
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
      // 获取图片分析和文字分析任务
      const [foodRes, textRes] = await Promise.all([
        listAnalyzeTasks({ task_type: 'food' }).catch(() => ({ tasks: [] })),
        listAnalyzeTasks({ task_type: 'food_text' }).catch(() => ({ tasks: [] }))
      ])
      const allTasks = [...(foodRes.tasks || []), ...(textRes.tasks || [])]
      // 按创建时间倒序排列
      allTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setTasks(allTasks)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    load()
  })

  const onTaskTap = (task: AnalysisTask) => {
    // 违规任务不允许查看详情
    if (task.status === 'violated' || task.is_violated) {
      Taro.showModal({
        title: '内容违规',
        content: task.violation_reason || '该任务因内容违规被拦截，无法查看详情',
        showCancel: false,
        confirmText: '我知道了'
      })
      return
    }
    if (task.status === 'done' && task.result) {
      const result = task.result as AnalyzeResponse
      const payload = task.payload || {}
      // 图片分析任务有 image_url，文字分析任务有 text_input
      if (task.image_url) {
        Taro.setStorageSync('analyzeImagePath', task.image_url)
      } else {
        // 文字分析任务，清空图片路径
        Taro.removeStorageSync('analyzeImagePath')
      }
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
            <View className="empty-icon">
              <Text className="iconfont icon-paizhao-xianxing" style={{ fontSize: '80rpx', color: '#9ca3af' }} />
            </View>
            <Text className="empty-text">暂时没有记录，快去拍一张吧~</Text>
          </View>
        ) : (
          tasks.map(t => (
            <View
              key={t.id}
              className={`task-card ${t.status === 'violated' || t.is_violated ? 'task-card-violated' : ''}`}
              onClick={() => onTaskTap(t)}
            >
              <View className="thumb">
                {t.status === 'violated' || t.is_violated ? (
                  // 违规任务显示警告图标，不展示原图
                  <View className="thumb-violated">
                    <Text className="iconfont icon-jinggao" style={{ fontSize: '48rpx', color: '#ef4444' }} />
                  </View>
                ) : t.image_url ? (
                  <Image src={t.image_url} mode="aspectFill" />
                ) : (
                  // 文字分析任务显示文字图标
                  <View className="thumb-placeholder">
                    <Text className="iconfont icon-xingzhuang-wenzi" style={{ fontSize: '48rpx', color: '#15803d' }} />
                  </View>
                )}
              </View>
              <View className="body">
                <Text className="time">{formatTime(t.created_at)}</Text>
                {/* 显示任务类型标签 */}
                <View className="task-type-tag">
                  <Text className="task-type-text">
                    {t.task_type === 'food_text' ? '文字识别' : '图片识别'}
                  </Text>
                </View>
                <View className={`status-row status-${t.status}`}>
                  <View className="status-dot"></View>
                  <Text className="status-text">{STATUS_MAP[t.status] || t.status}</Text>
                </View>
                {/* 违规任务显示违规原因 */}
                {(t.status === 'violated' || t.is_violated) && t.violation_reason && (
                  <Text className="violation-reason">{t.violation_reason}</Text>
                )}
              </View>
              {(t.status === 'done' || t.status === 'failed') && !t.is_violated && (
                <Text className="arrow">›</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}
