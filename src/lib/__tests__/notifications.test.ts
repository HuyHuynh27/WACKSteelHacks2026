import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideDelivery, digestPayload, isDigestDue, isQuietHour } from "../notifications.ts";
import type { Alert, DigestFrequency, NotificationPrefs } from "../database.types.ts";

const NOW = new Date("2026-09-19T14:00:00Z"); // 14:00 UTC — outside default quiet hours.

function prefs(overrides: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return {
    user_id: "user-1",
    enabled: true,
    min_change_pct: 5,
    digest: "instant",
    quiet_hours_start: 21,
    quiet_hours_end: 7,
    digest_sent_at: null,
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    user_id: "user-1",
    material_id: "material-1",
    kind: "spike",
    window_days: 7,
    pct_change: 6.2,
    price_before: 100,
    price_after: 106.2,
    headline: "Aluminum +6.2% this week",
    body: "Smelter outages in Yunnan and higher power costs are the drivers.",
    drivers: [],
    created_at: NOW.toISOString(),
    delivered_at: null,
    read_at: null,
    ...overrides,
  };
}

describe("isQuietHour", () => {
  it("handles a window that wraps midnight", () => {
    assert.equal(isQuietHour(22, 21, 7), true);
    assert.equal(isQuietHour(3, 21, 7), true);
    assert.equal(isQuietHour(7, 21, 7), false, "end hour is exclusive");
    assert.equal(isQuietHour(14, 21, 7), false);
  });

  it("handles a same-day window", () => {
    assert.equal(isQuietHour(10, 9, 17), true);
    assert.equal(isQuietHour(8, 9, 17), false);
    assert.equal(isQuietHour(17, 9, 17), false);
  });

  it("treats a zero-width window as never quiet", () => {
    assert.equal(isQuietHour(12, 0, 0), false);
    assert.equal(isQuietHour(9, 9, 9), false);
  });
});

describe("isDigestDue", () => {
  const daily: DigestFrequency = "daily";

  it("is always due for instant", () => {
    assert.equal(isDigestDue("instant", NOW.toISOString(), NOW), true);
  });

  it("is due when one has never been sent", () => {
    assert.equal(isDigestDue(daily, null, NOW), true);
  });

  it("waits out the interval", () => {
    const anHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    assert.equal(isDigestDue(daily, anHourAgo, NOW), false);

    const yesterday = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    assert.equal(isDigestDue(daily, yesterday, NOW), true);
  });

  it("holds a weekly digest for a full week", () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isDigestDue("weekly", threeDaysAgo, NOW), false);

    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isDigestDue("weekly", eightDaysAgo, NOW), true);
  });
});

describe("decideDelivery", () => {
  it("drops everything when the user has never opted in", () => {
    const decisions = decideDelivery({
      alerts: [alert()],
      prefs: null,
      deviceCount: 0,
      now: NOW,
    });
    assert.deepEqual(
      decisions.map((d) => [d.action, "reason" in d ? d.reason : null]),
      [["drop", "disabled"]],
    );
  });

  it("drops when opted in but no devices remain", () => {
    const [decision] = decideDelivery({
      alerts: [alert()],
      prefs: prefs(),
      deviceCount: 0,
      now: NOW,
    });
    assert.equal(decision.action, "drop");
    assert.equal("reason" in decision && decision.reason, "no-devices");
  });

  it("drops moves under the account-wide floor but keeps the rest", () => {
    const small = alert({ id: "small", pct_change: 2.1 });
    const big = alert({ id: "big", pct_change: 9.4 });

    const decisions = decideDelivery({
      alerts: [small, big],
      prefs: prefs({ min_change_pct: 5 }),
      deviceCount: 1,
      now: NOW,
    });

    const dropped = decisions.find((d) => d.action === "drop");
    const sent = decisions.find((d) => d.action === "send");
    assert.deepEqual(dropped?.alerts.map((a) => a.id), ["small"]);
    assert.deepEqual(sent?.alerts.map((a) => a.id), ["big"]);
  });

  it("defers rather than drops during quiet hours", () => {
    const [decision] = decideDelivery({
      alerts: [alert()],
      prefs: prefs(),
      deviceCount: 1,
      now: new Date("2026-09-19T23:00:00Z"),
    });
    assert.equal(decision.action, "defer");
    assert.equal("reason" in decision && decision.reason, "quiet-hours");
  });

  it("sends one notification per alert on instant", () => {
    const decisions = decideDelivery({
      alerts: [alert({ id: "a" }), alert({ id: "b", material_id: "material-2" })],
      prefs: prefs({ digest: "instant" }),
      deviceCount: 1,
      now: NOW,
    });
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every((d) => d.action === "send" && d.digest === false));
  });

  it("batches into a single notification on daily", () => {
    const decisions = decideDelivery({
      alerts: [
        alert({ id: "a", pct_change: 6.2 }),
        alert({ id: "b", material_id: "material-2", pct_change: -11.5 }),
        alert({ id: "c", material_id: "material-3", pct_change: 7.1 }),
      ],
      prefs: prefs({ digest: "daily" }),
      deviceCount: 1,
      now: NOW,
    });

    assert.equal(decisions.length, 1);
    const [decision] = decisions;
    assert.equal(decision.action, "send");
    assert.ok(decision.action === "send" && decision.digest);
    assert.equal(decision.alerts.length, 3);
    assert.match(
      decision.action === "send" ? decision.payload.title : "",
      /^3 materials moved today$/,
    );
  });

  it("defers a digest that is not yet due", () => {
    const [decision] = decideDelivery({
      alerts: [alert()],
      prefs: prefs({ digest: "daily", digest_sent_at: NOW.toISOString() }),
      deviceCount: 1,
      now: NOW,
    });
    assert.equal(decision.action, "defer");
    assert.equal("reason" in decision && decision.reason, "digest-window");
  });
});

describe("digestPayload", () => {
  it("leads with the biggest mover and keeps the body push-sized", () => {
    const payload = digestPayload(
      [
        alert({ id: "a", pct_change: 6.2, headline: "Aluminum +6.2% this week" }),
        alert({ id: "b", pct_change: -14.8, headline: "Copper -14.8% this week" }),
        alert({ id: "c", pct_change: 5.1, headline: "Zinc +5.1% this week" }),
      ],
      "weekly",
    );

    assert.equal(payload.title, "3 materials moved this week");
    assert.ok(payload.body.startsWith("Copper -14.8%"), payload.body);
    assert.ok(payload.body.includes("and 1 more"), payload.body);
    assert.ok(payload.body.length <= 180);
    assert.equal(payload.url, "/alerts");
  });

  it("falls back to the single alert when only one moved", () => {
    const payload = digestPayload([alert()], "daily");
    assert.equal(payload.title, "Aluminum +6.2% this week");
    assert.equal(payload.url, "/materials/material-1");
    assert.equal(payload.tag, "better-raw-digest");
  });
});
