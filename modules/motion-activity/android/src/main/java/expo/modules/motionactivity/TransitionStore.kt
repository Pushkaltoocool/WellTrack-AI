package expo.modules.motionactivity

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal const val TAG = "MotionActivity"
internal const val PREFS_NAME = "expo.modules.motionactivity"

internal fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

internal fun hasActivityRecognitionPermission(context: Context): Boolean =
  Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) ==
    PackageManager.PERMISSION_GRANTED

/**
 * Activity Recognition Transition API registration plus a JSON-lines log of transitions in filesDir.
 * Each line: {"t": epochMs, "type": MotionType | "gap", "e": "enter" | "exit" | "gap"}.
 */
internal object TransitionStore {
  private const val KEY_ENABLED = "transitionsEnabled"
  private const val FILE_NAME = "motion_transitions.jsonl"
  private const val MAX_BYTES = 512 * 1024L
  private const val ACTION_TRANSITION = "expo.modules.motionactivity.TRANSITION"
  // Boot receivers must finish within ~10 s, so don't wait longer than this on Play services.
  private const val TASK_TIMEOUT_S = 8L

  private val TRACKED_TYPES = intArrayOf(
    DetectedActivity.IN_VEHICLE,
    DetectedActivity.ON_BICYCLE,
    DetectedActivity.RUNNING,
    DetectedActivity.WALKING,
    DetectedActivity.STILL
  )

  /** Serializes background file work from receivers. */
  val io: ExecutorService = Executors.newSingleThreadExecutor()
  private val lock = Any()

  fun isEnabled(context: Context) = prefs(context).getBoolean(KEY_ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, TransitionReceiver::class.java).setAction(ACTION_TRANSITION)
    // Play services fills in the result extras, so the intent must be mutable on Android 12+.
    val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
  }

  /** Blocking; call off the main thread. */
  @SuppressLint("MissingPermission")
  fun register(context: Context): Boolean {
    if (!hasActivityRecognitionPermission(context)) return false
    val transitions = TRACKED_TYPES.flatMap { type ->
      listOf(ActivityTransition.ACTIVITY_TRANSITION_ENTER, ActivityTransition.ACTIVITY_TRANSITION_EXIT).map {
        ActivityTransition.Builder().setActivityType(type).setActivityTransition(it).build()
      }
    }
    return try {
      val task = ActivityRecognition.getClient(context)
        .requestActivityTransitionUpdates(ActivityTransitionRequest(transitions), pendingIntent(context))
      Tasks.await(task, TASK_TIMEOUT_S, TimeUnit.SECONDS)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Registering activity transitions failed", e)
      false
    }
  }

  /** Blocking; call off the main thread. */
  @SuppressLint("MissingPermission")
  fun unregister(context: Context) {
    try {
      val pi = pendingIntent(context)
      Tasks.await(ActivityRecognition.getClient(context).removeActivityTransitionUpdates(pi), TASK_TIMEOUT_S, TimeUnit.SECONDS)
      pi.cancel()
    } catch (e: Exception) {
      Log.w(TAG, "Removing activity transitions failed", e)
    }
  }

  fun typeName(activityType: Int): String? = when (activityType) {
    DetectedActivity.IN_VEHICLE -> "automotive"
    DetectedActivity.ON_BICYCLE -> "cycling"
    DetectedActivity.RUNNING -> "running"
    DetectedActivity.WALKING, DetectedActivity.ON_FOOT -> "walking"
    DetectedActivity.STILL -> "stationary"
    else -> null
  }

  fun linesFor(result: ActivityTransitionResult): List<String> {
    // Events carry elapsed-realtime timestamps; convert to wall-clock epoch ms.
    val nowMs = System.currentTimeMillis()
    val nowNanos = SystemClock.elapsedRealtimeNanos()
    return result.transitionEvents.mapNotNull { event ->
      val type = typeName(event.activityType) ?: return@mapNotNull null
      val enter = event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER
      JSONObject()
        .put("t", nowMs - (nowNanos - event.elapsedRealTimeNanos) / 1_000_000)
        .put("type", type)
        .put("e", if (enter) "enter" else "exit")
        .toString()
    }
  }

  /** Ends the current segment without starting another (updates stopped, device rebooted). */
  fun appendGap(context: Context, atMs: Long) {
    append(context, listOf(JSONObject().put("t", atMs).put("type", "gap").put("e", "gap").toString()))
  }

  fun append(context: Context, lines: List<String>) {
    if (lines.isEmpty()) return
    synchronized(lock) {
      val file = File(context.filesDir, FILE_NAME)
      file.appendText(lines.joinToString(separator = "\n", postfix = "\n"))
      if (file.length() > MAX_BYTES) {
        val all = file.readLines()
        val tmp = File(context.filesDir, "$FILE_NAME.tmp")
        tmp.writeText(all.takeLast(all.size / 2).joinToString(separator = "\n", postfix = "\n"))
        tmp.renameTo(file)
      }
    }
  }

  /**
   * ENTER and gap points that start in [fromMs, toMs), plus the last one before fromMs so the
   * activity already in progress at fromMs is included. Shaped like the iOS points.
   */
  fun query(context: Context, fromMs: Long, toMs: Long): List<Map<String, Any>> {
    val lines = synchronized(lock) {
      val file = File(context.filesDir, FILE_NAME)
      if (file.exists()) file.readLines() else emptyList()
    }
    val points = lines.mapNotNull { line ->
      try {
        val obj = JSONObject(line)
        if (obj.optString("e") == "exit") null else obj.getLong("t") to obj.getString("type")
      } catch (e: Exception) {
        null
      }
    }.sortedBy { it.first }

    val firstInRange = points.indexOfFirst { it.first >= fromMs }.let { if (it == -1) points.size else it }
    val start = (firstInRange - 1).coerceAtLeast(0)
    return points.subList(start, points.size)
      .takeWhile { it.first < toMs }
      .map { (t, type) -> mapOf("t" to t.toDouble(), "type" to type, "confidence" to "medium") }
  }
}
