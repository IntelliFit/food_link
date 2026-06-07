/** 主包仅保留 TabBar 五页，其余页面在 packageExtra 分包以降低主包体积（微信 2MB 限制） */
const mainPages = [
  'pages/index/index',
  'pages/stats/index',
  'pages/community/index',
  'pages/profile/index',
]

const extraSubpackagePages = [
  'pages/checkin-leaderboard/index',
  'pages/record-text/index',
  'pages/record-manual/index',
  'pages/analyze/index',
  'pages/analyze-loading/index',
  'pages/analyze-history/index',
  'pages/result/index',
  'pages/packaged-food-edit/index',
  'pages/packaged-food-task-detail/index',
  'pages/result-text/index',
  'pages/expiry/index',
  'pages/expiry-edit/index',
  // 兼容旧入口：历史缓存可能仍尝试打开 pages/food-expiry/index
  'pages/food-expiry/index',
  'pages/pro-membership/index',
  'pages/auto-renew-audit/index',
  'pages/recipes/index',
  'pages/recipe-edit/index',
  'pages/health-profile/index',
  'pages/health-profile-view/index',
  'pages/day-record/index',
  'pages/record-detail/index',
  'pages/food-library/index',
  'pages/food-library-detail/index',
  'pages/campus-canteen/index',
  'pages/campus-food-share/index',
  'pages/reward-center/index',
  'pages/interaction-notifications/index',
  'pages/interaction-feed-detail/index',
  'pages/food-library-share/index',
  'pages/location-search/index',
  'pages/login/index',
  'pages/agreement/index',
  'pages/membership-agreement/index',
  'pages/privacy/index',
  // 兼容旧构建/开发者工具缓存仍尝试打开 /packageExtra/pages/about/index 的情况；
  // 真实业务入口会经 extraPkgUrl() 路由到独立 packageAbout。
  'pages/about/index',
  'pages/privacy-settings/index',
  'pages/pet-home/index',
  'pages/pet-lab/index',
  'pages/friends/index',
  'pages/invite-friends/index',
  'pages/profile-settings/index',
  'pages/weight-record/index',
  'pages/weight-trend/index',
  'pages/water-record/index',
  'pages/water-trend/index',
  'pages/exercise-record/index',
  'pages/exercise-trend/index',
  'pages/body-trends/index',
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
    {
      // ECharts vendor chunk is large; isolate this route in its own top-level subpackage to stay under WeChat package limits.
      root: 'packageStatsMetabolic',
      name: 'stats-metabolic',
      pages: ['pages/stats-metabolic/index'],
    },
    {
      // About page used to pull a very large local logo; keep it isolated even after slimming the asset path.
      root: 'packageAbout',
      name: 'about',
      pages: ['pages/about/index'],
    },
    {
      // User group QR images make this page relatively heavy; isolating it prevents the shared profile subpackage from overflowing.
      root: 'packageUserGroup',
      name: 'user-group',
      pages: ['pages/user-group/index'],
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
  },
  // 微信当前只允许在 requiredPrivateInfos 中声明定位/地址类接口；
  // chooseImage 等选图接口需在小程序后台“用户隐私保护指引”中声明，不能写进 app.json。
  requiredPrivateInfos: ['getLocation'],
})
