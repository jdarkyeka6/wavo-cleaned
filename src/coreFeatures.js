export const ESSENTIAL_FEATURES = [
  { id: "messages", label: "Messages", emoji: "💬", hint: "Always available in Wavo." },
  { id: "search", label: "Search", emoji: "🔎", hint: "Always available in Wavo." },
  { id: "profile", label: "You", emoji: "👤", hint: "Your profile, privacy and settings are always available." },
];

// Core is only the customizable layer. Messages, Search and You are permanent
// Wavo essentials and are deliberately not removable or reorderable here.
export const CORE_FEATURES = [
  { id: "hop_in", label: "Hop In", emoji: "🎧", hint: "Jump into a live hangout without the ringing ceremony." },
  { id: "waves", label: "Waves", emoji: "〰️", hint: "Quick updates from your people." },
  { id: "photos", label: "Photos", emoji: "📸", hint: "Photo and video sharing through Waves." },
  { id: "plans", label: "Plans", emoji: "📅", hint: "What is happening next and who is coming." },
  { id: "spaces", label: "Spaces", emoji: "🫧", hint: "Your groups, families, teams and crews." },
  { id: "games", label: "Play", emoji: "🎮", hint: "Open Wavo Together straight into Play." },
  { id: "create", label: "Create", emoji: "＋", hint: "Start a post, Wave, plan, poll or activity." },
];

export const DEFAULT_CORE_FEATURES = ["hop_in", "waves", "photos", "spaces"];

export function getCoreFeature(id) {
  return CORE_FEATURES.find((feature) => feature.id === id);
}

export function normalizeCoreFeatures(value) {
  const customizable = new Set(CORE_FEATURES.map((feature) => feature.id));
  const next = Array.isArray(value) ? value.filter((id) => customizable.has(id)) : [];
  return [...new Set(next)].slice(0, 6);
}
