import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from "@headlessui/react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { onIdTokenChanged, getAuth, signOut } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { API_URL, getAvatarColor } from "../constants";

const discoverLinks = [
  { name: "Trending", href: "/trending" },
  { name: "Upcoming", href: "/upcoming" },
  { name: "Browse Genres", href: "/search-genres" },
];

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function NavDropdown({
  label,
  links,
  badges,
  currentPath,
}: {
  label: string;
  links: { name: string; href: string }[];
  badges?: Record<string, number>;
  currentPath: string;
}) {
  const isActive = links.some((l) => l.href === currentPath);
  const totalBadge = badges
    ? Object.values(badges).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <Menu as="div" className="relative">
      <MenuButton
        className={classNames(
          isActive
            ? "bg-gray-950/50 text-white"
            : "text-gray-300 hover:bg-white/5 hover:text-white",
          "inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        )}
      >
        {label}
        {totalBadge > 0 && <Badge count={totalBadge} />}
        <svg
          className="w-3.5 h-3.5 opacity-60"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </MenuButton>
      <MenuItems className="absolute left-0 z-20 mt-1 w-44 origin-top-left rounded-lg bg-gray-800 border border-white/10 py-1 shadow-xl transition data-closed:scale-95 data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in">
        {links.map((link) => {
          const badge = badges?.[link.href] ?? 0;
          return (
            <MenuItem key={link.name}>
              <Link
                to={link.href}
                className={classNames(
                  currentPath === link.href
                    ? "text-white bg-white/10"
                    : "text-gray-300",
                  "flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 hover:text-white data-focus:bg-white/5 data-focus:outline-hidden",
                )}
              >
                {link.name}
                {badge > 0 && <Badge count={badge} />}
              </Link>
            </MenuItem>
          );
        })}
      </MenuItems>
    </Menu>
  );
}

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = getAuth(firebaseApp);
  const [user, setUser] = useState(auth.currentUser);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingRequests, setPendingRequests] = useState(0);
  const [unreadRecs, setUnreadRecs] = useState(0);
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim() !== "") {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}&type=all`);
    }
  };

  const fetchCounts = useCallback(async (token: string) => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [friendsRes, recsRes] = await Promise.all([
        fetch(`${API_URL}/friends/requests/incoming`, { headers }),
        fetch(`${API_URL}/recommendations/unread-count`, { headers }),
      ]);
      if (friendsRes.ok) {
        const data: { friendship_id: number }[] = await friendsRes.json();
        setPendingRequests(data.length);
      }
      if (recsRes.ok) {
        const data: { count: number } = await recsRes.json();
        setUnreadRecs(data.count);
      }
    } catch {
      // non-critical — silently ignore
    }
  }, []);

  const fetchAvatar = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${API_URL}/user/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAvatarKey(data.avatar_key ?? null);
      }
    } catch {
      // non-critical
    }
  }, []);

  // onIdTokenChanged fires on login, logout, and token refresh (~every hour).
  // We close and reopen the SSE connection each time so the token stays valid.
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (currentUser) => {
      esRef.current?.close();
      esRef.current = null;

      if (!currentUser) {
        setUser(null);
        setPendingRequests(0);
        setUnreadRecs(0);
        return;
      }

      setUser(currentUser);
      const token = await currentUser.getIdToken();
      fetchCounts(token);
      fetchAvatar(token);

      // EventSource can't send custom headers, so token goes in the query string
      const es = new EventSource(
        `${API_URL}/events/stream?token=${encodeURIComponent(token)}`,
      );
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const data: { type: string } = JSON.parse(e.data);
          if (data.type === "friend_request") {
            setPendingRequests((n) => n + 1);
            window.dispatchEvent(new CustomEvent("friend-request-received"));
          }
          if (data.type === "recommendation") {
            setUnreadRecs((n) => n + 1);
            window.dispatchEvent(new CustomEvent("recommendation-received"));
          }
        } catch {
          // ignore malformed events
        }
      };
    });

    return () => {
      unsubscribe();
      esRef.current?.close();
    };
  }, [fetchCounts]);

  // Re-sync counts on navigation so badges reset after the user acts on them
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    currentUser
      .getIdToken()
      .then(fetchCounts)
      .catch(() => {});
  }, [location.pathname, fetchCounts]);

  // Decrement immediately when a recommendation is marked read on the same page
  useEffect(() => {
    function handler() {
      setUnreadRecs((n) => Math.max(0, n - 1));
    }
    window.addEventListener("rec-marked-read", handler);
    return () => window.removeEventListener("rec-marked-read", handler);
  }, []);

  // Re-fetch avatar when the user saves a new one from Settings
  useEffect(() => {
    function handler() {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      currentUser
        .getIdToken()
        .then(fetchAvatar)
        .catch(() => {});
    }
    window.addEventListener("avatar-updated", handler);
    return () => window.removeEventListener("avatar-updated", handler);
  }, [fetchAvatar]);

  // Decrement immediately when a friend request is accepted or declined on the same page
  useEffect(() => {
    function handler() {
      setPendingRequests((n) => Math.max(0, n - 1));
    }
    window.addEventListener("friend-request-handled", handler);
    return () => window.removeEventListener("friend-request-handled", handler);
  }, []);

  const libraryBadges: Record<string, number> = {
    "/activity": unreadRecs,
  };

  const libraryLinks = [
    { name: "Watchlist", href: "/watchlist" },
    { name: "Watched", href: "/watched" },
    { name: "Activity", href: "/activity" },
  ];

  return (
    <Disclosure
      as="nav"
      className="relative bg-[#1f3b4d] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-white/10"
    >
      <div className="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8">
        <div className="relative flex h-16 items-center justify-between">
          {/* Mobile hamburger */}
          <div className="absolute inset-y-0 left-0 flex items-center sm:hidden">
            <DisclosureButton className="group relative inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-white/5 hover:text-white focus:outline-2 focus:-outline-offset-1 focus:outline-indigo-500">
              <span className="absolute -inset-0.5" />
              <span className="sr-only">Open main menu</span>
              <Bars3Icon
                aria-hidden="true"
                className="block size-6 group-data-open:hidden"
              />
              <XMarkIcon
                aria-hidden="true"
                className="hidden size-6 group-data-open:block"
              />
            </DisclosureButton>
          </div>

          {/* Logo + desktop nav */}
          <div className="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
            <div className="flex shrink-0 items-center text-white">
              <a href="/" className="flex items-center gap-2 shrink-0">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="text-xl font-bold">Watch Calendar</span>
              </a>
            </div>

            <div className="hidden sm:ml-6 sm:flex sm:items-center sm:gap-1">
              {/* Dashboard */}
              <Link
                to="/"
                className={classNames(
                  location.pathname === "/"
                    ? "bg-gray-950/50 text-white"
                    : "text-gray-300 hover:bg-white/5 hover:text-white",
                  "rounded-md px-3 py-2 text-sm font-medium",
                )}
              >
                Calendar
              </Link>

              {/* Discover dropdown */}
              <NavDropdown
                label="Discover"
                links={discoverLinks}
                currentPath={location.pathname}
              />

              {/* My Library dropdown — signed in only */}
              {user && (
                <NavDropdown
                  label="My Library"
                  links={libraryLinks}
                  badges={libraryBadges}
                  currentPath={location.pathname}
                />
              )}
            </div>
          </div>

          {/* Right side: search + avatar/sign in */}
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0 space-x-2">
            <div className="relative hidden sm:block">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z" />
                </svg>
              </span>
              <input
                type="text"
                value={searchQuery}
                onKeyDown={handleKeyDown}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-10 w-full py-1.5 rounded-md bg-[#2d4e63] border border-[#1f3b4d]/50 text-white text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-950/50 transition"
              />
            </div>

            {/* Profile dropdown */}
            {user && (
              <Menu as="div" className="relative ml-3">
                <MenuButton className="relative flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
                  <span className="absolute -inset-1.5" />
                  <span className="sr-only">Open user menu</span>
                  <div className="relative">
                    {getAvatarColor(avatarKey) ? (
                      <div
                        style={{ backgroundColor: getAvatarColor(avatarKey) }}
                        className="size-8 rounded-full flex items-center justify-center outline -outline-offset-1 outline-white/10"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="rgba(255,255,255,0.9)"
                        >
                          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                        </svg>
                      </div>
                    ) : (
                      <img
                        src={user.photoURL ?? "/avatar-placeholder.png"}
                        alt={user.displayName ?? "User Avatar"}
                        className="size-8 rounded-full bg-gray-800 outline -outline-offset-1 outline-white/10"
                      />
                    )}
                    {pendingRequests > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-[#1f3b4d]">
                        {pendingRequests > 9 ? "9+" : pendingRequests}
                      </span>
                    )}
                  </div>
                </MenuButton>
                <MenuItems
                  transition
                  className="absolute right-0 z-20 mt-2 w-48 origin-top-right rounded-md bg-gray-800 py-1 outline -outline-offset-1 outline-white/10 transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
                >
                  <MenuItem>
                    <a
                      href="/profile"
                      className="flex items-center justify-between px-4 py-2 text-sm text-gray-300 data-focus:bg-white/5 data-focus:outline-hidden"
                    >
                      Your profile
                      {pendingRequests > 0 && <Badge count={pendingRequests} />}
                    </a>
                  </MenuItem>
                  <MenuItem>
                    <a
                      href="/settings"
                      className="block px-4 py-2 text-sm text-gray-300 data-focus:bg-white/5 data-focus:outline-hidden"
                    >
                      Settings
                    </a>
                  </MenuItem>
                  <MenuItem>
                    <button
                      onClick={async () => {
                        await signOut(auth);
                        navigate("/");
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 focus:outline-none"
                    >
                      Sign out
                    </button>
                  </MenuItem>
                </MenuItems>
              </Menu>
            )}

            {!user && (
              <Link
                to="/signIn"
                className="text-gray-300 hover:bg-white/5 hover:text-white rounded-md px-3 py-2 text-sm font-medium"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Mobile panel */}
      <DisclosurePanel className="sm:hidden">
        <div className="space-y-1 px-2 pt-2 pb-3">
          {/* Search */}
          <div className="relative mb-2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z" />
              </svg>
            </span>
            <input
              type="text"
              value={searchQuery}
              onKeyDown={handleKeyDown}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-9 w-full py-2 rounded-md bg-[#2d4e63] border border-[#1f3b4d]/50 text-white text-sm placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-950/50 transition"
            />
          </div>

          {/* Dashboard */}
          <DisclosureButton
            as="a"
            href="/"
            className={classNames(
              location.pathname === "/"
                ? "bg-gray-950/50 text-white"
                : "text-gray-300 hover:bg-white/5 hover:text-white",
              "block rounded-md px-3 py-2 text-base font-medium",
            )}
          >
            Dashboard
          </DisclosureButton>

          {/* Discover group */}
          <p className="px-3 pt-2 pb-1 text-xs uppercase tracking-wider text-gray-500 font-semibold">
            Discover
          </p>
          {discoverLinks.map((item) => (
            <DisclosureButton
              key={item.name}
              as="a"
              href={item.href}
              className={classNames(
                location.pathname === item.href
                  ? "bg-gray-950/50 text-white"
                  : "text-gray-300 hover:bg-white/5 hover:text-white",
                "block rounded-md px-3 py-2 text-base font-medium",
              )}
            >
              {item.name}
            </DisclosureButton>
          ))}

          {/* My Library group — signed in only */}
          {user && (
            <>
              <p className="px-3 pt-2 pb-1 text-xs uppercase tracking-wider text-gray-500 font-semibold">
                My Library
              </p>
              {libraryLinks.map((item) => {
                const badge = libraryBadges[item.href] ?? 0;
                return (
                  <DisclosureButton
                    key={item.name}
                    as="a"
                    href={item.href}
                    className={classNames(
                      location.pathname === item.href
                        ? "bg-gray-950/50 text-white"
                        : "text-gray-300 hover:bg-white/5 hover:text-white",
                      "flex items-center justify-between rounded-md px-3 py-2 text-base font-medium",
                    )}
                  >
                    {item.name}
                    {badge > 0 && <Badge count={badge} />}
                  </DisclosureButton>
                );
              })}
              <DisclosureButton
                as="a"
                href="/profile"
                className={classNames(
                  location.pathname === "/profile"
                    ? "bg-gray-950/50 text-white"
                    : "text-gray-300 hover:bg-white/5 hover:text-white",
                  "flex items-center justify-between rounded-md px-3 py-2 text-base font-medium",
                )}
              >
                Profile
                {pendingRequests > 0 && <Badge count={pendingRequests} />}
              </DisclosureButton>
            </>
          )}
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
}
