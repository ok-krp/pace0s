# Pace iOS HealthKit bridge

Pace Web/PWA cannot access Apple Health directly. The native iOS container must enable the **HealthKit** capability and register `PaceHealthKitBridge` as a `WKScriptMessageHandler` named `paceHealthKit`.

Required Info.plist usage descriptions:

- `NSHealthShareUsageDescription`: `Pace utilise vos données de santé pour afficher votre activité, sommeil, fréquence cardiaque et poids dans votre tableau de bord.`
- `NSHealthUpdateUsageDescription`: `Pace peut enregistrer les données de santé que vous choisissez de partager.`

Required entitlement:

```xml
<key>com.apple.developer.healthkit</key>
<true/>
```

The bridge reads real HealthKit data only after Apple's system authorization sheet. It sends normalized samples to the existing Pace WebView bridge, which persists them through `insertHealthSamples`.

## Mi Fitness on iPhone

Pace does not request Xiaomi credentials or use an undocumented Mi Fitness API. Xiaomi officially supports synchronizing Mi Fitness data to Apple Health through **Mi Fitness → Profile → Third-party data → Health**. Pace then reads the resulting HealthKit data through the native iOS bridge.

## Required native integration

```swift
let bridge = PaceHealthKitBridge(webView: webView)
webView.configuration.userContentController.add(bridge, name: "paceHealthKit")
```

An Apple Developer team/signing configuration is required before this native iOS target can be distributed or installed on a physical device.
