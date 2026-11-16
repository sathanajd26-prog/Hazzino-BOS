import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';
import { FunnelTouchSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/funnel/[id]/touch
 * Records a follow-up interaction or journey touch for a lead.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(req, 'funnel:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const contact = db.funnel.getContact(params.id);
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, contact.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const touchId = body.id || `t-${Math.random().toString(36).substring(2, 9)}`;
  const nextSeq = (contact.touches?.length || 0) + 1;

  const touchData = {
    id: touchId,
    contactId: params.id,
    seq: nextSeq,
    stage: body.stage || contact.status,
    channel: body.channel || 'call',
    label: body.label || 'Follow-up interaction',
    source: body.source || 'manual',
    at: body.at || today,
  };

  const parsed = FunnelTouchSchema.safeParse(touchData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  db.funnel.insertTouch(parsed.data);
  const updated = db.funnel.getContact(params.id);

  return NextResponse.json({ touch: parsed.data, journey: updated }, { status: 201 });
}

