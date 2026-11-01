import "dotenv/config";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { validateTeamsMeetingUrl } from "./utils/teamsUrl.js";
import bcrypt from "bcryptjs";

const BASE = "http://localhost:5000";
const JWT_SECRET = process.env.JWT_SECRET || "replace_with_a_long_random_secret_at_least_32_characters";

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

async function runTests() {
  console.log("=== PHASE 5 VERIFICATION: MICROSOFT TEAMS & CLASS MANAGEMENT ===\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Teams URL Validator tests
  console.log("--- 1. Testing Teams URL Validation ---");
  const valid1 = validateTeamsMeetingUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_test/0?context=%7b%22Tid%22%3a%22test%22%7d");
  assert(valid1.valid === true, "Valid teams.microsoft.com URL accepted");

  const valid2 = validateTeamsMeetingUrl("https://teams.live.com/meet/94291823482");
  assert(valid2.valid === true, "Valid teams.live.com URL accepted");

  const valid3 = validateTeamsMeetingUrl("https://meet.microsoft.com/abc-defg-hij");
  assert(valid3.valid === true, "Valid meet.microsoft.com URL accepted");

  const invalidHttp = validateTeamsMeetingUrl("http://teams.microsoft.com/l/meetup-join/123");
  assert(invalidHttp.valid === false && invalidHttp.error.includes("HTTPS"), "HTTP (non-secure) rejected");

  const invalidDomain = validateTeamsMeetingUrl("https://zoom.us/j/123456789");
  assert(invalidDomain.valid === false, "Zoom / third-party domain rejected");

  const invalidCreds = validateTeamsMeetingUrl("https://user:pass@teams.microsoft.com/meet");
  assert(invalidCreds.valid === false, "Credentials in URL rejected");

  const invalidScheme = validateTeamsMeetingUrl("javascript:alert(1)");
  assert(invalidScheme.valid === false, "Non-http protocol rejected");

  // 2. Setup Test Database Users
  console.log("\n--- 2. Setting up Test Database Users & Tokens ---");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash("Password123!", salt);

  // Admin user
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, status)
     VALUES (9901, 'Test Admin', 'test_admin_phase5@ethiotech.com', ?, 'admin', 'active')
     ON DUPLICATE KEY UPDATE full_name='Test Admin', role='admin', status='active'`,
    [passwordHash]
  );
  const adminToken = signToken({ id: 9901, email: "test_admin_phase5@ethiotech.com", role: "admin", name: "Test Admin" });

  // Instructor 1 (Assigned)
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, status)
     VALUES (9902, 'Dr. Tesfaye Instructor', 'test_inst1_phase5@ethiotech.com', ?, 'instructor', 'active')
     ON DUPLICATE KEY UPDATE full_name='Dr. Tesfaye Instructor', role='instructor', status='active'`,
    [passwordHash]
  );
  const inst1Token = signToken({ id: 9902, email: "test_inst1_phase5@ethiotech.com", role: "instructor", name: "Dr. Tesfaye Instructor" });

  // Instructor 2 (Unassigned)
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, status)
     VALUES (9903, 'Abebe Lecturer', 'test_inst2_phase5@ethiotech.com', ?, 'instructor', 'active')
     ON DUPLICATE KEY UPDATE full_name='Abebe Lecturer', role='instructor', status='active'`,
    [passwordHash]
  );
  const inst2Token = signToken({ id: 9903, email: "test_inst2_phase5@ethiotech.com", role: "instructor", name: "Abebe Lecturer" });

  // Student user
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, status)
     VALUES (9904, 'Almaz Student', 'test_student_phase5@ethiotech.com', ?, 'student', 'active')
     ON DUPLICATE KEY UPDATE full_name='Almaz Student', role='student', status='active'`,
    [passwordHash]
  );
  const studentToken = signToken({ id: 9904, email: "test_student_phase5@ethiotech.com", role: "student", name: "Almaz Student" });

  // Test course
  await pool.query(
    `INSERT INTO courses (id, title, slug, instructor_user_id, instructor_name, is_published, price, is_free, description)
     VALUES (9901, 'Python Cloud & Backend Mastery', 'python-cloud-backend-mastery-phase5', 9902, 'Dr. Tesfaye Instructor', 1, 0, 1, 'Test backend course description')
     ON DUPLICATE KEY UPDATE instructor_user_id = 9902, instructor_name = 'Dr. Tesfaye Instructor'`,
  );

  // Enroll student
  await pool.query(
    `INSERT INTO enrollments (user_id, course_id, status, progress_percent)
     VALUES (9904, 9901, 'active', 25)
     ON DUPLICATE KEY UPDATE status = 'active'`
  );

  // 3. Admin Schedule Creation
  console.log("\n--- 3. Testing Schedule Endpoints (Admin) ---");
  const testTeamsUrl = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_TESTPHASE5%40thread.v2/0?context=%7b%22Tid%22%3a%2212345%22%7d";

  // Rejection with bad Teams URL
  const badUrlRes = await fetch(`${BASE}/api/admin/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      courseId: 9901,
      instructorId: 9902,
      subjectName: "Introduction to Docker",
      classDate: "2026-11-15",
      startTime: "10:00",
      meetingUrl: "https://unknownservice.com/meet/123"
    })
  });
  assert(badUrlRes.status === 400, "Admin cannot create schedule with unapproved meeting URL (400)");

  // Successful creation with valid Teams URL
  const createRes = await fetch(`${BASE}/api/admin/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      courseId: 9901,
      instructorId: 9902,
      subjectName: "Python Cloud Backend Live Lab",
      classDate: "2026-11-15",
      startTime: "10:00",
      endTime: "11:30",
      timezone: "Africa/Addis_Ababa",
      meetingUrl: testTeamsUrl,
      instructions: "Have Docker Desktop and Python 3.12 installed.",
      status: "scheduled"
    })
  });
  const createData = await createRes.json();
  if (createRes.status !== 201) console.log("Create failed:", createRes.status, createData);
  assert(createRes.status === 201 && createData.scheduleId, "Admin successfully creates schedule with Teams URL (201)");
  const scheduleId = createData.scheduleId;

  // 4. Admin schedules list
  const listRes = await fetch(`${BASE}/api/admin/schedules?courseId=9901`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const listData = await listRes.json();
  const found = listData.schedules?.find((s) => s.id === scheduleId);
  assert(found && found.meeting_url === testTeamsUrl, "Admin list returns newly created schedule with Teams URL");

  // 5. Instructor Portal Access & Updates
  console.log("\n--- 4. Testing Instructor Portal Endpoints ---");
  const instOverviewRes = await fetch(`${BASE}/api/instructor/overview`, {
    headers: { Authorization: `Bearer ${inst1Token}` }
  });
  const instOverview = await instOverviewRes.json();
  assert(instOverviewRes.status === 200 && instOverview.metrics?.assignedCoursesCount >= 1, "Instructor overview returns metrics");

  const instSchedulesRes = await fetch(`${BASE}/api/instructor/schedules`, {
    headers: { Authorization: `Bearer ${inst1Token}` }
  });
  const instSchedules = await instSchedulesRes.json();
  const instHasSchedule = instSchedules.schedules?.some((s) => s.id === scheduleId);
  assert(instHasSchedule, "Instructor schedule list contains their assigned session");

  // Instructor updates meeting link
  const updatedTeamsUrl = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_UPDATED%40thread.v2/0?context=%7b%22Tid%22%3a%22updated%22%7d";
  const instUpdateRes = await fetch(`${BASE}/api/instructor/schedules/${scheduleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${inst1Token}` },
    body: JSON.stringify({
      meetingUrl: updatedTeamsUrl,
      instructions: "Updated instructions: bring your project code."
    })
  });
  assert(instUpdateRes.status === 200, "Instructor successfully updates their Teams meeting link");

  // Unauthorized instructor attempt to edit schedule
  const unauthInstUpdateRes = await fetch(`${BASE}/api/instructor/schedules/${scheduleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${inst2Token}` },
    body: JSON.stringify({
      meetingUrl: updatedTeamsUrl
    })
  });
  assert(unauthInstUpdateRes.status === 404 || unauthInstUpdateRes.status === 403, "Unassigned instructor blocked from modifying other's schedule (403/404)");

  // 6. Student Dashboard & Schedule Access
  console.log("\n--- 5. Testing Student Online Class Experience ---");
  const stuDashRes = await fetch(`${BASE}/api/student/dashboard`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  const stuDash = await stuDashRes.json();
  const stuHasUpcoming = stuDash.upcomingSchedules?.some((s) => s.id === scheduleId && s.meeting_url === updatedTeamsUrl);
  assert(stuHasUpcoming, "Student dashboard includes upcoming Teams session with join URL");

  const stuSchedulesRes = await fetch(`${BASE}/api/student/schedules`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  const stuSchedules = await stuSchedulesRes.json();
  const stuFound = stuSchedules.schedules?.some((s) => s.id === scheduleId);
  assert(stuFound, "Student schedule API returns relevant cohort session");

  // 7. Security & Role Guards
  console.log("\n--- 6. Testing Role Authorization Guards ---");
  const stuTryAdminRes = await fetch(`${BASE}/api/admin/schedules`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert(stuTryAdminRes.status === 403, "Student account forbidden from admin schedule API (403)");

  const stuTryInstructorRes = await fetch(`${BASE}/api/instructor/schedules`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert(stuTryInstructorRes.status === 403, "Student account forbidden from instructor schedule API (403)");

  const anonTryScheduleRes = await fetch(`${BASE}/api/student/schedules`);
  assert(anonTryScheduleRes.status === 401, "Unauthenticated user blocked from viewing private schedules (401)");

  // Cleanup test schedule
  await pool.query("DELETE FROM class_schedules WHERE id = ?", [scheduleId]);
  await pool.query("DELETE FROM enrollments WHERE user_id = 9904 AND course_id = 9901");
  await pool.query("DELETE FROM courses WHERE id = 9901");
  await pool.query("DELETE FROM users WHERE id IN (9901, 9902, 9903, 9904)");

  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
