export const productIntro = {
  badge: 'AI 驱动的饮食健康管理应用',
  headline: {
    line1: '遇见食探',
    line2Prefix: '读懂你的',
    line2Highlight: '饮食',
    line3Prefix: '只需要',
    line3Highlight: '一张照片',
  },
  description:
    '食探是一款 AI 驱动的饮食健康管理应用。拍一张照片，即可识别菜品、估算热量、解析营养结构，并给出更轻松的饮食建议。',
  featureHighlights: [
    { icon: 'flame' as const, title: 'AI 热量识别', subtitle: '拍照即可估算热量' },
    { icon: 'activity' as const, title: 'AI 健康评估', subtitle: '读懂营养与趋势' },
    { icon: 'users' as const, title: '食物圈子', subtitle: '和好友一起坚持' },
  ],
} as const

/** Hero 主视觉：stage2 分析结果 */
export const heroFlow = {
  ariaLabel: '食探分析结果预览',
  screenLabel: '分析结果',
  screenImage: '/images/hero/stage2.jpg',
} as const
