import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';
import { PersonSchema, type Person } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/people
 * Lists employee records from the personnel directory.
 * Filtered by department for manager and employee roles; universal for admins.
 */
export async function GET(request: Request) {
  const auth = requirePermission(request, 'hr:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  let allPeople = db.people.all();

  // If user is department-scoped (manager or employee), restrict to their department
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    allPeople = allPeople.filter((p) => p.departmentId === user.departmentId);
  }

  return NextResponse.json({ people: allPeople });
}

/**
 * POST /api/people
 * Creates an employee record in the human personnel directory.
 * Enforces department boundary for non-admin managers.
 */
export async function POST(request: Request) {
  const auth = requirePermission(request, 'hr:create');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const body = await request.json().catch(() => null);
  const parsed = PersonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const person: Person = parsed.data;

  // Department access check
  const deptAccess = requireDepartmentAccess(user, person.departmentId, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const db = getDb();
  db.people.insert(person);

  return NextResponse.json({ person }, { status: 201 });
}

