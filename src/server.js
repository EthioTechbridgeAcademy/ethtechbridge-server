import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { requireAdmin } from "./auth.js";
import { sendEmail } from "./mailer.js";
import { validateTeamsMeetingUrl } from "./utils/teamsUrl.js";

// Import modular feature routers
import authRoutes from "./routes/authRoutes.js";
import courseRoutes from "./routes/courseRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import certificateRoutes from "./routes/certificateRoutes.js";
import instructorRoutes from "./routes/instructorRoutes.js";
import {
  publicRouter as applicationRoutes,
  adminRouter as adminApplicationRoutes
} from "./routes/applicationRoutes.js";

const app = express();
const port = Number(process.env.PORT || 5000);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be set to a random string of at least 32 characters.");
  process.exit(1);
}

// Trust reverse proxy (e.g. Render, Railway, Nginx, Cloudflare, Vercel) for accurate client IP rate limiting
if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// Security headers with cross-origin resource policy support for API clients
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

// CORS configuration supporting development and production deployments
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "https://ethtechbridgeacademy.vercel.app",
  process.env.CLIENT_ORIGIN
].filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true; // Allow non-browser requests
  if (allowedOrigins.includes(origin)) return true;
  try {
    const url = new URL(origin);
    // Allow legitimate Vercel preview environments belonging to the academy project
    if (url.protocol === "https:" && url.hostname.endsWith(".vercel.app") && url.hostname.includes("ethtechbridgeacademy")) {
      return true;
    }
  } catch {}
  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin) || process.env.NODE_ENV !== "production") {
        callback(null, true);
      } else {
        callback(new Error("CORS policy restriction."));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json({ limit: "50kb" }));

// Rate limiting for sensitive operations
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication requests. Please try again later." }
});

const regLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many registration attempts. Please try again later." }
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset or account activation requests. Please try again later." }
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", regLimiter);
app.use("/api/auth/forgot-password", passwordResetLimiter);
app.use("/api/auth/reset-password", passwordResetLimiter);
app.use("/api/auth/activate-account", passwordResetLimiter);
app.use("/api/registrations", regLimiter);
app.use("/api/applications", regLimiter);

// Health check endpoint
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      academy: "Ethio Techbridge Academy API",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({ status: "error", database: "unavailable", error: err.message });
  }
});

// Mount platform routers
app.use("/api/auth", authRoutes);
app.use("/api", courseRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/instructor", instructorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/applications", adminApplicationRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/certificates", certificateRoutes);

// ============================================================================
// PRESERVED TUTORING & LEAD CAPTURE ENDPOINTS (BACKWARDS COMPATIBILITY)
// ============================================================================

app.post("/api/registrations", async (req, res) => {
  const {
    studentName, grade, parentName, phone, email = "",
    preferredSubjects = "", notes = ""
  } = req.body || {};

  const gradeNumber = Number(grade);
  const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const student = clean(studentName, 150);
  const parent = clean(parentName, 150);
  const telephone = clean(phone, 30);
  const studentEmail = clean(email, 190).toLowerCase();
  const subjects = clean(preferredSubjects, 500);
  const extraNotes = clean(notes, 1000);

  if (!student || !parent || !telephone || !Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 12) {
    return res.status(400).json({ message: "Student name, parent name, phone and a grade from 1 to 12 are required." });
  }
  if (studentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
    return res.status(400).json({ message: "Please enter a valid email address." });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO students
       (student_name, grade, parent_name, phone, email, preferred_subjects, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [student, gradeNumber, parent, telephone, studentEmail || null, subjects || null, extraNotes || null]
    );

    let emailStatus = "skipped";
    if (studentEmail && process.env.SMTP_HOST) {
      const mailResult = await sendEmail({
        to: studentEmail,
        subject: "Registration received — Ethio Techbridge Academy",
        text: `Hello ${parent}, we received the tutoring registration for ${student}. Our academic counseling team will contact you with the next steps.`,
        html: `<p>Hello ${escapeHtml(parent)},</p><p>We received the registration for <strong>${escapeHtml(student)}</strong> (Grade ${gradeNumber}). Our academic counseling team will contact you with the next steps.</p>`
      });
      emailStatus = mailResult.status;
      await pool.execute(
        "INSERT INTO notification_logs (student_id, recipient_email, subject, status, error_message) VALUES (?, ?, ?, ?, ?)",
        [result.insertId, studentEmail, "Registration received", mailResult.status, mailResult.error]
      );
    }

    res.status(201).json({
      message: "Registration received successfully.",
      registrationId: result.insertId,
      emailStatus
    });
  } catch (error) {
    console.error("Registration error:", error.message);
    res.status(500).json({ message: "Could not save registration. Please try again." });
  }
});

// Admin tutoring student summaries
app.get("/api/admin/summary", requireAdmin, async (_req, res) => {
  try {
    const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM students");
    const [statuses] = await pool.query("SELECT status, COUNT(*) AS count FROM students GROUP BY status");
    const [grades] = await pool.query("SELECT grade, COUNT(*) AS count FROM students GROUP BY grade ORDER BY grade");
    res.json({ total, statuses, grades });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load summary." });
  }
});

app.get("/api/admin/students", requireAdmin, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const grade = Number(req.query.grade || 0);
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const where = [];
  const values = [];
  if (search) {
    where.push("(student_name LIKE ? OR parent_name LIKE ? OR phone LIKE ? OR email LIKE ?)");
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern);
  }
  if (Number.isInteger(grade) && grade >= 1 && grade <= 12) {
    where.push("grade = ?");
    values.push(grade);
  }
  if (["pending", "approved", "assigned", "inactive"].includes(status)) {
    where.push("status = ?");
    values.push(status);
  }
  const sql = `SELECT id, student_name, grade, parent_name, phone, email,
    preferred_subjects, notes, status, assigned_grade, created_at
    FROM students ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC LIMIT 500`;

  try {
    const [students] = await pool.execute(sql, values);
    res.json({ students });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load students." });
  }
});

app.patch("/api/admin/students/:id/assign", requireAdmin, async (req, res) => {
  const studentId = Number(req.params.id);
  const assignedGrade = Number(req.body?.assignedGrade);
  if (!Number.isInteger(studentId) || studentId < 1 || !Number.isInteger(assignedGrade) || assignedGrade < 1 || assignedGrade > 12) {
    return res.status(400).json({ message: "A valid student and grade from 1 to 12 are required." });
  }
  try {
    const [result] = await pool.execute(
      "UPDATE students SET assigned_grade = ?, status = 'assigned' WHERE id = ?",
      [assignedGrade, studentId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Student not found." });
    res.json({ message: "Grade assigned successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not assign grade." });
  }
});

app.post("/api/admin/schedules", requireAdmin, async (req, res) => {
  const courseId = req.body?.courseId ? Number(req.body.courseId) : null;
  const instructorId = req.body?.instructorId ? Number(req.body.instructorId) : null;
  const studentId = req.body?.studentId ? Number(req.body.studentId) : null;
  const subjectName = typeof req.body?.subjectName === "string" ? req.body.subjectName.trim().slice(0, 120) : "";
  const classDate = typeof req.body?.classDate === "string" ? req.body.classDate : "";
  const startTime = typeof req.body?.startTime === "string" ? req.body.startTime : "";
  const endTime = typeof req.body?.endTime === "string" && req.body.endTime ? req.body.endTime : null;
  let teacherName = typeof req.body?.teacherName === "string" ? req.body.teacherName.trim().slice(0, 150) : "";
  const meetingUrl = typeof req.body?.meetingUrl === "string" ? req.body.meetingUrl.trim() : "";
  const timezone = typeof req.body?.timezone === "string" && req.body.timezone.trim() ? req.body.timezone.trim() : "Africa/Addis_Ababa";
  const instructions = typeof req.body?.instructions === "string" ? req.body.instructions.trim().slice(0, 2000) : null;
  const status = typeof req.body?.status === "string" && ["scheduled", "completed", "cancelled"].includes(req.body.status) ? req.body.status : "scheduled";

  if (!subjectName || !/^\d{4}-\d{2}-\d{2}$/.test(classDate) || !/^\d{2}:\d{2}(:\d{2})?$/.test(startTime)) {
    return res.status(400).json({ message: "Subject, date, and start time are required." });
  }

  // Validate Microsoft Teams meeting URL if provided
  let normalizedTeamsUrl = null;
  if (meetingUrl) {
    const validResult = validateTeamsMeetingUrl(meetingUrl);
    if (!validResult.valid) {
      return res.status(400).json({ message: validResult.error });
    }
    normalizedTeamsUrl = validResult.normalizedUrl;
  }

  try {
    // If instructorId provided, look up instructor full name
    if (instructorId) {
      const [instRows] = await pool.query("SELECT full_name FROM users WHERE id = ?", [instructorId]);
      if (instRows.length) {
        teacherName = instRows[0].full_name;
      }
    }

    if (studentId) {
      const [studentRows] = await pool.execute(
        "SELECT id, student_name, parent_name, email FROM students WHERE id = ?", [studentId]
      );
      if (!studentRows.length) return res.status(404).json({ message: "Student not found." });
    }

    const [result] = await pool.execute(
      `INSERT INTO class_schedules
       (course_id, instructor_id, student_id, subject_name, class_date, start_time, end_time, timezone, teacher_name, meeting_url, instructions, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courseId || null,
        instructorId || null,
        studentId || null,
        subjectName,
        classDate,
        startTime,
        endTime,
        timezone,
        teacherName || null,
        normalizedTeamsUrl,
        instructions,
        status,
        req.admin?.id || null
      ]
    );

    res.status(201).json({
      message: "Class schedule created successfully.",
      scheduleId: result.insertId,
      meetingUrl: normalizedTeamsUrl
    });
  } catch (error) {
    console.error("Create schedule error:", error.message);
    res.status(500).json({ message: "Could not save the class schedule." });
  }
});

app.get("/api/admin/schedules", requireAdmin, async (req, res) => {
  const { courseId, instructorId, date, missingLink } = req.query || {};

  try {
    const conditions = [];
    const params = [];

    if (courseId) {
      conditions.push("cs.course_id = ?");
      params.push(Number(courseId));
    }
    if (instructorId) {
      conditions.push("cs.instructor_id = ?");
      params.push(Number(instructorId));
    }
    if (date) {
      conditions.push("cs.class_date = ?");
      params.push(date);
    }
    if (missingLink === "true") {
      conditions.push("(cs.meeting_url IS NULL OR cs.meeting_url = '')");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [schedules] = await pool.query(
      `SELECT cs.*,
              c.title as course_title, c.slug as course_slug,
              s.student_name, s.parent_name, s.email as student_email, s.phone as student_phone,
              u.full_name as instructor_full_name, u.email as instructor_email
       FROM class_schedules cs
       LEFT JOIN courses c ON c.id = cs.course_id
       LEFT JOIN students s ON s.id = cs.student_id
       LEFT JOIN users u ON u.id = cs.instructor_id
       ${whereClause}
       ORDER BY cs.class_date DESC, cs.start_time DESC LIMIT 500`,
      params
    );
    res.json({ schedules });
  } catch (error) {
    console.error("Admin schedules error:", error.message);
    res.status(500).json({ message: "Unable to load schedules." });
  }
});

app.put("/api/admin/schedules/:id", requireAdmin, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!Number.isInteger(scheduleId) || scheduleId < 1) {
    return res.status(400).json({ message: "Invalid schedule ID." });
  }

  const {
    courseId, instructorId, studentId, subjectName, classDate,
    startTime, endTime, timezone, teacherName, meetingUrl, instructions, status
  } = req.body || {};

  // Validate Microsoft Teams meeting URL if provided
  let normalizedTeamsUrl = null;
  if (meetingUrl !== undefined && meetingUrl !== null && meetingUrl.trim() !== "") {
    const validResult = validateTeamsMeetingUrl(meetingUrl);
    if (!validResult.valid) {
      return res.status(400).json({ message: validResult.error });
    }
    normalizedTeamsUrl = validResult.normalizedUrl;
  }

  try {
    const [rows] = await pool.query("SELECT * FROM class_schedules WHERE id = ?", [scheduleId]);
    if (!rows.length) return res.status(404).json({ message: "Schedule not found." });
    const cur = rows[0];

    let finalTeacherName = teacherName !== undefined ? teacherName : cur.teacher_name;
    if (instructorId) {
      const [instRows] = await pool.query("SELECT full_name FROM users WHERE id = ?", [instructorId]);
      if (instRows.length) {
        finalTeacherName = instRows[0].full_name;
      }
    }

    await pool.execute(
      `UPDATE class_schedules
       SET course_id = ?, instructor_id = ?, student_id = ?, subject_name = ?,
           class_date = ?, start_time = ?, end_time = ?, timezone = ?,
           teacher_name = ?, meeting_url = ?, instructions = ?, status = ?
       WHERE id = ?`,
      [
        courseId !== undefined ? (courseId ? Number(courseId) : null) : cur.course_id,
        instructorId !== undefined ? (instructorId ? Number(instructorId) : null) : cur.instructor_id,
        studentId !== undefined ? (studentId ? Number(studentId) : null) : cur.student_id,
        subjectName !== undefined ? String(subjectName).trim().slice(0, 120) : cur.subject_name,
        classDate !== undefined ? classDate : cur.class_date,
        startTime !== undefined ? startTime : cur.start_time,
        endTime !== undefined ? endTime : cur.end_time,
        timezone !== undefined ? timezone : cur.timezone,
        finalTeacherName,
        meetingUrl !== undefined ? normalizedTeamsUrl : cur.meeting_url,
        instructions !== undefined ? instructions : cur.instructions,
        status !== undefined ? status : cur.status,
        scheduleId
      ]
    );

    res.json({ message: "Schedule updated successfully." });
  } catch (error) {
    console.error("Admin update schedule error:", error.message);
    res.status(500).json({ message: "Failed to update schedule." });
  }
});

app.delete("/api/admin/schedules/:id", requireAdmin, async (req, res) => {
  const scheduleId = Number(req.params.id);
  try {
    const [result] = await pool.execute("DELETE FROM class_schedules WHERE id = ?", [scheduleId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Schedule not found." });
    res.json({ message: "Schedule deleted successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not delete schedule." });
  }
});

// Announcements endpoints
app.get("/api/announcements", async (_req, res) => {
  try {
    const [announcements] = await pool.query(
      "SELECT id, title, category, content, excerpt, video_url, status, created_at FROM announcements WHERE status = 'active' ORDER BY created_at DESC LIMIT 50"
    );
    res.json({ announcements });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load announcements." });
  }
});

app.get("/api/admin/announcements", requireAdmin, async (_req, res) => {
  try {
    const [announcements] = await pool.query(
      "SELECT id, title, category, content, excerpt, video_url, status, created_at FROM announcements ORDER BY created_at DESC LIMIT 100"
    );
    res.json({ announcements });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load announcements." });
  }
});

app.post("/api/admin/announcements", requireAdmin, async (req, res) => {
  const { title, category = "General", content, excerpt = "", videoUrl = "", status = "active" } = req.body || {};
  if (!title || !content) return res.status(400).json({ message: "Title and content are required." });

  try {
    const [result] = await pool.execute(
      `INSERT INTO announcements (title, category, content, excerpt, video_url, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(title).trim().slice(0, 255),
        String(category).trim().slice(0, 80),
        String(content).trim(),
        String(excerpt).trim().slice(0, 500) || null,
        String(videoUrl).trim().slice(0, 500) || null,
        ["active", "draft", "archived"].includes(status) ? status : "active"
      ]
    );
    res.status(201).json({ message: "Announcement published successfully.", announcementId: result.insertId });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not save announcement." });
  }
});

app.delete("/api/admin/announcements/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [result] = await pool.execute("DELETE FROM announcements WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Announcement not found." });
    res.json({ message: "Announcement deleted successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not delete announcement." });
  }
});

app.get("/api/admin/notifications", requireAdmin, async (_req, res) => {
  try {
    const [notifications] = await pool.query(
      `SELECT id, student_id, recipient_email, subject, status, error_message, created_at
       FROM notification_logs ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ notifications });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load notification history." });
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Unexpected server error." });
});

app.listen(port, () => console.log(`Ethio Techbridge Academy API listening on http://localhost:${port}`));
