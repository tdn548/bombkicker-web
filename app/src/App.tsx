// Providers and routes. Order: language -> Unity host (mounted once, outside the routes) -> auth -> player data ->
// router -> play session. The router runs on a gated history (router/gatedHistory.ts) that writes the route into the
// URL only after Unity has started (SS-1).
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { Route, Routes, unstable_HistoryRouter as HistoryRouter } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { LeaderboardPage } from "./features/leaderboard/LeaderboardPage";
import { MainMenu } from "./features/menu/MainMenu";
import { PlayOffline } from "./features/play/PlayOffline";
import { PlayOnline } from "./features/play/PlayOnline";
import { PlayProvider } from "./features/play/PlayProvider";
import { ResultScreen } from "./features/play/ResultScreen";
import { SearchingOverlay } from "./features/play/SearchingOverlay";
import { ProfilePage } from "./features/profile/ProfilePage";
import { ShopPage } from "./features/shop/ShopPage";
import { I18nProvider } from "./i18n/I18nProvider";
import type { GatedHistory } from "./router/gatedHistory";
import { PlayerDataProvider } from "./state/PlayerData";
import { UnityHost, useUnity } from "./unity/UnityHost";
import { UnitySync } from "./unity/UnitySync";

export interface AppDeps {
  history: GatedHistory;
  basename?: string;
  apiUrl: string;
  fetchImpl: typeof fetch;
  mockUnity: boolean;
}

/** Write the route into the URL once Unity's PlayerPrefs folder is fixed (ready) or Unity will not start (failed). */
function RouteUnlock({ history }: { history: GatedHistory }) {
  const { boot } = useUnity();
  useEffect(() => {
    if (boot.state !== "loading") history.unlock();
  }, [boot.state, history]);
  return null;
}

/** While Unity is on screen the menu behind it is inert (no focus, no screen reader). */
function AppContent({ children }: { children: ReactNode }) {
  const { visible } = useUnity();
  return (
    <div className="app" inert={visible}>
      {children}
    </div>
  );
}

export function App({ history, basename, apiUrl, fetchImpl, mockUnity }: AppDeps) {
  // The Unity host stays outside StrictMode: its loader effect must run exactly once per page.
  const [fetcher] = useState(() => fetchImpl);
  return (
    <I18nProvider>
      <UnityHost mock={mockUnity}>
        <RouteUnlock history={history} />
        <AuthProvider baseUrl={apiUrl} fetchImpl={fetcher}>
          <PlayerDataProvider>
            <UnitySync />
            <HistoryRouter history={history as never} basename={basename}>
              <StrictMode>
                <PlayProvider>
                  <AppContent>
                    <Routes>
                      <Route path="/" element={<MainMenu />} />
                      <Route path="/play/online" element={<PlayOnline />} />
                      <Route path="/play/offline" element={<PlayOffline />} />
                      <Route path="/result" element={<ResultScreen />} />
                      <Route path="/profile" element={<ProfilePage />} />
                      <Route path="/shop" element={<ShopPage />} />
                      <Route path="/leaderboard" element={<LeaderboardPage />} />
                      <Route path="*" element={<MainMenu />} />
                    </Routes>
                  </AppContent>
                  <SearchingOverlay />
                </PlayProvider>
              </StrictMode>
            </HistoryRouter>
          </PlayerDataProvider>
        </AuthProvider>
      </UnityHost>
    </I18nProvider>
  );
}
