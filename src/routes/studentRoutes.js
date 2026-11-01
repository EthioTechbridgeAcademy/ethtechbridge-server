import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";

const router = express.Router();

// All student routes require authentication
router.use(requireAuth);

// GET /api/student/dashboard - Student Learning Hub Summary
router.get("/dashboard", async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Get student basic info
    const [userRows] = await pool.query(
      "SELECT id, full_name, email, phone, bio, avatar_url, created_at FROM users WHERE id = ?",
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ message: "User not found." });
    const user = userRows[0];

    // 2. Aggregate enrollment statistics
    const [enrollments] = await pool.query(
      `SELECT e.id, e.course_id, e.status, e.progress_percent, e.last_accessed_lesson_id,
              e.enrolled_at, e.completed_at,
              c.title as course_title, c.slug as course_slug, c.thumbnail_url, c.difficulty,
              c.duration_hours,
              (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as total_lessons,
              (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.user_id = e.user_id AND lp.course_id = e.course_id AND lp.is_completed = 1) as completed_lessons,
              (SELECT title FROM lessons WHERE id = e.last_accessed_lesson_id) as last_lesson_title,
              (SELECT slug FROM lessons WHERE id = e.last_accessed_lesson_id) as last_lesson_slug
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ?
       ORDER BY e.updated_at DESC`,
      [userId]
    );

    const enrolledCount = enrollments.length;
    const inProgressCount = enrollments.filter(e => e.progress_percent > 0 && e.status !== "completed").length;
    const completedCount = enrollments.filter(e => e.status === "completed" || e.progress_percent === 100).length;
    
    const overallProgressPercent = enrolledCount > 0
      ? Math.round(enrollments.reduce((sum, e) => sum + e.progress_percent, 0) / enrolledCount)
      : 0;

    // Determine Continue Learning course (first active course)
    const activeEnrollment = enrollments.find(e => e.status === "active") || enrollments[0] || null;

    // 3. Get certificates
    const [certificates] = await pool.query(
      "SELECT id, certificate_code, course_title, issued_at FROM certificates WHERE user_id = ? ORDER BY issued_at DESC",
      [userId]
    );

    // 4. Recommended courses (published courses user has not enrolled in yet)
    const [recommended] = await pool.query(
      `SELECT id, slug, title, short_description, thumbnail_url, difficulty, duration_hours, is_free, price
       FROM courses
       WHERE is_published = 1 AND id NOT IN (SELECT course_id FROM enrollments WHERE user_id = ?)
       LIMIT 3`,
      [userId]
    );

    // 5. Upcoming Online Class Schedules (Microsoft Teams)
    const [studentRecords] = await pool.query(
      "SELECT id FROM students WHERE user_id = ? OR email = ?",
      [userId, user.email]
    );
    const studentId = studentRecords.length ? studentRecords[0].id : null;
    const enrolledCourseIds = enrollments.map((e) => e.course_id);

    let upcomingSchedules = [];
    if (studentId || enrolledCourseIds.length > 0) {
      const conditions = [];
      const params = [];
      if (studentId) {
        conditions.push("cs.student_id = ?");
        params.push(studentId);
      }
      if (enrolledCourseIds.length > 0) {
        conditions.push(`cs.course_id IN (${enrolledCourseIds.map(() => "?").join(",")})`);
        params.push(...enrolledCourseIds);
      }
      const [schedRows] = await pool.query(
        `SELECT cs.id, cs.course_id, cs.student_id, cs.subject_name,
                cs.class_date, cs.start_time, cs.end_time, cs.timezone,
                cs.teacher_name, cs.instructor_id, cs.meeting_url,
                cs.instructions, cs.status,
                c.title as course_title, c.slug as course_slug,
                u.full_name as instructor_full_name
         FROM class_schedules cs
         LEFT JOIN courses c ON c.id = cs.course_id
         LEFT JOIN users u ON u.id = cs.instructor_id
         WHERE (${conditions.join(" OR ")}) AND cs.status != 'cancelled'
         ORDER BY cs.class_date ASC, cs.start_time ASC
         LIMIT 4`,
        params
      );
      upcomingSchedules = schedRows;
    }

    // 6. Check student's admission application status
    const [appRows] = await pool.query(
      `SELECT id, application_number, program_interest, grade_level, status, admin_notes, created_at, reviewed_at
       FROM applications
       WHERE user_id = ? OR converted_user_id = ? OR (email IS NOT NULL AND email = ?)
       ORDER BY created_at DESC LIMIT 1`,
      [userId, userId, user.email]
    );

    const admission = appRows.length > 0 ? {
      hasApplication: true,
      id: appRows[0].id,
      applicationNumber: appRows[0].application_number,
      programInterest: appRows[0].program_interest,
      gradeLevel: appRows[0].grade_level,
      status: appRows[0].status,
      adminNotes: appRows[0].admin_notes,
      createdAt: appRows[0].created_at,
      reviewedAt: appRows[0].reviewed_at
    } : {
      hasApplication: false,
      status: "none"
    };

    res.json({
      student: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        phone: user.phone,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        joinedAt: user.created_at
      },
      admission,
      stats: {
        enrolledCount,
        inProgressCount,
        completedCount,
        overallProgressPercent,
        certificatesCount: certificates.length
      },
      continueLearning: activeEnrollment,
      recentCourses: enrollments.slice(0, 6),
      certificates,
      recommendedCourses: recommended,
      upcomingSchedules
    });
  } catch (error) {
    console.error("Student dashboard error:", error.message);
    res.status(500).json({ message: "Unable to load dashboard." });
  }
});

// GET /api/student/courses - My Courses list
router.get("/courses", async (req, res) => {
  const userId = req.user.id;

  try {
    const [courses] = await pool.query(
      `SELECT e.id as enrollment_id, e.status, e.progress_percent, e.last_accessed_lesson_id,
              e.enrolled_at, e.completed_at,
              c.id as course_id, c.title, c.slug, c.short_description, c.thumbnail_url,
              c.difficulty, c.duration_hours, cat.name as category_name,
              (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as total_lessons,
              (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.user_id = e.user_id AND lp.course_id = e.course_id AND lp.is_completed = 1) as completed_lessons,
              cert.certificate_code
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN certificates cert ON cert.course_id = c.id AND cert.user_id = e.user_id
       WHERE e.user_id = ?
       ORDER BY e.updated_at DESC`,
      [userId]
    );

    res.json({ courses });
  } catch (error) {
    console.error("Student courses error:", error.message);
    res.status(500).json({ message: "Unable to load enrolled courses." });
  }
});

// GET /api/student/courses/:courseSlug/learn - Course Learning Environment
router.get("/courses/:courseSlug/learn", async (req, res) => {
  const { courseSlug } = req.params;
  const userId = req.user.id;

  try {
    // 1. Verify course exists
    const [courseRows] = await pool.query(
      "SELECT id, title, slug, thumbnail_url, is_published FROM courses WHERE slug = ? OR id = ? LIMIT 1",
      [courseSlug, isNaN(courseSlug) ? 0 : Number(courseSlug)]
    );

    if (courseRows.length === 0) {
      return res.status(404).json({ message: "Course not found." });
    }
    const course = courseRows[0];

    // 2. Verify user is enrolled (or is admin)
    const [enrollmentRows] = await pool.query(
      "SELECT id, status, progress_percent, last_accessed_lesson_id, enrolled_at, completed_at FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1",
      [userId, course.id]
    );

    if (enrollmentRows.length === 0 && req.user.role !== "admin") {
      return res.status(403).json({
        message: "You must be enrolled in this course to access the classroom.",
        courseSlug: course.slug
      });
    }

    const enrollment = enrollmentRows[0] || { id: 0, status: "admin_preview", progress_percent: 0 };

    // 3. Fetch modules
    const [modules] = await pool.query(
      "SELECT id, title, description, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC",
      [course.id]
    );

    // 4. Fetch all lessons with content
    const [lessons] = await pool.query(
      `SELECT id, module_id, title, slug, content_type, content_text, video_url,
              duration_minutes, is_preview, sort_order, resources_json
       FROM lessons
       WHERE course_id = ?
       ORDER BY sort_order ASC`,
      [course.id]
    );

    // 5. Fetch lesson progress for this user
    const [progressRows] = await pool.query(
      "SELECT lesson_id, is_completed, completed_at FROM lesson_progress WHERE user_id = ? AND course_id = ?",
      [userId, course.id]
    );

    const completedLessonIds = new Set(progressRows.filter(p => p.is_completed).map(p => p.lesson_id));

    // Combine into structure
    const lessonsWithProgress = lessons.map(lesson => ({
      ...lesson,
      is_completed: completedLessonIds.has(lesson.id)
    }));

    const modulesWithLessons = modules.map(m => ({
      ...m,
      lessons: lessonsWithProgress.filter(l => l.module_id === m.id)
    }));

    const unassigned = lessonsWithProgress.filter(l => !l.module_id);
    if (unassigned.length > 0) {
      modulesWithLessons.unshift({
        id: 0,
        title: "Course Lessons",
        description: "",
        sort_order: 0,
        lessons: unassigned
      });
    }

    // 6. Fetch quiz metadata
    const [quizzes] = await pool.query(
      `SELECT q.id, q.title, q.description, q.passing_score, q.time_limit_minutes,
              (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) as question_count,
              (SELECT passed FROM quiz_attempts WHERE user_id = ? AND quiz_id = q.id ORDER BY score DESC LIMIT 1) as best_passed,
              (SELECT MAX(score) FROM quiz_attempts WHERE user_id = ? AND quiz_id = q.id) as best_score
       FROM quizzes q
       WHERE q.course_id = ?`,
      [userId, userId, course.id]
    );

    // 7. Check if certificate exists
    const [certRows] = await pool.query(
      "SELECT certificate_code, issued_at FROM certificates WHERE user_id = ? AND course_id = ? LIMIT 1",
      [userId, course.id]
    );

    res.json({
      course,
      enrollment,
      curriculum: modulesWithLessons,
      lessons: lessonsWithProgress,
      quizzes,
      certificate: certRows[0] || null
    });
  } catch (error) {
    console.error("Learn room error:", error.message);
    res.status(500).json({ message: "Unable to load classroom." });
  }
});

// POST /api/student/lessons/:lessonId/progress - Mark Lesson Complete / Incomplete
router.post("/lessons/:lessonId/progress", async (req, res) => {
  const lessonId = Number(req.params.lessonId);
  const isCompleted = req.body?.isCompleted !== false; // default true
  const userId = req.user.id;

  if (!Number.isInteger(lessonId) || lessonId < 1) {
    return res.status(400).json({ message: "Invalid lesson ID." });
  }

  try {
    // 1. Get lesson and course info
    const [lessonRows] = await pool.query(
      "SELECT id, course_id, title FROM lessons WHERE id = ?",
      [lessonId]
    );
    if (!lessonRows.length) return res.status(404).json({ message: "Lesson not found." });
    const lesson = lessonRows[0];

    // 2. Ensure user is enrolled
    const [enrollmentRows] = await pool.query(
      "SELECT id, status, progress_percent FROM enrollments WHERE user_id = ? AND course_id = ?",
      [userId, lesson.course_id]
    );
    if (!enrollmentRows.length) {
      return res.status(403).json({ message: "Enrollment required to save progress." });
    }

    // 3. Upsert lesson_progress
    if (isCompleted) {
      await pool.query(
        `INSERT INTO lesson_progress (user_id, course_id, lesson_id, is_completed, completed_at)
         VALUES (?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE is_completed = 1, completed_at = NOW()`,
        [userId, lesson.course_id, lessonId]
      );
    } else {
      await pool.query(
        `UPDATE lesson_progress SET is_completed = 0, completed_at = NULL
         WHERE user_id = ? AND lesson_id = ?`,
        [userId, lessonId]
      );
    }

    // 4. Calculate updated course progress %
    const [[{ totalLessons }]] = await pool.query(
      "SELECT COUNT(*) as totalLessons FROM lessons WHERE course_id = ?",
      [lesson.course_id]
    );

    const [[{ completedLessons }]] = await pool.query(
      "SELECT COUNT(*) as completedLessons FROM lesson_progress WHERE user_id = ? AND course_id = ? AND is_completed = 1",
      [userId, lesson.course_id]
    );

    const progressPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
    const isFullyCompleted = progressPercent === 100;

    let certCode = null;

    if (isFullyCompleted) {
      // Mark enrollment completed
      await pool.query(
        `UPDATE enrollments 
         SET progress_percent = 100, status = 'completed', completed_at = NOW(), last_accessed_lesson_id = ?
         WHERE user_id = ? AND course_id = ?`,
        [lessonId, userId, lesson.course_id]
      );

      // Check / generate certificate
      const [existingCert] = await pool.query(
        "SELECT certificate_code FROM certificates WHERE user_id = ? AND course_id = ?",
        [userId, lesson.course_id]
      );

      if (existingCert.length > 0) {
        certCode = existingCert[0].certificate_code;
      } else {
        const [[courseInfo]] = await pool.query("SELECT title FROM courses WHERE id = ?", [lesson.course_id]);
        const [[userInfo]] = await pool.query("SELECT full_name FROM users WHERE id = ?", [userId]);
        
        certCode = `ETA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        await pool.query(
          `INSERT INTO certificates (certificate_code, user_id, course_id, recipient_name, course_title, grade_score)
           VALUES (?, ?, ?, ?, ?, 100)`,
          [certCode, userId, lesson.course_id, userInfo.full_name, courseInfo.title]
        );
      }
    } else {
      // Update progress and last accessed
      await pool.query(
        `UPDATE enrollments 
         SET progress_percent = ?, last_accessed_lesson_id = ?
         WHERE user_id = ? AND course_id = ?`,
        [progressPercent, lessonId, userId, lesson.course_id]
      );
    }

    res.json({
      message: isCompleted ? "Lesson marked as complete." : "Lesson marked as incomplete.",
      isCompleted,
      progressPercent,
      isCourseCompleted: isFullyCompleted,
      certificateCode: certCode
    });
  } catch (error) {
    console.error("Save progress error:", error.message);
    res.status(500).json({ message: "Unable to update progress." });
  }
});

// GET /api/student/quizzes/:quizId - Quiz Questionnaire
router.get("/quizzes/:quizId", async (req, res) => {
  const quizId = Number(req.params.quizId);

  if (!Number.isInteger(quizId) || quizId < 1) {
    return res.status(400).json({ message: "Invalid quiz ID." });
  }

  try {
    const [quizRows] = await pool.query(
      "SELECT id, course_id, title, description, passing_score, time_limit_minutes FROM quizzes WHERE id = ?",
      [quizId]
    );
    if (!quizRows.length) return res.status(404).json({ message: "Quiz not found." });
    const quiz = quizRows[0];

    const [questions] = await pool.query(
      "SELECT id, question_text, sort_order FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order ASC",
      [quizId]
    );

    const questionIds = questions.map(q => q.id);
    let options = [];
    if (questionIds.length > 0) {
      // SECURITY: Exclude `is_correct` column completely from client payload!
      const [optRows] = await pool.query(
        `SELECT id, question_id, option_text, sort_order 
         FROM quiz_options 
         WHERE question_id IN (${questionIds.map(() => "?").join(",")})
         ORDER BY sort_order ASC`,
        questionIds
      );
      options = optRows;
    }

    const questionsWithOptions = questions.map(q => ({
      id: q.id,
      text: q.question_text,
      options: options
        .filter(o => o.question_id === q.id)
        .map(o => ({ id: o.id, text: o.option_text }))
    }));

    // Check user previous attempts
    const [attempts] = await pool.query(
      "SELECT id, score, total_questions, passed, completed_at FROM quiz_attempts WHERE user_id = ? AND quiz_id = ? ORDER BY id DESC LIMIT 5",
      [req.user.id, quizId]
    );

    res.json({
      quiz: {
        id: quiz.id,
        course_id: quiz.course_id,
        title: quiz.title,
        description: quiz.description,
        passing_score: quiz.passing_score,
        time_limit_minutes: quiz.time_limit_minutes
      },
      questions: questionsWithOptions,
      attempts
    });
  } catch (error) {
    console.error("Quiz fetch error:", error.message);
    res.status(500).json({ message: "Unable to load quiz." });
  }
});

// POST /api/student/quizzes/:quizId/submit - Server-side Quiz Evaluation
router.post("/quizzes/:quizId/submit", async (req, res) => {
  const quizId = Number(req.params.quizId);
  const answers = req.body?.answers || {}; // { [questionId]: selectedOptionId }
  const userId = req.user.id;

  if (!Number.isInteger(quizId) || quizId < 1) {
    return res.status(400).json({ message: "Invalid quiz ID." });
  }

  try {
    const [quizRows] = await pool.query(
      "SELECT id, course_id, title, passing_score FROM quizzes WHERE id = ?",
      [quizId]
    );
    if (!quizRows.length) return res.status(404).json({ message: "Quiz not found." });
    const quiz = quizRows[0];

    // Fetch questions with explanations
    const [questions] = await pool.query(
      "SELECT id, question_text, explanation FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order ASC",
      [quizId]
    );

    if (questions.length === 0) {
      return res.status(400).json({ message: "Quiz has no questions configured." });
    }

    const questionIds = questions.map(q => q.id);
    const [options] = await pool.query(
      `SELECT id, question_id, option_text, is_correct 
       FROM quiz_options 
       WHERE question_id IN (${questionIds.map(() => "?").join(",")})`,
      questionIds
    );

    let correctCount = 0;
    const review = [];

    for (const q of questions) {
      const qOptions = options.filter(o => o.question_id === q.id);
      const correctOption = qOptions.find(o => o.is_correct === 1 || o.is_correct === true);
      const userSelectedId = Number(answers[q.id]);
      const userSelectedOption = qOptions.find(o => o.id === userSelectedId);

      const isAnswerCorrect = correctOption && userSelectedId === correctOption.id;
      if (isAnswerCorrect) {
        correctCount++;
      }

      review.push({
        questionId: q.id,
        questionText: q.question_text,
        userSelectedId: userSelectedId || null,
        userSelectedText: userSelectedOption?.option_text || "No answer selected",
        correctOptionId: correctOption?.id || null,
        correctOptionText: correctOption?.option_text || "",
        isCorrect: isAnswerCorrect,
        explanation: q.explanation || ""
      });
    }

    const totalQuestions = questions.length;
    const score = Math.round((correctCount / totalQuestions) * 100);
    const passed = score >= quiz.passing_score;

    // Record attempt
    await pool.query(
      `INSERT INTO quiz_attempts (user_id, quiz_id, course_id, score, total_questions, passed, answers_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, quizId, quiz.course_id, score, totalQuestions, passed ? 1 : 0, JSON.stringify(answers)]
    );

    res.json({
      score,
      passed,
      passingScore: quiz.passing_score,
      correctCount,
      totalQuestions,
      review
    });
  } catch (error) {
    console.error("Quiz submission error:", error.message);
    res.status(500).json({ message: "Error evaluating quiz submission." });
  }
});

// GET /api/student/certificates - Student's Earned Certificates
router.get("/certificates", async (req, res) => {
  const userId = req.user.id;

  try {
    const [certificates] = await pool.query(
      `SELECT cert.id, cert.certificate_code, cert.recipient_name, cert.course_title,
              cert.grade_score, cert.issued_at,
              c.slug as course_slug, c.thumbnail_url, c.duration_hours
       FROM certificates cert
       JOIN courses c ON c.id = cert.course_id
       WHERE cert.user_id = ?
       ORDER BY cert.issued_at DESC`,
      [userId]
    );

    res.json({ certificates });
  } catch (error) {
    console.error("Certificates error:", error.message);
    res.status(500).json({ message: "Unable to load certificates." });
  }
});

// GET /api/student/profile - Student Profile Details
router.get("/profile", async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, email, phone, bio, avatar_url, role, created_at FROM users WHERE id = ?",
      [userId]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found." });
    res.json({ profile: rows[0] });
  } catch (error) {
    console.error("Profile error:", error.message);
    res.status(500).json({ message: "Unable to load profile." });
  }
});

// PUT /api/student/profile - Update Student Profile
router.put("/profile", async (req, res) => {
  const userId = req.user.id;
  const { fullName, phone, bio } = req.body || {};

  const clean = (v, max = 255) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = clean(fullName, 150);
  const telephone = clean(phone, 30);
  const biography = clean(bio, 1000);

  if (!name) {
    return res.status(400).json({ message: "Full name is required." });
  }

  try {
    await pool.query(
      "UPDATE users SET full_name = ?, phone = ?, bio = ? WHERE id = ?",
      [name, telephone || null, biography || null, userId]
    );

    res.json({
      message: "Profile updated successfully.",
      profile: { id: userId, full_name: name, phone: telephone, bio: biography }
    });
  } catch (error) {
    console.error("Update profile error:", error.message);
    res.status(500).json({ message: "Unable to update profile." });
  }
});

// PUT /api/student/change-password - Change Account Password
router.put("/change-password", async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword, confirmPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Current password and new password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters long." });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "New passwords do not match." });
  }

  try {
    const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [userId]);
    if (!rows.length) return res.status(404).json({ message: "User not found." });

    const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);

    res.json({ message: "Password changed successfully." });
  } catch (error) {
    console.error("Change password error:", error.message);
    res.status(500).json({ message: "Unable to update password." });
  }
});

// GET /api/student/schedules - All assigned online class schedules for authenticated student
router.get("/schedules", async (req, res) => {
  const userId = req.user.id;

  try {
    const [studentRecords] = await pool.query(
      "SELECT id FROM students WHERE user_id = ? OR email = ?",
      [userId, req.user.email]
    );
    const studentId = studentRecords.length ? studentRecords[0].id : null;

    const [enrollments] = await pool.query(
      "SELECT course_id FROM enrollments WHERE user_id = ? AND status != 'dropped'",
      [userId]
    );
    const enrolledCourseIds = enrollments.map((e) => e.course_id);

    let schedules = [];
    if (studentId || enrolledCourseIds.length > 0) {
      const conditions = [];
      const params = [];
      if (studentId) {
        conditions.push("cs.student_id = ?");
        params.push(studentId);
      }
      if (enrolledCourseIds.length > 0) {
        conditions.push(`cs.course_id IN (${enrolledCourseIds.map(() => "?").join(",")})`);
        params.push(...enrolledCourseIds);
      }

      const [rows] = await pool.query(
        `SELECT cs.id, cs.course_id, cs.student_id, cs.subject_name,
                cs.class_date, cs.start_time, cs.end_time, cs.timezone,
                cs.teacher_name, cs.instructor_id, cs.meeting_url,
                cs.instructions, cs.status,
                c.title as course_title, c.slug as course_slug,
                u.full_name as instructor_full_name, u.email as instructor_email
         FROM class_schedules cs
         LEFT JOIN courses c ON c.id = cs.course_id
         LEFT JOIN users u ON u.id = cs.instructor_id
         WHERE (${conditions.join(" OR ")}) AND cs.status != 'cancelled'
         ORDER BY cs.class_date ASC, cs.start_time ASC
         LIMIT 100`,
        params
      );
      schedules = rows;
    }

    res.json({ schedules });
  } catch (error) {
    console.error("Student schedules list error:", error.message);
    res.status(500).json({ message: "Unable to load student class schedules." });
  }
});

export default router;

