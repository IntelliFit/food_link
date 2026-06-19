const DEFAULT_FOOD_IMAGES_CDN_BASE_URL = 'https://cdn-food-images.coachlink.fit'

export function getFoodImagesCdnBaseUrl(): string {
  const base = (__FOOD_IMAGES_CDN_BASE_URL__ || DEFAULT_FOOD_IMAGES_CDN_BASE_URL).replace(/\/+$/, '')
  // 体验版/正式版 Image 组件仅允许 HTTPS 合法域名，HTTP 会被静默拦截
  return base.replace(/^http:\/\//i, 'https://')
}

export function getFoodImagesCdnUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '')
  return `${getFoodImagesCdnBaseUrl()}/${normalizedPath}`
}

/** 校园食堂 banner / hero 背景图（COS: food-images / wechat/cafeteria-hero.jpg） */
export const CAFETERIA_HERO_BG_URL = getFoodImagesCdnUrl('wechat/cafeteria-hero.jpg')

/** 登录页 logo（COS: food-images / wechat/source-login-logo.png） */
export const LOGIN_LOGO_URL = getFoodImagesCdnUrl('wechat/source-login-logo.png')

/** 默认用户头像（COS: food-images / wechat/default_avatar.jpg） */
export const DEFAULT_AVATAR_URL = getFoodImagesCdnUrl('wechat/default_avatar.jpg')

/** 鹅腿/鸭腿/鸡腿专线背景图（COS: food-images / ecf8e073-83ca-41b4-bb79-659b17e94c85.png） */
export const GOOSE_DUCK_CHICKEN_BG_URL = getFoodImagesCdnUrl('ecf8e073-83ca-41b4-bb79-659b17e94c85.png')
