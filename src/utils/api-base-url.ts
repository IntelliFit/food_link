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
 * 各环境 URL 由构建时从 .env 注入，不在代码中写死域名。
 */
export function resolveApiBaseUrl(): string {
  const override = readInjectedString(() => __API_BASE_URL_OVERRIDE__, '')
  if (override) {
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
  if (envVersion === 'develop' && developUrl) {
    return normalizeBaseUrl(developUrl)
  }

  // envVersion 不可用时（单测等）：开发构建优先本地，否则按 trial → release → develop
  if (process.env.NODE_ENV === 'development' && developUrl) {
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
