import { getAvatarSrc } from '@/lib/avatars';
import { cn } from '@/lib/utils';

interface AvatarProps {
  /** Id of a built-in avatar (see @tripsync/shared). Null → initial fallback. */
  avatarId?: number | null;
  /** Display name; its first letter is the fallback and the image alt text. */
  name: string;
  /** Extra classes for the rendered <img>. */
  className?: string;
}

/**
 * Renders a user's chosen built-in avatar as an <img>, resolving the id to an
 * inline SVG via getAvatarSrc. Falls back to the name's initial when no avatar
 * id is set.
 *
 * The image fills its parent (h-full w-full), so callers own the surrounding
 * circle: sizing, ring, and the background colour used behind the initial.
 */
export function Avatar({ avatarId, name, className }: AvatarProps) {
  if (avatarId != null) {
    return (
      <img
        src={getAvatarSrc(avatarId)}
        alt={name}
        className={cn('h-full w-full rounded-full object-cover', className)}
      />
    );
  }

  return <>{name.charAt(0).toUpperCase()}</>;
}
