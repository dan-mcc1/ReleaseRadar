import {
  CloseButton,
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
import { onIdTokenChanged, signOut } from "firebase/auth";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "../firebase";
import { API_URL, BASE_IMAGE_URL, getAvatarColor } from "../constants";
import { apiFetch } from "../utils/apiFetch";
import { useNavCounts, useNavAvatar } from "../hooks/api/useNavCounts";
import { queryKeys } from "../hooks/api/queryKeys";
import { useUserMe } from "../hooks/api/useUser";
import { useSearch } from "../hooks/api/useSearch";
import {
  useRecommendationsInbox,
  useMarkRecRead,
} from "../hooks/api/useRecommendations";
import {
  useFriendRequestsIncoming,
  useRespondToFriendRequest,
} from "../hooks/api/useFriends";

interface SearchResult {
  id: number;
  media_type: "movie" | "tv" | "person";
  title?: string;
  name?: string;
  poster_path?: string | null;
  profile_path?: string | null;
}

interface RecommendationItem {
  id: number;
  sender_username: string | null;
  content_type: "movie" | "tv";
  content_id: number;
  content_title: string | null;
  content_poster_path: string | null;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

interface FriendRequest {
  friendship_id: number;
  from_user: { id: string; username: string };
  created_at: string;
  message?: string | null;
}

function timeAgo(isoString: string) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const discoverLinks = [
  { name: "Trending & Upcoming", href: "/trending" },
  { name: "Browse", href: "/browse-genres" },
  { name: "Box Office", href: "/box-office" },
  { name: "News", href: "/news" },
];

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-error-500 text-white text-[10px] font-bold rounded-full leading-none">
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
            ? "bg-neutral-800 text-white"
            : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900",
          "flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13.5px] font-medium tracking-[-0.01em] transition-colors focus:outline-none",
        )}
      >
        {label}
        {totalBadge > 0 && <Badge count={totalBadge} />}
        <svg
          className="ml-0.5 w-3.5 h-3.5 opacity-50"
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
      <MenuItems
        modal={false}
        transition
        className="absolute left-0 z-20 mt-1 w-48 origin-top-left rounded-xl bg-neutral-900 border border-neutral-700/70 py-1 shadow-2xl shadow-black/40 transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
      >
        {links.map((item) => {
          const badge = badges?.[item.href] ?? 0;
          return (
            <MenuItem key={item.name}>
              <Link
                to={item.href}
                className={classNames(
                  item.href === currentPath ? "bg-white/5" : "",
                  "flex items-center justify-between px-3 py-2 text-[13px] font-medium text-neutral-300 data-focus:bg-white/5 data-focus:outline-hidden hover:bg-white/5 transition-colors",
                )}
              >
                {item.name}
                {badge > 0 && <Badge count={badge} />}
              </Link>
            </MenuItem>
          );
        })}
      </MenuItems>
    </Menu>
  );
}

// Desktop search — owns all search state so typing doesn't re-render the rest of the nav
function SearchBar() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  const { data: searchData, isPending: searchPending } =
    useSearch(debouncedQuery);

  const dropdownResults: SearchResult[] = (() => {
    if (!searchData) return [];
    const shows = (searchData.shows ?? [])
      .slice(0, 3)
      .map((r) => ({ ...r, media_type: "tv" as const }));
    const movies = (searchData.movies ?? [])
      .slice(0, 2)
      .map((r) => ({ ...r, media_type: "movie" as const }));
    const people = (searchData.people ?? [])
      .slice(0, 1)
      .map((r) => ({ ...r, media_type: "person" as const }));
    const combined: SearchResult[] = [];
    const maxLen = Math.max(shows.length, movies.length, people.length);
    for (let i = 0; i < maxLen; i++) {
      if (shows[i]) combined.push(shows[i]);
      if (movies[i]) combined.push(movies[i]);
      if (people[i]) combined.push(people[i]);
    }
    return combined.slice(0, 6);
  })();
  const dropdownLoading = searchPending && debouncedQuery.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim() !== "") {
      setDropdownOpen(false);
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
    if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  };

  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleGlobalKey);
    return () => document.removeEventListener("keydown", handleGlobalKey);
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setDebouncedQuery("");
      setDropdownOpen(false);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(q);
      setDropdownOpen(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={searchContainerRef} className="relative hidden lg:block">
      <div
        className={classNames(
          "flex items-center gap-2 h-9 px-3 rounded-xl border transition-colors cursor-text w-72",
          searchFocused
            ? "bg-neutral-900 border-neutral-600"
            : "bg-neutral-900 border-neutral-700/70",
        )}
        onClick={() => searchInputRef.current?.focus()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-[15px] h-[15px] text-neutral-500 shrink-0"
        >
          <path d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z" />
        </svg>
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onKeyDown={handleKeyDown}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => {
            setSearchFocused(true);
            if (dropdownResults.length > 0) setDropdownOpen(true);
          }}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search shows, movies, people"
          className="flex-1 bg-transparent text-white text-[13px] placeholder-neutral-500 focus:outline-none min-w-0"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSearchQuery("");
            }}
            className="text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="font-mono text-[11px] px-1.5 py-0.5 border border-neutral-700 rounded text-neutral-600 shrink-0 select-none">
            {isMac ? "⌘K" : "Ctrl K"}
          </span>
        )}
      </div>

      {dropdownOpen && (
        <div className="absolute top-full mt-1.5 right-0 w-80 bg-neutral-900 border border-neutral-700/70 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
          {dropdownLoading && dropdownResults.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-neutral-500">
              Searching…
            </div>
          ) : dropdownResults.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-neutral-500">
              No results found.
            </div>
          ) : (
            <>
              {dropdownResults.map((result) => {
                const label = result.title ?? result.name ?? "";
                const href =
                  result.media_type === "movie"
                    ? `/movie/${result.id}`
                    : result.media_type === "tv"
                      ? `/tv/${result.id}`
                      : `/person/${result.id}`;
                const imgPath =
                  result.media_type === "person"
                    ? result.profile_path
                    : result.poster_path;
                const typeLabel =
                  result.media_type === "movie"
                    ? "Movie"
                    : result.media_type === "tv"
                      ? "TV Show"
                      : "Person";
                return (
                  <Link
                    key={`${result.media_type}-${result.id}`}
                    to={href}
                    onClick={() => {
                      setDropdownOpen(false);
                      setSearchQuery("");
                    }}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex-shrink-0 w-8 h-12 rounded-lg overflow-hidden bg-neutral-800">
                      {imgPath ? (
                        <img
                          src={`${BASE_IMAGE_URL}/w185${imgPath}`}
                          alt={label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500 text-[9px] text-center leading-tight px-0.5">
                          {label}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-white truncate">
                        {label}
                      </p>
                      <p className="text-[12px] text-neutral-500">
                        {typeLabel}
                      </p>
                    </div>
                  </Link>
                );
              })}
              <Link
                to={`/search?q=${encodeURIComponent(searchQuery.trim())}&type=all`}
                onClick={() => {
                  setDropdownOpen(false);
                  setSearchQuery("");
                }}
                className="flex items-center justify-center px-3 py-2 border-t border-neutral-800 text-[12px] text-primary-400 hover:text-primary-300 hover:bg-white/5 transition-colors"
              >
                See all results →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Notifications bell — owns open state + notification data so it doesn't spill into the nav
function NotificationsPanel() {
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { data: navCounts } = useNavCounts();
  const pendingRequests = navCounts?.pendingRequests ?? 0;
  const unreadRecs = navCounts?.unreadRecs ?? 0;
  const hasNotifications = pendingRequests > 0 || unreadRecs > 0;

  const { data: recsRaw } = useRecommendationsInbox();
  const { data: requestsRaw } = useFriendRequestsIncoming();
  const notifRecs = ((recsRaw ?? []) as RecommendationItem[])
    .filter((r) => !r.is_read)
    .slice(0, 4);
  const notifRequests = ((requestsRaw ?? []) as FriendRequest[]).slice(0, 4);
  const totalNotifs = notifRecs.length + notifRequests.length;

  const markRecRead = useMarkRecRead();
  const respondToRequest = useRespondToFriendRequest();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={notifRef} className="relative hidden lg:block">
      <button
        onClick={() => setNotifOpen((o) => !o)}
        className="relative flex items-center justify-center w-9 h-9 rounded-xl border border-neutral-700/70 bg-transparent text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          className="w-[17px] h-[17px]"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {hasNotifications && (
          <span className="absolute top-[7px] right-[8px] w-[6px] h-[6px] rounded-full bg-primary-400" />
        )}
      </button>

      {notifOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-neutral-900 border border-neutral-700/70 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-neutral-800 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-neutral-400 uppercase tracking-wider">
              Notifications
            </span>
            {totalNotifs > 0 && (
              <span className="text-[11px] text-neutral-500">
                {totalNotifs} new
              </span>
            )}
          </div>

          {totalNotifs === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.4}
                className="w-8 h-8 text-neutral-700"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                />
              </svg>
              <p className="text-[13px] text-neutral-500">
                You're all caught up
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-800/60">
              {notifRequests.map((req) => (
                <div
                  key={req.friendship_id}
                  className="flex items-start gap-3 px-3 py-2.5 hover:bg-white/4 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-full bg-primary-800/50 border border-primary-700/40 flex items-center justify-center shrink-0 mt-0.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-4 h-4 text-primary-400"
                    >
                      <path d="M6.25 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM3.25 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM19.75 7.5a.75.75 0 00-1.5 0v2.25H16a.75.75 0 000 1.5h2.25v2.25a.75.75 0 001.5 0v-2.25H22a.75.75 0 000-1.5h-2.25V7.5z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-neutral-200 leading-snug">
                      <span className="font-semibold">
                        {req.from_user.username}
                      </span>
                      <span className="text-neutral-400">
                        {" "}
                        sent you a friend request
                      </span>
                    </p>
                    {req.message && (
                      <p className="text-[12px] text-neutral-500 truncate mt-0.5">
                        "{req.message}"
                      </p>
                    )}
                    <p className="text-[11px] text-neutral-600 mt-0.5">
                      {timeAgo(req.created_at)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        onClick={() =>
                          respondToRequest.mutate({
                            friendshipId: req.friendship_id,
                            accept: true,
                          })
                        }
                        disabled={respondToRequest.isPending}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] font-medium bg-primary-500/20 text-primary-400 border border-primary-500/30 hover:bg-primary-500/30 transition-colors disabled:opacity-50"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className="w-3 h-3"
                        >
                          <path
                            fillRule="evenodd"
                            d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Accept
                      </button>
                      <button
                        onClick={() =>
                          respondToRequest.mutate({
                            friendshipId: req.friendship_id,
                            accept: false,
                          })
                        }
                        disabled={respondToRequest.isPending}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700 hover:text-neutral-200 transition-colors disabled:opacity-50"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className="w-3 h-3"
                        >
                          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
                        </svg>
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {notifRecs.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-start gap-3 px-3 py-2.5 hover:bg-white/4 transition-colors group"
                >
                  <Link
                    to={
                      rec.content_type === "movie"
                        ? `/movie/${rec.content_id}`
                        : `/tv/${rec.content_id}`
                    }
                    onClick={() => setNotifOpen(false)}
                    className="w-8 h-12 rounded-md overflow-hidden bg-neutral-800 shrink-0 block"
                  >
                    {rec.content_poster_path ? (
                      <img
                        src={`${BASE_IMAGE_URL}/w92${rec.content_poster_path}`}
                        alt={rec.content_title ?? ""}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-600">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="w-4 h-4"
                        >
                          <path d="M19.5 6h-15v10.5h15V6z" />
                          <path
                            fillRule="evenodd"
                            d="M3 3.75A.75.75 0 013.75 3h16.5a.75.75 0 01.75.75v16.5a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V3.75zm1.5.75v15h15v-15h-15z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                    )}
                  </Link>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <Link
                      to={
                        rec.content_type === "movie"
                          ? `/movie/${rec.content_id}`
                          : `/tv/${rec.content_id}`
                      }
                      onClick={() => setNotifOpen(false)}
                      className="block"
                    >
                      <p className="text-[13px] text-neutral-200 leading-snug">
                        <span className="font-semibold">
                          {rec.sender_username ?? "Someone"}
                        </span>
                        <span className="text-neutral-400"> recommended </span>
                        <span className="font-medium text-neutral-200">
                          {rec.content_title}
                        </span>
                      </p>
                      {rec.message && (
                        <p className="text-[12px] text-neutral-500 truncate mt-0.5">
                          "{rec.message}"
                        </p>
                      )}
                      <p className="text-[11px] text-neutral-600 mt-0.5">
                        {timeAgo(rec.created_at)}
                      </p>
                    </Link>
                  </div>
                  <button
                    onClick={() => markRecRead.mutate(rec.id)}
                    disabled={markRecRead.isPending}
                    title="Mark as read"
                    className="opacity-0 group-hover:opacity-100 shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-white/8 transition-all disabled:opacity-30"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="w-3.5 h-3.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-neutral-800 px-3 py-2 flex items-center gap-2">
            <Link
              to="/activity"
              onClick={() => setNotifOpen(false)}
              className="flex-1 text-center text-[12.5px] font-medium text-neutral-400 hover:text-neutral-200 hover:bg-white/5 rounded-lg py-1.5 transition-colors"
            >
              Activity
            </Link>
            <div className="w-px h-4 bg-neutral-800" />
            <Link
              to="/friends"
              onClick={() => setNotifOpen(false)}
              className="flex-1 text-center text-[12.5px] font-medium text-neutral-400 hover:text-neutral-200 hover:bg-white/5 rounded-lg py-1.5 transition-colors"
            >
              Friends
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(auth.currentUser);
  const [mobileDiscoverOpen, setMobileDiscoverOpen] = useState(false);
  const [mobileLibraryOpen, setMobileLibraryOpen] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedUidRef = useRef<string | null>(null);

  const { data: navCounts } = useNavCounts();
  const { data: avatarKey } = useNavAvatar();
  const { data: userMe } = useUserMe();
  const pendingRequests = navCounts?.pendingRequests ?? 0;
  const unreadRecs = navCounts?.unreadRecs ?? 0;
  // const showUpgradeCta = user && userMe?.subscription_tier === "free";
  const showUpgradeCta = false;

  const libraryBadges: Record<string, number> = {
    "/activity": unreadRecs,
    "/friends": pendingRequests,
  };

  const libraryLinks = [
    { name: "Watchlist", href: "/watchlist" },
    { name: "Watched", href: "/watched" },
    { name: "Shelves", href: "/shelves" },
    { name: "Stats", href: "/stats" },
    { name: "For You", href: "/for-you" },
    { name: "Activity", href: "/activity" },
    { name: "Friends", href: "/friends" },
  ];

  const connectSSE = useCallback(
    async (uid: string) => {
      if (esRef.current?.readyState === EventSource.OPEN) return;
      esRef.current?.close();
      esRef.current = null;

      if (!auth.currentUser) return;

      const tokenRes = await apiFetch("/events/token", { method: "POST" });
      if (!tokenRes.ok) return;
      const { session_token } = await tokenRes.json();
      const es = new EventSource(
        `${API_URL}/events/stream?token=${encodeURIComponent(session_token)}`,
      );
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const data: {
            type: string;
            pending_requests?: number;
            unread_recs?: number;
          } = JSON.parse(e.data);
          if (data.type === "counts_update") {
            queryClient.setQueryData(
              queryKeys.navCounts(uid),
              (
                old:
                  | { pendingRequests: number; unreadRecs: number }
                  | undefined,
              ) => ({
                pendingRequests:
                  data.pending_requests ?? old?.pendingRequests ?? 0,
                unreadRecs: data.unread_recs ?? old?.unreadRecs ?? 0,
              }),
            );
            queryClient.invalidateQueries({
              queryKey: queryKeys.recommendationsInbox(uid),
            });
            queryClient.invalidateQueries({
              queryKey: queryKeys.friendRequestsIncoming(uid),
            });
          }
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        esRef.current?.close();
        esRef.current = null;

        queryClient.invalidateQueries({ queryKey: queryKeys.navCounts(uid) });

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connectSSE(uid);
        }, 2000);
      };
    },
    [queryClient],
  );

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (currentUser) => {
      if (!currentUser) {
        esRef.current?.close();
        esRef.current = null;
        connectedUidRef.current = null;
        setUser(null);
        return;
      }

      setUser(currentUser);

      if (currentUser.uid !== connectedUidRef.current) {
        esRef.current?.close();
        esRef.current = null;
        connectedUidRef.current = currentUser.uid;
        queryClient.invalidateQueries({
          queryKey: queryKeys.navCounts(currentUser.uid),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.navAvatar(currentUser.uid),
        });
        connectSSE(currentUser.uid);
      }
    });

    return () => {
      unsubscribe();
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      esRef.current?.close();
      connectedUidRef.current = null;
    };
  }, [connectSSE, queryClient]);

  return (
    <Disclosure
      as="nav"
      className="fixed top-0 left-0 right-0 z-50 bg-neutral-950 border-b border-neutral-800/70"
    >
      <div className="px-4 lg:px-10">
        <div className="relative flex h-16 items-center gap-6">
          {/* Mobile hamburger + back button */}
          <div className="flex items-center gap-0.5 lg:hidden">
            {location.pathname !== "/" && (
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center justify-center rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white transition-colors"
                aria-label="Go back"
              >
                <svg
                  className="size-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
            )}
            <DisclosureButton className="group relative inline-flex items-center justify-center rounded-lg p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white transition-colors focus:outline-none">
              <span className="absolute -inset-0.5" />
              <span className="sr-only">Open main menu</span>
              <Bars3Icon
                aria-hidden="true"
                className="block size-5 group-data-open:hidden"
              />
              <XMarkIcon
                aria-hidden="true"
                className="hidden size-5 group-data-open:block"
              />
            </DisclosureButton>
          </div>

          {/* Logo */}
          <a href="/calendar" className="flex items-center gap-2.5 shrink-0">
            <img src="/favicon-1024.png" className="h-7 w-auto" alt="Logo" />
            <span className="text-white font-semibold text-[16px] tracking-[-0.02em] truncate max-[350px]:hidden">
              Release Radar
            </span>
          </a>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            <Link
              to="/calendar"
              className={classNames(
                location.pathname === "/calendar"
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900",
                "rounded-lg px-3 py-1.5 text-[13.5px] font-medium tracking-[-0.01em] transition-colors",
              )}
            >
              Calendar
            </Link>

            <NavDropdown
              label="Discover"
              links={discoverLinks}
              currentPath={location.pathname}
            />

            {user && (
              <NavDropdown
                label="My Library"
                links={libraryLinks}
                badges={libraryBadges}
                currentPath={location.pathname}
              />
            )}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right side */}
          <div className="flex items-center gap-2">
            {showUpgradeCta && (
              <Link
                to="/pricing"
                className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M2.5 7.5L5 14h14l2.5-6.5L17 10l-5-6-5 6-4.5-2.5zm2.5 8h14v2H5v-2z" />
                </svg>
                Upgrade
              </Link>
            )}

            {/* Desktop search — isolated component, typing doesn't re-render nav */}
            <SearchBar />

            {/* Notifications bell — isolated component */}
            {user && <NotificationsPanel />}

            {/* Profile dropdown */}
            {user && (
              <Menu as="div" className="relative">
                <MenuButton className="relative flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500">
                  <span className="absolute -inset-1.5" />
                  <span className="sr-only">Open user menu</span>
                  <div className="relative">
                    {getAvatarColor(avatarKey) ? (
                      <div
                        style={{ backgroundColor: getAvatarColor(avatarKey) }}
                        className="size-8 rounded-full flex items-center justify-center ring-1 ring-white/10"
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
                        className="size-8 rounded-full bg-neutral-800 ring-1 ring-white/10"
                      />
                    )}
                    {pendingRequests > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-error-500 text-[9px] font-bold text-white ring-2 ring-neutral-950">
                        {pendingRequests > 9 ? "9+" : pendingRequests}
                      </span>
                    )}
                  </div>
                </MenuButton>
                <MenuItems
                  modal={false}
                  transition
                  className="absolute right-0 z-20 mt-2 w-48 origin-top-right rounded-xl bg-neutral-900 border border-neutral-700/70 py-1 shadow-2xl shadow-black/40 transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in"
                >
                  <MenuItem>
                    <a
                      href="/profile"
                      className="flex items-center justify-between px-3 py-2 text-[13px] font-medium text-neutral-300 data-focus:bg-white/5 data-focus:outline-hidden hover:bg-white/5 transition-colors"
                    >
                      Your profile
                      {pendingRequests > 0 && <Badge count={pendingRequests} />}
                    </a>
                  </MenuItem>
                  <MenuItem>
                    <a
                      href="/settings"
                      className="block px-3 py-2 text-[13px] font-medium text-neutral-300 data-focus:bg-white/5 data-focus:outline-hidden hover:bg-white/5 transition-colors"
                    >
                      Settings
                    </a>
                  </MenuItem>
                  {/* <MenuItem>
                    <a
                      href="/billing"
                      className="flex items-center justify-between px-3 py-2 text-[13px] font-medium text-neutral-300 data-focus:bg-white/5 data-focus:outline-hidden hover:bg-white/5 transition-colors"
                    >
                      Subscription
                      {userMe?.subscription_tier === "premium" && (
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-1.5 py-0.5">
                          Premium
                        </span>
                      )}
                    </a>
                  </MenuItem> */}
                  {userMe?.subscription_tier === "admin" && (
                    <MenuItem>
                      <a
                        href="/admin"
                        className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-red-400 data-focus:bg-white/5 data-focus:outline-hidden hover:bg-white/5 transition-colors"
                      >
                        Admin
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30 rounded-full px-1.5 py-0.5">
                          Admin
                        </span>
                      </a>
                    </MenuItem>
                  )}
                  <div className="my-1 border-t border-neutral-800" />
                  <MenuItem>
                    <button
                      onClick={async () => {
                        await signOut(auth);
                        navigate("/");
                      }}
                      className="w-full text-left px-3 py-2 text-[13px] font-medium text-neutral-400 hover:bg-white/5 hover:text-neutral-200 transition-colors focus:outline-none"
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
                className="text-neutral-400 hover:text-white rounded-lg px-3 py-1.5 text-[13.5px] font-medium tracking-[-0.01em] hover:bg-neutral-900 transition-colors"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Mobile panel */}
      <DisclosurePanel className="lg:hidden border-t border-neutral-800/70">
        <CloseButton
          ref={mobileCloseRef}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />
        <div className="space-y-1 px-3 pt-2 pb-3">
          {/* Search */}
          <form
            className="relative mb-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!mobileSearchQuery.trim()) return;
              mobileCloseRef.current?.click();
              navigate(
                `/search?q=${encodeURIComponent(mobileSearchQuery.trim())}`,
              );
              setMobileSearchQuery("");
            }}
          >
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">
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
              enterKeyHint="search"
              value={mobileSearchQuery}
              onChange={(e) => setMobileSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-9 pr-8 w-full py-2 rounded-xl bg-neutral-900 border border-neutral-700/70 text-white text-[16px] placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition-colors"
            />
            {mobileSearchQuery && (
              <button
                type="button"
                onClick={() => setMobileSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                aria-label="Clear search"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            )}
          </form>

          {/* Calendar */}
          <DisclosureButton
            as="a"
            href="/calendar"
            className={classNames(
              location.pathname === "/calendar"
                ? "bg-neutral-800 text-white"
                : "text-neutral-400 hover:bg-neutral-900 hover:text-white",
              "block rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
            )}
          >
            Calendar
          </DisclosureButton>

          {/* Discover accordion */}
          <button
            onClick={() => setMobileDiscoverOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[14px] font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white transition-colors"
          >
            Discover
            <svg
              className={`w-4 h-4 opacity-50 transition-transform duration-200 ${mobileDiscoverOpen ? "rotate-180" : ""}`}
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
          </button>
          {mobileDiscoverOpen && (
            <div className="ml-3 border-l border-neutral-800 pl-3 flex flex-col gap-0.5">
              {discoverLinks.map((item) => (
                <DisclosureButton
                  key={item.name}
                  as={Link}
                  to={item.href}
                  className={classNames(
                    location.pathname === item.href
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:bg-neutral-900 hover:text-white",
                    "block rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                  )}
                >
                  {item.name}
                </DisclosureButton>
              ))}
            </div>
          )}

          {/* My Library accordion — signed in only */}
          {user && (
            <>
              <button
                onClick={() => setMobileLibraryOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[14px] font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white transition-colors"
              >
                <span className="flex items-center gap-1">
                  My Library
                  {Object.values(libraryBadges).reduce((a, b) => a + b, 0) +
                    pendingRequests >
                    0 && (
                    <Badge
                      count={
                        Object.values(libraryBadges).reduce(
                          (a, b) => a + b,
                          0,
                        ) + pendingRequests
                      }
                    />
                  )}
                </span>
                <svg
                  className={`w-4 h-4 opacity-50 transition-transform duration-200 ${mobileLibraryOpen ? "rotate-180" : ""}`}
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
              </button>
              {mobileLibraryOpen && (
                <div className="ml-3 border-l border-neutral-800 pl-3 flex flex-col gap-0.5">
                  {libraryLinks.map((item) => {
                    const badge = libraryBadges[item.href] ?? 0;
                    return (
                      <DisclosureButton
                        key={item.name}
                        as={Link}
                        to={item.href}
                        className={classNames(
                          location.pathname === item.href
                            ? "bg-neutral-800 text-white"
                            : "text-neutral-400 hover:bg-neutral-900 hover:text-white",
                          "flex items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                        )}
                      >
                        {item.name}
                        {badge > 0 && <Badge count={badge} />}
                      </DisclosureButton>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
}
