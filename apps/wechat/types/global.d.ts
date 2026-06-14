/// <reference types="@tarojs/taro" />

declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.css';
declare module '*.less';
declare module '*.scss';
declare module '*.sass';
declare module '*.styl';
declare module 'weapp-qrcode-canvas-2d';

declare namespace NodeJS {
  interface ProcessEnv {
    /** NODE 内置环境变量, 会影响到最终构建生成产物 */
    NODE_ENV: 'development' | 'production',
    /** 当前构建的平台 */
    TARO_ENV: 'weapp' | 'swan' | 'alipay' | 'h5' | 'rn' | 'tt' | 'qq' | 'jd' | 'harmony' | 'jdrn'
    /**
     * 当前构建的小程序 appid
     * @description 若不同环境有不同的小程序，可通过在 env 文件中配置环境变量`TARO_APP_ID`来方便快速切换 appid， 而不必手动去修改 dist/project.config.json 文件
     * @see https://taro-docs.jd.com/docs/next/env-mode-config#特殊环境变量-taro_app_id
     */
    TARO_APP_ID: string
    /** 正式版 API，对应 miniProgram.envVersion === release */
    TARO_APP_API_BASE_URL_RELEASE?: string
    /** 体验版 API，对应 miniProgram.envVersion === trial */
    TARO_APP_API_BASE_URL_TRIAL?: string
    /** 开发版 API，对应 miniProgram.envVersion === develop */
    TARO_APP_API_BASE_URL_DEVELOP?: string
    /** 可选：强制所有环境使用同一 API（e2e、局域网联调） */
    TARO_APP_API_BASE_URL_OVERRIDE?: string
    /** @deprecated 请改用 TARO_APP_API_BASE_URL_OVERRIDE */
    TARO_APP_API_BASE_URL?: string
    /** 天地图 API Key */
    TARO_APP_TIANDITU_TK?: string
  }
}


