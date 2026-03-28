import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  isPlaceholderOrUnsafeDraft,
  FALLBACK_DRAFT_BODY,
} = require('../../lib/draftConstants.js');

describe('draftConstants', () => {
  it('treats model-empty fallback as unsafe for auto-send', () => {
    expect(isPlaceholderOrUnsafeDraft(FALLBACK_DRAFT_BODY)).toBe(true);
  });

  it('rejects very short drafts', () => {
    expect(isPlaceholderOrUnsafeDraft('Thanks.')).toBe(true);
  });

  it('accepts a substantive reply', () => {
    const s =
      'Hi Jane — we can deliver on Tuesday between 9–11am. The total for the quoted items is $240 plus tax.';
    expect(isPlaceholderOrUnsafeDraft(s)).toBe(false);
  });
});
