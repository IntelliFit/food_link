import type { UserConfigExport } from "@tarojs/cli"

export default {
  jsMinimizer: 'terser',
  cssMinimizer: 'csso',
  terser: {
    enable: true,
    config: {
      // 开启局部变量压缩，为主包和分包长期保留体积余量。
      // 不压缩顶层名称，避免跨 chunk 的 require/export 标识被改写；safari10 用于规避
      // 旧版 JavaScriptCore 的循环作用域/短变量名兼容问题。2026-04 的真机崩溃链路中，
      // 对应的闭包 for 循环已经从业务代码移除，这里继续保留引擎兼容保护。
      mangle: {
        toplevel: false,
        safari10: true,
      },
      compress: {
        // Taro 默认已关闭 collapse_vars / reduce_vars / loops 等激进优化；这里只补充
        // 明确安全的清理项；旧版 JavaScriptCore 兼容由 mangle/output 负责。
        dead_code: true,
        drop_debugger: true,
      },
      output: {
        // 小程序脚本本身使用 UTF-8；保留中文字符比转成 6 字节的 \uXXXX 更小。
        ascii_only: false,
        comments: false,
        safari10: true,
      },
    }
  },
  csso: {
    enable: true
  },
  mini: {
    enableSourceMap: false
  },
  h5: {
    // 确保产物为 es5
    legacy: true,
    /**
     * WebpackChain 插件配置
     * @docs https://github.com/neutrinojs/webpack-chain
     */
    // webpackChain (chain) {
    //   /**
    //    * 如果 h5 端编译后体积过大，可以使用 webpack-bundle-analyzer 插件对打包体积进行分析。
    //    * @docs https://github.com/webpack-contrib/webpack-bundle-analyzer
    //    */
    //   chain.plugin('analyzer')
    //     .use(require('webpack-bundle-analyzer').BundleAnalyzerPlugin, [])
    //   /**
    //    * 如果 h5 端首屏加载时间过长，可以使用 prerender-spa-plugin 插件预加载首页。
    //    * @docs https://github.com/chrisvfritz/prerender-spa-plugin
    //    */
    //   const path = require('path')
    //   const Prerender = require('prerender-spa-plugin')
    //   const staticDir = path.join(__dirname, '..', 'dist')
    //   chain
    //     .plugin('prerender')
    //     .use(new Prerender({
    //       staticDir,
    //       routes: [ '/pages/index/index' ],
    //       postProcess: (context) => ({ ...context, outputPath: path.join(staticDir, 'index.html') })
    //     }))
    // }
  }
} satisfies UserConfigExport<'vite'>
