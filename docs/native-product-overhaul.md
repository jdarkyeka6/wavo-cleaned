# Wavo native product overhaul

This document is for the iOS/Capacitor product only. It does not change the public website.

## Product position

**Wavo is the social app where talking turns into doing.**

Messaging is the foundation. Plans are the reason the experience is distinct: time, place, notes and live RSVPs stay in the conversation instead of being split across chat, calendar and polls.

## Brand system

- Personality: premium, social, bold, quick and human.
- Primary canvas: near-black `#07080D`.
- Primary action: electric mint `#61F2B1`.
- Highlight: acid lime `#B6FF74`.
- Utility accent: soft blue `#75A7FF`.
- Shape language: 18–28 px radii, compact controls and generous content spacing.
- Logo direction: a single flowing W/wave mark, mint-to-lime on black. Avoid speech bubbles; they make Wavo look like a generic messenger.
- Motion: short spring responses on taps, restrained sheet transitions and live RSVP count changes. Respect Reduced Motion.

## Navigation overhaul

### Phone

1. **Home** — recent DMs and groups, unread state, upcoming plans.
2. **People** — friends, requests and discovery.
3. **Create** — central action sheet for New message, New group and Make a plan.
4. **Activity** — replies, reactions, invites and plan changes.
5. **You** — profile, appearance, privacy, notifications and account.

Opening a conversation replaces the tab bar with the conversation composer. Back returns to the same list position.

### Tablet

Use a two-column layout: navigation and conversation list on the left, active conversation on the right. Plans and profile details open as a trailing panel when space allows.

## Screen redesign

### Home

- Greeting and avatar at the top; search remains one tap away.
- “Coming up” carousel leads with the next active plan.
- Conversation rows show avatar, display name, final message, time and unread count.
- Pinned conversations are a small section, not a separate destination.
- Empty state leads to Find people or Start a group.

### Conversation

- Header: identity, status and one overflow menu. Search, pins, games and safety actions move into a structured sheet.
- Composer: attachment, text/voice mode and send. Secondary actions live in the attachment sheet.
- Messages group visually by sender and time.
- Reactions, reply, pin and scheduling appear on long press.
- Plans render as full-width interactive cards with date, location, map action and Going/Maybe/Can't.
- “Make a plan” is the first conversation action, not buried beside moderation controls.

### Create flow

The centre Create action opens one native sheet:

- Make a plan
- New message
- New group

A plan asks for title and time first. Place, address and notes remain optional. The creator starts as Going. Confirmation returns directly to the new card in its conversation.

### Activity

Group events by Today, This week and Earlier. Combine repeated reactions. Plan changes use explicit language such as “Friday Dinner moved to 7:30 pm.”

### Profile and settings

- Profile preview leads; editing is a separate, focused screen.
- Settings are grouped into Account, Appearance, Notifications, Privacy & Safety, Premium and Help.
- Destructive actions stay in a final red section.
- Premium cosmetics remain optional and never hide core communication or planning.

## App Store presentation

### Subtitle

**Chat, plan and meet up**

### Promotional text

**Turn the conversation into a plan. Pick the time and place, share it in any chat, and see who's in—live.**

### First screenshot

Headline: **MAKE PLANS. NOT MORE GROUP CHATS.**

Supporting line: **Choose the time, share the place and see who's coming—inside the conversation.**

Show:

- a populated conversation;
- a plan card titled “Friday Night”;
- date and time;
- a recognisable place with map affordance;
- Going, Maybe and Can't with non-zero counts;
- at least one selected RSVP.

### Screenshot sequence

1. **Make plans inside the chat** — hero plan card.
2. **Know who's in** — live RSVP states and names.
3. **Everything stays together** — messages surrounding a plan.
4. **Your people, one place** — premium Home/conversation list.
5. **Make it yours** — profile and cosmetics.

Do not lead with a generic inbox, login screen or ordinary message bubbles.

## App Review notes

Wavo now includes structured, collaborative planning directly inside both direct and group conversations. A plan contains a date and time, optional place with a Maps link, notes, and live Going, Maybe and Can't responses.

To review the feature, open any conversation, choose **Make a plan**, enter a title and time, then create it. The plan appears as an interactive card in the message thread. Other participants can respond there and the counts update in real time.

This is Wavo's core distinction from a standard messenger: people can move from discussing an activity to organising it without leaving the conversation.

## Release guardrails

- The browser build must not receive the native design system.
- Existing messages, groups, plans, games, safety tools and account deletion must remain functional.
- No core feature may require Premium.
- Every redesigned flow must work at iPhone width in light text scaling and at larger accessibility text sizes.
- The App Store build must be tested in dark and light system appearance even if Wavo's default canvas remains dark.
