require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  # iOS stub — this module is Android-only
  s.name           = 'dash-voice-orb'
  s.version        = package['version']
  s.summary        = package['description'] || 'z0live voice orb overlay'
  s.author         = package['author'] || 'kvnloo'
  s.homepage       = 'https://github.com/kvnloo/dash'
  s.license        = 'MIT'
  s.platforms      = { ios: '15.1' }
  s.source         = { git: '' }
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
end
