const APP_COLOR_SCHEME_KEY = 'fl_app_color_scheme'
const HOME_DISPLAY_MODE_KEY = 'home_display_mode_v1'
const ANALYZE_TASK_REMINDER_STORAGE_KEY = 'analyze_task_reminder_state_v1'
const ANALYZE_TASK_REMINDER_OPEN_KEY = 'analyze_task_reminder_open_task_v1'
const ANALYZE_TASK_REMINDER_OPEN_EVENT = 'openAnalyzeTaskReminder'
const ANALYZE_TASK_REMINDER_OPEN_HISTORY_KEY = 'analyze_task_reminder_open_history_v1'

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
    recordOpening: false,
    /** 与 React 端 `fl_app_color_scheme` 同步，供深色底栏 */
    colorScheme: 'light',
    /** 养生模式使用全局墨绿导航配色，跨 Tab 保持直到切回均衡模式 */
    wellnessActive: false,
    profileTabBadgeCount: 0,
    analyzeReminderKind: 'idle',
    analyzeReminderCount: 0,
    analyzeReminderTaskId: '',
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
      this.refreshState()
      this.startPolling()
    },

    detached() {
      this.stopPolling()
      this.clearRecordOpenTimers()
    }
  },

  // Tab 页会常驻页面栈；只让当前可见页的自定义 TabBar 轮询，避免多个隐藏实例长期抢占 JS 线程。
  pageLifetimes: {
    show() {
      this.refreshState()
      this.startPolling()
    },
    hide() {
      this.stopPolling()
    }
  },

  methods: {
    refreshState() {
      this.updateSelected()
      this.updateHidden()
      this.updateColorScheme()
      this.updateHomeMode()
      this.updateWaitingBadge()
    },

    startPolling() {
      if (this._pollTimer) return
      this._pollTimer = setInterval(() => {
        this.refreshState()
      }, 300)
    },

    stopPolling() {
      if (!this._pollTimer) return
      clearInterval(this._pollTimer)
      this._pollTimer = null
    },

    clearRecordOpenTimers() {
      const timers = Array.isArray(this._recordOpenTimers) ? this._recordOpenTimers : []
      timers.forEach((timer) => clearTimeout(timer))
      this._recordOpenTimers = []
    },

    finishRecordOpening(opened) {
      this.clearRecordOpenTimers()
      if (opened) {
        try {
          wx.removeStorageSync('showRecordMenuModal')
        } catch (e) {}
      }
      if (this.data.recordOpening) {
        this.setData({ recordOpening: false })
      }
    },

    openRecordMenuWithRetry() {
      this.clearRecordOpenTimers()
      // 页面切换和 React effect 注册存在先后顺序；用少量有界重试替代首页 50ms、持续 60 秒的轮询。
      const retryDelays = [0, 80, 180, 350, 650]
      const attempt = (index) => {
        if (triggerRecordMenu(getCurrentPages())) {
          this.finishRecordOpening(true)
          return
        }
        if (index >= retryDelays.length - 1) {
          // 首页组件若发生渲染异常，底栏仍然存在。此时直接进入已有分析页，
          // 让用户仍可在空图片态选择拍照/相册，不把核心记录能力绑死在首页弹层上。
          wx.navigateTo({
            url: '/packageExtra/pages/analyze/index',
            success: () => this.finishRecordOpening(true),
            fail: () => {
              this.finishRecordOpening(false)
              wx.showToast({ title: '记录入口打开失败，请重试', icon: 'none' })
            },
          })
          return
        }
        const timer = setTimeout(() => attempt(index + 1), retryDelays[index + 1])
        this._recordOpenTimers.push(timer)
      }
      attempt(0)
    },

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

    updateHomeMode() {
      try {
        const next = wx.getStorageSync(HOME_DISPLAY_MODE_KEY) === 'wellness'
        if (next !== this.data.wellnessActive) {
          this.setData({ wellnessActive: next })
        }
      } catch (e) {
        if (this.data.wellnessActive) {
          this.setData({ wellnessActive: false })
        }
      }
    },

    updateWaitingBadge() {
      try {
        const now = Date.now()
        if (this._lastWaitingBadgeRefreshAt && now - this._lastWaitingBadgeRefreshAt < 1000) return
        this._lastWaitingBadgeRefreshAt = now
        const token = wx.getStorageSync('access_token')
        if (!token) {
          if (
            this.data.profileTabBadgeCount !== 0 ||
            this.data.analyzeReminderKind !== 'idle' ||
            this.data.analyzeReminderCount !== 0 ||
            this.data.analyzeReminderTaskId
          ) {
            this.setData({
              profileTabBadgeCount: 0,
              analyzeReminderKind: 'idle',
              analyzeReminderCount: 0,
              analyzeReminderTaskId: '',
            })
          }
          return
        }
        const profileBadge = Number(wx.getStorageSync('profile_tab_badge_count') || 0)
        let reminder = null
        try {
          const raw = wx.getStorageSync(ANALYZE_TASK_REMINDER_STORAGE_KEY)
          reminder = typeof raw === 'string' ? JSON.parse(raw) : raw
        } catch (e) {}
        const currentUserId = String(wx.getStorageSync('user_id') || '').trim()
        const validReminder = reminder && reminder.userId === currentUserId ? reminder : null
        const reminderKind = validReminder ? String(validReminder.kind || 'idle') : 'idle'
        const reminderCount = reminderKind === 'waiting_record'
          ? Math.max(0, Number(validReminder.waitingRecord) || 0)
          : reminderKind === 'recognizing'
            ? Math.max(0, Number(validReminder.recognizing) || 0)
            : 0
        const reminderTaskId = validReminder ? String(validReminder.taskId || '').trim() : ''
        if (
          profileBadge !== this.data.profileTabBadgeCount ||
          reminderKind !== this.data.analyzeReminderKind ||
          reminderCount !== this.data.analyzeReminderCount ||
          reminderTaskId !== this.data.analyzeReminderTaskId
        ) {
          this.setData({
            profileTabBadgeCount: profileBadge,
            analyzeReminderKind: reminderKind,
            analyzeReminderCount: reminderCount,
            analyzeReminderTaskId: reminderTaskId,
          })
        }
      } catch (e) {}
    },

    openAnalyzeReminder() {
      const taskId = String(this.data.analyzeReminderTaskId || '').trim()
      if (!taskId) return
      const openHistory = this.data.analyzeReminderKind === 'waiting_record'
      try {
        if (openHistory) {
          const raw = wx.getStorageSync(ANALYZE_TASK_REMINDER_STORAGE_KEY)
          const reminder = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (reminder) {
            wx.setStorageSync(ANALYZE_TASK_REMINDER_STORAGE_KEY, JSON.stringify({
              ...reminder,
              kind: 'idle',
              waitingRecord: 0,
              taskId: '',
              hasUnseen: false,
              updatedAt: Date.now(),
            }))
          }
          wx.setStorageSync(ANALYZE_TASK_REMINDER_OPEN_HISTORY_KEY, '1')
          this.setData({ analyzeReminderKind: 'idle', analyzeReminderCount: 0, analyzeReminderTaskId: '' })
        } else {
          wx.setStorageSync(ANALYZE_TASK_REMINDER_OPEN_KEY, taskId)
        }
      } catch (e) {}
      if (openHistory) {
        wx.navigateTo({
          url: '/packageExtra/pages/analyze-history/index',
          fail: () => wx.switchTab({ url: '/pages/index/index' }),
        })
        return
      }
      const pages = getCurrentPages()
      const currentPage = pages && pages[pages.length - 1]
      if (currentPage && currentPage.route === 'pages/index/index') {
        try {
          const app = typeof getApp === 'function' ? getApp() : null
          const eventCenter = app && app.__taroAppInstance && app.__taroAppInstance.eventCenter
          if (eventCenter && typeof eventCenter.trigger === 'function') {
            wx.removeStorageSync(ANALYZE_TASK_REMINDER_OPEN_KEY)
            eventCenter.trigger(ANALYZE_TASK_REMINDER_OPEN_EVENT, taskId)
            return
          }
        } catch (e) {}
      }
      wx.switchTab({ url: '/pages/index/index' })
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
        if (this.data.recordOpening) return
        this.setData({ recordOpening: true })
        wx.setStorageSync('showRecordMenuModal', true)

        const pages = getCurrentPages()
        const isAlreadyHome = pages.length > 0 && pages[pages.length - 1].route === 'pages/index/index'
        
        if (isAlreadyHome) {
          this.openRecordMenuWithRetry()
          return
        }

        wx.switchTab({ 
          url: '/pages/index/index',
          success: () => {
            this.openRecordMenuWithRetry()
          },
          fail: () => {
            this.finishRecordOpening(false)
            wx.showToast({ title: '首页打开失败，请重试', icon: 'none' })
          },
        })
        return
      }

      this.setData({ selectedIndex: index })
      wx.switchTab({ url: path })
    }
  }
})
