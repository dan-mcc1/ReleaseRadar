# Centralized feature-tier configuration.
#
# Set a feature to True  → requires a Premium subscription.
# Set a feature to False → available to all logged-in users.
#
# Changing a value here automatically updates both the backend enforcement
# (via feature_gate() in app/dependencies/subscription.py) and should be
# mirrored in frontend/src/config/features.ts so the UI gates match.

PREMIUM_FEATURES: dict[str, bool] = {
    "shelves": False,
    "rewatch": False,
    "watch_time_stats": False,
    "ical_sync": False,
    "binge_planner": False,
    "finish_by_goal": False,
    "watchlist_notify_prompt": False,
    "notification_settings": False,
}
