export const SUPPORTING_DOCUMENT_BUCKET = 'case-supporting-documents';
export const MAX_SUPPORTING_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_SUPPORTING_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export function validateSupportingDocument(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!ALLOWED_SUPPORTING_DOCUMENT_TYPES.has(file.type)) return 'Choose a PDF, JPEG, or PNG file.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The selected file is empty or invalid.';
  if (file.size > MAX_SUPPORTING_DOCUMENT_BYTES) return 'The file must be 10 MB or smaller.';
  if (!file.name.trim()) return 'The file must have a name.';
  return null;
}

export function supportingDocumentObjectPath(complaintId: string, fileName: string, objectId: string = crypto.randomUUID()): string {
  const safeName = fileName.normalize('NFKC').replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/\.\.+/g, '.').trim().slice(0, 120) || 'attachment';
  return `${complaintId}/${objectId}-${safeName}`;
}
