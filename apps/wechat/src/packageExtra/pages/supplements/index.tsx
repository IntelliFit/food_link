import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useCallback, useMemo, useState } from 'react'
import {
  deleteSupplementIntake,
  getSupplementDashboard,
  recordSupplementIntake,
  showUnifiedApiError,
  type SupplementDashboard,
  type UserSupplement,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

import './index.scss'

type Tab = 'cabinet' | 'history'

function todayKey(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function scheduleText(item: UserSupplement): string {
  if (!item.schedule_enabled) return '按需记录'
  if (item.schedule_time) return `计划 ${item.schedule_time}`
  return '今日计划'
}

export default function SupplementsPage() {
  const [tab, setTab] = useState<Tab>('cabinet')
  const [loading, setLoading] = useState(true)
  const [recordingId, setRecordingId] = useState('')
  const [dashboard, setDashboard] = useState<SupplementDashboard | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDashboard(await getSupplementDashboard(todayKey()))
    } catch (error) {
      setDashboard(null)
      await showUnifiedApiError(error, '加载补剂柜失败')
    } finally {
      setLoading(false)
      Taro.stopPullDownRefresh()
    }
  }, [])

  useDidShow(() => { void load() })
  usePullDownRefresh(() => { void load() })

  const completedIds = useMemo(
    () => new Set((dashboard?.intakes || []).map((item) => item.supplement_id)),
    [dashboard?.intakes],
  )

  const openEditor = (itemId?: string) => {
    const path = extraPkgUrl('/pages/supplement-edit/index')
    Taro.navigateTo({ url: itemId ? `${path}?id=${encodeURIComponent(itemId)}` : path })
  }

  const record = async (item: UserSupplement) => {
    if (recordingId) return
    setRecordingId(item.id)
    try {
      await recordSupplementIntake(item.id, {
        servings: item.default_servings,
        source: 'quick_log',
        idempotency_key: `${item.id}:${todayKey()}:${Date.now()}`,
      })
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date: todayKey(), force: true })
      Taro.showToast({ title: '已记录', icon: 'success' })
      await load()
    } catch (error) {
      await showUnifiedApiError(error, '记录失败')
    } finally {
      setRecordingId('')
    }
  }

  const removeIntake = async (intakeId: string) => {
    const modal = await Taro.showModal({ title: '删除记录', content: '删除后，今日营养统计会同步扣除。', confirmColor: '#00a976' })
    if (!modal.confirm) return
    try {
      await deleteSupplementIntake(intakeId)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date: todayKey(), force: true })
      await load()
    } catch (error) {
      await showUnifiedApiError(error, '删除失败')
    }
  }

  const progress = dashboard?.planned_count
    ? Math.round((dashboard.completed_count / dashboard.planned_count) * 100)
    : 0

  return (
    <FlPageThemeRoot>
      <View className='supplements-page'>
        <View className='supplements-hero'>
          <View>
            <Text className='supplements-kicker'>记录优先 · 结果回到营养面板</Text>
            <Text className='supplements-title'>我的补剂柜</Text>
          </View>
          <View className='supplements-add' onClick={() => openEditor()}>
            <Text>＋ 添加</Text>
          </View>
        </View>

        <View className='supplements-summary'>
          <View className='supplements-summary-copy'>
            <Text className='supplements-summary-label'>今日计划</Text>
            <Text className='supplements-summary-value'>{dashboard?.completed_count || 0}<Text className='supplements-summary-total'> / {dashboard?.planned_count || 0}</Text></Text>
          </View>
          <View className='supplements-summary-progress'>
            <View className='supplements-summary-track'>
              <View className='supplements-summary-fill' style={{ width: `${Math.min(100, progress)}%` }} />
            </View>
            <Text>{progress}%</Text>
          </View>
        </View>

        <View className='supplements-tabs'>
          <View className={`supplements-tab${tab === 'cabinet' ? ' is-active' : ''}`} onClick={() => setTab('cabinet')}><Text>补剂柜</Text></View>
          <View className={`supplements-tab${tab === 'history' ? ' is-active' : ''}`} onClick={() => setTab('history')}><Text>今日记录</Text></View>
        </View>

        <ScrollView scrollY className='supplements-scroll'>
          {loading ? (
            <View className='supplements-skeleton-list'>{[0, 1, 2].map((key) => <View key={key} className='supplements-skeleton' />)}</View>
          ) : tab === 'cabinet' ? (
            <View className='supplements-list'>
              {(dashboard?.supplements || []).map((item) => {
                const completed = completedIds.has(item.id)
                return (
                  <View key={item.id} className='supplement-card'>
                    <View className='supplement-card-main' onClick={() => openEditor(item.id)}>
                      <View className='supplement-bottle'><Text className='iconfont icon-yiliaohangyedeICON-' /></View>
                      <View className='supplement-copy'>
                        <Text className='supplement-name'>{item.name}</Text>
                        <Text className='supplement-meta'>{item.serving_label} · {scheduleText(item)}</Text>
                        <Text className='supplement-components'>{item.components.slice(0, 3).map((c) => c.name).join(' · ') || '待补充成分'}</Text>
                      </View>
                    </View>
                    <View className={`supplement-log${completed ? ' is-completed' : ''}${recordingId === item.id ? ' is-busy' : ''}`} onClick={() => { if (!completed) void record(item) }}>
                      <Text>{completed ? '今日已记' : recordingId === item.id ? '记录中' : '记录一次'}</Text>
                    </View>
                  </View>
                )
              })}
              {!dashboard?.supplements?.length && (
                <View className='supplements-empty'>
                  <Text className='supplements-empty-title'>补剂柜还是空的</Text>
                  <Text className='supplements-empty-sub'>从公共补剂库选择，或拍摄瓶身标签添加，确认后即可快速记录。</Text>
                  <View className='supplements-empty-action' onClick={() => openEditor()}><Text>添加第一件补剂</Text></View>
                </View>
              )}
            </View>
          ) : (
            <View className='supplements-list'>
              {(dashboard?.intakes || []).map((item) => (
                <View key={item.id} className='supplement-history-card'>
                  <View>
                    <Text className='supplement-name'>{item.supplement_name}</Text>
                    <Text className='supplement-meta'>{item.servings} × {item.serving_label} · {new Date(item.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                  <View className='supplement-delete' onClick={() => void removeIntake(item.id)}><Text>删除</Text></View>
                </View>
              ))}
              {!dashboard?.intakes?.length && <View className='supplements-empty'><Text className='supplements-empty-title'>今天还没有记录</Text><Text className='supplements-empty-sub'>回到补剂柜点击“记录一次”。</Text></View>}
            </View>
          )}
          <View className='supplements-safe-note'><Text>仅用于记录标签信息与摄入数据，不替代医生或药师建议。</Text></View>
        </ScrollView>
      </View>
    </FlPageThemeRoot>
  )
}
