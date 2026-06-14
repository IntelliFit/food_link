const APP_COLOR_SCHEME_KEY = 'fl_app_color_scheme'

function readStorageFlag(key) {
  try {
    const value = wx.getStorageSync(key)
    return value === true || value === 'true' || value === '1' || value === 1
  } catch (e) {
    return false
  }
}

function triggerRecordMenu(pages) {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    const callback = app &&
      app.eventCenter &&
      app.eventCenter.callbacks &&
      app.eventCenter.callbacks.showRecordMenu
    if (typeof callback === 'function') {
      callback()
      return true
    }
  } catch (e) {}

  try {
    const app = typeof getApp === 'function' ? getApp() : null
    const trigger = app &&
      app.__taroAppInstance &&
      app.__taroAppInstance.eventCenter &&
      app.__taroAppInstance.eventCenter.trigger
    if (typeof trigger === 'function') {
      trigger('showRecordMenu')
      return true
    }
  } catch (e) {}

  try {
    const currentPage = pages && pages[pages.length - 1]
    const component = currentPage &&
      currentPage.selectComponent &&
      currentPage.selectComponent('.record-menu-trigger')
    if (component && typeof component.showMenu === 'function') {
      component.showMenu()
      return true
    }
  } catch (e) {}

  return false
}

Component({
  data: {
    selectedIndex: 0,
    hidden: false,
    /** 与 React 端 `fl_app_color_scheme` 同步，供深色底栏 */
    colorScheme: 'light',
    profileTabBadgeCount: 0,
    tabList: [
      { 
        id: 'home',
        pagePath: '/pages/index/index', 
        text: '首页'
      },
      { 
        id: 'stats',
        pagePath: '/pages/stats/index', 
        text: '分析'
      },
      { 
        id: 'record',
        pagePath: '/pages/index/index',
        text: '',
        isCenter: true
      },
      { 
        id: 'community',
        pagePath: '/pages/community/index',
        text: '圈子'
      },
      { 
        id: 'profile',
        pagePath: '/pages/profile/index', 
        text: '我的'
      }
    ]
  },
  
  lifetimes: {
    attached() {
      this.updateSelected()
      this.updateHidden()
      this.updateColorScheme()
      this.updateWaitingBadge()
      this.data.timer = setInterval(() => {
        this.updateSelected()
        this.updateHidden()
        this.updateColorScheme()
        this.updateWaitingBadge()
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
      } catch (e) {}
    },
    
    updateColorScheme() {
      try {
        const raw = wx.getStorageSync(APP_COLOR_SCHEME_KEY)
        const next = raw === 'dark' ? 'dark' : 'light'
        if (next !== this.data.colorScheme) {
          this.setData({ colorScheme: next })
        }
      } catch (e) {
        // ignore
      }
    },

    updateWaitingBadge() {
      try {
        const token = wx.getStorageSync('access_token')
        if (!token) {
          if (this.data.profileTabBadgeCount !== 0) {
            this.setData({ profileTabBadgeCount: 0 })
          }
          return
        }
        const profileBadge = Number(wx.getStorageSync('profile_tab_badge_count') || 0)
        if (profileBadge !== this.data.profileTabBadgeCount) {
          this.setData({ profileTabBadgeCount: profileBadge })
        }
      } catch (e) {}
    },

    updateHidden() {
      try {
        const pages = getCurrentPages()
        if (pages.length > 0) {
          const currentPage = pages[pages.length - 1]
          const currentPath = '/' + currentPage.route

          const communityCommentOpen = readStorageFlag('community_comment_bar_visible')
          const communityFilterDrawerOpen = readStorageFlag('community_filter_drawer_visible')
          const homePosterModalOpen = readStorageFlag('home_poster_modal_visible')
          const statsRiskDetailOpen = readStorageFlag('stats_risk_detail_visible')

          const shouldHide =
            (currentPath === '/pages/community/index' && (communityCommentOpen || communityFilterDrawerOpen)) ||
            (currentPath === '/pages/index/index' && homePosterModalOpen) ||
            (currentPath === '/pages/stats/index' && statsRiskDetailOpen)

          if (shouldHide !== this.data.hidden) {
            this.setData({ hidden: shouldHide })
          }
        }
      } catch (e) {}
    },
    
    switchTab(e) {
      const { index, path, iscenter } = e.currentTarget.dataset

      if (iscenter) {
        wx.setStorageSync('showRecordMenuModal', true)

        const pages = getCurrentPages()
        const isAlreadyHome = pages.length > 0 && pages[pages.length - 1].route === 'pages/index/index'
        
        if (isAlreadyHome) {
          triggerRecordMenu(pages)
          return
        }

        wx.switchTab({ 
          url: '/pages/index/index',
          success: () => {
            setTimeout(() => {
              triggerRecordMenu(getCurrentPages())
            }, 150)
          }
        })
        return
      }

      this.setData({ selectedIndex: index })
      wx.switchTab({ url: path })
    }
  }
})
