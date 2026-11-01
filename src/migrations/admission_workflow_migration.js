import "dotenv/config";
import { pool } from "../db.js";

async function runAdmissionMigration() {
  console.log("=== RUNNING ADMISSION WORKFLOW MIGRATION ===");

  try {
    // 1. Check if user_id exists in applications
    const [cols] = await pool.query("SHOW COLUMNS FROM applications LIKE 'user_id'");
    if (cols.length === 0) {
      await pool.query(`
        ALTER TABLE applications
        ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER application_number,
        ADD CONSTRAINT fk_applications_submitting_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        ADD INDEX idx_applications_user (user_id)
      `);
      console.log("✓ Added user_id column with foreign key to applications table");
    } else {
      console.log("✓ user_id column already exists on applications table");
    }

    // 2. Backfill user_id from converted_user_id
    const [convertedRes] = await pool.query(`
      UPDATE applications
      SET user_id = converted_user_id
      WHERE user_id IS NULL AND converted_user_id IS NOT NULL
    `);
    console.log(`✓ Linked ${convertedRes.affectedRows} existing converted applications to user_id`);

    // 3. Backfill user_id by matching email
    const [emailRes] = await pool.query(`
      UPDATE applications a
      JOIN users u ON u.email = a.email AND a.email IS NOT NULL AND a.email != ''
      SET a.user_id = u.id
      WHERE a.user_id IS NULL
    `);
    console.log(`✓ Linked ${emailRes.affectedRows} applications to user_id by email match`);

    // 4. Backfill user_id by matching phone
    const [phoneRes] = await pool.query(`
      UPDATE applications a
      JOIN users u ON u.phone = a.phone AND a.phone IS NOT NULL AND a.phone != ''
      SET a.user_id = u.id
      WHERE a.user_id IS NULL
    `);
    console.log(`✓ Linked ${phoneRes.affectedRows} applications to user_id by phone match`);

    console.log("=== ADMISSION WORKFLOW MIGRATION COMPLETED SUCCESSFULLY ===");
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runAdmissionMigration();

