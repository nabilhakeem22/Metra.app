// The paths a document upload refusal can name. A plain module, so the upload
// control and the upload core share it.

/** The category picker: a category retired or deleted since the page loaded. */
export const DOCUMENT_UPLOAD_FIELDS = ['categoryId'] as const;

export type DocumentUploadField = (typeof DOCUMENT_UPLOAD_FIELDS)[number];
