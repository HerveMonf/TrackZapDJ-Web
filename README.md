# TrackZapDJ-Web

Site trackzapdj.com, servi par un Cloudflare Worker (`src/worker.js`) et des pages statiques (`fr/`, `en/`).

| Branche | Adresse | Paiements |
| --- | --- | --- |
| `develop` | https://develop-trackzapdj-web.young-fog-b421.workers.dev (Preview) | Stripe **mode test** |
| `main` | https://www.trackzapdj.com | **réels** |

Chaque envoi sur GitHub publie automatiquement la branche (Workers Builds).

## Boutique et licences

| Fichier | Rôle |
| --- | --- |
| `fr/acheter/`, `en/buy/` | Page d'achat (adresse du bouton « Acheter » de l'application). |
| `fr/merci/`, `en/thanks/` | Retour après paiement : affiche la clé de licence. |
| `src/worker.js` | Routes : `/api/boutique`, `/api/achat`, `/api/licence/claim`, `/activate`, `/deactivate`, `/api/stripe/webhook`, `/merci`. |
| `src/licences.js` | Clés, activation (1 ordinateur par licence), certificat signé Ed25519. |
| `src/stripe.js` | Vérification du paiement auprès de Stripe, webhook de remboursement. |
| `tests/worker.test.mjs` | Tests : `node --test tests/worker.test.mjs` (Node.js 22+). |

Le contrat avec l'application (formats, codes d'erreur, certificat) est décrit dans le dépôt de
l'application : `Docs/LICENCES.md`. Le modifier des deux côtés à la fois.

### Parcours d'achat

1. Application : **Fichier → Licence… → Acheter** ouvre `/fr/acheter/`.
2. **Acheter** → `/api/achat` → lien de paiement Stripe (`PAYMENT_LINK_URL`).
3. Après paiement, Stripe renvoie vers `/merci?session_id={CHECKOUT_SESSION_ID}` → page de la bonne langue.
4. La page appelle `/api/licence/claim` : le Worker vérifie le paiement auprès de Stripe et délivre la clé
   (toujours la même pour un même paiement).
5. Application : la clé est activée par `/api/licence/activate`.

### Séparation test / réel

Le site en ligne et les Previews ont chacun leurs **variables** (`wrangler.jsonc` : `vars` et
`previews.vars`), leurs **secrets** et leur **stockage**. Un paiement de test ne peut pas délivrer une
clé sur le site réel (contrôle `livemode`), et un certificat de test est refusé par l'application publiée
(clés de signature différentes).

### Mise en service (une fois pour le mode test, une fois pour le réel)

**Stripe** (en mode test pour la Preview, puis en mode réel) :

1. Produit « TrackZapDJ », 4,99 € TTC.
2. **Lien de paiement** (Payment Link) pour ce produit. Après le paiement : « Ne pas afficher de page de
   confirmation » → rediriger vers `https://<site>/merci?session_id={CHECKOUT_SESSION_ID}`.
   Noter son adresse (`https://buy.stripe.com/…`) et son identifiant (`plink_…`).
3. **Clé restreinte** (Développeurs → Clés API → Créer une clé restreinte) avec seulement
   « Checkout Sessions : Lecture ». Elle commence par `rk_test_` ou `rk_live_`.
4. **Webhook** (Développeurs → Webhooks) vers `https://<site>/api/stripe/webhook`, événements
   `charge.refunded` et `charge.dispute.created`. Noter son secret de signature (`whsec_…`).

**Cloudflare** (Workers & Pages → trackzapdj-web) :

1. **Stockage KV** : créer deux espaces de noms, `trackzapdj-licences` (réel) et
   `trackzapdj-licences-preview` (test). Leurs identifiants vont dans `wrangler.jsonc`
   (`kv_namespaces`, binding `LICENCES`, et la même chose dans `previews`).
2. **Secrets** (Settings → Variables and secrets), sur **Production** pour le réel et sur
   **Previews** pour le test :
   - `STRIPE_SECRET_KEY` : la clé restreinte Stripe ;
   - `STRIPE_WEBHOOK_SECRET` : le secret du webhook ;
   - `LICENCE_PRIVATE_KEY` : la clé privée de signature (fichier `licence-private-key-test.txt` ou
     `-live.txt`, dernière ligne). **Jamais** dans ce dépôt.
3. Variables `PAYMENT_LINK_URL` et `PAYMENT_LINK_ID` : dans `wrangler.jsonc` (`vars` pour le réel,
   `previews.vars` pour le test).

Tant qu'un de ces éléments manque, la page d'achat affiche « Les ventes ne sont pas encore ouvertes » et
l'application affiche « activation pas encore disponible ».

### Support

Dans Cloudflare → KV → espace de noms :

- `email:<adresse>` : clés achetées avec cette adresse (pour renvoyer une clé perdue) ;
- `key:<CLÉ>` : fiche de la licence. Pour libérer un ordinateur perdu, remettre `"machine": null` ;
  pour annuler une clé, mettre `"revoked": true`.

## Outils

- `tools/captures.ps1` : prépare les captures de l'application pour la page « Comment ça marche » (copie depuis `../APPLI/Docs`, recadrage, floutage des chemins et informations personnelles, écriture dans `images/app`). Mode d'emploi en tête du script. Le dossier `tools` est exclu du déploiement (`.assetsignore`).
