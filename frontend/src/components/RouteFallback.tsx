export default function RouteFallback() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed top-16 left-0 right-0 z-40 pointer-events-none"
    >
      <div className="h-0.5 w-full overflow-hidden bg-neutral-900">
        <div className="route-progress-bar h-full w-1/3 bg-gradient-to-r from-transparent via-primary-400 to-transparent" />
      </div>
    </div>
  );
}
