import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | null;
      /** Id of the user's chosen built-in avatar (see @tripsync/shared). */
      avatarId?: number | null;
      isGuest?: boolean;
    };
    accessToken?: string;
  }

  interface User {
    id: string;
    accessToken?: string;
    avatarId?: number | null;
    isGuest?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    accessToken?: string;
    avatarId?: number | null;
    isGuest?: boolean;
  }
}
