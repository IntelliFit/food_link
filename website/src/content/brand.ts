export const brand = {
  shortName: '食探',
  fullName: '智健食探',
  legalName: 'Food Link',
  companyName: '智健启能（北京）科技有限公司',
  icpNumber: '京ICP备2025141637号-4',
  /** 工信部 ICP/IP 地址/域名信息备案管理系统（备案号须链至该官网） */
  icpUrl: 'https://beian.miit.gov.cn/',
  slogan: '记录饮食，连接健康',
  subSlogan: 'AI 帮你看懂每一餐',
  wechatSearchHint: '微信搜索「智健食探」',
  scanHint: '打开微信扫一扫',
  contact: {
    title: '联系方式',
    description: '如有任何问题或建议，欢迎随时联系我们。您也可以在小程序「我的」中加入用户群，反馈问题、提建议，一起共创食探。',
    email: 'jianwen_ma@stu.pku.edu.cn',
    emailLabel: '官方邮箱',
    supportHint: '小程序内亦可通过意见反馈或客服入口联系我们。',
  },
  assets: {
    loginLogo: '/brand/login-logo.png',
    logoShitan: '/brand/logo-shitan.png',
    qrcode: '/brand/miniprogram-qrcode.png',
  },
  footer: {
    copyright: 'Copyright © 2026 Food Link. All Rights Reserved.',
    disclaimer: '分析结果仅供参考，不构成医学诊断。',
    links: {
      terms: { label: '用户协议', href: '/agreement' },
      privacy: { label: '隐私政策', href: '/privacy' },
      contact: { label: '联系方式', href: '#contact' },
    },
  },
} as const

export type Brand = typeof brand
