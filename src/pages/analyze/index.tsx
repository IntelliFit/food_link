import { View, Text, Image, Textarea } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useState, useRef } from 'react'
import {
  imageToBase64,
  compressImagePathForUpload,
  uploadAnalyzeImage,
  uploadAnalyzeImageFile,
  submitAnalyzeTask,
  continuePrecisionSession,
  getAccessToken,
  MealType,
  DietGoal,
  ActivityTiming,
  getHealthProfile,
  getMyMembership,
  MembershipStatus
} from '../../utils/api'
import type { AnalyzeResponse, ExecutionMode, PrecisionReferenceObjectInput } from '../../utils/api'
import {
  canUseStrictModeForMembership,
  getStrictModeLockedHint,
  getStrictModeUpgradeUrl,
  normalizeAvailableExecutionMode,
  promptStrictModeUpgrade,
} from '../../utils/execution-mode'
import { inferDefaultMealTypeFromLocalTime } from '../../utils/infer-default-meal-type'
import {
  getFoodAnalysisBlockedActionText,
  getFoodAnalysisCreditBlockMessage,
  getMembershipCreditSummary,
  isFoodAnalysisCreditExhausted,
} from '../../utils/membership'
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

const REFERENCE_PRESETS: Array<{
  value: string
  label: string
  dimensions: { length?: number; width?: number; height?: number }
}> = [
  { value: 'chopsticks', label: '筷子', dimensions: { length: 240, width: 7, height: 7 } },
  { value: 'spoon', label: '勺子', dimensions: { length: 170, width: 40, height: 15 } },
  { value: 'bank_card', label: '银行卡', dimensions: { length: 85.6, width: 54, height: 0.8 } },
  { value: 'can', label: '易拉罐', dimensions: { height: 122, width: 66, length: 66 } },
  { value: 'bottle', label: '瓶装水', dimensions: { height: 210, width: 65, length: 65 } },
  { value: 'plate', label: '常见餐盘', dimensions: { length: 220, width: 220, height: 25 } },
  { value: 'custom', label: '自定义', dimensions: {} }
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
  const [mealType, setMealType] = useState<MealType>(() => inferDefaultMealTypeFromLocalTime())
  const [dietGoal, setDietGoal] = useState<DietGoal>('none')
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [isMultiView, setIsMultiView] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [precisionSessionId, setPrecisionSessionId] = useState('')
  const [referencePreset, setReferencePreset] = useState('chopsticks')
  const [referenceName, setReferenceName] = useState('筷子')
  const [referenceLength, setReferenceLength] = useState('240')
  const [referenceWidth, setReferenceWidth] = useState('7')
  const [referenceHeight, setReferenceHeight] = useState('7')
  const [referencePlacementNote, setReferencePlacementNote] = useState('')

  const imagePathsRef = useRef<string[]>([])
  imagePathsRef.current = imagePaths

  const canUseStrictMode = canUseStrictModeForMembership(membershipStatus)
  const { hasInfo: hasCreditsInfo, max: creditsMax, used: creditsUsed, remaining: creditsRemaining } =
    getMembershipCreditSummary(membershipStatus)
  const precisionUpgradeUrl = getStrictModeUpgradeUrl(membershipStatus)
  const precisionUpgradeHint = canUseStrictMode ? '' : getStrictModeLockedHint(membershipStatus)

  const showMultiViewRequiredModal = () => {
    Taro.showModal({
      title: '请先开启多视角模式',
      content: '未开启多视角模式时仅支持上传 1 张图片。若要拍同一份食物的多个视角，请先开启多视角模式。',
      showCancel: false,
      confirmText: '我知道了'
    })
  }

  const isQuotaExhausted = isFoodAnalysisCreditExhausted(membershipStatus)

  useEffect(() => {
    if (!membershipStatus) return
    if (executionMode === 'strict' && !canUseStrictMode && !precisionSessionId) {
      setExecutionMode('standard')
    }
  }, [membershipStatus, executionMode, canUseStrictMode, precisionSessionId])

  /** 多视角开关：纯 View 实现，避免任意 Switch 组件在分包内触发 react 未定义 */
  const handleMultiViewSwitchChange = (e: { detail?: { value?: boolean } }) => {
    const nextValue = e.detail?.value === true
    if (!nextValue && imagePaths.length > 1) {
      showMultiViewRequiredModal()
      return
    }
    setIsMultiView(nextValue)
  }

  const toggleMultiView = () => {
    handleMultiViewSwitchChange({ detail: { value: !isMultiView } })
  }

  // 每次进入拍照页都刷新配额（从分析结果页返回时）；无图时按当前时间刷新默认餐次
  useDidShow(() => {
    if (getAccessToken()) {
      getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
    }
    if (imagePathsRef.current.length === 0) {
      setMealType(inferDefaultMealTypeFromLocalTime())
    }
  })

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextSessionId = String(params?.precision_session_id || '').trim()
    if (nextSessionId) {
      setPrecisionSessionId(nextSessionId)
      setExecutionMode('strict')
    }

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
          if (!nextSessionId && profile.execution_mode) {
            setExecutionMode(normalizeAvailableExecutionMode(profile.execution_mode))
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
          const finalPath = stablePath || path
          setImagePaths([finalPath])
          // 与提交分析时写入的 analyzeImagePaths 一致，避免仅单 key 时多图逻辑异常
          Taro.setStorageSync('analyzeImagePaths', [finalPath])
          // 清除存储，避免下次进入页面时误用
          Taro.removeStorageSync('analyzeImagePath')
        }
      } catch (error) {
        console.error('获取图片路径失败:', error)
      }
    }
    initStoredImagePath()
  }, [])

  const handleReferencePresetSelect = (value: string) => {
    setReferencePreset(value)
    const target = REFERENCE_PRESETS.find(item => item.value === value)
    if (!target) return
    setReferenceName(target.label)
    setReferenceLength(target.dimensions.length != null ? String(target.dimensions.length) : '')
    setReferenceWidth(target.dimensions.width != null ? String(target.dimensions.width) : '')
    setReferenceHeight(target.dimensions.height != null ? String(target.dimensions.height) : '')
  }

  const buildReferenceObjects = (): PrecisionReferenceObjectInput[] => {
    if (executionMode !== 'strict') return []
    const name = referenceName.trim()
    if (!name) return []
    const length = Number(referenceLength)
    const width = Number(referenceWidth)
    const height = Number(referenceHeight)
    return [{
      reference_type: referencePreset === 'custom' ? 'custom' : 'preset',
      reference_name: name,
      dimensions_mm: {
        ...(Number.isFinite(length) && length > 0 ? { length } : {}),
        ...(Number.isFinite(width) && width > 0 ? { width } : {}),
        ...(Number.isFinite(height) && height > 0 ? { height } : {}),
      },
      placement_note: referencePlacementNote.trim() || undefined,
    }]
  }

  const handleChooseImage = async () => {
    if (!isMultiView && imagePaths.length >= 1) {
      showMultiViewRequiredModal()
      return
    }

    const remain = 3 - imagePaths.length
    if (remain <= 0) return
    try {
      // 使用 chooseImage 避免开发者工具返回 http://tmp 的不可读临时路径
      const res = await Taro.chooseImage({
        count: isMultiView ? remain : 1,
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
    if (canUseStrictMode) {
      setExecutionMode('strict')
      return
    }
    promptStrictModeUpgrade({
      membershipStatus,
      source: 'precision_upgrade',
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
    if (!isMultiView && imagePaths.length > 1) {
      showMultiViewRequiredModal()
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
      const referenceObjects = buildReferenceObjects()

      Taro.showLoading({ title: '提交任务...', mask: true })
      const commonPayload = {
        meal_type: mealType,
        diet_goal: dietGoal,
        activity_timing: activityTiming,
        additionalContext: additionalInfo || undefined,
        is_multi_view: isMultiView,
        reference_objects: referenceObjects.length > 0 ? referenceObjects : undefined,
      }
      const response = precisionSessionId
        ? await continuePrecisionSession(precisionSessionId, {
            source_type: 'image',
            image_url: primaryImageUrl,
            image_urls: imageUrls,
            ...commonPayload,
          })
        : await submitAnalyzeTask({
            image_url: primaryImageUrl,
            image_urls: imageUrls,
            modelName: 'gemini',
            execution_mode: executionMode,
            ...commonPayload,
          })
      const task_id = String(
        (response as { task_id?: string; taskId?: string }).task_id
          ?? (response as { task_id?: string; taskId?: string }).taskId
          ?? ''
      ).trim()
      if (!task_id) {
        throw new Error('服务器未返回任务编号，请稍后重试')
      }
      Taro.setStorageSync('analyzeMealType', mealType)
      Taro.setStorageSync('analyzeDietGoal', dietGoal)
      Taro.setStorageSync('analyzeActivityTiming', activityTiming)
      Taro.setStorageSync('analyzeTaskType', 'food')
      Taro.setStorageSync('analyzeExecutionMode', executionMode)
      // 进入 analyze 页时 initStoredImagePath 会 remove 掉 analyzeImage*，这里必须把当前预览图写回，
      // analyze-loading 才能用本地路径做全屏背景与取景框前景（与文字链路的占位图区分）
      if (imagePaths.length > 0) {
        Taro.setStorageSync('analyzeImagePath', imagePaths[0])
        Taro.setStorageSync('analyzeImagePaths', imagePaths)
      }
      Taro.hideLoading()
      setIsAnalyzing(false)
      const q = `task_id=${encodeURIComponent(task_id)}&execution_mode=${encodeURIComponent(executionMode)}&task_type=food`
      Taro.redirectTo({
        url: `/pages/analyze-loading/index?${q}`
      })
    } catch (error: any) {
      Taro.hideLoading()
      setIsAnalyzing(false)
      const statusCode = (error as { statusCode?: number })?.statusCode
      const errMsg = error?.message || '分析失败，请重试'
      const isQuotaExhausted =
        statusCode === 402 ||
        statusCode === 429 ||
        errMsg.includes('上限') ||
        errMsg.includes('已达上限') ||
        errMsg.includes('次数已达') ||
        errMsg.includes('明日再试') ||
        errMsg.includes('积分不足')
      if (isQuotaExhausted) {
        const suggestPro = errMsg.includes('开通') || errMsg.includes('会员') || errMsg.includes('升级')
        const confirmText = suggestPro ? getFoodAnalysisBlockedActionText(membershipStatus) : '知道了'
        Taro.showModal({
          title: '积分不足',
          content: errMsg,
          confirmText,
          cancelText: '取消',
          showCancel: suggestPro,
          success: (res) => {
            if (suggestPro && res.confirm) Taro.navigateTo({ url: '/pages/pro-membership/index' })
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

  /** 主按钮：无图则唤起选图；有图则直接提交并进入 analyze-loading（与拍照后进页再分析一致） */
  const handleAnalyzePress = () => {
    if (isAnalyzing) return
    if (isQuotaExhausted) {
      const content = getFoodAnalysisCreditBlockMessage(membershipStatus)
      const confirmText = getFoodAnalysisBlockedActionText(membershipStatus)
      const showUpgrade = content.includes('开通') || content.includes('升级') || membershipStatus?.is_pro
      Taro.showModal({
        title: '积分不足',
        content,
        showCancel: showUpgrade,
        confirmText: showUpgrade ? confirmText : '知道了',
        cancelText: '取消',
        success: (res) => {
          if (showUpgrade && res.confirm) {
            Taro.navigateTo({ url: '/pages/pro-membership/index' })
          }
        }
      })
      return
    }
    if (imagePaths.length === 0) {
      void handleChooseImage()
      return
    }
    void doAnalyze()
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
      {/* 提示：长按页面任意位置可启用开发者模式 */}
      {/* 今日配额提示条 */}
      {membershipStatus && (
        <View
          className={`quota-bar ${isQuotaExhausted ? 'quota-bar--exhausted' : ''} ${membershipStatus.is_pro ? 'quota-bar--pro' : ''} ${!isQuotaExhausted && hasCreditsInfo && creditsRemaining <= 2 ? 'quota-bar--warn' : ''}`}
          onClick={() => {
            if (isQuotaExhausted) return
            if (!canUseStrictMode) Taro.navigateTo({ url: precisionUpgradeUrl })
          }}
        >
          <Text className='quota-bar-text'>
            {isQuotaExhausted
              ? getFoodAnalysisCreditBlockMessage(membershipStatus)
              : hasCreditsInfo
                ? `今日已用 ${creditsUsed}/${creditsMax} 积分 · 剩余 ${creditsRemaining}${precisionUpgradeHint ? `  →${precisionUpgradeHint}` : ''}`
                : `今日积分信息加载中${precisionUpgradeHint ? `  →${precisionUpgradeHint}` : ''}`}
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
            className={`mode-switch-item ${executionMode === 'strict' ? 'active' : ''} ${!canUseStrictMode ? 'locked' : ''}`}
            onClick={handleStrictModeTap}
          >
            {membershipStatus?.is_pro && !canUseStrictMode ? '精准（需升级）' : '精准'}
          </View>
          <View
            className={`mode-switch-item ${executionMode === 'standard' ? 'active' : ''}`}
            onClick={() => setExecutionMode('standard')}
          >
            标准
          </View>
        </View>

        {!!precisionUpgradeHint && executionMode !== 'strict' && (
          <Text className='mode-upgrade-note'>{precisionUpgradeHint}</Text>
        )}

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
                }}
                >
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
              <Text className='placeholder-sub'>未开启多视角时仅支持 1 张，开启后最多 3 张</Text>
            </View>
          </View>
        )}

        {/* 多视角辅助模式：作为图片区域的底部小条 */}
        <View className='multiview-compact'>
          <View className='multiview-compact-left'>
            <Text className='multiview-compact-title'>多视角辅助</Text>
            <Text className='multiview-compact-hint'>开启后才可上传多张，并按同一食物的不同角度处理</Text>
          </View>
          <View
            className={`multiview-toggle ${isMultiView ? 'multiview-toggle--on' : ''}`}
            onClick={toggleMultiView}
          >
            <View className='multiview-toggle-knob' />
          </View>
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

      {executionMode === 'strict' && (
        <View className='details-section'>
          <View className='section-header'>
            <Text className='section-title'>参考物</Text>
          </View>
          <Text className='section-hint'>
            精准模式下可录入一个参考物和尺寸，系统会在需要时把它当作比例尺参与估重。
          </Text>

          {precisionSessionId ? (
            <View className='precision-session-tip'>
              <Text className='precision-session-tip-text'>当前正在继续上一轮精准估计，本次拍照会接到原会话继续判断。</Text>
            </View>
          ) : null}

          <View className='state-options'>
            {REFERENCE_PRESETS.map((preset) => (
              <View
                key={preset.value}
                className={`state-option ${referencePreset === preset.value ? 'active' : ''}`}
                onClick={() => handleReferencePresetSelect(preset.value)}
              >
                <Text className='state-label'>{preset.label}</Text>
              </View>
            ))}
          </View>

          <View className='precision-reference-grid'>
            <View className='precision-reference-field'>
              <Text className='precision-reference-label'>名称</Text>
              <Textarea
                className='details-input precision-reference-input'
                value={referenceName}
                onInput={(e) => setReferenceName(e.detail.value)}
                maxlength={30}
                autoHeight
                showConfirmBar={false}
              />
            </View>
            <View className='precision-reference-row'>
              <View className='precision-reference-field short'>
                <Text className='precision-reference-label'>长(mm)</Text>
                <Textarea
                  className='details-input precision-reference-input'
                  value={referenceLength}
                  onInput={(e) => setReferenceLength(e.detail.value)}
                  maxlength={8}
                  autoHeight
                  showConfirmBar={false}
                />
              </View>
              <View className='precision-reference-field short'>
                <Text className='precision-reference-label'>宽(mm)</Text>
                <Textarea
                  className='details-input precision-reference-input'
                  value={referenceWidth}
                  onInput={(e) => setReferenceWidth(e.detail.value)}
                  maxlength={8}
                  autoHeight
                  showConfirmBar={false}
                />
              </View>
              <View className='precision-reference-field short'>
                <Text className='precision-reference-label'>高(mm)</Text>
                <Textarea
                  className='details-input precision-reference-input'
                  value={referenceHeight}
                  onInput={(e) => setReferenceHeight(e.detail.value)}
                  maxlength={8}
                  autoHeight
                  showConfirmBar={false}
                />
              </View>
            </View>
            <View className='precision-reference-field'>
              <Text className='precision-reference-label'>摆放说明</Text>
              <Textarea
                className='details-input precision-reference-input'
                placeholder='例如：和米饭在同一平面，放在盘子右下角'
                placeholderClass='input-placeholder'
                value={referencePlacementNote}
                onInput={(e) => setReferencePlacementNote(e.detail.value)}
                maxlength={80}
                autoHeight
                showConfirmBar={false}
              />
            </View>
          </View>
        </View>
      )}

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
          className={`confirm-btn ${imagePaths.length === 0 || isAnalyzing || isQuotaExhausted ? 'disabled' : ''}`}
          onClick={handleAnalyzePress}
        >
          {isAnalyzing ? (
            <View className='btn-spinner' />
          ) : (
            <Text className='confirm-btn-text'>
              {isQuotaExhausted
                ? '积分不足，暂不可分析'
                : imagePaths.length === 0
                  ? '请先拍照或选图'
                  : `分析 ${imagePaths.length} 张图片`}
            </Text>
          )}
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
