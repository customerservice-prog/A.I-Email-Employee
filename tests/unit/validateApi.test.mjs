import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  validateSettingsPut,
  sanitizeSettingsPatch,
  validateEmailListQuery,
} = require('../../lib/validateApi.js');

describe('validateApi', () => {
  it('rejects unknown settings keys', () => {
    const s = sanitizeSettingsPatch({
      autoSendHighConfidence: false,
      evilKey: true,
    });
    expect(s).toEqual({ autoSendHighConfidence: false });
  });

  it('validates settings PUT fields', () => {
    const bad = validateSettingsPut({ autoSendThreshold: 0.2 });
    expect(bad.error).toBeTruthy();
    const ok = validateSettingsPut({
      autoSendThreshold: 0.85,
      settings: { ragOnlyMode: true },
    });
    expect(ok.value.autoSendThreshold).toBe(0.85);
    expect(ok.value.settings.ragOnlyMode).toBe(true);
  });

  it('validates email list filters', () => {
    expect(validateEmailListQuery('pending', 'review')).toBeNull();
    expect(validateEmailListQuery('bogus', null).error).toBeTruthy();
  });
});
