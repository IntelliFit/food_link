export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/community/index',
    'pages/record/index',
    'pages/analyze/index',
    'pages/analyze-loading/index',
    'pages/analyze-history/index',
    'pages/result/index',
    'pages/result-text/index',
    'pages/ai-assistant/index',
    'pages/profile/index',
    'pages/recipes/index',
    'pages/recipe-edit/index',
    'pages/health-profile/index',
    'pages/health-profile-view/index',
    'pages/stats/index',
    'pages/record-detail/index',
    'pages/food-library/index',
    'pages/food-library-detail/index',
    'pages/food-library-share/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'Food Link',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#6a7282',
    selectedColor: '#00bc7d',
    backgroundColor: '#f9fafb',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/icons/home.png',
        selectedIconPath: 'assets/icons/home-active.png'
      },
      {
        pagePath: 'pages/community/index',
        text: '圈子',
        iconPath: 'assets/icons/community.png',
        selectedIconPath: 'assets/icons/community-active.png'
      },
      {
        pagePath: 'pages/record/index',
        text: '记录',
        iconPath: 'assets/icons/record.png',
        selectedIconPath: 'assets/icons/record-active.png'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/icons/profile.png',
        selectedIconPath: 'assets/icons/profile-active.png'
      }
    ]
  }
})
