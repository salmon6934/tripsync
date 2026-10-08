import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';

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
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
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
    async jwt({ token, user, account }) {
      // If signing in via OAuth (e.g., GitHub), sync with backend to get DB user and accessToken
      if (account && account.provider !== 'credentials' && account.provider !== 'guest' && user?.email) {
        try {
          const response = await fetch(`${BACKEND_URL}/api/auth/oauth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user.email,
              name: user.name || undefined,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            token.userId = data.user.id;
            token.accessToken = data.token;
            token.avatarId = data.user.avatarId ?? null;
            token.isGuest = data.user.isGuest ?? false;
            return token;
          }
        } catch (error) {
          console.error('Failed to sync OAuth user with backend:', error);
        }
      }

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
