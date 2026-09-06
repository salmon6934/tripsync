'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

/**
 * Client-side route guard for protected pages.
 *
 * Redirects signed-out visitors to the auth screen (via `/login`, which folds
 * into `/`), preserving the current path as `callbackUrl` so sign-in returns
 * them where they were headed. Returns the session `status` so the caller can
 * render a loading state until it resolves — and, importantly, hold off on
 * rendering protected UI until the user is authenticated (so children always
 * have a valid access token to fetch with).
 *
 * Usage:
 *   const status = useAuthGuard();
 *   if (status !== 'authenticated') return <FullPageSpinner />;
 */
export function useAuthGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  return status;
}
