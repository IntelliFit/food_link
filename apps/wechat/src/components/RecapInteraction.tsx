import { Text, Textarea, View } from '@tarojs/components'
import { useState } from 'react'
import type { RecapDay, RecapKind } from '../utils/health-recap'

const STICKERS = ['✦ 开篇', '⌁ 足迹', '✧ 发现', '♡ 关照', '➜ 出发', '✓ 珍藏']

export function RecapInteraction({ chapter, kind, days, favorite, collected, collect }: {
  chapter: number; kind: RecapKind; days: RecapDay[]; favorite: number;
  collected: number[]; collect: (chapter: number) => void
}) {
  const [choice, setChoice] = useState<number | null>(null)
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')
  const [goal, setGoal] = useState('')
  const [pet, setPet] = useState(false)
  const recorded = days.filter(day => day.has_record)
  return <View className='recap-play'>
    {chapter === 0 && <>
      <Text className='recap-play__title'>{kind === 'year' ? '年度电影 · 你是主角' : kind === 'month' ? '生活花园 · 慢慢生长' : '周末手账 · 拆开小惊喜'}</Text>
      <View role='button' className='recap-play__action' onClick={() => setPet(!pet)}>和鬼鬼打个招呼 ✦</View>
      {pet && <Text className='recap-play__reply'>这一程，我陪你慢慢看。想先看哪一章，就点上面的进度条。</Text>}
    </>}
    {chapter === 1 && <>
      <Text className='recap-play__title'>轻点一枚足迹，翻开那段回忆</Text>
      <View className='recap-play__choices'>
        {(kind === 'year' ? [...new Set(days.map(day => day.date.slice(0, 7)))] : days.map(day => day.date)).map(date => <View role='button' key={date} className={`recap-play__chip${selected === date ? ' is-picked' : ''}`} onClick={() => setSelected(date)}>{kind === 'year' ? `${Number(date.slice(5))}月` : date.slice(5)}</View>)}
      </View>
      {selected && <Text className='recap-play__reply'>{selected} · {recorded.filter(day => day.date.startsWith(selected)).length ? `留下 ${recorded.filter(day => day.date.startsWith(selected)).length} 天饮食足迹。谢谢那时认真记录的你。` : '这一格留白，也属于你的生活。'}</Text>}
    </>}
    {chapter === 2 && <>
      <Text className='recap-play__title'>{recorded.length ? '凭直觉猜猜：哪天最常遇见你的记录？' : '故事还没开始，下次记录后再来揭晓'}</Text>
      {!!recorded.length && <><View className='recap-play__choices'>{Array.from({ length: 7 }, (_, day) => <View role='button' key={day} className={`recap-play__chip${choice === day ? ' is-picked' : ''}`} onClick={() => setChoice(day)}>周{'日一二三四五六'[day]}</View>)}</View>
        {choice !== null && <Text className='recap-play__reply'>{choice === favorite ? '默契满分！' : '发现了一个意外的小习惯！'}代表日是周{'日一二三四五六'[favorite]}。并列时展示星期顺序较早的一天。</Text>}
        {choice === null && <View role='button' className='recap-play__skip' onClick={() => setChoice(favorite)}>直接揭晓 →</View>}</>}
    </>}
    {chapter === 3 && <><Text className='recap-play__title'>送给这段时间的自己一个词</Text><View className='recap-play__choices'>{['慢慢来', '有在坚持', '好好休息', '重新出发'].map(word => <View role='button' key={word} className={`recap-play__chip${selected === word ? ' is-picked' : ''}`} onClick={() => setSelected(word)}>{word}</View>)}</View>{selected && <Text className='recap-play__reply'>「{selected}」——你最了解自己的节奏。</Text>}</>}
    {chapter === 4 && <><Text className='recap-play__title'>下一次，想从哪一步出发？</Text><View className='recap-play__choices'>{['散一会儿步', '伸个懒腰', '记录下一餐'].map(word => <View role='button' key={word} className={`recap-play__chip${goal === word ? ' is-picked' : ''}`} onClick={() => setGoal(word)}>{word}</View>)}</View>{goal && <Text className='recap-play__reply'>这一刻的小约定：{goal}。按自己的节奏就好。</Text>}</>}
    {chapter === 5 && <><Text className='recap-play__title'>这次旅程的贴纸收藏</Text><View className='recap-play__choices'>{STICKERS.map((sticker, index) => <Text key={sticker} className={`recap-play__chip${collected.includes(index) ? ' is-picked' : ''}`}>{collected.includes(index) ? sticker : '· 待收集'}</Text>)}</View><Textarea className='recap-play__letter' maxlength={100} value={message} onInput={event => setMessage(event.detail.value)} placeholder='给下一阶段的自己留句话…' /><Text className='recap-play__skip'>寄语和选择仅保留在本次阅读中</Text></>}
    <View role='button' className='recap-play__stamp' onClick={() => collect(chapter)}>{collected.includes(chapter) ? `${STICKERS[chapter]} · 已收入纪念册` : `收下本章贴纸 ${STICKERS[chapter]}`}</View>
  </View>
}
