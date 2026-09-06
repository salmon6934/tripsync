import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
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
            accessToken: data.token,
          };
        } catch {
          return null;
        }
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
    async jwt({ token, user }) {
      // On first sign-in, persist the backend token + avatar into the JWT
      if (user) {
        token.userId = user.id;
        token.accessToken = (user as any).accessToken;
        token.avatarId = (user as any).avatarId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose userId, accessToken and avatar to the client session
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.avatarId = (token.avatarId as number | null | undefined) ?? null;
        (session as any).accessToken = token.accessToken;
      }
      return session;
    },
  },
  trustHost: true,
});
