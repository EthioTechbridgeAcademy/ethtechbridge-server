import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAdmin } from "../auth.js";

const router = express.Router();

// Enforce admin authorization on all routes
router.use(requireAdmin);

function clean(val, max = 255) {
  return typeof val === "string" ? val.trim().slice(0, max) : "";
}

// GET /api/admin/overview - Admin Metrics Overview
router.get("/overview", async (_req, res) => {
  try {
    const [[{ totalUsers }]] = await pool.query("SELECT COUNT(*) as totalUsers FROM users WHERE role = 'student'");
    const [[{ totalCourses }]] = await pool.query("SELECT COUNT(*) as totalCourses FROM courses");
    const [[{ publishedCourses }]] = await pool.query("SELECT COUNT(*) as publishedCourses FROM courses WHERE is_published = 1");
    const [[{ totalEnrollments }]] = await pool.query("SELECT COUNT(*) as totalEnrollments FROM enrollments");
    const [[{ completedEnrollments }]] = await pool.query("SELECT COUNT(*) as completedEnrollments FROM enrollments WHERE status = 'completed'");
    const [[{ totalCertificates }]] = await pool.query("SELECT COUNT(*) as totalCertificates FROM certificates");
    const [[{ totalQuizAttempts }]] = await pool.query("SELECT COUNT(*) as totalQuizAttempts FROM quiz_attempts");

    // Recent enrollments
    const [recentEnrollments] = await pool.query(
      `SELECT e.id, e.enrolled_at, e.progress_percent, e.status,
              u.full_name as student_name, u.email as student_email,
              c.title as course_title
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       JOIN courses c ON c.id = e.course_id
       ORDER BY e.enrolled_at DESC LIMIT 10`
    );

    res.json({
      metrics: {
        totalUsers,
        totalCourses,
        publishedCourses,
        totalEnrollments,
        completedEnrollments,
        totalCertificates,
        totalQuizAttempts
      },
      recentEnrollments
    });
  } catch (error) {
    console.error("Admin overview error:", error.message);
    res.status(500).json({ message: "Unable to load admin metrics." });
  }
});

// GET /api/admin/courses - All courses including drafts
router.get("/courses", async (_req, res) => {
  try {
    const [courses] = await pool.query(
      `SELECT c.*, cat.name as category_name,
              (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count,
              (SELECT COUNT(*) FROM course_modules WHERE course_id = c.id) as module_count,
              (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as enrollment_count,
              (SELECT COUNT(*) FROM quizzes WHERE course_id = c.id) as quiz_count
       FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       ORDER BY c.id DESC`
    );
    res.json({ courses });
  } catch (error) {
    console.error("Admin courses error:", error.message);
    res.status(500).json({ message: "Unable to load courses." });
  }
});

// POST /api/admin/courses - Create course
router.post("/courses", async (req, res) => {
  const {
    title, slug, categoryId, difficulty = "beginner", durationHours = 10,
    format = "online", gradeRange = "All Levels", shortDescription = "",
    description = "", thumbnailUrl = "", instructorName = "Ethio Techbridge Faculty",
    instructorTitle = "Lead Instructor", isFree = true, price = 0.00,
    isPublished = true, isFeatured = false, learningObjectives = ""
  } = req.body || {};

  const cleanTitle = clean(title, 200);
  if (!cleanTitle) return res.status(400).json({ message: "Course title is required." });

  // Generate slug if not provided
  let courseSlug = clean(slug, 220) || cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  try {
    // Ensure slug uniqueness
    const [existing] = await pool.query("SELECT id FROM courses WHERE slug = ?", [courseSlug]);
    if (existing.length > 0) {
      courseSlug = `${courseSlug}-${Date.now().toString(36)}`;
    }

    const [result] = await pool.execute(
      `INSERT INTO courses 
       (title, slug, category_id, difficulty, duration_hours, format, grade_range,
        short_description, description, thumbnail_url, instructor_name, instructor_title,
        is_free, price, is_published, is_featured, learning_objectives)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanTitle,
        courseSlug,
        categoryId ? Number(categoryId) : null,
        ["beginner", "intermediate", "advanced", "all_levels"].includes(difficulty) ? difficulty : "beginner",
        Math.max(1, Number(durationHours) || 10),
        ["online", "campus", "hybrid"].includes(format) ? format : "online",
        clean(gradeRange, 80) || "All Levels",
        clean(shortDescription, 500) || null,
        String(description || "").trim(),
        clean(thumbnailUrl, 500) || null,
        clean(instructorName, 150) || "Ethio Techbridge Faculty",
        clean(instructorTitle, 150) || "Lead Instructor",
        Boolean(isFree),
        Number(price) || 0.00,
        Boolean(isPublished),
        Boolean(isFeatured),
        typeof learningObjectives === "string" ? learningObjectives : JSON.stringify(learningObjectives)
      ]
    );

    res.status(201).json({
      message: "Course created successfully.",
      courseId: result.insertId,
      slug: courseSlug
    });
  } catch (error) {
    console.error("Create course error:", error.message);
    res.status(500).json({ message: "Unable to create course." });
  }
});

// PUT /api/admin/courses/:id - Update course
router.put("/courses/:id", async (req, res) => {
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId) || courseId < 1) {
    return res.status(400).json({ message: "Invalid course ID." });
  }

  const {
    title, slug, categoryId, difficulty, durationHours, format, gradeRange,
    shortDescription, description, thumbnailUrl, instructorName, instructorTitle,
    isFree, price, isPublished, isFeatured, learningObjectives
  } = req.body || {};

  try {
    const [rows] = await pool.query("SELECT * FROM courses WHERE id = ?", [courseId]);
    if (!rows.length) return res.status(404).json({ message: "Course not found." });
    const cur = rows[0];

    await pool.execute(
      `UPDATE courses 
       SET title = ?, slug = ?, category_id = ?, difficulty = ?, duration_hours = ?,
           format = ?, grade_range = ?, short_description = ?, description = ?,
           thumbnail_url = ?, instructor_name = ?, instructor_title = ?, is_free = ?,
           price = ?, is_published = ?, is_featured = ?, learning_objectives = ?
       WHERE id = ?`,
      [
        title !== undefined ? clean(title, 200) : cur.title,
        slug !== undefined ? clean(slug, 220) : cur.slug,
        categoryId !== undefined ? (categoryId ? Number(categoryId) : null) : cur.category_id,
        difficulty !== undefined ? difficulty : cur.difficulty,
        durationHours !== undefined ? Number(durationHours) : cur.duration_hours,
        format !== undefined ? format : cur.format,
        gradeRange !== undefined ? clean(gradeRange, 80) : cur.grade_range,
        shortDescription !== undefined ? clean(shortDescription, 500) : cur.short_description,
        description !== undefined ? String(description).trim() : cur.description,
        thumbnailUrl !== undefined ? clean(thumbnailUrl, 500) : cur.thumbnail_url,
        instructorName !== undefined ? clean(instructorName, 150) : cur.instructor_name,
        instructorTitle !== undefined ? clean(instructorTitle, 150) : cur.instructor_title,
        isFree !== undefined ? (isFree ? 1 : 0) : cur.is_free,
        price !== undefined ? Number(price) : cur.price,
        isPublished !== undefined ? (isPublished ? 1 : 0) : cur.is_published,
        isFeatured !== undefined ? (isFeatured ? 1 : 0) : cur.is_featured,
        learningObjectives !== undefined
          ? (typeof learningObjectives === "string" ? learningObjectives : JSON.stringify(learningObjectives))
          : cur.learning_objectives,
        courseId
      ]
    );

    res.json({ message: "Course updated successfully." });
  } catch (error) {
    console.error("Update course error:", error.message);
    res.status(500).json({ message: "Unable to update course." });
  }
});

// DELETE /api/admin/courses/:id
router.delete("/courses/:id", async (req, res) => {
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId) || courseId < 1) {
    return res.status(400).json({ message: "Invalid course ID." });
  }

  try {
    const [result] = await pool.query("DELETE FROM courses WHERE id = ?", [courseId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Course not found." });
    res.json({ message: "Course deleted successfully." });
  } catch (error) {
    console.error("Delete course error:", error.message);
    res.status(500).json({ message: "Unable to delete course." });
  }
});

// GET /api/admin/courses/:id/curriculum
router.get("/courses/:id/curriculum", async (req, res) => {
  const courseId = Number(req.params.id);
  try {
    const [course] = await pool.query("SELECT id, title, slug FROM courses WHERE id = ?", [courseId]);
    if (!course.length) return res.status(404).json({ message: "Course not found." });

    const [modules] = await pool.query(
      "SELECT id, title, description, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC",
      [courseId]
    );

    const [lessons] = await pool.query(
      "SELECT id, module_id, title, slug, content_type, content_text, video_url, duration_minutes, is_preview, sort_order FROM lessons WHERE course_id = ? ORDER BY sort_order ASC",
      [courseId]
    );

    const [quizzes] = await pool.query(
      `SELECT q.id, q.title, q.description, q.passing_score, q.time_limit_minutes,
              (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) as question_count
       FROM quizzes q WHERE q.course_id = ?`,
      [courseId]
    );

    res.json({
      course: course[0],
      modules,
      lessons,
      quizzes
    });
  } catch (error) {
    console.error("Curriculum fetch error:", error.message);
    res.status(500).json({ message: "Unable to load curriculum." });
  }
});

// POST /api/admin/courses/:id/modules - Add module
router.post("/courses/:id/modules", async (req, res) => {
  const courseId = Number(req.params.id);
  const { title, description = "", sortOrder = 1 } = req.body || {};
  const cleanTitle = clean(title, 200);

  if (!cleanTitle) return res.status(400).json({ message: "Module title is required." });

  try {
    const [result] = await pool.execute(
      "INSERT INTO course_modules (course_id, title, description, sort_order) VALUES (?, ?, ?, ?)",
      [courseId, cleanTitle, String(description || "").trim(), Number(sortOrder) || 1]
    );
    res.status(201).json({ message: "Module created.", moduleId: result.insertId });
  } catch (error) {
    console.error("Add module error:", error.message);
    res.status(500).json({ message: "Unable to create module." });
  }
});

// POST /api/admin/courses/:id/lessons - Add lesson
router.post("/courses/:id/lessons", async (req, res) => {
  const courseId = Number(req.params.id);
  const {
    moduleId, title, slug, contentType = "article", contentText = "",
    videoUrl = "", durationMinutes = 15, isPreview = false, sortOrder = 1
  } = req.body || {};

  const cleanTitle = clean(title, 200);
  if (!cleanTitle) return res.status(400).json({ message: "Lesson title is required." });

  let lessonSlug = clean(slug, 220) || cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  try {
    const [existing] = await pool.query(
      "SELECT id FROM lessons WHERE course_id = ? AND slug = ?",
      [courseId, lessonSlug]
    );
    if (existing.length > 0) {
      lessonSlug = `${lessonSlug}-${Date.now().toString(36)}`;
    }

    const [result] = await pool.execute(
      `INSERT INTO lessons 
       (course_id, module_id, title, slug, content_type, content_text, video_url, duration_minutes, is_preview, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courseId,
        moduleId ? Number(moduleId) : null,
        cleanTitle,
        lessonSlug,
        ["video", "article", "interactive"].includes(contentType) ? contentType : "article",
        String(contentText || ""),
        clean(videoUrl, 500) || null,
        Math.max(1, Number(durationMinutes) || 15),
        Boolean(isPreview),
        Number(sortOrder) || 1
      ]
    );

    res.status(201).json({ message: "Lesson added.", lessonId: result.insertId, slug: lessonSlug });
  } catch (error) {
    console.error("Add lesson error:", error.message);
    res.status(500).json({ message: "Unable to add lesson." });
  }
});

// PUT /api/admin/lessons/:id - Edit lesson
router.put("/lessons/:id", async (req, res) => {
  const lessonId = Number(req.params.id);
  const {
    title, slug, moduleId, contentType, contentText, videoUrl,
    durationMinutes, isPreview, sortOrder
  } = req.body || {};

  try {
    const [rows] = await pool.query("SELECT * FROM lessons WHERE id = ?", [lessonId]);
    if (!rows.length) return res.status(404).json({ message: "Lesson not found." });
    const cur = rows[0];

    await pool.execute(
      `UPDATE lessons 
       SET title = ?, slug = ?, module_id = ?, content_type = ?, content_text = ?,
           video_url = ?, duration_minutes = ?, is_preview = ?, sort_order = ?
       WHERE id = ?`,
      [
        title !== undefined ? clean(title, 200) : cur.title,
        slug !== undefined ? clean(slug, 220) : cur.slug,
        moduleId !== undefined ? (moduleId ? Number(moduleId) : null) : cur.module_id,
        contentType !== undefined ? contentType : cur.content_type,
        contentText !== undefined ? String(contentText) : cur.content_text,
        videoUrl !== undefined ? clean(videoUrl, 500) : cur.video_url,
        durationMinutes !== undefined ? Number(durationMinutes) : cur.duration_minutes,
        isPreview !== undefined ? (isPreview ? 1 : 0) : cur.is_preview,
        sortOrder !== undefined ? Number(sortOrder) : cur.sort_order,
        lessonId
      ]
    );

    res.json({ message: "Lesson updated successfully." });
  } catch (error) {
    console.error("Update lesson error:", error.message);
    res.status(500).json({ message: "Unable to update lesson." });
  }
});

// DELETE /api/admin/lessons/:id
router.delete("/lessons/:id", async (req, res) => {
  const lessonId = Number(req.params.id);
  try {
    const [resDelete] = await pool.query("DELETE FROM lessons WHERE id = ?", [lessonId]);
    if (!resDelete.affectedRows) return res.status(404).json({ message: "Lesson not found." });
    res.json({ message: "Lesson deleted." });
  } catch (error) {
    console.error("Delete lesson error:", error.message);
    res.status(500).json({ message: "Unable to delete lesson." });
  }
});

// GET /api/admin/students-progress - Real student learning records
router.get("/students-progress", async (req, res) => {
  try {
    const [students] = await pool.query(
      `SELECT u.id as user_id, u.full_name, u.email, u.phone, u.created_at as registered_at,
              c.id as course_id, c.title as course_title,
              e.id as enrollment_id, e.status as enrollment_status, e.progress_percent,
              e.enrolled_at, e.completed_at,
              cert.certificate_code,
              (SELECT MAX(score) FROM quiz_attempts qa WHERE qa.user_id = u.id AND qa.course_id = c.id) as max_quiz_score
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN certificates cert ON cert.user_id = u.id AND cert.course_id = c.id
       ORDER BY e.updated_at DESC
       LIMIT 200`
    );

    res.json({ students });
  } catch (error) {
    console.error("Admin student progress error:", error.message);
    res.status(500).json({ message: "Unable to load student progress records." });
  }
});

// GET /api/admin/profile - Admin Profile & Account Details
router.get("/profile", async (req, res) => {
  const adminId = req.user.id;
  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, email, phone, bio, avatar_url, role, status, created_at FROM users WHERE id = ?",
      [adminId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Admin account not found." });
    }

    const admin = rows[0];

    // Administrative metrics
    const [[{ reviewedCount }]] = await pool.query(
      "SELECT COUNT(*) as reviewedCount FROM applications WHERE reviewed_by = ?",
      [adminId]
    );
    const [[{ totalEnrolled }]] = await pool.query(
      "SELECT COUNT(*) as totalEnrolled FROM applications WHERE status = 'enrolled' AND reviewed_by = ?",
      [adminId]
    );

    res.json({
      admin,
      stats: {
        applicationsReviewed: reviewedCount || 0,
        enrolledStudents: totalEnrolled || 0
      }
    });
  } catch (error) {
    console.error("Admin profile fetch error:", error.message);
    res.status(500).json({ message: "Unable to load administrator profile." });
  }
});

// PUT /api/admin/profile - Update Admin Profile Information
router.put("/profile", async (req, res) => {
  const adminId = req.user.id;
  const { fullName, phone, bio } = req.body || {};

  const name = clean(fullName, 150);
  const telephone = clean(phone, 30);
  const biography = clean(bio, 1000);

  if (!name) {
    return res.status(400).json({ message: "Administrator full name is required." });
  }

  try {
    await pool.query(
      "UPDATE users SET full_name = ?, phone = ?, bio = ?, updated_at = NOW() WHERE id = ?",
      [name, telephone || null, biography || null, adminId]
    );

    res.json({
      success: true,
      message: "Administrator profile updated successfully.",
      admin: {
        id: adminId,
        full_name: name,
        phone: telephone || null,
        bio: biography || null
      }
    });
  } catch (error) {
    console.error("Admin update profile error:", error.message);
    res.status(500).json({ message: "Failed to update profile." });
  }
});

// PUT /api/admin/change-password - Change Administrator Password
router.put("/change-password", async (req, res) => {
  const adminId = req.user.id;
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
    const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [adminId]);
    if (!rows.length) return res.status(404).json({ message: "Admin account not found." });

    const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect." });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await pool.query("UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?", [newHash, adminId]);

    res.json({ success: true, message: "Administrator password changed successfully." });
  } catch (error) {
    console.error("Admin change password error:", error.message);
    res.status(500).json({ message: "Failed to update password." });
  }
});

// GET /api/admin/instructors - List of registered instructors
router.get("/instructors", async (_req, res) => {
  try {
    const [instructors] = await pool.query(
      `SELECT id, full_name, email, phone, status, created_at,
              (SELECT COUNT(*) FROM courses WHERE instructor_user_id = users.id) as assigned_courses_count,
              (SELECT COUNT(*) FROM class_schedules WHERE instructor_id = users.id) as assigned_schedules_count
       FROM users 
       WHERE role = 'instructor'
       ORDER BY full_name ASC`
    );
    res.json({ instructors });
  } catch (err) {
    console.error("Admin instructors list error:", err.message);
    res.status(500).json({ message: "Unable to load instructors." });
  }
});

// PATCH /api/admin/courses/:id/assign-instructor - Assign instructor to course
router.patch("/courses/:id/assign-instructor", async (req, res) => {
  const courseId = Number(req.params.id);
  const { instructorUserId } = req.body || {};
  const cleanInstId = instructorUserId ? Number(instructorUserId) : null;

  try {
    let instName = "Ethio Techbridge Faculty";
    if (cleanInstId) {
      const [user] = await pool.query("SELECT full_name FROM users WHERE id = ? AND role = 'instructor'", [cleanInstId]);
      if (!user.length) return res.status(400).json({ message: "Invalid instructor ID." });
      instName = user[0].full_name;
    }

    await pool.query(
      "UPDATE courses SET instructor_user_id = ?, instructor_name = ? WHERE id = ?",
      [cleanInstId, instName, courseId]
    );

    res.json({
      message: "Instructor assigned to course successfully.",
      instructorUserId: cleanInstId,
      instructorName: instName
    });
  } catch (err) {
    console.error("Assign instructor error:", err.message);
    res.status(500).json({ message: "Failed to assign instructor to course." });
  }
});

// ============================================================================
// COMPREHENSIVE INSTITUTIONAL REPORTING SYSTEM
// ============================================================================

// GET /api/admin/reports/summary - Executive Dashboard & Institutional KPIs
router.get("/reports/summary", async (_req, res) => {
  try {
    // 1. Applications KPIs
    const [[appStats]] = await pool.query(`
      SELECT 
        COUNT(*) as totalApplications,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN status = 'under_review' THEN 1 ELSE 0 END) as underReviewCount,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedCount,
        SUM(CASE WHEN status = 'enrolled' THEN 1 ELSE 0 END) as enrolledCount,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
        SUM(CASE WHEN converted_user_id IS NOT NULL THEN 1 ELSE 0 END) as convertedCount
      FROM applications
    `);

    // 2. User & LMS KPIs
    const [[{ totalStudents }]] = await pool.query("SELECT COUNT(*) as totalStudents FROM users WHERE role = 'student'");
    const [[{ totalInstructors }]] = await pool.query("SELECT COUNT(*) as totalInstructors FROM users WHERE role = 'instructor'");
    const [[{ totalCourses }]] = await pool.query("SELECT COUNT(*) as totalCourses FROM courses");
    const [[{ publishedCourses }]] = await pool.query("SELECT COUNT(*) as publishedCourses FROM courses WHERE is_published = 1");
    
    // 3. Academic Enrollments & Certificates
    const [[enrollStats]] = await pool.query(`
      SELECT 
        COUNT(*) as totalEnrollments,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeEnrollments,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedEnrollments,
        COALESCE(ROUND(AVG(progress_percent), 1), 0) as avgProgressPercent
      FROM enrollments
    `);

    const [[{ totalCertificates }]] = await pool.query("SELECT COUNT(*) as totalCertificates FROM certificates");
    const [[{ totalQuizAttempts }]] = await pool.query("SELECT COUNT(*) as totalQuizAttempts FROM quiz_attempts");
    const [[{ passedQuizAttempts }]] = await pool.query("SELECT COUNT(*) as passedQuizAttempts FROM quiz_attempts WHERE passed = 1");

    // 4. Tutoring & MS Teams Live Class Schedules
    const [[schedStats]] = await pool.query(`
      SELECT 
        COUNT(*) as totalSchedules,
        SUM(CASE WHEN meeting_url IS NOT NULL AND meeting_url != '' THEN 1 ELSE 0 END) as teamsOnlineCount,
        SUM(CASE WHEN meeting_url IS NULL OR meeting_url = '' THEN 1 ELSE 0 END) as inPersonCount,
        SUM(CASE WHEN meeting_url IS NOT NULL AND meeting_url != '' THEN 1 ELSE 0 END) as teamsWithUrlCount
      FROM class_schedules
    `);

    // 5. Popular Programs Distribution
    const [popularPrograms] = await pool.query(`
      SELECT program_interest, COUNT(*) as count 
      FROM applications 
      WHERE program_interest IS NOT NULL AND program_interest != ''
      GROUP BY program_interest 
      ORDER BY count DESC 
      LIMIT 6
    `);

    // 6. Top Enrolled Courses
    const [topCourses] = await pool.query(`
      SELECT c.id, c.title, c.difficulty, c.grade_range,
             COUNT(e.id) as enrollment_count,
             COALESCE(ROUND(AVG(e.progress_percent), 1), 0) as avg_progress,
             SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as completed_count
      FROM courses c
      LEFT JOIN enrollments e ON e.course_id = c.id
      GROUP BY c.id, c.title, c.difficulty, c.grade_range
      ORDER BY enrollment_count DESC, c.id DESC
      LIMIT 6
    `);

    // 7. Center Locations Breakdown
    const [centerDistribution] = await pool.query(`
      SELECT 
        CASE 
          WHEN meeting_url IS NOT NULL AND meeting_url != '' THEN 'Microsoft Teams Online'
          WHEN instructions LIKE '%CMC%' THEN 'CMC Center'
          WHEN instructions LIKE '%Summit%' THEN 'Summit Center'
          WHEN instructions LIKE '%Ayat%' THEN 'Ayat Center'
          WHEN instructions LIKE '%Semit%' THEN 'Semit Center'
          WHEN instructions LIKE '%72%' THEN '72 Center'
          ELSE 'Campus Tutoring Center'
        END as center,
        COUNT(*) as count
      FROM class_schedules
      GROUP BY center
      ORDER BY count DESC
    `);

    res.json({
      success: true,
      data: {
        applications: {
          total: Number(appStats?.totalApplications || 0),
          pending: Number(appStats?.pendingCount || 0),
          underReview: Number(appStats?.underReviewCount || 0),
          approved: Number(appStats?.approvedCount || 0),
          enrolled: Number(appStats?.enrolledCount || 0),
          rejected: Number(appStats?.rejectedCount || 0),
          converted: Number(appStats?.convertedCount || 0),
          conversionRate: appStats?.totalApplications > 0
            ? Math.round(((Number(appStats?.enrolledCount || 0) + Number(appStats?.approvedCount || 0)) / Number(appStats.totalApplications)) * 100)
            : 0
        },
        lms: {
          totalStudents: Number(totalStudents || 0),
          totalInstructors: Number(totalInstructors || 0),
          totalCourses: Number(totalCourses || 0),
          publishedCourses: Number(publishedCourses || 0),
          totalEnrollments: Number(enrollStats?.totalEnrollments || 0),
          activeEnrollments: Number(enrollStats?.activeEnrollments || 0),
          completedEnrollments: Number(enrollStats?.completedEnrollments || 0),
          avgProgressPercent: Number(enrollStats?.avgProgressPercent || 0),
          completionRate: enrollStats?.totalEnrollments > 0
            ? Math.round((Number(enrollStats?.completedEnrollments || 0) / Number(enrollStats.totalEnrollments)) * 100)
            : 0,
          totalCertificates: Number(totalCertificates || 0),
          totalQuizAttempts: Number(totalQuizAttempts || 0),
          quizPassRate: totalQuizAttempts > 0
            ? Math.round((Number(passedQuizAttempts || 0) / Number(totalQuizAttempts)) * 100)
            : 0
        },
        schedules: {
          total: Number(schedStats?.totalSchedules || 0),
          teamsOnline: Number(schedStats?.teamsOnlineCount || 0),
          inPerson: Number(schedStats?.inPersonCount || 0),
          teamsWithUrl: Number(schedStats?.teamsWithUrlCount || 0)
        },
        popularPrograms,
        topCourses,
        centerDistribution
      }
    });
  } catch (error) {
    console.error("Admin reports summary error:", error.message);
    res.status(500).json({ message: "Unable to load reports summary." });
  }
});

// GET /api/admin/reports/admissions - Detailed Admissions Pipeline Report
router.get("/reports/admissions", async (req, res) => {
  try {
    const { status, search, gradeLevel, programInterest, startDate, endDate } = req.query;
    const conditions = [];
    const params = [];

    if (status && status !== "all") {
      conditions.push("a.status = ?");
      params.push(status);
    }
    if (gradeLevel && gradeLevel !== "all") {
      conditions.push("a.grade_level = ?");
      params.push(gradeLevel);
    }
    if (programInterest && programInterest !== "all") {
      conditions.push("a.program_interest = ?");
      params.push(programInterest);
    }
    if (startDate) {
      conditions.push("a.created_at >= ?");
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      conditions.push("a.created_at <= ?");
      params.push(`${endDate} 23:59:59`);
    }
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      conditions.push("(a.application_number LIKE ? OR a.full_name LIKE ? OR a.email LIKE ? OR a.phone LIKE ?)");
      params.push(q, q, q, q);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `SELECT a.id, a.application_number, a.full_name, a.phone, a.email,
              a.grade_level, a.program_interest, a.preferred_contact, a.status,
              a.notes, a.admin_notes, a.created_at, a.reviewed_at,
              u.full_name as reviewer_name
       FROM applications a
       LEFT JOIN users u ON u.id = a.reviewed_by
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT 1000`,
      params
    );

    // Summary counts for current filtered view
    const [statusBreakdown] = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM applications 
      GROUP BY status
    `);

    const [gradeBreakdown] = await pool.query(`
      SELECT grade_level, COUNT(*) as count 
      FROM applications 
      WHERE grade_level IS NOT NULL AND grade_level != ''
      GROUP BY grade_level 
      ORDER BY count DESC
    `);

    res.json({
      success: true,
      total: rows.length,
      data: rows,
      statusBreakdown,
      gradeBreakdown
    });
  } catch (error) {
    console.error("Admin admissions report error:", error.message);
    res.status(500).json({ message: "Unable to generate admissions report." });
  }
});

// GET /api/admin/reports/academic-progress - Course Performance & Student Roster Report
router.get("/reports/academic-progress", async (req, res) => {
  try {
    const { courseId, status } = req.query;
    const conditions = [];
    const params = [];

    if (courseId && courseId !== "all") {
      conditions.push("e.course_id = ?");
      params.push(Number(courseId));
    }
    if (status && status !== "all") {
      conditions.push("e.status = ?");
      params.push(status);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // 1. Course performance aggregate table
    const [coursesSummary] = await pool.query(`
      SELECT c.id, c.title, c.difficulty, c.grade_range, c.instructor_name,
             cat.name as category_name,
             COUNT(e.id) as total_enrolled,
             SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) as active_count,
             SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
             COALESCE(ROUND(AVG(e.progress_percent), 1), 0) as avg_progress,
             (SELECT COUNT(*) FROM certificates cert WHERE cert.course_id = c.id) as certs_issued
      FROM courses c
      LEFT JOIN categories cat ON cat.id = c.category_id
      LEFT JOIN enrollments e ON e.course_id = c.id
      GROUP BY c.id, c.title, c.difficulty, c.grade_range, c.instructor_name, cat.name
      ORDER BY total_enrolled DESC, c.id DESC
    `);

    // 2. Student-level progress details
    const [studentRoster] = await pool.query(
      `SELECT e.id, e.progress_percent, e.status, e.enrolled_at, e.completed_at,
              u.full_name as student_name, u.email as student_email, u.phone as student_phone,
              c.title as course_title, c.grade_range,
              cert.certificate_code, cert.issued_at as cert_issued_at
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN certificates cert ON (cert.user_id = e.user_id AND cert.course_id = e.course_id)
       ${whereClause}
       ORDER BY e.enrolled_at DESC
       LIMIT 1000`,
      params
    );

    res.json({
      success: true,
      coursesSummary,
      studentRoster
    });
  } catch (error) {
    console.error("Admin academic progress report error:", error.message);
    res.status(500).json({ message: "Unable to generate academic progress report." });
  }
});

// GET /api/admin/reports/schedules - Tutoring Centers & Microsoft Teams Schedule Report
router.get("/reports/schedules", async (req, res) => {
  try {
    const { center, sessionType, instructorId } = req.query;
    const conditions = [];
    const params = [];

    if (center && center !== "all") {
      conditions.push("cs.instructions LIKE ?");
      params.push(`%${center}%`);
    }
    if (sessionType === "online_teams") {
      conditions.push("cs.meeting_url IS NOT NULL AND cs.meeting_url != ''");
    } else if (sessionType === "in_person") {
      conditions.push("(cs.meeting_url IS NULL OR cs.meeting_url = '')");
    }
    if (instructorId && instructorId !== "all") {
      conditions.push("cs.instructor_id = ?");
      params.push(Number(instructorId));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [schedules] = await pool.query(
      `SELECT cs.id, cs.subject_name, cs.class_date, cs.start_time, cs.end_time,
              cs.status, cs.teacher_name, cs.meeting_url, cs.instructions,
              CASE WHEN (cs.meeting_url IS NOT NULL AND cs.meeting_url != '') THEN 'online_teams' ELSE 'in_person' END as session_type,
              CASE 
                WHEN cs.meeting_url IS NOT NULL AND cs.meeting_url != '' THEN 'Online Microsoft Teams'
                WHEN cs.instructions LIKE '%CMC%' THEN 'CMC Center'
                WHEN cs.instructions LIKE '%Summit%' THEN 'Summit Center'
                WHEN cs.instructions LIKE '%Ayat%' THEN 'Ayat Center'
                WHEN cs.instructions LIKE '%Semit%' THEN 'Semit Center'
                WHEN cs.instructions LIKE '%72%' THEN '72 Center'
                ELSE 'Campus Tutoring Center'
              END as center_name,
              c.title as course_title,
              s.student_name, s.email as student_email, s.phone as student_phone,
              u.full_name as assigned_faculty_name, u.email as assigned_faculty_email
       FROM class_schedules cs
       LEFT JOIN courses c ON c.id = cs.course_id
       LEFT JOIN students s ON s.id = cs.student_id
       LEFT JOIN users u ON u.id = cs.instructor_id
       ${whereClause}
       ORDER BY cs.class_date DESC, cs.start_time DESC
       LIMIT 1000`,
      params
    );

    const [centerStats] = await pool.query(`
      SELECT 
        CASE 
          WHEN meeting_url IS NOT NULL AND meeting_url != '' THEN 'Microsoft Teams Online'
          WHEN instructions LIKE '%CMC%' THEN 'CMC Center'
          WHEN instructions LIKE '%Summit%' THEN 'Summit Center'
          WHEN instructions LIKE '%Ayat%' THEN 'Ayat Center'
          WHEN instructions LIKE '%Semit%' THEN 'Semit Center'
          WHEN instructions LIKE '%72%' THEN '72 Center'
          ELSE 'Campus Tutoring Center'
        END as center_name,
        COUNT(*) as total_classes,
        SUM(CASE WHEN meeting_url IS NOT NULL AND meeting_url != '' THEN 1 ELSE 0 END) as teams_online,
        SUM(CASE WHEN meeting_url IS NULL OR meeting_url = '' THEN 1 ELSE 0 END) as in_person
      FROM class_schedules
      GROUP BY center_name
      ORDER BY total_classes DESC
    `);

    res.json({
      success: true,
      total: schedules.length,
      data: schedules,
      centerStats
    });
  } catch (error) {
    console.error("Admin schedules report error:", error.message);
    res.status(500).json({ message: "Unable to generate schedules report." });
  }
});

export default router;

