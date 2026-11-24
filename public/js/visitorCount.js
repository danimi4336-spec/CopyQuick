(function () {
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1' || navigator.webdriver) return;

  function countVisibleVisit() {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', countVisibleVisit);
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!token) return;

    // A browser with storage disabled cannot be counted reliably across reloads.
    try {
      const key = 'copyquick.visitor';
      let browserId = localStorage.getItem(key);
      if (!browserId) {
        browserId = crypto.randomUUID();
        localStorage.setItem(key, browserId);
      }
      const emailInvite = new URLSearchParams(location.search).get('ref') === 'email-invite';
      fetch('/traffic/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'same-origin',
        keepalive: true,
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ browserId, emailInvite })
      }).catch(() => {});
    } catch {
      // Measurement is optional when browser storage is unavailable.
    }
  }

  document.addEventListener('visibilitychange', countVisibleVisit);
  countVisibleVisit();
})();
