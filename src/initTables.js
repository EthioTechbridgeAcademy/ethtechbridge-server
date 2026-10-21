import { pool } from "./db.js";

async function init() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(80) NOT NULL DEFAULT 'General',
        content TEXT NOT NULL,
        excerpt VARCHAR(500) NULL,
        video_url VARCHAR(500) NULL,
        status ENUM('active', 'draft', 'archived') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        format ENUM('online', 'campus', 'hybrid') NOT NULL DEFAULT 'hybrid',
        grade_range VARCHAR(80) NOT NULL DEFAULT 'Grades 1-12',
        description TEXT NOT NULL,
        topics VARCHAR(500) NULL,
        video_url VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Check if initial announcements exist; if not, seed default ones
    const [[{ annCount }]] = await pool.query("SELECT COUNT(*) as annCount FROM announcements");
    if (annCount === 0) {
      await pool.query(`
        INSERT INTO announcements (title, category, content, excerpt, status) VALUES
        ('Student Enrollment for 2026/27 Cohort Officially Open!', 'Admissions', 'Admissions for Grade 1 through 12 tutoring, STEM labs, and web coding programs are officially open for Addis Ababa families across CMC, Summit, 72, and Ayat.', 'Registrations are open for 2026/27 academic tutoring & STEM labs.', 'active'),
        ('Weekend Coding & Robotics Workshop Series Launched', 'STEM & Tech', 'Ethio Techbridge Academy is excited to launch practical hands-on coding, Python for kids, and robotics basics every Saturday at our campus tutorial center.', 'Hands-on Saturday coding and robotics sessions for students.', 'active'),
        ('National Curriculum & Exam Revision Schedule Published', 'Academic', 'Comprehensive preparation schedules for Grade 6, 8, and 12 national exam candidates are now finalized. Dedicated mentor sessions start next week.', 'Exam review schedules released for Grades 6, 8, and 12 candidates.', 'active')
      `);
    }

    // Check if initial courses exist; if not, seed default courses
    const [[{ courseCount }]] = await pool.query("SELECT COUNT(*) as courseCount FROM courses");
    if (courseCount === 0) {
      await pool.query(`
        INSERT INTO courses (title, format, grade_range, description, topics, video_url) VALUES
        ('Full-Stack Web Coding & Python for Young Creators', 'online', 'Grades 5-12', 'Engaging interactive programming lessons covering HTML5, modern CSS, JavaScript, and introductory Python. Students build real interactive websites and coding projects.', 'HTML/CSS Projects, JavaScript Basics, Python Games, Real Web Hosting', 'https://www.youtube.com/watch?v=kUMe1FH4CHE'),
        ('High School STEM: Advanced Physics & Chemistry Lab Prep', 'campus', 'Grades 9-12', 'Rigorous academic tutorial sessions covering mechanics, electricity, chemical reactions, and organic chemistry aligned with the Ethiopian national curriculum.', 'Mechanics & Optics, Stoichiometry, Exam Solving Tactics, Lab Concepts', 'https://www.youtube.com/watch?v=bhiCXOmm2Nk'),
        ('Primary & Middle School Mathematics Mastery Foundation', 'hybrid', 'Grades 1-8', 'Strengthening numerical fluency, mental math, algebra foundations, and critical word problems with patient, certified educators.', 'Mental Math, Geometry Foundations, Pre-Algebra, Step-by-Step Problem Solving', 'https://www.youtube.com/watch?v=Yq4d_LdM9oY'),
        ('English Fluency, Grammar & Public Speaking Laboratory', 'online', 'Grades 3-12', 'Comprehensive communication training focused on written grammar, reading comprehension, vocabulary expansion, and confident verbal expression.', 'Grammar Mastery, Essay Writing, Reading Fluency, Confident Presentation', 'https://www.youtube.com/watch?v=kUMe1FH4CHE')
      `);
    }

    console.log("Database tables initialized and seeded successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Migration error:", err);
    process.exit(1);
  }
}

init();
