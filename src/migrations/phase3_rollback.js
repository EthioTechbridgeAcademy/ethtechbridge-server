import { pool } from "../db.js";

export async function rollbackPhase3Migration() {
  console.log("Starting Phase 3 rollback...");

  // 1. Drop foreign keys and columns if present
  try {
    await pool.query("ALTER TABLE courses DROP FOREIGN KEY fk_courses_instructor");
    await pool.query("ALTER TABLE courses DROP COLUMN instructor_user_id");
    console.log("✓ Rolled back courses.instructor_user_id");
  } catch (err) {
    console.log("- courses.instructor_user_id rollback skipped:", err.message);
  }

  try {
    await pool.query("ALTER TABLE class_schedules DROP FOREIGN KEY fk_schedules_instructor");
    await pool.query("ALTER TABLE class_schedules DROP COLUMN instructor_id");
    console.log("✓ Rolled back class_schedules.instructor_id");
  } catch (err) {
    console.log("- class_schedules.instructor_id rollback skipped:", err.message);
  }

  try {
    await pool.query("ALTER TABLE students DROP FOREIGN KEY fk_students_user");
    await pool.query("ALTER TABLE students DROP COLUMN user_id");
    console.log("✓ Rolled back students.user_id");
  } catch (err) {
    console.log("- students.user_id rollback skipped:", err.message);
  }

  try {
    await pool.query("ALTER TABLE users DROP COLUMN status");
    console.log("✓ Rolled back users.status");
  } catch (err) {
    console.log("- users.status rollback skipped:", err.message);
  }

  try {
    await pool.query("DROP TABLE IF EXISTS account_activations");
    console.log("✓ Dropped account_activations table");
  } catch (err) {
    console.log("- account_activations drop skipped:", err.message);
  }

  console.log("Phase 3 rollback completed.");
}

if (process.argv[1]?.includes("phase3_rollback.js")) {
  rollbackPhase3Migration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Rollback failed:", err);
      process.exit(1);
    });
}

