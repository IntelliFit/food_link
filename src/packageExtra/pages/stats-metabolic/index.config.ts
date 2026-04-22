export default definePageConfig({
  navigationStyle: 'custom',
  /** 分包页非 tabBar 路由，需显式引用根目录自定义 tabBar，否则底部导航不显示 */
  usingComponents: {
    'custom-tab-bar': '/custom-tab-bar/index',
  },
})
