import type { User } from "firebase/auth";

/** True for an account with an email that Firebase has not verified yet.
 * That is every new password sign-up, and providers Firebase doesn't trust
 * for the address (Facebook, some Microsoft accounts). Google and Apple
 * arrive verified, so they never match. */
export function needsEmailVerification(user: User | null): boolean {
  return !!user && !!user.email && !user.emailVerified;
}
