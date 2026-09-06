import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

/**
 * Editorial display serif for the wordmark and page-section headings. Exposed as
 * a CSS variable so globals.css can wire it into the `font-display` token; body
 * copy stays on the system sans stack (see --font-sans in globals.css).
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
});

export const metadata: Metadata = {
  title: 'tripSync',
  description: 'Plan trips together in real-time',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fraunces.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Global branded backdrop, present on every page. It's fixed and sits
            behind all content (-z-10); the travel art is scaled slightly and
            softly blurred so upscaling reads as intentional, then tinted with the
            theme cream so page text stays legible. Opaque surfaces (cards,
            headers, the auth panel) layer cleanly on top; it shows through in the
            margins and gaps. */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 scale-110 bg-[url('/brand/auth-bg.png')] bg-cover bg-center"
          style={{ filter: 'blur(3px) saturate(1.1) contrast(1.03)' }}
        />
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-background/45" />

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
