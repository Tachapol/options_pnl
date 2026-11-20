import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "./actions";
import { supabaseConfig } from "../../lib/supabase";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = Boolean(supabaseConfig());
  return (
    <main className="auth-frame">
      <section className="auth-card" aria-labelledby="sign-in-title">
        <div className="brand"><span className="mark" aria-hidden="true">↗</span>Options Journal</div>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="muted">Access your private trading journal.</p>
        {configured ? (
          /* Issue #15: aria-describedby links server error to <form> for screen readers */
          <form action={signIn} className="form" aria-describedby={error ? "sign-in-error" : undefined}>
            {error && <p role="alert" id="sign-in-error" className="notice">Check your email and password and try again.</p>}
            <label htmlFor="email">
              Email
              <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid="false" />
            </label>
            <label htmlFor="password">
              Password
              <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} aria-invalid="false" />
            </label>
            <Button type="submit">Sign in</Button>
          </form>
        ) : (
          <p className="notice">Connect Supabase to enable sign-in. Configuration steps are in the project README.</p>
        )}
      </section>
    </main>
  );
}
