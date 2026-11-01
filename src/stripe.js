// Échanges avec Stripe : vérification d'un paiement et des notifications (webhooks).
// Seuls des appels HTTP simples à l'API Stripe sont utilisés : aucune bibliothèque.

import { generateKey, newRecord, revokePayment } from "./licences.js";

const STRIPE_API = "https://api.stripe.com/v1";
const SESSION_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const SIGNATURE_TOLERANCE_S = 300;

const refuse = (status, error) => [status, { ok: false, error }];

async function fetchSession(env, sessionId) {
  const response = await fetch(`${STRIPE_API}/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Stripe ${response.status}`);
  return response.json();
}

// POST /api/licence/claim — après le paiement, la page « merci » échange l'identifiant
// du paiement contre une clé. Toujours la même clé pour un même paiement.
export async function claim(env, body) {
  const sessionId = body && body.session_id;
  if (typeof sessionId !== "string" || !SESSION_PATTERN.test(sessionId)) {
    return refuse(400, "bad_request");
  }
  const kv = env.LICENCES;
  const known = await kv.get(`session:${sessionId}`);
  if (known) return [200, { ok: true, key: known }];

  let session;
  try {
    session = await fetchSession(env, sessionId);
  } catch {
    return refuse(502, "stripe_error");
  }
  if (!session) return refuse(404, "unknown_session");
  // Un paiement de test ne délivre jamais une clé du site réel, et inversement.
  if (session.livemode !== (env.MODE === "live")) return refuse(403, "wrong_mode");
  if (env.PAYMENT_LINK_ID && session.payment_link !== env.PAYMENT_LINK_ID) {
    return refuse(403, "not_ours");
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return refuse(402, "not_paid");
  }

  const key = generateKey();
  const email = ((session.customer_details && session.customer_details.email) || "").toLowerCase();
  const paymentIntent = session.payment_intent || null;
  await kv.put(
    `key:${key}`,
    JSON.stringify(newRecord({ session: sessionId, paymentIntent, email })),
  );
  if (paymentIntent) await kv.put(`pi:${paymentIntent}`, key);
  if (email) {
    const keys = (await kv.get(`email:${email}`, "json")) || [];
    await kv.put(`email:${email}`, JSON.stringify([...keys, key]));
  }
  await kv.put(`session:${sessionId}`, key);
  return [200, { ok: true, key }];
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// En-tête Stripe-Signature : t=<horodatage>,v1=<HMAC-SHA256 de "t.corps">.
export async function verifySignature(secret, header, body, now = Date.now() / 1000) {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const timestamp = Number((parts.find(([k]) => k === "t") || [])[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || !signatures.length || Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_S) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
  );
  return signatures.some((s) => sameText(s, expected));
}

// POST /api/stripe/webhook — remboursement total ou litige : la clé est annulée.
export async function webhook(env, signature, body) {
  if (!(await verifySignature(env.STRIPE_WEBHOOK_SECRET, signature, body))) {
    return refuse(400, "bad_signature");
  }
  const event = JSON.parse(body);
  const object = (event.data && event.data.object) || {};
  if (event.type === "charge.refunded" && object.refunded) {
    await revokePayment(env.LICENCES, object.payment_intent);
  } else if (event.type === "charge.dispute.created") {
    await revokePayment(env.LICENCES, object.payment_intent);
  }
  return [200, { ok: true }];
}
