// Point d'entrée du site trackzapdj.com (Cloudflare Worker).
//
// - « / » et « /merci » : redirection vers la page de la bonne langue.
// - « /api/… » : boutique et service de licences (voir src/licences.js et src/stripe.js).
// - Tout le reste : fichiers statiques du site.
//
// Le site en ligne et les Previews (site de test) ont chacun leurs variables, secrets et
// stockage (wrangler.jsonc, bloc « previews ») : MODE vaut "live" en ligne, "test" sinon.

import { activate, deactivate } from "./licences.js";
import { claim, webhook } from "./stripe.js";

const LANGUAGES = ["fr", "en"];
const DEFAULT_LANGUAGE = "en";
const THANKS_PAGES = { fr: "/fr/merci/", en: "/en/thanks/" };
const BUY_PAGES = { fr: "/fr/acheter/", en: "/en/buy/" };

// Choix de la langue : 1) langue choisie précédemment (cookie "lang"),
// 2) langue préférée du navigateur (en-tête Accept-Language), 3) anglais par défaut.
function languageFromCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)lang=(fr|en)(?:;|$)/);
  return match ? match[1] : null;
}

function languageFromBrowser(request) {
  const header = request.headers.get("Accept-Language") || "";
  const preferences = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { lang: tag.split("-")[0], q: q ? parseFloat(q.split("=")[1]) : 1 };
    })
    .filter((p) => LANGUAGES.includes(p.lang) && p.q > 0)
    .sort((a, b) => b.q - a.q);
  return preferences.length ? preferences[0].lang : null;
}

export function chooseLanguage(request) {
  return languageFromCookie(request) || languageFromBrowser(request) || DEFAULT_LANGUAGE;
}

function redirect(url, location, extra = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(location, url).toString(),
      "Cache-Control": "private, no-store",
      ...extra,
    },
  });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// La boutique est ouverte quand tout ce qu'il faut pour vendre est configuré.
export function shopOpen(env) {
  return Boolean(
    env.LICENCES && env.PAYMENT_LINK_URL && env.STRIPE_SECRET_KEY && env.LICENCE_PRIVATE_KEY,
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const LICENCE_ACTIONS = { activate, deactivate, claim };

async function api(request, env, url) {
  const path = url.pathname;

  if (path === "/api/boutique") {
    return json(200, { mode: env.MODE === "live" ? "live" : "test", open: shopOpen(env) });
  }

  if (path === "/api/achat") {
    if (!shopOpen(env)) {
      const lang = url.searchParams.get("lang") === "en" ? "en" : "fr";
      return redirect(url, `${BUY_PAGES[lang]}#indisponible`);
    }
    return redirect(url, env.PAYMENT_LINK_URL);
  }

  if (request.method !== "POST") return json(405, { ok: false, error: "method" });

  if (path === "/api/stripe/webhook") {
    if (!env.LICENCES) return json(503, { ok: false, error: "unavailable" });
    const [status, body] = await webhook(
      env,
      request.headers.get("Stripe-Signature"),
      await request.text(),
    );
    return json(status, body);
  }

  const name = path.startsWith("/api/licence/") ? path.slice("/api/licence/".length) : "";
  const action = Object.hasOwn(LICENCE_ACTIONS, name) ? LICENCE_ACTIONS[name] : null;
  if (!action) return json(404, { ok: false, error: "not_found" });
  // Service pas encore configuré : l'application affiche « pas encore disponible ».
  if (!env.LICENCES || !env.LICENCE_PRIVATE_KEY || (action === claim && !env.STRIPE_SECRET_KEY)) {
    return json(503, { ok: false, error: "unavailable" });
  }
  const [status, body] = await action(env, await readJson(request));
  return json(status, body);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const vary = { Vary: "Accept-Language, Cookie" };

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return redirect(url, `/${chooseLanguage(request)}/${url.search}`, vary);
    }
    // Adresse de retour après le paiement Stripe (un seul lien de paiement pour les deux langues).
    if (url.pathname === "/merci" || url.pathname === "/merci/") {
      return redirect(url, `${THANKS_PAGES[chooseLanguage(request)]}${url.search}`, vary);
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url);
      } catch (error) {
        console.error(error);
        return json(500, { ok: false, error: "server" });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
