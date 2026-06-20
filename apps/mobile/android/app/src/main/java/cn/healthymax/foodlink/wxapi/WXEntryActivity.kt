package cn.healthymax.foodlink.wxapi

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import cn.healthymax.foodlink.wechat.WechatAuthResultStore
import com.tencent.mm.opensdk.constants.ConstantsAPI
import com.tencent.mm.opensdk.modelbase.BaseReq
import com.tencent.mm.opensdk.modelbase.BaseResp
import com.tencent.mm.opensdk.modelmsg.SendAuth
import com.tencent.mm.opensdk.openapi.IWXAPIEventHandler
import com.tencent.mm.opensdk.openapi.WXAPIFactory

class WXEntryActivity : Activity(), IWXAPIEventHandler {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleWechatIntent(intent)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleWechatIntent(intent)
  }

  override fun onReq(req: BaseReq?) {
    finish()
  }

  override fun onResp(resp: BaseResp?) {
    if (resp == null) {
      WechatAuthResultStore.reject("WECHAT_AUTH_EMPTY_RESPONSE", "微信授权没有返回结果")
      finish()
      return
    }

    if (resp.type != ConstantsAPI.COMMAND_SENDAUTH) {
      finish()
      return
    }

    when (resp.errCode) {
      BaseResp.ErrCode.ERR_OK -> {
        val code = (resp as? SendAuth.Resp)?.code.orEmpty()
        if (code.isBlank()) {
          WechatAuthResultStore.reject("WECHAT_AUTH_CODE_EMPTY", "微信授权未返回 code")
        } else {
          WechatAuthResultStore.resolve(code)
        }
      }
      BaseResp.ErrCode.ERR_USER_CANCEL ->
        WechatAuthResultStore.reject("WECHAT_AUTH_CANCELLED", "已取消微信授权")
      BaseResp.ErrCode.ERR_AUTH_DENIED ->
        WechatAuthResultStore.reject("WECHAT_AUTH_DENIED", "微信授权被拒绝")
      else ->
        WechatAuthResultStore.reject("WECHAT_AUTH_FAILED", "微信授权失败：${resp.errStr ?: resp.errCode}")
    }
    finish()
  }

  private fun handleWechatIntent(intent: Intent?) {
    val appId = WechatAuthResultStore.readAppId(this)
    if (appId.isBlank()) {
      WechatAuthResultStore.reject("WECHAT_APP_ID_EMPTY", "微信 AppID 未配置")
      finish()
      return
    }
    val api = WXAPIFactory.createWXAPI(this, appId, true)
    api.registerApp(appId)
    if (!api.handleIntent(intent, this)) {
      WechatAuthResultStore.reject("WECHAT_CALLBACK_INVALID", "微信授权回调校验失败")
      finish()
    }
  }
}
