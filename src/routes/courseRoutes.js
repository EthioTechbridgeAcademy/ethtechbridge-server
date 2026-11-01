import express from "express";
import { pool } from "../db.js";
import { requireAuth, optionalAuth } from "../auth.js";

const router = express.Router();

// GET /api/categories
router.get("/categories", async (_req, res) => {
  try {
    const [categories] = await pool.query(`
      SELECT c.id, c.slug, c.name, c.description, c.icon, c.sort_order,
             COUNT(co.id) as course_count
      FROM categories c
      LEFT JOIN courses co ON co.category_id = c.id AND co.is_published = 1
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC
    `);
    res.json({ categories });
  } catch (error) {
    console.error("Categories fetch error:", error.message);
    res.status(500).json({ message: "Unable to load categories." });
  }
});

// GET /api/courses - Public Course Discovery
router.get("/courses", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const categorySlug = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const difficulty = typeof req.query.difficulty === "string" ? req.query.difficulty.trim() : "";
    const isFree = req.query.free === "true" ? 1 : req.query.free === "false" ? 0 : null;
    const sort = typeof req.query.sort === "string" ? req.query.sort.trim() : "newest";
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const offset = (page - 1) * limit;

    const where = ["co.is_published = 1"];
    const values = [];

    if (search) {
      where.push("(co.title LIKE ? OR co.description LIKE ? OR co.short_description LIKE ?)");
      const pattern = `%${search}%`;
      values.push(pattern, pattern, pattern);
    }

    if (categorySlug && categorySlug !== "all") {
      where.push("cat.slug = ?");
      values.push(categorySlug);
    }

    if (difficulty && ["beginner", "intermediate", "advanced"].includes(difficulty)) {
      where.push("co.difficulty = ?");
      values.push(difficulty);
    }

    if (isFree !== null) {
      where.push("co.is_free = ?");
      values.push(isFree);
    }

    let orderBy = "co.id DESC";
    if (sort === "popular") {
      orderBy = "enrollment_count DESC, co.id DESC";
    } else if (sort === "title") {
      orderBy = "co.title ASC";
    } else if (sort === "duration") {
      orderBy = "co.duration_hours ASC";
    } else if (sort === "newest") {
      orderBy = "co.created_at DESC";
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    // Count total matches
    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT co.id) AS total
       FROM courses co
       LEFT JOIN categories cat ON cat.id = co.category_id
       ${whereClause}`,
      values
    );
    const total = countRows[0]?.total || 0;

    // Fetch courses with real enrollment counts and lesson counts
    const [courses] = await pool.query(
      `SELECT co.id, co.slug, co.title, co.short_description, co.difficulty,
              co.duration_hours, co.thumbnail_url, co.instructor_name, co.instructor_title,
              co.price, co.is_free, co.is_featured, co.format, co.grade_range, co.created_at,
              cat.id as category_id, cat.name as category_name, cat.slug as category_slug,
              (SELECT COUNT(*) FROM enrollments WHERE course_id = co.id) AS enrollment_count,
              (SELECT COUNT(*) FROM lessons WHERE course_id = co.id) AS lesson_count
       FROM courses co
       LEFT JOIN categories cat ON cat.id = co.category_id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );

    res.json({
      courses,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("Courses list error:", error.message);
    res.status(500).json({ message: "Unable to load courses." });
  }
});

// GET /api/courses/:slug - Course Details
router.get("/courses/:slug", optionalAuth, async (req, res) => {
  const slug = req.params.slug;
  const userId = req.user?.id || null;

  try {
    const [rows] = await pool.query(
      `SELECT co.*, cat.name as category_name, cat.slug as category_slug,
              (SELECT COUNT(*) FROM enrollments WHERE course_id = co.id) AS enrollment_count,
              (SELECT COUNT(*) FROM lessons WHERE course_id = co.id) AS lesson_count
       FROM courses co
       LEFT JOIN categories cat ON cat.id = co.category_id
       WHERE co.slug = ? OR co.id = ? LIMIT 1`,
      [slug, isNaN(slug) ? 0 : Number(slug)]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Course not found." });
    }

    const course = rows[0];

    // Check user enrollment status if authenticated
    let isEnrolled = false;
    let enrollment = null;
    if (userId) {
      const [enrollmentRows] = await pool.query(
        "SELECT id, status, progress_percent, last_accessed_lesson_id, enrolled_at, completed_at FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1",
        [userId, course.id]
      );
      if (enrollmentRows.length > 0) {
        isEnrolled = true;
        enrollment = enrollmentRows[0];
      }
    }

    // Fetch modules and lessons (curriculum overview)
    const [modules] = await pool.query(
      "SELECT id, title, description, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC",
      [course.id]
    );

    const [lessons] = await pool.query(
      `SELECT id, module_id, title, slug, content_type, duration_minutes, is_preview, sort_order,
              ${isEnrolled ? "content_text, video_url" : "CASE WHEN is_preview = 1 THEN content_text ELSE NULL END as content_text, CASE WHEN is_preview = 1 THEN video_url ELSE NULL END as video_url"}
       FROM lessons
       WHERE course_id = ?
       ORDER BY sort_order ASC`,
      [course.id]
    );

    // Group lessons by module
    const moduleMap = modules.map(m => ({
      ...m,
      lessons: lessons.filter(l => l.module_id === m.id)
    }));

    // If there are lessons without a module, create a general module
    const unassignedLessons = lessons.filter(l => !l.module_id);
    if (unassignedLessons.length > 0) {
      moduleMap.unshift({
        id: 0,
        title: "Course Curriculum",
        description: "Lessons in this course",
        sort_order: 0,
        lessons: unassignedLessons
      });
    }

    // Fetch quiz metadata
    const [quizzes] = await pool.query(
      `SELECT q.id, q.title, q.description, q.passing_score, q.time_limit_minutes,
              (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id) AS question_count
       FROM quizzes q
       WHERE q.course_id = ?`,
      [course.id]
    );

    // Fetch related courses
    const [related] = await pool.query(
      `SELECT id, slug, title, short_description, difficulty, duration_hours, thumbnail_url, is_free, price
       FROM courses
       WHERE category_id = ? AND id != ? AND is_published = 1
       LIMIT 3`,
      [course.category_id || 0, course.id]
    );

    // Parse learning objectives JSON safely
    let learningObjectives = [];
    if (course.learning_objectives) {
      try {
        learningObjectives = JSON.parse(course.learning_objectives);
      } catch {
        learningObjectives = course.learning_objectives.split("\n").filter(Boolean);
      }
    }

    res.json({
      course: {
        ...course,
        learning_objectives: learningObjectives
      },
      curriculum: moduleMap,
      quizzes,
      relatedCourses: related,
      isEnrolled,
      enrollment
    });
  } catch (error) {
    console.error("Course details error:", error.message);
    res.status(500).json({ message: "Unable to load course details." });
  }
});

// GET /api/courses/:slug/preview/:lessonSlug - Free Lesson Preview
router.get("/courses/:slug/preview/:lessonSlug", async (req, res) => {
  const { slug, lessonSlug } = req.params;

  try {
    const [courseRows] = await pool.query(
      "SELECT id, title, slug FROM courses WHERE slug = ? OR id = ? LIMIT 1",
      [slug, isNaN(slug) ? 0 : Number(slug)]
    );
    if (courseRows.length === 0) {
      return res.status(404).json({ message: "Course not found." });
    }
    const course = courseRows[0];

    const [lessonRows] = await pool.query(
      "SELECT id, title, slug, content_type, content_text, video_url, duration_minutes, is_preview FROM lessons WHERE course_id = ? AND (slug = ? OR id = ?) LIMIT 1",
      [course.id, lessonSlug, isNaN(lessonSlug) ? 0 : Number(lessonSlug)]
    );

    if (lessonRows.length === 0) {
      return res.status(404).json({ message: "Lesson not found." });
    }

    const lesson = lessonRows[0];
    if (!lesson.is_preview) {
      return res.status(403).json({ message: "This lesson requires enrollment to access." });
    }

    res.json({
      course: { id: course.id, title: course.title, slug: course.slug },
      lesson
    });
  } catch (error) {
    console.error("Preview lesson error:", error.message);
    res.status(500).json({ message: "Unable to load lesson preview." });
  }
});

// POST /api/courses/:slug/enroll - Student Enrollment
router.post("/courses/:slug/enroll", requireAuth, async (req, res) => {
  const slug = req.params.slug;
  const userId = req.user.id;

  try {
    const [courseRows] = await pool.query(
      "SELECT id, title, slug, is_published, is_free, price FROM courses WHERE slug = ? OR id = ? LIMIT 1",
      [slug, isNaN(slug) ? 0 : Number(slug)]
    );

    if (courseRows.length === 0) {
      return res.status(404).json({ message: "Course not found." });
    }

    const course = courseRows[0];
    if (!course.is_published) {
      return res.status(400).json({ message: "This course is not currently open for enrollment." });
    }

    // Verify student admission status before enrollment
    const [appRows] = await pool.query(
      `SELECT status FROM applications 
       WHERE user_id = ? OR converted_user_id = ? OR (email IS NOT NULL AND email = ?)
       ORDER BY created_at DESC LIMIT 1`,
      [userId, userId, req.user?.email || ""]
    );

    if (appRows.length > 0) {
      const appStatus = appRows[0].status;
      if (appStatus === "pending" || appStatus === "under_review") {
        return res.status(403).json({
          message: "Your admission application is currently awaiting administrator review. Course enrollment will become available once your admission is approved.",
          code: "ADMISSION_PENDING"
        });
      }
      if (appStatus === "rejected") {
        return res.status(403).json({
          message: "Your admission application could not be approved at this time. Please contact the academy administration.",
          code: "ADMISSION_REJECTED"
        });
      }
    }

    // Check if already enrolled
    const [existing] = await pool.query(
      "SELECT id, status, progress_percent FROM enrollments WHERE user_id = ? AND course_id = ?",
      [userId, course.id]
    );

    if (existing.length > 0) {
      return res.json({
        message: "You are already enrolled in this course.",
        enrollmentId: existing[0].id,
        alreadyEnrolled: true
      });
    }

    // Find the first lesson ID to set as last_accessed_lesson_id
    const [firstLessonRows] = await pool.query(
      "SELECT id FROM lessons WHERE course_id = ? ORDER BY sort_order ASC LIMIT 1",
      [course.id]
    );
    const firstLessonId = firstLessonRows[0]?.id || null;

    const [result] = await pool.execute(
      "INSERT INTO enrollments (user_id, course_id, status, progress_percent, last_accessed_lesson_id) VALUES (?, ?, 'active', 0, ?)",
      [userId, course.id, firstLessonId]
    );

    res.status(201).json({
      message: `Congratulations! You have enrolled in "${course.title}".`,
      enrollmentId: result.insertId,
      courseSlug: course.slug
    });
  } catch (error) {
    console.error("Enrollment error:", error.message);
    res.status(500).json({ message: "Unable to complete enrollment. Please try again." });
  }
});

export default router;

