package expo.modules.motionactivity

import android.app.AlarmManager
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Opt-in foreground service that records [windowSeconds] of accelerometer + gyroscope at 50 Hz
 * every [periodSeconds] and saves each window via [ChunkStore]. Between windows nothing runs and no
 * wake lock is held; an allow-while-idle alarm wakes the service for the next window.
 */
class SensorCaptureService : Service(), SensorEventListener {
  companion object {
    private const val ACTION_CAPTURE = "expo.modules.motionactivity.CAPTURE"
    private const val CHANNEL_ID = "motion_activity_capture"
    private const val NOTIFICATION_ID = 0x4D41
    private const val SAMPLING_PERIOD_US = 20_000 // 50 Hz
    private const val KEY_RUNNING = "captureRunning"
    private const val KEY_WINDOW = "captureWindowSeconds"
    private const val KEY_PERIOD = "capturePeriodSeconds"

    @Volatile
    var isRunning = false
      private set

    fun wasRunning(context: Context) = prefs(context).getBoolean(KEY_RUNNING, false)

    fun start(context: Context, windowSeconds: Int, periodSeconds: Int): Boolean {
      if (!hasActivityRecognitionPermission(context)) return false
      val sensors = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      if (sensors?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) == null) return false

      val window = windowSeconds.coerceIn(1, 60)
      val period = periodSeconds.coerceAtLeast(window + 5)
      prefs(context).edit()
        .putBoolean(KEY_RUNNING, true)
        .putInt(KEY_WINDOW, window)
        .putInt(KEY_PERIOD, period)
        .apply()
      return launch(context)
    }

    /** Called from the boot receiver with the saved configuration. */
    fun restore(context: Context) {
      if (hasActivityRecognitionPermission(context)) launch(context)
    }

    fun stop(context: Context) {
      prefs(context).edit().putBoolean(KEY_RUNNING, false).apply()
      isRunning = false
      cancelAlarm(context)
      context.stopService(Intent(context, SensorCaptureService::class.java))
    }

    private fun launch(context: Context): Boolean = try {
      ContextCompat.startForegroundService(context, Intent(context, SensorCaptureService::class.java))
      isRunning = true // Optimistic; onStartCommand clears it if the service can't go foreground.
      true
    } catch (e: Exception) {
      Log.w(TAG, "Starting sensor capture failed", e)
      false
    }

    private fun capturePendingIntent(context: Context): PendingIntent =
      PendingIntent.getService(
        context,
        1,
        Intent(context, SensorCaptureService::class.java).setAction(ACTION_CAPTURE),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

    private fun cancelAlarm(context: Context) {
      (context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager)?.cancel(capturePendingIntent(context))
    }
  }

  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler
  private var sensorManager: SensorManager? = null
  private var wakeLock: PowerManager.WakeLock? = null

  // Everything below is only touched on [thread].
  private var windowSeconds = 10
  private var periodSeconds = 120
  private var capturing = false
  private var startedAtMs = 0L
  private var hasGyro = false
  private val acc = SensorSeries()
  private val gyro = SensorSeries()

  private val endWindow = Runnable { finishWindow() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    thread = HandlerThread("MotionActivityCapture").also { it.start() }
    handler = Handler(thread.looper)
    sensorManager = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!wasRunning(this)) {
      // A stale alarm after the user stopped capture.
      isRunning = false
      stopSelf()
      return START_NOT_STICKY
    }
    if (!enterForeground()) {
      isRunning = false
      if (!hasActivityRecognitionPermission(this)) prefs(this).edit().putBoolean(KEY_RUNNING, false).apply()
      stopSelf()
      return START_NOT_STICKY
    }
    isRunning = true
    val window = prefs(this).getInt(KEY_WINDOW, 10)
    val period = prefs(this).getInt(KEY_PERIOD, 120)
    handler.post {
      windowSeconds = window
      periodSeconds = period
      beginWindow()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    cancelAlarm(this)
    handler.removeCallbacks(endWindow)
    handler.post {
      sensorManager?.unregisterListener(this)
      capturing = false
      releaseWakeLock()
    }
    thread.quitSafely()
    super.onDestroy()
  }

  private fun enterForeground(): Boolean {
    // The health type requires ACTIVITY_RECOGNITION on Android 14+; startForeground throws without it.
    if (!hasActivityRecognitionPermission(this)) return false
    return try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
      true
    } catch (e: Exception) {
      Log.w(TAG, "startForeground failed", e)
      false
    }
  }

  private fun buildNotification(): Notification {
    NotificationManagerCompat.from(this).createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName("Activity tracking")
        .setShowBadge(false)
        .build()
    )
    val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.motion_activity_notification_icon)
      .setContentTitle("WellTrack is noting your activity")
      .setContentIntent(contentIntent)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
  }

  private fun beginWindow() {
    if (capturing || !isRunning) return
    val sm = sensorManager ?: return
    val accSensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return

    scheduleNextWindow()
    capturing = true
    acquireWakeLock()
    acc.clear()
    gyro.clear()
    startedAtMs = System.currentTimeMillis()
    sm.registerListener(this, accSensor, SAMPLING_PERIOD_US, handler)
    hasGyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { sm.registerListener(this, it, SAMPLING_PERIOD_US, handler) } ?: false
    handler.postDelayed(endWindow, windowSeconds * 1000L)
  }

  private fun finishWindow() {
    sensorManager?.unregisterListener(this)
    try {
      if (acc.size > 0) ChunkStore.write(this, startedAtMs, acc, if (hasGyro && gyro.size > 0) gyro else null)
    } catch (e: Exception) {
      Log.w(TAG, "Saving sensor chunk failed", e)
    }
    capturing = false
    releaseWakeLock()
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (!capturing) return
    val t = event.timestamp / 1_000_000_000.0
    val v = event.values
    when (event.sensor.type) {
      // Match expo-sensors: g including gravity.
      Sensor.TYPE_ACCELEROMETER -> acc.add(
        t,
        v[0] / SensorManager.GRAVITY_EARTH,
        v[1] / SensorManager.GRAVITY_EARTH,
        v[2] / SensorManager.GRAVITY_EARTH
      )
      Sensor.TYPE_GYROSCOPE -> gyro.add(t, v[0], v[1], v[2])
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  private fun scheduleNextWindow() {
    val alarms = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    // Inexact and allow-while-idle: no exact-alarm permission needed, but Doze can stretch the gap.
    alarms.setAndAllowWhileIdle(
      AlarmManager.ELAPSED_REALTIME_WAKEUP,
      SystemClock.elapsedRealtime() + periodSeconds * 1000L,
      capturePendingIntent(this)
    )
  }

  private fun acquireWakeLock() {
    val power = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WellTrack:MotionCapture").apply {
      setReferenceCounted(false)
      acquire(windowSeconds * 1000L + 10_000L) // Safety timeout.
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }
}
