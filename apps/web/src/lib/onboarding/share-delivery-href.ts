// PURE (client-safe). Where "Share with your client" leads: the newest unshared
// delivery with its client-link dialog opened on arrival (`?share=1`), or the
// deliveries list when no in-flight delivery is waiting for a link.

export type ShareDeliveryHref = `/engagements/${string}?share=1` | '/engagements';

export function shareDeliveryHref(newestUnsharedDeliveryId: string | null): ShareDeliveryHref {
  return newestUnsharedDeliveryId
    ? `/engagements/${newestUnsharedDeliveryId}?share=1`
    : '/engagements';
}
