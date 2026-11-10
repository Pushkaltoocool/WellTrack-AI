import CoreLocation
import ExpoModulesCore
import UIKit

/**
 Keeps the app process running while the user records a labelled activity with the screen locked.
 It runs continuous, coarse location updates (the blue background-location indicator stays visible)
 and throws every location away: coordinates are never stored, logged or forwarded.

 Threading: every method must be called on the main thread. The module runs the matching
 AsyncFunctions with `.runOnQueue(.main)`, and the manager is created on the main thread, so its
 delegate callbacks arrive there too. Only `isActive` may be read from any thread.
 */
internal final class RecordingKeepAlive: NSObject, CLLocationManagerDelegate {
  private var manager: CLLocationManager?
  private var pendingRequests: [Promise] = []

  private let activeLock = NSLock()
  private var _active = false

  var isActive: Bool {
    activeLock.lock()
    defer { activeLock.unlock() }
    return _active
  }

  private func setActive(_ value: Bool) {
    activeLock.lock()
    _active = value
    activeLock.unlock()
  }

  // MARK: - Configuration checks

  // Without the usage description iOS never shows the prompt and location can't be used.
  private static var hasUsageDescription: Bool {
    Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil
  }

  // Setting `allowsBackgroundLocationUpdates` without the `location` background mode raises an
  // Objective-C exception that Swift can't catch, so check before touching it.
  private static var hasLocationBackgroundMode: Bool {
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    return modes.contains("location")
  }

  private static var isConfigured: Bool {
    hasUsageDescription && hasLocationBackgroundMode
  }

  private func ensureManager() -> CLLocationManager {
    if let manager {
      return manager
    }
    let created = CLLocationManager()
    created.delegate = self
    manager = created
    return created
  }

  private static func isGranted(_ status: CLAuthorizationStatus) -> Bool {
    status == .authorizedWhenInUse || status == .authorizedAlways
  }

  private static func permissionString(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .authorizedWhenInUse, .authorizedAlways: return "granted"
    case .denied, .restricted: return "denied"
    case .notDetermined: return "undetermined"
    @unknown default: return "undetermined"
    }
  }

  // MARK: - Permission

  func permissionStatus() -> String {
    guard Self.isConfigured else {
      return "unavailable"
    }
    return Self.permissionString(ensureManager().authorizationStatus)
  }

  /// Resolves once the user has answered the prompt, or right away when there is nothing to ask.
  func requestPermission(_ promise: Promise) {
    guard Self.isConfigured else {
      promise.resolve("unavailable")
      return
    }
    let manager = ensureManager()
    guard manager.authorizationStatus == .notDetermined else {
      promise.resolve(Self.permissionString(manager.authorizationStatus))
      return
    }
    pendingRequests.append(promise)
    if pendingRequests.count == 1 {
      manager.requestWhenInUseAuthorization()
    }
  }

  // MARK: - Keep-alive

  /// Must be called while the app is in the foreground: with when-in-use authorization, background
  /// updates only continue if they were started in the foreground.
  func start() -> Bool {
    guard Self.isConfigured else {
      return false
    }
    let manager = ensureManager()
    guard Self.isGranted(manager.authorizationStatus) else {
      return false
    }
    if isActive {
      return true
    }
    let inBackground = MainActor.assumeIsolated {
      UIApplication.shared.applicationState == .background
    }
    guard !inBackground else {
      return false
    }

    manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
    manager.distanceFilter = kCLDistanceFilterNone
    manager.activityType = .fitness
    manager.pausesLocationUpdatesAutomatically = false
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
    manager.startUpdatingLocation()
    setActive(true)
    return true
  }

  func stop() {
    guard isActive else {
      return
    }
    setActive(false)
    guard let manager else {
      return
    }
    manager.stopUpdatingLocation()
    // Only reachable after `start()` verified the background mode, so this can't raise.
    manager.allowsBackgroundLocationUpdates = false
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // Intentionally empty: updates only keep the process alive. Locations are discarded unread.
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // Transient failures (e.g. `locationUnknown`) don't stop updates. A revoked authorization is
    // handled in `locationManagerDidChangeAuthorization`.
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    // Also called right after the manager is created, with the current (possibly undetermined) status.
    if status != .notDetermined && !pendingRequests.isEmpty {
      let result = Self.permissionString(status)
      let requests = pendingRequests
      pendingRequests.removeAll()
      for promise in requests {
        promise.resolve(result)
      }
    }
    if isActive && !Self.isGranted(status) {
      stop()
    }
  }
}
