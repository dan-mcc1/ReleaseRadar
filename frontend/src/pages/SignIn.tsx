import React, { useState, useEffect, useRef } from "react";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "../firebase";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

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

  // LOGIN
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/");
    } catch (error) {
      console.error("Error logging in:", error);
      setErrorMessage("Invalid email or password.");
    } finally {
      setIsLoading(false);
    }
  };

  async function checkUsernameAvailability(value: string) {
    if (!USERNAME_RE.test(value)) {
      setUsernameAvailable(null);
      return;
    }
    setUsernameChecking(true);
    try {
      const res = await fetch(
        `${API_URL}/user/check-username?username=${encodeURIComponent(value)}`,
      );
      const data = await res.json();
      setUsernameAvailable(data.available);
    } catch {
      setUsernameAvailable(null);
    } finally {
      setUsernameChecking(false);
    }
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleUsernameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setUsername(value);
    setUsernameAvailable(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length >= 3) {
      debounceRef.current = setTimeout(
        () => checkUsernameAvailability(value),
        400,
      );
    }
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  async function registerUserInBackend(
    uid: string,
    email: string | null,
    username: string,
  ) {
    const res = await fetch(`${API_URL}/user/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, email, username }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? "Backend registration failed.");
    }
  }

  // REGISTER
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
      const res = await createUserWithEmailAndPassword(auth, email, password);
      await registerUserInBackend(res.user.uid, res.user.email, username);
      navigate("/");
    } catch (err: any) {
      console.error("Error registering:", err);

      let msg = err.message ?? "Registration failed.";
      if (err.code === "auth/invalid-email") msg = "Invalid email address.";
      else if (err.code === "auth/weak-password")
        msg = "Password should be at least 6 characters.";
      else if (err.code === "auth/email-already-in-use")
        msg = "Email is already in use.";

      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // GOOGLE SIGN-IN
  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      await fetch(`${API_URL}/user/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: result.user.uid,
          email: result.user.email,
        }),
      });
      navigate("/");
    } catch (error: any) {
      console.error("Google sign-in error:", error);

      let msg = error.message ?? "Registration failed.";
      if (error.code === "auth/invalid-email") msg = "Invalid email address.";
      else if (error.code === "auth/weak-password")
        msg = "Password should be at least 6 characters.";
      else if (error.code === "auth/email-already-in-use")
        msg = "Email is already in use.";
      else if (error.code === "auth/account-exists-with-different-credential")
        msg = "Account already exists using a different provider";

      setErrorMessage(msg);
    }
  };

  // MICROSOFT SIGN-IN
  const handleMicrosoftSignIn = async () => {
    const provider = new OAuthProvider("microsoft.com");
    try {
      const result = await signInWithPopup(auth, provider);
      await fetch(`${API_URL}/user/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: result.user.uid,
          email: result.user.email,
        }),
      });
      navigate("/");
    } catch (error: any) {
      console.error("Microsoft sign-in error:", error);

      let msg = error.message ?? "Registration failed.";
      if (error.code === "auth/invalid-email") msg = "Invalid email address.";
      else if (error.code === "auth/weak-password")
        msg = "Password should be at least 6 characters.";
      else if (error.code === "auth/email-already-in-use")
        msg = "Email is already in use.";
      else if (error.code === "auth/account-exists-with-different-credential")
        msg = "Account already exists using a different provider";

      setErrorMessage(msg);
    }
  };

  // FACEBOOK SIGN-IN
  const handleFacebookSignIn = async () => {
    const provider = new FacebookAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      await fetch(`${API_URL}/user/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: result.user.uid,
          email: result.user.email,
        }),
      });
      navigate("/");
    } catch (error: any) {
      console.error("Facebook sign-in error:", error);

      let msg = error.message ?? "Registration failed.";
      if (error.code === "auth/invalid-email") msg = "Invalid email address.";
      else if (error.code === "auth/weak-password")
        msg = "Password should be at least 6 characters.";
      else if (error.code === "auth/email-already-in-use")
        msg = "Email is already in use.";
      else if (error.code === "auth/account-exists-with-different-credential")
        msg = "Account already exists using a different provider";

      setErrorMessage(msg);
    }
  };

  const switchMode = (registering: boolean) => {
    setIsRegistering(registering);
    setErrorMessage(null);
    setEmail("");
    setPassword("");
    setUsername("");
    setUsernameAvailable(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-1">Watch Calendar</h1>
          <p className="text-slate-400 text-sm">
            {isRegistering
              ? "Create your account to get started"
              : "Welcome back — sign in to continue"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-xl p-8">
          {/* Tab Toggle */}
          <div className="flex bg-slate-900 rounded-lg p-1 mb-6">
            <button
              onClick={() => switchMode(false)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                !isRegistering
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => switchMode(true)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                isRegistering
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Register
            </button>
          </div>

          {/* Form */}
          <form
            onSubmit={
              isRegistering
                ? (e) => {
                    e.preventDefault();
                    handleRegister();
                  }
                : handleLogin
            }
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-slate-900 border border-slate-600 text-white placeholder-slate-500 px-4 py-2.5 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
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
                className="w-full bg-slate-900 border border-slate-600 text-white placeholder-slate-500 px-4 py-2.5 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="letters, numbers, underscores"
                  required
                  className={`w-full bg-slate-900 border text-white placeholder-slate-500 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-1 transition-colors ${
                    username.length >= 3
                      ? usernameAvailable === true
                        ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                        : usernameAvailable === false
                          ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                          : "border-slate-600 focus:border-blue-500 focus:ring-blue-500"
                      : "border-slate-600 focus:border-blue-500 focus:ring-blue-500"
                  }`}
                />
                {username.length >= 3 && (
                  <p
                    className={`text-xs mt-1.5 ${
                      usernameChecking
                        ? "text-slate-400"
                        : usernameAvailable === true
                          ? "text-green-400"
                          : usernameAvailable === false
                            ? "text-red-400"
                            : "text-slate-400"
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
              </div>
            )}

            {errorMessage && (
              <div className="text-red-400 bg-red-950 border border-red-800 px-4 py-2.5 rounded-lg text-sm">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg transition-colors duration-200 mt-2"
            >
              {isLoading
                ? isRegistering
                  ? "Creating account…"
                  : "Signing in…"
                : isRegistering
                  ? "Create Account"
                  : "Sign In"}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 text-slate-500 text-sm my-5">
            <div className="flex-1 h-px bg-slate-700" />
            <span>or</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          <div className="flex flex-col gap-3">
            {/* Google Sign-In */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-300 text-slate-800 font-medium px-4 py-2.5 rounded-lg transition-colors duration-200"
            >
              <svg
                className="w-5 h-5 shrink-0"
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

            {/* Microsoft Sign-In */}
            <button
              type="button"
              onClick={handleMicrosoftSignIn}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-300 text-slate-800 font-medium px-4 py-2.5 rounded-lg transition-colors duration-200"
            >
              <svg
                className="w-5 h-5 shrink-0"
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
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-300 text-slate-800 font-medium px-4 py-2.5 rounded-lg transition-colors duration-200"
            >
              <svg
                className="w-5 h-5 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="#1877F2"
              >
                <path d="M22.675 0H1.325C.593 0 0 .593 0 1.326v21.348C0 23.406.593 24 1.325 24h11.495v-9.294H9.691v-3.622h3.129V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.464.099 2.795.143v3.24l-1.918.001c-1.504 0-1.794.715-1.794 1.763v2.31h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.324-.594 1.324-1.326V1.326C24 .593 23.406 0 22.675 0z" />
              </svg>
              Continue with Facebook
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
