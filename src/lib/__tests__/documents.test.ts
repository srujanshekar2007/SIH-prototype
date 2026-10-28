import { describe, expect, it } from 'vitest';
import { MAX_SUPPORTING_DOCUMENT_BYTES, supportingDocumentObjectPath, validateSupportingDocument } from '../documents';

describe('supporting document validation and paths', () => {
  it('accepts allowlisted formats at the size boundary', () => {
    expect(validateSupportingDocument({ name: 'evidence.pdf', type: 'application/pdf', size: MAX_SUPPORTING_DOCUMENT_BYTES })).toBeNull();
  });
  it('rejects unsupported formats, empty files, and oversized files', () => {
    expect(validateSupportingDocument({ name: 'payload.html', type: 'text/html', size: 100 })).toContain('PDF, JPEG, or PNG');
    expect(validateSupportingDocument({ name: 'empty.pdf', type: 'application/pdf', size: 0 })).toContain('empty');
    expect(validateSupportingDocument({ name: 'large.pdf', type: 'application/pdf', size: MAX_SUPPORTING_DOCUMENT_BYTES + 1 })).toContain('10 MB');
  });
  it('places files beneath the complaint UUID and neutralizes path separators', () => {
    expect(supportingDocumentObjectPath('case-uuid', '../secret\\file.pdf', 'random-uuid')).toBe('case-uuid/random-uuid-._secret_file.pdf');
  });
});
