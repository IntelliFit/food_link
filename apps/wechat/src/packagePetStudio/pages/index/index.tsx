import { Button, Image, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getPetSummary, type PetProfile } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { PetActor, petActionCapabilities, type PetAction } from '../../../components/PetActor'
import { buildStudioCharacters } from '../../../utils/pet-studio'
import { getHomeCompanionPreference, HOME_COMPANION_CHANGED_EVENT, ORIGINAL_COMPANION_SRC } from '../../../utils/pet-companion-preference'
import { HOME_PET_PROFILE_CHANGED_EVENT } from '../../../utils/pet-events'
import { readPetLoadout, savePetLoadout, type PetLoadout } from '../../../utils/pet-loadout'
import { GROWTH_CHAPTERS, GROWTH_GAMES, GROWTH_SHOP, buyGrowthItem, choosePetWish, chapterTasks, chooseGrowthStory, growthLevel, newGrowthSave, newPetJourney, placeGrowthItem, settleGrowthRound, touchGrowthPet, type GrowthGame, type GrowthRound, type GrowthSave, type GrowthUpdate, type RoomSlot } from '../../../utils/pet-growth'
import { GROWTH_CHANGED, growthAccount, growthAccountOrNull, growthDay, readGrowth, writeGrowth } from '../../../utils/pet-growth-storage'
import { KITCHEN_LEVELS, type KitchenResult } from '../../../utils/pet-kitchen-game'
import type { AdventureResult } from '../../../utils/pet-adventure-game'
import { MERGE_LEVELS } from '../../../utils/pet-merge-game'
import { EXPLORE_COLLECTIBLES } from '../../../utils/pet-explore-game'
import { PetKitchenGame } from '../../components/PetKitchenGame'
import { PetAdventureGame } from '../../components/PetAdventureGame'
import { PetMergeGame } from '../../components/PetMergeGame'
import { PetExploreGame } from '../../components/PetExploreGame'
import { PET_MILESTONES, milestoneProgress } from '../../../utils/pet-milestones'
import './index.scss'

type Tab = 'home' | 'map' | 'collection' | 'story'
const ROOM = '/packagePetStudio/assets/growth-room-v1.jpg'
const ATLAS = '/packagePetStudio/assets/adventure-props-v1.png'
const cells: Record<string, [number, number]> = { plant: [0, 1], lamp: [1, 1], 'journey-card': [3, 1], leafboard: [0, 2] }
const names: Record<string, string> = { ...Object.fromEntries(PET_MILESTONES.map(item => [`badge:${item.id}`, item.name])), ...EXPLORE_COLLECTIBLES, 'journey-card': '初次出发旅途卡', 'cozy-scarf': '暖暖围巾', 'memory-first-light': '灯亮之前故事页', 'memory-riverside': '水岸失物故事页', 'memory-rain-cart': '雨天餐车故事页', ...Object.fromEntries(GROWTH_SHOP.map(item => [item.id, item.name])), ...Object.fromEntries(KITCHEN_LEVELS.map(item => [item.collectibleId, item.collectibleName])), ...Object.fromEntries(MERGE_LEVELS.map(item => [item.collectible, item.collectibleName])) }
const actionNames: Record<PetAction, string> = { idle: '休息', walk: '散步', jump: '跳跃', wave: '招手', blink: '眨眼', observe: '观察', celebrate: '庆祝', cook: '做饭' }
function Ornament({ item }: { item: string }) { const badge = PET_MILESTONES.find(entry => item === `badge:${entry.id}`); if (badge) return <View className={`journey-badge is-${badge.game}`}><Text>{badge.mark}</Text><Text>{badge.id.endsWith('-route') ? 'III' : badge.id.endsWith('-first') ? 'I' : 'II'}</Text></View>; const [column, row] = cells[item] || [2, 2]; return <View className='journey-ornament' style={{ backgroundImage: `url(${ATLAS})`, backgroundPosition: `${column * 100 / 3}% ${row * 50}%` }} /> }
function PetStudioPage() {
  const [pet, setPet] = useState<PetProfile | null>(null)
  const [account, setAccount] = useState('')
  const [save, setSave] = useState<GrowthSave>(newGrowthSave)
  const [tab, setTab] = useState<Tab>('home')
  const [badgeGame, setBadgeGame] = useState<GrowthGame>('kitchen')
  const [game, setGame] = useState<GrowthGame | null>(null)
  const [active, setActive] = useState(true)
  const [error, setError] = useState('')
  const [identityUnavailable, setIdentityUnavailable] = useState(false)
  const [notice, setNotice] = useState('')
  const [settlement, setSettlement] = useState('')
  const [pending, setPending] = useState<{ result: GrowthRound; id: string; scope: string } | null>(null)
  const [chapter, setChapter] = useState(1)
  const [slot, setSlot] = useState<RoomSlot>('window')
  const [action, setAction] = useState<PetAction>('idle')
  const [previewScarf, setPreviewScarf] = useState<PetLoadout['scarf']>(null)
  const request = useRef(0); const visible = useRef(true); const mounted = useRef(true); const profileDirty = useRef(false)
  const requestedGame = useRef<GrowthGame | null>((() => { const value = Taro.getCurrentPages().slice(-1)[0]?.options?.game; return GROWTH_GAMES.some(entry => entry.id === value) ? value as GrowthGame : null })())
  const scope = pet && account ? `${account}:${pet.id}` : ''
  const scopeRef = useRef(scope); scopeRef.current = scope
  const saveRef = useRef(save); saveRef.current = save
  const current = pet ? buildStudioCharacters(pet, getHomeCompanionPreference())[0] : undefined
  const appearance = current?.sprite || pet?.builtin_avatar_id || pet?.pixel_avatar_url || ''
  const compatible = appearance === ORIGINAL_COMPANION_SRC
  const journey = pet ? save.pets[pet.id] || newPetJourney() : newPetJourney()
  const growth = growthLevel(journey.xp)
  const wish = PET_MILESTONES.find(item => item.id === journey.wish)
  const selectedChapter = GROWTH_CHAPTERS.find(item => item.id === chapter) || GROWTH_CHAPTERS[0]
  const tasks = pet ? chapterTasks(save, pet.id, chapter) : []
  const latest = GROWTH_CHAPTERS.find(item => !journey.chapters.includes(item.id)) || GROWTH_CHAPTERS[2]
  const load = async () => {
    const sequence = ++request.current; const user = growthAccount()
    scopeRef.current = ''; setPet(null); setError(''); setPending(null); setGame(null); setSettlement(''); setNotice(''); setAction('idle'); setAccount(user)
    try {
      if (!user) throw new Error('请先登录再找回你的伙伴')
      const result = await getPetSummary()
      if (sequence !== request.current || growthAccount() !== user || !visible.current) return
      const stored = readGrowth(user, result.pet.id)
      if (sequence !== request.current || growthAccount() !== user || !visible.current) return
      profileDirty.current = false; setIdentityUnavailable(false); setActive(true); saveRef.current = stored; setSave(stored); setPet(result.pet)
      if (requestedGame.current) { setGame(requestedGame.current); requestedGame.current = null }
      const character = buildStudioCharacters(result.pet, getHomeCompanionPreference())[0]
      setPreviewScarf(readPetLoadout(result.pet.id, character.sprite || result.pet.builtin_avatar_id || result.pet.pixel_avatar_url || '')?.scarf || null)
    } catch (cause) { if (sequence === request.current && growthAccount() === user) setError(cause instanceof Error ? cause.message : '暂时没能读取宠物与成长存档') }
  }
  useDidShow(() => {
    visible.current = true
    const identity = growthAccountOrNull()
    if (identity === null) { setIdentityUnavailable(true); setActive(false); setNotice('暂时无法确认账号，请保留本局后重试'); if (!pet) setError('暂时无法确认账号，请重试读取'); return }
    setIdentityUnavailable(false)
    setActive(true); if (!pet || identity !== account || (profileDirty.current && !pending)) void load()
    else syncLedger()
  })
  useDidHide(() => { visible.current = false; setActive(false); request.current += 1 })
  useEffect(() => {
    const changed = () => { profileDirty.current = true; if (visible.current && !game && !pending) void load() }
    Taro.eventCenter.on(HOME_PET_PROFILE_CHANGED_EVENT, changed); Taro.eventCenter.on(HOME_COMPANION_CHANGED_EVENT, changed)
    return () => { Taro.eventCenter.off(HOME_PET_PROFILE_CHANGED_EVENT, changed); Taro.eventCenter.off(HOME_COMPANION_CHANGED_EVENT, changed) }
  })
  useEffect(() => () => { mounted.current = false; visible.current = false; request.current += 1 }, [])
  const isCurrent = (expected: string) => Boolean(expected && expected === scopeRef.current && visible.current && growthAccount() === account)
  const syncLedger = () => {
    if (!pet || !isCurrent(scope)) return
    try { const stored = readGrowth(account, pet.id); saveRef.current = stored; setSave(stored) }
    catch { setNotice('成长存档暂时无法读取，原来的进度已保留') }
  }
  useEffect(() => {
    Taro.eventCenter.on(GROWTH_CHANGED, syncLedger)
    return () => { Taro.eventCenter.off(GROWTH_CHANGED, syncLedger) }
  })
  const write = (mutate: (latestSave: GrowthSave) => GrowthUpdate) => {
    if (!pet || !isCurrent(scope)) return false
    try {
      const update = mutate(readGrowth(account, pet.id))
      if (!update.ok) { setNotice(update.message); return false }
      if (!writeGrowth(account, update.save)) { setNotice('没有保存成功，原来的进度仍在，请重试'); return false }
      saveRef.current = update.save; setSave(update.save); setNotice(update.message); return true
    } catch { setNotice('成长存档暂时无法读取，原来的进度已保留'); return false }
  }
  const settle = (result: GrowthRound, id: string, expected: string) => {
    if (!mounted.current || !pet || !expected || expected !== scopeRef.current) return
    const identity = growthAccountOrNull()
    if (identity !== null && identity !== account) return
    if (identity === null || !visible.current) { setPending({ result, id, scope: expected }); setSettlement(identity === null ? '暂时无法确认账号，请重试保存本局' : '本局等待保存，返回后请重试'); return }
    try {
      const update = settleGrowthRound(readGrowth(account, pet.id), pet.id, result, id, growthDay())
      if (!update.ok || !writeGrowth(account, update.save)) { setPending({ result, id, scope: expected }); setSettlement(update.ok ? '本局暂未保存，请重试保存' : update.message); return }
      saveRef.current = update.save; setSave(update.save); setPending(null); setSettlement(update.message)
    } catch { setPending({ result, id, scope: expected }); setSettlement('成长存档暂时无法读取，请重试保存本局') }
  }
  const retry = pending ? () => { if (growthAccountOrNull() === account) setActive(true); settle(pending.result, pending.id, pending.scope) } : undefined
  const leave = () => { if (pending) return; setGame(null); setSettlement(''); setTab('home'); if (profileDirty.current) void load() }
  const start = (next: GrowthGame) => { if (!isCurrent(scope) || pending) return; setGame(next); setSettlement(''); setAction('idle') }
  const kitchenFinished = (result: KitchenResult, id: string, expected: string) => settle({ game: 'kitchen', levelId: result.levelId || 1, score: result.score, stars: result.stars, completed: result.passed, collectibles: result.collectibleIds || [], detail: { served: result.served, bestCombo: result.bestCombo } }, id, expected)
  const adventureFinished = (result: AdventureResult, id: string, expected: string) => settle({ game: 'adventure', levelId: result.levelId, score: result.score, stars: result.stars, completed: result.completed, collectibles: result.collectibleIds || [], detail: { distance: result.distance } }, id, expected)
  if (pet && game) {
    const shared = { active, pet, accountId: scope, onExit: leave, settlementText: settlement, onRetrySettlement: retry }
    return <View className='journey-game-page'>{identityUnavailable && <View className='journey-account-recovery'><Text>本局已暂停，先重新确认账号。</Text><Button id='journey-recover-account' className='journey-button journey-primary' onClick={() => { const identity = growthAccountOrNull(); if (identity === null) return; if (identity !== account) { void load(); return }; setIdentityUnavailable(false); setActive(true) }}>重新确认账号</Button></View>}{game === 'kitchen' ? <PetKitchenGame {...shared} onFinished={kitchenFinished} /> : game === 'adventure' ? <PetAdventureGame {...shared} board={save.inventory.includes('leafboard') ? 'leafboard' : null} onFinished={adventureFinished} /> : game === 'merge' ? <PetMergeGame {...shared} onFinished={settle} /> : <PetExploreGame {...shared} onFinished={settle} />}</View>
  }
  return <View className='pet-journey-page'>
    <View className='journey-heading'><View><Text className='journey-eyebrow'>食探 · 伙伴时光</Text><Text className='journey-title'>{tab === 'home' ? '一起，把日子过暖' : tab === 'map' ? '带着好奇，出发吧' : tab === 'collection' ? '把喜欢带回家' : '我们的成长手册'}</Text></View><View className='journey-wallet'><Text>✦ {pet ? save.stars : '—'}</Text><Text>本机星光</Text></View></View>
    {!pet ? <View className='journey-empty'>{error ? <><Text>{error}</Text><Button className='journey-button journey-primary' onClick={() => void load()}>重试读取</Button></> : <View className='journey-spinner' aria-label='正在读取宠物档案' />}</View> : <>
      {tab === 'home' && <>
        <View className={`journey-room${journey.chapters.includes(1) ? ' is-warm' : ''}`}><Image src={ROOM} className='journey-room__image' mode='aspectFill' /><View className='journey-room__name'><Text>{pet.name}的小屋</Text><Text>Lv.{growth.level} · {journey.occupation === 'cook' ? '料理伙伴' : journey.occupation === 'explorer' ? '水岸探索者' : journey.occupation === 'active' ? '活力伙伴' : '新旅途，慢慢来'}</Text></View>
          {Object.entries(journey.placements).map(([position, item]) => item && <View key={position} className={`journey-room__prop is-${position}`}><Ornament item={item} /><Text>{names[item] || '旅途纪念'}</Text></View>)}
          <View id='journey-pet-touch' className='journey-room__actor' role='button' aria-label={`问候${pet.name}`} onClick={() => { if (write(latestSave => touchGrowthPet(latestSave, pet.id, growthDay()))) setAction('walk') }}><PetActor pet={pet} size={138} action={action} active={active} /></View><Text className='journey-room__speech'>{journey.chapters.includes(1) ? '灯亮了，今天的故事也有了归处。' : '先带回一张风景，再做一顿热乎的饭。'}</Text>
        </View>
        <View className='journey-level'><View><Text>成长 Lv.{growth.level}</Text><Text>{journey.xp} 经验 · 亲密 {journey.affinity}</Text></View><View className='journey-progress'><View style={{ width: `${growth.next ? Math.min(100, growth.current / growth.next * 100) : 100}%` }} /></View><Text>{growth.next ? `再积累 ${growth.next - growth.current} 经验，打开下一段成长` : '已来到首期成长里程碑'}</Text></View>
        <View className='journey-wish' id='journey-current-wish'><Text className='journey-wish__title'>{wish ? `我的心愿 · ${wish.name}` : '挑一个想赢回来的纪念'}</Text><Text>{wish ? `${wish.condition} · ${milestoneProgress(journey, wish)}/${wish.target}` : '12 枚技巧徽章，靠亲手完成挑战获得，永久珍藏。'}</Text>{wish && <View className='journey-progress'><View style={{ width: `${milestoneProgress(journey, wish) / wish.target * 100}%` }} /></View>}<Button id='journey-wishes-open' className='journey-button journey-text' onClick={() => setTab('collection')}>{wish && journey.badges.includes(wish.id) ? '心愿达成，去摆放徽章 ›' : '查看心愿与徽章 ›'}</Button></View>
        <View className='journey-two-actions'><Button id='journey-map-open' className='journey-button journey-primary' onClick={() => setTab('map')}>去小镇玩一局 ↗</Button><Button id='journey-collection-open' className='journey-button journey-secondary' onClick={() => setTab('collection')}>布置与换装</Button></View>
        <View className='journey-chapter-card'><View className='journey-section-heading'><Text>第 {latest.id} 章 · {latest.title}</Text><Button className='journey-button journey-text' onClick={() => { setChapter(latest.id); setTab('story') }}>查看 ›</Button></View>{chapterTasks(save, pet.id, latest.id).map(task => <View className={`journey-task${task.done ? ' is-done' : ''}`} key={task.label}><Text>{task.done ? '✓' : '○'}</Text><Text>{task.label}</Text></View>)}</View>
        <View className='journey-life-card'><Text>生活里的进步，也值得记下来</Text><Text>一顿饭、一次运动，或认真休息的一天。</Text><Button id='journey-record-open' className='journey-button journey-text' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/record-text/index') })}>去记录今天 ›</Button></View>
      </>}
      {tab === 'map' && <>
        <View className='journey-map'><Image src='/packagePetStudio/assets/chapter-map-v1.jpg' mode='aspectFill' className='journey-map__image' /><View className='journey-map__legend'><Text>湖畔小镇</Text><Text>四条路线，带回不同的纪念</Text></View>{GROWTH_GAMES.map((entry, index) => <Button id={`journey-map-${entry.id}`} key={entry.id} className={`journey-button journey-map__pin is-pin-${index}`} onClick={() => start(entry.id)}><Text>{entry.icon}</Text><Text>{entry.name}</Text></Button>)}</View>
        <View className='journey-section-heading'><Text>今天想去哪儿？</Text><Text className='journey-muted'>每款 6 关</Text></View><View className='journey-game-grid'>{GROWTH_GAMES.map(entry => <Button id={`journey-start-${entry.id}`} className={`journey-button journey-game-card is-${entry.id}`} key={entry.id} onClick={() => start(entry.id)}><View className='journey-game-card__top'><Text>{entry.icon}</Text><Text>{journey.cleared[entry.id].length}/6</Text></View><Text className='journey-game-card__name'>{entry.name}</Text><Text>{entry.description}</Text><Text className='journey-game-card__go'>出发 ›</Text></Button>)}</View>
        <View className='journey-fair-note'><Text>每款游戏当天首次有效游玩可得 6 星光。</Text><Text>之后可自由挑战与收集，装扮不增加战力。</Text></View><View className='journey-match-card'><Text>匹配 PK</Text><Text>真人匹配与服务器成绩核验尚未开放。</Text></View>
      </>}
      {tab === 'collection' && <>
        <View className='journey-section-heading'><Text>技巧徽章 · {journey.badges.length}/12</Text><Text className='journey-muted'>属于 {pet.name} 的成长</Text></View>
        <Text className='journey-muted'>选择一个心愿，按自己的节奏挑战。徽章不会过期，星光达上限后仍可获得。</Text>
        <View className='journey-actions'>{GROWTH_GAMES.map(entry => <Button key={entry.id} id={`journey-badges-${entry.id}`} className={`journey-button${badgeGame === entry.id ? ' is-selected' : ''}`} onClick={() => setBadgeGame(entry.id)}>{entry.name}</Button>)}</View>
        <View className='journey-milestones'>{PET_MILESTONES.filter(item => item.game === badgeGame).map(item => { const owned = journey.badges.includes(item.id); const progress = milestoneProgress(journey, item); return <View key={item.id} className={`journey-milestone${owned ? ' is-earned' : ''}`}><Ornament item={`badge:${item.id}`} /><View><Text className='journey-wish__title'>{item.name}</Text><Text>{item.condition}</Text><Text>{owned ? '已珍藏 · 可在下方摆进小屋' : `进度 ${progress}/${item.target}`}</Text><Button id={`journey-wish-${item.id}`} className='journey-button journey-text' onClick={() => write(latestSave => choosePetWish(latestSave, pet.id, journey.wish === item.id ? null : item.id))}>{journey.wish === item.id ? '取消追踪' : '设为心愿'}</Button></View></View> })}</View>

        <View className='journey-dressing-stage'><Image src={ROOM} mode='aspectFill' /><View className='journey-dressing-stage__actor'><PetActor pet={pet} size={154} scarf={previewScarf} action={action} active={active} showStatus /></View><Text>{pet.name} · {previewScarf === 'cozy-scarf' ? '暖暖围巾' : previewScarf === 'explorer-scarf' ? '探险围巾' : '熟悉的原始模样'}</Text></View>
        <View className='journey-outfits'>{([null, 'cozy-scarf', 'explorer-scarf'] as PetLoadout['scarf'][]).map(item => <Button id={`journey-outfit-${item || 'original'}`} className={`journey-button journey-outfit${previewScarf === item ? ' is-selected' : ''}`} key={item || 'original'} disabled={Boolean(item && (!compatible || !save.inventory.includes(item)))} onClick={() => setPreviewScarf(item)}>{item ? <Image src={`/packagePetStudio/assets/${item === 'cozy-scarf' ? 'cozy-scarf-v1' : 'explorer-scarf-v1'}.png`} mode='aspectFit' /> : <Text className='journey-outfit__plain'>○</Text>}<Text>{item ? names[item] : '原始装扮'}</Text><Text>{!item ? '始终可选' : !compatible ? '当前体型待适配' : save.inventory.includes(item) ? '已拥有 · 可试穿' : '小铺可兑换'}</Text></Button>)}</View>
        <Button id='journey-save-outfit' className='journey-button journey-primary' onClick={() => { if (!isCurrent(scope)) return; setNotice(savePetLoadout(pet.id, appearance, previewScarf, account) ? '搭配已保存，首页、聊天和游戏同步使用' : '没有保存成功，请重试') }}>确认穿搭</Button>
        <View className='journey-actions'>{petActionCapabilities(pet, current?.sprite).map(pose => <Button className={`journey-button${pose === action ? ' is-selected' : ''}`} key={pose} onClick={() => setAction(pose)}>{actionNames[pose]}</Button>)}</View><Button className='journey-button journey-text' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/pet-home/index') })}>选择其他模板 / 拍照生成伙伴 ›</Button>
        <View className='journey-section-heading'><Text>小屋的三个位置</Text><Text className='journey-muted'>纪念不会占住伙伴</Text></View><View className='journey-slots'>{([['window', '窗边'], ['table', '餐桌'], ['floor', '地面']] as [RoomSlot, string][]).map(([position, label]) => <Button id={`journey-slot-${position}`} className={`journey-button${slot === position ? ' is-selected' : ''}`} key={position} onClick={() => setSlot(position)}>{label}<Text>{journey.placements[position] ? names[journey.placements[position]!] || '旅途纪念' : '等一份纪念'}</Text></Button>)}</View>
        <View className='journey-inventory'>{save.inventory.filter(item => !item.endsWith('scarf') && item !== 'leafboard').map(item => <Button id={`journey-place-${item}`} className='journey-button journey-inventory__item' key={item} onClick={() => write(latestSave => placeGrowthItem(latestSave, pet.id, slot, item))}><Ornament item={item} /><Text>{names[item] || '冒险纪念'}</Text><Text>摆到{slot === 'window' ? '窗边' : slot === 'table' ? '餐桌' : '地面'} ›</Text></Button>)}</View><Button className='journey-button journey-text' onClick={() => write(latestSave => placeGrowthItem(latestSave, pet.id, slot, null))}>收拾这个位置</Button>
        <View className='journey-section-heading'><Text>星光小铺</Text><Text className='journey-muted'>明码兑换 · 无随机抽取</Text></View><View className='journey-shop'>{GROWTH_SHOP.map(item => <Button id={`journey-buy-${item.id}`} className='journey-button journey-shop__item' key={item.id} disabled={item.kind === 'clothing' && !compatible} onClick={() => write(latestSave => buyGrowthItem(latestSave, item.id))}><Text>{item.name}</Text><Text>{save.inventory.includes(item.id) ? '已拥有' : item.kind === 'clothing' && !compatible ? '该体型待适配' : `✦ ${item.cost}`}</Text></Button>)}</View>
      </>}
      {tab === 'story' && <>
        <View className='journey-chapter-tabs'>{GROWTH_CHAPTERS.map(item => <Button id={`journey-chapter-${item.id}`} className={`journey-button${chapter === item.id ? ' is-selected' : ''}`} key={item.id} onClick={() => setChapter(item.id)}><Text>第 {item.id} 章</Text><Text>{item.title}</Text></Button>)}</View><View className='journey-story'><Text className='journey-story__eyebrow'>成长手册 / CHAPTER 0{chapter}</Text><Text className='journey-story__title'>{selectedChapter.title}</Text><Text className='journey-story__text'>{selectedChapter.story}</Text><View className='journey-story__tasks'>{tasks.map(task => <View className={`journey-task${task.done ? ' is-done' : ''}`} key={task.label}><Text>{task.done ? '✓' : '○'}</Text><Text>{task.label}</Text></View>)}</View><Text className='journey-story__question'>把这一页，写成你们自己的选择</Text>{selectedChapter.choices.map((choice, index) => <Button id={`journey-story-choice-${index}`} className={`journey-button journey-story-choice${journey.choices[String(chapter)] === choice ? ' is-selected' : ''}`} disabled={!tasks.every(task => task.done)} key={choice} onClick={() => write(latestSave => chooseGrowthStory(latestSave, pet.id, chapter, choice))}><Text>{index === 0 ? 'A' : 'B'}</Text><Text>{choice}</Text></Button>)}<Text className='journey-muted'>{journey.chapters.includes(chapter) ? '这一页已珍藏 · 可以重新阅读和选择' : '完成三个目标后珍藏故事页，首次获得 30 成长经验'}</Text></View>
        {growth.level >= 3 && <View className='journey-occupation'><Text>伙伴的兴趣方向 · 随时可以换</Text>{([['cook', '料理伙伴'], ['explorer', '水岸探索者'], ['active', '活力伙伴']] as const).map(([id, label]) => <Button className={`journey-button${journey.occupation === id ? ' is-selected' : ''}`} key={id} onClick={() => { write(latestSave => { const next = JSON.parse(JSON.stringify(latestSave)) as GrowthSave; next.pets[pet.id].occupation = id; return { save: next, ok: true, message: `今天，做一个${label}` } }) }}>{label}</Button>)}</View>}
      </>}
      {notice && <View id='journey-notice' className='journey-notice' role='status'><Text>{notice}</Text><Button className='journey-button' onClick={() => setNotice('')}>×</Button></View>}<Text className='journey-footer'>本机成长与星光独立于 AI 积分 · 不以健康数据评分决定游戏输赢</Text>
    </>}
    <View className='journey-nav'>{([['home', '⌂', '小屋'], ['map', '⌖', '小镇'], ['collection', '◇', '收藏'], ['story', '▤', '故事']] as [Tab, string, string][]).map(([id, mark, label]) => <Button id={`journey-tab-${id}`} className={`journey-button${tab === id ? ' is-selected' : ''}`} key={id} onClick={() => { setTab(id); setAction('idle'); setNotice('') }}><Text>{mark}</Text><Text>{label}</Text></Button>)}</View>
  </View>
}
export default withAuth(PetStudioPage)
