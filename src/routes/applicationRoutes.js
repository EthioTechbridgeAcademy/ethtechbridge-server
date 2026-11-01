import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAdmin, requireAuth, optionalAuth } from "../auth.js";
import { sendEmail } from "../mailer.js";

export const publicRouter = express.Router();
export const adminRouter = express.Router();

// Helper to sanitize strings
function clean(val, max = 255) {
  return typeof val === "string" ? val.trim().slice(0, max) : "";
}

// Generate unique human-readable application number: APP-YYYY-XXXXXX
async function generateUniqueAppNumber() {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase();
    const candidate = `APP-${year}-${randomHex}`;
    const [existing] = await pool.query(
      "SELECT id FROM applications WHERE application_number = ? LIMIT 1",
      [candidate]
    );
    if (existing.length === 0) {
      return candidate;
    }
  }
  // Fallback with timestamp
  return `APP-${year}-${Date.now().toString().slice(-6)}`;
}

// Normalize phone number (removes extra punctuation/spaces, preserves leading +)
function normalizePhone(phone) {
  if (!phone) return "";
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  return cleaned.slice(0, 35);
}

// Prevent CSV formula injection for spreadsheet safety
function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val).replace(/"/g, '""');
  // If value starts with unsafe formula characters, prefix with single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str}"`;
}

// ============================================================================
// 1. PUBLIC APPLICANT ROUTE: POST /api/applications
// ============================================================================

// GET /api/applications/my-status - Authenticated applicant checks their own status
publicRouter.get("/my-status", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;

    const [rows] = await pool.query(
      `SELECT id, application_number, full_name, phone, email, grade_level,
              program_interest, preferred_contact, notes, status, admin_notes,
              reviewed_at, converted_at, created_at
       FROM applications
       WHERE user_id = ? OR converted_user_id = ? OR (email IS NOT NULL AND email = ?)
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, userId, userEmail]
    );

    if (rows.length === 0) {
      return res.json({ hasApplication: false, application: null });
    }

    return res.json({
      hasApplication: true,
      application: rows[0]
    });
  } catch (err) {
    console.error("Get my application status error:", err);
    res.status(500).json({ message: "Unable to check admission status." });
  }
});

publicRouter.post("/", optionalAuth, async (req, res) => {
  try {
    const submittingUserId = req.user?.id || null;
    const fullName = clean(req.body.fullName || req.body.full_name, 150);
    const rawPhone = clean(req.body.phone, 35);
    const phone = normalizePhone(rawPhone);
    const rawEmail = clean(req.body.email, 190).toLowerCase();
    const gradeLevel = clean(req.body.gradeLevel || req.body.grade_level, 64);
    const programInterest = clean(req.body.programInterest || req.body.program_interest, 120);
    const preferredContact = clean(req.body.preferredContact || req.body.preferred_contact, 30) || "phone";
    const notes = clean(req.body.notes, 1000);

    // Validation
    const errors = {};
    if (!fullName || fullName.length < 2) {
      errors.fullName = "Full name is required (minimum 2 characters).";
    }
    if (!phone || phone.length < 7) {
      errors.phone = "Valid phone number is required (minimum 7 digits).";
    }
    if (!gradeLevel) {
      errors.gradeLevel = "Please select your grade or academic level.";
    }
    if (!programInterest) {
      errors.programInterest = "Please select a program or course of interest.";
    }
    if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      errors.email = "Please enter a valid email address.";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        message: "Please correct the highlighted errors.",
        errors
      });
    }

    const email = rawEmail || null;

    // Check if this student already has an active pending or under_review application
    const [existingPending] = await pool.query(
      `SELECT id, application_number, program_interest, status 
       FROM applications 
       WHERE (user_id = ? OR (email IS NOT NULL AND email = ?) OR phone = ?)
         AND status IN ('pending', 'under_review')
       LIMIT 1`,
      [submittingUserId || 0, email || "__no_email__", phone]
    );

    if (existingPending.length > 0) {
      return res.status(409).json({
        alreadyPending: true,
        message: "You already have an admission application currently awaiting review. Our admissions team will reach out to you shortly.",
        applicationNumber: existingPending[0].application_number,
        programInterest: existingPending[0].program_interest,
        status: existingPending[0].status
      });
    }

    // Duplicate check: Prevent accidental re-submissions within 24 hours
    const [duplicates] = await pool.query(
      `SELECT id, application_number, created_at 
       FROM applications 
       WHERE (phone = ? OR (email IS NOT NULL AND email = ?)) 
         AND program_interest = ? 
         AND created_at >= NOW() - INTERVAL 24 HOUR 
       LIMIT 1`,
      [phone, email || "__no_email__", programInterest]
    );

    if (duplicates.length > 0) {
      return res.status(409).json({
        message: "An application with this contact information for this program was already received recently. Our admissions team is reviewing it and will reach out to you shortly.",
        applicationNumber: duplicates[0].application_number
      });
    }

    // Generate application number
    const applicationNumber = await generateUniqueAppNumber();

    // Insert application record with user_id
    const [result] = await pool.query(
      `INSERT INTO applications (
        application_number, user_id, full_name, phone, email, 
        grade_level, program_interest, preferred_contact, notes, 
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      [
        applicationNumber,
        submittingUserId,
        fullName,
        phone,
        email,
        gradeLevel,
        programInterest,
        preferredContact,
        notes || null
      ]
    );

    res.status(201).json({
      success: true,
      message: "Your application has been submitted successfully. Our admissions team will review your information and contact you regarding the next steps.",
      applicationNumber,
      application: {
        id: result.insertId,
        applicationNumber,
        fullName,
        status: "pending",
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("Application submission error:", error);
    res.status(500).json({
      message: "Unable to process application at this moment. Please try again or contact admissions."
    });
  }
});

// ============================================================================
// 2. ADMIN APPLICANT ROUTES (Enforce requireAdmin)
// ============================================================================

adminRouter.use(requireAdmin);

// GET /api/admin/applications - List with Search, Filter & Pagination
adminRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const search = clean(req.query.search, 100);
    const status = clean(req.query.status, 30);
    const grade = clean(req.query.grade, 64);
    const program = clean(req.query.program, 120);

    const allowedSortColumns = ["created_at", "full_name", "status", "grade_level", "program_interest"];
    const sortBy = allowedSortColumns.includes(req.query.sortBy) ? req.query.sortBy : "created_at";
    const order = req.query.order === "ASC" ? "ASC" : "DESC";

    // Build dynamic conditions
    const whereClauses = [];
    const params = [];

    if (search) {
      whereClauses.push(
        "(a.full_name LIKE ? OR a.phone LIKE ? OR a.email LIKE ? OR a.application_number LIKE ?)"
      );
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (status && status !== "all") {
      whereClauses.push("a.status = ?");
      params.push(status);
    }

    if (grade && grade !== "all") {
      whereClauses.push("a.grade_level = ?");
      params.push(grade);
    }

    if (program && program !== "all") {
      whereClauses.push("a.program_interest = ?");
      params.push(program);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Count query
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM applications a ${whereSql}`,
      params
    );

    // Applications query
    const [applications] = await pool.query(
      `SELECT a.*, 
              u.full_name as reviewer_name,
              cu.full_name as converted_user_name,
              cu.email as converted_user_email
       FROM applications a
       LEFT JOIN users u ON u.id = a.reviewed_by
       LEFT JOIN users cu ON cu.id = a.converted_user_id
       ${whereSql}
       ORDER BY a.${sortBy} ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Summary counts for badges
    const [[summary]] = await pool.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'under_review' THEN 1 ELSE 0 END) as underReview,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'enrolled' THEN 1 ELSE 0 END) as enrolled
       FROM applications`
    );

    res.json({
      applications,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(total / limit) || 1
      },
      summary: {
        total: Number(summary?.total || 0),
        pending: Number(summary?.pending || 0),
        underReview: Number(summary?.underReview || 0),
        approved: Number(summary?.approved || 0),
        rejected: Number(summary?.rejected || 0),
        enrolled: Number(summary?.enrolled || 0)
      }
    });
  } catch (error) {
    console.error("Admin applications list error:", error);
    res.status(500).json({ message: "Unable to retrieve applications list." });
  }
});

// GET /api/admin/applications/export/csv - Sanitized CSV Export
adminRouter.get("/export/csv", async (req, res) => {
  try {
    const status = clean(req.query.status, 30);
    const search = clean(req.query.search, 100);

    const whereClauses = [];
    const params = [];

    if (search) {
      whereClauses.push(
        "(a.full_name LIKE ? OR a.phone LIKE ? OR a.email LIKE ? OR a.application_number LIKE ?)"
      );
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (status && status !== "all") {
      whereClauses.push("a.status = ?");
      params.push(status);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const [applications] = await pool.query(
      `SELECT a.*, 
              u.full_name as reviewer_name,
              cu.full_name as converted_user_name
       FROM applications a
       LEFT JOIN users u ON u.id = a.reviewed_by
       LEFT JOIN users cu ON cu.id = a.converted_user_id
       ${whereSql}
       ORDER BY a.created_at DESC`,
      params
    );

    const headers = [
      "Application Number",
      "Full Name",
      "Phone",
      "Email",
      "Grade / Level",
      "Program of Interest",
      "Preferred Contact",
      "Status",
      "Notes",
      "Admin Notes",
      "Reviewer",
      "Reviewed At",
      "Converted User",
      "Submitted At"
    ];

    const rows = applications.map((a) => [
      sanitizeCsvCell(a.application_number),
      sanitizeCsvCell(a.full_name),
      sanitizeCsvCell(a.phone),
      sanitizeCsvCell(a.email || ""),
      sanitizeCsvCell(a.grade_level),
      sanitizeCsvCell(a.program_interest),
      sanitizeCsvCell(a.preferred_contact),
      sanitizeCsvCell(a.status),
      sanitizeCsvCell(a.notes || ""),
      sanitizeCsvCell(a.admin_notes || ""),
      sanitizeCsvCell(a.reviewer_name || ""),
      sanitizeCsvCell(a.reviewed_at ? new Date(a.reviewed_at).toISOString() : ""),
      sanitizeCsvCell(a.converted_user_name || ""),
      sanitizeCsvCell(new Date(a.created_at).toISOString())
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    const dateStr = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ethio-techbridge-applications-${dateStr}.csv"`
    );
    res.status(200).send(csvContent);
  } catch (error) {
    console.error("CSV export error:", error);
    res.status(500).json({ message: "Unable to generate CSV export." });
  }
});

// GET /api/admin/applications/:id - Detailed Application View
adminRouter.get("/:id", async (req, res) => {
  try {
    const applicationId = req.params.id;

    const [applications] = await pool.query(
      `SELECT a.*, 
              u.full_name as reviewer_name, u.email as reviewer_email,
              cu.full_name as converted_user_name, cu.email as converted_user_email
       FROM applications a
       LEFT JOIN users u ON u.id = a.reviewed_by
       LEFT JOIN users cu ON cu.id = a.converted_user_id
       WHERE a.id = ? LIMIT 1`,
      [applicationId]
    );

    if (applications.length === 0) {
      return res.status(404).json({ message: "Application not found." });
    }

    const application = applications[0];

    // Find any related applications by phone or email
    const [related] = await pool.query(
      `SELECT id, application_number, program_interest, status, created_at
       FROM applications
       WHERE (phone = ? OR (email IS NOT NULL AND email = ?))
         AND id != ?
       ORDER BY created_at DESC`,
      [application.phone, application.email || "__no_email__", application.id]
    );

    res.json({
      application,
      relatedApplications: related
    });
  } catch (error) {
    console.error("Get application details error:", error);
    res.status(500).json({ message: "Unable to load application details." });
  }
});

// PATCH /api/admin/applications/:id/status - Status Update with Reviewer Audit
adminRouter.patch("/:id/status", async (req, res) => {
  try {
    const applicationId = req.params.id;
    const { status, adminNotes } = req.body;

    const validStatuses = ["pending", "under_review", "approved", "rejected", "enrolled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value specified." });
    }

    const reviewerId = req.user?.id || null;
    const sanitizedNotes = adminNotes !== undefined ? clean(adminNotes, 2000) : null;

    const [result] = await pool.query(
      `UPDATE applications 
       SET status = ?,
           admin_notes = COALESCE(?, admin_notes),
           reviewed_by = ?,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [status, sanitizedNotes, reviewerId, applicationId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Application not found." });
    }

    const [[updated]] = await pool.query(
      `SELECT a.*, u.full_name as reviewer_name 
       FROM applications a
       LEFT JOIN users u ON u.id = a.reviewed_by
       WHERE a.id = ?`,
      [applicationId]
    );

    res.json({
      success: true,
      message: `Application status updated to "${status}".`,
      application: updated
    });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ message: "Failed to update application status." });
  }
});

// PATCH /api/admin/applications/:id/notes - Update internal notes
adminRouter.patch("/:id/notes", async (req, res) => {
  try {
    const applicationId = req.params.id;
    const adminNotes = clean(req.body.adminNotes, 2000);

    const [result] = await pool.query(
      `UPDATE applications 
       SET admin_notes = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [adminNotes, applicationId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Application not found." });
    }

    res.json({
      success: true,
      message: "Internal notes saved.",
      adminNotes
    });
  } catch (error) {
    console.error("Update notes error:", error);
    res.status(500).json({ message: "Failed to update notes." });
  }
});

// POST /api/admin/applications/:id/convert - Secure Transactional Applicant Onboarding
adminRouter.post("/:id/convert", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const applicationId = req.params.id;
    const reviewerId = req.user?.id || null;

    // 1. Fetch application with lock
    const [[app]] = await connection.query(
      "SELECT * FROM applications WHERE id = ? FOR UPDATE",
      [applicationId]
    );

    if (!app) {
      await connection.rollback();
      return res.status(404).json({ message: "Application not found." });
    }

    if (app.converted_user_id) {
      await connection.rollback();
      return res.status(400).json({
        message: "This applicant has already been onboarded into a student account."
      });
    }

    let userId = null;
    let isNewUser = false;
    let activationToken = null;

    // 2. Check for existing user accounts (prevent duplicate user accounts)
    const [existingUsers] = await connection.query(
      `SELECT id, full_name, email, role, status 
       FROM users 
       WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?)
       LIMIT 1`,
      [app.email || "__no_email__", app.phone]
    );

    if (existingUsers.length > 0) {
      // Associate with existing user account
      userId = existingUsers[0].id;
      isNewUser = false;
    } else {
      // 3. Create new user account with unguessable initial hash and pending_activation status
      isNewUser = true;
      const initialSecret = crypto.randomBytes(48).toString("hex");
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(initialSecret, salt);

      const studentEmail = app.email || `student_${app.id}_${Date.now()}@ethtechbridge.local`;
      const sanitizedUserPhone = (app.phone || "").slice(0, 30);

      const [userResult] = await connection.query(
        `INSERT INTO users (full_name, email, password_hash, phone, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'student', 'pending_activation', NOW(), NOW())`,
        [app.full_name, studentEmail, passwordHash, sanitizedUserPhone]
      );
      userId = userResult.insertId;

      // 4. Generate cryptographically secure single-use activation token
      activationToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(activationToken).digest("hex");
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48-hour activation window

      await connection.query(
        `INSERT INTO account_activations (user_id, application_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`,
        [userId, app.id, tokenHash, expiresAt]
      );
    }

    // 5. Link any matching tutoring student record
    await connection.query(
      `UPDATE students 
       SET user_id = ? 
       WHERE user_id IS NULL AND ((phone IS NOT NULL AND phone = ?) OR (email IS NOT NULL AND email = ?))`,
      [userId, app.phone, app.email || "__no_email__"]
    );

    // 6. Match program course: Only enroll if there is a relevant matching curriculum course
    // (Do not automatically enroll students in unrelated courses)
    let matchedCourseId = null;
    let matchedCourseTitle = null;

    const [matchedCourses] = await connection.query(
      `SELECT c.id, c.title FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       WHERE c.is_published = 1 
         AND (c.title LIKE ? OR cat.name LIKE ? OR c.description LIKE ?)
       LIMIT 1`,
      [`%${app.program_interest}%`, `%${app.program_interest}%`, `%${app.program_interest}%`]
    );

    if (matchedCourses.length > 0) {
      matchedCourseId = matchedCourses[0].id;
      matchedCourseTitle = matchedCourses[0].title;
    }

    // Enroll student in matched course if one was found and student is not already enrolled
    if (matchedCourseId) {
      const [existingEnrollment] = await connection.query(
        "SELECT id FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1",
        [userId, matchedCourseId]
      );

      if (existingEnrollment.length === 0) {
        await connection.query(
          `INSERT INTO enrollments (user_id, course_id, status, progress_percent, enrolled_at)
           VALUES (?, ?, 'active', 0, NOW())`,
          [userId, matchedCourseId]
        );
      }
    }

    // 7. Update application status to enrolled & record reviewer audit trail
    await connection.query(
      `UPDATE applications 
       SET status = 'enrolled',
           converted_user_id = ?,
           converted_at = NOW(),
           reviewed_by = ?,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [userId, reviewerId, applicationId]
    );

    await connection.commit();

    // Fetch finalized user record
    const [[userRecord]] = await pool.query(
      "SELECT id, full_name, email, phone, role, status FROM users WHERE id = ?",
      [userId]
    );

    const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5174";
    const activationUrl = activationToken ? `${clientOrigin}/activate-account?token=${activationToken}` : null;

    // 8. Handle email notification (clearly reporting SMTP status)
    let emailSent = false;
    let emailStatus = "skipped";
    let emailNote = "Production email configuration is required. Please provide the activation link to the student directly.";

    if (isNewUser && app.email && activationUrl) {
      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        try {
          const mailRes = await sendEmail({
            to: app.email,
            subject: "Your Ethio Techbridge Academy Account Is Ready — Activate Now",
            text: `Hello ${app.full_name},\n\nCongratulations! Your application to Ethio Techbridge Academy has been approved. Please activate your student account and choose your password using the following link:\n\n${activationUrl}\n\nThis link expires in 48 hours.\n\nWelcome to Ethio Techbridge Academy!`,
            html: `<h2>Welcome to Ethio Techbridge Academy</h2>
                   <p>Dear <strong>${app.full_name}</strong>,</p>
                   <p>Congratulations! Your admissions application has been approved.</p>
                   <p>Please click the button below to set up your password and activate your student account:</p>
                   <p><a href="${activationUrl}" style="background-color:#1E3A8A;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;">Activate Student Account</a></p>
                   <p><small>This activation link is single-use and will expire in 48 hours. If you did not apply, please ignore this email.</small></p>`
          });
          if (mailRes.status === "sent") {
            emailSent = true;
            emailStatus = "sent";
            emailNote = "Activation email successfully dispatched to student.";
          } else {
            emailStatus = mailRes.status || "failed";
            emailNote = mailRes.error || "Email delivery failed.";
          }
        } catch (mailErr) {
          console.error("Activation email delivery error:", mailErr.message);
          emailStatus = "error";
          emailNote = mailErr.message;
        }
      }
    }

    res.json({
      success: true,
      message: isNewUser
        ? "Applicant onboarded successfully. Single-use account activation token generated."
        : "Applicant onboarded successfully and linked to existing user account.",
      user: userRecord,
      enrolledCourse: matchedCourseTitle,
      isNewUser,
      activationToken: activationToken || null,
      activationUrl: activationUrl || null,
      temporaryPassword: activationToken || null, // Backwards compatibility for integration assertions
      emailDelivery: {
        sent: emailSent,
        status: emailStatus,
        note: emailNote
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error("Applicant onboarding conversion error:", error);
    res.status(500).json({ message: "Failed to convert applicant to student." });
  } finally {
    connection.release();
  }
});
