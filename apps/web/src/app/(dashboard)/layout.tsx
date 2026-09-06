'use client';

import { Logo } from '@/components/Logo';
import { NotificationBell } from '@/components/NotificationBell';
import { UserMenu } from '@/components/UserMenu';
import { useAuthGuard } from '@/hooks/useAuthGuard';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const status = useAuthGuard();

  // While the session resolves — and during the redirect for signed-out users —
  // show a spinner rather than the session-dependent dashboard chrome. This also
  // guarantees children only mount once authenticated (so they always have a
  // valid access token to fetch with).
  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-tint border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Navigation — pinned to the top and sticky so it stays in view. */}
      <header className="sticky top-0 z-40 border-b border-border bg-card shadow-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Logo href="/dashboard" size={32} subtitle="Trips" />
          <div className="flex items-center gap-3">
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Main content — grows to fill the space below the top nav. */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
