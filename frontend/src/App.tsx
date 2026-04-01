import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import NavBar from "./components/NavBar";
import Search from "./pages/Search";
import Dashboard from "./pages/Dashboard";
import SignIn from "./pages/SignIn";
import Settings from "./pages/Settings";
import Upcoming from "./pages/Upcoming";
import MovieInfo from "./pages/MovieInfo";
import ShowInfo from "./pages/ShowInfo";
import PersonInfo from "./pages/PersonInfo";
import Watched from "./pages/Watched";
import Watchlist from "./pages/Watchlist";
import Trending from "./pages/Trending";
import ProfilePage from "./pages/ProfilePage";
import BrowseGenres from "./pages/BrowseGenres";
import FriendProfilePage from "./pages/FriendProfilePage";
import ActivityFeedPage from "./pages/ActivityFeedPage";
import EpisodeInfo from "./pages/EpisodeInfo";
import BoxOffice from "./pages/BoxOffice";
import CollectionInfo from "./pages/CollectionInfo";

function App() {
  return (
    <BrowserRouter>
      {/* <div className="min-h-screen bg-slate-950 text-slate-100"> */}
      <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
        <NavBar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/signIn" element={<SignIn />} />
          <Route path="/upcoming" element={<Upcoming />} />
          <Route path="/movie/:id" element={<MovieInfo />} />
          <Route path="/tv/:id" element={<ShowInfo />} />
          <Route path="/person/:id" element={<PersonInfo />} />
          <Route path="/watched" element={<Watched />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/trending" element={<Trending />} />
          <Route path="/browse-genres" element={<BrowseGenres />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/user/:username" element={<FriendProfilePage />} />
          <Route path="/activity" element={<ActivityFeedPage />} />
          <Route
            path="/tv/:showId/episode/:season/:episode"
            element={<EpisodeInfo />}
          />
          <Route path="/box-office" element={<BoxOffice />} />
          <Route path="/collection/:id" element={<CollectionInfo />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
