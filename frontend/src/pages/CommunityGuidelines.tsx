import { usePageTitle } from "../hooks/usePageTitle";
import { PageHeader, SectionHeader } from "../components/ui";

const RULES = [
  {
    title: "Be respectful",
    description:
      "Treat other members the way you'd want to be treated. Disagreements about movies and shows are fine — personal attacks are not.",
  },
  {
    title: "Keep reviews honest and on-topic",
    description:
      "Share your genuine opinion of the film or show. Reviews should be about the content, not the people who made it or other users.",
  },
  {
    title: "No harassment or hate speech",
    description:
      "Targeting another user with repeated negative comments, slurs, or threats of any kind will result in immediate action.",
  },
  {
    title: "No spam or self-promotion",
    description:
      "Don't flood the community with repetitive posts, unsolicited links, or promotional content.",
  },
  {
    title: "Mark spoilers appropriately",
    description:
      "If your review or comment reveals major plot points, make that clear upfront so others can choose whether to read on.",
  },
  {
    title: "Keep it legal",
    description:
      "Don't post content that infringes copyright, shares piracy links, or violates anyone's privacy.",
  },
];

const ENFORCEMENT = [
  {
    level: "Warning 1",
    label: "Notice",
    color: "text-neutral-400",
    dot: "bg-neutral-500",
    description:
      "A formal notice that your content violated the guidelines. No restrictions are applied, but the record is kept.",
  },
  {
    level: "Warning 2",
    label: "7-day silence",
    color: "text-warning-400",
    dot: "bg-warning-400",
    description:
      "You can still track titles, use your watchlist, and browse the site, but reviews and comments are disabled for 7 days.",
  },
  {
    level: "Warning 3",
    label: "30-day silence",
    color: "text-warning-400",
    dot: "bg-warning-400",
    description:
      "Same restrictions as above, extended to 30 days. This is the final step before permanent action.",
  },
  {
    level: "Warning 4",
    label: "Permanent silence",
    color: "text-error-400",
    dot: "bg-error-400",
    description:
      "Reviews and comments are permanently disabled. Your account remains active for personal tracking only.",
  },
  {
    level: "Severe violations",
    label: "Immediate ban",
    color: "text-error-600",
    dot: "bg-error-600",
    description:
      "Harassment, hate speech, spam, or other egregious behavior may result in a full account ban without prior warnings at admin discretion.",
  },
];

export default function CommunityGuidelines() {
  usePageTitle("Community Guidelines");

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <PageHeader
        className="mb-10"
        title="Community Guidelines"
        description="Release Radar is a place for film and TV fans to track what they watch and share their thoughts. To keep it welcoming for everyone, we ask that all members follow these guidelines. Violations are handled consistently through the enforcement ladder below."
      />

      {/* Rules */}
      <section className="mb-12">
        <SectionHeader title="The rules" divider className="mb-2" />
        <div className="divide-y divide-neutral-800">
          {RULES.map((rule, i) => (
            <div
              key={i}
              className="flex gap-4 py-4"
            >
              <span className="text-neutral-500 font-semibold text-label mt-0.5 shrink-0 w-5 tabular">
                {i + 1}.
              </span>
              <div>
                <p className="text-white font-medium mb-1">{rule.title}</p>
                <p className="text-neutral-400 text-sm leading-relaxed">
                  {rule.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Enforcement */}
      <section>
        <SectionHeader title="Enforcement" className="mb-2" />
        <p className="text-neutral-400 text-label mb-5">
          Warnings accumulate on your account. Moderators may also apply any
          level directly for severe violations.
        </p>
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-neutral-800" />
          <div className="space-y-4">
            {ENFORCEMENT.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className="relative flex flex-col items-center shrink-0">
                  <span
                    className={`w-6 h-6 rounded-full ${step.dot} flex items-center justify-center z-10`}
                  />
                </div>
                <div className="pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-neutral-400 text-caption">
                      {step.level}
                    </span>
                    <span className={`font-semibold text-sm ${step.color}`}>
                      {step.label}
                    </span>
                  </div>
                  <p className="text-neutral-400 text-sm leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <p className="mt-12 text-neutral-500 text-caption">
        These guidelines may be updated over time. If you have questions or want
        to appeal a moderation decision, contact us through the settings page.
      </p>
    </div>
  );
}
