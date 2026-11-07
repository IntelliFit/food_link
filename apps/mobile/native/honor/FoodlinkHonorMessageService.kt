package cn.healthymax.foodlink.notifications.honor

import com.hihonor.push.sdk.HonorMessageService

class FoodlinkHonorMessageService : HonorMessageService() {
  override fun onNewToken(token: String?) {
    // Only ask a live authenticated JS session to renew its binding. No token
    // is written to a public file, log, event payload or background HTTP call.
    if (!token.isNullOrBlank()) FoodlinkHonorPushModule.rememberToken(token, true)
  }
}
