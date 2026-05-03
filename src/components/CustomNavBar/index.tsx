import { View, Text } from '@tarojs/components'
import React from 'react'
import Taro from '@tarojs/taro'
import { ArrowLeft } from '@taroify/icons'
import '@taroify/icons/style'
import './index.scss'

interface CustomNavBarProps {
    title?: string
    /** 文字颜色，默认白色 */
    color?: string
    /** 是否显示返回按钮 */
    showBack?: boolean
    /** 自定义返回逻辑 */
    onBack?: () => void
    /** 自定义背景样式（支持渐变等） */
    background?: string
    /** 额外的 className */
    className?: string
    /** 右侧自定义内容 */
    rightContent?: React.ReactNode
}

export function getStatusBarHeightSafe(): number {
    // 新版基础库优先使用拆分 API，避免 getSystemInfoSync 废弃告警
    try {
        const win = (Taro as any).getWindowInfo?.()
        const h = Number(win?.statusBarHeight)
        if (Number.isFinite(h) && h > 0) return h
    } catch {
        // ignore
    }
    try {
        const sysInfo = Taro.getSystemInfoSync()
        return sysInfo.statusBarHeight || 20
    } catch {
        return 20
    }
}

export default function CustomNavBar({
    title = '',
    color = '#ffffff',
    showBack = false,
    onBack,
    background = 'linear-gradient(to right, #00bc7d 0%, #00bba7 100%)',
    className = '',
    rightContent
}: CustomNavBarProps) {
    const [navInfo] = React.useState(() => {
        const menuBtn = Taro.getMenuButtonBoundingClientRect()
        const statusBarHeight = getStatusBarHeightSafe()
        // 导航栏内容区高度 = (胶囊按钮上边距 - 状态栏高度) * 2 + 胶囊按钮高度
        const navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height
        // 计算胶囊按钮占用的右侧安全区域，避免 rightContent 被遮挡
        const sysInfo = Taro.getSystemInfoSync()
        const capsuleRightGap = (menuBtn && menuBtn.left > 0)
            ? sysInfo.windowWidth - menuBtn.left + 8
            : 16
        return { statusBarHeight, navBarHeight, capsuleRightGap }
    })

    const handleBack = () => {
        if (onBack) {
            onBack()
            return
        }
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
                        <ArrowLeft className='custom-nav-bar__back-icon' style={{ color }} />
                    </View>
                )}
                <Text className='custom-nav-bar__title' style={{ color }}>
                    {title}
                </Text>
                {rightContent && (
                    <View className='custom-nav-bar__right' style={{ right: `${navInfo.capsuleRightGap}px` }}>
                        {rightContent}
                    </View>
                )}
            </View>
        </View>
    )
}

/**
 * 获取自定义导航栏的总高度（状态栏 + 导航栏），用于页面内容定位
 */
export function getNavBarHeight(): number {
    const menuBtn = Taro.getMenuButtonBoundingClientRect()
    const statusBarHeight = getStatusBarHeightSafe()
    const navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height
    return statusBarHeight + navBarHeight
}
