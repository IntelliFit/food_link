package cn.healthymax.foodlink.notifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Metadata only. Never retain a payload, notification text, token or raw user ID. */
object NotificationDiagnosticsStore {
  private const val PREFS = "foodlink_notification_diagnostics_v1"
  private const val MAX_EVENTS = 50
  private const val RETENTION_MS = 7L * 24 * 60 * 60 * 1000
  private val kinds = setOf(
    "fcm_received", "expo_forwarded", "expo_forward_failed", "foreground_received",
    "foreground_allowed", "foreground_suppressed", "opened", "local_scheduled",
    "local_received", "local_opened", "local_seen", "local_not_seen",
    "native_token_requested", "native_token_ready", "native_token_failed",
    "expo_token_requested", "expo_token_ready", "expo_token_failed",
    "device_binding_requested", "device_binding_ready", "device_binding_failed"
  )
  private val codes = setOf("TIMEOUT", "NETWORK_ERROR", "SERVICE_NOT_AVAILABLE", "AUTHENTICATION_FAILED",
    "CONFIGURATION_ERROR", "PROVIDER_ERROR", "BACKEND_ERROR", "UNKNOWN")

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

  @Synchronized fun setOwner(context: Context, owner: String?) {
    val hash = owner?.let { digest(it) } ?: ""
    val preferences = prefs(context)
    if (preferences.getString("owner", "") != hash) {
      preferences.edit().putString("owner", hash).remove("events").apply()
    }
  }

  @Synchronized fun matchesOwner(context: Context, owner: String?): Boolean =
    prefs(context).getString("owner", "") == (owner?.let { digest(it) } ?: "")

  @Synchronized fun events(context: Context): JSONArray {
    val raw = runCatching { JSONArray(prefs(context).getString("events", "[]")) }.getOrDefault(JSONArray())
    val result = JSONArray()
    val cutoff = System.currentTimeMillis() - RETENTION_MS
    for (index in maxOf(0, raw.length() - MAX_EVENTS) until raw.length()) {
      val event = raw.optJSONObject(index) ?: continue
      if (event.optLong("at") >= cutoff && event.optString("kind") in kinds) result.put(event)
    }
    return result
  }

  @Synchronized fun record(context: Context, owner: String?, kind: String, identifier: String, state: String, code: String? = null) {
    if (kind !in kinds || !matchesOwner(context, owner)) return
    val event = JSONObject().put("kind", kind).put("at", System.currentTimeMillis())
      .put("id", digest(identifier.take(512)).take(16))
      .put("state", if (state in setOf("active", "background", "inactive", "native")) state else "unknown")
    if (code != null && code in codes) event.put("code", code)
    val previous = events(context)
    val next = JSONArray()
    for (index in maxOf(0, previous.length() - MAX_EVENTS + 1) until previous.length()) next.put(previous.get(index))
    next.put(event)
    prefs(context).edit().putString("events", next.toString()).apply()
  }

  @Synchronized fun clear(context: Context, owner: String?): Boolean {
    if (!matchesOwner(context, owner)) return false
    prefs(context).edit().remove("events").apply()
    return true
  }

  @Synchronized fun eventsForOwner(context: Context, owner: String?): JSONArray =
    if (matchesOwner(context, owner)) events(context) else JSONArray()
}
