/**
 * The product name and mark this deployment shows. One codebase ships as two
 * products: the operator's own instance (GLADOS_BRAND=glados) and the
 * invite-only client build, which is the default so a fresh clone needs no
 * setting. next.config.mjs inlines GLADOS_BRAND at build, so this reads the
 * same on the server and in the browser.
 */
export type Brand = {
  id: 'glados' | 'founderos' | 'hazzino';
  name: string;
  title: string;
  org: string;
  mark: string;
};

const BRANDS: Record<Brand['id'], Brand> = {
  glados: { id: 'glados', name: 'GladOS', title: 'GLADOS', org: 'GladOS', mark: '/brand/glados-mark.png' },
  founderos: { id: 'founderos', name: 'FounderOS', title: 'FOUNDEROS', org: 'FounderOS', mark: '/brand/founderos-mark.png' },
  hazzino: { id: 'hazzino', name: 'Hazzino BOS', title: 'HAZZINO BOS', org: 'Hazzino Technologies', mark: '/brand/hazzino-mark.png' },
};

export function brandFor(raw: string | undefined): Brand {
  const norm = raw?.trim().toLowerCase();
  if (norm === 'glados') return BRANDS.glados;
  if (norm === 'founderos') return BRANDS.founderos;
  return BRANDS.hazzino;
}

export const BRAND: Brand = brandFor(process.env.GLADOS_BRAND);
