import CoreMotion
import ExpoModulesCore

// Core Motion keeps roughly 7 days of activity history.
private let historyLimit: TimeInterval = 7 * 24 * 60 * 60

public final class MotionActivityModule: Module {
  private lazy var manager = CMMotionActivityManager()
  private lazy var queue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "welltrack.motion-activity"
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  // Only creates a CLLocationManager on first use (on the main thread), so this is cheap.
  private let keepAlive = RecordingKeepAlive()

  public func definition() -> ModuleDefinition {
    Name("MotionActivity")

    Function("isActivityAvailable") { () -> Bool in
      CMMotionActivityManager.isActivityAvailable()
    }

    AsyncFunction("getPermissionStatus") { () -> String in
      Self.permissionStatus()
    }

    AsyncFunction("requestPermission") { (promise: Promise) in
      guard Self.canUseCoreMotion, CMMotionActivityManager.authorizationStatus() == .notDetermined else {
        promise.resolve(Self.permissionStatus())
        return
      }
      // Core Motion has no explicit request API; the first query shows the system prompt and its
      // handler runs once the user answers.
      let now = Date()
      manager.queryActivityStarting(from: now.addingTimeInterval(-60), to: now, to: queue) { _, _ in
        promise.resolve(Self.permissionStatus())
      }
    }

    AsyncFunction("queryActivityPoints") { (fromMs: Double, toMs: Double, promise: Promise) in
      // Never query unless authorized: a query is what triggers the permission prompt.
      guard Self.canUseCoreMotion, CMMotionActivityManager.authorizationStatus() == .authorized else {
        promise.resolve([[String: Any]]())
        return
      }
      let to = Date(timeIntervalSince1970: toMs / 1000)
      let from = max(Date(timeIntervalSince1970: fromMs / 1000), Date().addingTimeInterval(-historyLimit))
      guard from < to else {
        promise.resolve([[String: Any]]())
        return
      }

      manager.queryActivityStarting(from: from, to: to, to: queue) { activities, error in
        if let error {
          // Authorization can change between the check above and the callback.
          if CMMotionActivityManager.authorizationStatus() != .authorized {
            promise.resolve([[String: Any]]())
          } else {
            promise.reject(MotionQueryException().causedBy(error))
          }
          return
        }
        let points: [[String: Any]] = (activities ?? [])
          .sorted { $0.startDate < $1.startDate }
          .map { activity in
            [
              "t": activity.startDate.timeIntervalSince1970 * 1000,
              "type": Self.dominantType(activity),
              "confidence": Self.confidence(activity.confidence)
            ]
          }
        promise.resolve(points)
      }
    }

    // iOS needs no registration: the OS records history on its own.
    AsyncFunction("startActivityUpdates") { () -> Bool in
      CMMotionActivityManager.isActivityAvailable()
    }

    AsyncFunction("stopActivityUpdates") {}

    // Recording keep-alive. CLLocationManager is main-thread bound, so these run on the main queue.
    AsyncFunction("startRecordingKeepAlive") { (title: String, body: String, startedAtMs: Double) -> Bool in
      // iOS shows its own background-location indicator; the notification text is Android only.
      keepAlive.start()
    }.runOnQueue(.main)

    AsyncFunction("updateRecordingKeepAlive") { (title: String, body: String) in
      // No-op on iOS.
    }

    AsyncFunction("stopRecordingKeepAlive") {
      keepAlive.stop()
    }.runOnQueue(.main)

    Function("isRecordingKeepAliveActive") { () -> Bool in
      keepAlive.isActive
    }

    AsyncFunction("getKeepAlivePermission") { () -> String in
      keepAlive.permissionStatus()
    }.runOnQueue(.main)

    AsyncFunction("requestKeepAlivePermission") { (promise: Promise) in
      keepAlive.requestPermission(promise)
    }.runOnQueue(.main)

    OnDestroy {
      let keepAlive = self.keepAlive
      DispatchQueue.main.async {
        keepAlive.stop()
      }
    }
  }

  // Touching Core Motion without NSMotionUsageDescription terminates the app, so check first.
  private static var canUseCoreMotion: Bool {
    Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") != nil
      && CMMotionActivityManager.isActivityAvailable()
  }

  private static func permissionStatus() -> String {
    guard canUseCoreMotion else {
      return "unavailable"
    }
    switch CMMotionActivityManager.authorizationStatus() {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "undetermined"
    @unknown default: return "undetermined"
    }
  }

  // Several flags can be set at once; pick by priority.
  private static func dominantType(_ activity: CMMotionActivity) -> String {
    if activity.automotive { return "automotive" }
    if activity.cycling { return "cycling" }
    if activity.running { return "running" }
    if activity.walking { return "walking" }
    if activity.stationary { return "stationary" }
    return "unknown"
  }

  private static func confidence(_ confidence: CMMotionActivityConfidence) -> String {
    switch confidence {
    case .high: return "high"
    case .medium: return "medium"
    case .low: return "low"
    @unknown default: return "low"
    }
  }
}

internal final class MotionQueryException: Exception {
  override var reason: String {
    "Core Motion activity query failed"
  }
}
