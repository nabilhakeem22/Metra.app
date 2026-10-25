// The two upload URLs a photo presign answers with (Stage 3 site app, plan C3):
// the phone PUTs the display copy and the thumbnail straight to object storage,
// so no photo byte passes through the Worker. PURE types, CLIENT-SAFE.

export interface PresignedUpload {
  url: string;
  headers: { 'content-type': 'image/jpeg' };
}

export interface PresignedPair {
  display: PresignedUpload;
  thumb: PresignedUpload;
  /** ISO instant the URLs stop working (15 minutes after the presign). */
  expiresAt: string;
}
