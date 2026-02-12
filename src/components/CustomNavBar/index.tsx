import { View, Text } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import './index.scss'

interface CustomNavBarProps {
    title?: string
    /** 文字颜色，默认白色 */
    color?: string
    /** 是否显示返回按钮 */
    showBack?: boolean
    /** 自定义背景样式（支持渐变等） */
    background?: string
    /** 额外的 className */
    className?: string
}

export default function CustomNavBar({
    title = '',
    color = '#ffffff',
    showBack = false,
    background = 'linear-gradient(to right, #00bc7d 0%, #00bba7 100%)',
    className = ''
}: CustomNavBarProps) {
    const [navInfo] = useState(() => {
        const sysInfo = Taro.getSystemInfoSync()
        const menuBtn = Taro.getMenuButtonBoundingClientRect()
        const statusBarHeight = sysInfo.statusBarHeight || 20
        // 导航栏内容区高度 = (胶囊按钮上边距 - 状态栏高度) * 2 + 胶囊按钮高度
        const navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height
        return { statusBarHeight, navBarHeight }
    })

    const handleBack = () => {
        Taro.navigateBack()
    }

    return (
        <View
            className={`custom-nav-bar ${className}`}
            style={{
                background,
                paddingTop: `${navInfo.statusBarHeight}px`
            }}
        >
            <View
                className='custom-nav-bar__content'
                style={{ height: `${navInfo.navBarHeight}px` }}
            >
                {showBack && (
                    <View className='custom-nav-bar__back' onClick={handleBack}>
                        <Text className='custom-nav-bar__back-icon' style={{ color }}>←</Text>
                    </View>
                )}
                <Text className='custom-nav-bar__title' style={{ color }}>
                    {title}
                </Text>
            </View>
        </View>
    )
}

/**
 * 获取自定义导航栏的总高度（状态栏 + 导航栏），用于页面内容定位
 */
export function getNavBarHeight(): number {
    const sysInfo = Taro.getSystemInfoSync()
    const menuBtn = Taro.getMenuButtonBoundingClientRect()
    const statusBarHeight = sysInfo.statusBarHeight || 20
    const navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height
    return statusBarHeight + navBarHeight
}
