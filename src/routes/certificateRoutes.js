import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// GET /api/certificates/:code - Public Certificate Verification
router.get("/:code", async (req, res) => {
  const code = req.params.code?.trim();

  if (!code) {
    return res.status(400).json({ message: "Certificate verification code is required." });
  }

  try {
    const [rows] = await pool.query(
      `SELECT cert.id, cert.certificate_code, cert.recipient_name, cert.course_title,
              cert.grade_score, cert.issued_at,
              c.slug as course_slug, c.duration_hours, c.instructor_name, c.instructor_title
       FROM certificates cert
       JOIN courses c ON c.id = cert.course_id
       WHERE cert.certificate_code = ? LIMIT 1`,
      [code]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        verified: false,
        message: "Certificate not found. This credential code is invalid or has expired."
      });
    }

    const cert = rows[0];

    res.json({
      verified: true,
      certificate: {
        code: cert.certificate_code,
        recipientName: cert.recipient_name,
        courseTitle: cert.course_title,
        gradeScore: cert.grade_score || 100,
        issuedAt: cert.issued_at,
        courseDurationHours: cert.duration_hours,
        instructorName: cert.instructor_name,
        instructorTitle: cert.instructor_title,
        issuer: "Ethio Techbridge Academy",
        issuerLocation: "Addis Ababa, Ethiopia",
        verificationUrl: `${process.env.CLIENT_ORIGIN || "https://ethtechbridgeacademy.vercel.app"}/certificates/${cert.certificate_code}`
      }
    });
  } catch (error) {
    console.error("Certificate verification error:", error.message);
    res.status(500).json({ message: "Unable to verify certificate." });
  }
});

export default router;

