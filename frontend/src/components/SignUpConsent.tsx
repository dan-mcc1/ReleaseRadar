// Shown next to every button that can create an account, so agreeing to the
// Terms and Privacy Policy is part of signing up. `lead` names that button,
// e.g. "By selecting Create account". The links open in a new tab so reading
// them doesn't throw away a half-filled form.
export default function SignUpConsent({ lead }: { lead: string }) {
  return (
    <p className="text-caption text-neutral-400 text-center">
      {lead}, you agree to our{" "}
      <a
        href="/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="text-neutral-200 underline underline-offset-2 hover:text-white"
      >
        Terms of Service
      </a>{" "}
      and acknowledge our{" "}
      <a
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="text-neutral-200 underline underline-offset-2 hover:text-white"
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}
