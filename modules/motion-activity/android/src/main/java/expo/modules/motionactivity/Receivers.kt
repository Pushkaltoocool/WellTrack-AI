package expo.modules.motionactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.location.ActivityTransitionResult

/** Receives Activity Recognition transitions and appends them to the log. */
class TransitionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityTransitionResult.hasResult(intent)) return
    val result = ActivityTransitionResult.extractResult(intent) ?: return
    val lines = TransitionStore.linesFor(result)
    if (lines.isEmpty()) return

    val app = context.applicationContext
    val pending = goAsync()
    TransitionStore.io.execute {
      try {
        TransitionStore.append(app, lines)
      } catch (e: Exception) {
        Log.w(TAG, "Saving transitions failed", e)
      } finally {
        pending.finish()
      }
    }
  }
}

/** Restores whatever the user had enabled after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val app = context.applicationContext

    // Start the service while still inside the broadcast: that is what exempts it from the
    // background foreground-service start restrictions.
    if (SensorCaptureService.wasRunning(app)) SensorCaptureService.restore(app)

    if (!TransitionStore.isEnabled(app)) return
    val pending = goAsync()
    TransitionStore.io.execute {
      try {
        if (action == Intent.ACTION_BOOT_COMPLETED) {
          // Whatever was in progress before shutdown ended no later than boot.
          TransitionStore.appendGap(app, System.currentTimeMillis() - SystemClock.elapsedRealtime())
        }
        TransitionStore.register(app)
      } catch (e: Exception) {
        Log.w(TAG, "Restoring activity transitions failed", e)
      } finally {
        pending.finish()
      }
    }
  }
}
