import { StyleProp, Text, TextStyle } from 'react-native'
import { ICON_MAP } from './iconMap'

export interface IconfontTextProps {
  /** 类名字符串，需包含 "iconfont" 和 "icon-xxx"，例如 "iconfont icon-shouye" */
  className: string
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
}

export function IconfontText({ className, size = 16, color, style }: IconfontTextProps) {
  const classes = className.split(/\s+/)
  const iconClass = classes.find((c) => c.startsWith('icon-') && c !== 'iconfont')
  if (!iconClass || !ICON_MAP[iconClass]) {
    return null
  }

  return (
    <Text
      style={[{ fontFamily: 'iconfont', fontSize: size, color }, style]}
      allowFontScaling={false}
    >
      {ICON_MAP[iconClass]}
    </Text>
  )
}
