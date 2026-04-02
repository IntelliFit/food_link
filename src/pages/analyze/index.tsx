import { View, Text, Image, Textarea } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useState, type CSSProperties } from 'react'
import { Switch } from '@taroify/core'
import { imageToBase64, compressImagePathForUpload, uploadAnalyzeImage, uploadAnalyzeImageFile, submitAnalyzeTask, getAccessToken, MealType, DietGoal, ActivityTiming, getHealthProfile,getMyMembership, MembershipStatus } from '../../utils/api'
import type { ExecutionMode } from '../../utils/api'
import { normalizeAvailableExecutionMode } from '../../utils/execution-mode'

import './index.scss'
import { withAuth } from '../../utils/withAuth'

/** 餐次（分析前选择，AI 将结合餐次分析） */
const MEAL_OPTIONS: Array<{ value: MealType; label: string; iconClass: string }> = [
  { value: 'breakfast', label: '早餐', iconClass: 'icon-zaocan1' },
  { value: 'morning_snack', label: '早加餐', iconClass: 'icon-lingshi' },
  { value: 'lunch', label: '午餐', iconClass: 'icon-wucan' },
  { value: 'afternoon_snack', label: '午加餐', iconClass: 'icon-lingshi' },
  { value: 'dinner', label: '晚餐', iconClass: 'icon-wancan' },
  { value: 'evening_snack', label: '晚加餐', iconClass: 'icon-lingshi' },
]

/** 饮食目标（状态一） */
const DIET_GOAL_OPTIONS: Array<{ value: DietGoal; label: string; iconClass: string }> = [
  { value: 'fat_loss', label: '减脂期', iconClass: 'icon-huore' },
  { value: 'muscle_gain', label: '增肌期', iconClass: 'icon-zengji' },
  { value: 'maintain', label: '维持体重', iconClass: 'icon-tianpingzuo' },
  { value: 'none', label: '无', iconClass: 'icon-nothing' }
]

/** 运动时机（状态二） */
const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string; iconClass: string }> = [
  { value: 'post_workout', label: '练后', iconClass: 'icon-juzhong' },
  { value: 'daily', label: '日常', iconClass: 'icon-duoren' },
  { value: 'before_sleep', label: '睡前', iconClass: 'icon-shuijue' },
  { value: 'none', label: '无', iconClass: 'icon-nothing' }
]

const EXECUTION_MODE_META: Record<ExecutionMode, { title: string; desc: string; tips: string[] }> = {
  strict: {
    title: '精准模式',
    desc: '更适合做分项精估：主体少、边界清楚时更准，复杂整餐会提醒你拆拍。',
    tips: [
      '单个食物最准确，先让主体完整入镜',
      '混合餐最多保留 2-3 个主体，尽量拨开后再拍',
      '菜太多或互相遮挡时，请分开拍；旁边放餐具会更稳'
    ]
  },
  standard: {
    title: '标准模式',
    desc: '更强调记录效率，允许常规估算，适合快速记一餐。',
    tips: [
      '尽量让食物主体完整入镜',
      '复杂菜可在下方补充烹饪信息',
      '多角度拍摄可打开多视角辅助'
    ]
  }
}

const normalizeTmpPath = (path: string): string => {
  const raw = (path || '').trim()
  if (!raw) return ''
  if (/^https?:\/\/tmp\//i.test(raw)) {
    return raw.replace(/^https?:\/\/tmp\//i, 'wxfile://tmp/')
  }
  return raw
}

const isTempImagePath = (path: string): boolean => {
  const raw = (path || '').trim()
  if (!raw) return false
  return /^https?:\/\/tmp\//i.test(raw) || /^wxfile:\/\/tmp\//i.test(raw)
}

const shouldFallbackToLegacyAnalyzeUpload = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || '').toLowerCase()
  return (
    message.includes('http 404') ||
    message.includes('http 405') ||
    message.includes('http 415') ||
    message.includes('not found')
  )
}

/**
 * 选图后立刻将临时图保存到 USER_DATA_PATH，避免微信开发者工具 tmp 路径失效
 */
const persistImagePathIfNeeded = async (path: string): Promise<string> => {
  const raw = (path || '').trim()
  if (!raw) return ''
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return raw
  const normalized = normalizeTmpPath(raw)
  if (!isTempImagePath(raw) && !isTempImagePath(normalized)) return raw

  const userDataPath = (Taro as any)?.env?.USER_DATA_PATH as string | undefined
  if (!userDataPath) return raw

  const candidates: string[] = []
  const pushCandidate = (nextPath?: string) => {
    const next = (nextPath || '').trim()
    if (!next) return
    if (!candidates.includes(next)) {
      candidates.push(next)
    }
  }

  pushCandidate(raw)
  pushCandidate(normalized)

  // devtools 不同版本返回路径格式不一致，尝试通过 getImageInfo 再取一轮可读路径
  for (const src of [raw, normalized]) {
    if (!src) continue
    try {
      const info = await Taro.getImageInfo({ src })
      pushCandidate(info.path)
    } catch {
      // ignore
    }
  }

  for (const tempFilePath of candidates) {
    const ext = (tempFilePath.match(/\.(jpg|jpeg|png|webp|heic|gif)(?:\?.*)?$/i)?.[0] || '.jpg').replace(/\?.*$/, '')
    const targetPath = `${userDataPath}/analyze_${Date.now()}_${Math.floor(Math.random() * 1000000)}${ext}`
    try {
      const savedFilePath = await new Promise<string>((resolve, reject) => {
        Taro.getFileSystemManager().saveFile({
          tempFilePath,
          filePath: targetPath,
          success: (res: any) => resolve(String(res?.savedFilePath || targetPath)),
          fail: reject
        })
      })
      if (savedFilePath) {
        return savedFilePath
      }
      return targetPath
    } catch (err) {
      console.warn('保存临时图片失败，尝试下一个路径:', tempFilePath, err)
    }
  }

  console.warn('临时图片持久化全部失败，回退原路径:', { raw, normalized, candidates })
  return raw
}

const persistImagePathsImmediately = async (paths: string[]): Promise<string[]> => {
  const normalizedPaths = paths.map(path => String(path || '').trim()).filter(Boolean)
  const persistedPaths: string[] = []

  for (const path of normalizedPaths) {
    try {
      const stablePath = await persistImagePathIfNeeded(path)
      persistedPaths.push(stablePath || path)
    } catch (err) {
      console.warn('图片预持久化失败，回退原路径:', path, err)
      persistedPaths.push(path)
    }
  }

  return persistedPaths
}

function AnalyzePage() {
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [additionalInfo, setAdditionalInfo] = useState<string>('')
  const [mealType, setMealType] = useState<MealType>('breakfast')
  const [dietGoal, setDietGoal] = useState<DietGoal>('none')
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [isMultiView, setIsMultiView] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)

  const normalizeExecutionMode = (value: unknown): ExecutionMode => {
    return value === 'strict' ? 'strict' : 'standard'
  }

  const handleMultiViewChange = (value: any) => {
    if (typeof value === 'boolean') {
      setIsMultiView(value)
      return
    }
    if (value && typeof value === 'object' && typeof value.detail?.value === 'boolean') {
      setIsMultiView(value.detail.value)
      return
    }
    setIsMultiView(Boolean(value))
  }

  // 每次进入拍照页都刷新配额（从分析结果页返回时）
  useDidShow(() => {
    if (getAccessToken()) {
      getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
    }
  })

  useEffect(() => {
    // 1. 获取饮食目标
    const initDietGoal = async () => {
      try {
        const cachedGoal = Taro.getStorageSync('dietGoal')
        if (cachedGoal) {
          setDietGoal(cachedGoal as DietGoal)
        }
        // 无论是否有缓存，都尝试从健康档案同步执行模式
        if (getAccessToken()) {
          const profile = await getHealthProfile()
          if (!cachedGoal && profile.diet_goal) {
            setDietGoal(profile.diet_goal as DietGoal)
            Taro.setStorageSync('dietGoal', profile.diet_goal)
          }
          if (profile.execution_mode) {
            setExecutionMode(normalizeExecutionMode(profile.execution_mode))
          }
          // 加载会员状态和配额
          try {
            const ms = await getMyMembership()
            setMembershipStatus(ms)
          } catch (err) {
            console.error('获取会员状态失败:', err)
          }
        }
      } catch (err) {
        console.error('初始化饮食目标失败:', err)
      }
    }
    initDietGoal()

    // 2. 从本地存储获取图片路径 (用于拍照后的跳转)
    const initStoredImagePath = async () => {
      try {
        const storedPath = Taro.getStorageSync('analyzeImagePath')
        if (storedPath) {
          const path = String(storedPath)
          const [stablePath] = await persistImagePathsImmediately([path])
          setImagePaths(stablePath ? [stablePath] : [path])
          // 清除存储，避免下次进入页面时误用
          Taro.removeStorageSync('analyzeImagePath')
        }
      } catch (error) {
        console.error('获取图片路径失败:', error)
      }
    }
    initStoredImagePath()
  }, [])

  const handleChooseImage = async () => {
    const remain = 3 - imagePaths.length
    if (remain <= 0) return
    try {
      // 使用 chooseImage 避免开发者工具返回 http://tmp 的不可读临时路径
      const res = await Taro.chooseImage({
        count: remain,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const rawPaths = (res.tempFilePaths || []).map(p => String(p || '').trim()).filter(Boolean)
      const newPaths = await persistImagePathsImmediately(rawPaths)
      setImagePaths(prev => [...prev, ...newPaths])
    } catch (e) {
      // cancelled
      console.log('选择图片取消/失败', e)
    }
  }

  const handleRemoveImage = (index: number) => {
    setImagePaths(prev => {
      const newPaths = [...prev]
      newPaths.splice(index, 1)
      return newPaths
    })
  }

  const handleDietGoalSelect = (value: DietGoal) => {
    setDietGoal(value)
  }

  const handleActivityTimingSelect = (value: ActivityTiming) => {
    setActivityTiming(value)
  }

  const handleDefaultModeEdit = () => {
    Taro.navigateTo({ url: '/pages/health-profile-edit/index' })
  }

  const handleStrictModeTap = () => {
    if (membershipStatus?.is_pro) {
      setExecutionMode('strict')
      return
    }
    Taro.showModal({
      title: '解锁精准模式',
      content: '精准模式需要开通食探会员才能使用，是否前往开通？',
      confirmText: '去开通',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          Taro.navigateTo({ url: '/pages/pro-membership/index' })
        }
        // 取消：保持标准模式
      }
    })
  }

  const doAnalyze = async () => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录后再使用识别功能', icon: 'none' })
      return
    }
    if (imagePaths.length === 0) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }

    setIsAnalyzing(true)
    Taro.showLoading({ title: '上传图片...', mask: true })

    try {
      // 1. 依次上传所有图片获取 URL
      const imageUrls: string[] = []
      for (const path of imagePaths) {
        const stablePath = await persistImagePathIfNeeded(path)
        const uploadPath = await compressImagePathForUpload(stablePath || path)

        try {
          const { imageUrl } = await uploadAnalyzeImageFile(uploadPath || stablePath || path)
          imageUrls.push(imageUrl)
          continue
        } catch (fileUploadError) {
          if (!shouldFallbackToLegacyAnalyzeUpload(fileUploadError)) {
            throw fileUploadError
          }
          console.warn('文件直传接口暂不可用，回退 base64 上传:', fileUploadError)
        }

        const base64 = await imageToBase64(uploadPath || stablePath || path)
        const { imageUrl } = await uploadAnalyzeImage(base64)
        imageUrls.push(imageUrl)
      }

      const primaryImageUrl = imageUrls[0]

      Taro.showLoading({ title: '提交任务...', mask: true })
      const { task_id } = await submitAnalyzeTask({
        image_url: primaryImageUrl,
        image_urls: imageUrls,
        meal_type: mealType,
        diet_goal: dietGoal,
        activity_timing: activityTiming,
        additionalContext: additionalInfo || undefined,
        modelName: 'gemini',
        is_multi_view: isMultiView,
        execution_mode: executionMode
      })
      Taro.setStorageSync('analyzeExecutionMode', executionMode)
      Taro.hideLoading()
      Taro.redirectTo({ url: `/pages/analyze-loading/index?task_id=${task_id}&execution_mode=${executionMode}` })
    } catch (error: any) {
      Taro.hideLoading()
      setIsAnalyzing(false)
      const errMsg = error?.message || '分析失败，请重试'
      if (error?.statusCode === 429 || errMsg.includes('上限')) {
        Taro.showModal({
          title: '今日次数已用完',
          content: errMsg,
          confirmText: '去开通会员',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) Taro.navigateTo({ url: '/pages/pro-membership/index' })
          }
        })
      } else {
        Taro.showModal({
          title: '分析失败',
          content: errMsg,
          showCancel: false,
          confirmText: '确定'
        })
      }
    }
  }

  const handleConfirm = () => {
    if (imagePaths.length === 0) {
      handleChooseImage() // 如果没图片，点击确认直接触发选择
      return
    }
    Taro.showModal({
      title: '确认分析',
      content: `确定开始分析这 ${imagePaths.length} 张图片吗？`,
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) doAnalyze()
      }
    })
  }

  const handleVoiceInput = () => {
    Taro.showToast({
      title: '语音输入功能',
      icon: 'none'
    })
  }

  const handlePreviewImage = (current: string) => {
    const urls = imagePaths
    Taro.previewImage({
      current,
      urls
    })
  }

  return (
    <View className='analyze-page'>
      {/* 今日配额提示条 */}
      {membershipStatus && (
        <View
          className={`quota-bar ${membershipStatus.is_pro ? 'quota-bar--pro' : (membershipStatus.daily_remaining ?? 3) <= 1 ? 'quota-bar--warn' : ''}`}
          onClick={() => !membershipStatus.is_pro && Taro.navigateTo({ url: '/pages/pro-membership/index' })}
        >
          <Text className='quota-bar-text'>
            {membershipStatus.is_pro ? '🥇 ' : ''}今日剩余 {membershipStatus.daily_remaining ?? '--'}/{membershipStatus.daily_limit ?? '--'} 次
            {!membershipStatus.is_pro && '  →开通会员每日20次'}
          </Text>
        </View>
      )}

      {/* 模式提示条 */}
      <View className={`mode-banner ${executionMode}`}>
        <View className='mode-banner-header'>
          <View className='mode-title-wrap'>
            <Text className='mode-title'>当前模式：{EXECUTION_MODE_META[executionMode].title}</Text>
            <Text className='mode-sub'>影响本次执行规则</Text>
          </View>
          <Text className='mode-link' onClick={handleDefaultModeEdit}>设为默认</Text>
        </View>

        <View className='mode-switch-row'>
          <View
            className={`mode-switch-item ${executionMode === 'strict' ? 'active' : ''}`}
            onClick={handleStrictModeTap}
          >
            精准
          </View>
          <View
            className={`mode-switch-item ${executionMode === 'standard' ? 'active' : ''}`}
            onClick={() => setExecutionMode('standard')}
          >
            标准
          </View>
        </View>

        <Text className='mode-desc'>{EXECUTION_MODE_META[executionMode].desc}</Text>
        <View className='mode-tips'>
          {EXECUTION_MODE_META[executionMode].tips.map((tip, idx) => (
            <View key={idx} className='mode-tip-item'>
              <Text className='mode-tip-dot'>•</Text>
              <Text className='mode-tip-text'>{tip}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 图片预览区域 (Grid) */}
      <View className='image-preview-section'>
        {imagePaths.length > 0 ? (
          <View className='image-grid'>
            {imagePaths.map((path, index) => (
              <View key={index} className='grid-item'>
                <Image
                  src={path}
                  mode='aspectFill'
                  className='grid-image'
                  onClick={() => handlePreviewImage(path)}
                />
                <View className='remove-btn' onClick={(e) => {
                  e.stopPropagation()
                  handleRemoveImage(index)
                }}>
                  <Text className='close-icon'>×</Text>
                </View>
              </View>
            ))}
            {imagePaths.length < 3 && (
              <View className='grid-item add-btn' onClick={handleChooseImage}>
                <Text className='add-icon'>+</Text>
                <Text className='add-text'>添加</Text>
              </View>
            )}
          </View>
        ) : (
          <View className='no-image-placeholder' onClick={handleChooseImage}>
            <View className='placeholder-content'>
              <Text className='iconfont icon-xiangji' style={{ fontSize: '64rpx', color: '#9ca3af', marginBottom: '16rpx' }} />
              <Text className='placeholder-text'>点击拍摄/上传食物</Text>
              <Text className='placeholder-sub'>支持多图 (最多3张)</Text>
            </View>
          </View>
        )}

        {/* 多视角辅助模式：作为图片区域的底部小条 */}
        <View className='multiview-compact'>
          <View className='multiview-compact-left'>
            <Text className='multiview-compact-title'>多视角辅助</Text>
            <Text className='multiview-compact-hint'>将多张图片视为同一食物的不同角度</Text>
          </View>
          <Switch
            className='compact-switch'
            checked={isMultiView}
            onChange={handleMultiViewChange}
            style={{ '--switch-checked-background-color': '#00bc7d' } as CSSProperties}
          />
        </View>
      </View>

      {/* 文字补充区域（放在照片下方，拍完再补充上下文） */}
      <View className='details-section'>
        <View className='section-header'>
          <Text className='section-title'>文字补充</Text>
        </View>
        <Text className='section-hint'>
          提供更多上下文能显著提高识别准确率，例如分量、容器大小、额外配料等。
        </Text>

        <View className='input-wrapper'>
          <Textarea
            className='details-input'
            placeholder='例如：这是学校食堂的大份，额外加了辣油，用的是 500ml 便当盒...'
            placeholderClass='input-placeholder'
            value={additionalInfo}
            onInput={(e) => setAdditionalInfo(e.detail.value)}
            maxlength={200}
            autoHeight
            showConfirmBar={false}
          />
          <View className='voice-btn' onClick={handleVoiceInput}>
            <Text className='voice-icon iconfont icon--yuyinshuruzhong' />
          </View>
        </View>
      </View>

      {/* 餐次（AI 将结合餐次分析） */}
      <View className='meal-section'>
        <View className='section-header'>
          <Text className='section-title'>餐次</Text>
        </View>
        <Text className='section-hint'>
          选择本餐次，AI 将结合场景给出建议。
        </Text>
        <View className='meal-options'>
          {MEAL_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`meal-option ${mealType === opt.value ? 'active' : ''}`}
              onClick={() => setMealType(opt.value)}
            >
              <Text className={`meal-icon iconfont ${opt.iconClass}`} />
              <Text className='meal-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>


      {/* 饮食目标（状态一） */}
      <View className='state-section'>
        <View className='section-header'>

          <Text className='section-title'>饮食目标</Text>
        </View>
        <Text className='section-hint'>
          选择您的饮食目标，AI 将结合目标给出更贴合的建议。
        </Text>
        <View className='state-options'>
          {DIET_GOAL_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`state-option ${dietGoal === opt.value ? 'active' : ''}`}
              onClick={() => handleDietGoalSelect(opt.value)}
            >
              <Text className={`state-icon iconfont ${opt.iconClass}`} />
              <Text className='state-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 运动时机（状态二） */}
      <View className='state-section'>
        <View className='section-header'>

          <Text className='section-title'>运动时机</Text>
        </View>
        <Text className='section-hint'>
          选择进食时机，AI 将结合时机给出针对性建议（如运动后补充蛋白、睡前避免碳水等）。
        </Text>
        <View className='state-options'>
          {ACTIVITY_TIMING_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`state-option ${activityTiming === opt.value ? 'active' : ''}`}
              onClick={() => handleActivityTimingSelect(opt.value)}
            >
              <Text className={`state-icon iconfont ${opt.iconClass}`} />
              <Text className='state-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 确认按钮 */}
      <View className='confirm-section'>
        <View
          className={`confirm-btn ${imagePaths.length === 0 || isAnalyzing ? 'disabled' : ''}`}
          onClick={!isAnalyzing ? handleConfirm : undefined}
        >
          <Text className='confirm-btn-text'>
            {isAnalyzing ? '提交中...' : (imagePaths.length === 0 ? '请先拍照' : `分析 ${imagePaths.length} 张图片`)}
          </Text>
        </View>
        <View
          className='history-link'
          onClick={() => Taro.navigateTo({ url: '/pages/analyze-history/index' })}
        >
          <Text className='history-link-text'>查看分析历史</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(AnalyzePage)
