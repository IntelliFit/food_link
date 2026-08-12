import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
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
  const runtimeEnv = process.env.TARO_APP_RUNTIME_ENV
  const mode = runtimeEnv === 'production' || runtimeEnv === 'development'
    ? runtimeEnv
    : process.env.NODE_ENV === 'production'
      ? 'production'
      : 'development'
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
  const isDevelopmentRuntime =
    process.env.TARO_APP_RUNTIME_ENV === 'development' ||
    process.env.NODE_ENV === 'development'
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
      /** 运行时环境与构建压缩模式解耦；本地 watch 可使用 production 压缩但仍保持 development 行为。 */
      __RUNTIME_ENV__: JSON.stringify(isDevelopmentRuntime ? 'development' : 'production'),
      __ICON_CDN_BASE_URL__: JSON.stringify(iconCdnBaseUrl),
      __FOOD_IMAGES_CDN_BASE_URL__: JSON.stringify(foodImagesCdnBaseUrl),
      __EXPIRY_SUBSCRIBE_TEMPLATE_ID__: JSON.stringify(expirySubscribeTemplateId),
      /** 反馈提交时默认附带的最近请求诊断条数，可通过 TARO_APP_RECENT_REQUEST_TRACE_LIMIT 覆盖 */
      __RECENT_REQUEST_TRACE_LIMIT__: JSON.stringify(recentRequestTraceLimit),
      /** 反馈提交时附带的最近 console 日志条数 */
      __CONSOLE_LOG_BUFFER_LIMIT__: JSON.stringify(consoleLogBufferLimit),
      /** 本地开发运行环境为 true；上传/体验版为 false，用于隐藏调试 UI 与调试保存分支 */
      __ENABLE_DEV_DEBUG_UI__: JSON.stringify(isDevelopmentRuntime),
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
        ...[
          'jianwen-01-idle',
          'jianwen-01-blink',
          'jianwen-01-squash',
          'jianwen-01-jump',
          'huatuo-01',
          'taiji-xiaozi-01',
          'xiaomai-01',
          'doudou-01',
        ].filter((name) => ['webp', 'png'].some((extension) => (
          existsSync(join(appRoot, 'src', 'assets', 'pets', `${name}.${extension}`))
        ))).map((name) => {
          const extension = existsSync(join(appRoot, 'src', 'assets', 'pets', `${name}.webp`))
            ? 'webp'
            : 'png'
          return {
            from: `src/assets/pets/${name}.${extension}`,
            to: `assets/pets/${name}.${extension}`,
          }
        }),

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
        // 开发环境保留 sourcemap；默认 dev:weapp 通过 production 构建模式启用 Taro 压缩，
        // 再由 TARO_APP_RUNTIME_ENV=development 保留开发 API 和调试能力。
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
              config.build.sourcemap = true
            }
          }
        },
        // Taroify 及其页面级依赖只允许由 packageExtra 页面引用，避免占用主包。
        // 包体门禁会拒绝主包或其他分包同步 require 该 chunk。
        {
          name: 'taroify-chunk-to-package-extra',
          configResolved(config) {
            const ro = config.build.rollupOptions
            const outs = ro.output
            const list = Array.isArray(outs) ? outs : outs ? [outs] : []
            const apply = (o: NonNullable<(typeof list)[number]>) => {
              if (!o || typeof o !== 'object') return
              const prevManual = o.manualChunks
              o.manualChunks = (id: string, ctx: unknown) => {
                if (/node_modules[\\/](?:@taroify[\\/]|@vant[\\/]area-data[\\/]|lodash[\\/]|react-transition-group[\\/]|dom-helpers[\\/]|classnames[\\/]|weapp-qrcode-canvas-2d[\\/])/.test(id)) {
                  return 'taroify-vendor'
                }
                if (typeof prevManual === 'function') {
                  return (prevManual as (a: string, b: unknown) => string | void).call(o, id, ctx)
                }
                return undefined
              }
              const prevNames = o.chunkFileNames
              o.chunkFileNames = (chunkInfo) => {
                if (chunkInfo.name === 'taroify-vendor') return 'packageExtra/taroify-vendor.js'
                if (typeof prevNames === 'function') return prevNames(chunkInfo)
                if (typeof prevNames === 'string') return prevNames
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
        // 微信开发者工具按生成文件计入包体；每次 watch 写包后自动移除无效浏览器前缀。
        {
          name: 'optimize-weapp-wxss-after-build',
          closeBundle() {
            const result = spawnSync(
              process.execPath,
              [join(workspaceRoot, 'scripts', 'optimize-weapp-wxss.mjs'), join(appRoot, 'dist')],
              { encoding: 'utf8' }
            )
            if (result.stdout?.trim()) console.log(result.stdout.trim())
            if (result.status !== 0) {
              throw new Error(result.stderr?.trim() || '微信小程序 WXSS 优化失败')
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
  if (isDevelopmentRuntime) {
    // 默认微信 watch：使用生产压缩控制主包体积，同时保留开发环境变量和调试能力。
    return merge({}, baseConfig, prodConfig, devConfig)
  }
  // 生产构建配置（默认开启压缩混淆等）
  return merge({}, baseConfig, prodConfig)
})
