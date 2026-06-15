import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  getPrivateMessages,
  sendPrivateMessage,
  markMessagesRead,
  getPublicUserProfile,
  getAccessToken,
  API_BASE_URL,
  SYSTEM_MESSAGE_USER_ID,
  type PrivateMessage,
} from '../../../utils/api'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { DEFAULT_AVATAR_URL } from '../../../utils/static-asset-cdn-url'
import './index.scss'

const POLL_INTERVAL_MS = 3000

function formatMessageTime(createdAt: string): string {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const isSameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (isSameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const yesterday = new Date(now.getTime() - 86400000)
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()
  if (isYesterday) {
    return `昨天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function shouldShowTimeDivider(prev: PrivateMessage | null, curr: PrivateMessage): boolean {
  if (!prev) return true
  const prevTime = new Date(prev.created_at).getTime()
  const currTime = new Date(curr.created_at).getTime()
  return Math.abs(currTime - prevTime) > 10 * 60 * 1000
}

function getCurrentUserAvatar(): string {
  try {
    const raw = Taro.getStorageSync('userInfo')
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed?.avatar || ''
  } catch {
    return ''
  }
}

export default function PrivateChatPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()
  const otherUserId = String(router.params.user_id || '').trim()
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()
  const isSystemChat = otherUserId === SYSTEM_MESSAGE_USER_ID

  const [otherUser, setOtherUser] = useState<{ nickname: string; avatar: string }>({ nickname: '私信', avatar: '' })
  const [currentUserAvatar, setCurrentUserAvatar] = useState('')
  const [messages, setMessages] = useState<PrivateMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)

  const scrollRef = useRef<string>('')
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPollingRef = useRef(false)
  const messagesRef = useRef<PrivateMessage[]>([])

  useEffect(() => {
    setCurrentUserAvatar(getCurrentUserAvatar())
  }, [])

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
  }, [scheme])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // 加载对方信息
  useEffect(() => {
    if (!otherUserId) return
    if (isSystemChat) {
      setOtherUser({ nickname: '系统消息', avatar: '' })
      Taro.setNavigationBarTitle({ title: '系统消息' })
      return
    }
    getPublicUserProfile(otherUserId)
      .then((profile) => {
        const nickname = profile.nickname || '用户'
        setOtherUser({ nickname, avatar: profile.avatar || '' })
        Taro.setNavigationBarTitle({ title: nickname })
      })
      .catch(() => {
        setOtherUser({ nickname: '用户', avatar: '' })
        Taro.setNavigationBarTitle({ title: '用户' })
      })
  }, [otherUserId, isSystemChat])

  // 加载消息
  const loadMessages = useCallback(async (reset = false) => {
    if (!otherUserId || !getAccessToken()) return
    const currentOffset = reset ? 0 : offset
    if (!reset && !hasMore) return

    if (reset) setLoading(true)
    try {
      const res = await getPrivateMessages(otherUserId, currentOffset, 20)
      const list = res.list || []
      if (reset) {
        setMessages(list)
        // 标记已读
        markMessagesRead(otherUserId).catch(() => {})
      } else {
        setMessages((prev) => [...list, ...prev])
      }
      setHasMore(res.has_more ?? list.length >= 20)
      setOffset(currentOffset + list.length)
    } catch (err: any) {
      console.error('[private-chat] 加载消息失败:', err)
    } finally {
      if (reset) setLoading(false)
    }
  }, [otherUserId, offset, hasMore])

  // 轮询新消息
  const pollNewMessages = useCallback(async () => {
    if (!otherUserId || !getAccessToken() || isPollingRef.current) return
    isPollingRef.current = true
    try {
      const res = await getPrivateMessages(otherUserId, 0, 100)
      const list = res.list || []
      const currentIds = new Set(messagesRef.current.map((m) => m.id))
      const newMsgs = list.filter((m) => !currentIds.has(m.id))
      if (newMsgs.length > 0) {
        setMessages(list)
        // 有新消息且当前在页面底部附近时，标记已读
        markMessagesRead(otherUserId).catch(() => {})
      }
    } catch (err) {
      // 轮询失败静默处理
    } finally {
      isPollingRef.current = false
    }
  }, [otherUserId])

  // 启动/停止轮询
  useEffect(() => {
    if (!otherUserId || !getAccessToken()) return
    loadMessages(true)
    pollTimerRef.current = setInterval(pollNewMessages, POLL_INTERVAL_MS)
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherUserId])

  // 发送文本消息
  const handleSendText = async () => {
    const text = inputText.trim()
    if (!text || !otherUserId || sending) return
    setSending(true)
    try {
      const msg = await sendPrivateMessage(otherUserId, text, 'text')
      setMessages((prev) => [msg, ...prev])
      setInputText('')
      scrollToBottom()
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '发送失败', icon: 'none' })
    } finally {
      setSending(false)
    }
  }

  // 发送图片消息
  const handleSendImage = async () => {
    if (!otherUserId || sending) return
    try {
      const chooseRes = await chooseImageWithPrivacy({ count: 1, sizeType: ['compressed'] })
      const tempFilePaths = (chooseRes as any)?.tempFilePaths || []
      if (!tempFilePaths || tempFilePaths.length === 0) return
      const tempFilePath = tempFilePaths[0]

      setSending(true)
      Taro.showLoading({ title: '发送中...', mask: true })

      // 上传图片到服务器
      const token = getAccessToken()
      const uploadRes = await Taro.uploadFile({
        url: `${API_BASE_URL}/api/upload-analyze-image-file`,
        filePath: tempFilePath,
        name: 'file',
        header: {
          Authorization: `Bearer ${token}`,
        },
      })

      Taro.hideLoading()
      const data = JSON.parse(uploadRes.data)
      const imageUrl = data?.imageUrl || data?.data?.imageUrl
      if (!imageUrl) {
        throw new Error('图片上传失败')
      }

      const msg = await sendPrivateMessage(otherUserId, '', 'image', imageUrl)
      setMessages((prev) => [msg, ...prev])
      scrollToBottom()
    } catch (err: any) {
      Taro.hideLoading()
      if (isPrivacyAuthorizeError(err)) {
        showPrivacyAuthorizeFailure()
        return
      }
      Taro.showToast({ title: err?.message || '发送失败', icon: 'none' })
    } finally {
      setSending(false)
    }
  }

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current = `msg-bottom-${Date.now()}`
    }, 100)
  }

  const handlePreviewImage = (url: string) => {
    const urls = messages.filter((m) => m.content_type === 'image' && m.image_url).map((m) => m.image_url!)
    Taro.previewImage({ urls: urls.length > 0 ? urls : [url], current: url })
  }

  const renderMessage = (msg: PrivateMessage, index: number) => {
    const isSelf = msg.sender_id === currentUserId
    const prevMsg = index < messages.length - 1 ? messages[index + 1] : null
    const showTime = shouldShowTimeDivider(prevMsg, msg)
    const isSystem = msg.content_type === 'system'

    return (
      <View key={msg.id}>
        {showTime && (
          <View className='chat-time-divider'>
            <Text className='chat-time-text'>{formatMessageTime(msg.created_at)}</Text>
          </View>
        )}
        {isSystem ? (
          <View className='chat-system-message-row'>
            <View className='chat-system-bubble'>
              <Text className='chat-system-bubble-text'>{msg.content}</Text>
            </View>
          </View>
        ) : (
          <View className={`chat-message-row ${isSelf ? 'chat-message-row--self' : ''}`}>
            <View className='chat-avatar'>
              <Image
                className='chat-avatar-img'
                src={isSelf ? currentUserAvatar || DEFAULT_AVATAR_URL : otherUser.avatar || DEFAULT_AVATAR_URL}
                mode='aspectFill'
              />
            </View>
            <View
              className={`chat-bubble ${isSelf ? 'chat-bubble--self' : ''} ${
                msg.content_type === 'image' ? 'chat-bubble--image' : ''
              }`}
            >
              {msg.content_type === 'image' && msg.image_url ? (
                <Image
                  className='chat-bubble-image'
                  src={msg.image_url}
                  mode='widthFix'
                  onClick={() => handlePreviewImage(msg.image_url!)}
                />
              ) : (
                <Text className='chat-bubble-text'>{msg.content}</Text>
              )}
            </View>
          </View>
        )}
      </View>
    )
  }

  return (
    <FlPageThemeRoot>
      <View className='private-chat-page'>
        {/* 消息列表 */}
        <ScrollView
          className='chat-message-list'
          scrollY
          enhanced
          showScrollbar={false}
          scrollIntoView={scrollRef.current}
        >
          <View className='chat-message-content'>
            {loading && messages.length === 0 ? (
              <View className='chat-loading'>
                <View className='chat-spinner' />
              </View>
            ) : messages.length === 0 ? (
              <View className='chat-empty'>
                <Text className='chat-empty-text'>开始聊天吧</Text>
              </View>
            ) : (
              <>
                {messages.map(renderMessage)}
                <View id={`msg-bottom-${scrollRef.current}`} className='chat-bottom-anchor' />
              </>
            )}
          </View>
        </ScrollView>

        {/* 底部输入区 */}
        {!isSystemChat && (
        <View className='chat-input-bar'>
          <View className='chat-input-actions'>
            <View className='chat-image-btn' onClick={handleSendImage}>
              <Text className='iconfont icon-picture chat-image-btn-icon' />
            </View>
          </View>
          <Input
            className='chat-input'
            placeholder='说点什么...'
            placeholderClass='chat-input-placeholder'
            value={inputText}
            onInput={(e) => setInputText(e.detail.value)}
            onConfirm={handleSendText}
            confirmType='send'
            disabled={sending}
          />
          <Button
            className={`chat-send-btn ${inputText.trim() ? 'chat-send-btn--active' : ''}`}
            onClick={handleSendText}
            disabled={!inputText.trim() || sending}
          >
            <Text className='chat-send-btn-text'>发送</Text>
          </Button>
        </View>
        )}
      </View>
    </FlPageThemeRoot>
  )
}
