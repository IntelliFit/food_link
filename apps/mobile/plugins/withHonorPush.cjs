const { withAndroidManifest, withAppBuildGradle, withProjectBuildGradle, withMainApplication, withDangerousMod, AndroidConfig } = require('expo/config-plugins')
const fs = require('node:fs/promises')
const path = require('node:path')

const appGradle = `
// FOODLINK_HONOR_APP_ID: public identity only; secrets belong on the server.
android {
  def honorAppId = providers.gradleProperty('foodlink.honorAppId').orElse(providers.environmentVariable('FOODLINK_HONOR_APP_ID')).getOrElse('')
  if (!(honorAppId ==~ /[0-9]{0,64}/)) { throw new GradleException('荣耀 APP ID 必须为数字') }
  defaultConfig { resValue 'string', 'foodlink_honor_app_id', honorAppId }
  sourceSets { main.java.srcDirs += file('../../native/honor') }
}
dependencies { implementation('com.hihonor.mcs:push:10.0.31.302') }
`
const projectGradle = `
// FOODLINK_HONOR_REPOSITORY
allprojects {
  repositories {
    maven {
      url 'https://developer.hihonor.com/repo'
      content { includeGroupByRegex 'com\\\\.hihonor.*' }
    }
  }
}
`

// Keep the native bridge outside android/: prebuild regeneration must not lose it.
module.exports = function withHonorPush(config) {
  if (config.android?.package !== 'cn.healthymax.foodlink') {
    throw new Error('荣耀桥接包名需与应用包名一致，请先适配后再构建')
  }
  config = withProjectBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes('FOODLINK_HONOR_REPOSITORY')) mod.modResults.contents += projectGradle
    return mod
  })
  config = withAppBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes('FOODLINK_HONOR_APP_ID')) mod.modResults.contents += appGradle
    return mod
  })
  config = withMainApplication(config, mod => {
    let source = mod.modResults.contents
    const importLine = 'import cn.healthymax.foodlink.notifications.honor.FoodlinkHonorPushPackage'
    if (!source.includes(importLine)) source = source.replace(/(package [^\r\n]+)/, `$1\n\n${importLine}`)
    if (!source.includes('add(FoodlinkHonorPushPackage())')) {
      const anchor = 'PackageList(this).packages.apply {'
      if (!source.includes(anchor)) throw new Error('荣耀包注册失败：MainApplication 模板已变化')
      source = source.replace(anchor, `${anchor}\n          add(FoodlinkHonorPushPackage())`)
    }
    mod.modResults.contents = source
    return mod
  })
  config = withAndroidManifest(config, mod => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
    app['meta-data'] ??= []
    if (!app['meta-data'].some(item => item.$['android:name'] === 'com.hihonor.push.app_id')) {
      app['meta-data'].push({ $: { 'android:name': 'com.hihonor.push.app_id', 'android:value': '@string/foodlink_honor_app_id' } })
    }
    app.service ??= []
    if (!app.service.some(item => item.$['android:name'] === '.notifications.honor.FoodlinkHonorMessageService')) {
      app.service.push({
        $: { 'android:name': '.notifications.honor.FoodlinkHonorMessageService', 'android:exported': 'false' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'com.hihonor.push.action.MESSAGING_EVENT' } }] }],
      })
    }
    return mod
  })
  return withDangerousMod(config, ['android', async mod => {
    const filename = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro')
    const current = await fs.readFile(filename, 'utf8')
    if (!current.includes('FOODLINK_HONOR_KEEP')) {
      await fs.appendFile(filename, '\n# FOODLINK_HONOR_KEEP\n-keep class com.hihonor.push.** { *; }\n-keep class cn.healthymax.foodlink.notifications.honor.** { *; }\n')
    }
    return mod
  }])
}
