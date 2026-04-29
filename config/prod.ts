import type { UserConfigExport } from "@tarojs/cli"

export default {
  jsMinimizer: 'terser',
  cssMinimizer: 'csso',
  terser: {
    enable: true,
    config: {
      // fix: 禁用变量名混淆，避免 Terser 压缩后的短变量名与小程序 JSCore 全局 const 冲突，
      // 导致真机偶发 "Assignment to constant variable" 异常。
      mangle: false,
      compress: {
        // 保留基础压缩，但关闭已知容易导致小程序问题的优化项
        dead_code: true,
        drop_debugger: true,
      }
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
