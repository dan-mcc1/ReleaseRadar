import { lazy, Suspense } from "react";
import { useUserMe } from "../hooks/api/useUser";
import { useAuthUser } from "../hooks/useAuthUser";

// Driver.js (~20KB gzip + CSS) is only needed for the new-user onboarding flow.
// Keep it out of the main bundle by deferring the import until we know the user
// hasn't completed onboarding yet.
const SpotlightTourImpl = lazy(() => import("./SpotlightTourImpl"));

export default function SpotlightTour() {
  const authUser = useAuthUser();
  const { data: dbUser } = useUserMe();

  if (!authUser || !dbUser || dbUser.onboarding_completed) return null;

  return (
    <Suspense fallback={null}>
      <SpotlightTourImpl />
    </Suspense>
  );
}
