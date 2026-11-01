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
