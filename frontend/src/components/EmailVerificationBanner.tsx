import { useCallback, useEffect, useRef, useState } from "react";
import { sendEmailVerification, type User } from "firebase/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthUser } from "../hooks/useAuthUser";
import { useUserMe } from "../hooks/api/useUser";
import { queryKeys } from "../hooks/api/queryKeys";
import { apiFetch } from "../utils/apiFetch";
import { needsEmailVerification } from "../utils/emailVerification";

const RESEND_COOLDOWN_MS = 60_000;

/**
 * Asks people whose email Firebase has not verified to confirm it. The app
 * only stores (and so emails) a verified address, so until then they get no
 * release alerts. Also heals the case where the address was verified
 * elsewhere and the app's user row still has no email.
 */
export default function EmailVerificationBanner() {
  const user = useAuthUser();
  // Keyed by account, so one person's messages and cooldown never show to the
  // next person who signs in on this tab.
  return user ? <BannerFor key={user.uid} user={user} /> : null;
}

function BannerFor({ user }: { user: User }) {
  const { data: me } = useUserMe();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [done, setDone] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checked = useRef(false);

  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    [],
  );

  // Copy the verified email into the app's user row and refresh the cached user.
  const syncFromFirebase = useCallback(async (): Promise<boolean> => {
    try {
      // The ID token only says "verified" after a refresh; keep it current for
      // later calls that check the claim.
      await user.getIdToken(true);
      const res = await apiFetch("/user/sync-from-firebase", { method: "POST" });
      if (!res.ok) return false;
      await queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
      return true;
    } catch (error) {
      console.error("Error syncing verified email:", error);
      return false;
    }
  }, [user, queryClient]);

  // Once per sign-in: the address may have been verified in another tab or on
  // another device. The cached Firebase user can be stale, so reload it first.
  useEffect(() => {
    if (!me || checked.current) return;
    if (me.email) return; // the row has an address: nothing to heal
    if (!user.emailVerified && !needsEmailVerification(user)) return;
    checked.current = true;
    (async () => {
      try {
        await user.reload();
      } catch (error) {
        console.error("Error reloading Firebase user:", error);
        return;
      }
      // If the sync fails the banner stays, and "I've verified" retries it.
      if (user.emailVerified && (await syncFromFirebase())) setDone(true);
    })();
  }, [user, me, syncFromFirebase]);

  // An account whose row already has an email (created before verification was
  // required) keeps getting alerts, so it is not asked to verify.
  if (!me || me.email || done) return null;
  // saveFailed keeps the banner (and its retry) up once Firebase says verified
  // but the app's row could not be updated.
  if (!needsEmailVerification(user) && !saveFailed) return null;

  async function resend() {
    if (busy || cooldown) return;
    setBusy(true);
    try {
      await sendEmailVerification(user);
      setMessage("Sent. Check your inbox.");
    } catch (error) {
      console.error("Error sending verification email:", error);
      setMessage("Couldn't send. Try again in a few minutes.");
    } finally {
      setBusy(false);
      // Also after a failure: it is usually Firebase's own rate limit.
      setCooldown(true);
      cooldownTimer.current = setTimeout(
        () => setCooldown(false),
        RESEND_COOLDOWN_MS,
      );
    }
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await user.reload();
      if (!user.emailVerified) {
        setMessage("Not verified yet. Open the link in the email, then try again.");
      } else if (await syncFromFirebase()) {
        setDone(true);
      } else {
        setSaveFailed(true);
        setMessage("Verified, but we couldn't save it. Try again in a moment.");
      }
    } catch (error) {
      console.error("Error checking verification:", error);
      setMessage("Couldn't check. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const buttonClass =
    "px-3 py-1 rounded-lg text-xs font-semibold border border-warning-500/40 text-warning-200 hover:bg-warning-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="bg-warning-950/40 border-b border-warning-500/30 px-4 py-2">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-warning-200">
        <p className="flex-1 min-w-[16rem]">
          Verify your email to get release alerts. We sent a link to {user.email}.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resend}
            disabled={busy || cooldown}
            className={buttonClass}
          >
            Resend email
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={buttonClass}
          >
            I've verified
          </button>
        </div>
        {/* Kept in the accessibility tree while empty so a new message is announced. */}
        <p
          role="status"
          className={message ? "w-full text-xs text-warning-300" : "sr-only"}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
