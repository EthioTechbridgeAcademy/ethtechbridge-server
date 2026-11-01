import { pool } from "./db.js";

async function addColumnIfNotExists(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows.length === 0) {
    console.log(`Adding column ${column} to ${table}...`);
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function initPlatformTables() {
  console.log("Starting platform database tables initialization...");

  // 1. Users table (students, instructors, admins)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(30) NULL,
      role ENUM('student', 'admin', 'instructor') NOT NULL DEFAULT 'student',
      bio TEXT NULL,
      avatar_url VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_email (email),
      INDEX idx_users_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 2. Password resets table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_pw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_pw_token (token_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 3. Course categories / learning paths
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(100) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description TEXT NULL,
      icon VARCHAR(50) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 4. Ensure courses table has all necessary LMS fields
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      format ENUM('online', 'campus', 'hybrid') NOT NULL DEFAULT 'online',
      grade_range VARCHAR(80) NOT NULL DEFAULT 'All Levels',
      description TEXT NOT NULL,
      topics VARCHAR(500) NULL,
      video_url VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await addColumnIfNotExists("courses", "slug", "VARCHAR(220) NULL UNIQUE");
  await addColumnIfNotExists("courses", "short_description", "VARCHAR(500) NULL");
  await addColumnIfNotExists("courses", "category_id", "BIGINT UNSIGNED NULL");
  await addColumnIfNotExists("courses", "difficulty", "ENUM('beginner', 'intermediate', 'advanced', 'all_levels') NOT NULL DEFAULT 'beginner'");
  await addColumnIfNotExists("courses", "duration_hours", "INT UNSIGNED NOT NULL DEFAULT 10");
  await addColumnIfNotExists("courses", "thumbnail_url", "VARCHAR(500) NULL");
  await addColumnIfNotExists("courses", "instructor_name", "VARCHAR(150) NOT NULL DEFAULT 'Ethio Techbridge Faculty'");
  await addColumnIfNotExists("courses", "instructor_title", "VARCHAR(150) NOT NULL DEFAULT 'Lead Instructor'");
  await addColumnIfNotExists("courses", "instructor_bio", "TEXT NULL");
  await addColumnIfNotExists("courses", "prerequisites", "TEXT NULL");
  await addColumnIfNotExists("courses", "learning_objectives", "TEXT NULL");
  await addColumnIfNotExists("courses", "target_audience", "TEXT NULL");
  await addColumnIfNotExists("courses", "price", "DECIMAL(10,2) NOT NULL DEFAULT 0.00");
  await addColumnIfNotExists("courses", "is_free", "BOOLEAN NOT NULL DEFAULT TRUE");
  await addColumnIfNotExists("courses", "is_published", "BOOLEAN NOT NULL DEFAULT TRUE");
  await addColumnIfNotExists("courses", "is_featured", "BOOLEAN NOT NULL DEFAULT FALSE");

  // 5. Course Modules
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_modules (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      course_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_module_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      INDEX idx_module_course_order (course_id, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 6. Lessons
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lessons (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      course_id BIGINT UNSIGNED NOT NULL,
      module_id BIGINT UNSIGNED NULL,
      title VARCHAR(200) NOT NULL,
      slug VARCHAR(220) NOT NULL,
      content_type ENUM('video', 'article', 'interactive') NOT NULL DEFAULT 'video',
      content_text LONGTEXT NULL,
      video_url VARCHAR(500) NULL,
      duration_minutes INT UNSIGNED NOT NULL DEFAULT 15,
      is_preview BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INT NOT NULL DEFAULT 1,
      resources_json TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_lesson_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      CONSTRAINT fk_lesson_module FOREIGN KEY (module_id) REFERENCES course_modules(id) ON DELETE SET NULL,
      INDEX idx_lesson_course_order (course_id, sort_order),
      INDEX idx_lesson_slug (course_id, slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 7. Course Enrollments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      status ENUM('active', 'completed', 'dropped') NOT NULL DEFAULT 'active',
      progress_percent INT UNSIGNED NOT NULL DEFAULT 0,
      last_accessed_lesson_id BIGINT UNSIGNED NULL,
      enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_course (user_id, course_id),
      CONSTRAINT fk_enrollment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_enrollment_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      INDEX idx_enrollment_user (user_id),
      INDEX idx_enrollment_course (course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 8. Lesson Progress
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lesson_progress (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      lesson_id BIGINT UNSIGNED NOT NULL,
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_lesson (user_id, lesson_id),
      CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_progress_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      CONSTRAINT fk_progress_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
      INDEX idx_progress_user_course (user_id, course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 9. Quizzes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      course_id BIGINT UNSIGNED NOT NULL,
      lesson_id BIGINT UNSIGNED NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT NULL,
      passing_score INT UNSIGNED NOT NULL DEFAULT 70,
      time_limit_minutes INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_quiz_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      INDEX idx_quiz_course (course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 10. Quiz Questions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      quiz_id BIGINT UNSIGNED NOT NULL,
      question_text TEXT NOT NULL,
      explanation TEXT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_question_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 11. Quiz Options
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_options (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      question_id BIGINT UNSIGNED NOT NULL,
      option_text TEXT NOT NULL,
      is_correct BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INT NOT NULL DEFAULT 1,
      CONSTRAINT fk_option_question FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 12. Quiz Attempts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      quiz_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      score INT UNSIGNED NOT NULL,
      total_questions INT UNSIGNED NOT NULL,
      passed BOOLEAN NOT NULL DEFAULT FALSE,
      answers_json LONGTEXT NULL,
      completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_attempt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_attempt_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
      CONSTRAINT fk_attempt_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      INDEX idx_attempt_user_quiz (user_id, quiz_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 13. Certificates
  await pool.query(`
    CREATE TABLE IF NOT EXISTS certificates (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      certificate_code VARCHAR(64) NOT NULL UNIQUE,
      user_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      recipient_name VARCHAR(150) NOT NULL,
      course_title VARCHAR(200) NOT NULL,
      grade_score INT UNSIGNED NULL,
      issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_cert_user_course (user_id, course_id),
      CONSTRAINT fk_cert_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_cert_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      INDEX idx_cert_code (certificate_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 14. Dedicated student applications table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      application_number VARCHAR(32) NOT NULL UNIQUE,
      full_name VARCHAR(150) NOT NULL,
      phone VARCHAR(35) NOT NULL,
      email VARCHAR(190) NULL,
      grade_level VARCHAR(64) NOT NULL,
      program_interest VARCHAR(120) NOT NULL,
      preferred_contact VARCHAR(30) NOT NULL DEFAULT 'phone',
      notes TEXT NULL,
      status ENUM('pending', 'under_review', 'approved', 'rejected', 'enrolled') NOT NULL DEFAULT 'pending',
      admin_notes TEXT NULL,
      reviewed_by BIGINT UNSIGNED NULL,
      reviewed_at DATETIME NULL,
      converted_user_id BIGINT UNSIGNED NULL,
      converted_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_app_number (application_number),
      INDEX idx_app_status (status),
      INDEX idx_app_phone (phone),
      INDEX idx_app_email (email),
      INDEX idx_app_created (created_at),
      CONSTRAINT fk_app_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_app_converted_user FOREIGN KEY (converted_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 15. Account Activations for Onboarded Students
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

  // 16. Synchronize existing admins table into users table
  const [adminRows] = await pool.query("SELECT * FROM admins");
  for (const adm of adminRows) {
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [adm.email]);
    if (existing.length === 0) {
      await pool.query(
        "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
        [adm.full_name, adm.email, adm.password_hash]
      );
      console.log(`Synchronized admin ${adm.email} into users table.`);
    }
  }

  console.log("All platform tables initialized successfully!");
}

if (process.argv[1]?.endsWith("initPlatformTables.js")) {
  initPlatformTables()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Initialization failed:", err);
      process.exit(1);
    });
}

