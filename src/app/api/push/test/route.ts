import { NextResponse } from "next/server";

import { sendToMany } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";

/** Fires a sample alert to every device the signed-in user has registered. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!subs?.length) {
    return NextResponse.json(
      { error: "No devices registered for push on this account." },
      { status: 409 },
    );
  }

  const results = await sendToMany(subs, {
    title: "Aluminum +6.2% this week",
    body: "Smelter outages in Yunnan and higher power costs are the drivers. Tap to see the chart.",
    url: "/alerts",
    tag: "better-raw-test",
  });

  const stale = results.filter((r) => !r.ok && r.gone).map((r) => r.id);
  if (stale.length) {
    await supabase.from("push_subscriptions").delete().in("id", stale);
  }

  return NextResponse.json({
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    pruned: stale.length,
  });
}
