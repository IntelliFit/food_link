import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getSleepRecord, SLEEP_CHANGED_EVENT, SLEEP_QUALITIES, sleepDurationLabel, sleepLocalParts, sleepToday, type SleepRecord } from '../../../utils/sleep-record'
import './SleepCard.scss'

export default function SleepCard({ date, guest }: { date: string; guest: boolean }) {
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
