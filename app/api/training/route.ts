import { NextResponse } from 'next/server';
import { requirePermission, requireDepartmentAccess } from '@/lib/auth/guard';
import { getDb } from '@/lib/data';
import {
  TrainingCourseSchema,
  TrainingBatchSchema,
  type TrainingCourse,
  type TrainingBatch,
} from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training
 * Lists courses, batches, and aggregated training metrics.
 * Filtered by department for manager and employee roles; universal for admin roles.
 */
export async function GET(request: Request) {
  const auth = requirePermission(request, 'training:view');
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const db = getDb();
  const deptFilter = (user.role !== 'admin' && user.role !== 'super_admin') ? user.departmentId ?? undefined : undefined;

  const courses = db.training.courses.all(deptFilter);
  const batches = db.training.batches.all(deptFilter);
  const participants = db.training.participants.all();

  const totalCourses = courses.length;
  const activeBatches = batches.filter((b) => b.status === 'in_progress').length;
  const totalStudents = participants.length;
  const avgProgress = totalStudents > 0
    ? Math.round(participants.reduce((acc, p) => acc + p.progressPct, 0) / totalStudents)
    : 0;
  const avgAttendance = totalStudents > 0
    ? Math.round(participants.reduce((acc, p) => acc + p.attendancePct, 0) / totalStudents)
    : 100;

  return NextResponse.json({
    courses,
    batches,
    stats: {
      totalCourses,
      activeBatches,
      totalStudents,
      averageProgress: avgProgress,
      averageAttendance: avgAttendance,
    },
  });
}

/**
 * POST /api/training
 * Creates a course or batch with department access check.
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
  const now = new Date().toISOString();

  // If courseId is provided, creating a batch
  if (body.courseId || body.kind === 'batch') {
    const targetDept = body.departmentId || user.departmentId || 'dept-ops';
    const deptAccess = requireDepartmentAccess(user, targetDept, { isDepartmentScoped: true });
    if (deptAccess instanceof NextResponse) return deptAccess;

    const id = body.id || `batch-${Math.random().toString(36).substring(2, 9)}`;
    const batchData = {
      id,
      courseId: body.courseId,
      name: body.name,
      startDate: body.startDate,
      endDate: body.endDate,
      status: body.status || 'upcoming',
      departmentId: targetDept,
      createdAt: now,
    };

    const parsed = TrainingBatchSchema.safeParse(batchData);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    db.training.batches.insert(parsed.data);
    return NextResponse.json({ batch: parsed.data }, { status: 201 });
  }

  // Otherwise creating a course
  const targetDept = body.departmentId || user.departmentId || 'dept-ops';
  const deptAccess = requireDepartmentAccess(user, targetDept, { isDepartmentScoped: true });
  if (deptAccess instanceof NextResponse) return deptAccess;

  const id = body.id || `course-${Math.random().toString(36).substring(2, 9)}`;
  const slug = body.slug || body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const courseData = {
    id,
    title: body.title,
    slug,
    description: body.description || '',
    durationWeeks: body.durationWeeks || 4,
    departmentId: targetDept,
    createdAt: now,
  };

  const parsed = TrainingCourseSchema.safeParse(courseData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  db.training.courses.insert(parsed.data);
  return NextResponse.json({ course: parsed.data }, { status: 201 });
}

