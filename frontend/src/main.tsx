import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { maintainPersistedCache } from "./queryPersistence";
import { initSentry } from "./sentry";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

initSentry();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      retry: 1,
    },
  },
});

maintainPersistedCache(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary scope="root">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
