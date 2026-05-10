import { CosignLayout } from '../components/CosignLayout';
import { ErrorScreen } from '../components/ErrorScreen';

export function NotFoundPage() {
  return (
    <CosignLayout label="">
      <ErrorScreen
        title="Page not found"
        detail="That cosign URL doesn't match any known link. Please use the link from the email exactly as sent."
      />
    </CosignLayout>
  );
}
