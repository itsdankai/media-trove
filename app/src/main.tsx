import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { Layout } from "./components/Layout.tsx";
import { authClient } from "./lib/auth.ts";
import { Join, ResetPassword, SignIn } from "./pages/Auth.tsx";
import { Calendar } from "./pages/Calendar.tsx";
import { Detail } from "./pages/Detail.tsx";
import { History } from "./pages/History.tsx";
import { Home } from "./pages/Home.tsx";
import { Import } from "./pages/Import.tsx";
import { Library } from "./pages/Library.tsx";
import { Plugins } from "./pages/Plugins.tsx";
import { Search } from "./pages/Search.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Setup } from "./pages/Setup.tsx";
import { Favorites, Watchlist } from "./pages/Watchlist.tsx";
import "./styles.css";

/** Everything except the sign-in pages needs a session. */
function SignedIn() {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();
  if (isPending) return null;
  if (!data) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

// biome-ignore lint/style/noNonNullAssertion: root element is in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="sign-in" element={<SignIn />} />
          <Route path="join/:token" element={<Join />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route element={<SignedIn />}>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="movies" element={<Library section="movie" />} />
              <Route path="shows" element={<Library section="show" />} />
              <Route path="audiobooks" element={<Library section="audiobook" />} />
              <Route path="anime" element={<Library section="anime" />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="watchlist" element={<Watchlist />} />
              <Route path="favorites" element={<Favorites />} />
              <Route path="history" element={<History />} />
              <Route path="search" element={<Search />} />
              <Route path="media/:key" element={<Detail />} />
              <Route path="plugins" element={<Plugins />} />
              {/* Renamed from Marketplace (2026-10-10); old links and bookmarks still land. */}
              <Route path="marketplace" element={<Navigate to="/plugins" replace />} />
              <Route path="import" element={<Import />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="setup" element={<Setup />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
