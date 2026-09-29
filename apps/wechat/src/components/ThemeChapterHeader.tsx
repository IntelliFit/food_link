import { Text, View } from '@tarojs/components'
import * as React from 'react'
import type { BalancedThemeId } from '../utils/balanced-theme'

type Props = { theme: BalancedThemeId; title: string; surfaceName: string; date: string }

export function ThemeChapterHeader({ theme, title, surfaceName, date }: Props) {
  const root = `theme-chapter theme-chapter--${theme}`
  const waterCopy: Record<string, { subtitle: string; marginal: string }> = {
    '分析': { subtitle: '在流动中，看见自己的节奏。', marginal: '食亦是生活\n顺流而行' },
    '圈子': { subtitle: '每一次分享，都让彼此的生活有了回声。', marginal: '同一片水面\n连着不同的生活' },
    '我的': { subtitle: '静水照见来路，也容纳下一程。', marginal: '一餐一念\n皆是生活' },
  }
  switch (theme) {
    case 'clarity-order': return <View className={root}><View className='tc-imprint'><Text>食探</Text><Text>让日常回归清晰</Text></View><Text className='tc-title'>{title}</Text><Text className='tc-date'>{date}</Text></View>
    case 'natural-symbiosis': return <View className={root}><View><Text className='tc-title'>{title}</Text><Text className='tc-subtitle'>收藏自然的馈赠{ '\n' }也照顾每一天的自己</Text></View><Text className='tc-marginal'>顺应时节{ '\n' }与自然共生</Text></View>
    case 'eastern-salon': return <View className={root}><Text className='tc-brand'>食探</Text><View className='tc-scroll-heading'><Text className='tc-title'>{title}</Text><Text className='tc-marginal'>一餐一世界{ '\n' }日常有清欢</Text></View><Text className='tc-subtitle'>谈饮食 · 话生活 · 见知己</Text></View>
    case 'modern-gallery': return <View className={root}><View><Text className='tc-display'>{surfaceName}</Text><Text className='tc-title'>{title}</Text></View><View className='tc-caption'><Text>食物{ '\n' }连接生活{ '\n' }与更多可能</Text><Text>FOOD{ '\n' }EXPLORERS</Text></View></View>
    case 'miniature-world': return <View className={root}><View className='tc-imprint'><Text className='tc-display'>{surfaceName}</Text><Text className='tc-date'>{date}</Text></View><Text className='tc-subtitle'>在真实的生活里，发现更好的自己</Text><Text className='tc-sign'>{title}</Text></View>
    case 'picturebook-companion': return <View className={root}><Text className='tc-title'>{title}</Text><Text className='tc-subtitle'>食物 · 生活 · 人{ '\n' }平凡的日子，也有光。</Text></View>
    case 'clear-care': return <View className={root}><View className='tc-imprint'><Text className='tc-brand'>食探</Text><Text className='tc-badge'>清朗关怀</Text></View><Text className='tc-title'>{title}</Text><Text className='tc-subtitle'>简单清晰，用得安心</Text></View>
    case 'way-of-water': {
      const copy = waterCopy[surfaceName] || { subtitle: '在流动中，找到自己的节奏。', marginal: '随形而行\n方能长久' }
      if (surfaceName === '我的') return <View className={`${root} theme-chapter--water-profile`}>
        <View className='tc-scroll-heading'><View><Text className='tc-title'>{title}</Text><Text className='tc-subtitle'>{copy.subtitle}</Text></View><Text className='tc-marginal'>{copy.marginal}</Text></View>
      </View>
      return <View className={`${root} theme-chapter--water-${surfaceName}`}>
        <View className='tc-imprint'><View className='tc-water-brand'><Text className='tc-brand'>食探</Text><Text className='tc-water-edition'>水之道</Text></View><Text className='tc-date'>{date}</Text></View>
        <View className='tc-scroll-heading'><Text className='tc-title'>{title}</Text><Text className='tc-marginal'>{copy.marginal}</Text></View>
        <Text className='tc-subtitle'>{copy.subtitle}</Text>
      </View>
    }
  }
}
