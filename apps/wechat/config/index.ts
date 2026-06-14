import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import { createStyleImportPlugin } from 'vite-plugin-style-import'

import devConfig from './dev'
import prodConfig from './prod'

const appRoot = process.cwd()
const workspaceRoot = join(appRoot, '..', '..')

/** 与 package.json 的 version 一致，供「我的」页底部等展示 */
function readPackageVersion(): string {
  const pkgPath = join(workspaceRoot, 'package.json')
  return JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string
}

const packageVersion = readPackageVersion()

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}

  const values: Record<string, string> = {}
  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed
    const equalsIndex = normalized.indexOf('=')
    if (equalsIndex <= 0) continue

    const key = normalized.slice(0, equalsIndex).trim()
    let value = normalized.slice(equalsIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function loadTaroEnv(): void {
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  const merged = {
    ...parseEnvFile(join(workspaceRoot, '.env')),
    ...parseEnvFile(join(workspaceRoot, `.env.${mode}`)),
    ...parseEnvFile(join(appRoot, '.env')),
    ...parseEnvFile(join(appRoot, `.env.${mode}`)),
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] == null) {
      process.env[key] = value
    }
  }
}

loadTaroEnv()

// fix: @taroify/icons 字体文件 base64 内联，避免小程序环境中路径解析失败
const vantIconWoff2Base64 = readFileSync(join(appRoot, 'src/assets/vant-icon/vant-icon.woff2')).toString('base64')
const vantIconWoffBase64 = readFileSync(join(appRoot, 'src/assets/vant-icon/vant-icon.woff')).toString('base64')

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'vite'>(async (merge) => {
  const apiBaseUrlRelease = process.env.TARO_APP_API_BASE_URL_RELEASE || ''
  const apiBaseUrlTrial = process.env.TARO_APP_API_BASE_URL_TRIAL || ''
  const apiBaseUrlDevelop = process.env.TARO_APP_API_BASE_URL_DEVELOP || ''
  const apiBaseUrlOverride =
    process.env.TARO_APP_API_BASE_URL_OVERRIDE ||
    process.env.TARO_APP_API_BASE_URL ||
    ''
  const expirySubscribeTemplateId = process.env.TARO_APP_EXPIRY_SUBSCRIBE_TEMPLATE_ID || ''
  const iconCdnBaseUrl = process.env.TARO_APP_ICON_CDN_BASE_URL || ''
  const foodImagesCdnBaseUrl = process.env.TARO_APP_FOOD_IMAGES_CDN_BASE_URL || ''
  const recentRequestTraceLimit = process.env.TARO_APP_RECENT_REQUEST_TRACE_LIMIT || '50'
  const consoleLogBufferLimit = process.env.TARO_APP_CONSOLE_LOG_BUFFER_LIMIT || '80'

  const baseConfig: UserConfigExport<'vite'> = {
    projectName: 'food_link',
    date: '2026-1-23',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [
      "@tarojs/plugin-generator"
    ],
    defineConstants: {
      __API_BASE_URL_RELEASE__: JSON.stringify(apiBaseUrlRelease),
      __API_BASE_URL_TRIAL__: JSON.stringify(apiBaseUrlTrial),
      __API_BASE_URL_DEVELOP__: JSON.stringify(apiBaseUrlDevelop),
      __API_BASE_URL_OVERRIDE__: JSON.stringify(apiBaseUrlOverride),
      __ICON_CDN_BASE_URL__: JSON.stringify(iconCdnBaseUrl),
      __FOOD_IMAGES_CDN_BASE_URL__: JSON.stringify(foodImagesCdnBaseUrl),
      __EXPIRY_SUBSCRIBE_TEMPLATE_ID__: JSON.stringify(expirySubscribeTemplateId),
      /** 反馈提交时默认附带的最近请求诊断条数，可通过 TARO_APP_RECENT_REQUEST_TRACE_LIMIT 覆盖 */
      __RECENT_REQUEST_TRACE_LIMIT__: JSON.stringify(recentRequestTraceLimit),
      /** 反馈提交时附带的最近 console 日志条数 */
      __CONSOLE_LOG_BUFFER_LIMIT__: JSON.stringify(consoleLogBufferLimit),
      /** 仅 development 构建为 true；上传/体验版等走 production 构建为 false，用于隐藏调试 UI 与调试保存分支 */
      __ENABLE_DEV_DEBUG_UI__: JSON.stringify(process.env.NODE_ENV === 'development'),
      /** 与 package.json version 同步，发布新版本时随 npm version 一并更新 */
      __APP_VERSION__: JSON.stringify(packageVersion),
    },
    copy: {
      patterns: [
        {
          from: 'assets/icons',
          to: 'assets/icons'
        },
        {
          from: 'custom-tab-bar',
          to: 'custom-tab-bar'
        },
        {
          from: 'src/assets/iconfont/iconfont.ttf',
          to: 'assets/iconfont/iconfont.ttf'
        },

      ],
      options: {
      }
    },
    framework: 'react',
    compiler: {
      type: 'vite',
      vitePlugins: [
        createStyleImportPlugin({
          libs: [
            {
              libraryName: '@taroify/core',
              esModule: true,
              resolveStyle: (name: string) => `@taroify/core/${name}/style`,
            },
            {
              libraryName: '@taroify/icons',
              esModule: true,
              resolveStyle: () => '@taroify/icons/style',
            },
          ],
        }),
        // fix: 覆盖 Taro 默认的 es6 target，避免 async/await 被编译为 generator
        // 内联辅助函数与局部变量名冲突，导致真机偶发 "c is not a function"
        {
          name: 'taro-fix-target',
          configResolved(config) {
            config.build.target = 'es2018'
          }
        },
        // fix: @taroify/core 依赖的 lodash 在部分基础库下 getNative(Map) 非构造函数，
        // 触发 MapCache "(Map || ListCache) is not a constructor" 导致 common 分包白屏
        {
          name: 'taro-fix-lodash-weapp-map',
          transform(code, id) {
            if (!/[\\/]lodash[\\/]/.test(id)) return null
            if (!code.includes('Map || ListCache')) return null
            return {
              code: code.replace(/new \(Map \|\| ListCache\)/g, 'new ListCache'),
              map: null,
            }
          },
        },
        // fix: @taroify/icons 使用的 iconfont CDN (at.alicdn.com) 在小程序环境中
        // 无法加载，改为 base64 内联，彻底避免路径解析问题
        {
          name: 'taro-fix-vant-icon-font',
          transform(code, id) {
            if (/@taroify[\\/]icons/.test(id) && /\.(css|scss|less|wxss)$/.test(id)) {
              return code.replace(
                /url\(['"]?\/\/at\.alicdn\.com\/t\/c\/font_2553510_\w+\.(woff2|woff)\?t=\d+['"]?\)/g,
                (match, format) => {
                  const b64 = format === 'woff2' ? vantIconWoff2Base64 : vantIconWoffBase64
                  const mime = format === 'woff2' ? 'font/woff2' : 'font/woff'
                  return `url("data:${mime};base64,${b64}")`
                }
              )
            }
            return null
          }
        },
        // debug: 开发构建时关闭压缩、保留 sourcemap，便于真机调试定位完整错误栈
        {
          name: 'taro-debug-build',
          configResolved(config) {
            config.css ??= {}
            config.css.preprocessorOptions ??= {}
            const scssOptions = ((config.css.preprocessorOptions as Record<string, Record<string, unknown>>).scss ??= {})
            scssOptions.quietDeps = true
            scssOptions.silenceDeprecations = ['legacy-js-api', 'import']
            const sassOptions = ((config.css.preprocessorOptions as Record<string, Record<string, unknown>>).sass ??= {})
            sassOptions.quietDeps = true
            sassOptions.silenceDeprecations = ['legacy-js-api', 'import']
            if (process.env.NODE_ENV === 'development') {
              config.build.minify = false
              config.build.sourcemap = true
              config.build.cssMinify = false
            }
          }
        },
        // 将 ECharts/ZRender 打到代谢页专属分包，避免留在共享分包里继续挤占体积。
        {
          name: 'echarts-chunk-to-package-stats-metabolic',
          configResolved(config) {
            const ro = config.build.rollupOptions
            const outs = ro.output
            const list = Array.isArray(outs) ? outs : outs ? [outs] : []
            const apply = (o: NonNullable<(typeof list)[number]>) => {
              if (!o || typeof o !== 'object') return
              const prevManual = o.manualChunks
              o.manualChunks = (id: string, ctx: unknown) => {
                if (/node_modules[\\/](echarts|zrender)[\\/]/.test(id)) {
                  return 'echarts-vendor'
                }
                if (typeof prevManual === 'function') {
                  return (prevManual as (a: string, b: unknown) => string | void).call(
                    o,
                    id,
                    ctx
                  )
                }
                return undefined
              }
              const prevNames = o.chunkFileNames
              o.chunkFileNames = (chunkInfo) => {
                if (chunkInfo.name === 'echarts-vendor') {
                  return 'packageStatsMetabolic/echarts-vendor.js'
                }
                if (typeof prevNames === 'function') {
                  return prevNames(chunkInfo)
                }
                if (typeof prevNames === 'string') {
                  return prevNames
                }
                return '[name]-[hash].js'
              }
            }
            if (list.length === 0) {
              const o: Record<string, unknown> = {}
              ro.output = o
              apply(o)
            } else {
              list.forEach(apply)
            }
          },
        },
      ],
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {

          }
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      esnextModules: ['@taroify'],

      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css'
      },
      postcss: {
        autoprefixer: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      },
    },
    rn: {
      appName: 'taroDemo',
      postcss: {
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
        }
      }
    }
  }

  process.env.BROWSERSLIST_ENV = process.env.NODE_ENV

  if (process.env.NODE_ENV === 'development') {
    // 本地开发构建配置（不混淆压缩）
    return merge({}, baseConfig, devConfig)
  }
  // 生产构建配置（默认开启压缩混淆等）
  return merge({}, baseConfig, prodConfig)
})
