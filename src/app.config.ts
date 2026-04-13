export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/community/index',
    'pages/checkin-leaderboard/index',
    'pages/record/index',
    'pages/record-menu/index',
    'pages/record-text/index',
    'pages/record-manual/index',
    'pages/analyze/index',
    'pages/analyze-loading/index',
    'pages/analyze-history/index',
    'pages/result/index',
    'pages/result-text/index',
    'pages/ai-assistant/index',
    'pages/profile/index',
    'pages/expiry/index',
    'pages/expiry-edit/index',
    // 兼容旧入口：历史缓存可能仍尝试打开 pages/food-expiry/index
    'pages/food-expiry/index',
    'pages/pro-membership/index',
    'pages/recipes/index',
    'pages/recipe-edit/index',
    'pages/health-profile/index',
    'pages/health-profile-view/index',
    'pages/health-profile-edit/index',
    'pages/stats/index',
    'pages/day-record/index',
    'pages/record-detail/index',
    'pages/food-library/index',
    'pages/food-library-detail/index',
    'pages/interaction-notifications/index',
    'pages/interaction-feed-detail/index',

    'pages/food-library-share/index',
    'pages/location-search/index',
    'pages/login/index',
    'pages/about/index',
    'pages/agreement/index',
    'pages/privacy/index',
    'pages/privacy-settings/index',
    'pages/friends/index',
    'pages/profile-settings/index',
    'pages/exercise-record/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    // 与 `app.scss` 中 page 背景一致，避免导航/页面与 WebView 边缘亚像素缝隙露出默认白底形成一条细白线
    backgroundColor: '#f9fafb',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'Food Link',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#6a7282',
    selectedColor: '#00bc7d',
    backgroundColor: '#f9fafb',
    borderStyle: 'black',
    custom: true,
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页'
      },
      {
        pagePath: 'pages/stats/index',
        text: '分析'
      },
      {
        pagePath: 'pages/record/index',
        text: '记录'
      },
      {
        pagePath: 'pages/community/index',
        text: '圈子'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的'
      }
    ]
  },
  permission: {
    'scope.userLocation': {
      desc: '你的位置信息将用于分享食物时标记商家位置'
    }
  },
  requiredPrivateInfos: [
    'getLocation'
  ]
})
