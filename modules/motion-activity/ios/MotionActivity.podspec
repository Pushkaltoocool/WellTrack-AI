Pod::Spec.new do |s|
  s.name           = 'MotionActivity'
  s.version        = '1.0.0'
  s.summary        = 'Core Motion activity history for WellTrack AI'
  s.description    = 'Reads CMMotionActivityManager history and keeps the app alive during recordings for WellTrack AI.'
  s.license        = 'MIT'
  s.author         = 'WellTrack AI'
  s.homepage       = 'https://github.com/Pushkaltoocool/WellTrack-AI'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreMotion', 'CoreLocation', 'UIKit'

  s.source_files = '**/*.swift'
end
