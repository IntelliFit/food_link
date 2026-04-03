import { withAuth } from '../../utils/withAuth'
import { View, Text, Image, Button, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import {
  friendCancelSentRequest,
  friendDelete,
  friendGetList,
  friendGetRequestsOverview,
  friendRespondRequest,
  FriendListItem,
  FriendRequestOverviewItem
} from '../../utils/api'
import './index.scss'

type ActiveTab = 'friends' | 'received' | 'sent'

const STATUS_LABEL: Record<string, string> = {
  pending: '',
  accepted: '已同意',
  rejected: '已拒绝'
}

function formatTime(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  
  // 小于1小时显示"刚刚"或"x分钟前"
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  
  // 昨天
  const yesterday = new Date(now.getTime() - 86400000)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  
  // 今年内显示"月-日"
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }
  
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 搜索图标组件
const SearchIcon = ({ size = 32, color = '#94a3b8' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <circle cx='11' cy='11' r='7' stroke={color} strokeWidth='2' />
      <path d='M20 20l-4.35-4.35' stroke={color} strokeWidth='2' strokeLinecap='round' />
    </svg>
  </View>
)

// 关闭图标组件
const CloseIcon = ({ size = 24, color = '#64748b' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <path d='M18 6L6 18M6 6l12 12' stroke={color} strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  </View>
)

// 勾选图标组件
const CheckIcon = ({ size = 28, color = '#fff' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <path d='M5 12l5 5L20 7' stroke={color} strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  </View>
)

// 叉号图标组件
const CrossIcon = ({ size = 24, color = '#fff' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <path d='M18 6L6 18M6 6l12 12' stroke={color} strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  </View>
)

// 刷新图标组件
const RefreshIcon = ({ size = 24, color = '#00bc7d' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <path d='M23 4v6h-6M1 20v-6h6' stroke={color} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
      <path d='M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15' stroke={color} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  </View>
)

// 好友图标组件
const FriendsIcon = ({ size = 80, color = '#00bc7d' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <circle cx='9' cy='8' r='4' stroke={color} strokeWidth='1.5' opacity='0.6' />
      <path d='M2 20c0-3.866 3.134-7 7-7M15 8c2.5 0 4 1.5 4 4s-1.5 4-4 4' stroke={color} strokeWidth='1.5' strokeLinecap='round' opacity='0.6' />
      <path d='M22 20c0-3.866-3.134-7-7-7' stroke={color} strokeWidth='1.5' strokeLinecap='round' opacity='0.6' />
    </svg>
  </View>
)

// 收件箱图标组件
const InboxIcon = ({ size = 80, color = '#00bc7d' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <path d='M22 12h-6l-2 3h-4l-2-3H2' stroke={color} strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' opacity='0.6' />
      <path d='M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z' stroke={color} strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' opacity='0.6' />
    </svg>
  </View>
)

// 发送图标组件
const SendIcon = ({ size = 80, color = '#00bc7d' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <path d='M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z' stroke={color} strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' opacity='0.6' />
    </svg>
  </View>
)

// 搜索空状态图标
const SearchEmptyIcon = ({ size = 80, color = '#00bc7d' }: { size?: number; color?: string }) => (
  <View className='svg-icon' style={{ width: `${size}rpx`, height: `${size}rpx` }}>
    <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
      <circle cx='11' cy='11' r='8' stroke={color} strokeWidth='1.5' opacity='0.5' />
      <path d='M21 21l-4.35-4.35' stroke={color} strokeWidth='1.5' strokeLinecap='round' opacity='0.5' />
      <path d='M8 11h6' stroke={color} strokeWidth='1.5' strokeLinecap='round' opacity='0.3' />
    </svg>
  </View>
)

function FriendsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('friends')
  const [loading, setLoading] = useState(false)
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [received, setReceived] = useState<FriendRequestOverviewItem[]>([])
  const [sent, setSent] = useState<FriendRequestOverviewItem[]>([])
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const receivedPendingCount = useMemo(
    () => received.filter((item) => item.status === 'pending').length,
    [received]
  )

  // 搜索过滤
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends
    const query = searchQuery.toLowerCase()
    return friends.filter(f => 
      (f.nickname || '').toLowerCase().includes(query)
    )
  }, [friends, searchQuery])

  const loadData = async () => {
    try {
      setLoading(true)
      const [friendRes, requestRes] = await Promise.all([
        friendGetList(),
        friendGetRequestsOverview()
      ])
      setFriends(friendRes.list || [])
      setReceived(requestRes.received || [])
      setSent(requestRes.sent || [])
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    loadData()
  })

  const handleDeleteFriend = async (friend: FriendListItem) => {
    const confirm = await Taro.showModal({
      title: '删除好友',
      content: `确定删除好友「${friend.nickname || '用户'}」吗？删除后需要重新添加。`,
      confirmColor: '#ef4444',
      confirmText: '删除',
      cancelText: '取消'
    })
    if (!confirm.confirm) return

    try {
      Taro.showLoading({ title: '删除中...', mask: true })
      await friendDelete(friend.id)
      Taro.hideLoading()
      Taro.showToast({ title: '已删除', icon: 'success' })
      await loadData()
    } catch (error: any) {
      Taro.hideLoading()
      Taro.showToast({ title: error?.message || '删除失败', icon: 'none' })
    }
  }

  const handleRespond = async (requestId: string, action: 'accept' | 'reject') => {
    try {
      Taro.showLoading({ title: action === 'accept' ? '处理中...' : '拒绝中...', mask: true })
      await friendRespondRequest(requestId, action)
      Taro.hideLoading()
      Taro.showToast({ 
        title: action === 'accept' ? '已添加好友' : '已拒绝', 
        icon: 'success' 
      })
      
      // 本地更新状态，避免刷新整个列表
      if (action === 'accept') {
        // 同意：找到对应的请求，更新状态并添加到好友列表
        const acceptedRequest = received.find(r => r.id === requestId)
        if (acceptedRequest) {
          // 更新请求状态为已同意
          setReceived(prev => prev.map(r => 
            r.id === requestId ? { ...r, status: 'accepted' as const } : r
          ))
          // 添加到好友列表
          const newFriend: FriendListItem = {
            id: acceptedRequest.counterpart_id,
            user_id: '', // 当前用户ID，后端会处理
            friend_id: acceptedRequest.counterpart_id,
            nickname: acceptedRequest.counterpart_nickname || '用户',
            avatar: acceptedRequest.counterpart_avatar || '',
            created_at: new Date().toISOString()
          }
          setFriends(prev => [newFriend, ...prev])
        }
      } else {
        // 拒绝：只更新请求状态
        setReceived(prev => prev.map(r => 
          r.id === requestId ? { ...r, status: 'rejected' as const } : r
        ))
      }
    } catch (error: any) {
      Taro.hideLoading()
      Taro.showToast({ title: error?.message || '操作失败', icon: 'none' })
    }
  }

  const handleCancelSent = async (item: FriendRequestOverviewItem) => {
    if (item.status !== 'pending' || revokingId) return
    const ok = await Taro.showModal({
      title: '撤销申请',
      content: `确定撤销对「${item.counterpart_nickname || '对方'}」的好友申请吗？`,
      confirmText: '撤销',
      cancelText: '保留',
      confirmColor: '#64748b'
    })
    if (!ok.confirm) return

    setRevokingId(item.id)
    try {
      await friendCancelSentRequest(item.id)
      Taro.showToast({ title: '已撤销申请', icon: 'success' })
      await loadData()
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '撤销失败', icon: 'none' })
    } finally {
      setRevokingId(null)
    }
  }

  const goToCommunity = () => {
    Taro.switchTab({ url: '/pages/community/index' })
  }

  const renderEmptyState = (type: 'friends' | 'received' | 'sent') => {
    const configs = {
      friends: {
        icon: <FriendsIcon size={120} color='#00bc7d' />,
        title: '还没有好友',
        desc: '去圈子里发现更多志同道合的食友，一起记录健康饮食',
        action: '去添加好友',
        onAction: goToCommunity
      },
      received: {
        icon: <InboxIcon size={120} color='#00bc7d' />,
        title: '暂无好友请求',
        desc: '当有人向你发送好友申请时，会显示在这里',
      },
      sent: {
        icon: <SendIcon size={120} color='#00bc7d' />,
        title: '没有待处理的申请',
        desc: '你发起的好友申请会显示在这里，可随时撤销',
      }
    }
    const config = configs[type]

    return (
      <View className='empty-state'>
        <View className='empty-icon'>{config.icon}</View>
        <Text className='empty-title'>{config.title}</Text>
        <Text className='empty-desc'>{config.desc}</Text>
        {config.action && (
          <Button className='empty-action' onClick={config.onAction}>
            {config.action}
          </Button>
        )}
      </View>
    )
  }

  const renderLoading = () => (
    <View className='loading-state'>
      <View className='loading-spinner' />
      <Text className='loading-text'>加载中...</Text>
    </View>
  )

  return (
    <View className='friends-page'>
      {/* 顶部操作栏 - 标题在导航栏，这里只保留刷新 */}
      <View className='friends-header'>
        <View className='header-actions'>
          <Button
            className={`refresh-btn ${loading ? 'spinning' : ''}`}
            disabled={loading}
            onClick={loadData}
          >
            <RefreshIcon size={24} color='#00bc7d' />
            <Text>{loading ? '刷新中' : '刷新'}</Text>
          </Button>
        </View>
      </View>

      {/* Tab 导航 */}
      <View className='tabs-wrapper'>
        <View className='tabs'>
          <View 
            className={`tab-item ${activeTab === 'friends' ? 'active' : ''}`} 
            onClick={() => setActiveTab('friends')}
          >
            好友列表
            {friends.length > 0 && (
              <Text className='tab-badge'>{friends.length}</Text>
            )}
          </View>
          <View 
            className={`tab-item ${activeTab === 'received' ? 'active' : ''}`} 
            onClick={() => setActiveTab('received')}
          >
            收到的请求
            {receivedPendingCount > 0 && (
              <Text className='tab-badge'>{receivedPendingCount}</Text>
            )}
          </View>
          <View 
            className={`tab-item ${activeTab === 'sent' ? 'active' : ''}`} 
            onClick={() => setActiveTab('sent')}
          >
            我发起的
          </View>
        </View>
      </View>

      {/* 搜索栏 - 只在好友列表显示 */}
      {activeTab === 'friends' && friends.length > 0 && (
        <View className='search-bar'>
          <View className='search-input-wrapper'>
            <SearchIcon size={32} color='#94a3b8' />
            <Input
              className='search-input'
              placeholder='搜索好友昵称'
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.detail.value)}
            />
            {searchQuery && (
              <View className='search-clear' onClick={() => setSearchQuery('')}>
                <CloseIcon size={20} color='#64748b' />
              </View>
            )}
          </View>
        </View>
      )}

      {/* 内容区域 */}
      <View className='list-container'>
        {loading && renderLoading()}

        {!loading && activeTab === 'friends' && (
          <View className='list'>
            {filteredFriends.length === 0 ? (
              searchQuery ? (
                <View className='empty-state'>
                  <View className='empty-icon'>
                    <SearchEmptyIcon size={120} color='#00bc7d' />
                  </View>
                  <Text className='empty-title'>未找到好友</Text>
                  <Text className='empty-desc'>尝试搜索其他关键词</Text>
                </View>
              ) : renderEmptyState('friends')
            ) : (
              filteredFriends.map((friend) => (
                <View className='card friend-card' key={friend.id}>
                  <View className='left'>
                    <View className='avatar-wrapper'>
                      <Image 
                        className='avatar' 
                        src={friend.avatar || ''} 
                        mode='aspectFill'
                        lazyLoad
                      />
                    </View>
                    <View className='meta'>
                      <Text className='name'>{friend.nickname || '用户'}</Text>
                      <Text className='time'>好友</Text>
                    </View>
                  </View>
                  <Button className='danger-btn' onClick={() => handleDeleteFriend(friend)}>
                    删除
                  </Button>
                </View>
              ))
            )}
          </View>
        )}

        {!loading && activeTab === 'received' && (
          <View className='list'>
            {received.length === 0 ? (
              renderEmptyState('received')
            ) : (
              received.map((item) => (
                <View className='card request-card' key={item.id}>
                  {/* 一行布局：头像 + 信息 + 操作按钮 */}
                  <View className='request-row'>
                    <View className='avatar-wrapper'>
                      <Image 
                        className='avatar' 
                        src={item.counterpart_avatar || ''} 
                        mode='aspectFill'
                        lazyLoad
                      />
                    </View>
                    <View className='meta'>
                      <Text className='name'>{item.counterpart_nickname || '用户'}</Text>
                      <Text className='time'>{formatTime(item.created_at)}</Text>
                    </View>
                    
                    {/* 操作区域 */}
                    <View className='request-actions'>
                      {item.status === 'pending' ? (
                        <>
                          {/* 拒绝按钮 - 红色圆形带✕ */}
                          <View 
                            className='icon-btn reject-btn'
                            onClick={() => handleRespond(item.id, 'reject')}
                          >
                            <Text className='icon-text'>✕</Text>
                          </View>
                          {/* 同意按钮 - 绿色圆形带✓ */}
                          <View 
                            className='icon-btn accept-btn'
                            onClick={() => handleRespond(item.id, 'accept')}
                          >
                            <Text className='icon-text'>✓</Text>
                          </View>
                        </>
                      ) : (
                        <Text className={`status ${item.status}`}>
                          {STATUS_LABEL[item.status]}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {!loading && activeTab === 'sent' && (
          <View className='list'>
            {sent.length === 0 ? (
              renderEmptyState('sent')
            ) : (
              sent.map((item) => (
                <View className='card vertical' key={item.id}>
                  <View className='top'>
                    <View className='left'>
                      <View className='avatar-wrapper'>
                        <Image 
                          className='avatar' 
                          src={item.counterpart_avatar || ''} 
                          mode='aspectFill'
                          lazyLoad
                        />
                      </View>
                      <View className='meta'>
                        <Text className='name'>{item.counterpart_nickname || '用户'}</Text>
                        <Text className='time'>{formatTime(item.created_at)}</Text>
                      </View>
                    </View>
                    <Text className={`status ${item.status}`}>
                      {STATUS_LABEL[item.status] || item.status}
                    </Text>
                  </View>
                  {item.status === 'pending' && (
                    <View className='actions'>
                      <Button
                        className='plain-btn'
                        disabled={revokingId === item.id}
                        onClick={() => handleCancelSent(item)}
                      >
                        {revokingId === item.id ? '撤销中...' : '撤销申请'}
                      </Button>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        )}
      </View>
    </View>
  )
}

export default withAuth(FriendsPage)
