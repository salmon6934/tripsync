'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';

import { Avatar } from '@/components/ui/avatar';

export function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  if (!session?.user) return null;

  const name = session.user.name ?? '';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary-tint text-sm font-medium text-primary-tint-foreground hover:bg-primary-tint focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        aria-label="User menu"
      >
        <Avatar avatarId={session.user.avatarId} name={name || '?'} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-border bg-card py-2 shadow-lg">
          <div className="border-b border-border px-4 py-2">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-foreground">{session.user.name}</p>
              {session.user.isGuest && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Guest
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {session.user.isGuest ? 'Guest session' : session.user.email}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
