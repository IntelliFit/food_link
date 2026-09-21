import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../utils/api'
import { journalBookTitle, type JournalBook } from '../utils/recap-journal'
import './RecapBookshelf.scss'

export type BookMark = { read: boolean; stamp?: string }
export type BookMarks = Record<string, BookMark>
export const bookMarksKey = (owner: string) => `recap-book-marks-v1:${owner}`
export function readBookMarks(owner: string): BookMarks {
  try {
    const saved = Taro.getStorageSync(bookMarksKey(owner))
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => value && typeof value === 'object' && typeof (value as BookMark).read === 'boolean').map(([id, value]) => {
      const mark = value as BookMark
      return [id, { read: mark.read, stamp: mark.read && typeof mark.stamp === 'string' && ['已阅', '好好吃饭', '食探认证'].includes(mark.stamp) ? mark.stamp : undefined }]
    }))
  } catch { return {} }
}
export function RecapBookshelf({ owner, entries, marks, onOpen, onMark }: { owner: string; entries: JournalBook[]; marks: BookMarks; onOpen: (entry: JournalBook) => void; onMark: (id: string, stamp: string) => void }) {
  const [night, setNight] = useState(() => { try { const saved = Taro.getStorageSync(`recap-shelf-night:${owner}`); if (typeof saved === 'boolean') return saved } catch { /* Use local time. */ } const hour = new Date().getHours(); return hour < 7 || hour >= 19 })
  const [pulling, setPulling] = useState<JournalBook | null>(null), [preview, setPreview] = useState<JournalBook | null>(null), [pressedStamp, setPressedStamp] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const validOwner = () => Boolean(getAccessToken()) && String(Taro.getStorageSync('user_id') || '') === owner
  const take = (entry: JournalBook) => { if (pulling || !validOwner()) return; setPreview(null); setPulling(entry); timer.current = setTimeout(() => { if (validOwner()) onOpen(entry); setPulling(null) }, 850) }
  const switchLight = () => { setNight(!night); if (validOwner()) { try { Taro.setStorageSync(`recap-shelf-night:${owner}`, !night) } catch { /* Keep session choice. */ } } }
  const groups = [entries.filter((_, i) => i % 2 === 0), entries.filter((_, i) => i % 2 === 1)]
  return <View className={`recap-bookshelf${night ? ' is-night' : ''}`}>
    <Image className='recap-bookshelf__background is-day' src='/assets/recap/bookshelf-day.jpg' mode='scaleToFill' /><Image className='recap-bookshelf__background is-night' src='/assets/recap/bookshelf-night.jpg' mode='scaleToFill' />
    <View className='recap-bookshelf__heading'><Text>食探书架</Text><Text>把日子，慢慢藏成一本书</Text></View>
    <View role='button' aria-label={night ? '切换白天书架' : '切换夜晚书架'} className='recap-bookshelf__light' onClick={switchLight}>{night ? '☀' : '☾'}</View>
    {groups.map((group, shelf) => <ScrollView key={shelf} scrollX enhanced className={`recap-bookshelf__row recap-bookshelf__row--${shelf}`}><View className='recap-bookshelf__books'>{group.map(entry => {
      const index = entries.findIndex(item => item.id === entry.id), number = entries.length - index
      return <View key={entry.id} role='button' aria-label={`取出${journalBookTitle(entry)}`} className={`recap-book recap-book--${index % 5}${pulling?.id === entry.id ? ' is-pulled' : ''}`} onClick={() => take(entry)} onLongPress={() => setPreview(entry)}><Text className='recap-book__number'>第 {number} 期</Text><Text className='recap-book__title'>{journalBookTitle(entry)}</Text><Text className='recap-book__brand'>食探</Text>{marks[entry.id]?.stamp && <Text className='recap-book__stamp'>{marks[entry.id].stamp}</Text>}</View>
    })}</View></ScrollView>)}
    {!entries.length && <View className='recap-bookshelf__empty'><Text>书架，为你的生活留着位置</Text><Text>收到的阶段报告，会在这里成为一本书。</Text></View>}
    <Text className='recap-bookshelf__hint'>轻点取书 · 长按看书签</Text>
    {pulling && <View className='recap-book-focus'><Image src={`/assets/recap/${pulling.kind === 'year' ? 'annual-cover' : 'weekly-cover'}.jpg`} mode='aspectFill' /><Text>{journalBookTitle(pulling)}</Text><Text>食探 · 生活手记</Text></View>}
    {preview && <View className='recap-bookmark-mask' onClick={() => setPreview(null)}><View className='recap-bookmark' onClick={e => e.stopPropagation()}><Text>{journalBookTitle(preview)}</Text><Text>{preview.start} — {preview.end}</Text>{marks[preview.id]?.read ? <><Text>给这本书，留一枚印记</Text><View className='recap-bookmark__stamps'>{['已阅', '好好吃饭', '食探认证'].map(stamp => <View key={stamp} role='button' aria-label={`盖章${stamp}`} className={pressedStamp === stamp ? 'is-stamped' : ''} onClick={() => { setPressedStamp(stamp); onMark(preview.id, stamp) }}>{stamp}</View>)}</View></> : <Text>读完这本书，就能留下专属印章。</Text>}<View role='button' className='journal-wood-tag' onClick={() => take(preview)}>翻开这本书</View></View></View>}
  </View>
}
