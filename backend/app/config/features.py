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
    "rewatch": True,
    "watch_time_stats": True,
    "ical_sync": True,
    "binge_planner": False,
    "finish_by_goal": False,
    "watchlist_notify_prompt": True,
    "notification_settings": True,
}
