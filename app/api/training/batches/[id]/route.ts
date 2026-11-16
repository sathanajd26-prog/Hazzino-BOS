import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/batches/[id]
 * Retrieves batch details and enrolled participants.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const batch = db.training.batches.get(params.id);
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, batch.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const participants = db.training.participants.all(params.id);
  return NextResponse.json({ batch, participants });
}

/**
 * PATCH /api/training/batches/[id]
 * Updates batch dates, status, or details.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const batch = db.training.batches.get(params.id);
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, batch.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid patch payload' }, { status: 400 });
  }

  if (body.departmentId && body.departmentId !== batch.departmentId) {
    const targetDeptAccess = requireDepartmentAccess(user, body.departmentId, { isDepartmentScoped: true });
    if (targetDeptAccess instanceof NextResponse) return targetDeptAccess;
  }

  const updated = db.training.batches.update(params.id, body);
  return NextResponse.json({ batch: updated });
}

/**
 * DELETE /api/training/batches/[id]
 * Deletes a batch.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:manage');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const batch = db.training.batches.get(params.id);
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, batch.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const ok = db.training.batches.delete(params.id);
  return NextResponse.json({ deleted: ok, id: params.id });
}

