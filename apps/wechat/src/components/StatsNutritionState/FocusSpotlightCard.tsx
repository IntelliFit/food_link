import { Text, View } from '@tarojs/components'

export type FocusSpotlightItem = {
  key: string
  title: string
  /** iconfont 类名，如 icon-tianpingzuo */
  iconClass: string
  /** 分数或「—」 */
  scoreText: string
  /** positive / neutral / warning / danger / pending */
  tone: string
  reason: string
  evidence: string[]
  /** 自定义关注的「支持参考」等 */
  badge: string
  refreshing: boolean
}

const EVIDENCE_SHOWN = 3

/** 分析页最上面：用户选的 1–3 项关注，分数、原因、依据直接摊开 */
export function FocusSpotlightCard({ items, maxCount, footnote, onOpen, onManage }: {
  items: FocusSpotlightItem[]
  maxCount: number
  footnote: string
  onOpen: (key: string) => void
  onManage: () => void
}) {
  return (
    <View className='stats-card stats-ns-focus'>
      <View className='stats-ns-focus__head'>
        <View className='stats-ns-focus__title-wrap'>
          <Text className='stats-ns-card-head__title'>我的关注</Text>
          <Text className='stats-ns-card-head__meta'>{items.length}/{maxCount}</Text>
        </View>
        <View className='stats-ns-focus__manage' aria-role='button' aria-label='管理我的关注' onClick={onManage}>
          <Text>管理</Text>
        </View>
      </View>
      {items.length === 0 ? (
        <View className='stats-ns-focus__empty'>
          <Text className='stats-ns-focus__empty-text'>还没选关注。选 1–{maxCount} 项你最在意的，分析和推荐都会先看它们。</Text>
          <View className='stats-ns-btn stats-ns-btn--compact' aria-role='button' onClick={onManage}><Text>去选</Text></View>
        </View>
      ) : items.map(item => (
        <View
          key={item.key}
          className='stats-ns-focus__item'
          aria-role='button'
          aria-label={`查看${item.title}的依据`}
          onClick={() => onOpen(item.key)}
        >
          <View className='stats-ns-focus__row'>
            <View className='stats-ns-focus__icon'><Text className={`iconfont ${item.iconClass}`} /></View>
            <View className='stats-ns-focus__copy'>
              <View className='stats-ns-focus__name-line'>
                <Text className='stats-ns-focus__name'>{item.title}</Text>
                {item.badge ? <Text className='stats-ns-focus__badge'>{item.badge}</Text> : null}
                {item.refreshing ? <Text className='iconfont icon-jiazaixiao stats-ns-focus__spinner' /> : null}
              </View>
              {item.reason ? <Text className='stats-ns-focus__reason'>{item.reason}</Text> : null}
            </View>
            <View className={`stats-ns-focus__score tone-${item.tone}`}>
              <Text className='stats-ns-focus__score-value'>{item.scoreText}</Text>
              {item.tone !== 'pending' ? <Text className='stats-ns-focus__score-unit'>分</Text> : null}
            </View>
          </View>
          {item.evidence.length > 0 ? (
            <View className='stats-ns-focus__evidence'>
              {item.evidence.slice(0, EVIDENCE_SHOWN).map(line => (
                <View key={line} className='stats-ns-focus__evidence-line'>
                  <Text className='stats-ns-focus__bullet'>•</Text>
                  <Text className='stats-ns-focus__evidence-text'>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
      {footnote && items.length > 0 ? <Text className='stats-ns-focus__footnote'>{footnote}</Text> : null}
    </View>
  )
}
