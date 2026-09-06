'use client';

/**
 * Combined authentication experience used as the app's home route (`/`).
 *
 * Layout: a single centered card with an animated grain-gradient banner on top
 * (holding the TripSync logo + wordmark) and the auth form below. The form
 * toggles between "sign in" and "sign up" with a horizontal wipe animation
 * (framer-motion). Sign up is a two-step wizard — credentials first, then an
 * avatar picker — and the account is only created (with the chosen avatar) once
 * the picker is confirmed, so the avatar is set atomically at creation.
 *
 * The gradient banner is a `React.memo` component with no mode-dependent props,
 * so toggling sign in / sign up never re-mounts it — the WebGL animation keeps
 * running uninterrupted.
 */

import { memo, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { GrainGradient } from '@paper-design/shaders-react';

import { AvatarPicker } from '@/components/ui/avatar-picker';
import { FloatingInput } from '@/components/ui/floating-input';
import { AVATARS } from '@/lib/avatars';

type Mode = 'signin' | 'signup';
type SignupStep = 'form' | 'avatar';

// Stable module-level constants — passing fresh array/string literals on every
// render could nudge the shader to re-evaluate; these keep its props identical.
const GRADIENT_BG = 'linear-gradient(135deg, #c13a28 0%, #b0744a 45%, #b8912e 100%)';
const GRADIENT_COLORS = ['#fdf9f2', '#c13a28', '#b8912e', '#fdf9f2'];

// Horizontal wipe: content is revealed/hidden along the x-axis via a clip-path
// inset, with a small translate for parallax. `direction` (+1 forward, -1 back)
// decides which edge it wipes from/to.
const wipeVariants: Variants = {
  enter: (direction: number) => ({
    clipPath: direction > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)',
    x: direction > 0 ? 24 : -24,
    opacity: 0,
  }),
  center: {
    clipPath: 'inset(0 0 0 0)',
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    clipPath: direction > 0 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)',
    x: direction > 0 ? -24 : 24,
    opacity: 0,
  }),
};

export function AuthExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();

  // Only allow relative callback URLs to prevent open-redirects.
  const rawCallback = searchParams.get('callbackUrl');
  const callbackUrl = rawCallback && rawCallback.startsWith('/') ? rawCallback : '/dashboard';

  const [mode, setMode] = useState<Mode>(
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin',
  );
  const [signupStep, setSignupStep] = useState<SignupStep>('form');
  // +1 when advancing (e.g. to sign up / to avatar step), -1 when going back —
  // drives the wipe direction.
  const [direction, setDirection] = useState(1);

  // Shared credential fields (persist across the toggle so a typed email isn't lost).
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Sign-up-only fields.
  const [name, setName] = useState('');
  const [avatarId, setAvatarId] = useState(AVATARS[0].id);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Random default avatar assigned after mount (a value chosen during render
  // would differ between server and client HTML → hydration mismatch).
  useEffect(() => {
    setAvatarId(AVATARS[Math.floor(Math.random() * AVATARS.length)].id);
  }, []);

  // If already signed in, skip the auth screen entirely.
  useEffect(() => {
    if (status === 'authenticated') router.replace(callbackUrl);
  }, [status, callbackUrl, router]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setError('');
    setSignupStep('form');
    setDirection(next === 'signup' ? 1 : -1);
    setMode(next);
  }

  async function handleSignin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid email or password');
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Step 1 → 2: credentials are validated by the form (required + minLength),
  // then we advance to the avatar picker. No account is created yet.
  function handleSignupDetails(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDirection(1);
    setSignupStep('avatar');
  }

  function backToDetails() {
    setError('');
    setDirection(-1);
    setSignupStep('form');
  }

  // Step 2 confirm: create the account with the chosen avatar, then sign in.
  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const signupRes = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, avatarId }),
      });

      if (!signupRes.ok) {
        const data = await signupRes.json();
        setError(data.message || 'Signup failed');
        setLoading(false);
        return;
      }

      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Account created but sign-in failed. Please log in manually.');
      } else {
        router.push(callbackUrl);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const isSignup = mode === 'signup';
  const onAvatarStep = isSignup && signupStep === 'avatar';
  // Distinct key per view so AnimatePresence wipes between them.
  const viewKey = !isSignup ? 'signin' : signupStep === 'form' ? 'signup-form' : 'signup-avatar';

  return (
    <section className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground antialiased [font-synthesis:none]">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {/* Animated brand banner (never re-mounts on mode switch). */}
        <GradientBanner />

        <div className="px-6 py-8 sm:px-8">
          {error && (
            <div className="mb-4 rounded-lg bg-danger-tint p-3 text-sm text-danger">{error}</div>
          )}

          {/* Wipe region: heading + form swaps per view. */}
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={viewKey}
              custom={direction}
              variants={wipeVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {onAvatarStep ? (
                <>
                  <h1 className="font-display text-2xl font-medium tracking-[-0.03em] sm:text-3xl">
                    Choose your avatar
                  </h1>
                  <p className="mt-2 text-base leading-snug text-muted-foreground">
                    Almost there, {name.trim() || 'traveler'} — pick a look for your profile
                  </p>

                  <form onSubmit={handleCreateAccount} className="mt-6 space-y-4">
                    <AvatarPicker
                      avatars={AVATARS}
                      selectedId={avatarId}
                      onSelect={(avatar) => setAvatarId(avatar.id)}
                      username={name.trim() || 'Your name'}
                      subtitle="You can change it later"
                    />
                    <SubmitButton
                      loading={loading}
                      label="Create account"
                      loadingLabel="Creating account..."
                    />
                    <button
                      type="button"
                      onClick={backToDetails}
                      disabled={loading}
                      className="flex h-11 w-full items-center justify-center rounded-[10px] border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      Back
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <h1 className="font-display text-2xl font-medium tracking-[-0.03em] sm:text-3xl">
                    {isSignup ? 'Create an account' : 'Welcome back'}
                  </h1>
                  <p className="mt-2 text-base leading-snug text-muted-foreground">
                    {isSignup
                      ? 'Plan trips together in real-time'
                      : 'Sign in to keep planning with your crew'}
                  </p>

                  {isSignup ? (
                    <form onSubmit={handleSignupDetails} className="mt-6 space-y-4">
                      <FloatingInput id="name" label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
                      <FloatingInput id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                      <FloatingInput id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} required />
                      <SubmitButton loading={false} label="Continue" loadingLabel="Continue" />
                    </form>
                  ) : (
                    <form onSubmit={handleSignin} className="mt-6 space-y-4">
                      <FloatingInput id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                      <FloatingInput id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
                      <SubmitButton loading={loading} label="Sign in" loadingLabel="Signing in..." />
                    </form>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Social sign-in sits below the primary submit button. Hidden during
              the avatar step (mid sign-up). */}
          {!onAvatarStep && (
            <>
              <div className="my-6 flex items-center gap-4 text-sm font-medium text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>

              <SocialButton
                icon={<GoogleIcon />}
                label="Continue with Google"
                onClick={() => signIn('google', { callbackUrl })}
              />

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
                  className="font-medium text-primary transition-colors hover:text-primary-hover"
                >
                  {isSignup ? 'Sign in' : 'Sign up'}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Animated gradient banner with the brand lockup. Memoized with no props so it
 * renders exactly once and is never re-mounted when the parent re-renders on a
 * sign in / sign up toggle — keeping the WebGL animation continuous.
 */
const GradientBanner = memo(function GradientBanner() {
  // GrainGradient renders to a WebGL canvas, so it must run client-side only.
  // A static CSS gradient is the SSR/first-paint fallback.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative h-44 overflow-hidden" style={{ background: GRADIENT_BG }}>
      {mounted && (
        <GrainGradient
          speed={1}
          scale={1}
          rotation={0}
          offsetX={0}
          offsetY={0}
          softness={0.5}
          intensity={0.5}
          noise={0.25}
          shape="corners"
          frame={2854.5}
          colors={GRADIENT_COLORS}
          colorBack="#00000000"
          className="absolute inset-0"
        />
      )}

      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-2 text-white">
        <Image src="/brand/mark.png" alt="" width={48} height={48} priority aria-hidden="true" />
        <span className="font-display text-2xl font-semibold tracking-tight drop-shadow-sm">
          TripSync
        </span>
        <span className="text-sm text-white/85 drop-shadow-sm">
          Plan trips together in real-time
        </span>
      </div>
    </div>
  );
});

function SubmitButton({
  loading,
  label,
  loadingLabel,
}: {
  loading: boolean;
  label: string;
  loadingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-2 flex h-12 w-full items-center justify-center rounded-[10px] bg-primary text-base font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50"
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

function SocialButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-3 text-sm leading-none text-foreground transition-colors hover:bg-muted"
    >
      <span className="shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
        fill="#EB4335"
      />
    </svg>
  );
}
