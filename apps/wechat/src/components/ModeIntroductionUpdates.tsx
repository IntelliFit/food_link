import { Button, ScrollView, Text, View } from '@tarojs/components'
import { cover } from '../mode-introduction-assets.json'
import { ModeIntroArtwork } from './ModeIntroArtwork'
import { ModeIntroMedia } from './ModeIntroMedia'
import './ModeIntroductionUpdates.scss'

export const MODE_INTRODUCTION_UPDATES = [
  { title: '九种风格，逐一认识', body: '八个均衡主题与阴阳养生主题，以动画展示各自特点，了解后再选择。' },
  { title: '动画跟随你的节奏', body: '当前画面持续播放，左右滑动切换；随时暂停、继续，或重新观看。' },
  { title: '选好默认，继续记录', body: '确认后沿用你的选择，之后可在“我的”更换，已有记录继续保留。' },
] as const

/** The selected cover stays intact; only the active slide owns a video decoder. */
export function ModeIntroductionUpdates({ active, paused, attempt, error, onError, onRetry }: {
  active: boolean; paused: boolean; attempt: number; error: string
  onError: (message: string) => void; onRetry: () => void
}) {
  if (error) return <ScrollView scrollY className='mode-introduction__fallback-scroll'>
    <View className='mode-introduction__fallback' role='alert'>
      <Text className='mode-introduction__fallback-title'>食探更新速递</Text>
      {MODE_INTRODUCTION_UPDATES.map(item => <View key={item.title}><Text>{item.title}</Text><Text>{item.body}</Text></View>)}
      <Text>{error}</Text>
      <Button id='mode-introduction-cover-retry' className='mode-introduction__fallback-button' onClick={onRetry}>重试动画</Button>
    </View>
  </ScrollView>
  return <View className='mode-introduction-updates' aria-label='食探更新速递。从一餐，探索新世界。八种均衡主题与阴阳养生主题；左右滑动，动画随你看；选定默认，记录继续保留。'>
    {active
      ? <ModeIntroMedia chapter={cover} attempt={attempt} paused={paused} onError={onError} />
      : <ModeIntroArtwork chapter={cover} attempt={0} motion={false} onPosterLoad={() => undefined} onMediaReady={() => undefined} onError={() => undefined} />}
  </View>
}
