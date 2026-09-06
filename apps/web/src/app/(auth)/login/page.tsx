import { redirect } from 'next/navigation';

/**
 * The dedicated /login route has been folded into the home route (`/`), which
 * now hosts the combined sign-in / sign-up experience. Redirect here for any
 * lingering links or bookmarks, preserving a relative callbackUrl.
 */
export default async function LoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const cb = callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : undefined;
  redirect(cb ? `/?callbackUrl=${encodeURIComponent(cb)}` : '/');
}
