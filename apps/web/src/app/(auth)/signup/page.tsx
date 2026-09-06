import { redirect } from 'next/navigation';

/**
 * The dedicated /signup route has been folded into the home route (`/`). Send
 * legacy links to the combined experience with the sign-up mode preselected,
 * preserving a relative callbackUrl.
 */
export default async function SignupRedirect({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const cb = callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : undefined;
  const params = new URLSearchParams({ mode: 'signup' });
  if (cb) params.set('callbackUrl', cb);
  redirect(`/?${params.toString()}`);
}
