import { useDidShow } from '@tarojs/taro'
import { useCallback, useRef, useState } from 'react'
import { getAccessToken, getUserProfile } from '../utils/api'

/**
 * 保存页“同步到圈子”的选择。默认值跟随账号是否已明确开启公开，
 * 读取失败时保持关闭。用户动过开关后，返回页面不再覆盖。
 */
export function useFeedShareChoice() {
  const [shareToFeed, setShareToFeedState] = useState(false)
  const [accountPublic, setAccountPublic] = useState(false)
  const touchedRef = useRef(false)

  useDidShow(() => {
    if (!getAccessToken()) return
    void getUserProfile().then((profile) => {
      const isPublic = profile.public_records === true
      setAccountPublic(isPublic)
      if (!touchedRef.current) setShareToFeedState(isPublic)
    }).catch(() => {
      /* 保持当前选择，默认不同步 */
    })
  })

  const setShareToFeed = useCallback((value: boolean) => {
    touchedRef.current = true
    setShareToFeedState(value)
  }, [])

  return { shareToFeed, setShareToFeed, accountPublic }
}
