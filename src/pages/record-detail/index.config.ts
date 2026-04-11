export default definePageConfig({
  /** 与首页分享弹层一致：须自定义顶栏，否则系统导航栏会叠在海报全屏层之上 */
  navigationStyle: 'custom',
  navigationBarTitleText: '识别记录详情',
  enablePullDownRefresh: false,
  enableShareAppMessage: true,
  enableShareTimeline: true
})
