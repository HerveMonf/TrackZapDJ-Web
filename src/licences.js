// Service de licences TrackZapDJ.
// Le contrat avec l'application (formats, codes d'erreur, certificat) est décrit dans
// le dépôt de l'application : Docs/LICENCES.md, § 3. Ne pas le modifier d'un seul côté.
//
// Stockage (Cloudflare KV, binding LICENCES ; un espace séparé pour les Previews) :
//   key:<CLÉ>        fiche de la licence (JSON, voir newRecord)
//   session:<cs_…>   clé délivrée pour ce paiement Stripe (une seule clé par paiement)
//   pi:<pi_…>        clé liée à ce paiement, pour l'annuler en cas de remboursement
//   email:<adresse>  clés achetées avec cette adresse (pour le support)

export const PRODUCT = "trackzapdj";
export const CERTIFICATE_VERSION = 1;

// Alphabet de Crockford : pas de I, L, O ni U.
const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const KEY_PATTERN = /^TZDJ(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;
const MACHINE_PATTERN = /^[0-9a-f]{64}$/;

// Une réponse : [code HTTP, corps JSON].
const refuse = (status, error) => [status, { ok: false, error }];

export function generateKey() {
  // 16 caractères de 5 bits = 80 bits. 256 étant un multiple de 32, « & 31 » reste uniforme.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const body = Array.from(bytes, (b) => KEY_ALPHABET[b & 31]).join("");
  return "TZDJ-" + body.match(/.{4}/g).join("-");
}

export function newRecord(fields) {
  return {
    machine: null,
    revoked: false,
    created: new Date().toISOString(),
    activated: null,
    ...fields,
  };
}

export function base64ToBytes(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Certificat : <contenu base64url>.<signature Ed25519 base64url> (Docs/LICENCES.md § 3.5).
export async function signCertificate(privateKeyBase64, key, machine) {
  const payload = JSON.stringify({
    v: CERTIFICATE_VERSION,
    product: PRODUCT,
    key,
    machine,
    issued: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const data = new TextEncoder().encode(payload);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKeyBase64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, data));
  return `${bytesToBase64Url(data)}.${bytesToBase64Url(signature)}`;
}

function validRequest(body) {
  return (
    body &&
    typeof body.key === "string" &&
    typeof body.machine === "string" &&
    MACHINE_PATTERN.test(body.machine)
  );
}

async function readRecord(kv, key) {
  return KEY_PATTERN.test(key) ? kv.get(`key:${key}`, "json") : null;
}

// POST /api/licence/activate — lie la clé à cet ordinateur (1 ordinateur par licence).
export async function activate(env, body) {
  if (!validRequest(body)) return refuse(400, "bad_request");
  const record = await readRecord(env.LICENCES, body.key);
  if (!record) return refuse(404, "invalid_key");
  if (record.revoked) return refuse(403, "revoked");
  if (record.machine && record.machine !== body.machine) return refuse(409, "already_active");
  if (record.machine !== body.machine) {
    record.machine = body.machine;
    record.activated = new Date().toISOString();
    await env.LICENCES.put(`key:${body.key}`, JSON.stringify(record));
  }
  const certificate = await signCertificate(env.LICENCE_PRIVATE_KEY, body.key, body.machine);
  return [200, { ok: true, certificate }];
}

// POST /api/licence/deactivate — libère la clé pour un autre ordinateur.
export async function deactivate(env, body) {
  if (!validRequest(body)) return refuse(400, "bad_request");
  const record = await readRecord(env.LICENCES, body.key);
  if (!record) return refuse(404, "invalid_key");
  if (record.revoked) return refuse(403, "revoked");
  if (record.machine !== body.machine) return refuse(409, "not_active_here");
  record.machine = null;
  record.activated = null;
  await env.LICENCES.put(`key:${body.key}`, JSON.stringify(record));
  return [200, { ok: true }];
}

// Remboursement ou litige : la clé est refusée aux activations suivantes.
export async function revokePayment(kv, paymentIntent) {
  const key = paymentIntent && (await kv.get(`pi:${paymentIntent}`));
  const record = key && (await kv.get(`key:${key}`, "json"));
  if (!record || record.revoked) return false;
  record.revoked = true;
  record.revokedAt = new Date().toISOString();
  await kv.put(`key:${key}`, JSON.stringify(record));
  return true;
}
