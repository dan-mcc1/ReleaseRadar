import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";

const EFFECTIVE_DATE = "June 2, 2026";

const SECTIONS = [
  {
    title: "1. Summary",
    body: (
      <>
        Release Radar is a movie and TV tracking app. To make that work, we
        store the things you choose to track, the reviews and comments you
        write, and a small amount of account information. We don't sell your
        data. We don't run third-party advertising. This page explains what we
        collect, why, and how to control it.
      </>
    ),
  },
  {
    title: "2. Information you give us",
    body: (
      <>
        <p className="mb-2">When you create an account, we collect:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="text-white">Sign-in details</span> — your email
            address and, depending on the provider, a Google, Apple, or
            password-based credential handled by Firebase Authentication.
          </li>
          <li>
            <span className="text-white">Profile info</span> — username,
            optional display name, avatar choice, and bio if you set one.
          </li>
          <li>
            <span className="text-white">Tracking data</span> — the movies and
            shows on your watchlist, currently-watching, watched, and favorites
            lists, plus the individual episodes you mark as watched.
          </li>
          <li>
            <span className="text-white">Reviews and comments</span> — the text,
            ratings, and timestamps of anything you post publicly.
          </li>
          <li>
            <span className="text-white">Social graph</span> — friend requests,
            follows, and blocks.
          </li>
          <li>
            <span className="text-white">Preferences</span> — notification,
            digest, profile-visibility, and spoiler-handling settings.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "3. Information we collect automatically",
    body: (
      <>
        <p className="mb-2">When you use the app or website, we record:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="text-white">Device tokens</span> — if you enable
            push notifications, we store the push token issued by Apple or
            Google so we can deliver alerts.
          </li>
          <li>
            <span className="text-white">Activity logs</span> — when you add,
            watch, rate, or comment, we record the action and time so we can
            build your stats and activity feed.
          </li>
          <li>
            <span className="text-white">Operational logs</span> — server logs
            of requests, including IP address and user agent, kept for debugging
            and abuse prevention.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "4. How we use your data",
    body: (
      <>
        <p className="mb-2">We use the information above to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            provide the core tracking, social, and recommendation features;
          </li>
          <li>
            send notifications you've asked for (daily email digest, new-season
            alerts, streaming changes, trailer drops, episode air-time pushes);
          </li>
          <li>
            generate your stats, "For You" recommendations, and calendar feed;
          </li>
          <li>process subscription payments via Stripe or Apple;</li>
          <li>
            moderate the community per our{" "}
            <Link
              to="/community-guidelines"
              className="text-amber-400 hover:underline"
            >
              Community Guidelines
            </Link>
            ;
          </li>
          <li>keep the service secure and prevent abuse.</li>
        </ul>
      </>
    ),
  },
  {
    title: "5. Who we share data with",
    body: (
      <>
        <p className="mb-2">
          We don't sell your data and we don't share it for advertising. We do
          rely on a small set of vendors to run the service:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="text-white">Firebase / Google</span> — sign-in,
            session tokens, and (for iOS) push notification delivery.
          </li>
          <li>
            <span className="text-white">Neon / PostgreSQL</span> — managed
            database hosting where your account and tracking data live.
          </li>
          <li>
            <span className="text-white">Stripe</span> — subscription billing on
            the web. We never see your card details.
          </li>
          <li>
            <span className="text-white">Apple</span> — App Store subscriptions
            for the iOS app.
          </li>
          <li>
            <span className="text-white">Resend</span> — delivery of digest and
            transactional emails.
          </li>
          <li>
            <span className="text-white">TMDb and OMDb</span> — movie and TV
            metadata. We send TMDb the IDs of titles you view; they don't
            receive your account information.
          </li>
          <li>
            <span className="text-white">Sentry</span> — error monitoring on our
            backend.
          </li>
        </ul>
        <p className="mt-2">
          We may also disclose information when required by law, or to protect
          the safety and rights of our users or the service.
        </p>
      </>
    ),
  },
  {
    title: "6. Profile visibility and social features",
    body: (
      <>
        Your profile visibility setting (public, friends-only) controls who can
        see your watchlist, watched list, and friends. Reviews and comments are
        always public to other signed-in users. You can block other accounts to
        remove them from your feeds and hide your profile from them.
      </>
    ),
  },
  {
    title: "7. Calendar and unsubscribe links",
    body: (
      <>
        Your personal iCal calendar URL contains a signed token tied to your
        account. Treat it like a password — anyone with the link can read your
        upcoming releases. You can rotate the token by toggling the calendar
        feature in settings. Email unsubscribe links contain a similar signed
        token scoped only to email preferences.
      </>
    ),
  },
  {
    title: "8. Your rights",
    body: (
      <>
        <p className="mb-2">You can:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="text-white">Access and edit</span> your profile,
            preferences, and tracking data at any time from the app.
          </li>
          <li>
            <span className="text-white">Export</span> your watched and
            watchlist data from the Settings page.
          </li>
          <li>
            <span className="text-white">Delete your account</span> from
            Settings. This removes your profile, lists, reviews, comments,
            activity, and preferences from our database, and deletes your
            Firebase Authentication record. Some operational logs may persist
            briefly for security purposes.
          </li>
        </ul>
        <p className="mt-2">
          Depending on where you live (EU/UK, California, etc.) you may have
          additional rights to access, correct, or object to processing of your
          data. Contact us to exercise those rights.
        </p>
      </>
    ),
  },
  {
    title: "9. Data retention",
    body: (
      <>
        We keep your account data for as long as your account exists. Activity
        feed entries auto-expire after a rolling window. Recommendations expire
        after a short period and are regenerated. Deleting your account removes
        the data described above.
      </>
    ),
  },
  {
    title: "10. Children",
    body: (
      <>
        Release Radar isn't directed at children under 13 and we don't knowingly
        collect data from them. If you believe a child has created an account,
        contact us and we'll remove it.
      </>
    ),
  },
  {
    title: "11. International users",
    body: (
      <>
        Our backend is hosted in the United States. By using Release Radar, you
        consent to your data being processed there. We rely on standard
        contractual safeguards with our vendors where required.
      </>
    ),
  },
  {
    title: "12. Changes to this policy",
    body: (
      <>
        We may update this policy from time to time. If the changes are
        material, we'll let you know in the app or by email. The "Effective"
        date at the top will always reflect the most recent revision.
      </>
    ),
  },
  {
    title: "13. Contact",
    body: (
      <>
        Privacy questions, data requests, or concerns? Reach out via the{" "}
        <Link to="/feedback" className="text-amber-400 hover:underline">
          feedback page
        </Link>
        {/* {" "}
        or email{" "}
        <a
          href="mailto:privacy@releaseradar.co"
          className="text-amber-400 hover:underline"
        >
          privacy@releaseradar.co
        </a> */}
        .
      </>
    ),
  },
];

export default function Privacy() {
  usePageTitle("Privacy Policy");

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Privacy Policy</h1>
        <p className="text-neutral-500 text-sm">Effective {EFFECTIVE_DATE}</p>
      </div>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-white font-semibold mb-2">{section.title}</h2>
            <div className="text-neutral-400 text-sm leading-relaxed">
              {section.body}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
