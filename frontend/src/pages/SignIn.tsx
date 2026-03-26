import React, { useState } from "react";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "../firebase";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../constants";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

const SignIn: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // LOGIN
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/");
    } catch (error) {
      console.error("Error logging in:", error);
      setErrorMessage("Invalid email or password.");
    }
  };

  async function checkUsernameAvailability(value: string) {
    if (!USERNAME_RE.test(value)) {
      setUsernameAvailable(null);
      return;
    }
    setUsernameChecking(true);
    try {
      const res = await fetch(`${API_URL}/user/check-username?username=${encodeURIComponent(value)}`);
      const data = await res.json();
      setUsernameAvailable(data.available);
    } catch {
      setUsernameAvailable(null);
    } finally {
      setUsernameChecking(false);
    }
  }

  function handleUsernameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setUsername(value);
    setUsernameAvailable(null);
    if (value.length >= 3) {
      checkUsernameAvailability(value);
    }
  }

  async function registerUserInBackend(uid: string, email: string | null, username: string) {
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
      setErrorMessage("Username must be 3–30 characters: letters, numbers, or underscores only.");
      return;
    }
    if (usernameAvailable === false) {
      setErrorMessage("That username is already taken.");
      return;
    }

    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      await registerUserInBackend(res.user.uid, res.user.email, username);
      navigate("/");
    } catch (err: any) {
      console.error("Error registering:", err);

      let msg = err.message ?? "Registration failed.";
      if (err.code === "auth/invalid-email") msg = "Invalid email address.";
      else if (err.code === "auth/weak-password") msg = "Password should be at least 6 characters.";
      else if (err.code === "auth/email-already-in-use") msg = "Email is already in use.";

      setErrorMessage(msg);
    }
  };

  // GOOGLE SIGN-IN
  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      // Register without username — user will be prompted on profile page
      await fetch(`${API_URL}/user/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: result.user.uid, email: result.user.email }),
      });
      navigate("/");
    } catch (error) {
      console.error("Google sign-in error:", error);
    }
  };

  return (
    <div className="flex flex-col flex-grow justify-center items-center space-y-4 h-full">
      {/* Toggle */}
      <div className="flex gap-4 mb-2">
        <button
          onClick={() => { setIsRegistering(false); setErrorMessage(null); }}
          className={`py-1 px-4 rounded ${!isRegistering ? "bg-[var(--tertiary-color)] text-white" : "bg-slate-700 text-slate-300"}`}
        >
          Login
        </button>
        <button
          onClick={() => { setIsRegistering(true); setErrorMessage(null); }}
          className={`py-1 px-4 rounded ${isRegistering ? "bg-blue-500 text-white" : "bg-slate-700 text-slate-300"}`}
        >
          Register
        </button>
      </div>

      <form onSubmit={isRegistering ? (e) => { e.preventDefault(); handleRegister(); } : handleLogin} className="flex flex-col items-center space-y-4 w-full">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="bg-[var(--primary-color)] text-[var(--secondary-color)] p-4 rounded-xl w-1/3"
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          className="bg-[var(--primary-color)] text-[var(--secondary-color)] p-4 rounded-xl w-1/3"
        />

        {isRegistering && (
          <div className="w-1/3">
            <input
              type="text"
              value={username}
              onChange={handleUsernameChange}
              placeholder="Username (letters, numbers, underscores)"
              required
              className="bg-[var(--primary-color)] text-[var(--secondary-color)] p-4 rounded-xl w-full"
            />
            {username.length >= 3 && (
              <p className={`text-sm mt-1 pl-1 ${
                usernameChecking
                  ? "text-slate-400"
                  : usernameAvailable === true
                  ? "text-green-400"
                  : usernameAvailable === false
                  ? "text-red-400"
                  : "text-slate-400"
              }`}>
                {usernameChecking
                  ? "Checking…"
                  : usernameAvailable === true
                  ? "Username available"
                  : usernameAvailable === false
                  ? "Username taken"
                  : !USERNAME_RE.test(username)
                  ? "3–30 chars, letters/numbers/underscores only"
                  : ""}
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          className={`py-[0.6em] px-[1.2em] text-white rounded ${isRegistering ? "bg-blue-500" : "bg-[var(--tertiary-color)]"}`}
        >
          {isRegistering ? "Register" : "Login"}
        </button>
      </form>

      {errorMessage && (
        <div className="text-red-400 bg-red-950 border border-red-700 px-4 py-2 rounded text-sm">
          {errorMessage}
        </div>
      )}

      <div className="flex items-center gap-3 text-slate-400 text-sm w-1/3">
        <div className="flex-1 h-px bg-slate-600" />
        <span>or</span>
        <div className="flex-1 h-px bg-slate-600" />
      </div>

      <button type="button" onClick={handleGoogleSignIn} className="flex items-center gap-2 bg-white text-slate-800 px-4 py-2 rounded font-medium hover:bg-slate-100">
        <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 533.5 544.3">
          <path fill="#4285F4" d="M533.5 278.4c0-18.5-1.5-37-4.8-54.6H272.1v103.6h146.6c-6.3 33.5-25 61.9-53.6 80.8v67h86.8c50.8-46.8 80.6-115.6 80.6-196.8z" />
          <path fill="#34A853" d="M272.1 544.3c72.8 0 134-24.2 178.7-65.8l-86.8-67c-24.1 16.1-55.1 25.6-91.8 25.6-70.8 0-130.8-47.8-152.2-112.4h-89.3v70.6c44.4 88 135.4 149.9 241.5 149.9z" />
          <path fill="#FBBC05" d="M119.9 323.7c-10.7-31.8-10.7-66.4 0-98.2v-70.6h-89.3c-38.6 75-38.6 164.3 0 239.3l89.3-70.5z" />
          <path fill="#EA4335" d="M272.1 107.7c39.6 0 75.3 13.6 103.3 40.1l77.3-77.3c-47.6-44.2-110.6-71.5-180.6-71.5-106 0-197.1 61.9-241.5 149.9l89.3 70.6c21.5-64.6 81.5-112.4 152.2-112.4z" />
        </svg>
        Sign in with Google
      </button>
    </div>
  );
};

export default SignIn;
