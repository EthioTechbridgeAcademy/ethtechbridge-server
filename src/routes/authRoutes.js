import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { sendEmail } from "../mailer.js";

const router = express.Router();

function clean(value, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { fullName, email, password, confirmPassword, phone } = req.body || {};
  const name = clean(fullName, 150);
  const userEmail = clean(email, 190).toLowerCase();
  const rawPassword = typeof password === "string" ? password : "";
  const rawConfirm = typeof confirmPassword === "string" ? confirmPassword : "";
  const telephone = clean(phone, 30);

  if (!name) {
    return res.status(400).json({ message: "Full name is required." });
  }
  if (!userEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    return res.status(400).json({ message: "A valid email address is required." });
  }
  if (!rawPassword || rawPassword.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters long." });
  }
  if (rawPassword !== rawConfirm) {
    return res.status(400).json({ message: "Passwords do not match." });
  }

  try {
    // Check if email already registered
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [userEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(rawPassword, salt);

    const [result] = await pool.execute(
      "INSERT INTO users (full_name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, 'student')",
      [name, userEmail, passwordHash, telephone || null]
    );

    const userId = result.insertId;
    const token = jwt.sign(
      { id: userId, email: userEmail, name, role: "student" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // If email is configured, optionally send a welcome email
    if (process.env.SMTP_HOST) {
      sendEmail({
        to: userEmail,
        subject: "Welcome to Ethio Techbridge Academy!",
        text: `Hello ${name}, welcome to Ethio Techbridge Academy! Your account is now active. Explore our free courses and start building in-demand skills today.`,
        html: `<h2>Welcome to Ethio Techbridge Academy!</h2><p>Hello <strong>${name}</strong>,</p><p>Your student account is now ready. Start learning by browsing our courses catalog.</p>`
      }).catch(err => console.error("Welcome email error:", err.message));
    }

    res.status(201).json({
      message: "Registration successful. Welcome to the academy!",
      token,
      user: {
        id: userId,
        name,
        email: userEmail,
        role: "student",
        phone: telephone || null
      }
    });
  } catch (error) {
    console.error("Register error:", error.message);
    res.status(500).json({ message: "Failed to create account. Please try again." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const userEmail = clean(req.body?.email, 190).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!userEmail || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    // 1. Check in users table
    const [users] = await pool.execute(
      "SELECT id, full_name, email, password_hash, role, status, phone, bio, avatar_url FROM users WHERE email = ? LIMIT 1",
      [userEmail]
    );

    if (users.length > 0) {
      const user = users[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ message: "Invalid email or password." });
      }

      // Check account status
      if (user.status === "pending_activation") {
        return res.status(403).json({
          message: "Your account is pending activation. Please use the activation link sent to your email or provided by the administrator to set your password."
        });
      }
      if (user.status === "suspended") {
        return res.status(403).json({
          message: "Your account has been suspended. Please contact academy administration."
        });
      }
      if (user.status === "inactive") {
        return res.status(403).json({
          message: "Your account is currently inactive. Please contact academy administration."
        });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.full_name, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: user.role === "admin" ? "8h" : "24h" }
      );

      return res.json({
        token,
        user: {
          id: user.id,
          name: user.full_name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          bio: user.bio,
          avatarUrl: user.avatar_url
        }
      });
    }

    // 2. Backwards compatibility check with legacy admins table
    const [admins] = await pool.execute(
      "SELECT id, full_name, email, password_hash FROM admins WHERE email = ? LIMIT 1",
      [userEmail]
    );

    if (admins.length > 0) {
      const admin = admins[0];
      const match = await bcrypt.compare(password, admin.password_hash);
      if (!match) {
        return res.status(401).json({ message: "Invalid email or password." });
      }

      // Sync into users table for future queries
      const [insertUser] = await pool.execute(
        "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
        [admin.full_name, admin.email, admin.password_hash]
      );

      const token = jwt.sign(
        { id: insertUser.insertId, email: admin.email, name: admin.full_name, role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
      );

      return res.json({
        token,
        user: {
          id: insertUser.insertId,
          name: admin.full_name,
          email: admin.email,
          role: "admin"
        }
      });
    }

    return res.status(401).json({ message: "Invalid email or password." });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Unable to sign in right now." });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const [users] = await pool.execute(
      "SELECT id, full_name, email, role, phone, bio, avatar_url, created_at FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!users.length) {
      return res.status(404).json({ message: "User not found." });
    }
    const user = users[0];

    // Get enrollment metrics
    const [[{ enrolledCount }]] = await pool.query(
      "SELECT COUNT(*) as enrolledCount FROM enrollments WHERE user_id = ?",
      [user.id]
    );
    const [[{ completedCount }]] = await pool.query(
      "SELECT COUNT(*) as completedCount FROM enrollments WHERE user_id = ? AND status = 'completed'",
      [user.id]
    );
    const [[{ certificateCount }]] = await pool.query(
      "SELECT COUNT(*) as certificateCount FROM certificates WHERE user_id = ?",
      [user.id]
    );

    res.json({
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at
      },
      stats: {
        enrolledCourses: enrolledCount,
        completedCourses: completedCount,
        certificates: certificateCount
      }
    });
  } catch (error) {
    console.error("Auth me error:", error.message);
    res.status(500).json({ message: "Failed to fetch user profile." });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  const email = clean(req.body?.email, 190).toLowerCase();
  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const [users] = await pool.query("SELECT id, full_name FROM users WHERE email = ?", [email]);
    if (users.length > 0) {
      const user = users[0];
      const resetToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.execute(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
        [user.id, tokenHash, expiresAt]
      );

      if (process.env.SMTP_HOST) {
        const resetUrl = `${process.env.CLIENT_ORIGIN || "http://localhost:5174"}/reset-password?token=${resetToken}`;
        await sendEmail({
          to: email,
          subject: "Password Reset Request — Ethio Techbridge Academy",
          text: `Hello ${user.full_name},\n\nYou requested a password reset. Use this link to set a new password: ${resetUrl}\n\nThis link expires in 1 hour. If you did not make this request, please ignore this email.`,
          html: `<p>Hello <strong>${user.full_name}</strong>,</p><p>You requested a password reset for your Ethio Techbridge Academy account.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link is valid for 1 hour.</p>`
        });
      }
    }

    // Always return uniform message to prevent account enumeration
    res.json({
      message: "If an account with that email exists, password reset instructions have been sent."
    });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    res.status(500).json({ message: "Unable to process password reset request." });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!token) {
    return res.status(400).json({ message: "Reset token is required." });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters long." });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const [rows] = await pool.query(
      "SELECT id, user_id FROM password_resets WHERE token_hash = ? AND expires_at > NOW() AND used_at IS NULL LIMIT 1",
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired password reset link." });
    }

    const resetRecord = rows[0];
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, resetRecord.user_id]);
    await pool.query("UPDATE password_resets SET used_at = NOW() WHERE id = ?", [resetRecord.id]);

    res.json({ message: "Password has been successfully reset. You can now log in with your new password." });
  } catch (error) {
    console.error("Reset password error:", error.message);
    res.status(500).json({ message: "Failed to reset password." });
  }
});

// GET /api/auth/verify-activation-token - Verify onboarding activation token
router.get("/verify-activation-token", async (req, res) => {
  const token = typeof req.query?.token === "string" ? req.query.token.trim() : "";

  if (!token || token.length < 32) {
    return res.status(400).json({ valid: false, message: "Valid activation token is required." });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const [rows] = await pool.query(
      `SELECT act.id, act.expires_at, act.used_at,
              u.id as user_id, u.full_name, u.email, u.status
       FROM account_activations act
       JOIN users u ON u.id = act.user_id
       WHERE act.token_hash = ? LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({ valid: false, message: "Invalid activation token." });
    }

    const activation = rows[0];

    if (activation.used_at) {
      return res.status(400).json({
        valid: false,
        message: "This activation token has already been used. Please log in with your password."
      });
    }

    if (new Date(activation.expires_at) < new Date()) {
      return res.status(400).json({
        valid: false,
        message: "This activation link has expired. Please contact academy admissions for a new link."
      });
    }

    res.json({
      valid: true,
      studentName: activation.full_name,
      email: activation.email
    });
  } catch (error) {
    console.error("Verify activation token error:", error.message);
    res.status(500).json({ valid: false, message: "Unable to verify activation token." });
  }
});

// POST /api/auth/activate-account - Complete student onboarding by setting initial password
router.post("/activate-account", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

  if (!token || token.length < 32) {
    return res.status(400).json({ message: "Valid activation token is required." });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters long." });
  }
  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const [rows] = await connection.query(
      `SELECT act.id, act.user_id, act.expires_at, act.used_at,
              u.full_name, u.email, u.role, u.phone
       FROM account_activations act
       JOIN users u ON u.id = act.user_id
       WHERE act.token_hash = ? FOR UPDATE`,
      [tokenHash]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid activation token." });
    }

    const activation = rows[0];

    if (activation.used_at) {
      await connection.rollback();
      return res.status(400).json({ message: "This activation token has already been used." });
    }

    if (new Date(activation.expires_at) < new Date()) {
      await connection.rollback();
      return res.status(400).json({ message: "This activation link has expired. Please request a new activation link." });
    }

    // Hash user's chosen password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Update user: activate account and set password
    await connection.query(
      "UPDATE users SET password_hash = ?, status = 'active', updated_at = NOW() WHERE id = ?",
      [passwordHash, activation.user_id]
    );

    // Mark activation token as used
    await connection.query(
      "UPDATE account_activations SET used_at = NOW() WHERE id = ?",
      [activation.id]
    );

    await connection.commit();

    // Issue JWT token for immediate authenticated session
    const jwtToken = jwt.sign(
      { id: activation.user_id, email: activation.email, name: activation.full_name, role: activation.role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      message: "Account activated successfully! Welcome to Ethio Techbridge Academy.",
      token: jwtToken,
      user: {
        id: activation.user_id,
        name: activation.full_name,
        email: activation.email,
        role: activation.role,
        phone: activation.phone
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error("Activate account error:", error.message);
    res.status(500).json({ message: "Failed to activate account. Please try again." });
  } finally {
    connection.release();
  }
});

// POST /api/auth/logout - Consistent logout endpoint
router.post("/logout", (_req, res) => {
  // Stateless JWT logout client-side confirmation
  res.json({ success: true, message: "Logged out successfully." });
});

export default router;

