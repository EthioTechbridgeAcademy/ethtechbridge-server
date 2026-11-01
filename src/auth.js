import jwt from "jsonwebtoken";
import { pool } from "./db.js";

/**
 * Validates JWT token and checks active user existence in MySQL.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  
  if (!token) {
    return res.status(401).json({ message: "Authentication required. Please sign in." });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please sign in again.", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ message: "Session is invalid or expired. Please sign in again.", code: "INVALID_TOKEN" });
  }

  // Validate required claims
  if (!payload || !payload.id || !payload.role) {
    return res.status(401).json({ message: "Invalid session claims. Please sign in again." });
  }

  try {
    // Verify user still exists in database and check account status
    const [rows] = await pool.query(
      "SELECT id, full_name, email, role, phone, status FROM users WHERE id = ? LIMIT 1",
      [payload.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "User account no longer exists. Please sign in again." });
    }

    const dbUser = rows[0];

    // Enforce account status check
    if (dbUser.status === "suspended") {
      return res.status(403).json({ message: "Your account has been suspended. Please contact the academy administration." });
    }
    if (dbUser.status === "inactive" || dbUser.status === "pending_activation") {
      return res.status(403).json({ message: "Your account is currently inactive or pending activation. Please activate your account to proceed." });
    }

    // Attach verified user to request with authoritative database role
    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.full_name,
      role: dbUser.role,
      phone: dbUser.phone,
      status: dbUser.status
    };
    next();
  } catch (dbErr) {
    console.error("Auth middleware DB verification error:", dbErr.message);
    return res.status(500).json({ message: "Internal server error during authentication." });
  }
}

/**
 * Middleware factory enforcing specific role authorization.
 * @param  {...string} allowedRoles Roles permitted to access the route
 */
export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    // First run requireAuth
    await requireAuth(req, res, () => {
      if (!req.user) return; // Response already handled in requireAuth
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          message: `Forbidden: Access restricted. Required role: ${allowedRoles.join(" or ")}.`,
          currentRole: req.user.role
        });
      }
      next();
    });
  };
}

/**
 * Strict administrator authorization middleware.
 */
export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.user) return;
    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Forbidden: Administrative access required.",
        currentRole: req.user.role
      });
    }
    req.admin = req.user; // Backwards compatibility with existing admin controllers
    next();
  });
}

/**
 * Instructor authorization middleware (permits instructors and administrators).
 */
export async function requireInstructor(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.user) return;
    if (req.user.role !== "instructor" && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Forbidden: Instructor authorization required.",
        currentRole: req.user.role
      });
    }
    next();
  });
}

/**
 * Student authorization middleware (permits students and administrators).
 */
export async function requireStudent(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.user) return;
    if (req.user.role !== "student" && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Forbidden: Student authorization required.",
        currentRole: req.user.role
      });
    }
    next();
  });
}

/**
 * Optional authentication middleware for public endpoints that enhance response if authenticated.
 */
export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload?.id) {
        const [rows] = await pool.query(
          "SELECT id, full_name, email, role, phone, status FROM users WHERE id = ? LIMIT 1",
          [payload.id]
        );
        if (rows.length > 0 && rows[0].status === "active") {
          req.user = {
            id: rows[0].id,
            email: rows[0].email,
            name: rows[0].full_name,
            role: rows[0].role,
            phone: rows[0].phone,
            status: rows[0].status
          };
        }
      }
    } catch {
      // Ignore invalid or expired token for optional auth
    }
  }
  next();
}
