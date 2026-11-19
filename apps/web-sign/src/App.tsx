import { Routes, Route } from 'react-router-dom';
import { SignStart } from './routes/SignStart';
import { SignSilent } from './routes/SignSilent';
import { ExtensionAuth } from './routes/ExtensionAuth';
import { CosignApprove } from './routes/CosignApprove';
import { NotFoundPage } from './routes/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route path="/sign/start" element={<SignStart />} />
      <Route path="/sign/silent" element={<SignSilent />} />
      <Route path="/extension/auth" element={<ExtensionAuth />} />
      <Route path="/cosign/:messageId" element={<CosignApprove />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
