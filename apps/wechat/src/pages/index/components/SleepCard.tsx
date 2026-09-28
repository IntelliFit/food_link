import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getSleepRecord, SLEEP_CHANGED_EVENT, SLEEP_QUALITIES, sleepDurationLabel, sleepLocalParts, sleepToday, type SleepRecord } from '../../../utils/sleep-record'
import './SleepCard.scss'

function compactDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}时${remainder}分` : `${hours}小时`
}

export default function SleepCard({ date, guest, compact = false }: { date: string; guest: boolean; compact?: boolean }) {
  const [record, setRecord] = useState<SleepRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const request = useRef(0)
  const future = date > sleepToday()
  const load = useCallback(async () => {
    const seq = ++request.current
    const token = getAccessToken()
    setRecord(null); setError(false)
    if (guest || !token || future) { setLoading(false); return }
    setLoading(true)
    try {
      const value = await getSleepRecord(date)
      if (seq === request.current && token === getAccessToken()) setRecord(value)
    } catch { if (seq === request.current) setError(true) }
    finally { if (seq === request.current) setLoading(false) }
  }, [date, guest, future])
  useDidShow(() => { void load() })
  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    Taro.eventCenter.on(SLEEP_CHANGED_EVENT, refresh)
    return () => { request.current++; Taro.eventCenter.off(SLEEP_CHANGED_EVENT, refresh) }
  }, [load])
  const open = () => { void Taro.navigateTo({ url: extraPkgUrl(`/pages/sleep-record/index?date=${date}`) }) }
  if (compact) {
    const quality = record ? SLEEP_QUALITIES.find(item => item.value === record.quality)?.label : ''
    const bedtime = record ? sleepLocalParts(record.bedtime).time : ''
    const wakeTime = record ? sleepLocalParts(record.wake_time).time : ''
    return <View
      className='body-status-card sleep-quick-card'
      role={future ? undefined : 'button'}
      aria-label={future ? undefined : error ? '重新读取睡眠记录' : record ? '编辑睡眠记录' : '记录睡眠'}
      onClick={future ? undefined : error ? () => { void load() } : open}
    >
      <View className='body-status-header'>
        <View className='body-status-title-wrap'>
          <View className='sleep-quick-card__icon' />
          <Text className='body-status-title'>睡眠</Text>
        </View>
      </View>
      <View className='body-status-content'>
        {loading
          ? <View className='sleep-quick-card__skeleton' />
          : <Text className={record ? 'body-status-value' : 'body-status-empty'}>{record ? compactDuration(record.duration_minutes) : '--'}</Text>}
      </View>
      <Text className={`body-status-hint${error ? ' sleep-quick-card__error' : ''}`} numberOfLines={1}>
        {error
          ? '点此重试'
          : record
            ? `${bedtime}–${wakeTime}${quality ? ` · ${quality}` : ''}`
            : future
              ? '起床后记录'
              : guest
                ? '登录后记录'
                : '点击记录睡眠'}
      </Text>
    </View>
  }
  return <View className='sleep-card'>
    <View className='sleep-card__heading'><Text className='sleep-card__title'>睡眠</Text>{!future && <View className='sleep-card__edit' role='button' onClick={open}>{record ? '编辑记录' : '记录睡眠'} ›</View>}</View>
    {loading ? <View className='sleep-card__skeleton' /> : error ? <View className='sleep-card__muted' onClick={() => { void load() }}>记录未能读取，点此重试</View> : record ? <>
      <View className='sleep-card__duration'>{sleepDurationLabel(record.duration_minutes)}<Text className='sleep-card__quality'>{SLEEP_QUALITIES.find(item => item.value === record.quality)?.label || '未填写'}</Text></View>
      <Text className='sleep-card__muted'>{sleepLocalParts(record.bedtime).date < date ? '前一天 ' : '当天 '}{sleepLocalParts(record.bedtime).time} 入睡 · {sleepLocalParts(record.wake_time).time} 起床</Text>
      {record.note && <Text className='sleep-card__note' numberOfLines={2}>{record.note}</Text>}
    </> : <Text className='sleep-card__muted'>{future ? '起床后再来记录这一天的睡眠' : guest ? '登录后记录每天的睡眠' : '这一天还没有睡眠记录'}</Text>}
    <Text className='sleep-card__footnote'>按起床当天记录 · 手动填写</Text>
  </View>
}
