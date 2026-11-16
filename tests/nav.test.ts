import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_GROUPS, NAV_ITEMS, NAV_ORDER, NAV_EXTRA, DIGIT_VIEWS, WizardIcon, activeHref, groupOf, navTooltip } from '@/lib/nav';
import { EXTERNAL_COMMANDS, filterCommands, viewCommands } from '@/lib/palette';

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const hrefsOf = (id: string) => NAV_GROUPS.find((g) => g.id === id)!.items.map((i) => i.href);
const pageFor = (href: string) => (href === '/' ? 'app/page.tsx' : `app/${href.replace(/^\//, '')}/page.tsx`);

describe('nav model (Hazzino BOS 10 business areas)', () => {
  test('ten groups in order', () => {
    expect(NAV_GROUPS.map((g) => [g.id, g.title])).toEqual([
      ['management', 'Management Dashboard'],
      ['crm', 'CRM & Sales Management'],
      ['hr', 'HR & Employee Management'],
      ['projects', 'Project Management'],
      ['marketing', 'Digital Marketing Management'],
      ['training', 'Training & Education Management'],
      ['finance', 'Finance & Administration'],
      ['ai-employees', 'AI Employee Department'],
      ['knowledge', 'Knowledge Centre'],
      ['settings', 'Settings & Access Control'],
    ]);
    expect(NAV_GROUPS[0].label).toBe('Management Dashboard');
  });

  test('exact items per group (30 in all)', () => {
    expect(hrefsOf('management')).toEqual(['/', '/roadmap', '/analytics', '/usage']);
    expect(hrefsOf('crm')).toEqual(['/clients', '/funnel', '/inbox']);
    expect(hrefsOf('hr')).toEqual(['/org']);
    expect(hrefsOf('projects')).toEqual(['/workflows', '/tasks']);
    expect(hrefsOf('marketing')).toEqual(['/creative-engine', '/adpilot', '/social', '/lead-magnets', '/lab', '/brand-deals']);
    expect(hrefsOf('training')).toEqual(['/skills']);
    expect(hrefsOf('finance')).toEqual(['/finances', '/trading']);
    expect(hrefsOf('ai-employees')).toEqual(['/agents', '/chats', '/wizard', '/compute']);
    expect(hrefsOf('knowledge')).toEqual(['/brain', '/database', '/knowledge', '/drift', '/integrations', '/blueprint']);
    expect(hrefsOf('settings')).toEqual(['/setup']);
    expect(NAV_ITEMS).toHaveLength(30);
  });

  test('labels: Brain Files on /database, Creative Engine, Settings on /setup', () => {
    const label = (href: string) => NAV_ITEMS.find((i) => i.href === href)?.label;
    expect(label('/database')).toBe('Brain Files');
    expect(label('/creative-engine')).toBe('Creative Engine');
    expect(label('/inbox')).toBe('Comms');
    expect(label('/setup')).toBe('Settings');
    expect(label('/org')).toBe('Org Chart');
  });

  test('NAV_ORDER is NAV_GROUPS flattened; no duplicate hrefs across the nav and NAV_EXTRA', () => {
    expect(NAV_ORDER).toEqual(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)));
    const all = [...NAV_ORDER, ...NAV_EXTRA.map((i) => i.href)];
    expect(new Set(all).size).toBe(all.length);
  });

  test('placement across the 10 business areas', () => {
    expect(groupOf('/blueprint')?.id).toBe('knowledge');
    expect(groupOf('/compute')?.id).toBe('ai-employees');
    expect(groupOf('/database')?.id).toBe('knowledge');
    expect(groupOf('/workflows')?.id).toBe('projects');
    expect(groupOf('/analytics')?.id).toBe('management');
    expect(groupOf('/finances')?.id).toBe('finance');
    expect(groupOf('/lab')?.id).toBe('marketing');
    expect(groupOf('/clients')?.id).toBe('crm');
    expect(groupOf('/skills')?.id).toBe('training');
    expect(groupOf('/org')?.id).toBe('hr');
  });

  test('removed surfaces are gone: Reference Model and Personas', () => {
    const all = [...NAV_ORDER, ...NAV_EXTRA.map((i) => i.href)];
    expect(all).not.toContain('/reference');
    expect(all).not.toContain('/personas');
    const labels = [...NAV_ITEMS, ...NAV_EXTRA].map((i) => i.label).concat(NAV_GROUPS.map((g) => g.title ?? ''));
    for (const gone of ['Reference Model', 'Personas', 'Variants', 'Intelligence', 'Operate']) expect(labels).not.toContain(gone);
  });

  test('every nav and palette-only view is a real page route', () => {
    for (const { href } of [...NAV_ITEMS, ...NAV_EXTRA]) {
      expect(existsSync(path.join(process.cwd(), pageFor(href))), `${href} should have a page.tsx`).toBe(true);
    }
  });

  test('every item has search keywords', () => {
    for (const i of [...NAV_ITEMS, ...NAV_EXTRA]) expect(i.keywords.trim().length, i.href).toBeGreaterThan(0);
  });

  test('the Wizard item uses the one exported Wizard glyph (S08 FR-1, C31)', () => {
    expect(NAV_ITEMS.find((i) => i.href === '/wizard')?.icon).toBe(WizardIcon);
  });

  test('AdPilot and Creative Engine carry the G1 accent flag; nothing else does (C32)', () => {
    expect(NAV_ITEMS.filter((i) => i.accent === 'adpilot').map((i) => i.href)).toEqual(['/creative-engine', '/adpilot']);
  });
});

describe('digit shortcuts', () => {
  test('1–9: the first nine visible views minus AdPilot', () => {
    expect(DIGIT_VIEWS).toEqual([
      '/', '/roadmap', '/analytics', '/usage', '/clients', '/funnel', '/inbox', '/org', '/workflows',
    ]);
    expect(DIGIT_VIEWS).not.toContain('/creative-engine');
    expect(DIGIT_VIEWS).not.toContain('/adpilot');
  });

  test('regression: Analytics and Finances stay in the navigation order', () => {
    expect(NAV_ORDER).toContain('/analytics');
    expect(NAV_ORDER).toContain('/finances');
  });

  test('CommandPalette consumes the shared DIGIT_VIEWS (no private stale copy)', () => {
    const src = read('components/CommandPalette.tsx');
    expect(src).toMatch(/from '@\/lib\/nav'/);
    expect(src).not.toMatch(/const DIGIT_VIEWS\s*=/);
  });
});

describe('activeHref: one highlight, longest prefix', () => {
  const cases: [string, string | null][] = [
    ['/', '/'],
    ['/funnel', '/funnel'],
    ['/agents/setup/crm-pulse', '/agents'],
    ['/integrations/whatsapp', '/integrations'],
    ['/social/beehiiv', '/social'],
    ['/social/instagram', '/social'],
    ['/workflows/abc', '/workflows'],
    ['/creative-engine', '/creative-engine'],
    ['/creative-engine?engine=runs', '/creative-engine'],
    ['/ad-engine', '/creative-engine'],
    ['/org', '/org'],
    ['/database', '/database'],
    ['/login', null],
    ['/personas', null],
    ['/reference', null],
    ['/nope', null],
  ];
  test.each(cases)('%s → %s', (pathname, want) => {
    expect(activeHref(pathname)).toBe(want);
  });

  test('"/" never matches a nested path', () => {
    expect(activeHref('/funnel/x')).toBe('/funnel');
    expect(activeHref('/unknown/x')).toBeNull();
  });

  test('/creative-engine highlights Creative Engine, never AdPilot', () => {
    expect(activeHref('/creative-engine/anything')).not.toBe('/adpilot');
  });
});

describe('command palette mirrors the nav (S12 FR-3, C34)', () => {
  const cmds = [...viewCommands(), ...EXTERNAL_COMMANDS];

  test('every nav label returns its own view as the top result (AC12.10)', () => {
    for (const item of [...NAV_ITEMS, ...NAV_EXTRA]) {
      expect(filterCommands(cmds, item.label)[0]?.href, item.label).toBe(item.href);
    }
  });

  test('old words and new views are findable', () => {
    const top = (q: string) => filterCommands(cmds, q)[0]?.href;
    expect(top('funnel')).toBe('/funnel');
    expect(top('drift')).toBe('/drift');
    expect(top('compute')).toBe('/compute');
    expect(top('brain files')).toBe('/database');
    expect(top('database')).toBe('/database');
    expect(top('ad engine')).toBe('/creative-engine');
    expect(top('org chart')).toBe('/org');
    expect(top('reference')).toBe('/blueprint');
    expect(top('settings')).toBe('/setup');
    expect(top('setup')).toBe('/setup');
    expect(top('appearance')).toBe('/setup');
  });

  test('group titles are searchable', () => {
    const settings = filterCommands(cmds, 'settings').map((c) => c.href);
    for (const href of hrefsOf('settings')) expect(settings).toContain(href);
  });

  test('derived ids are stable (nav-<label slug>)', () => {
    expect(viewCommands().find((c) => c.href === '/creative-engine')?.id).toBe('nav-creative-engine');
  });

  test('app/layout.tsx and lib/palette.ts hand-write no view list (only external https links)', () => {
    // Agent and tool rows in layout.tsx point at /agents and /integrations;
    // what must never come back is a literal view command.
    for (const rel of ['app/layout.tsx', 'lib/palette.ts']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/hint:\s*'view'\s*}/);
      expect(src, rel).not.toMatch(/id:\s*'nav-/);
    }
    expect(read('lib/palette.ts')).not.toMatch(/href:\s*'\//);
    for (const c of EXTERNAL_COMMANDS) expect(c.href).toMatch(/^https:\/\//);
  });
});

describe('palette action commands (S09 FR-15)', () => {
  test('CommandPalette fires an action command as a window event instead of navigating', () => {
    const src = read('components/CommandPalette.tsx');
    expect(src).toMatch(/if \(command\.action\) window\.dispatchEvent\(new CustomEvent\(command\.action\)\)/);
  });
});

describe('sidebar tooltips (S09 FR-14, S12 §4.4)', () => {
  test('rail: the first item of a titled group names its group; digit chips follow DIGIT_VIEWS', () => {
    expect(navTooltip('/clients', 'rail')).toEqual({ group: 'CRM & Sales Management', label: 'Clients', digit: 5 });
    expect(navTooltip('/funnel', 'rail')).toEqual({ group: null, label: 'Funnel', digit: 6 });
    expect(navTooltip('/', 'rail')).toEqual({ group: 'Management Dashboard', label: 'Home', digit: 1 });
    expect(navTooltip('/adpilot', 'rail')?.digit).toBeNull();
    expect(navTooltip('/funnel', 'full')?.group).toBeNull();
    expect(navTooltip('/nope', 'rail')).toBeNull();
  });
});

describe('AC-01-3 Content Lab stays active on every /lab/* page', () => {
  test.each(['/lab', '/lab/radar', '/lab/breakouts', '/lab/playbook', '/lab/studio', '/lab/ledger', '/lab/creatorverse'])('%s', (p) => {
    expect(activeHref(p)).toBe('/lab');
  });
});
