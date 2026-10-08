import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      id: 'credentials',
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          if (!response.ok) {
            return null;
          }

          const data = await response.json();

          // Return user data with the backend JWT as accessToken
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            avatarId: data.user.avatarId,
            isGuest: data.user.isGuest ?? false,
            accessToken: data.token,
          };
        } catch {
          return null;
        }
      },
    }),
    Credentials({
      id: 'guest',
      name: 'guest',
      credentials: {},
      async authorize() {
        try {
          const response = await fetch(`${BACKEND_URL}/api/auth/guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          if (!response.ok) {
            return null;
          }

          const data = await response.json();

          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            avatarId: data.user.avatarId,
            isGuest: true,
            accessToken: data.token,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  pages: {
    // The home route hosts the combined sign-in / sign-up experience.
    signIn: '/',
  },
  callbacks: {
    async jwt({ token, user }) {
      // On credentials or guest sign-in, persist the backend token + avatar + isGuest into the JWT
      if (user) {
        token.userId = user.id;
        token.accessToken = (user as any).accessToken;
        token.avatarId = (user as any).avatarId ?? null;
        token.isGuest = (user as any).isGuest ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose userId, accessToken, avatar, and isGuest to the client session
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.avatarId = (token.avatarId as number | null | undefined) ?? null;
        session.user.isGuest = (token.isGuest as boolean | undefined) ?? false;
        (session as any).accessToken = token.accessToken;
      }
      return session;
    },
  },
  trustHost: true,
});
