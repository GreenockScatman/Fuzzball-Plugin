import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('keeps permissions optional, code local and connections on loopback', () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.minimum_chrome_version).toBe('120');
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(manifest.permissions).toEqual(['storage', 'scripting', 'tabs', 'alarms', 'webNavigation']);
  expect(manifest.incognito).toBe('not_allowed');
  expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
  expect(manifest.content_security_policy.extension_pages).toContain('connect-src ws://127.0.0.1:*');
  expect(manifest.content_security_policy.extension_pages).not.toMatch(/unsafe-eval|unsafe-inline|https:/);
});
