import { ScrollView, Text, View } from '@tarojs/components'
import './ModeIntroductionUpdates.scss'

export const MODE_INTRODUCTION_UPDATES = [
  { title: '九种风格，逐一认识', body: '八个均衡主题与阴阳养生主题，以动画展示各自特点，了解后再选择。' },
  { title: '动画跟随你的节奏', body: '当前画面持续播放，左右滑动切换；随时暂停、继续，或重新观看。' },
  { title: '选好默认，继续记录', body: '确认后沿用你的选择，之后可在“我的”更换，已有记录继续保留。' },
] as const

/** A native, editable release cover; its animation follows the introduction's pause state. */
export function ModeIntroductionUpdates({ active, paused }: { active: boolean; paused: boolean }) {
  return <ScrollView scrollY className={`mode-introduction-updates${!active || paused ? ' is-paused' : ''}`}>
    <View className='mode-introduction-updates__content'>
      <View className='mode-introduction-updates__masthead'><Text>食探</Text><Text>更新速递 · v{__APP_VERSION__}</Text></View>
      <Text className='mode-introduction-updates__eyebrow'>本次更新</Text>
      <Text className='mode-introduction-updates__title'>食探，{`\n`}又有新变化。</Text>
      <Text className='mode-introduction-updates__subtitle'>新的风格，熟悉的日常。{`\n`}让每一次记录，都更合心意。</Text>
      <View className='mode-introduction-updates__visual' aria-hidden>
        <View className='mode-introduction-updates__halo' />
        <View className='mode-introduction-updates__sheet is-back'><Text>日常 · 新一页</Text></View>
        <View className='mode-introduction-updates__sheet is-front'><Text className='mode-introduction-updates__leaf'>食</Text><Text>探索更好的自己</Text></View>
        <View className='mode-introduction-updates__seal'><Text>9</Text><Text>种风格</Text></View>
      </View>
      <View className='mode-introduction-updates__items'>
        {MODE_INTRODUCTION_UPDATES.map((item, index) => <View key={item.title} className='mode-introduction-updates__item'>
          <Text className='mode-introduction-updates__number'>0{index + 1}</Text>
          <View className='mode-introduction-updates__copy'><Text className='mode-introduction-updates__item-title'>{item.title}</Text><Text>{item.body}</Text></View>
        </View>)}
      </View>
    </View>
  </ScrollView>
}
