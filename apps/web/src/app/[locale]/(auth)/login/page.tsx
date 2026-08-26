import { Suspense } from 'react';
import { LoginForm } from './login-form';

/**
 * The login route reads `?mode=signin|signup` via `useSearchParams` in
 * `LoginForm`, which Next requires to sit under a Suspense boundary.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
