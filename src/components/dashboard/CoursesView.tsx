import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { Course, Lesson } from '../../types';
import { BookOpen, Plus, Edit, Check, Users } from 'lucide-react';

export const CoursesView: React.FC = () => {
  const { courses, enrollments, customers, bots, saveCourse, createCourse, saveEnrollment, createEnrollment, showToast } = useApp();

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [showNewCourseModal, setShowNewCourseModal] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);

  // New course state
  const [courseName, setCourseName] = useState('');
  const [courseLevel, setCourseLevel] = useState('בסיסי מתחילים');
  const [courseBotId, setCourseBotId] = useState('maya-child');

  // Enrollment modal state
  const [enrollCustomerId, setEnrollCustomerId] = useState(customers[0]?.id || '');
  const [enrollCourseId, setEnrollCourseId] = useState(courses[0]?.id || '');
  const [enrollLessonNumber, setEnrollLessonNumber] = useState(1);

  const selectedCourse = courses.find(c => c.id === selectedCourseId);

  const handleCreateCourse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseName.trim()) return;

    createCourse({
      name: courseName,
      level: courseLevel,
      bot_id: courseBotId,
      lessons: [
        { title: 'שיעור 1: היכרות וברכות', goal: 'רכישת ביטחון ראשוני', instructions: 'למד לומר שלום ולהציג את השם', passing_score: 3 }
      ]
    });

    setShowNewCourseModal(false);
    setCourseName('');
  };

  const handleCreateEnrollment = (e: React.FormEvent) => {
    e.preventDefault();
    createEnrollment(enrollCustomerId, enrollCourseId, Math.max(0, enrollLessonNumber - 1));
    setShowEnrollModal(false);
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">מרכז הניהול / מסלולי לימוד</span>
          <h1 className="text-2xl font-black text-[#172b35] flex items-center gap-2">
            <span>מסלולי לימוד והתקדמות תלמידים</span>
          </h1>
          <p className="text-xs text-[#718087] mt-1">
            שיעורים מסודרים, מטרות והנחיות שמצטרפות לפרומפט של המורה בשיחה הטלפונית.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEnrollModal(true)}
            className="bg-white border border-[#e3e8eb] hover:bg-[#fafbfc] text-[#172b35] px-4 py-2 rounded-xl text-xs font-bold transition"
          >
            שיוך תלמיד למסלול
          </button>
          <button
            onClick={() => setShowNewCourseModal(true)}
            className="bg-[#137c69] hover:bg-[#0f6656] text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>מסלול חדש</span>
          </button>
        </div>
      </div>

      {/* Courses Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {courses.map(course => {
          const teacher = bots.find(b => b.id === course.bot_id);
          return (
            <div key={course.id} className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-xs bg-[#e9f5f0] text-[#137c69] px-2.5 py-1 rounded-md font-bold">
                    {course.level}
                  </span>
                  <span className="text-xs text-[#718087]">מורה: {teacher?.label || 'ללא מורה'}</span>
                </div>
                <h3 className="text-lg font-black text-[#172b35] mb-2">{course.name}</h3>
                <p className="text-xs text-[#718087] mb-4">
                  כולל {course.lessons.length} שיעורים מובנים עם יעדים והנחיות למורה.
                </p>

                {/* Lessons list */}
                <div className="space-y-2 mb-4">
                  {course.lessons.map((lesson, idx) => (
                    <div key={idx} className="p-2.5 bg-[#fafbfc] border border-[#f0f3f4] rounded-xl text-xs flex items-center justify-between">
                      <span className="font-semibold text-[#172b35]">{idx + 1}. {lesson.title}</span>
                      <span className="text-[11px] text-[#718087]">ציון יעד: {lesson.passing_score}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-[#f0f3f4] flex justify-end">
                <button
                  onClick={() => showToast(`עריכת המסלול "${course.name}" נשמרה.`)}
                  className="bg-[#fafbfc] border border-[#e3e8eb] hover:bg-white text-[#172b35] px-4 py-1.5 rounded-xl text-xs font-bold transition"
                >
                  עריכת המסלול
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Student Enrollments Table */}
      <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-xs">
        <h3 className="font-bold text-base text-[#172b35] mb-4">רישום תלמידים והתקדמות נוכחית</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-[#f5f6f8] text-[#718087] border-b border-[#e3e8eb]">
                <th className="py-3 px-4 font-bold">תלמיד</th>
                <th className="py-3 px-4 font-bold">מסלול</th>
                <th className="py-3 px-4 font-bold">שיעור נוכחי</th>
                <th className="py-3 px-4 font-bold">מצב למידה</th>
                <th className="py-3 px-4 font-bold">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f3f4]">
              {enrollments.map(enr => {
                const cust = customers.find(c => c.id === enr.customer_id);
                const course = courses.find(c => c.id === enr.course_id);
                return (
                  <tr key={enr.id} className="hover:bg-[#fafbfc]">
                    <td className="py-3 px-4 font-bold text-[#172b35]">{cust?.name || enr.customer_id}</td>
                    <td className="py-3 px-4 text-[#718087]">{course?.name || enr.course_id}</td>
                    <td className="py-3 px-4 font-bold text-[#137c69]">שיעור {enr.lesson_index + 1}</td>
                    <td className="py-3 px-4">
                      <span className="bg-[#e9f5f0] text-[#137c69] px-2 py-0.5 rounded text-[11px] font-bold">
                        {enr.status === 'active' ? 'בלמידה פעילה' : enr.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => {
                          const next = enr.lesson_index + 1;
                          saveEnrollment({ ...enr, lesson_index: next });
                        }}
                        className="bg-[#fafbfc] border border-[#e3e8eb] hover:bg-[#e9f5f0] text-[#172b35] px-3 py-1 rounded-lg text-xs font-semibold transition"
                      >
                        קדם לשיעור הבא ←
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Course Modal */}
      {showNewCourseModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-4">יצירת מסלול לימוד חדש</h3>
            <form onSubmit={handleCreateCourse} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">שם המסלול:</label>
                <input
                  type="text"
                  required
                  value={courseName}
                  onChange={e => setCourseName(e.target.value)}
                  placeholder="למשל: אנגלית לעבודה ומצגות"
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">רמה:</label>
                <select
                  value={courseLevel}
                  onChange={e => setCourseLevel(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  <option value="בסיסי מתחילים">בסיסי מתחילים</option>
                  <option value="בינוני">בינוני</option>
                  <option value="מתקדמים ועסקים">מתקדמים ועסקים</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">מורה מוביל:</label>
                <select
                  value={courseBotId}
                  onChange={e => setCourseBotId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  {bots.filter(b => b.role === 'teacher').map(b => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCourseModal(false)}
                  className="px-4 py-2 rounded-xl font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  צור מסלול
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enroll Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#e3e8eb] shadow-xl max-w-md w-full p-6 text-right" dir="rtl">
            <h3 className="font-bold text-lg text-[#172b35] mb-4">שיוך תלמיד למסלול לימוד</h3>
            <form onSubmit={handleCreateEnrollment} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[#718087] block mb-1">בחר תלמיד:</label>
                <select
                  value={enrollCustomerId}
                  onChange={e => setEnrollCustomerId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">בחר מסלול:</label>
                <select
                  value={enrollCourseId}
                  onChange={e => setEnrollCourseId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                >
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-[#718087] block mb-1">השיעור שבו מתחילים:</label>
                <input
                  type="number"
                  min={1}
                  value={enrollLessonNumber}
                  onChange={e => setEnrollLessonNumber(Number(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-[#e3e8eb]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEnrollModal(false)}
                  className="px-4 py-2 rounded-xl font-semibold text-[#718087]"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="bg-[#137c69] text-white px-5 py-2 rounded-xl font-bold shadow-sm"
                >
                  שייך תלמיד
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
