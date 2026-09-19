#!/usr/bin/env node
/**
 * Checks the VAPID keypair in .env.local can actually sign and encrypt a push.
 *
 *   node --env-file=.env.local scripts/verify-push.mjs
 *
 * Catches a malformed or mismatched keypair without needing a live push service
 * or a subscribed device — the usual way this fails is silently, at 3am.
 */
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";

const missing = [
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
].filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}. Run \`npm run gen:vapid\`.`);
  process.exit(1);
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// A structurally valid subscription with throwaway keys, so this exercises the
// real VAPID JWT signing and payload encryption path.
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

const details = webpush.generateRequestDetails(
  {
    endpoint: "https://fcm.googleapis.com/fcm/send/verify-only",
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  },
  JSON.stringify({ title: "Aluminum +6.2% this week", body: "Verification payload." }),
  { TTL: 86400 },
);

console.log("subject     :", process.env.VAPID_SUBJECT);
console.log("public key  :", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.slice(0, 16) + "…");
console.log("authorization:", details.headers.Authorization.slice(0, 40) + "…");
console.log("encoding    :", details.headers["Content-Encoding"]);
console.log("payload     :", details.body.length, "bytes encrypted");
console.log("\nVAPID signing and payload encryption OK.");
