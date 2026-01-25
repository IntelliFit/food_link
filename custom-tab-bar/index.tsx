import { View, Text, Image } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'

import homeIcon from '../../assets/icons/home.png'
import homeActiveIcon from '../../assets/icons/home-active.png'
import communityIcon from '../../assets/icons/community.png'
import communityActiveIcon from '../../assets/icons/community-active.png'
import recordIcon from '../../assets/icons/record.png'
import recordActiveIcon from '../../assets/icons/record-active.png'
import aiIcon from '../../assets/icons/ai-assistant.png'
import aiActiveIcon from '../../assets/icons/ai-assistant-active.png'
import profileIcon from '../../assets/icons/profile.png'
import profileActiveIcon from '../../assets/icons/profile-active.png'

import './index.scss'

export default function CustomTabBar() {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const tabList = [
    {
      pagePath: '/pages/index/index',
      text: '首页',
      iconPath: homeIcon,
      selectedIconPath: homeActiveIcon
    },
    {
      pagePath: '/pages/community/index',
      text: '圈子',
      iconPath: communityIcon,
      selectedIconPath: communityActiveIcon
    },
    {
      pagePath: '/pages/record/index',
      text: '记录',
      iconPath: recordIcon,
      selectedIconPath: recordActiveIcon,
      isCenter: true
    },
    {
      pagePath: '/pages/ai-assistant/index',
      text: 'AI助手',
      iconPath: aiIcon,
      selectedIconPath: aiActiveIcon
    },
    {
      pagePath: '/pages/profile/index',
      text: '我的',
      iconPath: profileIcon,
      selectedIconPath: profileActiveIcon
    }
  ]

  useEffect(() => {
    const updateSelected = () => {
      try {
        const pages = Taro.getCurrentPages()
        if (pages.length > 0) {
          const currentPage = pages[pages.length - 1]
          const currentPath = '/' + currentPage.route
          
          const index = tabList.findIndex(item => item.pagePath === currentPath)
          if (index !== -1) {
            setSelectedIndex(index)
          }
        }
      } catch (error) {
        console.error('CustomTabBar updateSelected error:', error)
      }
    }
    
    // 立即更新一次
    updateSelected()
    
    // 使用定时器定期更新（确保页面切换时能及时更新）
    const timer = setInterval(() => {
      updateSelected()
    }, 300)
    
    return () => {
      clearInterval(timer)
    }
  }, [])

  const switchTab = (index: number, item: typeof tabList[0]) => {
    setSelectedIndex(index)
    Taro.switchTab({
      url: item.pagePath
    })
  }

  return (
    <View className='custom-tab-bar'>
      {tabList.map((item, index) => (
        <View
          key={index}
          className={`tab-item ${item.isCenter ? 'center-item' : ''} ${selectedIndex === index ? 'selected' : ''}`}
          onClick={() => switchTab(index, item)}
        >
          <View className='icon-wrapper'>
            <Image
              className='tab-icon'
              src={selectedIndex === index ? item.selectedIconPath : item.iconPath}
              lazyLoad={false}
              mode='aspectFit'
            />
          </View>
          <Text className='tab-text'>{item.text}</Text>
        </View>
      ))}
    </View>
  )
}

