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

const app = express();
const port = Number(process.env.PORT || 5000);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be set to a random string of at least 32 characters.");
  process.exit(1);
}

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5174" }));
app.use(express.json({ limit: "20kb" }));
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use("/api/registrations", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.post("/api/registrations", async (req, res) => {
  const {
    studentName, grade, parentName, phone, email = "",
    preferredSubjects = "", notes = ""
  } = req.body || {};

  const gradeNumber = Number(grade);
  const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
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
    if (studentEmail) {
      const mailResult = await sendEmail({
        to: studentEmail,
        subject: "Registration received",
        text: `Hello ${parent}, we received the registration for ${student}. The school will contact you with the next steps.`,
        html: `<p>Hello ${escapeHtml(parent)},</p><p>We received the registration for <strong>${escapeHtml(student)}</strong> (Grade ${gradeNumber}). The school will contact you with the next steps.</p>`
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

app.post("/api/auth/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) return res.status(400).json({ message: "Email and password are required." });

  try {
    const [rows] = await pool.execute(
      "SELECT id, full_name, email, password_hash FROM admins WHERE email = ? LIMIT 1", [email]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }
    const admin = rows[0];
    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.full_name, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ token, admin: { id: admin.id, name: admin.full_name, email: admin.email } });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Unable to sign in right now." });
  }
});

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
  if (!Number.isInteger(studentId) || studentId < 1 ||
      !Number.isInteger(assignedGrade) || assignedGrade < 1 || assignedGrade > 12) {
    return res.status(400).json({ message: "A valid student and grade from 1 to 12 are required." });
  }
  try {
    const [result] = await pool.execute(
      "UPDATE students SET assigned_grade = ?, status = 'assigned' WHERE id = ?",
      [assignedGrade, studentId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Student not found." });
    const [rows] = await pool.execute(
      "SELECT student_name, parent_name, email FROM students WHERE id = ?", [studentId]
    );
    const student = rows[0];
    if (student.email) {
      const mailResult = await sendEmail({
        to: student.email,
        subject: `Class assignment confirmed — Grade ${assignedGrade}`,
        text: `Hello ${student.parent_name}, ${student.student_name} has been assigned to Grade ${assignedGrade}. The school will share the class schedule soon.`,
        html: `<p>Hello ${escapeHtml(student.parent_name)},</p><p><strong>${escapeHtml(student.student_name)}</strong> has been assigned to Grade ${assignedGrade}. The school will share the class schedule soon.</p>`
      });
      await pool.execute(
        "INSERT INTO notification_logs (student_id, recipient_email, subject, status, error_message) VALUES (?, ?, ?, ?, ?)",
        [studentId, student.email, "Class assignment confirmed", mailResult.status, mailResult.error]
      );
    }
    res.json({ message: "Grade assigned successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not assign grade." });
  }
});

app.post("/api/admin/schedules", requireAdmin, async (req, res) => {
  const studentId = Number(req.body?.studentId);
  const subjectName = typeof req.body?.subjectName === "string" ? req.body.subjectName.trim().slice(0, 120) : "";
  const classDate = typeof req.body?.classDate === "string" ? req.body.classDate : "";
  const startTime = typeof req.body?.startTime === "string" ? req.body.startTime : "";
  const endTime = typeof req.body?.endTime === "string" && req.body.endTime ? req.body.endTime : null;
  const teacherName = typeof req.body?.teacherName === "string" ? req.body.teacherName.trim().slice(0, 150) : "";
  const meetingUrl = typeof req.body?.meetingUrl === "string" ? req.body.meetingUrl.trim().slice(0, 500) : "";

  if (!Number.isInteger(studentId) || studentId < 1 || !subjectName ||
      !/^\d{4}-\d{2}-\d{2}$/.test(classDate) ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(startTime)) {
    return res.status(400).json({ message: "Student, subject, date and start time are required." });
  }
  if (meetingUrl && !/^https:\/\/\S+$/i.test(meetingUrl)) {
    return res.status(400).json({ message: "Meeting URL must start with https://." });
  }

  try {
    const [studentRows] = await pool.execute(
      "SELECT id, student_name, parent_name, email FROM students WHERE id = ?", [studentId]
    );
    if (!studentRows.length) return res.status(404).json({ message: "Student not found." });

    const [result] = await pool.execute(
      `INSERT INTO class_schedules
       (student_id, subject_name, class_date, start_time, end_time, teacher_name, meeting_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [studentId, subjectName, classDate, startTime, endTime, teacherName || null, meetingUrl || null, req.admin.id]
    );

    const student = studentRows[0];
    if (student.email) {
      const mailResult = await sendEmail({
        to: student.email,
        subject: `Class schedule: ${subjectName}`,
        text: `Hello ${student.parent_name}, class for ${student.student_name}: ${subjectName}, date ${classDate}, time ${startTime}${meetingUrl ? ", join: " + meetingUrl : ""}.`,
        html: `<p>Hello ${escapeHtml(student.parent_name)},</p><p>Class for <strong>${escapeHtml(student.student_name)}</strong>:</p><p>${escapeHtml(subjectName)} — ${escapeHtml(classDate)} at ${escapeHtml(startTime)}${endTime ? " until " + escapeHtml(endTime) : ""}</p>${meetingUrl ? `<p><a href="${escapeHtml(meetingUrl)}">Join online class</a></p>` : ""}`
      });
      await pool.execute(
        "INSERT INTO notification_logs (student_id, recipient_email, subject, status, error_message) VALUES (?, ?, ?, ?, ?)",
        [studentId, student.email, `Class schedule: ${subjectName}`, mailResult.status, mailResult.error]
      );
    }
    res.status(201).json({ message: "Class schedule saved.", scheduleId: result.insertId });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not save the class schedule." });
  }
});

app.get("/api/admin/schedules", requireAdmin, async (_req, res) => {
  try {
    const [schedules] = await pool.query(
      `SELECT cs.id, cs.student_id, s.student_name, s.parent_name, s.email,
       cs.subject_name, cs.class_date, cs.start_time, cs.end_time, cs.teacher_name, cs.meeting_url
       FROM class_schedules cs JOIN students s ON s.id = cs.student_id
       ORDER BY cs.class_date, cs.start_time LIMIT 500`
    );
    res.json({ schedules });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load schedules." });
  }
});

app.post("/api/admin/students", requireAdmin, async (req, res) => {
  const { studentName, grade, parentName, phone, email = "", preferredSubjects = "", notes = "", status = "approved" } = req.body || {};
  const gradeNumber = Number(grade);
  const clean = (val, max) => (typeof val === "string" ? val.trim().slice(0, max) : "");
  const student = clean(studentName, 150);
  const parent = clean(parentName, 150);
  const telephone = clean(phone, 30);
  const studentEmail = clean(email, 190).toLowerCase();
  const subjects = clean(preferredSubjects, 500);
  const extraNotes = clean(notes, 1000);
  const validStatus = ["pending", "approved", "assigned", "inactive"].includes(status) ? status : "approved";

  if (!student || !parent || !telephone || !Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 12) {
    return res.status(400).json({ message: "Student name, parent name, phone, and grade (1-12) are required." });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO students (student_name, grade, parent_name, phone, email, preferred_subjects, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [student, gradeNumber, parent, telephone, studentEmail || null, subjects || null, extraNotes || null, validStatus]
    );
    res.status(201).json({ message: "Student record created successfully.", studentId: result.insertId });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not create student record." });
  }
});

app.put("/api/admin/students/:id", requireAdmin, async (req, res) => {
  const studentId = Number(req.params.id);
  if (!Number.isInteger(studentId) || studentId < 1) return res.status(400).json({ message: "Invalid student ID." });

  const { studentName, grade, parentName, phone, email, preferredSubjects, notes, status, assignedGrade } = req.body || {};
  const clean = (val, max) => (typeof val === "string" ? val.trim().slice(0, max) : "");

  try {
    const [rows] = await pool.execute("SELECT * FROM students WHERE id = ?", [studentId]);
    if (!rows.length) return res.status(404).json({ message: "Student not found." });
    const current = rows[0];

    const updatedStudent = studentName !== undefined ? clean(studentName, 150) : current.student_name;
    const updatedGrade = grade !== undefined ? Number(grade) : current.grade;
    const updatedParent = parentName !== undefined ? clean(parentName, 150) : current.parent_name;
    const updatedPhone = phone !== undefined ? clean(phone, 30) : current.phone;
    const updatedEmail = email !== undefined ? clean(email, 190).toLowerCase() : current.email;
    const updatedSubjects = preferredSubjects !== undefined ? clean(preferredSubjects, 500) : current.preferred_subjects;
    const updatedNotes = notes !== undefined ? clean(notes, 1000) : current.notes;
    const updatedStatus = ["pending", "approved", "assigned", "inactive"].includes(status) ? status : current.status;
    const updatedAssignedGrade = assignedGrade !== undefined && assignedGrade !== null && assignedGrade !== "" ? Number(assignedGrade) : current.assigned_grade;

    await pool.execute(
      `UPDATE students
       SET student_name = ?, grade = ?, parent_name = ?, phone = ?, email = ?,
           preferred_subjects = ?, notes = ?, status = ?, assigned_grade = ?
       WHERE id = ?`,
      [updatedStudent, updatedGrade, updatedParent, updatedPhone, updatedEmail || null, updatedSubjects || null, updatedNotes || null, updatedStatus, updatedAssignedGrade || null, studentId]
    );

    res.json({ message: "Student details updated successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not update student details." });
  }
});

app.delete("/api/admin/students/:id", requireAdmin, async (req, res) => {
  const studentId = Number(req.params.id);
  if (!Number.isInteger(studentId) || studentId < 1) return res.status(400).json({ message: "Invalid student ID." });

  try {
    await pool.execute("DELETE FROM class_schedules WHERE student_id = ?", [studentId]);
    await pool.execute("DELETE FROM notification_logs WHERE student_id = ?", [studentId]);
    const [result] = await pool.execute("DELETE FROM students WHERE id = ?", [studentId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Student not found." });
    res.json({ message: "Student record deleted successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not delete student record." });
  }
});

// --- SCHEDULES UPDATE & DELETE ---
app.put("/api/admin/schedules/:id", requireAdmin, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!Number.isInteger(scheduleId) || scheduleId < 1) return res.status(400).json({ message: "Invalid schedule ID." });

  const { subjectName, classDate, startTime, endTime, teacherName, meetingUrl } = req.body || {};
  try {
    const [rows] = await pool.execute("SELECT * FROM class_schedules WHERE id = ?", [scheduleId]);
    if (!rows.length) return res.status(404).json({ message: "Schedule not found." });
    const cur = rows[0];

    const sName = subjectName ? String(subjectName).trim().slice(0, 120) : cur.subject_name;
    const cDate = classDate || cur.class_date;
    const sTime = startTime || cur.start_time;
    const eTime = endTime !== undefined ? (endTime || null) : cur.end_time;
    const tName = teacherName !== undefined ? String(teacherName).trim().slice(0, 150) : cur.teacher_name;
    const mUrl = meetingUrl !== undefined ? String(meetingUrl).trim().slice(0, 500) : cur.meeting_url;

    await pool.execute(
      `UPDATE class_schedules
       SET subject_name = ?, class_date = ?, start_time = ?, end_time = ?, teacher_name = ?, meeting_url = ?
       WHERE id = ?`,
      [sName, cDate, sTime, eTime, tName || null, mUrl || null, scheduleId]
    );

    res.json({ message: "Schedule updated successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not update schedule." });
  }
});

app.delete("/api/admin/schedules/:id", requireAdmin, async (req, res) => {
  const scheduleId = Number(req.params.id);
  if (!Number.isInteger(scheduleId) || scheduleId < 1) return res.status(400).json({ message: "Invalid schedule ID." });

  try {
    const [result] = await pool.execute("DELETE FROM class_schedules WHERE id = ?", [scheduleId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Schedule not found." });
    res.json({ message: "Schedule deleted successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not delete schedule." });
  }
});

// --- ANNOUNCEMENTS / NEWS CRUD ---
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

app.put("/api/admin/announcements/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid announcement ID." });
  const { title, category, content, excerpt, videoUrl, status } = req.body || {};

  try {
    const [rows] = await pool.execute("SELECT * FROM announcements WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ message: "Announcement not found." });
    const cur = rows[0];

    await pool.execute(
      `UPDATE announcements
       SET title = ?, category = ?, content = ?, excerpt = ?, video_url = ?, status = ?
       WHERE id = ?`,
      [
        title !== undefined ? String(title).trim().slice(0, 255) : cur.title,
        category !== undefined ? String(category).trim().slice(0, 80) : cur.category,
        content !== undefined ? String(content).trim() : cur.content,
        excerpt !== undefined ? String(excerpt).trim().slice(0, 500) : cur.excerpt,
        videoUrl !== undefined ? String(videoUrl).trim().slice(0, 500) : cur.video_url,
        status !== undefined && ["active", "draft", "archived"].includes(status) ? status : cur.status,
        id
      ]
    );
    res.json({ message: "Announcement updated successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not update announcement." });
  }
});

app.delete("/api/admin/announcements/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid announcement ID." });

  try {
    const [result] = await pool.execute("DELETE FROM announcements WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Announcement not found." });
    res.json({ message: "Announcement deleted successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not delete announcement." });
  }
});

// --- COURSES & MEDIA CRUD ---
app.get("/api/courses", async (_req, res) => {
  try {
    const [courses] = await pool.query(
      "SELECT id, title, format, grade_range, description, topics, video_url, created_at FROM courses ORDER BY id ASC"
    );
    res.json({ courses });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load courses." });
  }
});

app.get("/api/admin/courses", requireAdmin, async (_req, res) => {
  try {
    const [courses] = await pool.query(
      "SELECT id, title, format, grade_range, description, topics, video_url, created_at FROM courses ORDER BY id ASC"
    );
    res.json({ courses });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Unable to load courses." });
  }
});

app.post("/api/admin/courses", requireAdmin, async (req, res) => {
  const { title, format = "hybrid", gradeRange = "Grades 1-12", description, topics = "", videoUrl = "" } = req.body || {};
  if (!title || !description) return res.status(400).json({ message: "Course title and description are required." });

  try {
    const [result] = await pool.execute(
      `INSERT INTO courses (title, format, grade_range, description, topics, video_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(title).trim().slice(0, 200),
        ["online", "campus", "hybrid"].includes(format) ? format : "hybrid",
        String(gradeRange).trim().slice(0, 80),
        String(description).trim(),
        String(topics).trim().slice(0, 500) || null,
        String(videoUrl).trim().slice(0, 500) || null
      ]
    );
    res.status(201).json({ message: "Course created successfully.", courseId: result.insertId });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not save course." });
  }
});

app.put("/api/admin/courses/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid course ID." });
  const { title, format, gradeRange, description, topics, videoUrl } = req.body || {};

  try {
    const [rows] = await pool.execute("SELECT * FROM courses WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ message: "Course not found." });
    const cur = rows[0];

    await pool.execute(
      `UPDATE courses
       SET title = ?, format = ?, grade_range = ?, description = ?, topics = ?, video_url = ?
       WHERE id = ?`,
      [
        title !== undefined ? String(title).trim().slice(0, 200) : cur.title,
        format !== undefined && ["online", "campus", "hybrid"].includes(format) ? format : cur.format,
        gradeRange !== undefined ? String(gradeRange).trim().slice(0, 80) : cur.grade_range,
        description !== undefined ? String(description).trim() : cur.description,
        topics !== undefined ? String(topics).trim().slice(0, 500) : cur.topics,
        videoUrl !== undefined ? String(videoUrl).trim().slice(0, 500) : cur.video_url,
        id
      ]
    );
    res.json({ message: "Course updated successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not update course." });
  }
});

app.delete("/api/admin/courses/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid course ID." });

  try {
    const [result] = await pool.execute("DELETE FROM courses WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Course not found." });
    res.json({ message: "Course deleted successfully." });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not delete course." });
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

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Unexpected server error." });
});

app.listen(port, () => console.log(`School Tutorial API listening on http://localhost:${port}`));
