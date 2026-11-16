import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/[id]
 * Retrieves an individual task with department isolation check.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'tasks:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const task = db.agentTasks.get(params.id);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, (task as any).departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  return NextResponse.json({ task });
}

/**
 * PATCH /api/tasks/[id]
 * Updates task fields (status, priority, due date, details, department).
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'tasks:edit');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const task = db.agentTasks.get(params.id);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, (task as any).departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid patch payload' }, { status: 400 });
  }

  if (body.departmentId && body.departmentId !== (task as any).departmentId) {
    const targetDeptAccess = requireDepartmentAccess(user, body.departmentId, { isDepartmentScoped: true });
    if (targetDeptAccess instanceof NextResponse) return targetDeptAccess;
  }

  const now = new Date().toISOString();
  if (body.status) {
    db.agentTasks.setStatus(params.id, body.status, now);
  }

  db.agentTasks.update(params.id, body, now);
  const updated = db.agentTasks.get(params.id);

  return NextResponse.json({ task: updated });
}

/**
 * DELETE /api/tasks/[id]
 * Deletes a task with department isolation check.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(request, 'tasks:delete');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const task = db.agentTasks.get(params.id);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const deptAccess = requireDepartmentAccess(user, (task as any).departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  db.agentTasks.remove(params.id);
  return NextResponse.json({ deleted: true, id: params.id });
}

