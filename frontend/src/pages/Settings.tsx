import { useState, useEffect } from "react";
import {
  getAuth,
  onAuthStateChanged,
  deleteUser,
  signOut,
} from "firebase/auth";
import { firebaseApp } from "../firebase";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../constants";

export default function Settings() {
  const auth = getAuth(firebaseApp);
  const [user, setUser] = useState(auth.currentUser);
  const [error, setError] = useState<string | null>(null);
  const [emailNotifications, setEmailNotifications] = useState<boolean>(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const res = await fetch(`${API_URL}/notifications/preferences`, {
            headers: { Authorization: `Bearer ${await u.getIdToken()}` },
          });
          if (res.ok) {
            const data = await res.json();
            setEmailNotifications(data.email_notifications);
          }
        } catch (err) {
          console.error(err);
        }
      }
    });
    return () => unsub();
  }, []);

  const toggleEmailNotifications = async () => {
    const u = auth.currentUser;
    if (!u || emailNotifications === null) return;
    const next = !emailNotifications;
    setNotifSaving(true);
    try {
      const res = await fetch(`${API_URL}/notifications/preferences`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${await u.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email_notifications: next }),
      });
      if (res.ok) setEmailNotifications(next);
    } catch (err) {
      console.error(err);
    } finally {
      setNotifSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    if (!window.confirm("Are you sure you want to permanently delete your account? This cannot be undone.")) return;
    setError(null);

    try {
      // Delete all user data from the backend first
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/user/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete account data");

      // Then delete the Firebase auth account
      await deleteUser(user);
      navigate("/signIn");
    } catch (err: any) {
      console.error("Error deleting account:", err);
      if (err.code === "auth/requires-recent-login") {
        setError("Please sign out and sign back in before deleting your account.");
      } else {
        setError(err.message);
      }
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    navigate("/");
  };

  if (!user) {
    return (
      <div className="p-6 text-center text-gray-600">
        You must be signed in to view this page.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      <div className="bg-slate-800 shadow-md rounded-lg p-4 space-y-4">
        <div>
          <p className="text-gray-500 font-medium">Logged in as:</p>
          <p className="text-white font-semibold">{user.email}</p>
        </div>

        {error && (
          <div className="bg-red-100 text-red-700 p-3 rounded">{error}</div>
        )}

        {/* Email notifications toggle */}
        <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Email Notifications</p>
              <p className="text-gray-400 text-sm">Weekly digest of upcoming releases</p>
            </div>
            <button
              onClick={toggleEmailNotifications}
              disabled={notifSaving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                emailNotifications ? "bg-blue-600" : "bg-slate-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  emailNotifications ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

        <button
          onClick={handleSignOut}
          className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded-lg"
        >
          Sign Out
        </button>

        <button
          onClick={handleDelete}
          className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg"
        >
          Delete Account
        </button>
      </div>
    </div>
  );
}
