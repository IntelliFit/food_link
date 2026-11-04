package cn.healthymax.foodlink.notifications

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/** Observe the existing Expo entry point, including when the JS runtime is asleep. */
class DiagnosticFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    // Expo carries custom data in `body`; also tolerate the standard flat FCM format.
    val data = runCatching { JSONObject(remoteMessage.data["body"] ?: "{}") }.getOrNull()
    val source = data?.optString("source")?.takeIf { it.isNotBlank() } ?: remoteMessage.data["source"]
    val owner = data?.optString("user_id")?.takeIf { it.isNotBlank() } ?: remoteMessage.data["user_id"]
    val identifier = remoteMessage.data["tag"] ?: remoteMessage.messageId ?: "unknown"
    val scoped = source == "foodlink-reminder" && !owner.isNullOrBlank()
    fun observe(kind: String) {
      // Instrumentation failure must never block Expo's original delivery path.
      if (scoped) runCatching { NotificationDiagnosticsStore.record(this, owner, kind, identifier, "native") }
    }
    observe("fcm_received")
    try {
      super.onMessageReceived(remoteMessage)
      observe("expo_forwarded") // Enqueued to Expo, NOT proof of system display.
    } catch (error: Exception) {
      observe("expo_forward_failed")
      throw error
    }
  }
}
