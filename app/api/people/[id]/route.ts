import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';
import { PersonSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/people/[id]
 * Retrieves an individual employee record with department isolation check.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'hr:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const person = db.people.get(params.id);
  if (!person) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, person.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  return NextResponse.json({ person });
}

/**
 * PATCH /api/people/[id]
 * Updates an employee record. Enforces department access on current and target departments.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'hr:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const current = db.people.get(params.id);
  if (!current) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, current.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
  }

  // If changing department, check permission on target department too
  if (body.departmentId && body.departmentId !== current.departmentId) {
    const targetDeptAccess = requireDepartmentAccess(user, body.departmentId, { isDepartmentScoped: true });
    if (targetDeptAccess instanceof NextResponse) return targetDeptAccess;
  }

  const updated = db.people.update(params.id, body);
  return NextResponse.json({ person: updated });
}

/**
 * DELETE /api/people/[id]
 * Removes an employee record from the personnel directory.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'hr:delete');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const current = db.people.get(params.id);
  if (!current) {
    return NextResponse.json({ error: 'Person not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, current.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const ok = db.people.delete(params.id);
  return NextResponse.json({ deleted: ok, id: params.id });
}

