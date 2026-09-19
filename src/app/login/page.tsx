import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sign in — Better RAW" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next || "/dashboard");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <Link href="/" className="text-2xl font-semibold tracking-tight">
        Better<span className="text-sky-500">RAW</span>
      </Link>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        Track what your raw materials cost, what they will cost, and why.
      </p>
      <LoginForm next={next} initialError={error} />
    </main>
  );
}
