import "dotenv/config";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";
import { validateTeamsMeetingUrl } from "./utils/teamsUrl.js";

const BASE = "http://localhost:5000";
const JWT_SECRET = process.env.JWT_SECRET || "replace_with_a_long_random_secret_at_least_32_characters";

function signToken(payload, expiresIn = "1h") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

async function runRegressionSuite() {
  console.log("==================================================================");
  console.log("   ETHIO TECHBRIDGE ACADEMY — PHASE 6 COMPREHENSIVE REGRESSION    ");
  console.log("==================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${message}`);
      failed++;
    }
  }

  // --- SECTION 1: Infrastructure & Health ---
  console.log("--- 1. Infrastructure, Health & CORS Controls ---");
  const healthRes = await fetch(`${BASE}/api/health`);
  const healthData = await healthRes.json();
  assert(healthRes.status === 200 && healthData.status === "ok", "API health endpoint returns 200 OK");
  assert(healthData.database === "connected", "MySQL database is connected and healthy");

  // CORS checks
  const corsPreflight = await fetch(`${BASE}/api/courses`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://ethtechbridgeacademy.vercel.app",
      "Access-Control-Request-Method": "GET"
    }
  });
  assert(corsPreflight.status === 204 || corsPreflight.status === 200, "CORS preflight allowed for production Vercel origin");

  // --- SECTION 2: Public Course Catalog & Learning ---
  console.log("\n--- 2. Public Catalog, LMS Lessons & Previews ---");
  const coursesRes = await fetch(`${BASE}/api/courses`);
  const coursesData = await coursesRes.json();
  assert(coursesRes.status === 200 && Array.isArray(coursesData.courses), "Course catalog endpoint returns 200 with list");

  const catsRes = await fetch(`${BASE}/api/categories`);
  const catsData = await catsRes.json();
  assert(catsRes.status === 200 && catsData.categories.length > 0, "Categories endpoint returns active categories");

  // Fetch single course details
  const sampleCourse = coursesData.courses[0];
  if (sampleCourse) {
    const detailRes = await fetch(`${BASE}/api/courses/${sampleCourse.slug}`);
    const detailData = await detailRes.json();
    assert(detailRes.status === 200 && detailData.course.title === sampleCourse.title, "Course details retrieved by slug");
    assert(Array.isArray(detailData.curriculum), "Curriculum modules and lesson hierarchy returned");

    // Check preview lesson
    const previewLesson = detailData.curriculum?.[0]?.lessons?.find((l) => l.is_preview);
    if (previewLesson) {
      const prevRes = await fetch(`${BASE}/api/courses/${sampleCourse.slug}/preview/${previewLesson.slug}`);
      const prevData = await prevRes.json();
      assert(prevRes.status === 200 && prevData.lesson?.title, "Preview lesson accessible publicly without authentication");
    }
  }

  // Public certificate verification
  const badCertRes = await fetch(`${BASE}/api/certificates/NONEXISTENT-CODE-999`);
  assert(badCertRes.status === 404, "Invalid certificate code returns 404 Not Found");

  // --- SECTION 3: Public Admissions Application ---
  console.log("\n--- 3. Native Admissions Application Workflow ---");
  const uniqueStamp = Date.now().toString(36);
  const testApplicant = {
    fullName: `Regr Candidate ${uniqueStamp}`,
    phone: `+251911${Math.floor(100000 + Math.random() * 900000)}`,
    email: `regr_${uniqueStamp}@example.com`,
    gradeLevel: "Grade 11",
    programInterest: "Full-Stack Web Development",
    preferredContact: "phone",
    notes: "Phase 6 regression test application"
  };

  const applyRes = await fetch(`${BASE}/api/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testApplicant)
  });
  const applyData = await applyRes.json();
  assert(applyRes.status === 201 && applyData.success === true, "Admissions application submitted successfully (201)");
  assert(/^APP-\d{4}-[A-Z0-9]+$/.test(applyData.applicationNumber), "Generated unique application number format APP-YYYY-XXXXXX");
  const appNumber = applyData.applicationNumber;

  // Duplicate prevention check
  const dupApplyRes = await fetch(`${BASE}/api/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testApplicant)
  });
  assert(dupApplyRes.status === 409, "Duplicate application with identical phone/email within 24h rejected (409 Conflict)");

  // --- SECTION 4: Authentication, RBAC & Security ---
  console.log("\n--- 4. Authentication, Session Security & User Isolation ---");
  const salt = await bcrypt.genSalt(10);
  const passHash = await bcrypt.hash("TestPass123!", salt);

  // Seed test users: Admin, Instructor, Student
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, status)
     VALUES (8801, 'Phase6 Admin', 'p6_admin@ethiotech.com', ?, 'admin', 'active')
     ON DUPLICATE KEY UPDATE role='admin', status='active'`,
    [passHash]
  );
  const adminToken = signToken({ id: 8801, email: "p6_admin@ethiotech.com", role: "admin", name: "Phase6 Admin" });

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, status)
     VALUES (8802, 'Phase6 Instructor', 'p6_inst@ethiotech.com', ?, 'instructor', 'active')
     ON DUPLICATE KEY UPDATE role='instructor', status='active'`,
    [passHash]
  );
  const instToken = signToken({ id: 8802, email: "p6_inst@ethiotech.com", role: "instructor", name: "Phase6 Instructor" });

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, status)
     VALUES (8803, 'Phase6 Student', 'p6_student@ethiotech.com', ?, 'student', 'active')
     ON DUPLICATE KEY UPDATE role='student', status='active'`,
    [passHash]
  );
  const studentToken = signToken({ id: 8803, email: "p6_student@ethiotech.com", role: "student", name: "Phase6 Student" });

  // Token tampering test
  const forgedToken = adminToken.slice(0, -6) + "abcdef";
  const forgedRes = await fetch(`${BASE}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${forgedToken}` }
  });
  assert(forgedRes.status === 401, "Forged or tampered JWT signature rejected with 401 Unauthorized");

  // RBAC checks
  const stuTryAdmin = await fetch(`${BASE}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert(stuTryAdmin.status === 403, "Student account forbidden from admin API (403)");

  const stuTryInst = await fetch(`${BASE}/api/instructor/overview`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert(stuTryInst.status === 403, "Student account forbidden from instructor API (403)");

  const instTryAdmin = await fetch(`${BASE}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${instToken}` }
  });
  assert(instTryAdmin.status === 403, "Instructor account forbidden from admin API (403)");

  // Role tampering defense: Student attempts to elevate role via profile update
  const tamperRes = await fetch(`${BASE}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({ bio: "Updated bio", role: "admin" })
  });
  const [[dbStu]] = await pool.query("SELECT role FROM users WHERE id = 8803");
  assert(dbStu.role === "student", "Role elevation tampering blocked: student role remains immutable");

  // --- SECTION 5: Admin Workflow & Student Onboarding ---
  console.log("\n--- 5. Admin Review, CSV Export & Student Onboarding ---");
  const adminAppsRes = await fetch(`${BASE}/api/admin/applications?search=${encodeURIComponent(testApplicant.fullName)}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminAppsData = await adminAppsRes.json();
  const createdApp = adminAppsData.applications?.find((a) => a.application_number === appNumber);
  assert(createdApp && createdApp.full_name === testApplicant.fullName, "Admin can search and retrieve newly submitted application");

  // Admin approves application
  const approveRes = await fetch(`${BASE}/api/admin/applications/${createdApp.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "approved", adminNotes: "Approved during Phase 6 regression suite." })
  });
  assert(approveRes.status === 200, "Admin can transition applicant status to 'approved'");

  // CSV export verification
  const csvRes = await fetch(`${BASE}/api/admin/applications/export/csv`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const csvText = await csvRes.text();
  assert(csvRes.status === 200 && csvText.includes("Application Number") && csvText.includes(appNumber), "Admin CSV export includes standard headers and applicant row");

  // Convert applicant to student
  const convertRes = await fetch(`${BASE}/api/admin/applications/${createdApp.id}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ assignedGrade: 11 })
  });
  const convertData = await convertRes.json();
  assert(convertRes.status === 200 && convertData.success === true, "Applicant successfully converted to student account");
  assert(convertData.activationToken && convertData.activationUrl, "Generated single-use secure activation token and URL");

  // --- SECTION 6: Microsoft Teams & Class Scheduling ---
  console.log("\n--- 6. Microsoft Teams Link Validation & Scheduling ---");
  const validTeams = validateTeamsMeetingUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_P6%40thread.v2/0?context=%7b%22Tid%22%3a%22p6%22%7d");
  assert(validTeams.valid === true, "Teams URL validator accepts authentic teams.microsoft.com meeting");

  const invalidTeams = validateTeamsMeetingUrl("https://zoom.us/j/999888777");
  assert(invalidTeams.valid === false, "Teams URL validator rejects third-party non-Teams URL");

  // Create class schedule with Teams URL
  const schedRes = await fetch(`${BASE}/api/admin/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      instructorId: 8802,
      subjectName: "Full-Stack Web Dev Live Workshop",
      classDate: "2026-11-20",
      startTime: "14:00",
      endTime: "15:30",
      timezone: "Africa/Addis_Ababa",
      meetingUrl: validTeams.normalizedUrl,
      instructions: "Bring laptop with VS Code and Node.js installed."
    })
  });
  const schedData = await schedRes.json();
  assert(schedRes.status === 201 && schedData.scheduleId, "Schedule created with valid Microsoft Teams link (201)");
  const scheduleId = schedData.scheduleId;

  // Instructor views schedule and updates meeting link
  const instSchedRes = await fetch(`${BASE}/api/instructor/schedules`, {
    headers: { Authorization: `Bearer ${instToken}` }
  });
  const instSchedData = await instSchedRes.json();
  const instHasSession = instSchedData.schedules?.some((s) => s.id === scheduleId);
  assert(instHasSession, "Assigned instructor sees scheduled Teams session");

  // Cleanup test entities
  await pool.query("DELETE FROM class_schedules WHERE id = ?", [scheduleId]);
  await pool.query("DELETE FROM account_activations WHERE application_id = ?", [createdApp.id]);
  await pool.query("DELETE FROM applications WHERE id = ?", [createdApp.id]);
  if (convertData.userId) {
    await pool.query("DELETE FROM enrollments WHERE user_id = ?", [convertData.userId]);
    await pool.query("DELETE FROM users WHERE id = ?", [convertData.userId]);
  }
  await pool.query("DELETE FROM users WHERE id IN (8801, 8802, 8803)");

  console.log("\n==================================================================");
  console.log(`PHASE 6 REGRESSION SUITE: ${passed} / ${passed + failed} tests passed`);
  console.log("==================================================================");

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runRegressionSuite().catch((err) => {
  console.error("Regression suite encountered unexpected error:", err);
  pool.end();
  process.exit(1);
});
