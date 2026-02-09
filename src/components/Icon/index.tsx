import Taro from '@tarojs/taro'
import { View } from '@tarojs/components'
import { CSSProperties } from 'react'

export interface IconProps {
  name: string
  size?: number
  color?: string
  style?: CSSProperties
  className?: string
  onClick?: () => void
}

/**
 * 通用图标组件
 * 使用 iconfont symbol 方式
 */
export default function Icon(props: IconProps) {
  const {
    name,
    size = 18,
    color = '#000000',
    style = {},
    className = '',
    onClick
  } = props

  const iconStyle: CSSProperties = {
    width: `${size}rpx`,
    height: `${size}rpx`,
    display: 'inline-block',
    ...style
  }

  return (
    <View
      className={`iconfont ${className}`}
      style={iconStyle}
      onClick={onClick}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          fontSize: `${size}rpx`,
          color: color,
          lineHeight: 1
        }}
      >
        {name}
      </View>
    </View>
  )
}
