export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/community/index',
    'pages/record/index',
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
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页'
      },
      {
        pagePath: 'pages/community/index',
        text: '圈子'
      },
      {
        pagePath: 'pages/record/index',
        text: '记录'
      },
      {
        pagePath: 'pages/ai-assistant/index',
        text: 'AI助手'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的'
      }
    ]
  }
})
