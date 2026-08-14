import Foundation
import HealthKit
import WebKit

/// Native iOS bridge used by the Pace WKWebView.
/// Add this handler to the WKUserContentController under the name `paceHealthKit`.
/// The web app sends: { "action": "requestAuthorizationAndSync" }.
final class PaceHealthKitBridge: NSObject, WKScriptMessageHandler {
    private let store = HKHealthStore()
    private weak var webView: WKWebView?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "paceHealthKit", let body = message.body as? [String: Any], body["action"] as? String == "requestAuthorizationAndSync" else { return }
        requestAuthorizationAndSync()
    }

    private func requestAuthorizationAndSync() {
        guard HKHealthStore.isHealthDataAvailable() else {
            send(["ok": false, "status": "unavailable", "error": "Apple Santé est indisponible sur cet appareil."])
            return
        }

        let readTypes: Set<HKObjectType> = [
            HKObjectType.quantityType(forIdentifier: .stepCount),
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
            HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning),
            HKObjectType.quantityType(forIdentifier: .heartRate),
            HKObjectType.quantityType(forIdentifier: .bodyMass),
            HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
            HKObjectType.workoutType()
        ].compactMap { $0 }

        store.requestAuthorization(toShare: [], read: readTypes) { [weak self] success, error in
            guard let self else { return }
            if let error {
                self.send(["ok": false, "status": "authorization_error", "error": error.localizedDescription])
                return
            }
            guard success else {
                self.send(["ok": false, "status": "permission_missing"])
                return
            }
            self.syncRecentData()
        }
    }

    private func syncRecentData() {
        let end = Date()
        let start = Calendar.current.date(byAdding: .day, value: -7, to: end) ?? end.addingTimeInterval(-7 * 86400)
        let types: [(HKQuantityTypeIdentifier, String, HKUnit)] = [
            (.stepCount, "steps", HKUnit.count()),
            (.activeEnergyBurned, "kcal_active", HKUnit.kilocalorie()),
            (.distanceWalkingRunning, "distance_m", HKUnit.meter()),
            (.heartRate, "heart_rate", HKUnit.count().unitDivided(by: .minute())),
            (.bodyMass, "weight_kg", HKUnit.gramUnit(with: .kilo))
        ]

        var samples: [[String: Any]] = []
        let group = DispatchGroup()

        for (identifier, paceType, unit) in types {
            guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else { continue }
            group.enter()
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKSampleQuery(sampleType: quantityType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { [weak self] _, results, _ in
                defer { group.leave() }
                for case let sample as HKQuantitySample in results ?? [] {
                    let value = sample.quantity.doubleValue(for: unit)
                    samples.append(["ts": ISO8601DateFormatter().string(from: sample.startDate), "type": paceType, "value": value, "source": "apple_health"])
                }
                _ = self
            }
            store.execute(query)
        }

        group.notify(queue: .main) { [weak self] in
            self?.send(["ok": true, "status": "synced", "samples": samples])
        }
    }

    private func send(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        let escaped = json.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        webView?.evaluateJavaScript("window.PaceAppleHealth && window.PaceAppleHealth._receive(JSON.parse('\(escaped)'))")
    }
}
