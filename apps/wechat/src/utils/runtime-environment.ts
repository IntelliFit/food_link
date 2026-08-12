export function isDevelopmentRuntime(): boolean {
  try {
    return __ENABLE_DEV_DEBUG_UI__
  } catch {
    return process.env.NODE_ENV === 'development'
  }
}
