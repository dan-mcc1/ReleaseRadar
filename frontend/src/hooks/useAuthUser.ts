import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../firebase";

/**
 * Returns the currently signed-in Firebase user, kept in sync via
 * onAuthStateChanged. Returns null while auth is initializing or when
 * signed out.
 */
export function useAuthUser(): User | null {
  const [user, setUser] = useState<User | null>(auth.currentUser);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return unsubscribe;
  }, []);

  return user;
}

/**
 * Returns true until Firebase has resolved the initial auth state.
 * Use this to avoid flashing signed-out UI before the session is restored.
 */
export function useAuthLoading(): boolean {
  const [loading, setLoading] = useState(auth.currentUser === null);

  useEffect(() => {
    if (!loading) return;
    const unsubscribe = onAuthStateChanged(auth, () => {
      setLoading(false);
      unsubscribe();
    });
    return unsubscribe;
  }, []);

  return loading;
}
