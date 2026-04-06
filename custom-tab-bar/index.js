Component({
  data: {
    selectedIndex: 0,
    hidden: false,
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
      this.updateHidden()
      this.data.timer = setInterval(() => {
        this.updateSelected()
        this.updateHidden()
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
    
    // 检查是否需要隐藏 tabBar（在摄影模式下隐藏）
    updateHidden() {
      try {
        const pages = getCurrentPages()
        if (pages.length > 0) {
          const currentPage = pages[pages.length - 1]
          const currentPath = '/' + currentPage.route
          
          // 在记录饮食摄影页面隐藏 tabBar
          const shouldHide = currentPath === '/pages/record/index'
          
          if (shouldHide !== this.data.hidden) {
            this.setData({ hidden: shouldHide })
          }
        }
      } catch (error) {
        console.error('CustomTabBar updateHidden error:', error)
      }
    },
    
    switchTab(e) {
      const { index, path, iscenter } = e.currentTarget.dataset

      // 中间记录按钮特殊处理：切换到首页并显示记录菜单弹窗
      if (iscenter) {
        // 设置标记，让首页显示记录菜单弹窗
        wx.setStorageSync('showRecordMenuModal', true)
        // 触发全局事件（备用方案，确保首页能收到通知）
        try {
          const pages = getCurrentPages()
          if (pages.length > 0) {
            const currentPage = pages[pages.length - 1]
            // 如果已经在首页，直接触发事件
            if (currentPage.route === 'pages/index/index') {
              const eventChannel = currentPage.getOpenerEventChannel && currentPage.getOpenerEventChannel()
              if (eventChannel && eventChannel.emit) {
                eventChannel.emit('showRecordMenu')
              }
            }
          }
        } catch (err) {
          console.error('触发事件失败', err)
        }
        // 切换到首页
        wx.switchTab({ url: '/pages/index/index' })
        return
      }

      this.setData({ selectedIndex: index })
      wx.switchTab({ url: path })
    }
  }
})
