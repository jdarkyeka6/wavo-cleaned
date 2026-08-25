# Wavo Waves: product and safety guardrails

Waves is an optional sharing layer inside Wavo. Its purpose is to help people communicate richer updates with people they have deliberately connected with, not to distribute content to a public audience.

## Core product rules

- A Wave can be shared with **All Friends**, **Selected People**, or **a Wavo group the author already belongs to**.
- There is no public audience option.
- Friend relationships are based on accepted Wavo friend requests.
- Selected-person Waves still require the recipient to be an accepted friend.
- Group Waves are visible only to current members of that group. Group membership is enforced by database row-level security, not UI state.
- Existing block rules remain enforced for Waves.
- Photos and videos are stored in the private `wave-media` bucket and are served with time-limited signed URLs.
- Videos are capped at 60 seconds and 50 MB. Photos are capped at 10 MB in the client.
- The Waves feed is chronological and finite. The first 30 are shown, then the user deliberately chooses **Show older Waves**.
- There is no public discovery feed, public posting, follower system, hashtag discovery, recommended-creators system, viral ranking or autoplay-next-video loop.
- Reactions are lightweight. The Waves UI does not display public reaction totals or view counts.
- Replies to a friend Wave are sent into a Wavo direct message. Replies to a group Wave are sent into that Wavo group conversation rather than a public comments section.
- Waves persist until their author deletes them. They are not 24-hour Stories.
- Audience presets such as Family or Close Friends are private to their owner and are protected with RLS.

## Messaging-first boundary

Waves should remain secondary to Wavo's communication features. New Waves features should be reviewed before shipping if they introduce public distribution, algorithmic recommendations, endless consumption, public popularity metrics, broad creator-following behavior or time-limited content.

This document is a product-design record, not a legal determination. Product behavior and applicable requirements should be reassessed when the service materially changes.

## Engineering checklist for new Waves features

Before merging a new feature, check:

1. Can someone see a Wave without either an accepted friendship, explicit selected audience access, or current membership in the Wave's group? If yes, stop and review the design.
2. Does Wavo choose the audience algorithmically? If yes, stop and review the design.
3. Can the user reach a real end to the current feed? Keep the answer yes.
4. Does the feature expose popularity metrics such as public like, reaction, follower or view counts? Keep the answer no by default.
5. Does a reply naturally lead back into messaging? Prefer yes.
6. Is access enforced by RLS/storage policy rather than UI-only checks? It must be.
7. Is private media stored outside public buckets? It must be.
8. Have block, unfriend, group-leave and audience-change cases been tested with a second account?
