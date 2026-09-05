import Foundation
import ActivityKit
import Capacitor

@objc(WavoLiveActivityPlugin)
public class WavoLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public static let shared = WavoLiveActivityPlugin()

    public let identifier = "WavoLiveActivityPlugin"
    public let jsName = "WavoLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    private func parseDate(_ raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    @objc func getState(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["supported": false, "enabled": false, "activities": []])
            return
        }
        let auth = ActivityAuthorizationInfo()
        let activities = Activity<WavoActivityAttributes>.activities.map { activity in
            [
                "id": activity.id,
                "title": activity.attributes.title,
                "kind": activity.attributes.kind
            ]
        }
        call.resolve([
            "supported": true,
            "enabled": auth.areActivitiesEnabled,
            "activities": activities
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1 or later")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities are disabled for Wavo")
            return
        }

        let title = call.getString("title")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Wavo"
        let kind = call.getString("kind") ?? "come"
        let subtitle = call.getString("subtitle") ?? ""
        let detail = call.getString("detail") ?? ""
        let participantCount = call.getInt("participantCount") ?? 0
        let now = Date()
        let startsAt = parseDate(call.getString("startsAt")) ?? now
        let endsAt = parseDate(call.getString("endsAt")) ?? startsAt.addingTimeInterval(7200)
        let deepLink = call.getString("deepLink") ?? "wavo://together"

        let attributes = WavoActivityAttributes(kind: kind, title: title, deepLink: deepLink)
        let state = WavoActivityAttributes.ContentState(
            subtitle: subtitle,
            detail: detail,
            participantCount: participantCount,
            startsAt: startsAt,
            endsAt: endsAt
        )

        do {
            let activity: Activity<WavoActivityAttributes>
            if #available(iOS 16.2, *) {
                let content = ActivityContent(state: state, staleDate: endsAt)
                activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
            } else {
                activity = try Activity.request(attributes: attributes, contentState: state, pushType: nil)
            }
            call.resolve(["id": activity.id])
        } catch {
            call.reject("Could not start Live Activity: \(error.localizedDescription)")
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1 or later")
            return
        }
        guard let id = call.getString("id"),
              let activity = Activity<WavoActivityAttributes>.activities.first(where: { $0.id == id }) else {
            call.reject("Live Activity not found")
            return
        }

        let current = activity.contentState
        let startsAt = parseDate(call.getString("startsAt")) ?? current.startsAt
        let endsAt = parseDate(call.getString("endsAt")) ?? current.endsAt
        let next = WavoActivityAttributes.ContentState(
            subtitle: call.getString("subtitle") ?? current.subtitle,
            detail: call.getString("detail") ?? current.detail,
            participantCount: call.getInt("participantCount") ?? current.participantCount,
            startsAt: startsAt,
            endsAt: endsAt
        )

        Task {
            if #available(iOS 16.2, *) {
                await activity.update(ActivityContent(state: next, staleDate: endsAt))
            } else {
                await activity.update(using: next)
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve()
            return
        }
        let requestedId = call.getString("id")
        let targets = Activity<WavoActivityAttributes>.activities.filter { requestedId == nil || $0.id == requestedId }
        Task {
            for activity in targets {
                if #available(iOS 16.2, *) {
                    await activity.end(nil, dismissalPolicy: .immediate)
                } else {
                    await activity.end(dismissalPolicy: .immediate)
                }
            }
            call.resolve()
        }
    }
}
