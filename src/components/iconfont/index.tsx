import { View } from '@tarojs/components'
import './index.scss'

interface IconProps {
  /** 图标大小（rpx），默认 48 */
  size?: number
  /** 图标颜色 */
  color?: string
  /** 自定义类名 */
  className?: string
}

/** 相机/拍照图标 */
export const IconCamera = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-paizhao-xianxing ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 文字图标 */
export const IconText = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-xingzhuang-wenzi ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 时钟图标 */
export const IconClock = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-shizhong ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 蛋白质图标 */
export const IconProtein = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-danbaizhi ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 脂肪图标 */
export const IconFat = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-zhifangyouheruhuazhifangzhipin ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 碳水图标 */
export const IconCarbs = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-tanshui-dabiao ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 早餐图标 */
export const IconBreakfast = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-zaocan ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 午餐图标 */
export const IconLunch = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-wucan ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 晚餐图标 */
export const IconDinner = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-wancan ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}

/** 加餐/零食图标 */
export const IconSnack = ({ size = 48, color = '#000000', className = '' }: IconProps) => {
  return (
    <View
      className={`iconfont icon-lingshi ${className}`}
      style={{ fontSize: `${size}rpx`, color }}
    />
  )
}
