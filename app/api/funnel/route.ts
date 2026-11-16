import { requirePermission } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { funnelSummary, splitFunnelJourneys } from '@/lib/funnel';
import { attioFunnelJourneys } from '@/lib/funnel-live';
import { ghlFunnelJourneys } from '@/lib/funnel-ghl';
import { mergeTrakyoTouches, trakyoTouches } from '@/lib/funnel-trakyo';
import { FunnelContactSchema, FunnelVentureSchema, type FunnelVenture } from '@/lib/schemas';
import { getVenture } from '@/lib/ventures-store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requirePermission(req, 'funnel:view', { resourceDepartmentId: 'dept-sales', isDepartmentScoped: true });
  if (auth instanceof NextResponse) return auth;
  const raw = new URL(req.url).searchParams.get('venture');
  let venture: FunnelVenture | undefined;
  if (raw !== null) {
    const parsed = FunnelVentureSchema.safeParse(raw);
    if (!parsed.success || (parsed.data !== 'default' && !getVenture(parsed.data))) {
      return NextResponse.json({ error: `unknown venture: ${raw}` }, { status: 400 });
    }
    venture = parsed.data;
  }
  const now = new Date();
  // Live Attio ∪ GHL when available (Attio venture = deal-name heuristic,
  // GHL is all LC); seeded funnel otherwise. Quiet >90d splits into `archived`.
  const [attioLive, ghlLive] = await Promise.all([attioFunnelJourneys(now), ghlFunnelJourneys(now)]);
  const liveJourneys = [...(attioLive?.journeys ?? []), ...(ghlLive?.journeys ?? [])];
  const isLive = liveJourneys.length > 0;
  const all = isLive
    ? mergeTrakyoTouches(liveJourneys, await trakyoTouches()).filter((j) => !venture || j.venture === venture)
    : getDb().funnel.journeys(venture);
  const { active, archived } = splitFunnelJourneys(all, now);
  return NextResponse.json({
    summary: funnelSummary(active),
    journeys: active,
    archived,
    source: isLive
      ? [attioLive?.journeys.length ? 'attio' : null, ghlLive?.journeys.length ? 'ghl' : null]
          .filter(Boolean)
          .join('+')
      : 'seed',
    ...(isLive
      ? {
          excluded: (attioLive?.closedLost ?? 0) + (ghlLive?.excluded ?? 0),
          total: (attioLive?.total ?? 0) + (ghlLive?.total ?? 0),
        }
      : {}),
  });
}

/**
 * POST /api/funnel
 * Creates a new lead / CRM contact.
 * Assigned to 'dept-sales' by default with RBAC department validation.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const targetDept = body.departmentId || 'dept-sales';
  const auth = requirePermission(req, 'funnel:create', { resourceDepartmentId: targetDept, isDepartmentScoped: true });
  if (auth instanceof NextResponse) return auth;

  const id = body.id || `c-${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();

  const contactData = {
    id,
    name: body.name,
    venture: body.venture || 'default',
    status: body.status || 'first_touch',
    product: body.product ?? null,
    amountUsd: body.amountUsd ?? null,
    relationship: body.relationship || 'warm',
    likelihood: body.likelihood ?? 50,
    url: body.url ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    person: body.person ?? null,
    company: body.company ?? null,
    role: body.role ?? null,
    linkedin: body.linkedin ?? null,
    createdAt: body.createdAt || now,
    departmentId: targetDept,
  };

  const parsed = FunnelContactSchema.safeParse(contactData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  db.funnel.insertContact(parsed.data);

  // If initial touch supplied, record it
  if (body.touch && typeof body.touch === 'object') {
    const today = now.slice(0, 10);
    db.funnel.insertTouch({
      id: `t-${Math.random().toString(36).substring(2, 9)}`,
      contactId: id,
      seq: 1,
      stage: body.touch.stage || parsed.data.status,
      channel: body.touch.channel || 'organic',
      label: body.touch.label || 'Initial inbound contact',
      source: body.touch.source || 'manual',
      at: body.touch.at || today,
    });
  }

  const journey = db.funnel.getContact(id);
  return NextResponse.json({ contact: parsed.data, journey }, { status: 201 });
}

