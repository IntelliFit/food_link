import { Image, Slider, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { PetCompanionSprite } from './PetCompanionSprite'
import { JIANWEN_COMPANION_SRC } from '../utils/pet-companion-preference'

export function RecapMonths({ months, onSelect }: { months: { month: number; count: number }[]; onSelect: (value: string) => void }) {
  const [month, setMonth] = useState(1)
  const [touched, setTouched] = useState(false)
  const current = months[month - 1]
  const choose = (value: number) => {
    setMonth(value); setTouched(true)
    const item = months[value - 1]
    onSelect(`${value}月 · ${item.count}天记录`)
  }
  return <View className={`recap-film recap-film--${Math.floor((month % 12) / 3)}`}>
    <Image className='recap-film__landscape' src='/assets/recap/annual-seasons.jpg' mode='aspectFill' style={{ transform: `scale(1.5) translate(${[-12, 12, -12, 12][Math.floor((month % 12) / 3)]}%, ${[-10, 22, 12, -10][Math.floor((month % 12) / 3)]}%)` }} />
    <View key={month} className='recap-film__frame'><View className='recap-film__month'><Text className='recap-film__number'>{month}</Text><Text className='recap-film__unit'>月</Text></View><Text className='recap-film__count'>{current.count ? `${current.count} 天 · 留下足迹` : '这一月，留白'}</Text>
      <View className='recap-film__dots'>{months.map(item => <View key={item.month} className={item.month === month ? 'is-selected' : item.count ? 'has-record' : ''} />)}</View>
    </View>
    <View className='recap-film__scrub' catchMove onTouchMove={event => event.stopPropagation()}><Slider min={1} max={12} step={1} value={month} activeColor='#efc577' backgroundColor='#ffffff55' blockColor='#fff0ca' blockSize={26} onChanging={event => setMonth(event.detail.value)} onChange={event => choose(event.detail.value)} /><Text>{touched ? '这一帧，已留住' : '滑动，穿过十二个月'}</Text></View>
  </View>
}

const WORDS = ['慢慢来', '有在坚持', '好好休息', '重新出发']
export function RecapWishes({ value, onSelect }: { value: string; onSelect: (word: string) => void }) {
  return <View className={`recap-wishes${value ? ' has-wish' : ''}`}>
    {WORDS.map((word, index) => <View role='button' aria-label={`收下${word}`} key={word} className={`recap-wishes__orb recap-wishes__orb--${index}${value === word ? ' is-chosen' : ''}`} onClick={() => onSelect(word)}><Text>{word}</Text></View>)}
    <View key={value} className='recap-wishes__pet'><PetCompanionSprite src={JIANWEN_COMPANION_SRC} name='鬼鬼' pose={value ? 'wave' : 'idle'} /></View>
    <Text className='recap-wishes__hint'>{value ? `「${value}」带走啦` : '戳一个，把温柔带走'}</Text>
  </View>
}

const GOALS = ['散一会儿步', '伸个懒腰', '记录下一餐']
export function RecapDeparture({ value, active, onSelect }: { value: string; active: boolean; onSelect: (goal: string) => void }) {
  const [selected, setSelected] = useState(value || GOALS[0])
  const [holding, setHolding] = useState(false)
  const [departed, setDeparted] = useState(!!value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setHolding(false) }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => { if (!active) { if (timer.current) clearTimeout(timer.current); timer.current = null; setHolding(false) } }, [active])
  const depart = () => { cancel(); setDeparted(true); onSelect(selected) }
  const start = () => { if (!active || departed || timer.current) return; setHolding(true); timer.current = setTimeout(depart, 900) }
  return <View className={`recap-departure${holding ? ' is-charging' : ''}${departed ? ' has-departed' : ''}`}>
    <View className='recap-departure__pet'><PetCompanionSprite src={JIANWEN_COMPANION_SRC} name='鬼鬼' pose='idle' /></View>
    <View className='recap-departure__routes'>{GOALS.map((goal, index) => <View role='button' key={goal} className={selected === goal ? 'is-picked' : ''} onClick={() => { cancel(); setSelected(goal); setDeparted(false) }}><Text>{['↗', '↟', '＋'][index]}</Text><Text>{goal}</Text></View>)}</View>
    <View role='button' aria-label='长按出发' className='recap-departure__launch' onTouchStart={start} onTouchEnd={cancel} onTouchCancel={cancel}><View className='recap-departure__fill' /><Text>{departed ? '约好了！' : '按住，出发'}</Text></View>
    {!departed && <View role='button' className='recap-departure__alternative' onClick={depart}>或轻点这里出发</View>}
  </View>
}
