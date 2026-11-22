// Runs before the landing page renders.
// 1. Sign-in links from emails (confirm, reset password) carry tokens in the URL hash; send them to the app.
// 2. People who already use the app skip the landing page. Add ?home to the URL to see it anyway.
(function () {
  var hash = window.location.hash || '';
  if (/access_token=|refresh_token=|type=(recovery|signup|magiclink|invite|email_change)|error_description=|error_code=/.test(hash)) {
    window.location.replace('/app/' + hash);
    return;
  }
  if (/[?&]home\b/.test(window.location.search)) return;
  try {
    var store = window.localStorage;
    for (var i = 0; i < store.length; i++) {
      var k = store.key(i);
      if (k.indexOf('nutrient-ledger:acct:') === 0 || /^sb-.*-auth-token$/.test(k)) { window.location.replace('/app/'); return; }
    }
    var guest = JSON.parse(store.getItem('nutrient-ledger:v1') || 'null');
    if (guest && !guest.sample && guest.entries && guest.entries.length) window.location.replace('/app/');
  } catch (e) { /* storage blocked: show the landing page */ }
})();
