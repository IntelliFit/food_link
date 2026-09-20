import { Image, Text, Textarea, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import type { RecapDay, RecapKind } from '../utils/health-recap'
import { emptyJourney, personalOpening, recordGuessChoices, shortDate, storyMemories, type RecapJourney } from '../utils/recap-story'
import { JIANWEN_COMPANION_SRC } from '../utils/pet-companion-preference'
import { PetCompanionSprite } from './PetCompanionSprite'
import { RecapDeparture, RecapMonths, RecapWishes } from './RecapPlay'
import './RecapScene.scss'

const WEEK_TITLES = ['这一周，认真生活的你', '每一餐，都是小日子', '原来，你一直在前进', '把温柔，带回家', '下一站，你来选', '把这一段，收进回忆']
const YEAR_TITLES = ['你的年度生活电影', '走过四季，遇见自己', '十二个月，各有回声', '把温柔，带回家', '下一站，你来选', '颁给认真生活的你']
const STONES = [{ x: 35, y: 80 }, { x: 65, y: 71 }, { x: 35, y: 64 }, { x: 63, y: 57 }, { x: 37, y: 50 }, { x: 61, y: 44.5 }, { x: 42, y: 38.5 }]
const SEASONS = [{ x: 28, y: 28 }, { x: 74, y: 36 }, { x: 25, y: 55 }, { x: 74, y: 66 }]


export function RecapScene({ recipient, chapter, kind, days, recorded, longest, average, title, next, bodyLine, waterLine, exercise, refresh, busy, updatedAt, journey: shared, onJourney, active = true, completed = false, onShare }: {
  recipient?: string; chapter: number; kind: RecapKind; days: RecapDay[]; recorded: number; longest: number;
  average: number | null; title: string; next: () => void;
  bodyLine?: string; waterLine?: string; exercise?: { days: number; count: number; calories: number };
  refresh?: () => void; busy?: boolean; updatedAt?: string;
  journey?: RecapJourney; onJourney?: (change: Partial<RecapJourney>) => void; active?: boolean; completed?: boolean; onShare?: () => void;
}) {
  const [local, setLocal] = useState(emptyJourney)
  const [reveal, setReveal] = useState<number | null>(null)
  const [details, setDetails] = useState(false)
  const [savedFact, setSavedFact] = useState('')
  const [motion, setMotion] = useState(0)
  const [guess, setGuess] = useState<number | null>(null)
  const [walking, setWalking] = useState(false)
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (walkTimer.current) clearTimeout(walkTimer.current) }, [])
  useEffect(() => { if (!active) { setWalking(false); if (walkTimer.current) clearTimeout(walkTimer.current) } }, [active])
  const journey = shared ?? local
  const update = (change: Partial<RecapJourney>) => { if (onJourney) onJourney(change); else setLocal(previous => ({ ...previous, ...change })) }
  const annual = kind === 'year'
  const memories = storyMemories(days, kind)
  const selected = memories.find(memory => memory.id === journey.memory)
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, count: days.filter(day => day.has_record && Number(day.date.slice(5, 7)) === index + 1).length }))
  const first = days.find(day => day.has_record)
  const facts = [
    { label: '日子的味道', value: `${recorded} 天`, copy: first ? `本期最早的一笔在${shortDate(first.date)}。每一份记录，都让回忆更具体。` : '餐桌先留白，下一餐可以写下第一页。' },
    { label: '坚持的节奏', value: `${longest} 天`, copy: longest ? '这是本期最长连续记录。中间的留白不扣分，回来就能继续。' : '还没有连续记录，先从方便的一天开始。' },
    { label: '热量记忆', value: average === null ? '等待记录' : `${average} kcal`, copy: average === null ? '日均热量等待记录' : '有记录日期的日均热量。未记录日不算零；这不代表完整实际摄入。' },
  ]
  const revealFact = (index: number) => { setReveal(index); setDetails(false); setMotion(value => value + 1) }
  const image = annual ? (chapter === 0 ? 'annual-cover' : chapter === 5 ? 'annual-keepsake' : 'annual-seasons') : ['weekly-cover', 'weekly-table', 'weekly-path', 'weekly-path', 'weekly-path', 'weekly-table'][chapter]
  const selectMemory = (id: string) => {
    update({ memory: id }); setMotion(value => value + 1); setWalking(true)
    if (walkTimer.current) clearTimeout(walkTimer.current)
    walkTimer.current = setTimeout(() => setWalking(false), 1500)
  }
  const guide = chapter === 0 ? annual ? '点票券，开启旅程' : '点信封，开启回忆' : chapter === 1 ? annual ? '点一个季节，回去看看' : '点餐盘，收集回忆' : chapter === 2 ? selected ? '已夹进纪念册' : '点足迹，鬼鬼陪你走' : chapter === 3 ? '选一个词，送给自己' : '选好下一步，我们就出发'
  return <View className={`recap-stage recap-stage--${chapter} recap-stage--${kind}${active ? ' is-current' : ''}${journey.opened && chapter === 0 ? ' is-opened' : ''}`}>
    <Image className='recap-stage__background' src={`/assets/recap/${image}.jpg`} mode='aspectFill' />
    {chapter === 0 && !annual && <View role='button' aria-label={journey.opened ? '已拆开的生活来信' : '打开桌上的信封'} className={`recap-envelope${journey.opened ? ' is-open' : ''}`} onClick={() => { if (!journey.opened) update({ opened: true }) }}>
      <View className='recap-envelope__back' />
      <View className='recap-envelope__flap' />
      <View className='recap-envelope__paper'>{journey.opened && <><Text className='recap-envelope__salutation'>尊敬的{recipient || '朋友'}：</Text><Text className='recap-envelope__blessing'>愿你三餐有暖，心中有光。{kind === 'month' ? '新的一月' : '新的一周'}，不必急着做到完美，每一小步都值得珍惜。</Text><Text className='recap-envelope__signature'>食探，陪你慢慢向前 ♡</Text></>}</View>
      <View className='recap-envelope__pocket' />
      <View className='recap-envelope__seal'><Text>✦</Text></View>
    </View>}
    <View className='recap-stage__heading'>
      <Text className='recap-stage__eyebrow'>{annual ? `${days[0]?.date.slice(0, 4) ?? ''} · 四季生活旅程` : kind === 'month' ? '月报 · 生活慢慢生长' : '周报 · 一周生活小剧场'}</Text>
      <Text className='recap-stage__title'>{annual ? YEAR_TITLES[chapter] : kind === 'month' && chapter === 0 ? '这一月，认真生活的你' : WEEK_TITLES[chapter]}</Text>
    </View>
    {chapter === 0 && annual && <View className='recap-stage__opening'>
      {journey.opened ? <View className='recap-stage__letter-paper'><Text>{recorded} 天，被你认真地记录下来</Text><Text className='recap-stage__dates'>{days.filter(day => day.has_record).slice(0, 2).map(day => shortDate(day.date)).join(' · ')}</Text>{details && <Text>{personalOpening(days, longest)}</Text>}<View role='button' className='recap-stage__detail-toggle' onClick={() => setDetails(!details)}>{details ? '收起' : '看看这段故事'}</View></View> : <Text className='recap-stage__sealed-copy'>{annual ? '你的年度电影票' : '你的生活来信'}</Text>}
      <View role='button' className='recap-stage__primary recap-stage__unseal' onClick={() => { if (!journey.opened) update({ opened: true }); else next() }}>{journey.opened ? annual ? '出发 →' : '去餐桌 →' : annual ? '开启电影' : '拆开这封信'}</View>
    </View>}
    {chapter === 1 && !annual && <>
      {recorded > 0 && guess === null ? <View className='recap-guess'><Text>猜猜，这次记了几天？</Text><View>{recordGuessChoices(recorded, days.length).map(choice => <View role='button' key={choice} onClick={() => { setGuess(choice); revealFact(0) }}><Text>{choice}</Text><Text>天</Text></View>)}</View><View role='button' className='recap-guess__skip' onClick={() => setGuess(-1)}>直接揭晓</View></View> : <View className='recap-stage__table'>{facts.map((fact, index) => <View role='button' aria-label={`揭晓${fact.label}`} key={`${fact.label}:${reveal === index ? motion : 0}`} className={`recap-stage__plate recap-stage__plate--${index}${journey.discoveries.includes(index) ? ' is-found' : ''}${reveal === index ? ' is-picked' : ''}`} onClick={() => revealFact(index)}><Text>{journey.discoveries.includes(index) ? fact.value : fact.label}</Text><Text>{journey.discoveries.includes(index) ? '✓' : '＋'}</Text></View>)}</View>}
      {reveal !== null && <View key={motion} className='recap-stage__discovery'><Text className='recap-stage__discovery-value'>{facts[reveal].value}</Text><Text>{reveal === 0 && guess !== null && guess >= 0 ? guess === recorded ? '猜中了！' : '揭晓，你留下了这些日子' : facts[reveal].label}</Text>{details && <Text>{facts[reveal].copy}</Text>}<View role='button' className='recap-stage__detail-toggle' onClick={() => setDetails(!details)}>{details ? '收起说明' : '记录说明'}</View><Text className='recap-stage__small'>{journey.discoveries.length}/3 已收集</Text><View role='button' className='recap-stage__primary recap-stage__keep-fact' onClick={() => { if (!journey.discoveries.includes(reveal)) update({ discoveries: [...journey.discoveries, reveal] }); setSavedFact(facts[reveal].value); setMotion(value => value + 1); setReveal(null) }}>收下</View></View>}
      {savedFact && <Text key={motion} className='recap-stage__flying-fact'>{savedFact}</Text>}
      {details && <Text className='recap-stage__art-note'>餐食为场景插画，数字来自你的记录</Text>}
    </>}
    {((chapter === 1 && annual) || (chapter === 2 && !annual)) && <>
      <View className='recap-stage__path'>{memories.map((memory, index) => { const point = annual ? SEASONS[index] : STONES[index]; return <View role='button' aria-label={`查看${memory.label}${annual ? '季' : ''}记录`} key={`${memory.id}:${motion}`} className={`recap-stage__step${motion ? ' is-visited' : ''}${memory.count ? ' is-recorded' : ''}${journey.memory === memory.id ? ' is-picked' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%`, animationDelay: `${index * 65}ms` }} onClick={() => selectMemory(memory.id)}><Text>{memory.label}</Text><Text>{annual ? `${memory.count}天` : memory.count ? '有记录' : '留白'}</Text></View> })}
        {!annual && <View className={`recap-stage__walking-pet${walking ? ' is-walking' : ''}`} style={{ left: `${STONES[selected ? memories.indexOf(selected) : 0].x - 13}%`, top: `${STONES[selected ? memories.indexOf(selected) : 0].y - 10}%` }}><PetCompanionSprite src={JIANWEN_COMPANION_SRC} name='鬼鬼' pose={walking ? 'idle' : 'wave'} /></View>}
      </View>
      {selected && <View className='recap-stage__memory'><Text>{annual ? `${selected.label}季 · ${selected.count} 天记录` : kind === 'week' ? `${shortDate(selected.id)} · ${selected.count ? '这一天，你留下了一份记录' : '留白也是生活的一部分'}` : `${selected.label} · ${selected.count} 天饮食记录`}</Text></View>}
    </>}
    {chapter === 2 && annual && <RecapMonths months={months} onSelect={memory => update({ memory })} />}
    {chapter === 3 && <>
      <RecapWishes value={journey.care} onSelect={care => update({ care })} />
      <View className='recap-stage__optional-data' onTouchStart={event => event.stopPropagation()}><View role='button' onClick={() => setDetails(!details)}>{details ? '收起' : '看看饮水与身体记录'}</View>{details && <View><Text>{waterLine}</Text><Text>{bodyLine}</Text></View>}</View>
    </>}
    {chapter === 4 && <>
      <Text className='recap-stage__exercise-sign'>{exercise ? exercise.days ? `运动记录 · ${exercise.days} 天` : '下一段足迹，等你留下' : '运动记录暂不可用'}</Text>
      <RecapDeparture value={journey.goal} active={active} onSelect={goal => update({ goal })} />
      <View className='recap-stage__optional-data' onTouchStart={event => event.stopPropagation()}><View role='button' onClick={() => setDetails(!details)}>{details ? '收起' : '记录详情'}</View>{details && <Text>{exercise ? `${exercise.count} 条记录 · 估算消耗 ${exercise.calories} kcal；条数不等于训练次数。` : '本次未取到运动数据。'}</Text>}</View>
    </>}
    {chapter === 5 && <View className='recap-stage__ending' onTouchStart={event => event.stopPropagation()}>
      <View className={`recap-stage__certificate${journey.stamped ? ' is-stamped' : ''}`}>
        <Text className='recap-stage__award'>{journey.care || title}</Text><Text>{recorded} 天记录 · 最长连续 {longest} 天</Text>
        <View className='recap-stage__souvenirs'>{journey.discoveries.map(index => <View key={index}><Text>{['◷', '∞', '✧'][index]}</Text><Text>{facts[index].value}</Text></View>)}</View>
        {journey.memory && <Text className='recap-stage__kept'>{selected ? `${selected.label}${annual ? '季' : kind === 'week' ? '日' : ''} · ${selected.count} 天记录` : journey.memory}</Text>}
        {journey.goal && <Text className='recap-stage__promise'>{journey.goal} →</Text>}
        <View role='button' aria-label='盖上旅程纪念章' className='recap-stage__stamp' onClick={() => update({ stamped: !journey.stamped })}>{journey.stamped ? '生活留念' : '点我盖章'}</View>
        <View role='button' className='recap-stage__detail-toggle' onClick={() => setDetails(!details)}>{details ? '收起' : '关于这张纪念卡'}</View>
        {details && <Text className='recap-stage__small'>称号不是健康评分；选择仅保留在本次阅读。更新于 {updatedAt}</Text>}
      </View>
      {reveal === null ? <View role='button' className='recap-stage__primary' onClick={() => setReveal(0)}>给未来的我留言</View> : <><Textarea className='recap-stage__letter-input' maxlength={100} value={journey.letter} onInput={event => update({ letter: event.detail.value })} placeholder='下一阶段，我想对自己说…' /><Text className='recap-stage__small'>寄语与选择仅保留在本次阅读中。</Text></>}
      {completed && <View role='button' className='recap-stage__primary recap-stage__share' onClick={onShare}>导出纪念海报 · 二维码分享</View>}<View className='recap-stage__end-actions'>{completed && <View role='button' onClick={next}>回看旅程</View>}<View role='button' onClick={() => { if (!busy) refresh?.() }}>{busy ? '…' : '更新数据'}</View></View>
    </View>}
    {chapter > 0 && chapter < 3 && !(chapter === 2 && annual) && !(chapter === 1 && !annual) && !(chapter === 0 && journey.opened) && <View className={`recap-stage__guide${chapter === 0 ? ' recap-stage__guide--cover' : ''}`}>{chapter !== 0 && !(chapter === 2 && !annual) && <View className='recap-stage__guide-pet'><PetCompanionSprite src={JIANWEN_COMPANION_SRC} name='鬼鬼' pose={active ? 'blink' : 'idle'} /></View>}<Text>{guide}</Text></View>}
  </View>
}
