import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'

import './index.scss'

export default function CustomTabBar() {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const tabList = [
    {
      pagePath: '/pages/index/index',
      text: 'Home'
    },
    {
      pagePath: '/pages/stats/index',
      text: 'Analytics'
    },
    {
      pagePath: '/pages/record/index',
      text: '记录',
      isCenter: true
    },
    {
      pagePath: '/pages/community/index',
      text: '圈子'
    },
    {
      pagePath: '/pages/profile/index',
      text: '我的'
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
    
    updateSelected()
    
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
          <View className='icon-placeholder'>
            {item.isCenter ? (
              <View className='center-button'>+</View>
            ) : (
              <View className={`dot ${selectedIndex === index ? 'active' : ''}`} />
            )}
          </View>
          <Text className='tab-text'>{item.text}</Text>
        </View>
      ))}
    </View>
  )
}
