import { Text, View } from '@tarojs/components'
import React from 'react'
import { useInkWellness } from './InkWellness'
import { useBalancedTheme } from './BalancedThemeContext'
import { getBalancedThemeDefinition } from '../utils/balanced-theme'

import './BalancedThemeExperience.scss'

export type BalancedThemeSurface = 'home' | 'stats' | 'community' | 'profile'

const SURFACE_LABELS: Record<BalancedThemeSurface, string> = {
  home: '今日',
  stats: '观测',
  community: '相遇',
  profile: '收藏',
}

export function BalancedThemeExperience({ surface }: { surface: BalancedThemeSurface }): React.ReactElement | null {
  const wellness = useInkWellness()
  const { theme } = useBalancedTheme()
  const definition = getBalancedThemeDefinition(theme)
  const [stage, setStage] = React.useState(0)

  React.useEffect(() => setStage(0), [surface, theme])
  if (wellness) return null

  const nextStage = () => setStage((value) => (value + 1) % 3)
  const label = SURFACE_LABELS[surface]
  const commonProps = {
    id: `balanced-theme-experience-${surface}`,
    role: 'button',
    'aria-label': `${definition.name}主题特色，${definition.interactionHint}`,
    onClick: nextStage,
  } as const

  if (theme === 'clarity-order') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--clarity is-stage-${stage}`}>
        <View className='bt-clarity__rail'><Text>FL / 01</Text><Text>{label}</Text></View>
        <View className='bt-clarity__grid'>
          <View><Text className='bt-clarity__number'>08</Text><Text>系统模块</Text></View>
          <View><Text>LIVE</Text><Text>真实数据</Text></View>
          <View><Text className='bt-clarity__focus'>{stage + 1}</Text><Text>阅读焦点</Text></View>
        </View>
        <Text className='bt-experience__hint'>轻触重排索引</Text>
      </View>
    )
  }

  if (theme === 'natural-symbiosis') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--nature is-stage-${stage}`}>
        <View className='bt-nature__rings'><View /><View /><View /></View>
        <View className='bt-nature__stem'>
          <View className='bt-nature__leaf bt-nature__leaf--one' />
          <View className='bt-nature__leaf bt-nature__leaf--two' />
          <View className='bt-nature__leaf bt-nature__leaf--three' />
        </View>
        <View className='bt-nature__copy'><Text>{label} · 生长环</Text><Text>每一次记录，都让生活多一片叶子</Text></View>
        <Text className='bt-experience__hint'>轻触，让叶片生长</Text>
      </View>
    )
  }

  if (theme === 'eastern-salon') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--eastern is-stage-${stage}`}>
        <View className='bt-eastern__roller bt-eastern__roller--left' />
        <View className='bt-eastern__paper'>
          <View className='bt-eastern__title'><Text>{label}</Text><Text>一卷日常</Text></View>
          <Text className='bt-eastern__verse'>{stage === 0 ? '卷中有序' : stage === 1 ? '食有节，心有度' : '缓缓展开，自见从容'}</Text>
          <View className='bt-eastern__seal'><Text>食探</Text></View>
        </View>
        <View className='bt-eastern__roller bt-eastern__roller--right' />
        <Text className='bt-experience__hint'>轻触展卷</Text>
      </View>
    )
  }

  if (theme === 'modern-gallery') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--gallery is-stage-${stage}`}>
        <View className='bt-gallery__blue'><Text>{label}</Text></View>
        <View className='bt-gallery__black'><Text>NO.{stage + 1}</Text></View>
        <View className='bt-gallery__paper'><Text>生活</Text><Text>正在发生</Text></View>
        <View className='bt-gallery__red'><Text>重排</Text></View>
        <View className='bt-gallery__yellow' />
        <Text className='bt-experience__hint'>轻触重组这幅作品</Text>
      </View>
    )
  }

  if (theme === 'miniature-world') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--miniature is-stage-${stage}`}>
        <View className='bt-miniature__sky'><Text>{label}探索区</Text></View>
        <View className='bt-miniature__island'>
          <View className='bt-miniature__river' />
          <View className='bt-miniature__path'><View /><View /><View /></View>
          <View className='bt-miniature__tree bt-miniature__tree--one' />
          <View className='bt-miniature__tree bt-miniature__tree--two' />
          <View className='bt-miniature__traveler'><Text>●</Text></View>
        </View>
        <Text className='bt-experience__hint'>轻触移动旅行标记</Text>
      </View>
    )
  }

  if (theme === 'picturebook-companion') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--picturebook is-stage-${stage}`}>
        <View className='bt-picturebook__binding'><View /><View /><View /></View>
        <View className='bt-picturebook__page bt-picturebook__page--front'>
          <Text className='bt-picturebook__chapter'>CHAPTER {stage + 1}</Text>
          <Text className='bt-picturebook__title'>{label}这一页</Text>
          <View className='bt-picturebook__frame'><View className='bt-picturebook__sun' /><View className='bt-picturebook__road' /></View>
        </View>
        <View className='bt-picturebook__page bt-picturebook__page--back'><Text>把平常的一天，读成自己的故事。</Text></View>
        <Text className='bt-experience__hint'>轻触翻一页</Text>
      </View>
    )
  }

  if (theme === 'clear-care') {
    return (
      <View {...commonProps} className={`bt-experience bt-experience--care is-stage-${stage}`}>
        <View className='bt-care__number'><Text>0{stage + 1}</Text></View>
        <View className='bt-care__copy'><Text>{label}重点</Text><Text>{stage === 0 ? '先看最重要的内容' : stage === 1 ? '按钮更大，操作更直接' : '文字清楚，少走一步'}</Text></View>
        <View className='bt-care__action'><Text>下一项</Text><Text>→</Text></View>
      </View>
    )
  }

  return (
    <View {...commonProps} className={`bt-experience bt-experience--water is-stage-${stage}`}>
      <View className='bt-water__pool'>
        <View className='bt-water__ripple bt-water__ripple--one' />
        <View className='bt-water__ripple bt-water__ripple--two' />
        <View className='bt-water__ripple bt-water__ripple--three' />
        <View className='bt-water__stone'><Text>{stage + 1}</Text></View>
      </View>
      <View className='bt-water__copy'><Text>{label} · 水之道</Text><Text>{stage === 0 ? '水无常形' : stage === 1 ? '因势而行' : '静中见变'}</Text></View>
      <Text className='bt-experience__hint'>轻触水面</Text>
    </View>
  )
}
