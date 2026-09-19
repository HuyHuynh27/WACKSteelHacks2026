"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { updateNotificationPrefs, type ActionState } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NotificationPrefs } from "@/lib/database.types";

const EMPTY: ActionState = {};

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00 UTC`,
}));

export function NotificationPrefsForm({ prefs }: { prefs: NotificationPrefs }) {
  const [state, formAction, pending] = useActionState(updateNotificationPrefs, EMPTY);

  useEffect(() => {
    if (state.message) toast.success(state.message);
  }, [state.message]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="min_change_pct">Only notify above ±%</Label>
          <Input
            id="min_change_pct"
            name="min_change_pct"
            type="number"
            step="0.5"
            min="0"
            max="100"
            defaultValue={Number(prefs.min_change_pct)}
          />
          <p className="text-xs text-muted-foreground">
            Smaller moves are still charted, just not pushed.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="digest">Cadence</Label>
          <Select name="digest" defaultValue={prefs.digest}>
            <SelectTrigger id="digest" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instant">As it happens</SelectItem>
              <SelectItem value="daily">Daily summary</SelectItem>
              <SelectItem value="weekly">Weekly summary</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quiet_hours_start">Quiet hours start</Label>
          <Select name="quiet_hours_start" defaultValue={String(prefs.quiet_hours_start)}>
            <SelectTrigger id="quiet_hours_start" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((hour) => (
                <SelectItem key={hour.value} value={hour.value}>
                  {hour.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quiet_hours_end">Quiet hours end</Label>
          <Select name="quiet_hours_end" defaultValue={String(prefs.quiet_hours_end)}>
            <SelectTrigger id="quiet_hours_end" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((hour) => (
                <SelectItem key={hour.value} value={hour.value}>
                  {hour.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save preferences"}
      </Button>
    </form>
  );
}
