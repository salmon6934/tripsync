'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

type JoinState = 'joining' | 'error';

/**
 * Convenience page for invite links of the form `/join/<inviteCode>`.
 *
 * Behaviour (Requirement 3.1, 3.2, 3.5, 3.6):
 * - Authenticated users are auto-joined via the invite code, then redirected to
 *   the trip view.
 * - Unauthenticated users are redirected to the login page with a callbackUrl
 *   pointing back here, so the join completes after they authenticate.
 * - Users who are already members are redirected to the existing trip view
 *   without creating a duplicate membership.
 */
export default function JoinTripPage() {
  const params = useParams<{ code: string }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const router = useRouter();
  const { data: session, status } = useSession();

  const [state, setState] = useState<JoinState>('joining');
  const [error, setError] = useState('');
  // Guard against React Strict Mode double-invocation and repeated joins.
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (status === 'loading') return;

    // Not signed in — send to login, then come back here to finish joining.
    if (status === 'unauthenticated') {
      const callbackUrl = `/join/${code}`;
      router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    const token = session?.accessToken;
    if (!token || !code) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    async function join() {
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
        const res = await fetch(`${API_URL}/api/trips/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ inviteCode: code.trim() }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.trip?.id) {
          router.replace(`/trip/${data.trip.id}`);
          return;
        }

        // Already a member — redirect to the existing trip without duplicating membership.
        if (res.status === 409 && data.trip?.id) {
          router.replace(`/trip/${data.trip.id}`);
          return;
        }

        if (res.status === 404) {
          setError('This invite link is invalid or has expired.');
          setState('error');
          return;
        }

        setError(data.message || 'Unable to join this trip. Please try again.');
        setState('error');
      } catch {
        setError('Something went wrong while joining the trip. Please try again.');
        setState('error');
      }
    }

    join();
  }, [status, session?.accessToken, code, router]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-lg">
        {state === 'joining' ? (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary-tint border-t-primary" />
            <h1 className="mt-6 text-xl font-semibold text-foreground">Joining trip…</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Hang tight while we add you to this trip.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-tint">
              <svg
                className="h-6 w-6 text-danger"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-semibold text-foreground">Could not join trip</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover"
            >
              Go to Dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
