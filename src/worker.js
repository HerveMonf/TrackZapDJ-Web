// Redirige la racine du site (/) vers /fr/ ou /en/.
// Ordre de priorité : 1) langue choisie précédemment (cookie "lang"),
// 2) langue préférée du navigateur (en-tête Accept-Language), 3) anglais par défaut.
// Toutes les autres URL sont servies telles quelles depuis les fichiers statiques.

const LANGUAGES = ["fr", "en"];
const DEFAULT_LANGUAGE = "en";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const target = new URL(`/${chooseLanguage(request)}/${url.search}`, url);
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.toString(),
          Vary: "Accept-Language, Cookie",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
