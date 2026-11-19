import { Routes, Route } from 'react-router-dom';
import { BilateralLanding } from './routes/BilateralLanding';
import { BilateralSuccess } from './routes/BilateralSuccess';
import { NotFoundPage }     from './routes/NotFoundPage';

// The counterparty portal is reached only through emailed deep links.
// Bilateral document review + signing lives here (PFL-025). Cosign approval
// moved to the sign app in PFL-136, so the old /cosign/* pages were removed.
export function App() {
  return (
    <Routes>
      {/* Bilateral routes — PFL-025 */}
      <Route path="/b/:docId"         element={<BilateralLanding />} />
      <Route path="/b/:docId/success" element={<BilateralSuccess />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
