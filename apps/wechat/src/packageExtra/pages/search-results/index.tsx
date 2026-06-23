import { View, Text, Image, Input, ScrollView } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { communitySearch, communityLike, communityUnlike, showUnifiedApiError, type ContentSearchResult, type UserSearchResult } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import { ManualFoodCards } from '../../../pages/community/components/ManualFoodCards'
import { ExerciseActivityCards, hasExerciseActivityCards } from '../../../pages/community/components/ExerciseActivityCards'
import { shouldRenderManualFoodCards } from '../../../utils/manual-food-source'
import './index.scss'

type SearchTab = 'content' | 'users'
const PAGE_SIZE = 20
const HISTORY_KEY = 'search_history'
const MAX_HISTORY = 30

function SearchResultsPage() {
  const router = useRouter()
  const initialKeyword = decodeURIComponent(router.params?.keyword || '')
  const autoFocus = router.params?.focus === '1'

  const [keyword, setKeyword] = useState(initialKeyword)
  // WeChat 小程序中 Input.focus 需在首次渲染时即为 true 并配合 key 强制重挂载才可靠
  const [inputKey, setInputKey] = useState(0)
  const inputFocus = autoFocus && inputKey > 0
  const [activeTab, setActiveTab] = useState<SearchTab>('content')

  useEffect(() => {
    if (autoFocus) {
      // 延迟重挂载 Input 使其以 focus=true 渲染
      const timer = setTimeout(() => setInputKey(1), 150)
      return () => clearTimeout(timer)
    }
  }, [autoFocus])

  const [contentResults, setContentResults] = useState<ContentSearchResult[]>([])
  const [userResults, setUserResults] = useState<UserSearchResult[]>([])

  const [contentLoading, setContentLoading] = useState(false)
  const [userLoading, setUserLoading] = useState(false)
  const [contentSearched, setContentSearched] = useState(false)
  const [userSearched, setUserSearched] = useState(false)

  const [contentHasMore, setContentHasMore] = useState(false)
  const [userHasMore, setUserHasMore] = useState(false)

  const [contentOffset, setContentOffset] = useState(0)
  const [userOffset, setUserOffset] = useState(0)

  const [contentCount, setContentCount] = useState(0)
  const [userCount, setUserCount] = useState(0)

  const formatCount = (n: number) => n > 99 ? '99+' : String(n)

  // 搜索记录
  const loadHistory = () => { try { return Taro.getStorageSync(HISTORY_KEY) || [] } catch { return [] } }
  const [searchHistory, setSearchHistory] = useState<string[]>(loadHistory)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  // 每次页面显示时刷新记录
  Taro.useDidShow(() => { setSearchHistory(loadHistory()) })

  const saveToHistory = (kw: string) => {
    const trimmed = kw.trim()
    if (!trimmed) return
    const prev = Taro.getStorageSync(HISTORY_KEY) || []
    const next = [trimmed, ...prev.filter((h: string) => h !== trimmed)].slice(0, MAX_HISTORY)
    Taro.setStorageSync(HISTORY_KEY, next)
    setSearchHistory(next)
  }

  const removeHistoryItem = (idx: number) => {
    const next = searchHistory.filter((_, i) => i !== idx)
    Taro.setStorageSync(HISTORY_KEY, next)
    setSearchHistory(next)
  }

  const clearHistory = () => {
    Taro.setStorageSync(HISTORY_KEY, [])
    setSearchHistory([])
  }

  const onHistoryTap = (kw: string) => {
    setKeyword(kw)
    setContentResults([])
    setUserResults([])
    setContentOffset(0)
    setUserOffset(0)
    setContentSearched(false)
    setUserSearched(false)
    saveToHistory(kw)
    doSearch('content', kw, 0, false)
  }

  // 搜索结果的点赞状态（乐观更新）
  const [searchLikeMap, setSearchLikeMap] = useState<Record<string, boolean>>({})
  const [searchLikeCountMap, setSearchLikeCountMap] = useState<Record<string, number>>({})

  const handleSearchLike = async (item: ContentSearchResult, e: any) => {
    e.stopPropagation()
    const key = `${item.target_type}:${item.target_id}`
    const liked = searchLikeMap[key] ?? item.liked
    const count = searchLikeCountMap[key] ?? item.like_count

    if (liked) {
      setSearchLikeMap((prev) => ({ ...prev, [key]: false }))
      setSearchLikeCountMap((prev) => ({ ...prev, [key]: Math.max(0, count - 1) }))
      try { await communityUnlike(item.target_id, item.target_type as any) } catch {
        setSearchLikeMap((prev) => ({ ...prev, [key]: true }))
        setSearchLikeCountMap((prev) => ({ ...prev, [key]: count }))
      }
    } else {
      setSearchLikeMap((prev) => ({ ...prev, [key]: true }))
      setSearchLikeCountMap((prev) => ({ ...prev, [key]: count + 1 }))
      try { await communityLike(item.target_id, item.target_type as any) } catch {
        setSearchLikeMap((prev) => ({ ...prev, [key]: false }))
        setSearchLikeCountMap((prev) => ({ ...prev, [key]: count }))
      }
    }
  }

  const handleSearchComment = (item: ContentSearchResult, e: any) => {
    e.stopPropagation()
    const q = [
      `targetType=${encodeURIComponent(item.target_type)}`,
      `targetId=${encodeURIComponent(item.target_id)}`,
      'focus_comment=1'
    ].join('&')
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/interaction-feed-detail/index')}?${q}` })
  }

  const doSearch = useCallback(async (tab: SearchTab, kw: string, offset: number, append: boolean) => {
    const trimmed = kw.trim()
    if (!trimmed) return

    if (tab === 'content') {
      setContentLoading(true)
      if (!append) setContentSearched(true)
    } else {
      setUserLoading(true)
      if (!append) setUserSearched(true)
    }

    try {
      const res = await communitySearch({ keyword: trimmed, tab, offset, limit: PAGE_SIZE })
      const list = (res.list || []) as any[]

      // 更新总数统计 + 首次搜索时自动切换到第一个非空 tab
      if (!append) {
        setContentCount(res.content_count || 0)
        setUserCount(res.user_count || 0)
        const cc = res.content_count || 0
        const uc = res.user_count || 0
        if (tab === 'content' && cc === 0 && uc > 0) {
          // 动态内容为空但用户有结果 → 自动切换到用户 tab
          setActiveTab('users')
          doSearch('users', trimmed, 0, false)
          return
        }
      }

      if (tab === 'content') {
        const typed = list as ContentSearchResult[]
        if (append) {
          setContentResults((prev) => [...prev, ...typed])
        } else {
          setContentResults(typed)
        }
        setContentHasMore(res.has_more)
        setContentOffset(offset + typed.length)
      } else {
        const typed = list as UserSearchResult[]
        if (append) {
          setUserResults((prev) => [...prev, ...typed])
        } else {
          setUserResults(typed)
        }
        setUserHasMore(res.has_more)
        setUserOffset(offset + typed.length)
      }
    } catch (e) {
      await showUnifiedApiError(e, '搜索失败')
    } finally {
      if (tab === 'content') {
        setContentLoading(false)
      } else {
        setUserLoading(false)
      }
    }
  }, [])

  // Initial search on mount
  useEffect(() => {
    if (initialKeyword) {
      saveToHistory(initialKeyword)
      doSearch('content', initialKeyword, 0, false)
    }
  }, [initialKeyword]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    const kw = keyword.trim()
    if (!kw) return
    setContentResults([])
    setUserResults([])
    setContentOffset(0)
    setUserOffset(0)
    setContentSearched(false)
    setUserSearched(false)
    saveToHistory(kw)
    doSearch(activeTab, kw, 0, false)
  }

  const handleTabChange = (tab: SearchTab) => {
    setActiveTab(tab)
    const kw = keyword.trim()
    if (!kw) return
    if (tab === 'content' && !contentSearched) {
      doSearch('content', kw, 0, false)
    } else if (tab === 'users' && !userSearched) {
      doSearch('users', kw, 0, false)
    }
  }

  const handleLoadMore = () => {
    const kw = keyword.trim()
    if (!kw) return
    if (activeTab === 'content' && contentHasMore && !contentLoading) {
      doSearch('content', kw, contentOffset, true)
    } else if (activeTab === 'users' && userHasMore && !userLoading) {
      doSearch('users', kw, userOffset, true)
    }
  }

  const navigateToDetail = (item: ContentSearchResult) => {
    const query = [
      `targetType=${encodeURIComponent(item.target_type)}`,
      `targetId=${encodeURIComponent(item.target_id)}`,
      `recordId=${encodeURIComponent(item.target_id)}`,
    ].join('&')
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/interaction-feed-detail/index')}?${query}` })
  }

  const handleManualFoodClick = (item: ContentSearchResult) => {
    navigateToDetail(item)
  }

  const navigateToUser = (userId: string, isSelf: boolean) => {
    if (isSelf) {
      Taro.switchTab({ url: '/pages/profile/index' })
    } else {
      Taro.navigateTo({ url: extraPkgUrl(`/pages/profile-settings/index?user_id=${encodeURIComponent(userId)}`) })
    }
  }

  const formatTime = (t?: string) => {
    if (!t) return ''
    const d = new Date(t)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 172800000) return '昨天'
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  const targetTypeLabel = (t: string) => {
    switch (t) {
      case 'food_record': return '饮食记录'
      case 'exercise_log': return '运动记录'
      case 'circle_post': return '圈子帖子'
      case 'campus_food': return '校园食堂'
      default: return ''
    }
  }

  const renderContentCard = (item: ContentSearchResult, idx: number) => {
    const useManualFoodCards = item.target_type === 'food_record' && shouldRenderManualFoodCards(item)
    const useExerciseActivityCards = item.target_type === 'exercise_log' && hasExerciseActivityCards(item.exercise_items)
    const feedImagePaths = item.image_paths?.length
      ? item.image_paths
      : item.image_path
        ? [item.image_path]
        : []

    return (
      <View key={`${item.target_type}-${item.target_id}-${idx}`} className='content-card' onClick={() => navigateToDetail(item)}>
        <View className='card-author-row'>
          <View className='card-author-avatar'>
            {item.author.avatar ? (
              <Image src={item.author.avatar} mode='aspectFill' className='avatar-img' />
            ) : (
              <Text className='avatar-placeholder'>{item.author.nickname?.charAt(0) || '?'}</Text>
            )}
          </View>
          <View className='card-author-info'>
            <Text className='card-author-name'>{item.author.nickname || '用户'}</Text>
            <Text className='card-meta'>
              <Text className='card-type-badge'>{targetTypeLabel(item.target_type)}</Text>
              {item.record_time || item.created_at ? (
                <Text className='card-time'> · {formatTime(item.record_time || item.created_at)}</Text>
              ) : null}
            </Text>
          </View>
        </View>
        {useManualFoodCards ? (
          <ManualFoodCards
            items={item.items}
            onItemClick={() => handleManualFoodClick(item)}
          />
        ) : useExerciseActivityCards ? (
          <ExerciseActivityCards
            items={item.exercise_items}
            onItemClick={() => navigateToDetail(item)}
          />
        ) : (
          <>
            {item.description ? (
              <View className='card-body'>
                <Text className='card-desc'>{item.description}</Text>
              </View>
            ) : null}
            {feedImagePaths.length === 1 ? (
              <View className='card-image-wrap'>
                <Image src={feedImagePaths[0]} mode='aspectFill' className='card-image' />
              </View>
            ) : null}
            {feedImagePaths.length > 1 && (
              <View className='card-images-wrap'>
                {feedImagePaths.slice(0, 3).map((p, i) => (
                  <Image key={i} src={p} mode='aspectFill' className='card-image-multi' />
                ))}
              </View>
            )}
          </>
        )}
        <View className='content-card-actions'>
          <View className='content-action-item' onClick={(e) => handleSearchLike(item, e)}>
            <Text className={`iconfont icon-good ${(searchLikeMap[`${item.target_type}:${item.target_id}`] ?? item.liked) ? 'liked' : ''}`} />
            <Text className='content-action-count'>{(searchLikeCountMap[`${item.target_type}:${item.target_id}`] ?? item.like_count) || 0}</Text>
          </View>
          <View className='content-action-item' onClick={(e) => handleSearchComment(item, e)}>
            <Text className='iconfont icon-pinglun' />
            <Text className='content-action-count'>{item.comment_count || 0}</Text>
          </View>
        </View>
      </View>
    )
  }

  const renderUserCard = (item: UserSearchResult) => (
    <View key={item.id} className='user-card' onClick={() => navigateToUser(item.id, item.is_self)}>
      <View className='user-card-avatar'>
        {item.avatar ? (
          <Image src={item.avatar} mode='aspectFill' className='avatar-img' />
        ) : (
          <Text className='avatar-placeholder'>{item.nickname?.charAt(0) || '?'}</Text>
        )}
      </View>
      <View className='user-card-info'>
        <View className='user-card-name-row'>
          <Text className='user-card-name'>{item.nickname || '用户'}</Text>
          {item.is_self ? <Text className='user-tag self-tag'>我</Text> : null}
          {item.is_friend && !item.is_self ? <Text className='user-tag friend-tag'>好友</Text> : null}
        </View>
      </View>
      <Text className='iconfont icon-right-arrow user-card-arrow' />
    </View>
  )

  const isLoading = activeTab === 'content' ? contentLoading : userLoading
  const currentResults = activeTab === 'content' ? contentResults : userResults
  const currentSearched = activeTab === 'content' ? contentSearched : userSearched

  const renderSkeleton = () => (
    <View className='skeleton-list'>
      {[1, 2, 3].map((i) => (
        <View key={i} className='skeleton-card'>
          <View className='skeleton-row'>
            <View className='skeleton-avatar' />
            <View className='skeleton-lines'>
              <View className='skeleton-line short' />
              <View className='skeleton-line long' />
            </View>
          </View>
        </View>
      ))}
    </View>
  )

  return (
    <View className='search-results-page'>
      {/* 搜索栏 */}
      <View className='search-bar'>
        <View className='search-input-wrap'>
          <View className='search-icon-wrap'>
            <Text className='iconfont icon-search' />
          </View>
          <Input
            key={autoFocus ? `search-${inputKey}` : undefined}
            className='search-input'
            placeholder='搜索动态内容或用户...'
            placeholderClass='search-placeholder'
            value={keyword}
            focus={inputFocus}
            onInput={(e) => setKeyword(e.detail.value)}
            onConfirm={handleSearch}
            confirmType='search'
          />
          {keyword ? (
            <Text className='search-clear' onClick={() => setKeyword('')}>清除</Text>
          ) : null}
        </View>
        <Text className='search-btn' onClick={handleSearch}>搜索</Text>
      </View>

      {/* 搜索记录 — 始终展示 */}
      {searchHistory.length > 0 && (
        <View className='search-history'>
          <View className='history-header'>
            <Text className='history-title'>搜索记录</Text>
            <View className='history-actions'>
              {searchHistory.length > 4 && (
                <Text className='history-toggle' onClick={() => setHistoryExpanded(!historyExpanded)}>
                  {historyExpanded ? '收起' : '展开'}
                </Text>
              )}
              <Text className='iconfont icon-shanchu history-clear' onClick={clearHistory} />
            </View>
          </View>
          <View className={`history-tags ${historyExpanded ? 'expanded' : ''}`}>
            {searchHistory.map((h, i) => (
              <View key={`${h}-${i}`} className='history-tag'>
                <Text className='history-tag-text' onClick={() => onHistoryTap(h)}>{h}</Text>
                <Text className='history-tag-close' onClick={() => removeHistoryItem(i)}>×</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Tab 栏 */}
      <View className='search-tabs'>
        <View
          className={`tab-item ${activeTab === 'content' ? 'active' : ''}`}
          onClick={() => handleTabChange('content')}
        >
          <Text className='tab-text'>动态内容{contentCount > 0 ? `(${formatCount(contentCount)})` : ''}</Text>
          {activeTab === 'content' && <View className='tab-indicator' />}
        </View>
        <View
          className={`tab-item ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => handleTabChange('users')}
        >
          <Text className='tab-text'>用户{userCount > 0 ? `(${formatCount(userCount)})` : ''}</Text>
          {activeTab === 'users' && <View className='tab-indicator' />}
        </View>
      </View>

      {/* 结果列表 */}
      <ScrollView
        scrollY
        className='results-scroll'
        onScrollToLower={handleLoadMore}
        lowerThreshold={100}
      >
        {isLoading && currentResults.length === 0 ? (
          renderSkeleton()
        ) : !currentSearched ? (
          <View className='empty-state'>
            <Text className='empty-icon iconfont icon-search' />
            <Text className='empty-title'>输入关键词搜索</Text>
            <Text className='empty-desc'>搜索公开动态或可被搜索到的用户</Text>
          </View>
        ) : currentResults.length === 0 ? (
          <View className='empty-state'>
            <Text className='empty-icon iconfont icon-nothing' />
            <Text className='empty-title'>
              {activeTab === 'content' ? `未找到匹配「${keyword}」的动态内容` : `未找到匹配「${keyword}」的用户`}
            </Text>
            <Text className='empty-desc'>尝试其他关键词</Text>
          </View>
        ) : activeTab === 'content' ? (
          <View className='content-list'>
            {contentResults.map((item, idx) => renderContentCard(item, idx))}
            {contentLoading && contentResults.length > 0 ? (
              <View className='load-more-spinner'>
                <View className='mini-spinner' />
              </View>
            ) : null}
            {!contentHasMore && contentResults.length > 0 ? (
              <View className='list-end'>— 没有更多了 —</View>
            ) : null}
          </View>
        ) : (
          <View className='user-list'>
            {userResults.map(renderUserCard)}
            {userLoading && userResults.length > 0 ? (
              <View className='load-more-spinner'>
                <View className='mini-spinner' />
              </View>
            ) : null}
            {!userHasMore && userResults.length > 0 ? (
              <View className='list-end'>— 没有更多了 —</View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

export default withAuth(SearchResultsPage)
