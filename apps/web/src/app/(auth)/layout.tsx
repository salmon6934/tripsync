/**
 * The /login and /signup routes now just redirect to the home route (`/`),
 * which hosts the combined auth experience. This layout is a pass-through.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
