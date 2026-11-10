import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteSupplement,
  deleteSupplementIntake,
  getSupplementDashboard,
  recordSupplementIntake,
  showUnifiedApiError,
  type SupplementDashboard,
  type UserSupplement,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { formatSupplementDose } from '../../../utils/supplements'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

import { useRecordDate } from '../../../hooks/useRecordDate'
import RecordDateField from '../../../components/RecordDateField'
import { getRecordDateLabel } from '../../../utils/record-date'
import { rememberRecordReturnDate, supplementTakenAtForDate } from '../../../utils/record-navigation'
import { captureAuthSession, isAuthSessionCurrent } from '../../../utils/auth-session'
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
  return '当日计划'
}

export default function SupplementsPage() {
  const [recordDate, setRecordDate] = useRecordDate(String(Taro.getCurrentInstance().router?.params?.date || todayKey()))
  const requestRef = useRef(0)
  const [tab, setTab] = useState<Tab>('cabinet')
  const [loading, setLoading] = useState(true)
  const [recordingId, setRecordingId] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [dashboard, setDashboard] = useState<SupplementDashboard | null>(null)
  const cabinetMutationBusyRef = useRef(false)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    const owner = captureAuthSession()
    setLoading(true)
    try {
      const next = await getSupplementDashboard(recordDate)
      if (request === requestRef.current && isAuthSessionCurrent(owner)) setDashboard(next)
    } catch (error) {
      if (request !== requestRef.current || !isAuthSessionCurrent(owner)) return
      setDashboard(null)
      await showUnifiedApiError(error, '加载补剂柜失败')
    } finally {
      if (request === requestRef.current && isAuthSessionCurrent(owner)) setLoading(false)
      Taro.stopPullDownRefresh()
    }
  }, [recordDate])
  useEffect(() => { void load(); return () => { requestRef.current++ } }, [load])

  useDidShow(() => { void load() })
  usePullDownRefresh(() => { void load() })

  const completedIds = useMemo(
    () => new Set((dashboard?.intakes || []).map((item) => item.supplement_id)),
    [dashboard?.intakes],
  )

  const openEditor = (itemId?: string) => {
    if (cabinetMutationBusyRef.current) return
    const path = extraPkgUrl('/pages/supplement-edit/index')
    Taro.navigateTo({ url: itemId ? `${path}?id=${encodeURIComponent(itemId)}` : path })
  }

  const record = async (item: UserSupplement) => {
    if (cabinetMutationBusyRef.current) return
    cabinetMutationBusyRef.current = true
    setRecordingId(item.id)
    const owner = captureAuthSession()
    try {
      await recordSupplementIntake(item.id, {
        servings: item.default_servings,
        source: 'quick_log',
        taken_at: supplementTakenAtForDate(recordDate),
        idempotency_key: `${item.id}:${recordDate}:${Date.now()}`,
      })
      if (!isAuthSessionCurrent(owner)) return
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date: recordDate, force: true })
      rememberRecordReturnDate(recordDate)
      Taro.showToast({ title: `已记录到${getRecordDateLabel(recordDate)}`, icon: 'success' })
      await load()
    } catch (error) {
      await showUnifiedApiError(error, '记录失败')
    } finally {
      cabinetMutationBusyRef.current = false
      setRecordingId('')
    }
  }

  const removeIntake = async (intakeId: string) => {
    const modal = await Taro.showModal({ title: '删除记录', content: `删除后，${getRecordDateLabel(recordDate)}的营养统计会同步扣除。`, confirmColor: '#00a976' })
    if (!modal.confirm) return
    try {
      await deleteSupplementIntake(intakeId)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date: recordDate, force: true })
      await load()
    } catch (error) {
      await showUnifiedApiError(error, '删除失败')
    }
  }

  const removeSupplement = async (item: UserSupplement) => {
    if (cabinetMutationBusyRef.current) return
    cabinetMutationBusyRef.current = true
    setDeletingId(item.id)
    try {
      const result = await Taro.showModal({
        title: '删除补剂',
        content: `从补剂柜移除「${item.name}」并停止它的计划？已记录的摄入和营养统计会保留。`,
        confirmText: '删除', confirmColor: '#bd5a5a',
      })
      if (!result.confirm) return
      await deleteSupplement(item.id)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date: recordDate, force: true })
      await load()
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '删除补剂失败')
    } finally {
      cabinetMutationBusyRef.current = false
      setDeletingId('')
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
            <Text className='supplements-summary-label'>{getRecordDateLabel(recordDate)}计划</Text>
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
          <View className={`supplements-tab${tab === 'history' ? ' is-active' : ''}`} onClick={() => setTab('history')}><Text>服用记录</Text></View>
        </View>

        <RecordDateField date={recordDate} onChange={setRecordDate} disabled={Boolean(recordingId || deletingId)} unrestricted />
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
                        <Text className='supplement-meta'>每次 {formatSupplementDose(item.default_servings, item.serving_label)} · {scheduleText(item)} · 可调整</Text>
                        <Text className='supplement-components'>{item.components.slice(0, 3).map((c) => c.name).join(' · ') || '待补充成分'}</Text>
                      </View>
                    </View>
                    <View className='supplement-card-actions'>
                    <View className={`supplement-log${completed ? ' is-completed' : ''}${recordingId === item.id ? ' is-busy' : ''}`} onClick={() => { if (!completed) void record(item) }}>
                      {recordingId === item.id ? <View className='supplement-delete-spinner' /> : <Text>{completed ? `已记入${getRecordDateLabel(recordDate)}` : `记录到${getRecordDateLabel(recordDate)}`}</Text>}
                    </View>
                    <View className='supplement-delete' onClick={() => void removeSupplement(item)}>
                      {deletingId === item.id ? <View className='supplement-delete-spinner' /> : <Text>删除</Text>}
                    </View>
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
                    <Text className='supplement-meta'>{formatSupplementDose(item.servings, item.serving_label)} · {new Date(item.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                  <View className='supplement-delete' onClick={() => void removeIntake(item.id)}><Text>删除</Text></View>
                </View>
              ))}
              {!dashboard?.intakes?.length && <View className='supplements-empty'><Text className='supplements-empty-title'>{getRecordDateLabel(recordDate)}还没有记录</Text><Text className='supplements-empty-sub'>回到补剂柜选择要记录的补剂。</Text></View>}
            </View>
          )}
          <View className='supplements-safe-note'><Text>仅用于记录标签信息与摄入数据，不替代医生或药师建议。</Text></View>
        </ScrollView>
      </View>
    </FlPageThemeRoot>
  )
}
