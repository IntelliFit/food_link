import { View, Text, Image, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useMemo, useState } from 'react'
import {
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
  pending: '待处理',
  accepted: '已同意',
  rejected: '已拒绝'
}

function formatTime(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

export default function FriendsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('friends')
  const [loading, setLoading] = useState(false)
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [received, setReceived] = useState<FriendRequestOverviewItem[]>([])
  const [sent, setSent] = useState<FriendRequestOverviewItem[]>([])

  const receivedPendingCount = useMemo(
    () => received.filter((item) => item.status === 'pending').length,
    [received]
  )

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
      content: `确定删除好友「${friend.nickname || '用户'}」吗？`,
      confirmColor: '#ef4444'
    })
    if (!confirm.confirm) return

    try {
      Taro.showLoading({ title: '删除中...' })
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
      Taro.showLoading({ title: action === 'accept' ? '同意中...' : '拒绝中...' })
      await friendRespondRequest(requestId, action)
      Taro.hideLoading()
      Taro.showToast({ title: action === 'accept' ? '已同意' : '已拒绝', icon: 'success' })
      await loadData()
    } catch (error: any) {
      Taro.hideLoading()
      Taro.showToast({ title: error?.message || '操作失败', icon: 'none' })
    }
  }

  return (
    <View className='friends-page'>
      <View className='friends-header'>
        <Text className='friends-header-title'>好友与申请</Text>
        <Button
          className='refresh-btn'
          disabled={loading}
          onClick={loadData}
        >
          {loading ? '刷新中...' : '刷新'}
        </Button>
      </View>
      <View className='tabs'>
        <View className={`tab-item ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => setActiveTab('friends')}>
          好友列表
        </View>
        <View className={`tab-item ${activeTab === 'received' ? 'active' : ''}`} onClick={() => setActiveTab('received')}>
          收到的请求{receivedPendingCount > 0 ? ` (${receivedPendingCount})` : ''}
        </View>
        <View className={`tab-item ${activeTab === 'sent' ? 'active' : ''}`} onClick={() => setActiveTab('sent')}>
          我发起的
        </View>
      </View>

      {loading && <View className='empty'>加载中...</View>}

      {!loading && activeTab === 'friends' && (
        <View className='list'>
          {friends.length === 0 ? (
            <View className='empty'>还没有好友，先去圈子里添加吧</View>
          ) : (
            friends.map((friend) => (
              <View className='card friend-card' key={friend.id}>
                <View className='left'>
                  <Image className='avatar' src={friend.avatar || ''} mode='aspectFill' />
                  <Text className='name'>{friend.nickname || '用户'}</Text>
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
            <View className='empty'>暂无收到的好友请求</View>
          ) : (
            received.map((item) => (
              <View className='card vertical' key={item.id}>
                <View className='top'>
                  <View className='left'>
                    <Image className='avatar' src={item.counterpart_avatar || ''} mode='aspectFill' />
                    <View className='meta'>
                      <Text className='name'>{item.counterpart_nickname || '用户'}</Text>
                      <Text className='time'>{formatTime(item.created_at)}</Text>
                    </View>
                  </View>
                  <Text className={`status ${item.status}`}>{STATUS_LABEL[item.status] || item.status}</Text>
                </View>
                {item.status === 'pending' && (
                  <View className='actions'>
                    <Button className='plain-btn' onClick={() => handleRespond(item.id, 'reject')}>拒绝</Button>
                    <Button className='primary-btn' onClick={() => handleRespond(item.id, 'accept')}>同意</Button>
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      )}

      {!loading && activeTab === 'sent' && (
        <View className='list'>
          {sent.length === 0 ? (
            <View className='empty'>你还没有发起好友请求</View>
          ) : (
            sent.map((item) => (
              <View className='card vertical' key={item.id}>
                <View className='top'>
                  <View className='left'>
                    <Image className='avatar' src={item.counterpart_avatar || ''} mode='aspectFill' />
                    <View className='meta'>
                      <Text className='name'>{item.counterpart_nickname || '用户'}</Text>
                      <Text className='time'>{formatTime(item.created_at)}</Text>
                    </View>
                  </View>
                  <Text className={`status ${item.status}`}>{STATUS_LABEL[item.status] || item.status}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  )
}
