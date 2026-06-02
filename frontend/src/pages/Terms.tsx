import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";

const EFFECTIVE_DATE = "June 2, 2026";

const SECTIONS = [
  {
    title: "1. Who we are",
    body: (
      <>
        Release Radar ("we", "us") is a service for tracking movies and TV
        shows, sharing reviews, and getting alerts about upcoming releases. By
        creating an account or using the service through our website, mobile
        app, or APIs, you agree to these Terms of Service.
      </>
    ),
  },
  {
    title: "2. Eligibility",
    body: (
      <>
        You must be at least 13 years old (or the minimum age required in your
        country) to use Release Radar. If you're under 18, you should review
        these terms with a parent or guardian.
      </>
    ),
  },
  {
    title: "3. Your account",
    body: (
      <>
        You're responsible for keeping your sign-in credentials secure and for
        anything that happens under your account. Choose a unique username,
        don't share access, and let us know right away if you think your account
        has been compromised. We may suspend or terminate accounts that violate
        these terms or our{" "}
        <Link
          to="/community-guidelines"
          className="text-amber-400 hover:underline"
        >
          Community Guidelines
        </Link>
        .
      </>
    ),
  },
  {
    title: "4. Acceptable use",
    body: (
      <>
        Don't use Release Radar to break the law, infringe anyone's rights,
        scrape the service, attempt to disrupt our infrastructure, or post
        content that violates our Community Guidelines. Reviews and comments
        must follow the rules and enforcement ladder described there.
      </>
    ),
  },
  // {
  //   title: "5. Subscriptions and billing",
  //   body: (
  //     <>
  //       Some features require a paid subscription. Web subscriptions are
  //       processed by Stripe; iOS subscriptions are processed by Apple through
  //       the App Store. Charges renew automatically until you cancel.
  //       Cancellations take effect at the end of the current billing period —
  //       we don't refund partial periods unless required by law. You can manage
  //       or cancel your subscription from the Billing settings page (web) or
  //       Apple ID settings (iOS).
  //     </>
  //   ),
  // },
  {
    title: "5. Content from third parties",
    body: (
      <>
        Movie and TV metadata, posters, and ratings are provided by The Movie
        Database (TMDb) and other third-party sources. We don't host the films
        or shows themselves and aren't responsible for their content,
        availability on streaming services, or accuracy of release dates.
        Streaming availability is provided by JustWatch via TMDb.
      </>
    ),
  },
  {
    title: "6. Your content",
    body: (
      <>
        You own the reviews, comments, ratings, and other content you submit. By
        posting, you grant us a worldwide, royalty-free license to host,
        display, and share that content within the service. You can delete your
        content at any time, and we'll honor those deletions going forward.
      </>
    ),
  },
  {
    title: "7. Moderation",
    body: (
      <>
        We may remove content, issue warnings, silence posting privileges, or
        ban accounts that violate our Community Guidelines. The enforcement
        ladder is published openly so the rules are clear. You can appeal a
        moderation decision from inside the app.
      </>
    ),
  },
  {
    title: "8. Service availability",
    body: (
      <>
        We work hard to keep Release Radar running, but we don't guarantee
        uninterrupted access. Features may change, be temporarily unavailable,
        or be removed. We may also discontinue parts of the service with
        reasonable notice.
      </>
    ),
  },
  {
    title: "9. Disclaimers",
    body: (
      <>
        Release Radar is provided "as is" without warranties of any kind,
        whether express or implied, including merchantability, fitness for a
        particular purpose, or non-infringement. We don't warrant that the
        service will be error-free or that release dates, ratings, or
        recommendations will be accurate.
      </>
    ),
  },
  {
    title: "10. Limitation of liability",
    body: (
      <>
        To the maximum extent permitted by law, Release Radar and its operators
        won't be liable for any indirect, incidental, special, consequential, or
        punitive damages, or any loss of profits, data, or goodwill arising from
        your use of the service.
      </>
    ),
  },
  {
    title: "11. Termination",
    body: (
      <>
        You can delete your account at any time from the settings page. We can
        suspend or terminate your access if you violate these terms. On
        termination, your tracking data, reviews, and personal information are
        removed as described in the{" "}
        <Link to="/privacy" className="text-amber-400 hover:underline">
          Privacy Policy
        </Link>
        .
      </>
    ),
  },
  {
    title: "12. Changes",
    body: (
      <>
        We may update these terms over time. If the changes are material, we'll
        let you know in the app or by email. Continuing to use Release Radar
        after the changes take effect means you accept the new terms.
      </>
    ),
  },
  {
    title: "13. Contact",
    body: (
      <>
        Questions about these terms? Reach out through the{" "}
        <Link to="/feedback" className="text-amber-400 hover:underline">
          feedback page
        </Link>
        {/* {" "} */}
        {/* or email us at{" "}
        <a
          href="mailto:support@releaseradar.co"
          className="text-amber-400 hover:underline"
        >
          support@releaseradar.co
        </a> */}
        .
      </>
    ),
  },
];

export default function Terms() {
  usePageTitle("Terms of Service");

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Terms of Service</h1>
        <p className="text-neutral-500 text-sm">Effective {EFFECTIVE_DATE}</p>
      </div>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-white font-semibold mb-2">{section.title}</h2>
            <p className="text-neutral-400 text-sm leading-relaxed">
              {section.body}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
