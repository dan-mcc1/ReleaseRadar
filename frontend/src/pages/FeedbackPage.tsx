import { useState } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { apiFetch } from "../utils/apiFetch";
import { useAuthUser } from "../hooks/useAuthUser";
import { Button, EmptyState, PageHeader } from "../components/ui";

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
      <PageHeader
        className="mb-8"
        title="Contact & Feedback"
        description="Report a bug, suggest a feature, or share any thoughts about Release Radar."
      />

      {!user && (
        <div className="mb-6 rounded-control border border-warning-800/40 bg-warning-950/30 px-4 py-3 text-label text-warning-300">
          You need to{" "}
          <Link to="/signIn" className="underline hover:text-warning-200">
            sign in
          </Link>{" "}
          to submit feedback.
        </div>
      )}

      {submitted ? (
        <EmptyState
          title="Thanks for the feedback!"
          description="Your submission has been received. We read everything and appreciate you taking the time."
          action={
            <Button
              onClick={() => {
                setSubmitted(false);
                setSubject("");
                setDescription("");
                setCategory("bug");
              }}
            >
              Submit another
            </Button>
          }
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Category */}
          <div>
            <label className="block text-label font-medium text-neutral-300 mb-3">
              What kind of feedback is this?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={[
                    "rounded-control border px-4 py-3 text-left transition-colors",
                    category === cat.value
                      ? "border-primary-600 bg-primary-950/40 text-white"
                      : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
                  ].join(" ")}
                >
                  <div className="font-medium text-label">{cat.label}</div>
                  <div className="text-caption mt-0.5 opacity-70">{cat.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label htmlFor="subject" className="block text-label font-medium text-neutral-300 mb-1.5">
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
              className="w-full rounded-control border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-label text-white placeholder-neutral-600 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-label font-medium text-neutral-300 mb-1.5">
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
              className="w-full rounded-control border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-label text-white placeholder-neutral-600 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 resize-y"
            />
            <div className="text-right text-caption text-neutral-500 mt-1 tabular">
              {description.length}/5000
            </div>
          </div>

          {error && (
            <p className="text-label text-error-400">{error}</p>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={submitting || !user || !subject.trim() || !description.trim()}
          >
            {submitting ? "Submitting…" : "Submit Feedback"}
          </Button>
        </form>
      )}
    </div>
  );
}
