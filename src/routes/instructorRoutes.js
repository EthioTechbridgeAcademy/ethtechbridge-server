import express from "express";
import { pool } from "../db.js";
import { requireInstructor } from "../auth.js";
import { validateTeamsMeetingUrl } from "../utils/teamsUrl.js";

const router = express.Router();

// Enforce instructor/admin role on all instructor routes
router.use(requireInstructor);

/**
 * GET /api/instructor/overview
 * Real summary metrics, assigned courses, and upcoming sessions for authenticated instructor.
 */
router.get("/overview", async (req, res) => {
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";

  try {
    // 1. Assigned courses
    const [courses] = await pool.query(
      isAdmin
        ? `SELECT c.*, cat.name as category_name,
                  (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count
           FROM courses c
           LEFT JOIN categories cat ON cat.id = c.category_id
           ORDER BY c.title ASC`
        : `SELECT c.*, cat.name as category_name,
                  (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count
           FROM courses c
           LEFT JOIN categories cat ON cat.id = c.category_id
           WHERE c.instructor_user_id = ?
           ORDER BY c.title ASC`,
      isAdmin ? [] : [instructorId]
    );

    const courseIds = courses.map((c) => c.id);

    // 2. Active unique student count
    let totalStudents = 0;
    if (courseIds.length > 0) {
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(DISTINCT user_id) as count FROM enrollments WHERE course_id IN (${courseIds.map(() => "?").join(",")}) AND status != 'dropped'`,
        courseIds
      );
      totalStudents = count;
    }

    // 3. Upcoming class sessions
    const [upcomingSchedules] = await pool.query(
      isAdmin
        ? `SELECT cs.*, c.title as course_title, s.student_name, s.grade
           FROM class_schedules cs
           LEFT JOIN courses c ON c.id = cs.course_id
           LEFT JOIN students s ON s.id = cs.student_id
           WHERE cs.status != 'cancelled'
           ORDER BY cs.class_date ASC, cs.start_time ASC
           LIMIT 10`
        : `SELECT cs.*, c.title as course_title, s.student_name, s.grade
           FROM class_schedules cs
           LEFT JOIN courses c ON c.id = cs.course_id
           LEFT JOIN students s ON s.id = cs.student_id
           WHERE (cs.instructor_id = ? OR cs.teacher_name = ?) AND cs.status != 'cancelled'
           ORDER BY cs.class_date ASC, cs.start_time ASC
           LIMIT 10`,
      isAdmin ? [] : [instructorId, req.user.name]
    );

    res.json({
      metrics: {
        assignedCoursesCount: courses.length,
        totalStudentsCount: totalStudents,
        upcomingSchedulesCount: upcomingSchedules.length
      },
      courses,
      upcomingSchedules
    });
  } catch (err) {
    console.error("Instructor overview error:", err.message);
    res.status(500).json({ message: "Unable to load instructor overview." });
  }
});

/**
 * GET /api/instructor/courses
 * List of courses assigned to the instructor.
 */
router.get("/courses", async (req, res) => {
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";

  try {
    const [courses] = await pool.query(
      isAdmin
        ? `SELECT c.*, cat.name as category_name,
                  (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as enrollment_count,
                  (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count
           FROM courses c
           LEFT JOIN categories cat ON cat.id = c.category_id
           ORDER BY c.title ASC`
        : `SELECT c.*, cat.name as category_name,
                  (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as enrollment_count,
                  (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count
           FROM courses c
           LEFT JOIN categories cat ON cat.id = c.category_id
           WHERE c.instructor_user_id = ?
           ORDER BY c.title ASC`,
      isAdmin ? [] : [instructorId]
    );

    res.json({ courses });
  } catch (err) {
    console.error("Instructor courses error:", err.message);
    res.status(500).json({ message: "Unable to load assigned courses." });
  }
});

/**
 * GET /api/instructor/courses/:id/roster
 * Student roster for an assigned course (strict assignment ownership).
 */
router.get("/courses/:id/roster", async (req, res) => {
  const courseId = Number(req.params.id);
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";

  if (!Number.isInteger(courseId) || courseId < 1) {
    return res.status(400).json({ message: "Invalid course ID." });
  }

  try {
    // 1. Verify course existence and instructor assignment
    const [courseRows] = await pool.query("SELECT * FROM courses WHERE id = ?", [courseId]);
    if (!courseRows.length) return res.status(404).json({ message: "Course not found." });
    const course = courseRows[0];

    if (!isAdmin && course.instructor_user_id !== instructorId) {
      return res.status(403).json({ message: "Forbidden: You are not assigned to instruct this course." });
    }

    // 2. Fetch enrolled students (NO passwords, tokens, or private secrets)
    const [roster] = await pool.query(
      `SELECT u.id as user_id, u.full_name, u.email, u.phone,
              e.id as enrollment_id, e.status as enrollment_status, e.progress_percent,
              e.enrolled_at, e.completed_at,
              cert.certificate_code,
              (SELECT MAX(score) FROM quiz_attempts qa WHERE qa.user_id = u.id AND qa.course_id = ?) as best_quiz_score
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN certificates cert ON cert.user_id = u.id AND cert.course_id = ?
       WHERE e.course_id = ? AND e.status != 'dropped'
       ORDER BY u.full_name ASC`,
      [courseId, courseId, courseId]
    );

    res.json({
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        format: course.format,
        grade_range: course.grade_range
      },
      roster
    });
  } catch (err) {
    console.error("Course roster error:", err.message);
    res.status(500).json({ message: "Unable to load student roster." });
  }
});

/**
 * GET /api/instructor/schedules
 * Class schedules assigned to the instructor (with Teams URLs & instructions).
 */
router.get("/schedules", async (req, res) => {
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";

  try {
    const query = isAdmin
      ? `SELECT cs.*, c.title as course_title, c.slug as course_slug,
                s.student_name, s.grade, s.parent_name, s.phone as student_phone, s.email as student_email,
                u.full_name as instructor_full_name
         FROM class_schedules cs
         LEFT JOIN courses c ON c.id = cs.course_id
         LEFT JOIN students s ON s.id = cs.student_id
         LEFT JOIN users u ON u.id = cs.instructor_id
         ORDER BY cs.class_date ASC, cs.start_time ASC LIMIT 200`
      : `SELECT cs.*, c.title as course_title, c.slug as course_slug,
                s.student_name, s.grade, s.parent_name, s.phone as student_phone, s.email as student_email,
                u.full_name as instructor_full_name
         FROM class_schedules cs
         LEFT JOIN courses c ON c.id = cs.course_id
         LEFT JOIN students s ON s.id = cs.student_id
         LEFT JOIN users u ON u.id = cs.instructor_id
         WHERE cs.instructor_id = ? OR cs.teacher_name = ?
         ORDER BY cs.class_date ASC, cs.start_time ASC LIMIT 200`;

    const params = isAdmin ? [] : [instructorId, req.user.name];
    const [schedules] = await pool.query(query, params);

    res.json({ schedules });
  } catch (error) {
    console.error("Instructor schedules error:", error.message);
    res.status(500).json({ message: "Unable to load instructor schedules." });
  }
});

/**
 * GET /api/instructor/classes/:id
 * Individual class session details with strict assignment check.
 */
router.get("/classes/:id", async (req, res) => {
  const scheduleId = Number(req.params.id);
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";

  if (!Number.isInteger(scheduleId) || scheduleId < 1) {
    return res.status(400).json({ message: "Invalid class schedule ID." });
  }

  try {
    const [rows] = await pool.query(
      `SELECT cs.*, c.title as course_title,
              s.student_name, s.grade, s.parent_name, s.phone as student_phone, s.email as student_email,
              u.full_name as instructor_full_name
       FROM class_schedules cs
       LEFT JOIN courses c ON c.id = cs.course_id
       LEFT JOIN students s ON s.id = cs.student_id
       LEFT JOIN users u ON u.id = cs.instructor_id
       WHERE cs.id = ? LIMIT 1`,
      [scheduleId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Class schedule not found." });
    }

    const cls = rows[0];

    const isAssigned = cls.instructor_id === instructorId || cls.teacher_name === req.user.name;
    if (!isAssigned && !isAdmin) {
      return res.status(403).json({
        message: "Forbidden: You are not assigned to instruct this class session.",
        classId: scheduleId
      });
    }

    res.json({ classSession: cls });
  } catch (error) {
    console.error("Instructor class details error:", error.message);
    res.status(500).json({ message: "Unable to load class session." });
  }
});

/**
 * PATCH /api/instructor/schedules/:id
 * Allows authorized instructor to update Teams meeting URL, instructions, or status.
 */
router.patch("/schedules/:id", async (req, res) => {
  const scheduleId = Number(req.params.id);
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";
  const { meetingUrl, instructions, status } = req.body || {};

  if (!Number.isInteger(scheduleId) || scheduleId < 1) {
    return res.status(400).json({ message: "Invalid schedule ID." });
  }

  try {
    const [rows] = await pool.query("SELECT * FROM class_schedules WHERE id = ?", [scheduleId]);
    if (!rows.length) return res.status(404).json({ message: "Schedule not found." });
    const cur = rows[0];

    // Check ownership
    const isAssigned = cur.instructor_id === instructorId || cur.teacher_name === req.user.name;
    if (!isAssigned && !isAdmin) {
      return res.status(403).json({ message: "Forbidden: You are not authorized to update this schedule." });
    }

    let finalMeetingUrl = cur.meeting_url;
    if (meetingUrl !== undefined) {
      if (meetingUrl === "" || meetingUrl === null) {
        finalMeetingUrl = null;
      } else {
        const urlValidation = validateTeamsMeetingUrl(meetingUrl);
        if (!urlValidation.valid) {
          return res.status(400).json({ message: urlValidation.error });
        }
        finalMeetingUrl = urlValidation.normalizedUrl;
      }
    }

    const finalInstructions = instructions !== undefined
      ? (typeof instructions === "string" ? instructions.slice(0, 2000) : null)
      : cur.instructions;

    const finalStatus = status !== undefined && ["scheduled", "completed", "cancelled"].includes(status)
      ? status
      : cur.status;

    await pool.query(
      `UPDATE class_schedules 
       SET meeting_url = ?, instructions = ?, status = ?
       WHERE id = ?`,
      [finalMeetingUrl, finalInstructions, finalStatus, scheduleId]
    );

    res.json({
      message: "Schedule updated successfully.",
      schedule: {
        id: scheduleId,
        meeting_url: finalMeetingUrl,
        instructions: finalInstructions,
        status: finalStatus
      }
    });
  } catch (err) {
    console.error("Instructor update schedule error:", err.message);
    res.status(500).json({ message: "Unable to update schedule." });
  }
});

/**
 * GET /api/instructor/resources
 * Retrieve resources shared for instructor's courses.
 */
router.get("/resources", async (req, res) => {
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";

  try {
    const [resources] = await pool.query(
      isAdmin
        ? `SELECT cr.*, c.title as course_title, u.full_name as instructor_name
           FROM class_resources cr
           JOIN courses c ON c.id = cr.course_id
           JOIN users u ON u.id = cr.instructor_id
           ORDER BY cr.created_at DESC`
        : `SELECT cr.*, c.title as course_title, u.full_name as instructor_name
           FROM class_resources cr
           JOIN courses c ON c.id = cr.course_id
           JOIN users u ON u.id = cr.instructor_id
           WHERE cr.instructor_id = ?
           ORDER BY cr.created_at DESC`,
      isAdmin ? [] : [instructorId]
    );

    res.json({ resources });
  } catch (err) {
    console.error("Instructor resources error:", err.message);
    res.status(500).json({ message: "Unable to load teaching resources." });
  }
});

/**
 * POST /api/instructor/resources
 * Share learning link or supplementary material with students.
 */
router.post("/resources", async (req, res) => {
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";
  const { courseId, title, resourceType = "link", url, description = "" } = req.body || {};

  const cleanCourseId = Number(courseId);
  const cleanTitle = typeof title === "string" ? title.trim().slice(0, 200) : "";
  const cleanUrl = typeof url === "string" ? url.trim().slice(0, 500) : "";

  if (!Number.isInteger(cleanCourseId) || cleanCourseId < 1 || !cleanTitle || !cleanUrl) {
    return res.status(400).json({ message: "Course, title, and valid URL are required." });
  }

  if (!/^https?:\/\/\S+$/i.test(cleanUrl)) {
    return res.status(400).json({ message: "Resource URL must start with http:// or https://." });
  }

  try {
    // Verify instructor is assigned to course
    const [courses] = await pool.query("SELECT * FROM courses WHERE id = ?", [cleanCourseId]);
    if (!courses.length) return res.status(404).json({ message: "Course not found." });

    if (!isAdmin && courses[0].instructor_user_id !== instructorId) {
      return res.status(403).json({ message: "Forbidden: You are not assigned to instruct this course." });
    }

    const [result] = await pool.query(
      `INSERT INTO class_resources (course_id, instructor_id, title, resource_type, url, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cleanCourseId, instructorId, cleanTitle, resourceType, cleanUrl, description.slice(0, 1000)]
    );

    res.status(201).json({
      message: "Resource shared successfully.",
      resourceId: result.insertId
    });
  } catch (err) {
    console.error("Create resource error:", err.message);
    res.status(500).json({ message: "Unable to share resource." });
  }
});

/**
 * DELETE /api/instructor/resources/:id
 */
router.delete("/resources/:id", async (req, res) => {
  const resourceId = Number(req.params.id);
  const instructorId = req.user.id;
  const isAdmin = req.user.role === "admin";

  try {
    const [resRows] = await pool.query("SELECT * FROM class_resources WHERE id = ?", [resourceId]);
    if (!resRows.length) return res.status(404).json({ message: "Resource not found." });

    if (!isAdmin && resRows[0].instructor_id !== instructorId) {
      return res.status(403).json({ message: "Forbidden: You can only delete resources you shared." });
    }

    await pool.query("DELETE FROM class_resources WHERE id = ?", [resourceId]);
    res.json({ message: "Resource deleted." });
  } catch (err) {
    console.error("Delete resource error:", err.message);
    res.status(500).json({ message: "Unable to delete resource." });
  }
});

export default router;
