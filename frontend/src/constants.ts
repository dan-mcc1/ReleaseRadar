export const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
export const BASE_IMAGE_URL = "https://image.tmdb.org/t/p"

export const AVATAR_PRESETS = [
  { key: "green",  color: "#10b981", label: "Green"  }, // primary-500
  { key: "purple", color: "#8b5cf6", label: "Purple" }, // highlight-500
  { key: "blue",   color: "#3b82f6", label: "Blue"   }, // info-500
  { key: "red",    color: "#ef4444", label: "Red"    }, // error-500
  { key: "orange", color: "#f97316", label: "Orange" },
  { key: "teal",   color: "#14b8a6", label: "Teal"   },
  { key: "pink",   color: "#ec4899", label: "Pink"   },
  { key: "yellow", color: "#eab308", label: "Yellow" }, // warning
] as const

export type AvatarKey = (typeof AVATAR_PRESETS)[number]["key"]

/** Returns the CSS color string for a given avatar key, or undefined if not found. */
export function getAvatarColor(key: string | null | undefined): string | undefined {
  return AVATAR_PRESETS.find((p) => p.key === key)?.color
}