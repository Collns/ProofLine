import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VerifyPage } from './routes/VerifyPage';
import { BilateralPage } from './routes/BilateralPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { UnverifiedSenderPage } from './routes/UnverifiedSenderPage';

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to="/v/demo?fixture=verified-wire" replace />} />
        <Route path="/v/:messageId" element={<VerifyPage />} />
        <Route path="/b/:docId" element={<BilateralPage />} />
        <Route path="/unverified-sender" element={<UnverifiedSenderPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
