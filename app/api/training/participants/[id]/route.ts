import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/participants/[id]
 * Retrieves details of a specific participant.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const participant = db.training.participants.get(params.id);
  if (!participant) {
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
  }

  const batch = db.training.batches.get(participant.batchId);
  if (batch) {
    const deptAccess = requireDepartmentAccess(user, batch.departmentId, { isDepartmentScoped: true });
    if (deptAccess instanceof NextResponse) return deptAccess;
  }

  return NextResponse.json({ participant });
}

/**
 * PATCH /api/training/participants/[id]
 * Updates participant progress, attendance, status, or notes.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const participant = db.training.participants.get(params.id);
  if (!participant) {
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
  }

  const batch = db.training.batches.get(participant.batchId);
  if (batch) {
    const deptAccess = requireDepartmentAccess(user, batch.departmentId, { isDepartmentScoped: true });
    if (deptAccess instanceof NextResponse) return deptAccess;
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid patch payload' }, { status: 400 });
  }

  const updated = db.training.participants.update(params.id, body);
  return NextResponse.json({ participant: updated });
}

/**
 * DELETE /api/training/participants/[id]
 * Removes participant enrollment.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const participant = db.training.participants.get(params.id);
  if (!participant) {
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
  }

  const batch = db.training.batches.get(participant.batchId);
  if (batch) {
    const deptAccess = requireDepartmentAccess(user, batch.departmentId, { isDepartmentScoped: true });
    if (deptAccess instanceof NextResponse) return deptAccess;
  }

  const ok = db.training.participants.delete(params.id);
  return NextResponse.json({ deleted: ok, id: params.id });
}

