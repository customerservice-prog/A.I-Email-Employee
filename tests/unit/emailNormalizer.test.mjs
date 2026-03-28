import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  normalizeInboundBody,
} = require('../../services/emailNormalizer.js');

describe('normalizeInboundBody', () => {
  it('strips simple HTML', () => {
    const out = normalizeInboundBody('<p>Hello <b>there</b></p>', {});
    expect(out).toContain('Hello');
    expect(out).toContain('there');
    expect(out).not.toContain('<p>');
  });

  it('removes quoted lines starting with >', () => {
    const raw = 'Thanks!\n> old reply\n> more';
    const out = normalizeInboundBody(raw, {});
    expect(out).toBe('Thanks!');
  });
});
