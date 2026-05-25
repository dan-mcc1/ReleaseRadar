import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import "./App.css";
import NavBar from "./components/NavBar";
import InstallBanner from "./components/InstallBanner";
import ProtectedRoute from "./components/ProtectedRoute";
import RouteFallback from "./components/RouteFallback";
import { useAccountStatus } from "./hooks/api/useUser";
import { setAccountRestricted, onBanDetected } from "./utils/accountState";
import LandingPage from "./pages/LandingPage";
import CalendarPage from "./pages/CalendarPage";
import SignIn from "./pages/SignIn";
import MovieInfo from "./pages/MovieInfo";
import ShowInfo from "./pages/ShowInfo";
import Footer from "./components/Footer";
import SpotlightTour from "./components/SpotlightTour";
import WarningModal from "./components/WarningModal";
import SuspensionBanModal from "./components/SuspensionBanModal";
import { ToastProvider } from "./components/Toast";
import ErrorBoundary from "./components/ErrorBoundary";

const Search = lazy(() => import("./pages/Search"));
const Settings = lazy(() => import("./pages/Settings"));
const Upcoming = lazy(() => import("./pages/Upcoming"));
const PersonInfo = lazy(() => import("./pages/PersonInfo"));
const Watched = lazy(() => import("./pages/Watched"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Trending = lazy(() => import("./pages/Trending"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const BrowseGenres = lazy(() => import("./pages/BrowseGenres"));
const FriendProfilePage = lazy(() => import("./pages/FriendProfilePage"));
const ActivityFeedPage = lazy(() => import("./pages/ActivityFeedPage"));
const FriendsPage = lazy(() => import("./pages/FriendsPage"));
const EpisodeInfo = lazy(() => import("./pages/EpisodeInfo"));
const BoxOffice = lazy(() => import("./pages/BoxOffice"));
const CollectionInfo = lazy(() => import("./pages/CollectionInfo"));
const BrowseCollections = lazy(() => import("./pages/BrowseCollections"));
const MyCollections = lazy(() => import("./pages/MyCollections"));
const BrowseGroups = lazy(() => import("./pages/BrowseGroups"));
const MyGroups = lazy(() => import("./pages/MyGroups"));
const GroupDetail = lazy(() => import("./pages/GroupDetail"));
const ForYou = lazy(() => import("./pages/ForYou"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const ShelvesPage = lazy(() => import("./pages/ShelvesPage"));
const ShelfDetailPage = lazy(() => import("./pages/ShelfDetailPage"));
const Pricing = lazy(() => import("./pages/Pricing"));
const BillingSettings = lazy(() => import("./pages/BillingSettings"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const AdminModerationPage = lazy(() => import("./pages/AdminModerationPage"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage"));
const News = lazy(() => import("./pages/News"));
const CommunityGuidelines = lazy(() => import("./pages/CommunityGuidelines"));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"));
const AdminFeedbackPage = lazy(() => import("./pages/AdminFeedbackPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const ImportPage = lazy(() => import("./pages/ImportPage"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function BanGate({ children }: { children: ReactNode }) {
  const [banDetected, setBanDetected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    onBanDetected(() => {
      setBanDetected(true);
      queryClient.invalidateQueries({ queryKey: ["accountStatus"] });
    });
  }, [queryClient]);

  const { data: status, isLoading } = useAccountStatus();
  const isRestricted = !!(status?.is_banned || status?.is_suspended) || banDetected;

  useEffect(() => {
    setAccountRestricted(isRestricted);
  }, [isRestricted]);

  // Clear the detected flag once the server confirms the restriction is lifted,
  // which also stops the 5-minute polling and unblocks apiFetch.
  useEffect(() => {
    if (banDetected && status && !status.is_banned && !status.is_suspended) {
      setBanDetected(false);
    }
  }, [banDetected, status]);

  if (isLoading && !banDetected) return null;
  if (isRestricted) return <SuspensionBanModal asPage />;
  return <>{children}</>;
}

function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} scope="route">
      {children}
    </ErrorBoundary>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isSignIn = pathname === "/signIn";
  const isAdmin = pathname.startsWith("/admin");
  const isStripped = isSignIn || isAdmin;
  return (
    <>
      {!isStripped && <NavBar />}
      {!isStripped && <div className="h-16 shrink-0" />}
      <InstallBanner />
      {children}
      {!isStripped && <Footer />}
    </>
  );
}

function App() {
  return (
    <ToastProvider>
    <BrowserRouter>
      <div className="flex flex-col min-h-screen bg-neutral-950 text-neutral-100">
        <ScrollToTop />
        <AppShell>
        <SpotlightTour />
        <WarningModal />
        <BanGate>
        <Suspense fallback={<RouteFallback />}>
        <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <CalendarPage />
              </ProtectedRoute>
            }
          />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/signIn" element={<SignIn />} />
          <Route path="/upcoming" element={<Navigate to="/trending" replace />} />
          <Route path="/movie/:id" element={<MovieInfo />} />
          <Route path="/tv/:id" element={<ShowInfo />} />
          <Route path="/person/:id" element={<PersonInfo />} />
          <Route path="/watched" element={<Watched />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/trending" element={<Trending />} />
          <Route path="/browse-genres" element={<BrowseGenres />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/user/:username" element={<FriendProfilePage />} />
          <Route path="/activity" element={<ActivityFeedPage />} />
          <Route
            path="/tv/:showId/episode/:season/:episode"
            element={<EpisodeInfo />}
          />
          <Route path="/box-office" element={<BoxOffice />} />
          <Route path="/news" element={<News />} />
          <Route
            path="/stats"
            element={
              <ProtectedRoute>
                <StatsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/collections" element={<BrowseCollections />} />
          <Route
            path="/my-collections"
            element={
              <ProtectedRoute>
                <MyCollections />
              </ProtectedRoute>
            }
          />
          <Route path="/collection/:id" element={<CollectionInfo />} />
          <Route path="/groups" element={<BrowseGroups />} />
          <Route
            path="/my-groups"
            element={
              <ProtectedRoute>
                <MyGroups />
              </ProtectedRoute>
            }
          />
          <Route path="/groups/:slug" element={<GroupDetail />} />
          <Route path="/for-you" element={<ForYou />} />
          <Route path="/unsubscribe" element={<Unsubscribe />} />
          <Route path="/community-guidelines" element={<CommunityGuidelines />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/billing" element={<BillingSettings />} />
          <Route
            path="/import"
            element={
              <ProtectedRoute>
                <ImportPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/moderation"
            element={
              <ProtectedRoute>
                <AdminModerationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/feedback"
            element={
              <ProtectedRoute>
                <AdminFeedbackPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute>
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shelves"
            element={
              <ProtectedRoute>
                <ShelvesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shelves/:id"
            element={
              <ProtectedRoute>
                <ShelfDetailPage />
              </ProtectedRoute>
            }
          />
        </Routes>
        </RouteErrorBoundary>
        </Suspense>
        </BanGate>
        </AppShell>
      </div>
    </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
