package cn.healthymax.foodlink.notifications.honor

import cn.healthymax.foodlink.R
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.hihonor.push.sdk.HonorPushCallback
import com.hihonor.push.sdk.HonorPushClient
import java.lang.ref.WeakReference

class FoodlinkHonorPushModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  init { currentContext = WeakReference(context) }

  override fun getName() = "FoodlinkHonorPush"

  override fun getConstants(): Map<String, Any> = mapOf(
    "appId" to reactApplicationContext.getString(R.string.foodlink_honor_app_id)
  )

  // JS invokes this only after login, notification permission and the server's
  // HONOR capability check. Do not initialize the SDK in Application.onCreate.
  @ReactMethod
  fun getRegistration(promise: Promise) {
    val appId = reactApplicationContext.getString(R.string.foodlink_honor_app_id)
    if (appId.isBlank()) { promise.resolve(null); return }
    UiThreadUtil.runOnUiThread {
      try {
        val client = HonorPushClient.getInstance()
        if (!client.checkSupportHonorPush(reactApplicationContext)) {
          promise.resolve(null)
          return@runOnUiThread
        }
        client.init(reactApplicationContext, false)
        client.getPushToken(object : HonorPushCallback<String> {
          override fun onSuccess(token: String?) {
            if (token.isNullOrBlank()) {
              promise.reject("FOODLINK_HONOR_EMPTY_TOKEN", "荣耀推送凭据为空")
              return
            }
            val result = Arguments.createMap().apply {
              putString("provider", "honor")
              putString("token", token)
              putString("project_id", appId)
            }
            rememberToken(token, false)
            promise.resolve(result)
          }
          override fun onFailure(code: Int, message: String?) {
            // Provider messages may contain credentials; never expose raw text.
            promise.reject("FOODLINK_HONOR_REGISTRATION_FAILED", "荣耀推送注册失败")
          }
        })
      } catch (_: Exception) {
        promise.reject("FOODLINK_HONOR_UNAVAILABLE", "荣耀推送组件暂不可用")
      }
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  companion object {
    private var currentContext: WeakReference<ReactApplicationContext>? = null
    private var lastObservedToken: String? = null

    @Synchronized
    fun rememberToken(token: String, notify: Boolean) {
      if (lastObservedToken == token) return
      lastObservedToken = token
      if (!notify) return
      val context = currentContext?.get() ?: return
      if (!context.hasActiveReactInstance()) return
      // No background HTTP request, token logging or cross-account upload.
      runCatching {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("foodlinkHonorTokenChanged", null)
      }
    }
  }
}
