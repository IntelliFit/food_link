import { Button, Canvas, Image, ScrollView, Switch, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, useShareAppMessage } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, getBodyMetricsSummary, getFoodRecordList, getStatsCalendarMonth } from '../../../utils/api'
import { previousRecapWeek, selectRecapPhotoCandidates, summarizeRecapWater, summarizeRecapWeek, type RecapPhoto, type WeeklyRecapSummary } from '../../../utils/weekly-recap'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { withAuth } from '../../../utils/withAuth'
import { isShowShareImageMenuCancel } from '../../../utils/weapp-share-image'
import { createWeeklyRecapPoster } from './poster'
import './index.scss'

function WeeklyRecapPage() {
  const { scheme } = useAppColorScheme()
  const [report, setReport] = useState<WeeklyRecapSummary | null>(null)
  const [water, setWater] = useState<ReturnType<typeof summarizeRecapWater>>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState<RecapPhoto[] | null>(null)
  const [photoLimit, setPhotoLimit] = useState(36)
  const [photosBusy, setPhotosBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoRangeLimited, setPhotoRangeLimited] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [shareNumbers, setShareNumbers] = useState(true)
  const [shareWater, setShareWater] = useState(false)
  const [poster, setPoster] = useState('')
  const [posterBusy, setPosterBusy] = useState(false)
  const [posterError, setPosterError] = useState('')
  const [sharing, setSharing] = useState(false)
  const generation = useRef(0)
  const owner = useRef('')
  const photoPending = useRef(false)
  const posterPending = useRef(false)
  const valid = (id: number, token: string) => generation.current === id && token === getAccessToken()
  useEffect(() => () => { generation.current += 1 }, [])

  const load = async () => {
    const token = getAccessToken()
    if (!token) { setReport(null); setBusy(false); return }
    const id = ++generation.current
    owner.current = token
    setBusy(true); setError(''); setReport(null); setWater(null); setPoster(''); setPhotos(null); setSelected([])
    setPhotosBusy(false); setPosterBusy(false); photoPending.current = false; posterPending.current = false
    setPhotoError(''); setPhotoRangeLimited(false); setPhotoLimit(36); setPosterError(''); setShareWater(false); setShareNumbers(true)
    const week = previousRecapWeek()
    try {
      const [calendars, body] = await Promise.all([
        Promise.all(week.months.map(getStatsCalendarMonth)),
        getBodyMetricsSummary('month').catch(() => null),
      ])
      if (!valid(id, token)) return
      setReport(summarizeRecapWeek(week, calendars))
      setWater(summarizeRecapWater(week, body))
    } catch (reason) {
      if (valid(id, token)) setError(reason instanceof Error ? reason.message : '回顾暂未打开，请重试。')
    } finally { if (valid(id, token)) setBusy(false) }
  }

  useDidShow(() => { applyThemeNavigationBar(scheme, { lightBackground: '#f5f5ed', darkBackground: '#17241c' }); void load() })
  useDidHide(() => { generation.current += 1; setPoster(''); setSharing(false) })
  useShareAppMessage(() => ({ title: '在食探，记录好好吃饭的小日子', path: '/pages/index/index' }))

  const loadPhotos = async () => {
    if (!report || photoPending.current || owner.current !== getAccessToken()) return
    const id = generation.current; const token = owner.current
    const userId = String(Taro.getStorageSync('user_id') || '')
    if (!userId) return
    photoPending.current = true; setPhotosBusy(true); setPhotoError('')
    try {
      const records: Awaited<ReturnType<typeof getFoodRecordList>>['records'] = []
      let reachedDailyLimit = false
      for (let index = 0; index < report.dates.length; index += 3) {
        const pages = await Promise.all(report.dates.slice(index, index + 3).map(getFoodRecordList))
        if (!valid(id, token)) return
        reachedDailyLimit ||= pages.some(page => page.records.length >= 100)
        records.push(...pages.flatMap(page => page.records))
      }
      setPhotos(selectRecapPhotoCandidates(records, report, userId))
      setPhotoRangeLimited(reachedDailyLimit)
    } catch { if (valid(id, token)) setPhotoError('餐照暂未完整读取，请重试。回顾数字不受影响。') }
    finally { if (valid(id, token)) { photoPending.current = false; setPhotosBusy(false) } }
  }

  const togglePhoto = (src: string) => {
    if (posterPending.current) return
    setPoster('')
    if (selected.includes(src)) { setSelected(previous => previous.filter(value => value !== src)); return }
    if (selected.length >= 4) { void Taro.showToast({ title: '最多选择 4 张餐照', icon: 'none' }); return }
    setSelected(previous => [...previous, src])
  }

  const previewPoster = async () => {
    if (!report || posterPending.current || owner.current !== getAccessToken()) return
    const id = generation.current; const token = owner.current
    posterPending.current = true; setPosterBusy(true); setPosterError('')
    try {
      const image = await createWeeklyRecapPoster(report, shareNumbers, shareNumbers && shareWater && water ? water.totalMl : null, selected)
      if (valid(id, token)) setPoster(image)
    } catch (reason) { if (valid(id, token)) setPosterError(reason instanceof Error ? reason.message : '分享图未生成，请重试。') }
    finally { if (valid(id, token)) { posterPending.current = false; setPosterBusy(false) } }
  }
  const exportPoster = async (save: boolean) => {
    if (!poster || sharing || owner.current !== getAccessToken()) return
    setSharing(true)
    try {
      if (save) { await Taro.saveImageToPhotosAlbum({ filePath: poster }); void Taro.showToast({ title: '已保存到相册', icon: 'success' }) }
      else await Taro.showShareImageMenu({ path: poster })
    } catch (reason) {
      if (!isShowShareImageMenuCancel(reason as { errMsg?: string })) void Taro.showToast({ title: save ? '请允许保存到相册后重试' : '分享未完成，可先保存图片', icon: 'none' })
    } finally { setSharing(false) }
  }

  return <View className={`weekly-recap${scheme === 'dark' ? ' weekly-recap--dark' : ''}`}>
    {busy ? <View className='weekly-recap__skeleton' aria-label='正在准备回顾'><View /><View /><View /></View> : error ? <View className='weekly-recap__empty'><Text>{error}</Text><Button onClick={() => void load()}>重试</Button></View> : report && <>
      <View className='weekly-recap__header'><Text className='weekly-recap__eyebrow'>食探 · 上周回顾</Text><Text className='weekly-recap__title'>好好吃饭的小日子</Text><Text className='weekly-recap__date'>{report.start} — {report.end}</Text></View>
      <View className='weekly-recap__card'>
        <Text className='weekly-recap__lead'>{report.recordedDays ? `这一周，你留下了 ${report.recordedDays} 天饮食记录。` : '上一周的饮食记录还在等你。'}</Text>
        <Text className='weekly-recap__note'>{report.recordedDays < 3 ? '记录尚少，先把这几天的小事留住。' : '不必每天都完美，每次记录都值得被看见。'}</Text>
        <View className='weekly-recap__days'>{report.days.map((day, index) => <View key={day.date} className={`weekly-recap__day${day.recorded ? ' is-recorded' : ''}`}><Text>{['一', '二', '三', '四', '五', '六', '日'][index]}</Text><View>{day.recorded ? '✓' : '·'}</View><Text>{day.date.slice(8)}</Text></View>)}</View>
        <View className='weekly-recap__metrics'><View><Text className='weekly-recap__number'>{report.recordedDays}<Text> / 7 天</Text></Text><Text>有饮食记录</Text></View><View><Text className='weekly-recap__number'>{report.longestStreak}<Text> 天</Text></Text><Text>最长连续记录</Text></View></View>
        <Text className='weekly-recap__footnote'>空白表示没有饮食记录，不代表没有吃饭。按北京时间统计。</Text>
      </View>
      <View className='weekly-recap__card'><Text className='weekly-recap__section-title'>喝水的小习惯</Text>{water ? <><Text className='weekly-recap__lead'>{water.recordedDays ? `${water.recordedDays} 天记过喝水，共 ${(water.totalMl / 1000).toFixed(1)} L。` : '上周还没有喝水记录。'}</Text><Text className='weekly-recap__note'>只汇总你记录的饮水量，不推断实际喝水多少。</Text></> : <><Text className='weekly-recap__note'>饮水数据暂未完整取得，先留白。</Text><Button className='weekly-recap__text-button' onClick={() => void load()}>重新读取</Button></>}</View>
      <View className='weekly-recap__card'><Text className='weekly-recap__section-title'>挑几张喜欢的餐照</Text><Text className='weekly-recap__note'>从自己的饮食记录中选择，最多 4 张。只有选中的照片会进入分享图。</Text>
        {photosBusy ? <View className='weekly-recap__spinner' /> : photos === null ? <Button className='weekly-recap__secondary' onClick={() => void loadPhotos()}>选择餐照</Button> : <>
          {photos.length === 0 ? <Text className='weekly-recap__note'>这周没有带图片的饮食记录，可以直接分享文字回顾。</Text> : <View className='weekly-recap__photos'>{photos.slice(0, photoLimit).map(photo => <View key={photo.src} className={`weekly-recap__photo${selected.includes(photo.src) ? ' is-selected' : ''}`} role='button' aria-label={`${photo.date}的餐照${selected.includes(photo.src) ? '，已选中' : ''}`} onClick={() => togglePhoto(photo.src)}><Image src={photo.src} mode='aspectFill' /><Text>{selected.includes(photo.src) ? '✓' : '+'}</Text></View>)}</View>}
          {photos.length > photoLimit && <Button className='weekly-recap__text-button' onClick={() => setPhotoLimit(value => value + 36)}>显示更多餐照</Button>}
        </>}
        {photoRangeLimited && <Text className='weekly-recap__note'>有些日期记录较多，餐照仅展示每天最近 100 条记录中的图片。上方记录天数统计不受影响。</Text>}
        {photoError && <Text className='weekly-recap__error'>{photoError}</Text>}
      </View>
      <View className='weekly-recap__card'><Text className='weekly-recap__section-title'>做一张自己的回顾图</Text><View className='weekly-recap__option'><Text>分享记录天数</Text><Switch checked={shareNumbers} disabled={posterBusy} color='#0b9667' onChange={event => { setShareNumbers(event.detail.value); setPoster('') }} /></View>{water && water.recordedDays > 0 && <View className='weekly-recap__option'><Text>分享饮水数字</Text><Switch checked={shareWater && shareNumbers} disabled={posterBusy || !shareNumbers} color='#0b9667' onChange={event => { setShareWater(event.detail.value); setPoster('') }} /></View>}<Text className='weekly-recap__footnote'>分享前会先展示完整图片，你可以再决定是否发送。</Text><Button className='weekly-recap__primary' disabled={posterBusy} onClick={() => void previewPoster()}>{posterBusy ? <View className='weekly-recap__spinner is-light' /> : '预览分享图'}</Button>{posterError && <Text className='weekly-recap__error'>{posterError}</Text>}</View>
      <Button className='weekly-recap__text-button' onClick={() => void Taro.switchTab({ url: '/pages/index/index' })}>回首页，记好下一餐</Button>
    </>}
    {poster && <View className='weekly-recap__preview' catchMove><View className='weekly-recap__preview-mask' onClick={() => setPoster('')} /><View className='weekly-recap__preview-sheet' role='dialog' aria-label='分享图片预览'><View className='weekly-recap__preview-heading'><Text>分享图片预览</Text><Button onClick={() => setPoster('')}>返回修改</Button></View><ScrollView scrollY className='weekly-recap__preview-scroll'><Image src={poster} mode='widthFix' showMenuByLongpress /></ScrollView><View className='weekly-recap__preview-actions'><Button disabled={sharing} onClick={() => void exportPoster(true)}>保存图片</Button><Button className='weekly-recap__primary' disabled={sharing} onClick={() => void exportPoster(false)}>分享给朋友</Button></View></View></View>}
    <Canvas type='2d' id='weeklyRecapCanvas' className='weekly-recap__canvas' />
  </View>
}

export default withAuth(WeeklyRecapPage)
