import "dotenv/config";
import { pool } from "../db.js";

async function runMigration() {
  console.log("=== RUNNING PHASE 5 MIGRATIONS FOR CLASS_SCHEDULES ===");

  // 1. Make student_id nullable if it's currently NOT NULL so course-wide classes can be scheduled
  try {
    await pool.query("ALTER TABLE class_schedules MODIFY COLUMN student_id BIGINT UNSIGNED NULL");
    console.log("✓ class_schedules.student_id made nullable");
  } catch (err) {
    console.log("Note on student_id modify:", err.message);
  }

  // 2. Add course_id if not exists
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM class_schedules LIKE 'course_id'");
    if (cols.length === 0) {
      await pool.query(`
        ALTER TABLE class_schedules
        ADD COLUMN course_id BIGINT UNSIGNED NULL AFTER student_id,
        ADD CONSTRAINT fk_class_schedules_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
        ADD INDEX idx_class_schedules_course (course_id)
      `);
      console.log("✓ Added course_id column and foreign key to class_schedules");
    } else {
      console.log("✓ course_id column already exists");
    }
  } catch (err) {
    console.log("Note on course_id:", err.message);
  }

  // 3. Add timezone, instructions, status
  const additions = [
    { name: "timezone", sql: "ADD COLUMN timezone VARCHAR(50) NOT NULL DEFAULT 'Africa/Addis_Ababa'" },
    { name: "instructions", sql: "ADD COLUMN instructions TEXT NULL" },
    { name: "status", sql: "ADD COLUMN status ENUM('scheduled', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled'" }
  ];

  for (const col of additions) {
    try {
      const [exists] = await pool.query(`SHOW COLUMNS FROM class_schedules LIKE '${col.name}'`);
      if (exists.length === 0) {
        await pool.query(`ALTER TABLE class_schedules ${col.sql}`);
        console.log(`✓ Added column ${col.name}`);
      } else {
        console.log(`✓ Column ${col.name} already exists`);
      }
    } catch (err) {
      console.log(`Note on ${col.name}:`, err.message);
    }
  }

  // 4. Also check if class_resources exists from Phase 4 plan
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_resources (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        course_id BIGINT UNSIGNED NOT NULL,
        instructor_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(200) NOT NULL,
        resource_type ENUM('link', 'document', 'video', 'code', 'other') NOT NULL DEFAULT 'link',
        url VARCHAR(500) NOT NULL,
        description TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
        FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_class_resources_course (course_id),
        INDEX idx_class_resources_instructor (instructor_id)
      )
    `);
    console.log("✓ class_resources table verified/created");
  } catch (err) {
    console.log("Note on class_resources:", err.message);
  }

  console.log("=== MIGRATION COMPLETE ===");
  process.exit(0);
}

runMigration().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
