import { Button, Image, Text, View } from '@tarojs/components'
import { useState } from 'react'
import { PetActor } from '../../components/PetActor'
import type { PetProfile } from '../../utils/api'
import { ADVENTURE_COLLECTIBLES, adventureLevel } from '../../utils/pet-adventure-game'
import { MERGE_LEVELS } from '../../utils/pet-merge-game'
import { GROWTH_GAMES, type PlayableGrowthGame, type GrowthSave, type PetJourney } from '../../utils/pet-growth'
import './PetPlayLobby.scss'

const descriptions: Record<PlayableGrowthGame, { hook: string; action: string; rhythm: string; challenge: string }> = {
  adventure: { hook: '这一跳，把风景带回家', action: '点一下起跳 · 自动向前跑', rhythm: '30 秒', challenge: '连续三次跳准，触发 5 秒双倍得分' },
  merge: { hook: '再合一下，就能端上桌', action: '滑动合成 · 配好食材交菜', rhythm: '不限时', challenge: '留出空位，拼出下一道餐盘' },
}
export function nextPlayLevel(journey: PetJourney, game: PlayableGrowthGame): number { return [1, 2, 3, 4, 5, 6].find(id => !journey.cleared[game].includes(id)) || 6 }
function prize(game: PlayableGrowthGame, levelId: number, inventory: string[]): string {
  if (game === 'adventure') {
    const next = [...adventureLevel(levelId).scenes.map(item => item.collectibleId), `adventure-story-${levelId}`].find(id => !inventory.includes(id))
    return next ? ADVENTURE_COLLECTIBLES[next] : '刷新最好成绩 · 挑战三星通关'
  }
  return MERGE_LEVELS.find(item => item.id === levelId)!.collectibleName
}
export function PetPlayLobby({ pet, sprite, active, journey, save, day, onPlay }: {
  pet: PetProfile; sprite?: string; active: boolean; journey: PetJourney; save: GrowthSave; day: string
  onPlay: (game: PlayableGrowthGame, level: number) => void
}) {
  const [selected, setSelected] = useState<PlayableGrowthGame>('adventure')
  const entry = GROWTH_GAMES.find(item => item.id === selected)!
  const detail = descriptions[selected]; const level = nextPlayLevel(journey, selected)
  const earnedToday = save.daily.day === day && save.daily.games.includes(selected)
  const best = journey.bests[`${selected}:${level}`]?.score || 0
  return <View className='pet-play-lobby'>
    <View className='pet-play-lobby__buddy'><PetActor pet={pet} spriteOverride={sprite} followAppearance={false} size={44} action='wave' active={active} followLoadout /><View><Text>和 {pet.name} 出去玩</Text><Text>想跳一跳，还是慢慢拼一盘？</Text></View></View>
    <View className={`pet-play-lobby__feature is-${selected}`}>
      <View className='pet-play-lobby__cover'><Image src={`/packagePetStudio/assets/game-cover-${selected}-v1.jpg`} mode='aspectFill' /><View className='pet-play-lobby__cover-tags'><Text>{entry.name}</Text><Text>{detail.rhythm} · 第 {level} 关</Text></View></View>
      <View className='pet-play-lobby__feature-body'><Text className='pet-play-lobby__hook'>{detail.hook}</Text><Text className='pet-play-lobby__operation'>{detail.action}</Text><View className='pet-play-lobby__reward'><Text>本次目标 · {prize(selected, level, save.inventory)}</Text><Text>{earnedToday ? '今日星光已带回 · 收藏仍可继续赢' : '当天首次有效游玩 · 6 星光'}</Text></View>
        <Button hoverClass='journey-button--pressed' hoverStartTime={20} hoverStayTime={80} id='journey-play-now' className='journey-button pet-play-lobby__start' disabled={!active} onClick={() => onPlay(selected, level)}>{selected === 'adventure' ? '跑一局，试试手感' : `开始${entry.name}`}<Text>›</Text></Button><View className='pet-play-lobby__challenge'><Text>{detail.challenge}</Text>{best > 0 && <Text>你的最好成绩 {best} 分</Text>}</View>
      </View>
    </View>
    <View className='pet-play-lobby__choices'>{GROWTH_GAMES.map(item => <Button hoverClass='journey-button--pressed' hoverStartTime={20} hoverStayTime={80} id={`journey-feature-${item.id}`} className={`journey-button pet-play-lobby__choice${selected === item.id ? ' is-selected' : ''}`} aria-label={`看看${item.name}的玩法和奖品`} key={item.id} onClick={() => setSelected(item.id)}><Image src={`/packagePetStudio/assets/game-cover-${item.id}-v1.jpg`} mode='aspectFill' /><Text>{item.name}</Text><Text>{descriptions[item.id].rhythm}</Text></Button>)}</View>
  </View>
}
