import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { RequireUser } from './components/RequireUser';
import { HistoryPage } from './features/history/HistoryPage';
import { LogWorkoutPage } from './features/log/LogWorkoutPage';
import { RecordsPage } from './features/records/RecordsPage';
import { WelcomePage } from './features/welcome/WelcomePage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        element={
          <RequireUser>
            <AppShell />
          </RequireUser>
        }
      >
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/log" element={<LogWorkoutPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/history" replace />} />
    </Routes>
  );
}
