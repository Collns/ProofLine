import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OnboardingWizard } from './routes/OnboardingWizard';
import { DashboardHome } from './routes/DashboardHome';
import { InviteCounterparties } from './routes/invitations/InviteCounterparties';
import { InvitationsList } from './routes/invitations/InvitationsList';
import { InvitationDetail } from './routes/invitations/InvitationDetail';
import { NotFoundPage } from './routes/NotFoundPage';

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to="/onboarding" replace />} />
        <Route path="/onboarding" element={<OnboardingWizard />} />
        <Route path="/dashboard" element={<DashboardHome />} />
        <Route path="/invitations" element={<InvitationsList />} />
        <Route path="/invitations/new" element={<InviteCounterparties />} />
        <Route path="/invitations/:id" element={<InvitationDetail />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
