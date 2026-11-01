import { pool } from "../db.js";

export async function runPhase3Migration() {
  console.log("Starting Phase 3 idempotent database migration...");

  // 1. Create account_activations table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_activations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      application_id BIGINT UNSIGNED NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_act_token (token_hash),
      INDEX idx_act_user (user_id),
      INDEX idx_act_expires (expires_at),
      CONSTRAINT fk_act_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_act_app FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✓ account_activations table verified/created.");

  // 2. Add/update status column to users if not present
  const [userCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'status'");
  if (userCols.length === 0) {
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN status ENUM('active', 'inactive', 'suspended', 'pending_activation') NOT NULL DEFAULT 'active' AFTER role
    `);
    console.log("✓ Added status column to users table.");
  } else {
    await pool.query(`
      ALTER TABLE users 
      MODIFY COLUMN status ENUM('active', 'inactive', 'suspended', 'pending_activation') NOT NULL DEFAULT 'active'
    `);
    console.log("✓ Updated status column enum in users table.");
  }

  // 3. Add user_id column to students if not present
  const [studentCols] = await pool.query("SHOW COLUMNS FROM students LIKE 'user_id'");
  if (studentCols.length === 0) {
    await pool.query(`
      ALTER TABLE students 
      ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id,
      ADD CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    `);
    console.log("✓ Added user_id column to students table.");
  } else {
    console.log("✓ user_id column already present in students table.");
  }

  // 4. Add instructor_id column to class_schedules if not present
  const [scheduleCols] = await pool.query("SHOW COLUMNS FROM class_schedules LIKE 'instructor_id'");
  if (scheduleCols.length === 0) {
    await pool.query(`
      ALTER TABLE class_schedules 
      ADD COLUMN instructor_id BIGINT UNSIGNED NULL AFTER teacher_name,
      ADD CONSTRAINT fk_schedules_instructor FOREIGN KEY (instructor_id) REFERENCES users (id) ON DELETE SET NULL
    `);
    console.log("✓ Added instructor_id column to class_schedules table.");
  } else {
    console.log("✓ instructor_id column already present in class_schedules table.");
  }

  // 5. Add instructor_user_id column to courses if not present
  const [courseCols] = await pool.query("SHOW COLUMNS FROM courses LIKE 'instructor_user_id'");
  if (courseCols.length === 0) {
    await pool.query(`
      ALTER TABLE courses 
      ADD COLUMN instructor_user_id BIGINT UNSIGNED NULL AFTER instructor_title,
      ADD CONSTRAINT fk_courses_instructor FOREIGN KEY (instructor_user_id) REFERENCES users (id) ON DELETE SET NULL
    `);
    console.log("✓ Added instructor_user_id column to courses table.");
  } else {
    console.log("✓ instructor_user_id column already present in courses table.");
  }

  console.log("Phase 3 migration completed successfully!");
}

if (process.argv[1]?.includes("phase3_migration.js")) {
  runPhase3Migration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
