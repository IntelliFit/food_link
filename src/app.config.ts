export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/community/index',
    'pages/record/index',
    'pages/analyze/index',
    'pages/result/index',
    'pages/ai-assistant/index',
    'pages/profile/index'
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
        pagePath: 'pages/ai-assistant/index',
        text: 'AI助手',
        iconPath: 'assets/icons/ai-assistant.png',
        selectedIconPath: 'assets/icons/ai-assistant-active.png'
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
