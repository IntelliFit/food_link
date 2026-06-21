package cn.healthymax.foodlink.wechat

import android.app.Activity
import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tencent.mm.opensdk.constants.Build
import com.tencent.mm.opensdk.modelmsg.SendAuth
import com.tencent.mm.opensdk.modelmsg.SendMessageToWX
import com.tencent.mm.opensdk.modelmsg.WXMediaMessage
import com.tencent.mm.opensdk.modelmsg.WXWebpageObject
import com.tencent.mm.opensdk.openapi.WXAPIFactory
import java.security.SecureRandom

class WechatAuthModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "FoodLinkWechatAuth"

  @ReactMethod
  fun authorize(appId: String, promise: Promise) {
    val trimmedAppId = appId.trim()
    if (trimmedAppId.isEmpty()) {
      promise.reject("WECHAT_APP_ID_EMPTY", "微信 AppID 未配置")
      return
    }

    val activity: Activity? = reactContext.currentActivity
    if (activity == null) {
      promise.reject("WECHAT_ACTIVITY_UNAVAILABLE", "当前页面暂时无法拉起微信")
      return
    }

    val api = WXAPIFactory.createWXAPI(activity, trimmedAppId, true)
    api.registerApp(trimmedAppId)
    if (!api.isWXAppInstalled) {
      promise.reject("WECHAT_NOT_INSTALLED", "未检测到微信，请先安装微信或使用手机验证码登录")
      return
    }
    if (api.wxAppSupportAPI < Build.OPENID_SUPPORTED_SDK_INT) {
      promise.reject("WECHAT_VERSION_UNSUPPORTED", "当前微信版本过低，请升级微信后重试")
      return
    }

    WechatAuthResultStore.start(reactContext.applicationContext, trimmedAppId, promise)

    val req = SendAuth.Req()
    req.scope = "snsapi_userinfo"
    req.state = "foodlink_${randomHex(8)}"
    val sent = api.sendReq(req)
    if (!sent) {
      WechatAuthResultStore.clearIfSame(promise)
      promise.reject("WECHAT_SEND_AUTH_FAILED", "微信授权请求发送失败，请稍后重试")
    }
  }

  @ReactMethod
  fun shareWebpage(
    appId: String,
    webpageUrl: String,
    title: String,
    description: String,
    scene: String,
    promise: Promise
  ) {
    val trimmedAppId = appId.trim()
    if (trimmedAppId.isEmpty()) {
      promise.reject("WECHAT_APP_ID_EMPTY", "微信 AppID 未配置")
      return
    }
    val trimmedUrl = webpageUrl.trim()
    if (!trimmedUrl.startsWith("https://") && !trimmedUrl.startsWith("http://")) {
      promise.reject("WECHAT_SHARE_URL_INVALID", "分享链接必须是 http 或 https 地址")
      return
    }

    val activity: Activity? = reactContext.currentActivity
    if (activity == null) {
      promise.reject("WECHAT_ACTIVITY_UNAVAILABLE", "当前页面暂时无法拉起微信")
      return
    }

    val api = WXAPIFactory.createWXAPI(activity, trimmedAppId, true)
    api.registerApp(trimmedAppId)
    WechatAuthResultStore.saveAppId(reactContext.applicationContext, trimmedAppId)
    if (!api.isWXAppInstalled) {
      promise.reject("WECHAT_NOT_INSTALLED", "未检测到微信")
      return
    }

    val targetScene = when (scene.trim().lowercase()) {
      "timeline", "moments" -> SendMessageToWX.Req.WXSceneTimeline
      else -> SendMessageToWX.Req.WXSceneSession
    }
    if (targetScene == SendMessageToWX.Req.WXSceneTimeline && api.wxAppSupportAPI < Build.TIMELINE_SUPPORTED_SDK_INT) {
      promise.reject("WECHAT_VERSION_UNSUPPORTED", "当前微信版本过低，请升级微信后重试")
      return
    }

    val webpage = WXWebpageObject(trimmedUrl)
    val message = WXMediaMessage(webpage)
    message.title = title.trim().ifEmpty { "Food Link 饮食记录" }.take(512)
    message.description = description.trim().ifEmpty { "来自 Food Link 的饮食记录" }.take(1024)

    val req = SendMessageToWX.Req()
    req.transaction = "foodlink_share_${System.currentTimeMillis()}"
    req.message = message
    req.scene = targetScene
    if (api.sendReq(req)) {
      promise.resolve(true)
    } else {
      promise.reject("WECHAT_SHARE_SEND_FAILED", "微信分享请求发送失败，请稍后重试")
    }
  }

  private fun randomHex(byteCount: Int): String {
    val bytes = ByteArray(byteCount)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString(separator = "") { "%02x".format(it) }
  }
}

object WechatAuthResultStore {
  private const val PREFS = "foodlink_wechat_auth"
  private const val KEY_APP_ID = "app_id"

  @Volatile
  private var pendingPromise: Promise? = null

  fun start(context: Context, appId: String, promise: Promise) {
    pendingPromise?.reject("WECHAT_AUTH_REPLACED", "已发起新的微信授权请求")
    pendingPromise = promise
    saveAppId(context, appId)
  }

  fun resolve(code: String) {
    val promise = pendingPromise
    pendingPromise = null
    if (promise != null) {
      promise.resolve(code)
    }
  }

  fun reject(code: String, message: String) {
    val promise = pendingPromise
    pendingPromise = null
    if (promise != null) {
      promise.reject(code, message)
    }
  }

  fun clearIfSame(promise: Promise) {
    if (pendingPromise === promise) {
      pendingPromise = null
    }
  }

  fun saveAppId(context: Context, appId: String) {
    // AppID is also passed to WXEntryActivity via SharedPreferences so callbacks still work
    // when Android recreates the activity during the WeChat round trip.
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      ?.edit()
      ?.putString(KEY_APP_ID, appId)
      ?.apply()
  }

  fun readAppId(context: Context): String =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_APP_ID, "")?.trim().orEmpty()
}
