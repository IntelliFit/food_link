import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import {
  recordSupplementIntake,
  showUnifiedApiError,
  type SupplementDashboardSummary,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

export interface TodaySupplementsSectionProps {
  summary: SupplementDashboardSummary
  canQuickRecord: boolean
  onRecorded: (next: SupplementDashboardSummary) => void
}

export function TodaySupplementsSection({ summary, canQuickRecord, onRecorded }: TodaySupplementsSectionProps) {
  const [busy, setBusy] = useState(false)
  const pending = summary.pending_supplement
  const openCabinet = () => Taro.navigateTo({ url: extraPkgUrl('/pages/supplements/index') })

  const quickRecord = async () => {
    if (!pending || busy) return
    if (!canQuickRecord) {
      openCabinet()
      return
    }
    setBusy(true)
    try {
      await recordSupplementIntake(pending.id, {
        servings: pending.default_servings,
        source: 'home_quick_log',
        idempotency_key: `home:${pending.id}:${Date.now()}`,
      })
      const nextCompleted = Math.min(summary.planned_count, summary.completed_count + 1)
      onRecorded({ ...summary, completed_count: nextCompleted, pending_supplement: null })
      const now = new Date()
      const offset = now.getTimezoneOffset() * 60_000
      const date = new Date(now.getTime() - offset).toISOString().slice(0, 10)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date, force: true })
      Taro.showToast({ title: '已记录', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '记录补剂失败')
    } finally {
      setBusy(false)
    }
  }

  const completed = summary.completed_count || 0
  const planned = summary.planned_count || 0
  return (
    <View className='today-supplements-card'>
      <View className='today-supplements-head'>
        <View className='today-supplements-title-wrap'>
          <View className='today-supplements-icon'><Text className='iconfont icon-yiliaohangyedeICON-' /></View>
          <Text className='today-supplements-title'>今日补剂</Text>
          <Text className='today-supplements-count'>{completed}<Text className='today-supplements-count-muted'>/{planned} 已记录</Text></Text>
        </View>
        <View className='today-supplements-link' onClick={openCabinet}><Text>补剂柜 ›</Text></View>
      </View>
      {pending ? (
        <View className='today-supplements-pending'>
          <View className='today-supplements-pill'><Text className='iconfont icon-yiliaohangyedeICON-' /></View>
          <View className='today-supplements-copy'>
            <Text className='today-supplements-name'>{pending.name} · {pending.serving_label}</Text>
            <Text className='today-supplements-meta'>{pending.schedule_time ? `计划 ${pending.schedule_time}` : '今日计划'}</Text>
          </View>
          <View className={`today-supplements-record${busy ? ' is-busy' : ''}`} onClick={() => void quickRecord()}><Text>{busy ? '记录中' : canQuickRecord ? '记录一次' : '查看'}</Text></View>
        </View>
      ) : (
        <View className='today-supplements-empty' onClick={openCabinet}>
          <Text>{planned > 0 && completed >= planned ? '今日计划已完成' : '还没有补剂计划，去补剂柜添加'}</Text>
        </View>
      )}
    </View>
  )
}
