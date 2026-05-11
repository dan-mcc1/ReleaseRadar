import { Link } from "react-router-dom";
import { useUserMe, useAcknowledgeWarning } from "../hooks/api/useUser";

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function consequenceMessage(
  count: number,
): { text: string; color: string } | null {
  if (count === 1) {
    return {
      text: "One more warning will result in a 7-day silence — you won't be able to post reviews or comments.",
      color: "text-warning-400",
    };
  }
  if (count === 2) {
    return {
      text: "You have been silenced for 7 days. You can still use the site, but reviews and comments are disabled until the silence expires.",
      color: "text-orange-400",
    };
  }
  if (count === 3) {
    return {
      text: "You have been silenced for 30 days. This is your final warning before your review and comment privileges are permanently removed.",
      color: "text-orange-400",
    };
  }
  if (count >= 4) {
    return {
      text: "Your review and comment privileges have been permanently removed. Your account is still active for personal tracking.",
      color: "text-red-400",
    };
  }
  return null;
}

export default function WarningModal() {
  const { data: me } = useUserMe();
  const acknowledge = useAcknowledgeWarning();

  if (!me?.has_unread_warning) return null;

  const consequence = consequenceMessage(me.warning_count);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-neutral-800 border border-warning-600/60 rounded-xl p-6 w-full max-w-sm space-y-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-warning-900/60 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-warning-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-white font-semibold">Account Warning</h3>
            <p className="text-warning-400 text-xs font-medium">
              {ordinal(me.warning_count)} warning
            </p>
          </div>
        </div>
        <p className="text-neutral-300 text-sm leading-relaxed">
          Your account has received a warning from our moderation team for a
          violation of our{" "}
          <Link
            to="/community-guidelines"
            className="underline text-neutral-200 hover:text-white"
          >
            community guidelines
          </Link>
          .
        </p>
        {consequence && (
          <p
            className={`text-sm font-medium leading-relaxed ${consequence.color}`}
          >
            {consequence.text}
          </p>
        )}
        <button
          onClick={() => acknowledge.mutate()}
          disabled={acknowledge.isPending}
          className="w-full bg-warning-600 hover:bg-warning-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          I understand
        </button>
      </div>
    </div>
  );
}
