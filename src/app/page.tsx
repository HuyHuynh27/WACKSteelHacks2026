import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const FEATURES = [
  {
    title: "Everything you buy, in one ledger",
    body: "Add each raw material with its unit, supplier and what you last paid. We map it to a public price series automatically.",
  },
  {
    title: "Costs that roll up",
    body: "Attach materials to a product and the bill-of-materials cost recalculates every time the market moves.",
  },
  {
    title: "Alerts that explain themselves",
    body: "Opt in to push notifications and get the size of the move plus the drivers behind it — not just a number.",
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-16">
      <div className="space-y-4">
        <p className="text-sm font-medium tracking-widest text-sky-600 uppercase">
          Raw material intelligence
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Know what your inputs cost before your margin finds out.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground text-pretty">
          Better RAW tracks the raw materials your business actually buys, rolls
          them up into product cost, and pushes you a plain-English summary when
          prices spike or dip.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button render={<Link href="/login?mode=signup" />} size="lg">
          Get started
        </Button>
        <Button render={<Link href="/login?next=/dashboard" />} size="lg" variant="outline">
          Sign in
        </Button>
      </div>

      <dl className="grid gap-6 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="space-y-1.5">
            <dt className="font-medium">{feature.title}</dt>
            <dd className="text-sm text-muted-foreground">{feature.body}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
