// frontend/src/pages/CalendarPage.tsx
import { usePageTitle } from "../hooks/usePageTitle";
import CalendarView from "../components/calendar/CalendarView";

export default function CalendarPage() {
  usePageTitle();
  return <CalendarView />;
}
