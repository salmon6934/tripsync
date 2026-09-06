import Image from 'next/image';
import Link from 'next/link';

/**
 * TripSync brand lockup: the pin/plane mark plus the wordmark as live text.
 *
 * The mark is served from `public/brand/mark.png` (a transparent crop of the
 * source artwork). The wordmark is deliberately text rather than part of the
 * image so it stays selectable, scales with the type system, and remains legible
 * at small sizes — a baked-in wordmark turns to mush below ~100px wide.
 */

interface LogoProps {
  /** Rendered mark size in px (square). Text scales alongside it. */
  size?: number;
  /** When set, the whole lockup becomes a link to this route. */
  href?: string;
  /** Hide the wordmark and show the mark alone. */
  markOnly?: boolean;
  /** Tailwind classes for the wordmark text. */
  textClassName?: string;
  /**
   * Optional small-caps, letter-spaced line rendered under the wordmark
   * (e.g. "TRIP MAP", "SHARED EXPENSES") — the Wayfarer subtitle pattern.
   */
  subtitle?: string;
  className?: string;
}

export function Logo({
  size = 32,
  href,
  markOnly = false,
  textClassName = 'font-display text-xl font-bold leading-none text-foreground',
  subtitle,
  className,
}: LogoProps) {
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <Image
        src="/brand/mark.png"
        alt={markOnly ? 'tripSync' : ''}
        width={size}
        height={size}
        // The mark is small and appears in the header of every page, so it
        // should not wait on lazy-loading.
        priority
        className="shrink-0"
        // `aria-hidden` when the wordmark is present, so screen readers don't
        // announce the brand name twice.
        aria-hidden={markOnly ? undefined : true}
      />
      {!markOnly && (
        <span className="flex flex-col gap-1">
          <span className={textClassName}>tripSync</span>
          {subtitle && <span className="eyebrow">{subtitle}</span>}
        </span>
      )}
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="inline-flex items-center">
      {content}
    </Link>
  );
}

export default Logo;
