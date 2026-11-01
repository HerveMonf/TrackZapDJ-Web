// URL réelle de téléchargement de la version gratuite, à renseigner au lancement.
// Tant qu'elle est vide, les éléments marqués data-prelaunch (« être prévenu » par e-mail)
// restent affichés et les éléments data-launched (bouton « Télécharger ») restent masqués.
var DOWNLOAD_URL = "";

if (DOWNLOAD_URL) {
  document.querySelectorAll('[data-download]').forEach(function (a) {
    a.href = DOWNLOAD_URL;
  });
  document.querySelectorAll('[data-launched]').forEach(function (el) {
    el.hidden = false;
  });
  document.querySelectorAll('[data-prelaunch]').forEach(function (el) {
    el.hidden = true;
  });
}

// Un lien vers un bloc repliable (#histoire, #compatibilite…) l'ouvre directement.
function openLinkedDetails() {
  var target = location.hash && document.getElementById(location.hash.slice(1));
  if (!target) return;
  var details = target.tagName === 'DETAILS' ? target : target.querySelector('details');
  if (details) details.open = true;
}
window.addEventListener('hashchange', openLinkedDetails);
openLinkedDetails();

// Mémorise la langue choisie pour les prochaines visites sur trackzapdj.com/
document.querySelectorAll('[data-lang]').forEach(function (a) {
  a.addEventListener('click', function () {
    document.cookie = 'lang=' + a.dataset.lang + '; path=/; max-age=31536000; SameSite=Lax; Secure';
  });
});

// Boutique (pages /fr/acheter/, /en/buy/ et pages de remerciement) : le Worker indique
// si les ventes sont ouvertes et si l'on est sur le site de test (paiements de test Stripe).
function showAll(selector, visible) {
  document.querySelectorAll(selector).forEach(function (el) {
    el.hidden = !visible;
  });
}

if (document.querySelector('[data-shop]')) {
  fetch('/api/boutique')
    .then(function (response) { return response.json(); })
    .then(function (shop) {
      showAll('[data-test-mode]', shop.mode === 'test');
      showAll('[data-shop-open]', shop.open);
      showAll('[data-shop-closed]', !shop.open);
    })
    .catch(function () {});
}

// Page de remerciement : échange l'identifiant du paiement Stripe contre la clé de licence.
var claimPage = document.querySelector('[data-claim]');
if (claimPage) {
  var sessionId = new URLSearchParams(location.search).get('session_id');
  var attempts = 0;

  var showState = function (state) {
    claimPage.querySelectorAll('[data-state]').forEach(function (el) {
      el.hidden = el.dataset.state !== state;
    });
  };

  var showError = function (code) {
    var template = claimPage.querySelector('template[data-messages]');
    var message = template && template.content.querySelector('[data-code="' + code + '"]');
    if (message) claimPage.querySelector('[data-error-text]').textContent = message.textContent;
    showState('error');
  };

  var claim = function () {
    attempts += 1;
    showState('loading');
    fetch('/api/licence/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    })
      .then(function (response) { return response.json(); })
      .then(function (answer) {
        if (answer.ok) {
          claimPage.querySelector('[data-key]').textContent = answer.key;
          showState('done');
        } else if ((answer.error === 'not_paid' || answer.error === 'stripe_error') && attempts < 5) {
          // Le paiement peut mettre quelques secondes à être confirmé.
          setTimeout(claim, 3000);
        } else {
          showError(answer.error);
        }
      })
      .catch(function () { showError('network'); });
  };

  if (sessionId) {
    claim();
  } else {
    showState('missing');
  }

  claimPage.querySelector('[data-retry]').addEventListener('click', function () {
    attempts = 0;
    claim();
  });
  claimPage.querySelector('[data-copy]').addEventListener('click', function () {
    var key = claimPage.querySelector('[data-key]').textContent;
    navigator.clipboard.writeText(key).then(function () {
      showAll('[data-copied]', true);
    });
  });
}
