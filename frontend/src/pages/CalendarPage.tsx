// frontend/src/pages/CalendarPage.tsx
import { usePageTitle } from "../hooks/usePageTitle";
import CalendarView from "../components/calendar/CalendarView";
import CurrentlyWatchingStrip from "../components/CurrentlyWatchingStrip";
import ForYouPreview from "../components/ForYouPreview";

export default function CalendarPage() {
  usePageTitle();
  return (
    <div>
      <CurrentlyWatchingStrip />
      <CalendarView />
      <ForYouPreview />
    </div>
  );
}
