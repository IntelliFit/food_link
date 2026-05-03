import { readFileSync } from 'fs'
import { join } from 'path'
import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import { createStyleImportPlugin } from 'vite-plugin-style-import'

import devConfig from './dev'
import prodConfig from './prod'

/** 与 package.json 的 version 一致，供「我的」页底部等展示 */
function readPackageVersion(): string {
  const pkgPath = join(process.cwd(), 'package.json')
  return JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string
}

const packageVersion = readPackageVersion()

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'vite'>(async (merge) => {
  const apiBaseUrl =
    process.env.TARO_APP_API_BASE_URL ||
    (process.env.NODE_ENV === 'development'
      ? 'http://127.0.0.1:3010'
      : 'https://healthymax.cn')
  const expirySubscribeTemplateId = process.env.TARO_APP_EXPIRY_SUBSCRIBE_TEMPLATE_ID || ''

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
      __API_BASE_URL__: JSON.stringify(apiBaseUrl),
      __EXPIRY_SUBSCRIBE_TEMPLATE_ID__: JSON.stringify(expirySubscribeTemplateId),
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
          from: 'src/assets/page_icons',
          to: 'assets/page_icons'
        },
        {
          from: 'custom-tab-bar',
          to: 'custom-tab-bar'
        },
        {
          from: 'src/assets/iconfont',
          to: 'assets/iconfont'
        },
        {
          from: 'src/assets/vant-icon',
          to: 'assets/vant-icon'
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
        // fix: @taroify/icons 使用的 iconfont CDN (at.alicdn.com) 在小程序环境中
        // 无法加载，替换为本地托管的 vant-icon 字体文件
        {
          name: 'taro-fix-vant-icon-font',
          transform(code, id) {
            if (/@taroify[\\/]icons/.test(id) && /\.(css|scss|less|wxss)$/.test(id)) {
              return code.replace(
                /url\(['"]?\/\/at\.alicdn\.com\/t\/c\/font_2553510_\w+\.(woff2|woff)\?t=\d+['"]?\)/g,
                (match, format) => `url("/assets/vant-icon/vant-icon.${format}")`
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
        // 将 ECharts/ZRender 打到分包目录，避免进入主包根目录 vendors（缓解主包 2MB）
        {
          name: 'echarts-chunk-to-package-extra',
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
                  return 'packageExtra/echarts-vendor.js'
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
