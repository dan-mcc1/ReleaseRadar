import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// No test talks to Firebase. The real module calls getAuth() as soon as it's
// imported, which throws without an API key (as in CI, where there's no
// .env), so any test that imports a real hook or apiFetch would fail to load.
// This stand-in is signed out: onAuthStateChanged reports no user.
vi.mock("../firebase", () => ({
  firebaseApp: {},
  auth: {
    currentUser: null,
    onAuthStateChanged: (next: (user: null) => void) => {
      next(null);
      return () => {};
    },
  },
}));
