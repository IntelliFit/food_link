/** 主包仅保留 TabBar 五页，其余页面在 packageExtra 分包以降低主包体积（微信 2MB 限制） */
const mainPages = [
  'pages/index/index',
  'pages/stats/index',
  'pages/record/index',
  'pages/community/index',
  'pages/profile/index',
]

const extraSubpackagePages = [
  'pages/checkin-leaderboard/index',
  'pages/record-menu/index',
  'pages/record-text/index',
  'pages/record-manual/index',
  'pages/analyze/index',
  'pages/analyze-loading/index',
  'pages/analyze-history/index',
  'pages/result/index',
  'pages/result-text/index',
  'pages/expiry/index',
  'pages/expiry-edit/index',
  // 兼容旧入口：历史缓存可能仍尝试打开 pages/food-expiry/index
  'pages/food-expiry/index',
  'pages/pro-membership/index',
  'pages/recipes/index',
  'pages/recipe-edit/index',
  'pages/health-profile/index',
  'pages/health-profile-view/index',
  'pages/day-record/index',
  'pages/stats-metabolic/index',
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
  'pages/membership-agreement/index',
  'pages/privacy/index',
  'pages/privacy-settings/index',
  'pages/friends/index',
  'pages/invite-friends/index',
  'pages/user-group/index',
  'pages/profile-settings/index',
  'pages/exercise-record/index',
]

export default defineAppConfig({
  // 主题由应用内的 `AppColorSchemeContext` 手动控制，不能再让宿主按系统深色模式自动改色，
  // 否则会出现“应用仍是浅色态，但原生页面背景先变黑”的半黑半白混合态。
  darkmode: false,
  pages: mainPages,
  subpackages: [
    {
      root: 'packageExtra',
      name: 'extra',
      pages: extraSubpackagePages,
    },
  ],
  window: {
    backgroundTextStyle: 'light',
    // 与 `app.scss` 中 page 背景一致，避免导航/页面与 WebView 边缘亚像素缝隙露出默认白底形成一条细白线
    backgroundColor: '#f9fafb',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'Food Link',
    navigationBarTextStyle: 'black',
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
        text: '首页',
      },
      {
        pagePath: 'pages/stats/index',
        text: '分析',
      },
      {
        pagePath: 'pages/record/index',
        text: '记录',
      },
      {
        pagePath: 'pages/community/index',
        text: '圈子',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
      },
    ],
  },
  permission: {
    'scope.userLocation': {
      desc: '你的位置信息将用于分享食物时标记商家位置',
    },
    /** 与记录页 <Camera> 组件配套，正式版授权说明（需在隐私指引中声明使用摄像头） */
    'scope.camera': {
      desc: '用于拍照识别食物、记录饮食',
    },
    /** 保存海报等到相册时，授权弹窗用途说明（与隐私指引中的「保存到相册」声明配合） */
    'scope.writePhotosAlbum': {
      desc: '用于将生成的饮食海报保存到手机相册',
    },
  },
  requiredPrivateInfos: ['getLocation'],
})
