export const CORE_FEATURES = [
  { id: "messages", label: "Messages", emoji: "💬", hint: "Chats with the people you keep close." },
  { id: "hop_in", label: "Hop In", emoji: "🎧", hint: "Jump into a live hangout without the ringing ceremony." },
  { id: "waves", label: "Waves", emoji: "〰️", hint: "Quick updates from your people." },
  { id: "photos", label: "Photos", emoji: "📸", hint: "Photo and video sharing through Waves." },
  { id: "plans", label: "Plans", emoji: "📅", hint: "What is happening next and who is coming." },
  { id: "spaces", label: "Spaces", emoji: "🫧", hint: "Your groups, families, teams and crews." },
  { id: "games", label: "Play", emoji: "🎮", hint: "Open Wavo Together straight into Play." },
  { id: "search", label: "Search", emoji: "🔎", hint: "Find people, Spaces, messages and plans." },
  { id: "create", label: "Create", emoji: "＋", hint: "Start a post, Wave, plan, poll or activity." },
  { id: "profile", label: "You", emoji: "👤", hint: "Your profile, privacy and settings." },
];

export const DEFAULT_CORE_FEATURES = ["messages", "hop_in", "waves", "spaces"];

export function getCoreFeature(id) {
  return CORE_FEATURES.find((feature) => feature.id === id);
}

export function normalizeCoreFeatures(value) {
  const known = new Set(CORE_FEATURES.map((feature) => feature.id));
  const next = Array.isArray(value) ? value.filter((id) => known.has(id)) : [];
  return [...new Set(next)].slice(0, 6);
}
