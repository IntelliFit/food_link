Component({
  data: {
    selectedIndex: 0,
    tabList: [
      { 
        id: 'home',
        pagePath: '/pages/index/index', 
        text: '首页',
        iconPath: './icons/home.png',
        selectedIconPath: './icons/home-active.png'
      },
      { 
        id: 'stats',
        pagePath: '/pages/stats/index', 
        text: '分析'
        // 使用 CSS 绘制的柱状图图标
      },
      { 
        id: 'record',
        pagePath: '/pages/record/index', 
        text: '',
        isCenter: true,
        iconPath: './icons/record.png',
        selectedIconPath: './icons/record-active.png'
      },
      { 
        id: 'community',
        pagePath: '/pages/community/index', 
        text: '圈子',
        iconPath: './icons/community.png',
        selectedIconPath: './icons/community-active.png'
      },
      { 
        id: 'profile',
        pagePath: '/pages/profile/index', 
        text: '我的',
        iconPath: './icons/profile.png',
        selectedIconPath: './icons/profile-active.png'
      }
    ]
  },
  
  lifetimes: {
    attached() {
      this.updateSelected()
      this.data.timer = setInterval(() => {
        this.updateSelected()
      }, 300)
    },
    
    detached() {
      if (this.data.timer) {
        clearInterval(this.data.timer)
      }
    }
  },
  
  methods: {
    updateSelected() {
      try {
        const pages = getCurrentPages()
        if (pages.length > 0) {
          const currentPage = pages[pages.length - 1]
          const currentPath = '/' + currentPage.route
          
          const index = this.data.tabList.findIndex(item => item.pagePath === currentPath)
          if (index !== -1 && index !== this.data.selectedIndex) {
            this.setData({ selectedIndex: index })
          }
        }
      } catch (error) {
        console.error('CustomTabBar updateSelected error:', error)
      }
    },
    
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset
      this.setData({ selectedIndex: index })
      wx.switchTab({ url: path })
    }
  }
})
