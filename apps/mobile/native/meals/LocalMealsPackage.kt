package cn.healthymax.foodlink.notifications.meals

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/** Three OS alarms, not a running JS timer or a background polling service. */
object LocalMeals {
  private const val STORE = "foodlink_local_meals_v1"
  private const val CHANNEL = "foodlink-reminders"
  private const val ACTION = "cn.healthymax.foodlink.LOCAL_MEAL"
  private val meals = listOf("breakfast", "lunch", "dinner")
  private fun store(c: Context) = c.getSharedPreferences(STORE, Context.MODE_PRIVATE)
  private fun alarms(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
  private fun config(c: Context) = store(c).getString("config", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
  fun exact(c: Context) = Build.VERSION.SDK_INT < 31 || alarms(c).canScheduleExactAlarms()
  private fun active(p: JSONObject) = p.optBoolean("enabled") && p.optBoolean("meal_enabled")
  private fun quiet(p: JSONObject, time: String): Boolean {
    val start = p.getString("quiet_start")
    val end = p.getString("quiet_end")
    return if (start < end) time >= start && time < end else time >= start || time < end
  }
  private fun intent(c: Context, meal: String, due: Long = 0): PendingIntent {
    val i = Intent(c, LocalMealReceiver::class.java).setAction(ACTION).setData(Uri.parse("foodlink-alarm://$meal"))
      .putExtra("meal", meal).putExtra("due", due).putExtra("generation", store(c).getString("generation", ""))
    return PendingIntent.getBroadcast(c, 7300 + meals.indexOf(meal), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
  private fun record(c: Context, meal: String, state: String, due: Long) {
    val old = JSONArray(store(c).getString("events", "[]"))
    val events = JSONArray()
    for (n in maxOf(0, old.length() - 29) until old.length()) events.put(old.get(n))
    events.put(JSONObject().put("at", System.currentTimeMillis()).put("meal", meal).put("state", state).put("due", due))
    store(c).edit().putString("events", events.toString()).commit()
  }
  private fun cancel(c: Context) {
    val edit = store(c).edit()
    for (meal in meals) {
      alarms(c).cancel(intent(c, meal))
      edit.remove("next_$meal")
    }
    edit.commit()
  }
  @Synchronized fun clear(c: Context) {
    cancel(c)
    store(c).edit().clear().commit()
    val manager = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.activeNotifications.filter { it.tag?.startsWith("foodlink-local-meal-") == true }
      .forEach { manager.cancel(it.tag, it.id) }
  }
  @Synchronized fun session(c: Context, owner: String?) {
    if (owner == null || store(c).getString("owner", null) != owner) clear(c)
  }
  @Synchronized fun configure(c: Context, owner: String, json: String) {
    require(owner.isNotBlank())
    val p = JSONObject(json)
    ZoneId.of(p.getString("timezone"))
    val clock = Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")
    for (key in listOf("breakfast_time", "lunch_time", "dinner_time", "quiet_start", "quiet_end")) require(clock.matches(p.getString(key)))
    require(p.getString("quiet_start") != p.getString("quiet_end"))
    for (meal in meals) require(!quiet(p, p.getString("${meal}_time")))
    if (store(c).getString("owner", null) != owner) clear(c)
    if (store(c).getString("config", null) != json) {
      cancel(c)
      check(store(c).edit().putString("owner", owner).putString("config", json)
        .putString("generation", UUID.randomUUID().toString()).commit())
    }
    try { reschedule(c) } catch (error: Exception) {
      cancel(c)
      store(c).edit().remove("config").remove("generation").commit()
      throw error
    }
  }
  private fun schedule(c: Context, p: JSONObject, meal: String, preserve: Boolean = false) {
    val now = Instant.now().atZone(ZoneId.of(p.getString("timezone")))
    var due = now.toLocalDate().atTime(LocalTime.parse(p.getString("${meal}_time"))).atZone(now.zone)
    if (!due.isAfter(now)) due = due.toLocalDate().plusDays(1).atTime(LocalTime.parse(p.getString("${meal}_time"))).atZone(now.zone)
    val old = store(c).getLong("next_$meal", 0)
    val epoch = if (preserve && old >= System.currentTimeMillis() - 30 * 60_000 && old > 0) old else due.toInstant().toEpochMilli()
    val pending = intent(c, meal, epoch)
    val fireAt = maxOf(epoch, System.currentTimeMillis() + 1000)
    if (exact(c)) {
      try { alarms(c).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pending) }
      catch (_: SecurityException) { alarms(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pending) }
    } else alarms(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pending)
    check(store(c).edit().putLong("next_$meal", epoch).commit())
  }
  @Synchronized fun reschedule(c: Context) {
    val p = config(c) ?: return
    if (!active(p)) { cancel(c); return }
    for (meal in meals) schedule(c, p, meal, true)
  }
  @Synchronized fun fire(c: Context, i: Intent) {
    val p = config(c) ?: return
    val meal = i.getStringExtra("meal") ?: return
    if (meal !in meals || !active(p) || i.getStringExtra("generation") != store(c).getString("generation", null)) return
    val due = i.getLongExtra("due", 0)
    // A cancelled/old PendingIntent cannot replay an obsolete setting.
    if (due != store(c).getLong("next_$meal", -1)) return
    schedule(c, p, meal)
    val now = System.currentTimeMillis()
    if (now < due || now - due > 30 * 60_000) { record(c, meal, "expired", due); return }
    val local = Instant.ofEpochMilli(due).atZone(ZoneId.of(p.getString("timezone")))
    val date = local.toLocalDate().toString()
    if (quiet(p, LocalTime.now(local.zone).toString().take(5))) { record(c, meal, "quiet", due); return }
    if (store(c).getString("last_$meal", "") == date) { record(c, meal, "duplicate_skipped", due); return }
    val recorded = JSONObject(store(c).getString("recorded", "{}") ?: "{}")
    val recordedMeals = recorded.optJSONArray(date) ?: JSONArray()
    if ((0 until recordedMeals.length()).any { recordedMeals.optString(it) == meal }) { record(c, meal, "recorded_skipped", due); return }
    val manager = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "饮食与保质期提醒", NotificationManager.IMPORTANCE_HIGH))
    if (!NotificationManagerCompat.from(c).areNotificationsEnabled() || (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE)) {
      record(c, meal, "permission_blocked", due); return
    }
    val owner = store(c).getString("owner", "") ?: return
    val link = Uri.Builder().scheme("foodlink").authority("local-meal").appendPath(meal).appendQueryParameter("owner", owner).appendQueryParameter("date", date).build()
    val launch = c.packageManager.getLaunchIntentForPackage(c.packageName) ?: return
    launch.action = Intent.ACTION_VIEW
    launch.data = link
    val open = PendingIntent.getActivity(c, 7400 + meals.indexOf(meal), launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val label = mapOf("breakfast" to "早餐", "lunch" to "午餐", "dinner" to "晚餐").getValue(meal)
    val text = "到${label}时间了，记得好好吃饭。点开查看餐食建议。"
    val notification = NotificationCompat.Builder(c, CHANNEL)
      .setSmallIcon(c.applicationInfo.icon).setContentTitle("食探 · ${label}提醒").setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text)).setContentIntent(open).setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setTimeoutAfter(30 * 60_000L).build()
    try {
      manager.notify("foodlink-local-meal-$meal", 7400 + meals.indexOf(meal), notification)
      store(c).edit().putString("last_$meal", date).commit()
      record(c, meal, "system_posted", due)
    } catch (_: SecurityException) { record(c, meal, "permission_blocked", due) }
  }
  @Synchronized fun recorded(c: Context, owner: String, date: String, json: String) {
    if (store(c).getString("owner", null) != owner || !Regex("\\d{4}-\\d{2}-\\d{2}").matches(date)) return
    val incoming = JSONArray(json)
    val filtered = JSONArray()
    for (n in 0 until incoming.length()) if (incoming.optString(n) in meals) filtered.put(incoming.getString(n))
    val all = JSONObject(store(c).getString("recorded", "{}") ?: "{}")
    all.put(date, filtered)
    // Dates only: no food photos, health measurements or credentials in this store.
    val keys = all.keys().asSequence().toList().sortedDescending()
    for (key in keys.drop(8)) all.remove(key)
    store(c).edit().putString("recorded", all.toString()).commit()
  }
  @Synchronized fun snapshot(c: Context): String {
    val p = config(c)
    val out = JSONObject().put("enabled", p != null && active(p)).put("exactAlarmAllowed", exact(c))
      .put("owner", store(c).getString("owner", null)).put("events", JSONArray(store(c).getString("events", "[]")))
    val next = JSONArray()
    for (meal in meals) {
      val due = store(c).getLong("next_$meal", 0)
      if (due > 0) next.put(JSONObject().put("meal", meal).put("due", due))
    }
    return out.put("next", next).toString()
  }
  @Synchronized fun failure(c: Context) { record(c, "", "schedule_failed", 0) }
}

class LocalMealReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    // No network or JS startup needed, including after reboot/unlock/package update.
    runCatching {
      if (intent.action == "cn.healthymax.foodlink.LOCAL_MEAL") LocalMeals.fire(context, intent)
      else LocalMeals.reschedule(context)
    }.onFailure { runCatching { LocalMeals.failure(context) } }
  }
}

class LocalMealsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "FoodLinkLocalMeals"
  private fun result(promise: Promise, action: () -> Unit) {
    runCatching { action(); LocalMeals.snapshot(context) }.onSuccess { promise.resolve(it) }
      .onFailure { promise.reject("E_LOCAL_MEALS", "本机定时提醒未完成设置，请重试") }
  }
  @ReactMethod fun configure(owner: String, json: String, promise: Promise) = result(promise) { LocalMeals.configure(context, owner, json) }
  @ReactMethod fun session(owner: String?, promise: Promise) = result(promise) { LocalMeals.session(context, owner) }
  @ReactMethod fun clear(promise: Promise) = result(promise) { LocalMeals.clear(context) }
  @ReactMethod fun snapshot(promise: Promise) = result(promise) { }
  @ReactMethod fun openAlarmSettings(promise: Promise) = result(promise) {
    if (Build.VERSION.SDK_INT >= 31) context.startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
      Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
  @ReactMethod fun recorded(owner: String, date: String, meals: String, promise: Promise) = result(promise) { LocalMeals.recorded(context, owner, date, meals) }
}

class LocalMealsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(LocalMealsModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
