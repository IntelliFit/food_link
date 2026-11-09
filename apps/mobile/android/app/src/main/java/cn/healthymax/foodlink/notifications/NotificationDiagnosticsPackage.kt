package cn.healthymax.foodlink.notifications

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager

class NotificationDiagnosticsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(NotificationDiagnosticsModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class NotificationDiagnosticsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "FoodLinkNotificationDiagnostics"

  @ReactMethod fun setOwner(owner: String?, promise: Promise) {
    runCatching { NotificationDiagnosticsStore.setOwner(context, owner) }
      .onSuccess { promise.resolve(null) }.onFailure { promise.reject("E_DIAGNOSTICS", "无法初始化本机通知诊断") }
  }

  @ReactMethod fun record(owner: String?, kind: String, identifier: String, state: String, promise: Promise) {
    runCatching {
      NotificationDiagnosticsStore.record(context, owner, kind, identifier, state)
    }.onSuccess { promise.resolve(null) }.onFailure { promise.reject("E_DIAGNOSTICS", "无法记录本机通知诊断") }
  }

  @ReactMethod fun recordRegistration(owner: String, kind: String, identifier: String, state: String, code: String, promise: Promise) {
    runCatching {
      NotificationDiagnosticsStore.record(context, owner, kind, identifier, state, code)
    }.onSuccess { promise.resolve(null) }.onFailure { promise.reject("E_DIAGNOSTICS", "无法记录本机推送注册诊断") }
  }

  @ReactMethod fun clear(owner: String?, promise: Promise) {
    runCatching { NotificationDiagnosticsStore.clear(context, owner) }
      .onSuccess { cleared ->
        if (cleared) promise.resolve(null)
        else promise.reject("E_SESSION_CHANGED", "账号状态已改变，请重新进入诊断页")
      }.onFailure { promise.reject("E_DIAGNOSTICS", "无法清除本机通知诊断，请重试") }
  }

  @Suppress("DEPRECATION")
  @ReactMethod fun snapshot(owner: String?, promise: Promise) {
    runCatching {
      check(NotificationDiagnosticsStore.matchesOwner(context, owner))
      val result = Arguments.createMap()
      val app = context.packageManager.getPackageInfo(context.packageName, 0)
      result.putString("version", app.versionName)
      result.putDouble("versionCode", if (Build.VERSION.SDK_INT >= 28) app.longVersionCode.toDouble() else app.versionCode.toDouble())
      val gms = runCatching { context.packageManager.getApplicationInfo("com.google.android.gms", 0) }.getOrNull()
      result.putString("googleServices", if (gms == null) "not-installed" else if (gms.enabled) "enabled" else "disabled")
      val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val network = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
      val transports = Arguments.createArray()
      if (network != null) {
        if (network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transports.pushString("Wi-Fi")
        if (network.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transports.pushString("移动网络")
        if (network.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transports.pushString("VPN")
        if (network.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transports.pushString("以太网")
      }
      result.putArray("network", transports)
      result.putBoolean("networkValidated", network?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      result.putBoolean("powerSave", power.isPowerSaveMode)
      result.putBoolean("deviceIdle", power.isDeviceIdleMode)
      result.putBoolean("batteryExempt", power.isIgnoringBatteryOptimizations(context.packageName))
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      result.putBoolean("exactAlarmAllowed", Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms())
      val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val posted = notifications.activeNotifications.count {
        Build.VERSION.SDK_INT >= 26 && it.notification.channelId == "foodlink-reminders"
      }
      result.putInt("postedReminderCount", posted)
      val events = Arguments.createArray()
      val journal = NotificationDiagnosticsStore.eventsForOwner(context, owner)
      for (index in 0 until journal.length()) {
        val event = journal.getJSONObject(index)
        val item = Arguments.createMap()
        item.putString("kind", event.getString("kind"))
        item.putDouble("at", event.getLong("at").toDouble())
        item.putString("id", event.getString("id"))
        item.putString("state", event.getString("state"))
        if (event.has("code")) item.putString("code", event.getString("code"))
        events.pushMap(item)
      }
      result.putArray("events", events)
      result
    }.onSuccess { promise.resolve(it) }.onFailure { promise.reject("E_DIAGNOSTICS", "无法读取本机通知诊断，请重试") }
  }
}
