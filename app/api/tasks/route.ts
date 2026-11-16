import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';
import {
  AgentTaskSchema,
  AgentTaskPrioritySchema,
  AgentTaskHorizonSchema,
  AgentTaskOwnerKindSchema,
  type AgentTask,
} from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks
 * Lists tasks across departments.
 * Filtered by department for manager and employee roles; universal for admin roles.
 */
export async function GET(request: Request) {
  const auth = requirePermission(request, 'tasks:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  let tasks = db.agentTasks.all();

  if (user.role !== 'admin' && user.role !== 'super_admin') {
    tasks = tasks.filter((t) => (t as any).departmentId === user.departmentId);
  }

  return NextResponse.json({ tasks });
}

/**
 * POST /api/tasks
 * Creates a new task.
 * Department-scoped for non-administrators.
 */
export async function POST(request: Request) {
  const auth = requirePermission(request, 'tasks:create');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const targetDept = body.departmentId || user.departmentId || 'dept-ops';
  const deptAccess = requireDepartmentAccess(user, targetDept, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const now = new Date().toISOString();
  const id = body.id || `task-${Math.random().toString(36).substring(2, 9)}`;
  const ownerKind = body.ownerKind || (body.agentId ? 'agent' : 'me');

  const taskData: any = {
    id,
    agentId: body.agentId ?? null,
    title: body.title,
    status: body.status || 'open',
    createdAt: now,
    updatedAt: now,
    detail: body.detail || '',
    dueAt: body.dueAt ?? null,
    priority: body.priority || 'normal',
    ownerKind,
    horizon: body.horizon ?? null,
    runId: body.runId ?? null,
    departmentId: targetDept,
  };

  const parsed = AgentTaskSchema.safeParse(taskData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  db.agentTasks.insert(parsed.data as any);
  const created = db.agentTasks.get(id);

  return NextResponse.json({ task: created }, { status: 201 });
}

