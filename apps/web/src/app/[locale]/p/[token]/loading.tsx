import { DocumentSkeleton } from '@/components/loading/document-skeleton';

// A client opening a document: its own shape on the page's centred column.
export default function Loading() {
  return <DocumentSkeleton className="mx-auto max-w-3xl p-4 md:p-8" />;
}
