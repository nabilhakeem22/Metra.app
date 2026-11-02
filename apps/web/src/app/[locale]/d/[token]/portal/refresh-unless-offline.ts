// Reading the client home again after an answer that may have been lost. A phone
// with no network is the likeliest cause of a lost answer, and a refresh there
// falls back to a browser navigation: the browser's offline page replaces the home,
// and the row's "we could not confirm" line with it. So an offline phone keeps the
// page and that line, which tell the client to check once they are back. Wi-Fi with
// no internet still reports online; that residual is accepted (H8 functional F6).

export function refreshUnlessOffline(refresh: () => void): void {
  if (navigator.onLine) refresh();
}
