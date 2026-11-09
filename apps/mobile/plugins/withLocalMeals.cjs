const { withAndroidManifest, withAppBuildGradle, withMainApplication, withDangerousMod, AndroidConfig } = require('expo/config-plugins')
const fs = require('node:fs/promises')
const path = require('node:path')

module.exports = function withLocalMeals(config) {
  config = withAppBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes('FOODLINK_LOCAL_MEALS')) mod.modResults.contents += '\n// FOODLINK_LOCAL_MEALS\nandroid { sourceSets { main.java.srcDirs += file("../../native/meals") } }\n'
    return mod
  })
  config = withMainApplication(config, mod => {
    const line = 'import cn.healthymax.foodlink.notifications.meals.LocalMealsPackage'
    let source = mod.modResults.contents
    if (!source.includes(line)) source = source.replace(/(package [^\r\n]+)/, `$1\n${line}`)
    if (!source.includes('add(LocalMealsPackage())')) {
      const anchor = 'PackageList(this).packages.apply {'
      if (!source.includes(anchor)) throw new Error('Local meal package registration template changed')
      source = source.replace(anchor, `${anchor}\n          add(LocalMealsPackage())`)
    }
    mod.modResults.contents = source
    return mod
  })
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest
    manifest['uses-permission'] ??= []
    for (const name of ['android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.SCHEDULE_EXACT_ALARM']) {
      if (!manifest['uses-permission'].some(item => item.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name } })
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
    app.$['android:fullBackupContent'] = '@xml/notification_diagnostics_backup_rules'
    app.$['android:dataExtractionRules'] = '@xml/notification_diagnostics_extraction_rules'
    app.receiver ??= []
    if (!app.receiver.some(item => item.$['android:name'] === '.notifications.meals.LocalMealReceiver')) app.receiver.push({
      $: { 'android:name': '.notifications.meals.LocalMealReceiver', 'android:exported': 'false' },
      'intent-filter': [{ action: ['android.intent.action.BOOT_COMPLETED', 'android.intent.action.MY_PACKAGE_REPLACED', 'android.intent.action.TIME_SET', 'android.intent.action.TIMEZONE_CHANGED', 'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED'].map(name => ({ $: { 'android:name': name } })) }],
    })
    return mod
  })
  return withDangerousMod(config, ['android', async mod => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml')
    await fs.mkdir(directory, { recursive: true })
    const exclusion = '<exclude domain="sharedpref" path="foodlink_local_meals_v1.xml" />'
    const files = [
      ['notification_diagnostics_backup_rules.xml', ['full-backup-content'], '<full-backup-content></full-backup-content>'],
      ['notification_diagnostics_extraction_rules.xml', ['cloud-backup', 'device-transfer'], '<data-extraction-rules><cloud-backup></cloud-backup><device-transfer></device-transfer></data-extraction-rules>'],
    ]
    for (const [name, sections, fallback] of files) {
      const file = path.join(directory, name)
      let source = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return fallback; throw error })
      for (const section of sections) {
        const pattern = new RegExp(`(<${section}[^>]*>)([\\s\\S]*?)(</${section}>)`)
        if (!pattern.test(source)) throw new Error(`Missing backup section: ${section}`)
        source = source.replace(pattern, (_, start, contents, end) => `${start}${contents.includes('foodlink_local_meals_v1.xml') ? contents : `${contents}\n${exclusion}\n`}${end}`)
      }
      await fs.writeFile(file, source, 'utf8')
    }
    return mod
  }])
}
