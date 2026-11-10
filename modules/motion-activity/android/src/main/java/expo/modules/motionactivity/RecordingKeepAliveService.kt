package expo.modules.motionactivity

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service that keeps the process (and the JS sensor listeners in it) alive while the
 * user records a labelled activity with the screen off. It does no work itself: it shows an
 * ongoing notification with a running chronometer and holds a partial wake lock until stopped.
 * Independent of [SensorCaptureService] (own channel, notification id and wake lock).
 */
class RecordingKeepAliveService : Service() {
  private enum class Phase { IDLE, STARTING, FOREGROUND }

  companion object {
    private const val CHANNEL_ID = "welltrack_recording"
    private const val NOTIFICATION_ID = 0x4D42
    private const val WAKE_LOCK_TAG = "WellTrack:RecordingKeepAlive"
    private const val WAKE_LOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000L // Safety cap.

    private val lock = Any()

    // Guarded by [lock].
    private var phase = Phase.IDLE
    private var stopRequested = false
    private var current: RecordingKeepAliveService? = null
    private var title = ""
    private var body = ""
    private var startedAtMs = 0L

    val isActive: Boolean
      get() = synchronized(lock) { phase != Phase.IDLE && !stopRequested }

    /** Returns false when the service can't be started (permission missing, app in background). */
    fun start(context: Context, title: String, body: String, startedAtMs: Long): Boolean {
      // The health service type requires ACTIVITY_RECOGNITION on Android 14+; checking up front
      // avoids startForeground throwing after startForegroundService already succeeded.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && !hasActivityRecognitionPermission(context)) {
        return false
      }
      synchronized(lock) {
        this.title = title
        this.body = body
        this.startedAtMs = startedAtMs
        when (phase) {
          Phase.FOREGROUND -> {
            notifyUpdate(context)
            return true
          }
          Phase.STARTING -> {
            stopRequested = false
            return true
          }
          Phase.IDLE -> {
            phase = Phase.STARTING
            stopRequested = false
          }
        }
      }
      return try {
        ContextCompat.startForegroundService(context, Intent(context, RecordingKeepAliveService::class.java))
        true
      } catch (e: Exception) {
        // E.g. ForegroundServiceStartNotAllowedException when called from the background.
        Log.w(TAG, "Starting recording keep-alive failed", e)
        synchronized(lock) { phase = Phase.IDLE }
        false
      }
    }

    fun update(context: Context, title: String, body: String) {
      synchronized(lock) {
        this.title = title
        this.body = body
        if (phase == Phase.FOREGROUND) notifyUpdate(context)
        // While starting, onStartCommand picks up the new text.
      }
    }

    fun stop(context: Context) {
      synchronized(lock) {
        when (phase) {
          Phase.IDLE -> Unit
          // Stopping before startForeground runs would crash the app, so let onStartCommand stop it.
          Phase.STARTING -> stopRequested = true
          Phase.FOREGROUND -> {
            phase = Phase.IDLE
            current = null
            context.stopService(Intent(context, RecordingKeepAliveService::class.java))
          }
        }
      }
    }

    @SuppressLint("MissingPermission") // Checked below; FGS notification updates need it on 13+.
    private fun notifyUpdate(context: Context) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        return
      }
      try {
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, buildNotification(context))
      } catch (e: Exception) {
        Log.w(TAG, "Updating recording notification failed", e)
      }
    }

    /** Call with [lock] held. */
    private fun buildNotification(context: Context): Notification {
      NotificationManagerCompat.from(context).createNotificationChannel(
        NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
          .setName("Recording")
          .setDescription("Shown while an activity recording is running")
          .setShowBadge(false)
          .setSound(null, null)
          .setVibrationEnabled(false)
          .build()
      )
      val contentIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        PendingIntent.getActivity(context, 2, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.motion_activity_notification_icon)
        .setContentTitle(title)
        .setContentText(body)
        .setContentIntent(contentIntent)
        .setOngoing(true)
        .setSilent(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(true)
        .setWhen(startedAtMs)
        .setUsesChronometer(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .build()
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val stopNow: Boolean
    synchronized(lock) {
      // A service started with startForegroundService must call startForeground before stopping,
      // even when it's about to stop. Calling it again on a running service just refreshes it.
      if (!enterForeground()) {
        phase = Phase.IDLE
        stopRequested = false
        current = null
        stopSelf()
        return START_NOT_STICKY
      }
      val alreadyRunning = phase == Phase.FOREGROUND && current === this
      stopNow = !alreadyRunning && (phase != Phase.STARTING || stopRequested)
      if (stopNow) {
        phase = Phase.IDLE
        stopRequested = false
        current = null
      } else {
        phase = Phase.FOREGROUND
        current = this
      }
    }
    if (stopNow) {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
    } else {
      acquireWakeLock()
    }
    // Not sticky: if the process dies the JS recorder is gone too, so there's nothing to keep alive.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    releaseWakeLock()
    synchronized(lock) {
      // A newer start may already be pending; only reset state this instance owns.
      if (current === this) {
        phase = Phase.IDLE
        stopRequested = false
        current = null
      }
    }
    super.onDestroy()
  }

  /** Call with [lock] held. */
  private fun enterForeground(): Boolean = try {
    ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
    true
  } catch (e: Exception) {
    Log.w(TAG, "Recording keep-alive startForeground failed", e)
    false
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
      setReferenceCounted(false)
      acquire(WAKE_LOCK_TIMEOUT_MS)
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }
}
