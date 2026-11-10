import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState } from 'react'
import { captureAuthSession, isAuthSessionCurrent } from '../../../utils/auth-session'
import { supplementTakenAtForDate } from '../../../utils/record-navigation'
import { getRecordDateLabel } from '../../../utils/record-date'
import {
  recordSupplementIntake,
  showUnifiedApiError,
  type SupplementDashboardSummary,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { formatSupplementDose } from '../../../utils/supplements'

export interface TodaySupplementsSectionProps {
  summary: SupplementDashboardSummary
  date: string
  onRecorded: (next: SupplementDashboardSummary, date: string) => void
}

export function TodaySupplementsSection({ summary, date, onRecorded }: TodaySupplementsSectionProps) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const pending = summary.pending_supplement
  const openCabinet = () => Taro.navigateTo({ url: `${extraPkgUrl('/pages/supplements/index')}?date=${encodeURIComponent(date)}` })

  const quickRecord = async () => {
    if (!pending || busyRef.current) return
    busyRef.current = true
    const owner = captureAuthSession()
    setBusy(true)
    try {
      await recordSupplementIntake(pending.id, {
        servings: pending.default_servings,
        source: 'home_quick_log',
        taken_at: supplementTakenAtForDate(date),
        idempotency_key: `home:${pending.id}:${Date.now()}`,
      })
      if (!isAuthSessionCurrent(owner)) return
      const nextCompleted = Math.min(summary.planned_count, summary.completed_count + 1)
      onRecorded({ ...summary, completed_count: nextCompleted, pending_supplement: null }, date)
      // Refresh the action's selected date, never the current wall-clock day.
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date, force: true })
      Taro.showToast({ title: '已记录', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '记录补剂失败')
    } finally {
      busyRef.current = false
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
          <Text className='today-supplements-title'>{getRecordDateLabel(date)}补剂</Text>
          <Text className='today-supplements-count'>{completed}<Text className='today-supplements-count-muted'>/{planned} 已记录</Text></Text>
        </View>
        <View className='today-supplements-link' onClick={openCabinet}><Text>补剂柜 ›</Text></View>
      </View>
      {pending ? (
        <View className='today-supplements-pending'>
          <View className='today-supplements-pill'><Text className='iconfont icon-yiliaohangyedeICON-' /></View>
          <View className='today-supplements-copy'>
            <Text className='today-supplements-name'>{pending.name} · {formatSupplementDose(pending.default_servings, pending.serving_label)}</Text>
            <Text className='today-supplements-meta'>{pending.schedule_time ? `计划 ${pending.schedule_time}` : '当日计划'}</Text>
          </View>
          <View className={`today-supplements-record${busy ? ' is-busy' : ''}`} onClick={() => void quickRecord()}><Text>{busy ? '记录中' : `记到${getRecordDateLabel(date)}`}</Text></View>
        </View>
      ) : (
        <View className='today-supplements-empty' onClick={openCabinet}>
          <Text>{planned > 0 && completed >= planned ? '当日计划已完成' : '还没有补剂计划，去补剂柜添加'}</Text>
        </View>
      )}
    </View>
  )
}
