import { Text, View } from '@tarojs/components'
import { useEffect, useState, type CSSProperties } from 'react'
import { useDidHide, useDidShow } from '@tarojs/taro'
import { consumeSocialMenuOpen, socialInboxTotal, type SocialInboxSnapshot } from '../utils/social-inbox'
import './SocialFloatingMenu.scss'

export type SocialMenuAction = 'interactions' | 'messages' | 'friends' | 'add'
const ACTIONS: Array<{ key: SocialMenuAction; label: string; icon: string }> = [
  { key: 'interactions', label: '互动消息', icon: 'icon-pinglun' },
  { key: 'messages', label: '私信', icon: 'icon-comment' },
  { key: 'friends', label: '好友管理', icon: 'icon-duoren' },
  { key: 'add', label: '添加好友', icon: 'icon-tianjiahaoyou' },
]
const badgeText = (value: number) => value > 99 ? '99+' : String(value)

export function SocialFloatingMenu({ inbox, suppressed = false, dark = false, onAction }: {
  inbox: SocialInboxSnapshot
  suppressed?: boolean
  dark?: boolean
  onAction: (action: SocialMenuAction) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(true)
  const total = socialInboxTotal(inbox)
  const open = expanded && active && !suppressed
  useDidShow(() => {
    setActive(true)
    if (!suppressed && consumeSocialMenuOpen()) setExpanded(true)
  })
  useDidHide(() => { setActive(false); setExpanded(false) })
  useEffect(() => {
    if (suppressed) setExpanded(false)
  }, [suppressed])
  // The community may mount this component after its login state is refreshed.
  useEffect(() => {
    if (!suppressed && consumeSocialMenuOpen()) setExpanded(true)
  }, [suppressed])

  if (!active || suppressed) return null
  return (
    <View className={`social-menu ${dark ? 'social-menu--dark' : ''} ${open ? 'is-open' : ''}`}>
      {open ? <View id='social-menu-dismiss' className='social-menu__dismiss' onClick={() => setExpanded(false)} /> : null}
      <View id='community-social-menu' className='social-menu__anchor'>
        {ACTIONS.map((action, index) => {
          const unread = action.key === 'friends' ? inbox.friendRequests : action.key === 'add' ? 0 : inbox[action.key]
          return (
            <View
              id={`social-menu-${action.key}`}
              key={action.key}
              className='social-menu__entry'
              style={{ '--social-ball-index': index, '--social-ball-rise': `${(index + 1) * 104}rpx` } as CSSProperties}
              role='button'
              aria-label={`${action.label}${unread ? `，${unread} 条待查看` : ''}`}
              aria-hidden={!open}
              onClick={() => {
                if (!open) return
                setExpanded(false)
                onAction(action.key)
              }}
            >
              <Text className='social-menu__label'>{action.label}</Text>
              <View className='social-menu__ball'>
                <Text className={`iconfont ${action.icon} social-menu__icon`} />
                {unread > 0 ? <Text className='social-menu__badge'>{badgeText(unread)}</Text> : null}
              </View>
            </View>
          )
        })}
        <View
          id='social-menu-toggle'
          className='social-menu__trigger'
          role='button'
          aria-label={open ? '收起消息功能' : `展开消息功能${total ? `，${total} 条待查看` : ''}`}
          aria-expanded={open}
          onClick={() => setExpanded(value => !value)}
        >
          <Text className={`iconfont ${open ? 'icon-close' : 'icon-pinglun'} social-menu__trigger-icon`} />
          <Text className='social-menu__trigger-label'>{open ? '收起' : '消息'}</Text>
          {total > 0 ? <Text id='social-menu-unread' className='social-menu__badge'>{badgeText(total)}</Text> : null}
        </View>
      </View>
    </View>
  )
}
