import ActivityKit
import WidgetKit
import SwiftUI

struct WavoLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WavoActivityAttributes.self) { context in
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.indigo.opacity(0.22))
                    Text(context.attributes.kind == "come" ? "⚡" : "🌊")
                        .font(.title3)
                }
                .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 3) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .lineLimit(1)
                    if !context.state.subtitle.isEmpty {
                        Text(context.state.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    HStack(spacing: 7) {
                        Text(timerInterval: Date()...max(context.state.startsAt, context.state.endsAt), countsDown: true)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                        if context.state.participantCount > 0 {
                            Text("· \(context.state.participantCount) going")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .activityBackgroundTint(Color.black.opacity(0.88))
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: context.attributes.deepLink))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.kind == "come" ? "⚡" : "🌊")
                        .font(.title3)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date()...max(context.state.startsAt, context.state.endsAt), countsDown: true)
                        .font(.caption.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.subtitle.isEmpty ? context.state.detail : context.state.subtitle)
                            .font(.caption)
                            .lineLimit(1)
                        Spacer()
                        if context.state.participantCount > 0 {
                            Text("\(context.state.participantCount) going")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } compactLeading: {
                Text(context.attributes.kind == "come" ? "⚡" : "🌊")
            } compactTrailing: {
                Text(timerInterval: Date()...max(context.state.startsAt, context.state.endsAt), countsDown: true)
                    .font(.caption2.monospacedDigit())
                    .frame(maxWidth: 46)
            } minimal: {
                Text("⚡")
            }
            .widgetURL(URL(string: context.attributes.deepLink))
            .keylineTint(.indigo)
        }
    }
}
