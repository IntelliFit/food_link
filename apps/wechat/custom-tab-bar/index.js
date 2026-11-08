const APP_COLOR_SCHEME_KEY = 'fl_app_color_scheme'
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

const FOOD_CAMERA_PAGE = '/packageCamera/pages/shoot/index'
/** 首页当前选中的日期，首页每次切换日期都会写入（pages/index/index.tsx 的 HOME_SELECTED_DATE_KEY） */
const HOME_SELECTED_DATE_KEY = 'home_selected_date_v1'

/**
 * 底栏相机直接打开取景相机（V3：点相机直接拍，文字、食物库、常吃的在相机页下面），
 * 按首页选中的日期记；日期不对或超出可记录范围时，由相机页改记今天。
 */
function buildFoodCameraUrl() {
  let date = ''
  try {
    const stored = wx.getStorageSync(HOME_SELECTED_DATE_KEY)
    if (typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored)) date = stored
  } catch (e) {}
  return date ? FOOD_CAMERA_PAGE + '?date=' + encodeURIComponent(date) : FOOD_CAMERA_PAGE
}

Component({
  data: {
    selectedIndex: 0,
    hidden: false,
    recordOpening: false,
    /** 与 React 端 `fl_app_color_scheme` 同步，供深色底栏 */
    colorScheme: 'light',
    /** 首页保留墨绿导航配色，其他 Tab 沿用正常浅色/深色主题。 */
    homeActive: true,
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
        // 小麦替换了原来的「分析」格：一屏看完今天；完整分析 packageStats/pages/stats/index 从小麦页进去，是二级页。
        id: 'pet',
        pagePath: '/pages/pet/index',
        text: '小麦'
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

    openFoodCamera() {
      if (this.data.recordOpening) return
      this.setData({ recordOpening: true })
      wx.navigateTo({
        url: buildFoodCameraUrl(),
        fail: () => {
          wx.showToast({ title: '打开相机失败，请重试', icon: 'none' })
        },
        complete: () => {
          this.setData({ recordOpening: false })
        },
      })
    },

    updateSelected() {
      try {
        const pages = getCurrentPages()
        if (pages.length > 0) {
          const currentPage = pages[pages.length - 1]
          const currentPath = '/' + currentPage.route
          const homeActive = currentPath === '/pages/index/index'
          if (homeActive !== this.data.homeActive) this.setData({ homeActive })
          
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
          const homeNutritionTargetOpen = readStorageFlag('home_nutrition_target_visible')
          const statsRiskDetailOpen = readStorageFlag('stats_risk_detail_visible')
          const onboardingWelcomeOpen = readStorageFlag('onboarding_welcome_visible')
          const petFocusSheetOpen = readStorageFlag('pet_focus_sheet_visible')

          const shouldHide =
            (currentPath === '/pages/community/index' && (communityCommentOpen || communityFilterDrawerOpen)) ||
            (currentPath === '/pages/index/index' && (homePosterModalOpen || homeNutritionTargetOpen || onboardingWelcomeOpen)) ||
            (currentPath === '/packageStats/pages/stats/index' && statsRiskDetailOpen) ||
            (currentPath === '/pages/pet/index' && petFocusSheetOpen)

          if (shouldHide !== this.data.hidden) {
            this.setData({ hidden: shouldHide })
          }
        }
      } catch (e) {}
    },
    
    switchTab(e) {
      const { index, path, iscenter } = e.currentTarget.dataset

      if (iscenter) {
        // 记录面板（四种方式 + 收藏 + 识别记录）仍由首页「记一笔」、某天记录页和伙伴页打开。
        this.openFoodCamera()
        return
      }

      this.setData({ selectedIndex: index })
      wx.switchTab({ url: path })
    }
  }
})
