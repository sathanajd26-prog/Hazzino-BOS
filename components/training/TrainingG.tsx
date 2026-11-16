'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  GButton,
  GCard,
  GDialog,
  GEmpty,
  GInput,
  GPage,
  GSectionHeader,
  GSkeleton,
  GTag,
} from '@/components/g';
import { Can } from '@/components/auth/Can';
import { useAuth } from '@/lib/auth/context';
import type { TrainingCourse, TrainingBatch, TrainingParticipant } from '@/lib/schemas';
import {
  BookOpen,
  Calendar,
  Users,
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  Award,
} from 'lucide-react';

interface TrainingStats {
  totalCourses: number;
  activeBatches: number;
  totalStudents: number;
  averageProgress: number;
  averageAttendance: number;
}

export function TrainingG() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [batches, setBatches] = useState<TrainingBatch[]>([]);
  const [participants, setParticipants] = useState<TrainingParticipant[]>([]);
  const [stats, setStats] = useState<TrainingStats>({
    totalCourses: 0,
    activeBatches: 0,
    totalStudents: 0,
    averageProgress: 0,
    averageAttendance: 100,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'courses' | 'batches' | 'participants'>('courses');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showCreateCourse, setShowCreateCourse] = useState(false);
  const [showCreateBatch, setShowCreateBatch] = useState(false);
  const [showEnrollStudent, setShowEnrollStudent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [courseForm, setCourseForm] = useState({
    title: '',
    description: '',
    durationWeeks: 4,
    departmentId: user?.departmentId || 'dept-ops',
  });

  const [batchForm, setBatchForm] = useState({
    courseId: '',
    name: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    status: 'upcoming' as const,
    departmentId: user?.departmentId || 'dept-ops',
  });

  const [participantForm, setParticipantForm] = useState({
    batchId: '',
    name: '',
    email: '',
    role: 'student' as const,
    notes: '',
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, pRes] = await Promise.all([
        fetch('/api/training'),
        fetch('/api/training/participants'),
      ]);

      if (!tRes.ok) throw new Error(`Training error ${tRes.status}`);
      const tData = await tRes.json();
      setCourses(tData.courses || []);
      setBatches(tData.batches || []);
      if (tData.stats) setStats(tData.stats);

      if (pRes.ok) {
        const pData = await pRes.json();
        setParticipants(pData.participants || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load training data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateCourse = async () => {
    if (!courseForm.title) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(courseForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to create course');
      }
      setShowCreateCourse(false);
      setCourseForm({ title: '', description: '', durationWeeks: 4, departmentId: user?.departmentId || 'dept-ops' });
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateBatch = async () => {
    if (!batchForm.courseId || !batchForm.name) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to create batch');
      }
      setShowCreateBatch(false);
      setBatchForm({
        courseId: '',
        name: '',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        status: 'upcoming',
        departmentId: user?.departmentId || 'dept-ops',
      });
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnrollStudent = async () => {
    if (!participantForm.batchId || !participantForm.name || !participantForm.email) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/training/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(participantForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Failed to enroll participant');
      }
      setShowEnrollStudent(false);
      setParticipantForm({ batchId: '', name: '', email: '', role: 'student', notes: '' });
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered lists
  const filteredCourses = courses.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBatches = batches.filter((b) =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredParticipants = participants.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <GPage>
      <GSectionHeader
        size="page"
        title="Training & Academy"
        caption="Workforce training, internship cohorts, and procedural academy management"
        action={
          <div className="flex items-center gap-2">
            <GButton
              variant="default"
              size="sm"
              onClick={fetchData}
              title="Refresh data"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </GButton>

            <Can do="training:create">
              {activeTab === 'courses' && (
                <GButton
                  variant="ink"
                  size="sm"
                  onClick={() => setShowCreateCourse(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Course
                </GButton>
              )}
              {activeTab === 'batches' && (
                <GButton
                  variant="ink"
                  size="sm"
                  onClick={() => setShowCreateBatch(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create Batch
                </GButton>
              )}
              {activeTab === 'participants' && (
                <GButton
                  variant="ink"
                  size="sm"
                  onClick={() => setShowEnrollStudent(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Enroll Student
                </GButton>
              )}
            </Can>
          </div>
        }
      />

      {/* Metric Tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <GCard className="p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Courses</span>
            <BookOpen className="h-3.5 w-3.5" />
          </div>
          <div className="mt-2 text-xl font-bold">{stats.totalCourses}</div>
        </GCard>

        <GCard className="p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Active Batches</span>
            <Calendar className="h-3.5 w-3.5" />
          </div>
          <div className="mt-2 text-xl font-bold text-amber-500">{stats.activeBatches}</div>
        </GCard>

        <GCard className="p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Enrolled Students</span>
            <Users className="h-3.5 w-3.5" />
          </div>
          <div className="mt-2 text-xl font-bold">{stats.totalStudents}</div>
        </GCard>

        <GCard className="p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Avg Progress</span>
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div className="mt-2 text-xl font-bold">{stats.averageProgress}%</div>
        </GCard>

        <GCard className="p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Avg Attendance</span>
            <Award className="h-3.5 w-3.5" />
          </div>
          <div className="mt-2 text-xl font-bold text-emerald-500">{stats.averageAttendance}%</div>
        </GCard>
      </div>

      {/* Navigation tabs & search */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'courses' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('courses')}
          >
            Courses ({courses.length})
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'batches' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('batches')}
          >
            Batches ({batches.length})
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'participants' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('participants')}
          >
            Participants ({participants.length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <GInput
            className="pl-8 text-xs"
            placeholder={`Search ${activeTab}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Content Section */}
      {loading ? (
        <GCard className="p-6">
          <GSkeleton className="h-8 w-48 mb-4" />
          <GSkeleton className="h-20 w-full mb-2" />
          <GSkeleton className="h-20 w-full" />
        </GCard>
      ) : error ? (
        <GCard className="p-6 text-center text-red-500">
          <p>{error}</p>
        </GCard>
      ) : activeTab === 'courses' ? (
        filteredCourses.length === 0 ? (
          <GEmpty
            title="No courses registered"
            body="Create a course curriculum for team onboarding or academy cohorts."
            action={{
              label: 'Create Course',
              onClick: () => setShowCreateCourse(true),
            }}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {filteredCourses.map((c) => (
              <GCard key={c.id} className="p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-muted-foreground">{c.slug}</span>
                    <GTag tone="neutral">{c.durationWeeks} Weeks</GTag>
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{c.title}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2">{c.description || 'No description provided.'}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>Dept: {c.departmentId}</span>
                  <span className="text-[10px]">{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
              </GCard>
            ))}
          </div>
        )
      ) : activeTab === 'batches' ? (
        filteredBatches.length === 0 ? (
          <GEmpty
            title="No training batches scheduled"
            body="Schedule training cohorts for enrolled students or interns."
            action={{
              label: 'Create Batch',
              onClick: () => setShowCreateBatch(true),
            }}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {filteredBatches.map((b) => (
              <GCard key={b.id} className="p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-muted-foreground">Course ID: {b.courseId}</span>
                    <GTag tone={b.status === 'in_progress' ? 'ok' : b.status === 'upcoming' ? 'warn' : 'neutral'}>
                      {b.status}
                    </GTag>
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{b.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {b.startDate} → {b.endDate}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>Dept: {b.departmentId}</span>
                  <span className="text-[10px]">{new Date(b.createdAt).toLocaleDateString()}</span>
                </div>
              </GCard>
            ))}
          </div>
        )
      ) : (
        filteredParticipants.length === 0 ? (
          <GEmpty
            title="No students or interns enrolled"
            body="Enroll participants into an existing training batch."
            action={{
              label: 'Enroll Participant',
              onClick: () => setShowEnrollStudent(true),
            }}
          />
        ) : (
          <GCard className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground font-medium">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Progress</th>
                    <th className="p-3">Attendance</th>
                    <th className="p-3">Enrolled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredParticipants.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="p-3 font-medium">{p.name}</td>
                      <td className="p-3 text-muted-foreground">{p.email}</td>
                      <td className="p-3">
                        <GTag tone="neutral">{p.role}</GTag>
                      </td>
                      <td className="p-3">
                        <GTag tone={p.status === 'completed' ? 'ok' : p.status === 'in_progress' ? 'warn' : 'neutral'}>
                          {p.status}
                        </GTag>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${p.progressPct}%` }} />
                          </div>
                          <span>{p.progressPct}%</span>
                        </div>
                      </td>
                      <td className="p-3 font-semibold text-emerald-500">{p.attendancePct}%</td>
                      <td className="p-3 text-muted-foreground text-[10px]">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GCard>
        )
      )}

      {/* Modal: Create Course */}
      {showCreateCourse && (
        <GDialog
          open={showCreateCourse}
          onClose={() => setShowCreateCourse(false)}
          title="Create Training Course"
          confirmLabel="Save Course"
          onConfirm={handleCreateCourse}
          busy={submitting}
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-foreground">Course Title *</label>
              <GInput
                required
                value={courseForm.title}
                onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                placeholder="e.g. AI Operations Bootcamp"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">Description</label>
              <GInput
                value={courseForm.description}
                onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                placeholder="Brief description of the curriculum"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">Duration (Weeks)</label>
                <GInput
                  type="number"
                  min={1}
                  max={52}
                  value={courseForm.durationWeeks}
                  onChange={(e) => setCourseForm({ ...courseForm, durationWeeks: parseInt(e.target.value) || 4 })}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground">Department</label>
                <GInput
                  value={courseForm.departmentId}
                  onChange={(e) => setCourseForm({ ...courseForm, departmentId: e.target.value })}
                  placeholder="e.g. dept-ops"
                />
              </div>
            </div>
          </div>
        </GDialog>
      )}

      {/* Modal: Create Batch */}
      {showCreateBatch && (
        <GDialog
          open={showCreateBatch}
          onClose={() => setShowCreateBatch(false)}
          title="Schedule Training Batch"
          confirmLabel="Schedule Batch"
          onConfirm={handleCreateBatch}
          busy={submitting}
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-foreground">Course *</label>
              <select
                className="w-full rounded border border-border bg-background p-2 text-xs"
                value={batchForm.courseId}
                onChange={(e) => setBatchForm({ ...batchForm, courseId: e.target.value })}
              >
                <option value="">Select course...</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.durationWeeks}w)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">Batch Name *</label>
              <GInput
                required
                value={batchForm.name}
                onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                placeholder="e.g. Cohort 2026-Q4"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">Start Date</label>
                <GInput
                  type="date"
                  value={batchForm.startDate}
                  onChange={(e) => setBatchForm({ ...batchForm, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">End Date</label>
                <GInput
                  type="date"
                  value={batchForm.endDate}
                  onChange={(e) => setBatchForm({ ...batchForm, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
        </GDialog>
      )}

      {/* Modal: Enroll Student */}
      {showEnrollStudent && (
        <GDialog
          open={showEnrollStudent}
          onClose={() => setShowEnrollStudent(false)}
          title="Enroll Participant"
          confirmLabel="Enroll"
          onConfirm={handleEnrollStudent}
          busy={submitting}
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-foreground">Batch *</label>
              <select
                className="w-full rounded border border-border bg-background p-2 text-xs"
                value={participantForm.batchId}
                onChange={(e) => setParticipantForm({ ...participantForm, batchId: e.target.value })}
              >
                <option value="">Select batch...</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">Participant Name *</label>
              <GInput
                required
                value={participantForm.name}
                onChange={(e) => setParticipantForm({ ...participantForm, name: e.target.value })}
                placeholder="Full Name"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">Email *</label>
              <GInput
                type="email"
                required
                value={participantForm.email}
                onChange={(e) => setParticipantForm({ ...participantForm, email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">Role</label>
              <select
                className="w-full rounded border border-border bg-background p-2 text-xs"
                value={participantForm.role}
                onChange={(e) => setParticipantForm({ ...participantForm, role: e.target.value as any })}
              >
                <option value="student">Student</option>
                <option value="intern">Intern</option>
                <option value="trainee">Trainee</option>
              </select>
            </div>
          </div>
        </GDialog>
      )}
    </GPage>
  );
}
