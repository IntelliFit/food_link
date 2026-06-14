export type HighlightRect = {
  left: number
  top: number
  width: number
  height: number
}

export type GuideHighlightPreset = 'tab-record-center'

export type OnboardingGuideStep = {
  title: string
  description: string
  /** 页面内节点选择器，与 preset 二选一 */
  selector?: string
  /** 无法跨组件查询时使用预设区域（如 custom-tab-bar 中央拍照按钮） */
  preset?: GuideHighlightPreset
  /** 高亮区域内边距（px） */
  padding?: number
  /** 查询前滚动到该节点 */
  scrollIntoView?: boolean
  /** 覆盖右侧主按钮文案，不传则按「下一步 / 知道了」显示 */
  confirmLabel?: string
  /** 左侧自定义行动按钮；存在时替换「跳过全部」 */
  action?: {
    label: string
    onPress: () => void | Promise<void>
  }
}
