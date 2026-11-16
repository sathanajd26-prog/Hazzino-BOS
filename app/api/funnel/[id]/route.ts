import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/funnel/[id]
 * Retrieves a single lead journey with department access check.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(req, 'funnel:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const journey = db.funnel.getContact(params.id);
  if (!journey) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, journey.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  return NextResponse.json({ journey });
}

/**
 * PATCH /api/funnel/[id]
 * Updates lead status, stage, likelihood, or contact info.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(req, 'funnel:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const current = db.funnel.getContact(params.id);
  if (!current) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, current.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid patch payload' }, { status: 400 });
  }

  if (body.departmentId && body.departmentId !== current.departmentId) {
    const targetDeptAccess = requireDepartmentAccess(user, body.departmentId, { isDepartmentScoped: true });
    if (targetDeptAccess instanceof NextResponse) return targetDeptAccess;
  }

  const updated = db.funnel.updateContact(params.id, body);
  return NextResponse.json({ journey: updated });
}

/**
 * DELETE /api/funnel/[id]
 * Deletes a lead and its journey touches.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(req, 'funnel:manage');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const current = db.funnel.getContact(params.id);
  if (!current) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, current.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const ok = db.funnel.deleteContact(params.id);
  return NextResponse.json({ deleted: ok, id: params.id });
}

