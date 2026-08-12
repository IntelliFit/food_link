import Taro from '@tarojs/taro'

type MiniProgramEnvVersion = 'develop' | 'trial' | 'release'

function readInjectedString(getter: () => string, fallback = ''): string {
  try {
    const value = getter()
    return typeof value === 'string' ? value.trim() : fallback
  } catch {
    return fallback
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function isSafeProductionOverride(url: string): boolean {
  const normalized = normalizeBaseUrl(url.trim())
  if (!/^https:\/\//i.test(normalized)) {
    return false
  }
  return !/^https:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::|\/|$)/i.test(normalized)
}

function readMiniProgramEnvVersion(): MiniProgramEnvVersion | undefined {
  try {
    const envVersion = Taro.getAccountInfoSync?.()?.miniProgram?.envVersion
    if (envVersion === 'develop' || envVersion === 'trial' || envVersion === 'release') {
      return envVersion
    }
  } catch {
    // 非小程序运行时（单测等）忽略
  }
  return undefined
}

/**
 * 按微信 miniProgram.envVersion 选择 API 根地址。
 * 各环境 URL 由构建配置注入，不在业务代码中写死域名。
 */
export function resolveApiBaseUrl(): string {
  const runtimeEnv = readInjectedString(
    () => __RUNTIME_ENV__,
    process.env.NODE_ENV === 'production' ? 'production' : 'development'
  )
  const isProductionRuntime = runtimeEnv === 'production'
  const override = readInjectedString(() => __API_BASE_URL_OVERRIDE__, '')
  if (override && (!isProductionRuntime || isSafeProductionOverride(override))) {
    return normalizeBaseUrl(override)
  }

  const releaseUrl = readInjectedString(() => __API_BASE_URL_RELEASE__, '')
  const trialUrl = readInjectedString(() => __API_BASE_URL_TRIAL__, '')
  const developUrl = readInjectedString(() => __API_BASE_URL_DEVELOP__, '')

  const envVersion = readMiniProgramEnvVersion()
  if (envVersion === 'release' && releaseUrl) {
    return normalizeBaseUrl(releaseUrl)
  }
  if (envVersion === 'trial' && trialUrl) {
    return normalizeBaseUrl(trialUrl)
  }
  if (envVersion === 'develop') {
    // 微信官方默认以 develop 身份运行审核中版本。production 上传包必须走
    // 审核可达的正式 API；仅 development 构建允许 develop 使用本机地址。
    if (isProductionRuntime) {
      if (releaseUrl) {
        return normalizeBaseUrl(releaseUrl)
      }
      if (trialUrl) {
        return normalizeBaseUrl(trialUrl)
      }
    } else if (developUrl) {
      return normalizeBaseUrl(developUrl)
    }
  }

  // envVersion 不可用时：production 优先正式 API，development 优先本地 API。
  if (isProductionRuntime && releaseUrl) {
    return normalizeBaseUrl(releaseUrl)
  }
  if (!isProductionRuntime && developUrl) {
    return normalizeBaseUrl(developUrl)
  }
  if (trialUrl) {
    return normalizeBaseUrl(trialUrl)
  }
  if (releaseUrl) {
    return normalizeBaseUrl(releaseUrl)
  }
  if (developUrl) {
    return normalizeBaseUrl(developUrl)
  }

  return ''
}
