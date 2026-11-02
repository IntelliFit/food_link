import { View, Text } from '@tarojs/components'
import type { TrustBadgeIcon } from '../../utils/onboarding-api'
import './index.scss'

const ICON_GLYPH: Record<TrustBadgeIcon, string> = {
  shield: '✓',
  school: '◆',
  data: '▦',
  star: '★',
}

/** 后台配置的信任徽章（注册新流程用）；没有配置时什么都不渲染 */
export function TrustBadges({ badges }: { badges: Array<{ icon: TrustBadgeIcon; text: string }> }) {
  const visible = badges.filter((b) => String(b.text || '').trim())
  if (!visible.length) return null
  return (
    <View className='trust-badges'>
      {visible.map((b) => (
        <View className='trust-badges__item' key={b.text}>
          <Text className='trust-badges__icon'>{ICON_GLYPH[b.icon] || ICON_GLYPH.shield}</Text>
          <Text className='trust-badges__text'>{b.text}</Text>
        </View>
      ))}
    </View>
  )
}
