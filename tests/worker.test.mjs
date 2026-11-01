// Tests du service de licences et de la boutique, sans Cloudflare ni Stripe.
// Lancement : node --test tests/worker.test.mjs   (Node.js 22 ou plus récent)

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { generateKey, KEY_PATTERN, signCertificate } from "../src/licences.js";
import { verifySignature } from "../src/stripe.js";
import worker from "../src/worker.js";

const MACHINE = "a".repeat(64);
const OTHER = "b".repeat(64);

class FakeKV {
  constructor() {
    this.data = new Map();
  }
  async get(key, type) {
    const value = this.data.has(key) ? this.data.get(key) : null;
    return type === "json" && value !== null ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.data.set(key, value);
  }
}

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { privateKey: Buffer.from(pkcs8).toString("base64"), publicKey: pair.publicKey };
}

let env;
let publicKey;
let stripeSessions;

beforeEach(async () => {
  const pair = await keyPair();
  publicKey = pair.publicKey;
  stripeSessions = new Map();
  env = {
    MODE: "test",
    LICENCES: new FakeKV(),
    LICENCE_PRIVATE_KEY: pair.privateKey,
    STRIPE_SECRET_KEY: "rk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    PAYMENT_LINK_URL: "https://buy.stripe.com/test_abc",
    PAYMENT_LINK_ID: "plink_ok",
    ASSETS: { fetch: async () => new Response("asset") },
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer rk_test_x");
    const session = stripeSessions.get(url.split("/").pop());
    return session
      ? new Response(JSON.stringify(session), { status: 200 })
      : new Response("{}", { status: 404 });
  };
});

function call(path, body, init = {}) {
  const request = new Request(`https://develop-trackzapdj-web.example.workers.dev${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    redirect: "manual",
    ...init,
  });
  return worker.fetch(request, env);
}

async function answer(path, body, init) {
  const response = await call(path, body, init);
  return [response.status, await response.json()];
}

function paidSession(id, extra = {}) {
  stripeSessions.set(id, {
    id,
    livemode: false,
    status: "complete",
    payment_status: "paid",
    payment_link: "plink_ok",
    payment_intent: `pi_${id}`,
    customer_details: { email: "DJ@Example.com" },
    ...extra,
  });
}

async function sellKey(id = "cs_test_a1b2c3d4e5f6") {
  paidSession(id);
  const [, body] = await answer("/api/licence/claim", { session_id: id });
  return body.key;
}

function decode(text) {
  return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

describe("clés", () => {
  test("format TZDJ-XXXX-XXXX-XXXX-XXXX, alphabet de Crockford, toutes différentes", () => {
    const keys = new Set(Array.from({ length: 500 }, generateKey));
    assert.equal(keys.size, 500);
    for (const key of keys) assert.match(key, KEY_PATTERN);
  });
});

describe("achat", () => {
  test("un paiement réussi donne une clé, toujours la même", async () => {
    const key = await sellKey();
    assert.match(key, KEY_PATTERN);
    assert.equal(await sellKey(), key);
    const record = await env.LICENCES.get(`key:${key}`, "json");
    assert.equal(record.email, "dj@example.com");
    assert.equal(record.machine, null);
    assert.deepEqual(await env.LICENCES.get("email:dj@example.com", "json"), [key]);
  });

  test("paiement inconnu, non payé, d'un autre produit ou de l'autre mode : refusé", async () => {
    paidSession("cs_test_unpaid000001", { payment_status: "unpaid", status: "open" });
    paidSession("cs_test_otherlink0001", { payment_link: "plink_other" });
    paidSession("cs_test_livepayment01", { livemode: true });
    const cases = [
      ["cs_test_unknown000001", 404, "unknown_session"],
      ["cs_test_unpaid000001", 402, "not_paid"],
      ["cs_test_otherlink0001", 403, "not_ours"],
      ["cs_test_livepayment01", 403, "wrong_mode"],
      ["pas un identifiant", 400, "bad_request"],
    ];
    for (const [id, status, error] of cases) {
      assert.deepEqual(await answer("/api/licence/claim", { session_id: id }), [
        status,
        { ok: false, error },
      ]);
    }
    assert.equal([...env.LICENCES.data.keys()].filter((k) => k.startsWith("key:")).length, 0);
  });

  test("boutique : ouverte quand tout est configuré, sinon renvoi vers la page d'achat", async () => {
    assert.deepEqual(await answer("/api/boutique"), [200, { mode: "test", open: true }]);
    let response = await call("/api/achat");
    assert.equal(response.headers.get("Location"), "https://buy.stripe.com/test_abc");
    delete env.PAYMENT_LINK_URL;
    assert.deepEqual(await answer("/api/boutique"), [200, { mode: "test", open: false }]);
    response = await call("/api/achat?lang=en");
    assert.match(response.headers.get("Location"), /\/en\/buy\/#indisponible$/);
  });
});

describe("activation", () => {
  test("certificat signé, lisible par l'application", async () => {
    const key = await sellKey();
    const [status, body] = await answer("/api/licence/activate", {
      key,
      machine: MACHINE,
      version: "0.9.0",
    });
    assert.equal(status, 200);
    const [payload, signature] = body.certificate.split(".");
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      decode(signature),
      decode(payload),
    );
    assert.ok(valid);
    const data = JSON.parse(decode(payload).toString("utf8"));
    assert.deepEqual(
      { v: data.v, product: data.product, key: data.key, machine: data.machine },
      { v: 1, product: "trackzapdj", key, machine: MACHINE },
    );
    assert.match(data.issued, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  test("un seul ordinateur par licence, réinstallation acceptée, libération", async () => {
    const key = await sellKey();
    const activate = (machine) => answer("/api/licence/activate", { key, machine });
    assert.equal((await activate(MACHINE))[0], 200);
    assert.equal((await activate(MACHINE))[0], 200);
    assert.deepEqual(await activate(OTHER), [409, { ok: false, error: "already_active" }]);
    assert.deepEqual(await answer("/api/licence/deactivate", { key, machine: OTHER }), [
      409,
      { ok: false, error: "not_active_here" },
    ]);
    assert.deepEqual(await answer("/api/licence/deactivate", { key, machine: MACHINE }), [
      200,
      { ok: true },
    ]);
    assert.equal((await activate(OTHER))[0], 200);
  });

  test("clé inconnue, requête incomplète", async () => {
    assert.deepEqual(await answer("/api/licence/activate", { key: generateKey(), machine: MACHINE }), [
      404,
      { ok: false, error: "invalid_key" },
    ]);
    assert.deepEqual(await answer("/api/licence/activate", { key: "TZDJ-1234", machine: MACHINE }), [
      404,
      { ok: false, error: "invalid_key" },
    ]);
    for (const body of [{ key: generateKey(), machine: "court" }, {}, "pas du JSON"]) {
      assert.deepEqual(await answer("/api/licence/activate", body), [
        400,
        { ok: false, error: "bad_request" },
      ]);
    }
  });

  test("service non configuré : « unavailable », jamais d'erreur 500", async () => {
    delete env.LICENCE_PRIVATE_KEY;
    assert.deepEqual(
      await answer("/api/licence/activate", { key: generateKey(), machine: MACHINE }),
      [503, { ok: false, error: "unavailable" }],
    );
    delete env.LICENCES;
    assert.deepEqual(await answer("/api/licence/claim", { session_id: "cs_test_a1b2c3d4e5f6" }), [
      503,
      { ok: false, error: "unavailable" },
    ]);
  });

  test("méthodes et adresses inconnues", async () => {
    assert.equal((await call("/api/licence/activate")).status, 405);
    assert.equal((await answer("/api/licence/toString", {}))[0], 404);
    assert.equal((await answer("/api/autre", {}))[0], 404);
  });
});

describe("remboursement (webhook Stripe)", () => {
  async function signed(event, secret = "whsec_test", time = Math.floor(Date.now() / 1000)) {
    const body = JSON.stringify(event);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${time}.${body}`));
    const signature = Buffer.from(mac).toString("hex");
    return { body, headers: { "Stripe-Signature": `t=${time},v1=${signature}` } };
  }

  test("remboursement total : la clé est refusée ensuite", async () => {
    const key = await sellKey("cs_test_refund000001");
    const refund = {
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_cs_test_refund000001", refunded: true } },
    };
    const { body, headers } = await signed(refund);
    assert.equal((await call("/api/stripe/webhook", body, { headers })).status, 200);
    assert.deepEqual(await answer("/api/licence/activate", { key, machine: MACHINE }), [
      403,
      { ok: false, error: "revoked" },
    ]);
  });

  test("remboursement partiel : la clé reste valable", async () => {
    const key = await sellKey("cs_test_partial00001");
    const { body, headers } = await signed({
      type: "charge.refunded",
      data: { object: { payment_intent: "pi_cs_test_partial00001", refunded: false } },
    });
    assert.equal((await call("/api/stripe/webhook", body, { headers })).status, 200);
    assert.equal((await answer("/api/licence/activate", { key, machine: MACHINE }))[0], 200);
  });

  test("signature fausse ou trop ancienne : refusée", async () => {
    const event = { type: "charge.dispute.created", data: { object: { payment_intent: "x" } } };
    const forged = await signed(event, "whsec_other");
    assert.equal((await call("/api/stripe/webhook", forged.body, { headers: forged.headers })).status, 400);
    const old = await signed(event, "whsec_test", Math.floor(Date.now() / 1000) - 3600);
    assert.equal((await call("/api/stripe/webhook", old.body, { headers: old.headers })).status, 400);
    assert.equal(await verifySignature("whsec_test", null, "{}"), false);
  });
});

describe("pages", () => {
  test("retour de paiement vers la page « merci » de la bonne langue, paramètres gardés", async () => {
    const french = await call("/merci?session_id=cs_test_1", undefined, {
      headers: { "Accept-Language": "fr-FR,fr;q=0.9" },
    });
    assert.match(french.headers.get("Location"), /\/fr\/merci\/\?session_id=cs_test_1$/);
    const english = await call("/merci?session_id=cs_test_1");
    assert.match(english.headers.get("Location"), /\/en\/thanks\/\?session_id=cs_test_1$/);
  });

  test("les fichiers du site restent servis tels quels", async () => {
    assert.equal(await (await call("/fr/")).text(), "asset");
  });
});

test("certificat : contenu JSON compact, signature vérifiable", async () => {
  const pair = await keyPair();
  const certificate = await signCertificate(pair.privateKey, "TZDJ-0000-0000-0000-0000", MACHINE);
  assert.equal(certificate.split(".").length, 2);
  assert.doesNotMatch(certificate, /[=+/]/);
});
