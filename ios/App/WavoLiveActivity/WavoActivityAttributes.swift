import Foundation
import ActivityKit

@available(iOS 16.1, *)
struct WavoActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var subtitle: String
        var detail: String
        var participantCount: Int
        var startsAt: Date
        var endsAt: Date
    }

    var kind: String
    var title: String
    var deepLink: String
}
