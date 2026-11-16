import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_OFF, normalizeOff, offModuleFor, visibleGroups } from '@/lib/modules';
import { digitViewsFor, navTooltip, DIGIT_VIEWS } from '@/lib/nav';

/** Settings → Modules (lib/modules.ts): switch views on and off per install. */
describe('modules', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glados-modules-'));
    process.env.GLADOS_MODULES_FILE = path.join(dir, 'modules.json');
  });
  afterEach(() => {
    delete process.env.GLADOS_MODULES_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Personal trading and consumer brand deals are off by default on a fresh install.
  test('a fresh install has default modules off', async () => {
    const { getModulesOff } = await import('@/lib/modules-server');
    expect(DEFAULT_OFF).toEqual(['/trading', '/brand-deals']);
    expect(getModulesOff()).toEqual(['/trading', '/brand-deals']);
  });

  test('the API switches one module and keeps the choice on disk', async () => {
    const { GET, POST } = await import('@/app/api/settings/modules/route');
    const post = (body: unknown) => POST(new Request('http://x/api/settings/modules', { method: 'POST', body: JSON.stringify(body) }));
    let r = await (await post({ href: '/trading', on: true })).json();
    expect(r.off).not.toContain('/trading');
    r = await (await post({ href: '/roadmap', on: false })).json();
    expect(r.off).toContain('/roadmap');
    expect((await (await GET()).json()).off).toEqual(r.off);
    expect(JSON.parse(fs.readFileSync(process.env.GLADOS_MODULES_FILE!, 'utf8')).off).toEqual(r.off);
    // Home and Settings cannot be switched off; unknown hrefs are refused
    expect((await post({ href: '/setup', on: false })).status).toBe(400);
    expect((await post({ href: '/', on: false })).status).toBe(400);
    expect((await post({ href: '/nope', on: false })).status).toBe(400);
  });

  test('a broken file falls back to the default instead of failing', async () => {
    fs.writeFileSync(process.env.GLADOS_MODULES_FILE!, '{not json');
    const { getModulesOff } = await import('@/lib/modules-server');
    expect(getModulesOff().sort()).toEqual([...DEFAULT_OFF].sort());
  });

  test('off modules leave the sidebar, digit keys and tooltips; an emptied group drops out', () => {
    expect(normalizeOff(['/trading', '/trading', '/', '/setup', 42, '/x'])).toEqual(['/trading']);
    const off = ['/clients', '/trading', '/lead-magnets', '/chats', '/knowledge', '/drift'];
    const items = visibleGroups(off).flatMap((g) => g.items.map((i) => i.href));
    for (const h of off) expect(items).not.toContain(h);
    expect(digitViewsFor([])).toEqual(DIGIT_VIEWS);
    expect(digitViewsFor(off)).toEqual(['/', '/roadmap', '/analytics', '/usage', '/funnel', '/inbox', '/org', '/workflows', '/tasks']);
    const marketing = ['/creative-engine', '/adpilot', '/social', '/lead-magnets', '/lab', '/brand-deals'];
    expect(visibleGroups(marketing).some((g) => g.id === 'marketing')).toBe(false);
  });

  test('a switched-off page is gated, sub-routes included', () => {
    expect(offModuleFor('/trading', ['/trading'])).toBe('/trading');
    expect(offModuleFor('/clients/abc', ['/clients'])).toBe('/clients');
    expect(offModuleFor('/finances', ['/trading'])).toBeNull();
    expect(offModuleFor('/setup', ['/trading'])).toBeNull();
  });
});
