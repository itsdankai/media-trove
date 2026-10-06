import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout.tsx";
import { Detail } from "./pages/Detail.tsx";
import { History } from "./pages/History.tsx";
import { Home } from "./pages/Home.tsx";
import { Import } from "./pages/Import.tsx";
import { Library } from "./pages/Library.tsx";
import { Marketplace } from "./pages/Marketplace.tsx";
import { Search } from "./pages/Search.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Setup } from "./pages/Setup.tsx";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

// biome-ignore lint/style/noNonNullAssertion: root element is in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="movies" element={<Library kind="movie" />} />
            <Route path="shows" element={<Library kind="show" />} />
            <Route path="audiobooks" element={<Library kind="audiobook" />} />
            <Route path="history" element={<History />} />
            <Route path="search" element={<Search />} />
            <Route path="media/:key" element={<Detail />} />
            <Route path="marketplace" element={<Marketplace />} />
            <Route path="import" element={<Import />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="setup" element={<Setup />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
