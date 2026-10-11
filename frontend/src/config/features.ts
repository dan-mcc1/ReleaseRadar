// Centralized feature-tier configuration.
//
// Set a feature to true  → requires a Premium subscription.
// Set a feature to false → available to all logged-in users.
//
// Changing a value here automatically updates all UI gates.
// Mirror any changes in backend/app/config/features.py so the
// backend enforcement stays in sync.

export const PREMIUM_FEATURES = {
  shelves: false,
  rewatch: false,
  watchTimeStats: false,
  icalSync: false,
  bingePlanner: false,
  finishByGoal: false,
  watchlistNotifyPrompt: false,
  notificationSettings: false,
} as const;

export type Feature = keyof typeof PREMIUM_FEATURES;

/**
 * Open beta: the Stripe upgrade buttons are hidden behind a "Currently in
 * Beta" placeholder. Set to true at paywall launch, together with the
 * backend's is_premium() in app/dependencies/subscription.py.
 */
export const CHECKOUT_ENABLED = false;

/** Returns true if the feature requires a Premium subscription. */
export function isPremiumFeature(feature: Feature): boolean {
  return PREMIUM_FEATURES[feature];
}
