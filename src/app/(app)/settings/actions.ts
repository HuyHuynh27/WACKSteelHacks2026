"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

const prefsSchema = z.object({
  min_change_pct: z.coerce.number().min(0).max(100),
  digest: z.enum(["instant", "daily", "weekly"]),
  quiet_hours_start: z.coerce.number().int().min(0).max(23),
  quiet_hours_end: z.coerce.number().int().min(0).max(23),
});

export async function updateNotificationPrefs(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = prefsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase
    .from("notification_prefs")
    .upsert({ user_id: user.id, ...parsed.data }, { onConflict: "user_id" });

  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { message: "Preferences saved." };
}
