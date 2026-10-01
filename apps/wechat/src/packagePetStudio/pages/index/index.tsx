import { Image, View, Text, Button, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { memo, useEffect, useRef, useState } from 'react'
import { getPetSummary, getRewardCenter } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { PetAvatar } from '../../../components/PetAvatar'
import { PetCompanionSprite } from '../../../components/PetCompanionSprite'
import { getHomeCompanionPreference } from '../../../utils/pet-companion-preference'
import { buildStudioCharacters, availableStudioActions, canTryStudioScarf, readStudioScarf, saveStudioScarf, rhythmPoints, type StudioAction, type StudioCharacter } from '../../../utils/pet-studio'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import './index.scss'

type Tab = 'wardrobe' | 'actions' | 'arena'
const ROOM = '/packagePetStudio/assets/warm-room-v1.jpg'
const SCARF = '/packagePetStudio/assets/cozy-scarf-v1.png'
const actionNames: Record<StudioAction, string> = { idle: '待机', walk: '行走', hop: '跳跃' }
const games = [
  { id: 'kitchen', name: '厨房大乱斗', desc: '相同订单 · 限时比拼', icon: 'icon-foodshop' },
  { id: 'merge', name: '食材合成局', desc: '判断落点 · 连锁合成', icon: 'icon-all' },
  { id: 'fitness', name: '运动闯关', desc: '掌握节奏 · 挑战纪录', icon: 'icon-dumbbell' },
  { id: 'water', name: '水岸寻宝', desc: '划艇探索 · 收线寻宝', icon: 'icon-dizhi' },
]

const StudioCharacterView = memo(function StudioCharacterView({ character, scarf = false, action = 'idle' }: { character: StudioCharacter; scarf?: boolean; action?: StudioAction }) {
  return <View className={`studio-character ${character.sprite ? 'has-sprite' : ''} ${action === 'walk' ? 'is-walking' : ''}`}>
    {character.sprite ? <PetCompanionSprite src={character.sprite} name={character.name} /> : <PetAvatar pet={character.pet} size='large' motion={action === 'hop' ? 'companion' : 'static'} />}
    {scarf && canTryStudioScarf(character) ? <Image className='studio-character-scarf' src={SCARF} mode='aspectFit' /> : null}
  </View>
})

function PetStudioPage() {
  const [tab, setTab] = useState<Tab>('wardrobe')
  const [characters, setCharacters] = useState<StudioCharacter[]>([])
  const [selected, setSelected] = useState('')
  const [scarf, setScarf] = useState(false)
  const [action, setAction] = useState<StudioAction>('idle')
  const [playing, setPlaying] = useState(false)
  const [credits, setCredits] = useState<number | null>(null)
  const [error, setError] = useState(false)
  const [game, setGame] = useState('fitness')
  const [practice, setPractice] = useState(false)
  const [seconds, setSeconds] = useState(20)
  const [position, setPosition] = useState(0)
  const [score, setScore] = useState(0)
  const [feedback, setFeedback] = useState('跟随节奏，光点经过中央时点击')
  const [finished, setFinished] = useState(false)
  const started = useRef(0)
  const lastTap = useRef(0)
  const runRef = useRef(false)
  const loadSequence = useRef(0)
  const character = characters.find(item => item.id === selected) || characters[0]
  const actions = availableStudioActions(character)

  const load = async () => {
    setError(false)
    const sequence = ++loadSequence.current
    await Promise.allSettled([getPetSummary().then(summary => {
      if (sequence !== loadSequence.current) return
      const next = buildStudioCharacters(summary.pet, getHomeCompanionPreference())
      setCharacters(next); setSelected(next[0].id); setScarf(readStudioScarf(next[0])); setAction('idle'); setPlaying(false)
    }).catch(() => { if (sequence === loadSequence.current) { setCharacters([]); setError(true) } }), getRewardCenter().then(reward => {
      if (sequence === loadSequence.current) setCredits(reward.earned_credits_balance)
    }).catch(() => { if (sequence === loadSequence.current) setCredits(null) })])
  }
  useDidShow(() => { void load() })
  useDidHide(() => { loadSequence.current += 1; runRef.current = false; setPractice(false); setPlaying(false) })
  useEffect(() => () => { loadSequence.current += 1; runRef.current = false }, [])
  useEffect(() => {
    if (!practice) return undefined
    const timer = setInterval(() => {
      const elapsed = Date.now() - started.current
      setPosition(100 * (1 - Math.abs((elapsed % 1800) / 900 - 1)))
      setSeconds(Math.max(0, 20 - Math.floor(elapsed / 1000)))
      if (elapsed >= 20000) { runRef.current = false; setPractice(false); setFinished(true); setFeedback('练习完成，试试刷新自己的纪录') }
    }, 60)
    return () => clearInterval(timer)
  }, [practice])
  const selectCharacter = (next: StudioCharacter) => {
    setSelected(next.id); setScarf(readStudioScarf(next)); setAction('idle'); setPlaying(false)
  }
  const switchTab = (next: Tab) => { setTab(next); setPlaying(false); runRef.current = false; setPractice(false); setFinished(false) }
  const startPractice = () => {
    started.current = Date.now(); lastTap.current = 0; runRef.current = true
    setScore(0); setSeconds(20); setPosition(0); setFinished(false); setPractice(true); setFeedback('光点经过中央时点击')
  }
  const hit = () => {
    const now = Date.now()
    if (!runRef.current || now - started.current >= 20000 || now - lastTap.current < 250) return
    lastTap.current = now
    const actual = 100 * (1 - Math.abs(((now - started.current) % 1800) / 900 - 1))
    const points = rhythmPoints(actual)
    setScore(value => value + points); setFeedback(points === 10 ? '完美节奏 +10' : points === 5 ? '不错，再稳一点 +5' : '放松，再等下一个节拍')
  }

  return <View className='pet-studio-page'>
    <View className='studio-heading'><Text className='studio-eyebrow'>食探 · 温暖的宠物时光</Text><Text className='studio-title'>{tab === 'wardrobe' ? '一起装扮生活' : tab === 'actions' ? '每个动作，都有回应' : '遇见有趣的对手'}</Text><Text className='studio-caption'>熟悉的伙伴，陪你发现新的快乐</Text></View>
    <View className='studio-tabs'>{([['wardrobe', '宠物衣橱'], ['actions', '动作收藏'], ['arena', '匹配对战']] as [Tab, string][]).map(([id, label]) => <Button key={id} className={tab === id ? 'is-selected' : ''} onClick={() => switchTab(id)}>{label}</Button>)}</View>
    <View className='studio-panel'>
      <View className='studio-panel-heading'><Text>{tab === 'wardrobe' ? '我的衣橱' : tab === 'actions' ? '动作小剧场' : '友好切磋'}</Text><Button className='studio-balance' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/reward-center/index') })}>奖励积分 {credits === null ? '—' : credits}</Button></View>
      <ScrollView className='studio-selector' scrollX showScrollbar={false}><View className='studio-selector-track'>{characters.map(item => <Button key={item.id} className={`studio-choice ${character?.id === item.id ? 'is-selected' : ''}`} onClick={() => selectCharacter(item)}><View className='studio-thumbnail'><StudioCharacterView character={item} /></View><Text>{item.name}</Text><Text className='studio-tiny'>{item.current ? '当前伙伴' : '模板预览'}</Text></Button>)}</View></ScrollView>
      {!characters.length ? <View className='studio-empty'>{error ? <><Text>暂时没能读取宠物档案</Text><Button onClick={() => void load()}>重试</Button></> : <View className='studio-spinner' aria-label='正在读取宠物档案' />}</View> : <>
        <View className='studio-stage'><Image className='studio-room' src={ROOM} mode='aspectFill' /><View className='studio-stage-character'><StudioCharacterView character={character} scarf={tab === 'wardrobe' && scarf} action={tab === 'actions' && playing ? action : 'idle'} /></View><Text className='studio-stage-label'>{character.name} · {tab === 'wardrobe' ? scarf ? '暖暖围巾' : '原始形象' : tab === 'actions' ? playing ? actionNames[action] : '准备好就播放吧' : '准备出发'}</Text></View>
        {tab === 'wardrobe' ? <View className='studio-content'>
          <View className='studio-section-title'><Text>温暖小配饰</Text><Text className='studio-tiny'>首款免费试穿</Text></View>
          <View className='studio-wardrobe-grid'><Button className={`studio-item ${!scarf ? 'is-selected' : ''}`} onClick={() => setScarf(false)}><View className='studio-item-preview'><StudioCharacterView character={character} /></View><Text>原始装扮</Text><Text className='studio-tiny'>保留熟悉的模样</Text></Button><Button className={`studio-item ${scarf ? 'is-selected' : ''}`} disabled={!canTryStudioScarf(character)} onClick={() => { setScarf(true); setPlaying(false) }}><Image className='studio-scarf-item' src={SCARF} mode='aspectFit' /><Text>暖暖围巾</Text><Text className='studio-tiny'>{canTryStudioScarf(character) ? '免费 · 静态试穿' : '该体型待适配'}</Text></Button></View>
          <Text className='studio-note'>搭配保存在当前设备的宠物空间，暂不改变首页形象。更多服饰适配完成后开放。</Text>
          <Button id='studio-save-dressing' className='studio-primary' onClick={() => Taro.showToast({ title: saveStudioScarf(character, scarf) ? '搭配已保存' : '保存失败，请重试', icon: 'none' })}>保存搭配</Button>
          <Button className='studio-link' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/pet-home/index') })}>选择当前伙伴 / 拍照生成</Button>
        </View> : tab === 'actions' ? <View className='studio-content'>
          <View className='studio-section-title'><Text>已有动作</Text><Text className='studio-tiny'>只播放本角色素材</Text></View>
          <View className='studio-actions'>{actions.map(id => <Button key={id} className={action === id ? 'is-selected' : ''} onClick={() => { setAction(id); setPlaying(false) }}><Text className={`iconfont ${id === 'walk' ? 'icon-dumbbell' : 'icon-user'}`} /><Text>{actionNames[id]}</Text></Button>)}</View>
          <Button id='studio-play-action' className='studio-primary' onClick={() => setPlaying(value => !value)}>{playing ? '暂停动作' : '播放动作'}</Button>
          <Text className='studio-note'>招手、庆祝与比赛动作正在筹备。没有对应素材的动作不会用别的宠物替代。</Text>
        </View> : <View className='studio-content'>
          <View className='studio-section-title'><Text>选择挑战</Text><Text className='studio-tiny'>装扮不影响成绩</Text></View>
          <View className='studio-game-grid'>{games.map(item => <Button key={item.id} className={game === item.id ? 'is-selected' : ''} onClick={() => { setGame(item.id); runRef.current = false; setPractice(false); setFinished(false) }}><Text className={`iconfont ${item.icon}`} /><Text>{item.name}</Text><Text className='studio-tiny'>{item.desc}</Text></Button>)}</View>
          <View className='studio-match-status'><Text>匹配对战尚未开放</Text><Text className='studio-note'>真人匹配与代币结算接入后开放，当前不会安排虚拟对手或扣除积分。</Text></View>
          {game === 'fitness' ? <View className='studio-practice'><View className='studio-section-title'><Text>节奏练习</Text><Text>{seconds}秒 · {score}分</Text></View><Text className='studio-note'>{feedback}</Text><View className='studio-rhythm-track'><View className='studio-rhythm-target' /><View className='studio-rhythm-marker' style={{ left: `${position}%` }} /></View>{practice ? <Button id='studio-rhythm-hit' className='studio-primary' onClick={hit}>跟上节奏</Button> : <Button id='studio-practice-start' className='studio-primary' onClick={startPractice}>{finished ? '再练一局' : '开始20秒练习'}</Button>}<Text className='studio-tiny'>单人练习 · 不发放代币 · 不计入真实运动记录</Text></View> : <Text className='studio-note'>该游戏正在制作，先去运动闯关体验节奏练习。</Text>}
        </View>}
      </>}
    </View>
    <Text className='studio-footer'>好食光，好伙伴，一起更快乐</Text>
  </View>
}
export default withAuth(PetStudioPage)
