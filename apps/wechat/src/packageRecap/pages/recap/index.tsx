import { View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HealthRecap } from '../../../components/HealthRecap'
import { RecapBookshelf, bookMarksKey, readBookMarks, type BookMarks } from '../../../components/RecapBookshelf'
import { getAccessToken } from '../../../utils/api'
import { archiveRecaps, currentRecapOwner, normalizeRecapEntry, readRecapArchive, recoverWeeklyRecaps } from '../../../utils/recap-archive'
import type { JournalBook } from '../../../utils/recap-journal'
import '../../../components/RecapDelivery.scss'
import './index.scss'

export default function RecapPage() {
  const router = useRouter()
  const requested = useMemo(() => normalizeRecapEntry(router.params), [router.params])
  const [owner, setOwner] = useState(currentRecapOwner)
  const [entries, setEntries] = useState<JournalBook[]>([])
  const [selected, setSelected] = useState<JournalBook | null>(requested)
  const [marks, setMarks] = useState<BookMarks>(() => owner ? readBookMarks(owner) : {})
  const [closing, setClosing] = useState(false)
  const [syncing, setSyncing] = useState(true)
  const [shelfError, setShelfError] = useState('')
  const [offset, setOffset] = useState(0)
  const lastOffset = useRef(0), sequence = useRef(0), ownerRef = useRef(owner)
  const selectedRef = useRef(selected); selectedRef.current = selected
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { sequence.current += 1; if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const refresh = async (range = 0, readOnly = false) => {
    const user = currentRecapOwner(), token = getAccessToken(), serial = ++sequence.current
    const changed = ownerRef.current !== user
    ownerRef.current = user; setOwner(user); setShelfError(''); setSyncing(false)
    if (changed) { setEntries([]); setSelected(null); selectedRef.current = null; setClosing(false); setOffset(0); if (closeTimer.current) clearTimeout(closeTimer.current) }
    setMarks(user ? readBookMarks(user) : {})
    if (!user) return
    const current = () => sequence.current === serial && currentRecapOwner() === user && getAccessToken() === token
    try {
      setEntries(readRecapArchive(user))
      if (readOnly && !changed) return
      lastOffset.current = range; setSyncing(true)
      const recovered = await recoverWeeklyRecaps(new Date(), range, current)
      if (!current()) return
      const fresh = recovered.entries.length ? archiveRecaps(user, recovered.entries, token) : readRecapArchive(user)
      setEntries(fresh)
      if (recovered.incomplete) setShelfError('部分往期周报暂未取回，已收藏的书仍然保留。')
      else setOffset(range)
    } catch {
      if (current()) setShelfError('周报暂未取回，请重试。原有收藏不会被清空。')
    } finally { if (current()) setSyncing(false) }
  }
  useDidShow(() => { void refresh(0, Boolean(selectedRef.current)) })
  useDidHide(() => { sequence.current += 1; setSyncing(false) })

  const updateMark = (id: string, stamp?: string) => {
    if (!owner || currentRecapOwner() !== owner) return
    const fresh = readBookMarks(owner)
    if (stamp && !fresh[id]?.read) return
    const next = { ...fresh, [id]: { read: true, stamp: stamp || fresh[id]?.stamp } }
    try { Taro.setStorageSync(bookMarksKey(owner), next) } catch { Taro.showToast({ title: '本次印记暂留在这里', icon: 'none' }) }
    setMarks(next)
  }
  const returnToShelf = () => {
    if (closing) return
    const expectedOwner = owner
    setClosing(true)
    closeTimer.current = setTimeout(() => {
      if (currentRecapOwner() !== expectedOwner) return
      setSelected(null); selectedRef.current = null; setClosing(false); void refresh()
    }, 600)
  }

  if (!owner) return <View className='recap-page' />
  return <View className='recap-page'>
    <View className={`recap-reader recap-reader--journal${selected ? ` recap-reader--story recap-reader--${selected.kind}` : ''}${closing ? ' is-closing' : ''}`} catchMove>
      <View className='recap-reader__close' role='button' aria-label={selected ? '合上书本' : '离开书架'} onClick={() => { if (selected) returnToShelf(); else void Taro.navigateBack() }}>{selected ? '✉' : '×'}</View>
      {selected
        ? <HealthRecap key={`${owner}:${selected.id}`} active={!closing} selection={selected} onShelf={returnToShelf} onComplete={() => updateMark(selected.id)} />
        : <RecapBookshelf key={owner} owner={owner} entries={entries} marks={marks} syncing={syncing} error={shelfError} onRetry={() => void refresh(lastOffset.current)} onEarlier={!syncing && offset < 48 ? () => void refresh(offset + 12) : undefined} onOpen={entry => { if (currentRecapOwner() === owner) setSelected(entry) }} onMark={updateMark} />}
    </View>
  </View>
}
