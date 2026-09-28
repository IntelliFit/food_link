import { Button, Picker, Text, Textarea, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { buildSleepInput, deleteSleepRecord, getSleepRecord, saveSleepRecord, shiftSleepDate, SLEEP_CHANGED_EVENT, SLEEP_QUALITIES, sleepDurationLabel, sleepLocalParts, sleepToday, type SleepQuality, type SleepRecord } from '../../../utils/sleep-record'
import './index.scss'

function SleepRecordPage() {
  const routeDate = useRouter().params.date || ''
  const [date, setDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(routeDate) && Number.isFinite(Date.parse(routeDate)) && routeDate <= sleepToday() ? routeDate : sleepToday())
  const [record, setRecord] = useState<SleepRecord | null>(null)
  const [bedDate, setBedDate] = useState(shiftSleepDate(date, -1))
  const [bedTime, setBedTime] = useState('23:00')
  const [wakeTime, setWakeTime] = useState('07:00')
  const [quality, setQuality] = useState<SleepQuality>('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const sequence = useRef(0)
  const busy = useRef(false)
  const load = useCallback(async () => {
    const seq = ++sequence.current
    const token = getAccessToken()
    setLoading(true); setError(false); setRecord(null)
    try {
      const value = await getSleepRecord(date)
      if (seq !== sequence.current || token !== getAccessToken()) return
      setRecord(value)
      setBedDate(value ? sleepLocalParts(value.bedtime).date : shiftSleepDate(date, -1))
      setBedTime(value ? sleepLocalParts(value.bedtime).time : '23:00')
      setWakeTime(value ? sleepLocalParts(value.wake_time).time : '07:00')
      setQuality(value?.quality || ''); setNote(value?.note || '')
    } catch { if (seq === sequence.current) setError(true) }
    finally { if (seq === sequence.current) setLoading(false) }
  }, [date])
  useEffect(() => { void load(); return () => { sequence.current++ } }, [load])
  const save = async () => {
    if (busy.current || loading || error) return
    busy.current = true; setSaving(true)
    try {
      const input = buildSleepInput(date, bedDate, bedTime, wakeTime, quality, note)
      setRecord(await saveSleepRecord(date, input))
      Taro.eventCenter.trigger(SLEEP_CHANGED_EVENT)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (e) { await showUnifiedApiError(e, '保存睡眠记录失败') }
    finally { busy.current = false; setSaving(false) }
  }
  const remove = async () => {
    if (busy.current || !record || loading) return
    busy.current = true; setSaving(true)
    try {
      const result = await Taro.showModal({ title: '删除这天的记录？', content: '仅删除这一天的睡眠记录，首页模块仍会保留。', confirmText: '删除' })
      if (!result.confirm) return
      await deleteSleepRecord(date)
      Taro.eventCenter.trigger(SLEEP_CHANGED_EVENT)
      await load()
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (e) { await showUnifiedApiError(e, '删除睡眠记录失败') }
    finally { busy.current = false; setSaving(false) }
  }
  const minutes = (Date.parse(`${date}T${wakeTime}:00+08:00`) - Date.parse(`${bedDate}T${bedTime}:00+08:00`)) / 60000
  return <View className='sleep-editor'>
    <Text className='sleep-editor__title'>昨晚睡得怎么样</Text>
    <Text className='sleep-editor__hint'>按起床当天记录。夜里零点后入睡，入睡日期选当天。</Text>
    <Picker mode='date' value={date} start='1900-01-01' end={sleepToday()} disabled={saving} onChange={event => setDate(event.detail.value)}><View className='sleep-editor__row'><Text>起床日期</Text><Text>{date} ›</Text></View></Picker>
    {loading ? <View className='sleep-editor__skeleton' /> : error ? <View className='sleep-editor__error' onClick={() => { void load() }}>记录未能读取，点此重试</View> : <>
      <View className='sleep-editor__card'>
        <Picker mode='date' value={bedDate} start={shiftSleepDate(date, -1)} end={date} disabled={saving} onChange={event => setBedDate(event.detail.value)}><View className='sleep-editor__row'><Text>入睡日期</Text><Text>{bedDate} ›</Text></View></Picker>
        <Picker mode='time' value={bedTime} disabled={saving} onChange={event => setBedTime(event.detail.value)}><View className='sleep-editor__row'><Text>大约几点睡着</Text><Text>{bedTime} ›</Text></View></Picker>
        <Picker mode='time' value={wakeTime} disabled={saving} onChange={event => setWakeTime(event.detail.value)}><View className='sleep-editor__row'><Text>起床时间</Text><Text>{wakeTime} ›</Text></View></Picker>
        {minutes > 0 && minutes <= 1440 && <Text className='sleep-editor__duration'>入睡到起床约 {sleepDurationLabel(minutes)}</Text>}
        <Text className='sleep-editor__hint'>按填写时间计算，包含夜间醒来的时间。</Text>
      </View>
      <View className='sleep-editor__card'><Text className='sleep-editor__label'>感觉睡得如何 <Text className='sleep-editor__optional'>选填</Text></Text><View className='sleep-editor__qualities'>{SLEEP_QUALITIES.map(item => <Button key={item.value} className={`sleep-editor__quality ${quality === item.value ? 'is-selected' : ''}`} disabled={saving} onClick={() => setQuality(item.value)}>{item.label}</Button>)}</View></View>
      <View className='sleep-editor__card'><Text className='sleep-editor__label'>补充说明 <Text className='sleep-editor__optional'>选填</Text></Text><Textarea className='sleep-editor__note' value={note} maxlength={500} disabled={saving} placeholder='例如：半夜醒了两次、午后喝了咖啡……' onInput={event => setNote(event.detail.value)} /><Text className='sleep-editor__counter'>{[...note].length}/500</Text></View>
      <Button className='sleep-editor__save' disabled={saving} loading={saving} onClick={save}>保存记录</Button>
      {record && <Button className='sleep-editor__delete' disabled={saving} onClick={remove}>删除这天的记录</Button>}
    </>}
  </View>
}
export default withAuth(SleepRecordPage)
