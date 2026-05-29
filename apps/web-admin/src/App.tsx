import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './routes/LoginPage';
import { OnboardingWizard } from './routes/OnboardingWizard';
import { DashboardHome } from './routes/DashboardHome';
import { DemoHub } from './routes/DemoHub';
import { InviteCounterparties } from './routes/invitations/InviteCounterparties';
import { InvitationsList } from './routes/invitations/InvitationsList';
import { InvitationDetail } from './routes/invitations/InvitationDetail';
import { NotFoundPage } from './routes/NotFoundPage';

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Navigate to="/demo" replace />} />
        <Route path="/demo" element={<DemoHub />} />
        <Route path="/login" element={<LoginPage />} />

        {/* Onboarding requires auth but NOT a resolved company — the user
            is here precisely to create one. */}
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute requireCompany={false}>
              <OnboardingWizard />
            </ProtectedRoute>
          }
        />

        {/* Authenticated + company-bound */}
        <Route
          path="/dashboard"
          element={<ProtectedRoute><DashboardHome /></ProtectedRoute>}
        />
        <Route
          path="/invitations"
          element={<ProtectedRoute><InvitationsList /></ProtectedRoute>}
        />
        <Route
          path="/invitations/new"
          element={<ProtectedRoute><InviteCounterparties /></ProtectedRoute>}
        />
        <Route
          path="/invitations/:id"
          element={<ProtectedRoute><InvitationDetail /></ProtectedRoute>}
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
