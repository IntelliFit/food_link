const APP_COLOR_SCHEME_KEY = 'fl_app_color_scheme'

Component({
  data: {
    selectedIndex: 0,
    hidden: false,
    /** 与 React 端 `fl_app_color_scheme` 同步，供深色底栏 */
    colorScheme: 'light',
    waitingRecordCount: 0,
    hasUnseenWaitingRecord: false,
    profileTabBadgeCount: 0,
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
      } catch (error) {
        console.error('CustomTabBar updateSelected error:', error)
      }
    },
    
    // 检查是否需要隐藏 tabBar（拍照页 / 圈子评论输入展开）
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
        const count = wx.getStorageSync('analyze_waiting_record_count') || 0
        const num = Number(count)
        const hasUnseen = wx.getStorageSync('analyze_has_unseen_waiting_record') === true ||
                          wx.getStorageSync('analyze_has_unseen_waiting_record') === 'true' ||
                          wx.getStorageSync('analyze_has_unseen_waiting_record') === 1
        const profileBadge = Number(wx.getStorageSync('profile_tab_badge_count') || 0)
        if (num !== this.data.waitingRecordCount) {
          this.setData({ waitingRecordCount: num })
        }
        if (hasUnseen !== this.data.hasUnseenWaitingRecord) {
          this.setData({ hasUnseenWaitingRecord: hasUnseen })
        }
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

          let communityCommentOpen = false
          try {
            communityCommentOpen = wx.getStorageSync('community_comment_bar_visible') === '1'
          } catch (e) {
            // ignore
          }

          let homePosterModalOpen = false
          try {
            homePosterModalOpen = wx.getStorageSync('home_poster_modal_visible') === '1'
          } catch (e) {
            // ignore
          }

          let statsRiskDetailOpen = false
          try {
            statsRiskDetailOpen = wx.getStorageSync('stats_risk_detail_visible') === '1'
          } catch (e) {
            // ignore
          }

          const shouldHide =
            currentPath === '/pages/record/index' ||
            currentPath === '/packageExtra/pages/record-menu/index' ||
            (currentPath === '/pages/community/index' && communityCommentOpen) ||
            (currentPath === '/pages/index/index' && homePosterModalOpen) ||
            (currentPath === '/pages/stats/index' && statsRiskDetailOpen)

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
        // 设置标记，让首页显示记录菜单弹窗（storage 作为兜底方案）
        wx.setStorageSync('showRecordMenuModal', true)
        
        // 获取当前页面信息
        const pages = getCurrentPages()
        const isAlreadyHome = pages.length > 0 && pages[pages.length - 1].route === 'pages/index/index'
        
        if (isAlreadyHome) {
          // 如果已经在首页，直接通过全局事件通知首页显示菜单
          let eventTriggered = false
          
          // 方案1：尝试触发 app.eventCenter.callbacks 中注册的方法
          try {
            if (typeof getApp === 'function') {
              const app = getApp()
              if (app && app.eventCenter && app.eventCenter.callbacks && typeof app.eventCenter.callbacks['showRecordMenu'] === 'function') {
                app.eventCenter.callbacks['showRecordMenu']()
                eventTriggered = true
                console.log('[CustomTabBar] 通过 app.eventCenter.callbacks 触发事件成功')
              }
            }
          } catch (err) {
            console.error('[CustomTabBar] 触发 app.eventCenter.callbacks 失败:', err)
          }
          
          // 方案2：尝试触发 Taro 的全局事件中心（__taroAppInstance 是 Taro 内部使用的）
          if (!eventTriggered) {
            try {
              const app = getApp()
              if (app && app.__taroAppInstance && app.__taroAppInstance.eventCenter && typeof app.__taroAppInstance.eventCenter.trigger === 'function') {
                app.__taroAppInstance.eventCenter.trigger('showRecordMenu')
                eventTriggered = true
                console.log('[CustomTabBar] 通过 __taroAppInstance.eventCenter 触发事件成功')
              }
            } catch (err) {
              console.error('[CustomTabBar] 触发 __taroAppInstance.eventCenter 失败:', err)
            }
          }
          
          // 方案3：通过页面实例直接调用（如果页面有暴露方法）
          if (!eventTriggered) {
            try {
              const currentPage = pages[pages.length - 1]
              if (currentPage) {
                // 尝试调用页面上的 selectComponent 获取组件并触发方法
                const recordMenuComponent = currentPage.selectComponent && currentPage.selectComponent('.record-menu-trigger')
                if (recordMenuComponent && recordMenuComponent.showMenu) {
                  recordMenuComponent.showMenu()
                  eventTriggered = true
                }
              }
            } catch (err) {
              console.error('[CustomTabBar] 通过页面实例调用失败:', err)
            }
          }
          
          console.log('[CustomTabBar] 已经在首页，事件触发状态:', eventTriggered)
          // 已经在首页，不需要 switchTab，直接返回
          return
        }
        
        // 不在首页，切换到首页
        // storage 标记已设置，首页的 useDidShow 会检测到这个标记
        // 但为了确保可靠性，在 switchTab 完成后也尝试触发事件
        wx.switchTab({ 
          url: '/pages/index/index',
          success: () => {
            // 延迟触发事件，确保首页已经加载完成
            setTimeout(() => {
              let eventTriggered = false
              
              // 方案1：尝试触发 app.eventCenter.callbacks 中注册的方法
              try {
                const app = getApp()
                if (app && app.eventCenter && app.eventCenter.callbacks && typeof app.eventCenter.callbacks['showRecordMenu'] === 'function') {
                  app.eventCenter.callbacks['showRecordMenu']()
                  eventTriggered = true
                  console.log('[CustomTabBar] switchTab success 通过 callbacks 触发成功')
                }
              } catch (err) {
                console.error('[CustomTabBar] switchTab success 触发 callbacks 失败:', err)
              }
              
              // 方案2：尝试触发 Taro 的全局事件中心
              if (!eventTriggered) {
                try {
                  const app = getApp()
                  if (app && app.__taroAppInstance && app.__taroAppInstance.eventCenter && typeof app.__taroAppInstance.eventCenter.trigger === 'function') {
                    app.__taroAppInstance.eventCenter.trigger('showRecordMenu')
                    eventTriggered = true
                    console.log('[CustomTabBar] switchTab success 通过 __taroAppInstance 触发成功')
                  }
                } catch (err) {
                  console.error('[CustomTabBar] switchTab success 触发 __taroAppInstance 失败:', err)
                }
              }
              
              console.log('[CustomTabBar] switchTab success 事件触发状态:', eventTriggered)
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
