import { useState } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { apiFetch } from "../utils/apiFetch";
import { useAuthUser } from "../hooks/useAuthUser";

const CATEGORIES = [
  { value: "bug", label: "Bug Report", description: "Something isn't working correctly" },
  { value: "feature", label: "Feature Request", description: "An idea or improvement you'd like to see" },
  { value: "general", label: "General Feedback", description: "Anything else on your mind" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

export default function FeedbackPage() {
  usePageTitle("Feedback");
  const user = useAuthUser();

  const [category, setCategory] = useState<Category>("bug");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject: subject.trim(), description: description.trim() }),
      });
      if (!res.ok) throw new Error("Request failed");
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Contact & Feedback</h1>
        <p className="text-neutral-400 text-sm">
          Report a bug, suggest a feature, or share any thoughts about Release Radar.
        </p>
      </div>

      {!user && (
        <div className="mb-6 rounded-lg border border-amber-800/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          You need to{" "}
          <Link to="/signIn" className="underline hover:text-amber-200">
            sign in
          </Link>{" "}
          to submit feedback.
        </div>
      )}

      {submitted ? (
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 px-6 py-8 text-center">
          <div className="text-3xl mb-3">✓</div>
          <h2 className="text-lg font-semibold text-white mb-2">Thanks for the feedback!</h2>
          <p className="text-neutral-400 text-sm mb-6">
            Your submission has been received. We read everything and appreciate you taking the time.
          </p>
          <button
            onClick={() => {
              setSubmitted(false);
              setSubject("");
              setDescription("");
              setCategory("bug");
            }}
            className="text-sm text-emerald-400 hover:text-emerald-300 underline"
          >
            Submit another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-3">
              What kind of feedback is this?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={[
                    "rounded-lg border px-4 py-3 text-left transition-colors",
                    category === cat.value
                      ? "border-emerald-600 bg-emerald-950/40 text-white"
                      : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
                  ].join(" ")}
                >
                  <div className="font-medium text-sm">{cat.label}</div>
                  <div className="text-xs mt-0.5 opacity-70">{cat.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-neutral-300 mb-1.5">
              Subject
            </label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              required
              placeholder={
                category === "bug"
                  ? "e.g. Episode counter not updating after mark as watched"
                  : category === "feature"
                  ? "e.g. Add ability to export watchlist to CSV"
                  : "e.g. Love the calendar view!"
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-neutral-300 mb-1.5">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              required
              rows={6}
              placeholder={
                category === "bug"
                  ? "Describe what happened, what you expected, and steps to reproduce it…"
                  : category === "feature"
                  ? "Describe the feature and why it would be useful…"
                  : "Share your thoughts…"
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 resize-y"
            />
            <div className="text-right text-xs text-neutral-600 mt-1">
              {description.length}/5000
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !user || !subject.trim() || !description.trim()}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Submit Feedback"}
          </button>
        </form>
      )}
    </div>
  );
}
