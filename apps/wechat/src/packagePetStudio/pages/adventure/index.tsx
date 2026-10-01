import { Button, Image, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { PetIdentityAvatar } from '../../../components/PetIdentityAvatar'
import { getPetSummary, type PetProfile } from '../../../utils/api'
import { getHomeCompanionPreference } from '../../../utils/pet-companion-preference'
import { buildStudioCharacters, canTryStudioScarf } from '../../../utils/pet-studio'
import { ADVENTURE_LEVELS, type AdventureResult } from '../../../utils/pet-adventure-game'
import {
  ADVENTURE_SHOP_ITEMS, createAdventureProgress, deriveAdventureProgress,
  equipAdventureItem, normalizeAdventureProgress, placeAdventureItem,
  purchaseAdventureItem, settleAdventureRound,
  type AdventurePlacementSlot, type AdventureProgress, type AdventureProgressUpdate,
} from '../../../utils/pet-adventure-progress'
import { withAuth } from '../../../utils/withAuth'
import { PetAdventureGame } from '../../components/PetAdventureGame'
import './index.scss'

const PREFIX = 'pet_adventure_progress_v1:'
const ATLAS = '/packagePetStudio/assets/adventure-props-v1.png'
const SCARF = '/packagePetStudio/assets/explorer-scarf-v1.png'
const spriteCells: Record<string, [number, number]> = {
  leaf: [0, 0], star: [1, 0], rock: [2, 0], tree: [3, 0],
  plant: [0, 1], lamp: [1, 1], book: [2, 1], frame: [3, 1],
  leafboard: [0, 2], board: [1, 2], badge: [2, 2], gap: [3, 2],
}
const stories = [
  { id: 1, title: '第一次，一起出发', subtitle: '晨光林道 · 完成第一关解锁', text: '窗外的树叶轻轻摇晃，伙伴把一片叶子放在了门边。今天不必走得很远，先一起沿着湖岸出发。路上的每一点星光，都可以带回这个小小的家。' },
  { id: 2, title: '石桥上的那盏灯', subtitle: '石桥溪谷 · 完成第三关解锁', text: '过了石桥，天色渐渐温柔。伙伴记住了回家的方向，也记住了你在每一个路口的选择。小屋里若有一盏灯，下一次远行，就多了一份期待。' },
  { id: 3, title: '把远方带回家', subtitle: '云顶山径 · 完成第五关解锁', text: '山顶的风里，有湖岸的水汽，也有林间的草木香。你们收集的并不只有星光，还有一起走过的路。回到小屋，把喜欢的纪念放好，明天还有新的旅途。' },
]
function Sprite({ item, className = '' }: { item: string; className?: string }) {
  const [column, row] = spriteCells[item] || spriteCells.badge
  return <View className={`growth-sprite ${className}`} style={{ backgroundImage: `url(${ATLAS})`, backgroundPosition: `${column * 100 / 3}% ${row * 50}%` }} />
}
function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function readProgress(key: string) {
  return normalizeAdventureProgress(Taro.getStorageSync(key))
}
function currentAccount(): string | null {
  try { return String(Taro.getStorageSync('user_id') || '') } catch { return null }
}

function PetAdventurePage() {
  const [pet, setPet] = useState<PetProfile | null>(null)
  const [account, setAccount] = useState('')
  const [active, setActive] = useState(true)
  const [error, setError] = useState(false)
  const [progress, setProgress] = useState<AdventureProgress>(createAdventureProgress)
  const [screen, setScreen] = useState<'home' | 'play' | 'collection' | 'story'>('home')
  const [level, setLevel] = useState(1)
  const [story, setStory] = useState(1)
  const [placement, setPlacement] = useState<AdventurePlacementSlot>('left')
  const [settlement, setSettlement] = useState('')
  const [unsaved, setUnsaved] = useState<{ result: AdventureResult; roundId: string; scope: string } | null>(null)
  const request = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const scope = pet && account ? `${account}:${pet.id}` : ''
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const key = `${PREFIX}${scope}`
  const growth = deriveAdventureProgress(progress)
  const currentCharacter = pet ? buildStudioCharacters(pet, getHomeCompanionPreference()).find(character => character.current) : undefined
  const scarfCompatible = currentCharacter ? canTryStudioScarf(currentCharacter) : false
  const scarfEquipped = scarfCompatible && progress.equipment.scarf === 'explorer-scarf'

  const load = async () => {
    const sequence = ++request.current
    const userId = currentAccount()
    if (!userId) { setPet(null); setError(true); return }
    setAccount(userId); setPet(null); setError(false); setScreen('home'); setUnsaved(null); setSettlement('')
    scopeRef.current = ''
    setProgress(createAdventureProgress())
    try {
      const result = await getPetSummary()
      if (sequence !== request.current || currentAccount() !== userId) return
      const saved = readProgress(`${PREFIX}${userId}:${result.pet.id}`)
      setProgress(saved); setPet(result.pet)
    } catch { if (sequence === request.current && currentAccount() === userId) setError(true) }
  }
  useDidShow(() => {
    activeRef.current = true; setActive(true)
    const storedAccount = currentAccount()
    if (!pet || (storedAccount !== null && storedAccount !== account)) void load()
  })
  useDidHide(() => { activeRef.current = false; setActive(false); request.current += 1 })
  useEffect(() => () => { request.current += 1; activeRef.current = false }, [])

  const isCurrent = (expected = scope) => Boolean(expected && scopeRef.current === expected && activeRef.current && currentAccount() === account)
  const write = (update: AdventureProgressUpdate, expected = scope) => {
    if (!isCurrent(expected)) return false
    if (!update.ok) { Taro.showToast({ title: update.message, icon: 'none' }); return false }
    try {
      Taro.setStorageSync(`${PREFIX}${expected}`, update.progress)
      setProgress(update.progress)
      return true
    } catch { Taro.showToast({ title: '这次变更还没保存，请重试', icon: 'none' }); return false }
  }
  const change = (action: (value: AdventureProgress) => AdventureProgressUpdate) => {
    if (!isCurrent()) { if (currentAccount() === null) Taro.showToast({ title: '暂时无法确认账号，请重试', icon: 'none' }); return }
    try {
      const update = action(readProgress(key))
      if (write(update)) Taro.showToast({ title: update.message, icon: 'none' })
    } catch { Taro.showToast({ title: '暂时无法读取收藏，请重试', icon: 'none' }) }
  }
  const finish = (result: AdventureResult, roundId: string, sessionAccountId: string) => {
    if (!isCurrent(sessionAccountId)) {
      const storedAccount = currentAccount()
      if (scopeRef.current === sessionAccountId && (storedAccount === account || storedAccount === null)) {
        setUnsaved({ result, roundId, scope: sessionAccountId })
        setSettlement('回到前台后，请保存这次收获')
      }
      return
    }
    try {
      const stored = readProgress(`${PREFIX}${sessionAccountId}`)
      if (stored.settledRoundIds.includes(roundId)) { setProgress(stored); setSettlement('这段旅途已保存'); setUnsaved(null); return }
      const update = settleAdventureRound(stored, roundId, result, today())
      if (!write(update, sessionAccountId)) throw new Error('unsaved')
      setSettlement(`星光 +${update.earnedStars} · 冒险经验 +${update.earnedExperience}${result.completed ? ' · 旅途记录已更新' : ''}`)
      setUnsaved(null)
    } catch {
      setSettlement('收获尚未保存，重试后再离开')
      setUnsaved({ result, roundId, scope: sessionAccountId })
    }
  }
  const start = (id: number) => {
    if (!progress.unlockedLevels.includes(id)) return
    setLevel(id); setSettlement(''); setUnsaved(null); setScreen('play')
  }
  const exit = () => {
    if (Taro.getCurrentPages().length > 1) void Taro.navigateBack()
    else void Taro.redirectTo({ url: '/packagePetStudio/pages/index/index' })
  }

  if (!pet) return <View className='growth-loading'>{error ? <><Text>暂时没能读取伙伴档案</Text><Button className='growth-button growth-primary' onClick={() => void load()}>重新尝试</Button></> : <View className='growth-spinner' aria-label='正在读取伙伴档案' />}</View>
  if (screen === 'play') return <PetAdventureGame active={active} pet={pet} accountId={scope} startLevel={level} board={progress.equipment.board === 'leafboard' ? 'leafboard' : null} scarf={scarfEquipped} onFinished={finish} settlementText={settlement} onRetrySettlement={unsaved ? () => finish(unsaved.result, unsaved.roundId, unsaved.scope) : undefined} onExit={() => { if (unsaved) Taro.showToast({ title: '请先重试保存这次收获', icon: 'none' }); else setScreen('home') }} />

  return <View className='growth-page'>
    <View className='growth-header'><Button id='growth-back' className='growth-button growth-back' onClick={exit}>返回</Button><View><Text className='growth-eyebrow'>食探 · 伙伴的冒险时光</Text><Text className='growth-title'>{screen === 'collection' ? '把喜欢，带回家' : screen === 'story' ? '我们一起走过的路' : '今天，也一起出发'}</Text></View><View className='growth-balance'><Sprite item='star' /><Text>{progress.starBalance}</Text><Text>星光</Text></View></View>
    <View className='growth-nav'>{([['home', '小屋与旅途'], ['collection', '收藏与装扮'], ['story', '伙伴故事']] as const).map(([id, label]) => <Button key={id} id={`growth-tab-${id}`} className={`growth-button ${screen === id ? 'is-active' : ''}`} onClick={() => setScreen(id)}>{label}</Button>)}</View>

    {screen !== 'story' ? <View className='growth-room'>
      <Image className='growth-room-image' src='/packagePetStudio/assets/growth-room-v1.jpg' mode='aspectFill' />
      <View className='growth-room-caption'><Text>{pet.name}的小屋</Text><Text>{progress.inventory.length ? '旅途里的收获，正在这里生长' : '带一点星光回来，把小屋布置成喜欢的样子'}</Text></View>
      {(['left', 'center', 'right'] as AdventurePlacementSlot[]).map(slot => <Button key={slot} id={`growth-place-${slot}`} className={`growth-button growth-place growth-place--${slot} ${placement === slot && screen === 'collection' ? 'is-selected' : ''}`} onClick={() => { setPlacement(slot); setScreen('collection') }}>{progress.placements[slot] ? <Sprite item={progress.placements[slot]!} /> : <Text>{screen === 'collection' ? '在这里摆放' : '布置'}</Text>}</Button>)}
      <View className='growth-partner'><PetIdentityAvatar pet={pet} size={132} motion='static' />{scarfEquipped ? <Image className='growth-partner-scarf' src={SCARF} mode='aspectFit' /> : null}<Text>{pet.name}</Text></View>
      <View className='growth-room-board'><Sprite item={progress.equipment.board || 'board'} /></View>
    </View> : null}

    <View className='growth-level-strip'><View><Text>冒险 Lv.{growth.level}</Text><Text>{growth.levelXp}/100 经验 · {growth.clearedCount}/6 旅途</Text></View><View className='growth-xp-track'><View style={{ width: `${growth.levelXp}%` }} /></View></View>

    {screen === 'home' ? <>
      <View className='growth-invitation'><Text>{progress.clearedLevels.length ? '下一段路，已经准备好了' : '先去湖畔，收集第一束星光'}</Text><Text>换道躲避、起跳越过、蓄力冲刺。把沿途的收获带回小屋。</Text><Button id='growth-start' className='growth-button growth-primary' onClick={() => start(progress.unlockedLevels.find(id => !progress.clearedLevels.includes(id)) || 1)}>和{pet.name}出发</Button></View>
      <View className='growth-section-heading'><Text>我们的旅途</Text><Text>通关后解锁下一站</Text></View>
      <View className='growth-map'>{[1, 2, 3].map(chapterId => <View className='growth-chapter' key={chapterId}><Text className='growth-chapter-title'>{ADVENTURE_LEVELS.find(item => item.chapterId === chapterId)?.chapterName}</Text><View className='growth-chapter-levels'>{ADVENTURE_LEVELS.filter(item => item.chapterId === chapterId).map(item => {
        const unlocked = progress.unlockedLevels.includes(item.id)
        const best = progress.bests[String(item.id)]
        return <Button id={`growth-level-${item.id}`} key={item.id} disabled={!unlocked} className={`growth-button growth-level ${unlocked ? '' : 'is-locked'} ${best?.completed ? 'is-complete' : ''}`} onClick={() => start(item.id)}><View className='growth-level-pin'><Text>{unlocked ? String(item.id).padStart(2, '0') : '未解锁'}</Text></View><View><Text>{item.name}</Text><Text>{best ? `${best.stars}星 · 最佳${best.score}分` : unlocked ? `${item.durationMs / 1000}秒 · 出发吧` : `完成第${item.id - 1}关开启`}</Text></View></Button>
      })}</View></View>)}</View>
      <Button className='growth-button growth-link' onClick={() => setScreen('collection')}>看看星光可以换些什么</Button>
    </> : screen === 'collection' ? <>
      <View className='growth-section-heading'><Text>旅途收藏铺</Text><Text>现有 {progress.starBalance} 星光</Text></View>
      <View className='growth-shop'>{ADVENTURE_SHOP_ITEMS.map(item => {
        const owned = progress.inventory.includes(item.id)
        const compatible = item.kind !== 'scarf' || scarfCompatible
        const equipped = item.kind === 'board' ? progress.equipment.board === item.id : item.kind === 'scarf' ? progress.equipment.scarf === item.id : progress.placements[placement] === item.id
        return <View key={item.id} className={`growth-shop-item ${owned ? 'is-owned' : ''}`}><View className='growth-item-art'>{item.kind === 'scarf' ? <Image src={SCARF} mode='aspectFit' /> : <Sprite item={item.id} />}</View><Text className='growth-item-title'>{item.name}</Text><Text className='growth-item-description'>{item.description}</Text><Button id={`growth-item-${item.id}`} className='growth-button growth-item-action' disabled={!compatible || (!owned && progress.starBalance < item.cost)} onClick={() => {
          if (!owned) { change(value => purchaseAdventureItem(value, item.id)); return }
          if (item.kind === 'prop') change(value => placeAdventureItem(value, placement, equipped ? null : item.id))
          else change(value => equipAdventureItem(value, item.kind === 'board' ? 'board' : 'scarf', equipped ? null : item.id))
        }}
        >{!compatible ? '当前体型待适配' : owned ? equipped ? '收起' : item.kind === 'prop' ? `摆在${placement === 'left' ? '左侧' : placement === 'right' ? '右侧' : '前方'}` : '穿戴' : `${item.cost} 星光兑换`}</Button></View>
      })}</View>
      <View className='growth-placement-options'><Text>摆放位置</Text>{(['left', 'center', 'right'] as AdventurePlacementSlot[]).map(slot => <Button className={`growth-button ${placement === slot ? 'is-active' : ''}`} key={slot} onClick={() => setPlacement(slot)}>{slot === 'left' ? '窗边' : slot === 'right' ? '右侧' : '前方'}</Button>)}</View>
      <Text className='growth-note'>星光来自冒险收集，每日最多60颗。装扮只改变外观；小屋、收藏和进度保存在当前设备。</Text>
    </> : <View className='growth-stories'><View className='growth-story-tabs'>{stories.map(item => <Button id={`growth-story-${item.id}`} key={item.id} disabled={!progress.storyChapters.includes(item.id)} className={`growth-button ${story === item.id ? 'is-active' : ''}`} onClick={() => setStory(item.id)}>{item.id === 1 ? '晨光' : item.id === 2 ? '石桥' : '归途'}</Button>)}</View><View className='growth-story-book'><Sprite item='book' /><Text className='growth-story-title'>{stories[story - 1].title}</Text><Text className='growth-story-subtitle'>{stories[story - 1].subtitle}</Text><Text>{progress.storyChapters.includes(story) ? `${pet.name}的旅途故事\n\n${stories[story - 1].text}` : '故事的第一页，等你们一起去写。完成对应旅途后，这里的故事就会展开。'}</Text><Button className='growth-button growth-primary' onClick={() => { setScreen('home') }}>去写下一页</Button></View></View>}
    <Text className='growth-footer'>每一步，都在把伙伴的世界变得更丰富。</Text>
  </View>
}
export default withAuth(PetAdventurePage)
