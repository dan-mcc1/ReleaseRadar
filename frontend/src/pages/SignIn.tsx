import React, { useState, useEffect, useRef } from "react";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  AuthCredential,
} from "firebase/auth";
import { auth } from "../firebase";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/apiFetch";
import { usePageTitle } from "../hooks/usePageTitle";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

const PRIMARY = "#10b981";

function RadarSVG() {
  return (
    <svg
      viewBox="0 0 600 600"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.6,
        pointerEvents: "none",
      }}
    >
      {[60, 110, 165, 220, 278, 338, 400].map((r) => (
        <circle
          key={r}
          cx="300"
          cy="300"
          r={r}
          stroke={PRIMARY}
          strokeWidth="0.7"
          fill="none"
          opacity={0.5 - r / 1400}
        />
      ))}
      <line x1="0" y1="300" x2="600" y2="300" stroke={PRIMARY} opacity="0.1" />
      <line x1="300" y1="0" x2="300" y2="600" stroke={PRIMARY} opacity="0.1" />
      <line x1="0" y1="0" x2="600" y2="600" stroke={PRIMARY} opacity="0.06" />
      <line x1="600" y1="0" x2="0" y2="600" stroke={PRIMARY} opacity="0.06" />
      <defs>
        <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={PRIMARY} stopOpacity="0" />
          <stop offset="100%" stopColor={PRIMARY} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <path
        d="M 300 300 L 680 300 A 400 400 0 0 0 530 20 Z"
        fill="url(#sweep-grad)"
      />
      {(
        [
          [430, 220],
          [375, 385],
          [240, 178],
          [182, 358],
          [460, 378],
          [205, 480],
          [410, 132],
          [320, 460],
          [150, 250],
        ] as [number, number][]
      ).map(([x, y], i) => (
        <g key={i}>
          <circle
            cx={x}
            cy={y}
            r="5"
            fill={`oklch(0.62 0.13 ${i * 38 + 90})`}
          />
          <circle cx={x} cy={y} r="10" fill={PRIMARY} opacity="0.1" />
        </g>
      ))}
    </svg>
  );
}

const SignIn: React.FC = () => {
  usePageTitle("Sign In");
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(
    null,
  );
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [pendingOAuth, setPendingOAuth] = useState<{
    uid: string;
    email: string | null;
  } | null>(null);
  const [oauthUsername, setOauthUsername] = useState("");
  const [oauthUsernameAvailable, setOauthUsernameAvailable] = useState<
    boolean | null
  >(null);
  const [oauthUsernameChecking, setOauthUsernameChecking] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const oauthDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (oauthDebounceRef.current) clearTimeout(oauthDebounceRef.current);
    },
    [],
  );

  async function checkAvailability(
    value: string,
    setAvailable: (v: boolean | null) => void,
    setChecking: (v: boolean) => void,
  ) {
    if (!USERNAME_RE.test(value)) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    try {
      const res = await apiFetch(
        `/user/check-username?username=${encodeURIComponent(value)}`,
      );
      const data = await res.json();
      setAvailable(data.available);
    } catch {
      setAvailable(null);
    } finally {
      setChecking(false);
    }
  }

  function handleUsernameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setUsername(value);
    setUsernameAvailable(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length >= 3) {
      debounceRef.current = setTimeout(
        () =>
          checkAvailability(value, setUsernameAvailable, setUsernameChecking),
        400,
      );
    }
  }

  function handleOauthUsernameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setOauthUsername(value);
    setOauthUsernameAvailable(null);
    if (oauthDebounceRef.current) clearTimeout(oauthDebounceRef.current);
    if (value.length >= 3) {
      oauthDebounceRef.current = setTimeout(
        () =>
          checkAvailability(
            value,
            setOauthUsernameAvailable,
            setOauthUsernameChecking,
          ),
        400,
      );
    }
  }

  async function registerUserInBackend(
    user: import("firebase/auth").User,
    username: string,
  ) {
    const res = await apiFetch("/user/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, username }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? "Backend registration failed.");
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setErrorMessage("Enter your email above, then click Forgot password.");
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (
        e.code === "auth/user-not-found" ||
        e.code === "auth/invalid-email"
      ) {
        setResetSent(true);
      } else {
        setErrorMessage("Failed to send reset email. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/calendar");
    } catch (error) {
      console.error("Error logging in:", error);
      setErrorMessage("Invalid email or password.");
    } finally {
      setIsLoading(false);
    }
  };

  async function isEmailBanned(emailToCheck: string): Promise<boolean> {
    try {
      const res = await apiFetch(
        `/user/check-email-banned?email=${encodeURIComponent(emailToCheck)}`,
      );
      if (res.ok) {
        const data = await res.json();
        return data.banned === true;
      }
    } catch {
      // non-critical
    }
    return false;
  }

  const handleRegister = async () => {
    setErrorMessage(null);
    if (!USERNAME_RE.test(username)) {
      setErrorMessage(
        "Username must be 3–30 characters: letters, numbers, or underscores only.",
      );
      return;
    }
    if (usernameAvailable === false) {
      setErrorMessage("That username is already taken.");
      return;
    }
    setIsLoading(true);
    try {
      if (await isEmailBanned(email)) {
        setErrorMessage("This account is not permitted to register.");
        return;
      }
      const res = await createUserWithEmailAndPassword(auth, email, password);
      await registerUserInBackend(res.user, username);
      navigate("/calendar");
    } catch (err: unknown) {
      console.error("Error registering:", err);
      const e = err as { code?: string; message?: string };
      let msg = e.message ?? "Registration failed.";
      if (e.code === "auth/invalid-email") msg = "Invalid email address.";
      else if (e.code === "auth/weak-password")
        msg = "Password should be at least 6 characters.";
      else if (e.code === "auth/email-already-in-use")
        msg = "Email is already in use.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  async function handleOAuthResult(user: import("firebase/auth").User) {
    if (user.email && (await isEmailBanned(user.email))) {
      setErrorMessage("This account is not permitted to register.");
      return;
    }
    try {
      const res = await apiFetch("/user/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.username) {
          setPendingOAuth({ uid: user.uid, email: user.email });
          return;
        }
      }
    } catch {
      // non-critical
    }
    navigate("/calendar");
  }

  async function handleOAuthUsernameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingOAuth) return;
    setErrorMessage(null);
    if (!USERNAME_RE.test(oauthUsername)) {
      setErrorMessage(
        "Username must be 3–30 characters: letters, numbers, or underscores only.",
      );
      return;
    }
    if (oauthUsernameAvailable === false) {
      setErrorMessage("That username is already taken.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiFetch("/user/update-username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_username: oauthUsername }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(err.detail ?? "Failed to set username.");
        return;
      }
      navigate("/calendar");
    } catch {
      setErrorMessage("Network error.");
    } finally {
      setIsLoading(false);
    }
  }

  // When a new OAuth provider shares an email with an existing account, Firebase
  // blocks sign-in. We recover by signing in with the original provider and
  // linking the new credential onto that account automatically.
  const handleAccountLinking = async (error: unknown, pendingCredential: AuthCredential | null): Promise<boolean> => {
    const e = error as { code?: string; customData?: { email?: string } };
    if (e.code !== "auth/account-exists-with-different-credential" || !e.customData?.email || !pendingCredential) {
      return false;
    }
    try {
      const email = e.customData.email;
      const methods = await fetchSignInMethodsForEmail(auth, email);
      if (methods.includes("google.com")) {
        const googleResult = await signInWithPopup(auth, new GoogleAuthProvider());
        await linkWithCredential(googleResult.user, pendingCredential);
        await handleOAuthResult(googleResult.user);
        return true;
      }
    } catch {
      // fall through to show error
    }
    return false;
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      await handleOAuthResult(result.user);
    } catch (error: unknown) {
      console.error("Google sign-in error:", error);
      const pendingCredential = GoogleAuthProvider.credentialFromError(error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
      if (await handleAccountLinking(error, pendingCredential)) return;
      const e = error as { code?: string; message?: string };
      if (e.code === "auth/account-exists-with-different-credential")
        setErrorMessage("This email is linked to a different sign-in method. Sign in with your original method, then link additional accounts in Settings.");
      else setErrorMessage(e.message ?? "Sign-in failed.");
    }
  };

  const handleMicrosoftSignIn = async () => {
    const provider = new OAuthProvider("microsoft.com");
    try {
      const result = await signInWithPopup(auth, provider);
      await handleOAuthResult(result.user);
    } catch (error: unknown) {
      console.error("Microsoft sign-in error:", error);
      const pendingCredential = OAuthProvider.credentialFromError(error as Parameters<typeof OAuthProvider.credentialFromError>[0]);
      if (await handleAccountLinking(error, pendingCredential)) return;
      const e = error as { code?: string; message?: string };
      if (e.code === "auth/account-exists-with-different-credential")
        setErrorMessage("This email is linked to a different sign-in method. Sign in with your original method, then link additional accounts in Settings.");
      else setErrorMessage(e.message ?? "Sign-in failed.");
    }
  };

  const handleFacebookSignIn = async () => {
    const provider = new FacebookAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      await handleOAuthResult(result.user);
    } catch (error: unknown) {
      console.error("Facebook sign-in error:", error);
      const pendingCredential = FacebookAuthProvider.credentialFromError(error as Parameters<typeof FacebookAuthProvider.credentialFromError>[0]);
      if (await handleAccountLinking(error, pendingCredential)) return;
      const e = error as { code?: string; message?: string };
      if (e.code === "auth/account-exists-with-different-credential")
        setErrorMessage("This email is linked to a different sign-in method. Sign in with your original method, then link additional accounts in Settings.");
      else setErrorMessage(e.message ?? "Sign-in failed.");
    }
  };

  const switchMode = (registering: boolean) => {
    setIsRegistering(registering);
    setErrorMessage(null);
    setResetSent(false);
    setEmail("");
    setPassword("");
    setUsername("");
    setUsernameAvailable(null);
  };

  // OAuth username step
  if (pendingOAuth) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-1">
              Release Radar
            </h1>
            <p className="text-neutral-400 text-sm">
              Choose a username to complete sign-up
            </p>
          </div>
          <div className="bg-neutral-800 border border-neutral-700 rounded-2xl shadow-xl p-8">
            <form onSubmit={handleOAuthUsernameSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  value={oauthUsername}
                  onChange={handleOauthUsernameChange}
                  placeholder="letters, numbers, underscores"
                  required
                  autoFocus
                  className={`w-full bg-neutral-900 border text-white placeholder-neutral-500 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 transition-colors ${
                    oauthUsername.length >= 3
                      ? oauthUsernameAvailable === true
                        ? "border-success-500 focus:border-success-500 focus:ring-success-500"
                        : oauthUsernameAvailable === false
                          ? "border-error-500 focus:border-error-500 focus:ring-error-500"
                          : "border-neutral-600 focus:border-primary-500 focus:ring-primary-500"
                      : "border-neutral-600 focus:border-primary-500 focus:ring-primary-500"
                  }`}
                />
                {oauthUsername.length >= 3 && (
                  <p
                    className={`text-xs mt-1.5 ${
                      oauthUsernameChecking
                        ? "text-neutral-400"
                        : oauthUsernameAvailable === true
                          ? "text-success-400"
                          : oauthUsernameAvailable === false
                            ? "text-error-400"
                            : "text-neutral-400"
                    }`}
                  >
                    {oauthUsernameChecking
                      ? "Checking availability…"
                      : oauthUsernameAvailable === true
                        ? "✓ Username available"
                        : oauthUsernameAvailable === false
                          ? "✗ Username already taken"
                          : !USERNAME_RE.test(oauthUsername)
                            ? "3–30 chars, letters/numbers/underscores only"
                            : ""}
                  </p>
                )}
              </div>
              {errorMessage && (
                <div className="text-error-400 bg-error-950 border border-error-800 px-4 py-2.5 rounded-lg text-sm">
                  {errorMessage}
                </div>
              )}
              <button
                type="submit"
                disabled={isLoading || oauthUsernameAvailable !== true}
                className="w-full bg-primary-600 hover:bg-primary-500 disabled:bg-primary-800 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg transition-colors duration-200 mt-2"
              >
                {isLoading ? "Saving…" : "Continue"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col lg:grid"
      style={{
        gridTemplateColumns: "1.15fr 1fr",
        minHeight: "100vh",
      }}
    >
      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col relative overflow-hidden"
        style={{
          background:
            "linear-gradient(155deg, oklch(0.19 0.07 165) 0%, oklch(0.09 0.04 165) 100%)",
          color: "#f0fdf4",
          padding: "44px 52px",
        }}
      >
        <RadarSVG />

        {/* Logo */}
        <div className="flex items-center gap-3.5 relative z-10">
          <img
            src="/favicon-1024.png"
            className="h-14 w-auto"
            alt="Release Radar"
          />
          <span style={{ fontWeight: 600, fontSize: 22 }}>Release Radar</span>
        </div>

        <div className="flex-1" />

        {/* Headline block */}
        <div className="relative z-10" style={{ maxWidth: 500 }}>
          <div
            className="font-mono"
            style={{
              fontSize: 10.5,
              letterSpacing: "0.16em",
              opacity: 0.6,
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            Track what you watch
          </div>

          <h1
            className="font-serif"
            style={{
              margin: 0,
              fontWeight: 400,
              fontSize: 60,
              lineHeight: 0.97,
              letterSpacing: "-0.03em",
            }}
          >
            Never miss a{" "}
            <em style={{ fontStyle: "italic", color: PRIMARY }}>release</em>{" "}
            again.
          </h1>

          <p
            style={{
              fontSize: 15,
              opacity: 0.75,
              lineHeight: 1.6,
              marginTop: 24,
              maxWidth: 430,
            }}
          >
            One calendar for every show and movie you care about. Synced to your
            streaming services, your friends, and the rest of your life.
          </p>

          {/* Stats row */}
          {/* <div className="flex gap-8 mt-10">
            {([["Daily", "release feed"]] as [string, string][]).map(
              ([n, l]) => (
                <div key={l}>
                  <div
                    className="font-serif"
                    style={{
                      fontSize: 30,
                      color: PRIMARY,
                      lineHeight: 1,
                      fontWeight: 400,
                    }}
                  >
                    {n}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      opacity: 0.6,
                      marginTop: 5,
                      letterSpacing: "0.03em",
                    }}
                  >
                    {l}
                  </div>
                </div>
              ),
            )}
          </div> */}
        </div>

        <div style={{ height: 44 }} />
      </div>

      {/* ── Right panel ── */}
      <div className="flex items-center justify-center px-6 py-12 bg-neutral-950">
        <div className="w-full" style={{ maxWidth: 400 }}>
          {/* Heading */}
          <h2
            className="font-serif"
            style={{
              margin: 0,
              fontWeight: 400,
              fontSize: 34,
              letterSpacing: "-0.02em",
              color: "#f5f5f3",
            }}
          >
            {isRegistering ? "Create account" : "Welcome back"}
          </h2>
          <p className="text-neutral-400 text-sm mt-2">
            {isRegistering
              ? "Sign up to start tracking shows and movies."
              : "Sign in to sync your watchlist across devices."}
          </p>

          {/* Sign in / Register toggle */}
          <div className="flex bg-neutral-900 rounded-lg p-1 mt-7 mb-6">
            <button
              onClick={() => switchMode(false)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                !isRegistering
                  ? "bg-primary-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => switchMode(true)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                isRegistering
                  ? "bg-primary-600 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Register
            </button>
          </div>

          {/* OAuth buttons */}
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 font-semibold px-4 py-3 rounded-xl transition-colors duration-200 text-sm bg-neutral-900 hover:bg-neutral-800 text-[#f5f5f3] border border-neutral-700 hover:border-neutral-600"
            >
              <svg
                className="w-4 h-4 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 533.5 544.3"
              >
                <path
                  fill="#4285F4"
                  d="M533.5 278.4c0-18.5-1.5-37-4.8-54.6H272.1v103.6h146.6c-6.3 33.5-25 61.9-53.6 80.8v67h86.8c50.8-46.8 80.6-115.6 80.6-196.8z"
                />
                <path
                  fill="#34A853"
                  d="M272.1 544.3c72.8 0 134-24.2 178.7-65.8l-86.8-67c-24.1 16.1-55.1 25.6-91.8 25.6-70.8 0-130.8-47.8-152.2-112.4h-89.3v70.6c44.4 88 135.4 149.9 241.5 149.9z"
                />
                <path
                  fill="#FBBC05"
                  d="M119.9 323.7c-10.7-31.8-10.7-66.4 0-98.2v-70.6h-89.3c-38.6 75-38.6 164.3 0 239.3l89.3-70.5z"
                />
                <path
                  fill="#EA4335"
                  d="M272.1 107.7c39.6 0 75.3 13.6 103.3 40.1l77.3-77.3c-47.6-44.2-110.6-71.5-180.6-71.5-106 0-197.1 61.9-241.5 149.9l89.3 70.6c21.5-64.6 81.5-112.4 152.2-112.4z"
                />
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              onClick={handleMicrosoftSignIn}
              className="w-full flex items-center justify-center gap-3 font-semibold px-4 py-3 rounded-xl transition-colors duration-200 text-sm bg-neutral-900 hover:bg-neutral-800 text-[#f5f5f3] border border-neutral-700 hover:border-neutral-600"
            >
              <svg
                className="w-4 h-4 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
              >
                <rect x="1" y="1" width="10" height="10" fill="#F25022" />
                <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
                <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
                <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
              </svg>
              Continue with Microsoft
            </button>

            <button
              type="button"
              onClick={handleFacebookSignIn}
              className="w-full flex items-center justify-center gap-3 font-semibold px-4 py-3 rounded-xl transition-colors duration-200 text-sm bg-neutral-900 hover:bg-neutral-800 text-[#f5f5f3] border border-neutral-700 hover:border-neutral-600"
            >
              <svg
                className="w-4 h-4 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="#1877F2"
              >
                <path d="M22.675 0H1.325C.593 0 0 .593 0 1.326v21.348C0 23.406.593 24 1.325 24h11.495v-9.294H9.691v-3.622h3.129V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.464.099 2.795.143v3.24l-1.918.001c-1.504 0-1.794.715-1.794 1.763v2.31h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.324-.594 1.324-1.326V1.326C24 .593 23.406 0 22.675 0z" />
              </svg>
              Continue with Facebook
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-neutral-800" />
            <span
              className="font-mono text-neutral-500"
              style={{ fontSize: 10.5, letterSpacing: "0.12em" }}
            >
              OR
            </span>
            <div className="flex-1 h-px bg-neutral-800" />
          </div>

          {/* Email/password form */}
          <form
            onSubmit={
              isRegistering
                ? (e) => {
                    e.preventDefault();
                    handleRegister();
                  }
                : handleLogin
            }
            className="flex flex-col gap-4"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-neutral-400">
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-600 px-3.5 py-3 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-neutral-400">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  isRegistering
                    ? "At least 6 characters"
                    : "Enter your password"
                }
                required
                className="w-full bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-600 px-3.5 py-3 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
              />
              {!isRegistering && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isLoading}
                  className="self-start text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Forgot password?
                </button>
              )}
            </label>

            {isRegistering && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-neutral-400">
                  Username
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="letters, numbers, underscores"
                  required
                  className={`w-full bg-neutral-900 border text-white placeholder-neutral-600 px-3.5 py-3 rounded-xl text-sm focus:outline-none focus:ring-1 transition-colors ${
                    username.length >= 3
                      ? usernameAvailable === true
                        ? "border-success-500 focus:border-success-500 focus:ring-success-500"
                        : usernameAvailable === false
                          ? "border-error-500 focus:border-error-500 focus:ring-error-500"
                          : "border-neutral-700 focus:border-primary-500 focus:ring-primary-500"
                      : "border-neutral-700 focus:border-primary-500 focus:ring-primary-500"
                  }`}
                />
                {username.length >= 3 && (
                  <p
                    className={`text-xs ${
                      usernameChecking
                        ? "text-neutral-400"
                        : usernameAvailable === true
                          ? "text-success-400"
                          : usernameAvailable === false
                            ? "text-error-400"
                            : "text-neutral-400"
                    }`}
                  >
                    {usernameChecking
                      ? "Checking availability…"
                      : usernameAvailable === true
                        ? "✓ Username available"
                        : usernameAvailable === false
                          ? "✗ Username already taken"
                          : !USERNAME_RE.test(username)
                            ? "3–30 chars, letters/numbers/underscores only"
                            : ""}
                  </p>
                )}
              </label>
            )}

            {errorMessage && (
              <div className="text-error-400 bg-error-950 border border-error-800 px-4 py-2.5 rounded-xl text-sm">
                {errorMessage}
              </div>
            )}

            {resetSent && !isRegistering && (
              <div className="text-success-400 bg-success-950 border border-success-800 px-4 py-2.5 rounded-xl text-sm">
                If that email is registered, a reset link is on its way.
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full font-semibold py-3 px-4 rounded-xl text-sm transition-colors duration-200 mt-1 disabled:cursor-not-allowed"
              style={{
                background: isLoading ? "#065f46" : PRIMARY,
                color: "#001a10",
              }}
            >
              {isLoading
                ? isRegistering
                  ? "Creating account…"
                  : "Signing in…"
                : isRegistering
                  ? "Create Account →"
                  : "Sign in →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
