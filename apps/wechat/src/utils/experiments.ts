import Taro from '@tarojs/taro'
import { publicRequest } from './api'
import { createExperimentClient } from './experiment-client'

declare const __APP_VERSION__: string

/**
 * 全局 A/B 实验客户端。启动时 refresh() 拉分组，登录后再 refresh() 一次把匿名分组绑到账号；
 * 页面用 useExperiment 读分组，用 experiments.track 上报后端看不到的漏斗事件。
 * 拉取失败或超时一律按各实验的对照组渲染。
 */
export const experiments = createExperimentClient({
  request: (path, body, timeoutMs) => publicRequest(path, { method: 'POST', data: body, timeout: timeoutMs }),
  storage: {
    get: (key) => Taro.getStorageSync(key),
    set: (key, value) => Taro.setStorageSync(key, value),
  },
  platform: () => Taro.getSystemInfoSync?.()?.platform || '',
  appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
})
