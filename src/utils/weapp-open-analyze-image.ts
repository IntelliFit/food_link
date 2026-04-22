import Taro from '@tarojs/taro'
import { getAccessToken, getMyMembership } from './api'
import { redirectToLogin } from './withAuth'
import { extraPkgUrl } from './subpackage-extra'

function showFoodAnalysisQuotaModalLikeRecordMenu(ms: Awaited<ReturnType<typeof getMyMembership>>): void {
  if (typeof ms.points_balance === 'number') {
    Taro.showModal({
      title: '积分不足',
      content: '标准分析需至少 1 积分，请先充值。',
      confirmText: '去充值',
      cancelText: '取消',
      success: (r) => {
        if (r.confirm) Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
      }
    })
    return
  }
  const isPro = ms.is_pro
  Taro.showModal({
    title: '今日次数已用完',
    content: isPro
      ? `今日 ${ms.daily_limit ?? 30} 次拍照已用完，请明日再试。`
      : `免费版每日限 ${ms.daily_limit ?? 30} 次，开通食探会员可享更高额度与精准模式等功能。`,
    confirmText: isPro ? '知道了' : '去开通',
    cancelText: '取消',
    showCancel: !isPro,
    success: (r) => {
      if (!isPro && r.confirm) {
        Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
      }
    }
  })
}

/**
 * 会员/次数校验后，选图并进入分析页（首页记录菜单、分包记录菜单共用）。
 */
export async function pickImageAndOpenAnalyze(sourceType: Array<'album' | 'camera'>): Promise<void> {
  if (!getAccessToken()) {
    redirectToLogin()
    return
  }
  try {
    const membershipStatus = await getMyMembership()
    if (typeof membershipStatus.points_balance === 'number') {
      if (membershipStatus.points_balance < 1) {
        showFoodAnalysisQuotaModalLikeRecordMenu(membershipStatus)
        return
      }
    } else if (membershipStatus.daily_remaining !== null && membershipStatus.daily_remaining <= 0) {
      showFoodAnalysisQuotaModalLikeRecordMenu(membershipStatus)
      return
    }
  } catch {
    /* 会员接口失败时仍允许选图，由分析提交接口提示 */
  }

  Taro.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType,
    success: (res) => {
      const imagePath = res.tempFilePaths[0]
      Taro.setStorageSync('analyzeImagePath', imagePath)
      Taro.navigateTo({ url: extraPkgUrl('/pages/analyze/index') })
    },
    fail: (err) => {
      if (err.errMsg?.includes('cancel')) return
      const raw = err.errMsg || ''
      const msg = raw.toLowerCase()
      /** 避免宽泛匹配 permission（部分机型错误文案含该词但并非用户关权限） */
      const cameraAuthLike =
        sourceType.includes('camera') &&
        (msg.includes('auth deny') ||
          msg.includes('auth denied') ||
          msg.includes('authorize') ||
          msg.includes('no permission') ||
          (msg.includes('permission') && (msg.includes('camera') || msg.includes('scope'))) ||
          raw.includes('用户拒绝') ||
          raw.includes('不允许使用摄像头'))
      if (cameraAuthLike) {
        Taro.showModal({
          title: '需要相机权限',
          content: '请在微信小程序设置中允许使用摄像头；若已开启仍失败，可先使用「相册上传」。',
          confirmText: '去设置',
          cancelText: '取消',
          success: (r) => {
            if (r.confirm) Taro.openSetting()
          }
        })
        return
      }
      Taro.showToast({
        title: sourceType.includes('camera') ? '无法打开相机，请重试' : '选择图片失败',
        icon: 'none'
      })
    }
  })
}
