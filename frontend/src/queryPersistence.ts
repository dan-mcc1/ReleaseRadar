// frontend/src/queryPersistence.ts
//
// Keeps the calendar's queries in IndexedDB, so a reload or a new visit draws
// the calendar from the saved copy right away and refreshes it in the
// background, instead of waiting a cross-country round trip for the first paint.
//
// Each query is saved and restored on its own, inside its own fetch (a
// per-query persister). Nothing else in the app waits for IndexedDB, and only
// a calendar fetch or a watched toggle writes to it.
import { clear, createStore, del, entries, get, set } from "idb-keyval";
import { onAuthStateChanged } from "firebase/auth";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import { auth } from "./firebase";

// Query keys whose first element is this are saved: the calendar's chunks
// (["calendar", uid, ...]). The uid is in the key, so one account never
// restores another's copy.
const PERSISTED_ROOT = "calendar";

// Saved queries older than this are discarded instead of restored.
const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

// Bump when a saved query's data changes shape; older copies are discarded.
const BUSTER = "calendar-v1";

// A database of its own, so signing out can clear it in one call.
const store =
  typeof indexedDB === "undefined"
    ? undefined
    : createStore("releaseradar-query-cache", "queries");

const persister = experimental_createQueryPersister({
  storage: store && {
    getItem: (key) => get<string>(key, store),
    setItem: (key, value) => set(key, value, store),
    removeItem: (key) => del(key, store),
    entries: () => entries<string, string>(store),
  },
  maxAge: PERSIST_MAX_AGE,
  buster: BUSTER,
  filters: { queryKey: [PERSISTED_ROOT] },
});

/** Pass as a query's `persister` to save it to IndexedDB. */
export const calendarPersister = persister.persisterFn;

/**
 * Save a query's current data after a setQueryData. The persister only saves
 * after a fetch, so without this a reload would restore the older copy.
 */
export function savePersistedQuery(queryClient: QueryClient, queryKey: QueryKey) {
  if (queryKey[0] !== PERSISTED_ROOT) return;
  void persister.persistQueryByKey(queryKey, queryClient);
}

function clearPersisted(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: [PERSISTED_ROOT] });
  if (store) void clear(store);
}

/**
 * Drop the saved calendar when nobody is signed in: on sign-out, and on
 * startup when the saved copy belongs to a session that has since ended.
 * While signed in, expired copies (months no longer around the one the
 * calendar opens on) are removed once the browser is idle. Call once.
 */
export function maintainPersistedCache(queryClient: QueryClient) {
  void auth.authStateReady().then(() => {
    if (!auth.currentUser) clearPersisted(queryClient);
    else if (store) {
      const gc = () => void persister.persisterGc();
      if ("requestIdleCallback" in window) requestIdleCallback(gc);
      else setTimeout(gc, 5000);
    }
    onAuthStateChanged(auth, (user) => {
      if (!user) clearPersisted(queryClient);
    });
  });
}
