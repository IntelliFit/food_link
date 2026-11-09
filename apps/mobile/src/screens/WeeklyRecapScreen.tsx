import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { captureRef } from 'react-native-view-shot'
import { apiClient, getStoredUserId } from '../api'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { chinaDay, previousRecapWeek, summarizeRecapWater, summarizeRecapWeek } from '../utils/weeklyRecap'
import { userFacingErrorMessage } from '../utils/errors'
import { colors } from '../theme'

export function WeeklyRecapScreen() {
  const { isDark } = useColorScheme()
  const dialog = useAppDialog()
  const [report, setReport] = useState<ReturnType<typeof summarizeRecapWeek> | null>(null)
  const [water, setWater] = useState<ReturnType<typeof summarizeRecapWater>>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState<string[] | null>(null)
  const [photoLimit, setPhotoLimit] = useState(36)
  const [selected, setSelected] = useState<string[]>([])
  const [photosBusy, setPhotosBusy] = useState(false)
  const [photosError, setPhotosError] = useState('')
  const [photoLimited, setPhotoLimited] = useState(false)
  const [shareNumbers, setShareNumbers] = useState(true)
  const [shareWater, setShareWater] = useState(false)
  const [preview, setPreview] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [posterImages, setPosterImages] = useState<Record<string, 'ready' | 'failed'>>({})
  const posterReady = selected.every(src => posterImages[src] === 'ready')
  const generation = useRef(0)
  const owner = useRef('')
  const poster = useRef<View>(null)
  const photoPending = useRef<number | null>(null)
  const exportPending = useRef(false)
  const valid = async (id: number, user: string) => id === generation.current && Boolean(user) && user === await getStoredUserId()
  const load = useCallback(async () => {
    const id = ++generation.current
    setBusy(true); setError(''); setReport(null); setWater(null); setPhotos(null); setSelected([]); setPreview(false)
    setPhotosError(''); setPhotoLimited(false); setPhotoLimit(36); setPhotosBusy(false); photoPending.current = null
    setExportBusy(false); setShareNumbers(true); setShareWater(false)
    try {
      const user = (await getStoredUserId()) || ''; owner.current = user
      if (!user) return
      const week = previousRecapWeek()
      const [calendars, body] = await Promise.all([Promise.all(week.months.map(month => apiClient.getStatsCalendarMonth(month))), apiClient.getBodyMetricsSummary('month').catch(() => null)])
      if (!await valid(id, user)) return
      setReport(summarizeRecapWeek(week, calendars)); setWater(summarizeRecapWater(week, body))
    } catch (cause) { if (id === generation.current) setError(userFacingErrorMessage(cause)) }
    finally { if (id === generation.current) setBusy(false) }
  }, [])
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current += 1; setPreview(false) } }, [load]))
  const loadPhotos = async () => {
    if (!report || photoPending.current !== null) return
    const id = generation.current; const user = owner.current
    photoPending.current = id; setPhotosBusy(true); setPhotosError('')
    try {
      const sources: string[] = []; let limited = false
      for (let index = 0; index < report.dates.length; index += 3) {
        const pages = await Promise.all(report.dates.slice(index, index + 3).map(date => apiClient.getFoodRecordList(date)))
        if (!await valid(id, user)) return
        limited ||= pages.some(page => page.records.length >= 100)
        for (const record of pages.flatMap(page => page.records)) {
          const instant = new Date(record.record_time)
          if (record.user_id !== user || !Number.isFinite(instant.getTime())) continue
          const day = chinaDay(instant)
          if (day < report.start || day > report.end) continue
          for (const src of [...(record.image_paths || []), record.image_path]) if (typeof src === 'string' && /^https?:\/\//i.test(src) && !/^https?:\/\/tmp\//i.test(src)) sources.push(src)
        }
      }
      setPhotos([...new Set(sources)]); setPhotoLimited(limited)
    } catch { if (await valid(id, user)) setPhotosError('餐照暂未完整读取，请重试。回顾数字不受影响。') }
    finally { if (photoPending.current === id) photoPending.current = null; if (id === generation.current) setPhotosBusy(false) }
  }
  const exportPoster = async (save: boolean) => {
    if (!poster.current || !posterReady || exportPending.current || !await valid(generation.current, owner.current)) return
    const id = generation.current; const user = owner.current
    exportPending.current = true; setExportBusy(true)
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const uri = await captureRef(poster, { format: 'png', quality: 1, result: 'tmpfile' })
      if (!await valid(id, user)) return
      if (save) {
        const media = await import('expo-media-library')
        const permission = await media.requestPermissionsAsync(true)
        if (!permission.granted) throw new Error('请允许保存到相册后重试')
        if (!await valid(id, user)) return
        await media.saveToLibraryAsync(uri)
        if (await valid(id, user)) void dialog.alert('已保存', '回顾图片已保存到系统相册。', 'success')
      } else {
        const sharing = require('expo-sharing') as { isAvailableAsync(): Promise<boolean>; shareAsync(uri: string, options: { mimeType: string; dialogTitle: string }): Promise<void> }
        if (!await sharing.isAvailableAsync()) throw new Error('当前运行环境暂不支持图片分享')
        if (await valid(id, user)) await sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: '食探 · 上周回顾' })
      }
    } catch (cause) { if (await valid(id, user)) void dialog.alert('未完成', userFacingErrorMessage(cause), 'warning') }
    finally { exportPending.current = false; if (id === generation.current) setExportBusy(false) }
  }
  const ink = { color: isDark ? '#e2eddf' : '#294635' }
  const muted = { color: isDark ? '#a7b5a9' : '#7d897f' }
  const card = { backgroundColor: isDark ? '#222f29' : '#fffef9' }
  return <ScrollView style={{ backgroundColor: isDark ? '#17241c' : '#f5f5ed' }} contentContainerStyle={s.page}>
    {busy ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : error ? <Pressable style={[s.card, card]} onPress={() => void load()}><Text style={muted}>{error} · 点击重试</Text></Pressable> : report ? <>
      <Text style={[s.note, muted]}>食探 · 上周回顾</Text><Text style={[s.heading, ink]}>好好吃饭的小日子</Text><Text style={[s.note, muted]}>{report.start} — {report.end}</Text>
      <View style={[s.card, card]}><Text style={[s.lead, ink]}>{report.recordedDays ? `这一周，你留下了 ${report.recordedDays} 天饮食记录。` : '上一周的饮食记录还在等你。'}</Text><Text style={[s.note, muted]}>{report.recordedDays < 3 ? '记录尚少，先把这几天的小事留住。' : '不必每天都完美，每次记录都值得被看见。'}</Text><View style={s.days}>{report.days.map((day, index) => <View key={day.date} style={s.day}><Text style={muted}>{['一', '二', '三', '四', '五', '六', '日'][index]}</Text><Text style={[s.mark, { color: day.recorded ? colors.brand : '#b7c6b8' }]}>{day.recorded ? '✓' : '·'}</Text><Text style={muted}>{day.date.slice(8)}</Text></View>)}</View><Text style={[s.lead, ink]}>{report.recordedDays} / 7 天有饮食记录 · 最长连续 {report.longestStreak} 天</Text><Text style={[s.note, muted]}>空白表示没有饮食记录，不代表没有吃饭。按北京时间统计。</Text></View>
      <View style={[s.card, card]}><Text style={[s.lead, ink]}>喝水的小习惯</Text><Text style={[s.note, muted]}>{water ? water.recordedDays ? `${water.recordedDays} 天记过喝水，共 ${(water.totalMl / 1000).toFixed(1)} L。` : '上周还没有喝水记录。' : '饮水数据暂未完整取得，先留白。'}</Text><Text style={[s.note, muted]}>只汇总你记录的饮水量，不推断实际喝水多少。</Text>{!water && <Pressable onPress={() => void load()}><Text style={s.link}>重新读取</Text></Pressable>}</View>
      <View style={[s.card, card]}><Text style={[s.lead, ink]}>挑几张喜欢的餐照</Text><Text style={[s.note, muted]}>从自己的饮食记录中选择，最多 4 张。只有选中的照片会进入分享图。</Text>{photosBusy ? <ActivityIndicator color={colors.brand} /> : photos === null ? <Pressable style={s.button} onPress={() => void loadPhotos()}><Text style={s.buttonText}>选择餐照</Text></Pressable> : photos.length === 0 ? <Text style={[s.note, muted]}>这周没有带图片的饮食记录，可以直接分享文字回顾。</Text> : <View style={s.photos}>{photos.slice(0, photoLimit).map(src => <Pressable key={src} accessibilityLabel={selected.includes(src) ? '餐照已选中' : '选择餐照'} style={[s.photo, { borderColor: selected.includes(src) ? colors.brand : 'transparent' }]} onPress={() => { if (selected.includes(src)) setSelected(previous => previous.filter(value => value !== src)); else if (selected.length < 4) setSelected(previous => [...previous, src]); else void dialog.alert('最多选择 4 张餐照', '请先取消一张已选照片。', 'warning') }}><Image source={{ uri: src }} style={s.image} /><Text style={s.photoCheck}>{selected.includes(src) ? '✓' : '+'}</Text></Pressable>)}</View>}{photos && photos.length > photoLimit && <Pressable onPress={() => setPhotoLimit(value => value + 36)}><Text style={s.link}>显示更多餐照</Text></Pressable>}{photoLimited && <Text style={[s.note, muted]}>餐照仅展示每天最近 100 条记录中的图片。记录天数统计不受影响。</Text>}{photosError && <Pressable onPress={() => void loadPhotos()}><Text style={s.link}>{photosError} · 重试</Text></Pressable>}</View>
      <View style={[s.card, card]}><Text style={[s.lead, ink]}>做一张自己的回顾图</Text><View style={s.option}><Text style={ink}>分享记录天数</Text><Switch value={shareNumbers} onValueChange={setShareNumbers} /></View>{water && water.recordedDays > 0 && <View style={s.option}><Text style={ink}>分享饮水数字</Text><Switch value={shareNumbers && shareWater} disabled={!shareNumbers} onValueChange={setShareWater} /></View>}<Text style={[s.note, muted]}>分享前会先展示完整图片，你可以再决定是否发送。</Text><Pressable style={s.button} onPress={() => { setPosterImages({}); setPreview(true) }}><Text style={s.buttonText}>预览分享图</Text></Pressable></View>
      <Modal visible={preview} animationType='slide' onRequestClose={() => !exportBusy && setPreview(false)}><ScrollView contentContainerStyle={s.page}><Text style={s.heading}>分享图片预览</Text><Pressable disabled={exportBusy} onPress={() => setPreview(false)}><Text style={s.link}>返回修改</Text></Pressable><View ref={poster} collapsable={false} style={[s.card, { backgroundColor: '#fffef9' }]}><Text style={[s.heading, { color: '#294635' }]}>好好吃饭的小日子</Text><Text style={s.note}>{report.start} — {report.end}</Text>{shareNumbers && <Text style={s.lead}>这一周留下了 {report.recordedDays} 天饮食记录，最长连续 {report.longestStreak} 天。</Text>}{shareNumbers && shareWater && water && <Text style={s.note}>记录饮水 {(water.totalMl / 1000).toFixed(1)} L</Text>}<View style={s.photos}>{selected.map(src => <Image key={src} source={{ uri: src }} onLoad={() => setPosterImages(previous => ({ ...previous, [src]: 'ready' }))} onError={() => setPosterImages(previous => ({ ...previous, [src]: 'failed' }))} style={{ width: '48%', aspectRatio: 1, borderRadius: 12 }} />)}</View><Text style={s.note}>食探 · 记录好好吃饭的小日子</Text></View>{!posterReady && selected.some(src => posterImages[src] === 'failed') && <Text style={s.note}>餐照读取失败，请返回修改或取消该照片。</Text>}{!posterReady && !selected.some(src => posterImages[src] === 'failed') && <ActivityIndicator color={colors.brand} />}{exportBusy ? <ActivityIndicator color={colors.brand} /> : <><Pressable style={s.button} disabled={!posterReady} onPress={() => void exportPoster(true)}><Text style={s.buttonText}>保存图片</Text></Pressable><Pressable style={s.button} disabled={!posterReady} onPress={() => void exportPoster(false)}><Text style={s.buttonText}>分享给朋友</Text></Pressable></>}</ScrollView></Modal>
    </> : null}
  </ScrollView>
}
const s = StyleSheet.create({ page: { padding: 16, paddingBottom: 48 }, heading: { fontSize: 26, lineHeight: 36, fontWeight: '800', marginVertical: 8 }, note: { fontSize: 12, lineHeight: 20, color: '#7d897f', marginTop: 6 }, lead: { fontSize: 16, lineHeight: 25, fontWeight: '700', marginBottom: 6 }, card: { padding: 18, borderRadius: 16, marginTop: 16 }, days: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 18 }, day: { alignItems: 'center', gap: 6 }, mark: { fontSize: 26 }, button: { minHeight: 44, padding: 10, marginTop: 14, borderRadius: 24, alignItems: 'center', backgroundColor: '#0b9667' }, buttonText: { color: '#fff', fontWeight: '700' }, link: { color: '#0b9667', fontSize: 13, marginTop: 10 }, photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, photo: { width: '30%', aspectRatio: 1, borderWidth: 3, borderRadius: 12, overflow: 'hidden' }, image: { width: '100%', height: '100%' }, photoCheck: { position: 'absolute', right: 4, bottom: 4, color: '#fff', backgroundColor: '#0b9667', borderRadius: 10, paddingHorizontal: 4 }, option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 } })
