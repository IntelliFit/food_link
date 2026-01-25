import { View, Text, ScrollView, Image } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'

import './index.scss'

export default function CommunityPage() {
  // 我的圈子数据
  const [myCircles] = useState([
    {
      id: 1,
      icon: '🥗',
      name: '减脂打卡',
      members: 1234
    },
    {
      id: 2,
      icon: '💪',
      name: '增肌训练',
      members: 856
    },
    {
      id: 3,
      icon: '🏃',
      name: '跑步爱好者',
      members: 2100
    },
    {
      id: 4,
      icon: '🥑',
      name: '健康饮食',
      members: 1890
    }
  ])

  // 热门话题
  const [topics] = useState([
    { id: 1, name: '#减脂成功经验' },
    { id: 2, name: '#增肌食谱分享' },
    { id: 3, name: '#运动打卡' },
    { id: 4, name: '#健康饮食' },
    { id: 5, name: '#数据记录' }
  ])

  // 最新动态
  const [feeds] = useState([
    {
      id: 1,
      user: {
        avatar: '👤',
        name: '健康达人',
        time: '2小时前'
      },
      content: '今天完成了30分钟的有氧运动，感觉身体状态很好！继续加油💪',
      image: null,
      tags: ['运动打卡', '有氧运动'],
      stats: {
        likes: 128,
        comments: 45,
        shares: 12
      }
    },
    {
      id: 2,
      user: {
        avatar: '👩',
        name: '营养师小美',
        time: '5小时前'
      },
      content: '分享一道低卡路里的健康早餐：燕麦粥配水果，营养又美味！',
      image: 'https://via.placeholder.com/400x300',
      tags: ['健康饮食', '早餐推荐'],
      stats: {
        likes: 256,
        comments: 89,
        shares: 34
      }
    },
    {
      id: 3,
      user: {
        avatar: '👨',
        name: '健身教练',
        time: '1天前'
      },
      content: '本周减重2kg，距离目标还有3kg，继续坚持！',
      image: null,
      tags: ['减脂打卡', '目标达成'],
      stats: {
        likes: 189,
        comments: 67,
        shares: 23
      }
    }
  ])

  const handleViewAllCircles = () => {
    Taro.showToast({
      title: '查看全部圈子',
      icon: 'none'
    })
  }

  const handleRankingClick = () => {
    Taro.showToast({
      title: '查看排行榜',
      icon: 'none'
    })
  }

  const handleTopicClick = (topic: typeof topics[0]) => {
    Taro.showToast({
      title: `查看${topic.name}`,
      icon: 'none'
    })
  }

  const handleFeedAction = (_feedId: number, action: 'like' | 'comment' | 'share') => {
    Taro.showToast({
      title: action === 'like' ? '已点赞' : action === 'comment' ? '打开评论' : '已分享',
      icon: 'none'
    })
  }

  const handlePublish = () => {
    Taro.showToast({
      title: '发布动态',
      icon: 'none'
    })
  }

  const handleShare = (_feedId: number) => {
    Taro.showToast({
      title: '分享动态',
      icon: 'none'
    })
  }

  return (
    <View className='community-page'>
      <ScrollView
        className='community-scroll'
        scrollY
        enhanced
        showScrollbar={false}
      >
        {/* 页面头部 */}
        <View className='page-header'>
          <Text className='page-title'>健康圈子</Text>
          <Text className='page-subtitle'>与志同道合的朋友一起分享健康生活</Text>
        </View>

        {/* 我的圈子 */}
        <View className='my-circles-section'>
          <View className='section-header'>
            <Text className='section-title'>我的圈子</Text>
            <View className='view-all-btn' onClick={handleViewAllCircles}>
              <Text className='view-all-text'>查看全部</Text>
              <Text className='arrow'>{'>'}</Text>
            </View>
          </View>
          <View className='circles-list'>
            {myCircles.map((circle) => (
              <View key={circle.id} className='circle-card'>
                <Text className='circle-icon'>{circle.icon}</Text>
                <Text className='circle-name'>{circle.name}</Text>
                <View className='circle-members'>
                  <Text className='member-icon'>👥</Text>
                  <Text className='member-count'>{circle.members}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* 本周打卡排行榜 */}
        <View className='ranking-banner' onClick={handleRankingClick}>
          <View className='ranking-content'>
            <View className='ranking-icon'>
              <Text>🏆</Text>
            </View>
            <View className='ranking-text'>
              <Text className='ranking-title'>本周打卡排行榜</Text>
              <Text className='ranking-subtitle'>看看谁是本周最活跃的用户</Text>
            </View>
          </View>
          <Text className='ranking-arrow'>{'>'}</Text>
        </View>

        {/* 热门话题 */}
        <View className='topics-section'>
          <View className='section-header'>
            <View className='section-title-wrapper'>
              <Text className='section-title-icon'>📈</Text>
              <Text className='section-title'>热门话题</Text>
            </View>
          </View>
          <ScrollView
            className='topics-list-wrapper'
            scrollX
            enhanced
            showScrollbar={false}
            enableFlex
          >
            <View className='topics-list'>
              {topics.map((topic) => (
                <View
                  key={topic.id}
                  className='topic-tag'
                  onClick={() => handleTopicClick(topic)}
                >
                  <Text>{topic.name}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* 最新动态 */}
        <View className='feed-section'>
          <View className='section-header'>
            <Text className='section-title'>最新动态</Text>
          </View>
          <View className='feed-list'>
            {feeds.map((feed) => (
              <View key={feed.id} className='feed-card'>
                {/* 动态头部 */}
                <View className='feed-header'>
                  <View className='user-avatar'>
                    <Text>{feed.user.avatar}</Text>
                  </View>
                  <View className='user-info'>
                    <Text className='user-name'>{feed.user.name}</Text>
                    <Text className='post-time'>{feed.user.time}</Text>
                  </View>
                  <View className='share-btn' onClick={() => handleShare(feed.id)}>
                    <Text>⋯</Text>
                  </View>
                </View>

                {/* 动态内容 */}
                <Text className='feed-content'>{feed.content}</Text>

                {/* 动态图片 */}
                {feed.image && (
                  <View className='feed-image'>
                    <Image
                      src={feed.image}
                      mode='aspectFill'
                      className='feed-image-content'
                    />
                  </View>
                )}

                {/* 动态标签 */}
                {feed.tags && feed.tags.length > 0 && (
                  <View className='feed-tags'>
                    {feed.tags.map((tag, index) => (
                      <View key={index} className='feed-tag'>
                        <Text>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* 动态操作 */}
                <View className='feed-actions'>
                  <View
                    className='action-item'
                    onClick={() => handleFeedAction(feed.id, 'like')}
                  >
                    <Text className='action-icon'>❤️</Text>
                    <Text className='action-count'>{feed.stats.likes}</Text>
                  </View>
                  <View
                    className='action-item'
                    onClick={() => handleFeedAction(feed.id, 'comment')}
                  >
                    <Text className='action-icon'>💬</Text>
                    <Text className='action-count'>{feed.stats.comments}</Text>
                  </View>
                  <View
                    className='action-item'
                    onClick={() => handleFeedAction(feed.id, 'share')}
                  >
                    <Text className='action-icon'>🔗</Text>
                    <Text className='action-count'>{feed.stats.shares}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* 浮动发布按钮 */}
      <View className='fab-button' onClick={handlePublish}>
        <Text className='fab-icon'>✏️</Text>
      </View>
    </View>
  )
}


