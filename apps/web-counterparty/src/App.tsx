import { Routes, Route, Navigate } from 'react-router-dom';
import { CosignLanding }    from './routes/CosignLanding';
import { CosignSuccess }    from './routes/CosignSuccess';
import { CosignExpired }    from './routes/CosignExpired';
import { CosignFreshLink }  from './routes/CosignFreshLink';
import { BilateralLanding } from './routes/BilateralLanding';
import { BilateralSuccess } from './routes/BilateralSuccess';
import { NotFoundPage }     from './routes/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to="/cosign/demo?t=demo&fixture=ready" replace />}
      />

      {/* Existing cosign routes */}
      <Route path="/cosign/:messageId"         element={<CosignLanding />} />
      <Route path="/cosign/:messageId/success" element={<CosignSuccess />} />
      <Route path="/cosign/:messageId/expired" element={<CosignExpired />} />
      <Route path="/cosign/:messageId/refresh" element={<CosignFreshLink />} />

      {/* Bilateral routes — PFL-025 */}
      <Route path="/b/:docId"         element={<BilateralLanding />} />
      <Route path="/b/:docId/success" element={<BilateralSuccess />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}