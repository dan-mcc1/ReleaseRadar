// Centralized feature-tier configuration.
//
// Set a feature to true  → requires a Premium subscription.
// Set a feature to false → available to all logged-in users.
//
// Changing a value here automatically updates all UI gates.
// Mirror any changes in backend/app/config/features.py so the
// backend enforcement stays in sync.

export const PREMIUM_FEATURES = {
  shelves: true,
  rewatch: true,
  watchTimeStats: true,
  icalSync: true,
  bingePlanner: false,
  watchlistNotifyPrompt: true,
  notificationSettings: true,
} as const;

export type Feature = keyof typeof PREMIUM_FEATURES;

/** Returns true if the feature requires a Premium subscription. */
export function isPremiumFeature(feature: Feature): boolean {
  return PREMIUM_FEATURES[feature];
}
