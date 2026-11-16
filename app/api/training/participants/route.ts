import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';
import { TrainingParticipantSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/participants
 * Lists training participants, optionally filtered by ?batchId=.
 */
export async function GET(request: Request) {
  const auth = requirePermission(request, 'training:view');
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const batchId = url.searchParams.get('batchId') || undefined;

  const db = getDb();
  const participants = db.training.participants.all(batchId);

  return NextResponse.json({ participants });
}

/**
 * POST /api/training/participants
 * Enrolls a student, intern, or trainee into a batch.
 */
export async function POST(request: Request) {
  const auth = requirePermission(request, 'training:create');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const db = getDb();
  const batch = db.training.batches.get(body.batchId);
  if (!batch) {
    return NextResponse.json({ error: 'Target batch does not exist' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, batch.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const now = new Date().toISOString();
  const id = body.id || `tp-${Math.random().toString(36).substring(2, 9)}`;

  const participantData = {
    id,
    batchId: body.batchId,
    name: body.name,
    email: body.email,
    role: body.role || 'student',
    status: body.status || 'enrolled',
    progressPct: body.progressPct ?? 0,
    attendancePct: body.attendancePct ?? 100,
    notes: body.notes || '',
    createdAt: now,
  };

  const parsed = TrainingParticipantSchema.safeParse(participantData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  db.training.participants.insert(parsed.data);
  return NextResponse.json({ participant: parsed.data }, { status: 201 });
}

