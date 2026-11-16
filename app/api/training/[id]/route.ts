import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/[id]
 * Retrieves course details with its associated batches.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const course = db.training.courses.get(params.id);
  if (!course) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, course.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const batches = db.training.batches.byCourse(params.id);
  return NextResponse.json({ course, batches });
}

/**
 * PATCH /api/training/[id]
 * Updates course details with department access check.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const course = db.training.courses.get(params.id);
  if (!course) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, course.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid patch payload' }, { status: 400 });
  }

  if (body.departmentId && body.departmentId !== course.departmentId) {
    const targetDeptAccess = requireDepartmentAccess(user, body.departmentId, { isDepartmentScoped: true });
    if (targetDeptAccess instanceof NextResponse) return targetDeptAccess;
  }

  const updated = db.training.courses.update(params.id, body);
  return NextResponse.json({ course: updated });
}

/**
 * DELETE /api/training/[id]
 * Deletes a course.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'training:manage');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const course = db.training.courses.get(params.id);
  if (!course) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, course.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const ok = db.training.courses.delete(params.id);
  return NextResponse.json({ deleted: ok, id: params.id });
}

