// Reading the client home again after an act. With no network a refresh falls back
// to a browser navigation: the browser's offline page replaces the home, and what the
// act said with it. So an offline phone keeps the page and reads it once its network
// returns, and the page then shows what the act came to without a manual reload.
// Every waiting refresh reads the same page, so however many acts asked, the window's
// next `online` event refreshes once and leaves nothing listening; a refresh made then
// asks for no other. Accepted residuals: Wi-Fi with no internet reports online, and a
// drop in the middle of a refresh that started online, both still reach that page.

let waiting: (() => void) | null = null;

function refreshWaiting(): void {
  const refresh = waiting;
  waiting = null;
  refresh?.();
}

export function refreshNowOrWhenOnline(refresh: () => void): void {
  if (navigator.onLine) {
    refresh();
    return;
  }
  waiting = refresh;
  window.addEventListener('online', refreshWaiting, { once: true });
}
