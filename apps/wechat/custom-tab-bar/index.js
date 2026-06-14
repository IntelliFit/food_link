const APP_COLOR_SCHEME_KEY = 'fl_app_color_scheme'

function readStorageFlag(key) {
  try {
    const value = wx.getStorageSync(key)
    return value === true || value === 'true' || value === '1' || value === 1
  } catch (e) {
    return false
  }
}

function getTodayDateKey() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function navigateTo(url) {
  wx.navigateTo({ url })
}

function redirectToLogin() {
  navigateTo('/packageExtra/pages/login/index')
}

function chooseAndAnalyze(sourceType) {
  wx.chooseMedia({
    count: sourceType === 'camera' ? 1 : 5,
    mediaType: ['image'],
    sourceType: [sourceType],
    sizeType: ['compressed'],
    success(res) {
      const paths = (res.tempFiles || [])
        .map((f) => f && f.tempFilePath)
        .filter(Boolean)
      if (paths.length > 0) {
        wx.setStorageSync('analyzeImagePath', paths[0])
        wx.setStorageSync('analyzeImagePaths', paths)
      }
      const date = getTodayDateKey()
      wx.setStorageSync('recordTargetDate', date)
      navigateTo(`/packageExtra/pages/analyze/index?date=${encodeURIComponent(date)}`)
    },
    fail(err) {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return
      wx.showToast({ title: '选择图片失败', icon: 'none' })
    },
  })
}

function showCenterRecordMenu() {
  wx.showActionSheet({
    itemList: ['拍照识别', '相册上传', '文字输入', '食物库输入'],
    itemColor: '#1f2937',
    success(res) {
      const date = getTodayDateKey()
      switch (res.tapIndex) {
        case 0:
          if (!wx.getStorageSync('access_token')) {
            redirectToLogin()
            return
          }
          chooseAndAnalyze('camera')
          break
        case 1:
          if (!wx.getStorageSync('access_token')) {
            redirectToLogin()
            return
          }
          chooseAndAnalyze('album')
          break
        case 2:
          navigateTo(`/packageExtra/pages/record-text/index?date=${encodeURIComponent(date)}`)
          break
        case 3:
          navigateTo(`/packageExtra/pages/record-manual/index?date=${encodeURIComponent(date)}`)
          break
      }
    },
  })
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
        showCenterRecordMenu()
        return
      }

      this.setData({ selectedIndex: index })
      wx.switchTab({ url: path })
    }
  }
})
