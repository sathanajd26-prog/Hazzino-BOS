import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { readSkillMarkdown } from '@/lib/skills-catalog';

export const dynamic = 'force-dynamic';

/** The full SKILL.md for one real skill, loaded on demand by the reader. */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const auth = requireAuth(_req);
  if (auth instanceof NextResponse) return auth;
  const markdown = readSkillMarkdown(params.slug);
  if (markdown === null) return NextResponse.json({ error: 'skill not found' }, { status: 404 });
  return NextResponse.json({ markdown });
}
