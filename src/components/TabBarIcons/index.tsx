import { View } from '@tarojs/components'

interface IconProps {
  /** 图标大小（rpx），默认 48 */
  size?: number
  /** 图标颜色 */
  color?: string
  /** 自定义类名 */
  className?: string
}

/** 首页图标 - 房子形状 */
export const IconTabHome = ({ size = 48, color = '#9ca3af', className = '' }: IconProps) => {
  return (
    <View 
      className={`tab-bar-icon ${className}`}
      style={{ 
        width: `${size}rpx`, 
        height: `${size}rpx`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
        <path 
          d="M8 20L24 8L40 20V40C40 41.1046 39.1046 42 38 42H10C8.89543 42 8 41.1046 8 40V20Z" 
          stroke={color} 
          strokeWidth="3.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          fill="none"
        />
        <path 
          d="M18 42V28H30V42" 
          stroke={color} 
          strokeWidth="3.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </View>
  )
}

/** 分析图标 - 柱状图 */
export const IconTabStats = ({ size = 48, color = '#9ca3af', className = '' }: IconProps) => {
  return (
    <View 
      className={`tab-bar-icon ${className}`}
      style={{ 
        width: `${size}rpx`, 
        height: `${size}rpx`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="24" width="8" height="18" rx="2" fill={color} opacity="0.3"/>
        <rect x="20" y="14" width="8" height="28" rx="2" fill={color} opacity="0.6"/>
        <rect x="32" y="6" width="8" height="36" rx="2" fill={color}/>
      </svg>
    </View>
  )
}

/** 圈子图标 - 多人/社区 */
export const IconTabCommunity = ({ size = 48, color = '#9ca3af', className = '' }: IconProps) => {
  return (
    <View 
      className={`tab-bar-icon ${className}`}
      style={{ 
        width: `${size}rpx`, 
        height: `${size}rpx`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
        <circle cx="16" cy="16" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <circle cx="32" cy="16" r="6" stroke={color} strokeWidth="3" fill="none"/>
        <path 
          d="M8 40C8 33.3726 13.3726 28 20 28H28C34.6274 28 40 33.3726 40 40" 
          stroke={color} 
          strokeWidth="3" 
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </View>
  )
}

/** 我的图标 - 用户 */
export const IconTabProfile = ({ size = 48, color = '#9ca3af', className = '' }: IconProps) => {
  return (
    <View 
      className={`tab-bar-icon ${className}`}
      style={{ 
        width: `${size}rpx`, 
        height: `${size}rpx`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="14" r="8" stroke={color} strokeWidth="3.5" fill="none"/>
        <path 
          d="M8 42C8 33.1634 15.1634 26 24 26C32.8366 26 40 33.1634 40 42" 
          stroke={color} 
          strokeWidth="3.5" 
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </View>
  )
}

/** 摄像头图标 - 用于中间记录按钮 */
export const IconTabCamera = ({ size = 48, color = '#ffffff', className = '' }: IconProps) => {
  return (
    <View 
      className={`tab-bar-icon ${className}`}
      style={{ 
        width: `${size}rpx`, 
        height: `${size}rpx`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="14" width="28" height="22" rx="4" stroke={color} strokeWidth="3.5" fill="none"/>
        <circle cx="20" cy="25" r="6" stroke={color} strokeWidth="3.5" fill="none"/>
        <path 
          d="M34 20L42 16V34L34 30" 
          stroke={color} 
          strokeWidth="3.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </View>
  )
}
