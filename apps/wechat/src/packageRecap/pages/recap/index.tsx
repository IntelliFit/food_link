import { View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HealthRecap } from '../../../components/HealthRecap'
import { RecapBookshelf, bookMarksKey, readBookMarks, type BookMarks } from '../../../components/RecapBookshelf'
import { getAccessToken } from '../../../utils/api'
import type { RecapKind } from '../../../utils/health-recap'
import '../../../components/RecapDelivery.scss'
import './index.scss'

type Entry = { kind: RecapKind; anchor: string; start: string; end: string; id: string }
const storageKey = (owner: string) => `period-recaps-v1:${owner}`

function currentOwner(): string {
  try { return getAccessToken() ? String(Taro.getStorageSync('user_id') || '') : '' } catch { return '' }
}

function readEntries(owner: string): Entry[] {
  try {
    const value = Taro.getStorageSync(storageKey(owner))
    return Array.isArray(value)
      ? value.filter(item => item && ['week', 'month', 'year'].includes(item.kind) && /^\d{4}-\d{2}-\d{2}$/.test(item.anchor) && typeof item.id === 'string').slice(0, 60)
      : []
  } catch { return [] }
}

export default function RecapPage() {
  const router = useRouter()
  const owner = currentOwner()
  const entries = useMemo(() => owner ? readEntries(owner) : [], [owner])
  const requested = useMemo<Entry | null>(() => {
    const { kind, anchor, start, end, id } = router.params
    if (!['week', 'month', 'year'].includes(String(kind)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(anchor)) || !id) return null
    return { kind: kind as RecapKind, anchor: String(anchor), start: String(start || ''), end: String(end || ''), id: String(id) }
  }, [router.params])
  const [selected, setSelected] = useState<Entry | null>(requested)
  const [marks, setMarks] = useState<BookMarks>(() => owner ? readBookMarks(owner) : {})
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const updateMark = (id: string, stamp?: string) => {
    if (!owner || String(Taro.getStorageSync('user_id') || '') !== owner || !getAccessToken()) return
    const fresh = readBookMarks(owner)
    if (stamp && !fresh[id]?.read) return
    const next = { ...fresh, [id]: { read: true, stamp: stamp || fresh[id]?.stamp } }
    try { Taro.setStorageSync(bookMarksKey(owner), next) } catch { Taro.showToast({ title: '本次印记暂留在这里', icon: 'none' }) }
    setMarks(next)
  }
  const returnToShelf = () => {
    if (closing) return
    setClosing(true)
    closeTimer.current = setTimeout(() => { setSelected(null); setClosing(false) }, 600)
  }
  const shelfEntries = typeof __ENABLE_DEV_DEBUG_UI__ !== 'undefined' && __ENABLE_DEV_DEBUG_UI__
    ? entries.filter(entry => entry.kind === 'week').sort((a, b) => b.start.localeCompare(a.start)).slice(0, 1)
    : entries

  if (!owner) return <View className='recap-page' />
  return <View className='recap-page'>
    <View className={`recap-reader recap-reader--journal${selected ? ` recap-reader--story recap-reader--${selected.kind}` : ''}${closing ? ' is-closing' : ''}`} catchMove>
      <View className='recap-reader__close' role='button' aria-label={selected ? '合上书本' : '离开书架'} onClick={() => { if (selected) returnToShelf(); else void Taro.navigateBack() }}>{selected ? '✉' : '×'}</View>
      {selected
        ? <HealthRecap key={selected.id} active={!closing} selection={selected} onShelf={returnToShelf} onComplete={() => updateMark(selected.id)} />
        : <RecapBookshelf key={owner} owner={owner} entries={shelfEntries} marks={marks} onOpen={setSelected} onMark={updateMark} />}
    </View>
  </View>
}
