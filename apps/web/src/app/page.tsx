import { Suspense } from 'react';

import { AuthExperience } from '@/components/ui/auth-experience';

/**
 * Home route is the authentication experience: a combined sign-in / sign-up
 * panel on the left (with a wipe animation between modes) and an animated brand
 * gradient on the right. `useSearchParams` inside AuthExperience requires a
 * Suspense boundary during prerender.
 */
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AuthExperience />
    </Suspense>
  );
}
