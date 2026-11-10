package expo.modules.motionactivity

import android.Manifest
import android.content.Context
import android.os.Build
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import expo.modules.interfaces.permissions.Permissions
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MotionActivityModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  // AsyncFunctions run on Expo's background module queue, so the file I/O and blocking
  // Play services calls below stay off the main thread.
  override fun definition() = ModuleDefinition {
    Name("MotionActivity")

    Function("isActivityAvailable") {
      val ctx = appContext.reactContext ?: return@Function false
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx) == ConnectionResult.SUCCESS
    }

    AsyncFunction("getPermissionStatus") { promise: Promise ->
      withActivityPermission(promise) { permissions, listener ->
        permissions.getPermissions(listener, Manifest.permission.ACTIVITY_RECOGNITION)
      }
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      withActivityPermission(promise) { permissions, listener ->
        permissions.askForPermissions(listener, Manifest.permission.ACTIVITY_RECOGNITION)
      }
    }

    AsyncFunction("queryActivityPoints") { fromMs: Double, toMs: Double ->
      TransitionStore.query(context, fromMs.toLong(), toMs.toLong())
    }

    AsyncFunction("startActivityUpdates") {
      val ctx = context
      val ok = TransitionStore.register(ctx)
      if (ok) TransitionStore.setEnabled(ctx, true)
      ok
    }

    AsyncFunction("stopActivityUpdates") {
      val ctx = context
      val wasEnabled = TransitionStore.isEnabled(ctx)
      TransitionStore.setEnabled(ctx, false)
      TransitionStore.unregister(ctx)
      if (wasEnabled) TransitionStore.appendGap(ctx, System.currentTimeMillis())
    }

    AsyncFunction("startSensorCapture") { windowSeconds: Int, periodSeconds: Int ->
      SensorCaptureService.start(context, windowSeconds, periodSeconds)
    }

    AsyncFunction("stopSensorCapture") {
      SensorCaptureService.stop(context)
    }

    Function("isSensorCaptureRunning") {
      SensorCaptureService.isRunning
    }

    AsyncFunction("readCapturedChunks") { limit: Int ->
      ChunkStore.read(context, limit)
    }

    AsyncFunction("deleteCapturedChunks") { ids: List<String> ->
      ChunkStore.delete(context, ids)
    }

    // Recording keep-alive: a foreground service so JS sensor listeners survive a locked screen.
    AsyncFunction("startRecordingKeepAlive") { title: String, body: String, startedAtMs: Double ->
      RecordingKeepAliveService.start(context, title, body, startedAtMs.toLong())
    }

    AsyncFunction("updateRecordingKeepAlive") { title: String, body: String ->
      RecordingKeepAliveService.update(context, title, body)
    }

    AsyncFunction("stopRecordingKeepAlive") {
      RecordingKeepAliveService.stop(context)
    }

    Function("isRecordingKeepAliveActive") {
      RecordingKeepAliveService.isActive
    }

    // No runtime permission of its own; ACTIVITY_RECOGNITION (Android 14+) and POST_NOTIFICATIONS
    // are requested separately.
    AsyncFunction("getKeepAlivePermission") {
      "granted"
    }

    AsyncFunction("requestKeepAlivePermission") {
      "granted"
    }
  }

  private fun withActivityPermission(
    promise: Promise,
    call: (Permissions, PermissionsResponseListener) -> Unit
  ) {
    // Not a runtime permission before Android 10.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.resolve("granted")
      return
    }
    val permissions = appContext.permissions ?: run {
      promise.resolve("unavailable")
      return
    }
    call(permissions, PermissionsResponseListener { result: Map<String, PermissionsResponse> ->
      promise.resolve(result[Manifest.permission.ACTIVITY_RECOGNITION]?.status?.status ?: "undetermined")
    })
  }
}
