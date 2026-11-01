import "dotenv/config";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const BASE_URL = "http://127.0.0.1:5000/api";

async function runSecuritySuite() {
  console.log("==================================================================");
  console.log("  ETHIO TECHBRIDGE ACADEMY — PHASE 3 SECURITY & RBAC VERIFICATION ");
  console.log("==================================================================");

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✓ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${message}`);
    }
  }

  try {
    // --------------------------------------------------------------------------
    // Test 1: Successful Login & Invalid Credentials
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 1] Successful Login & Invalid Credentials ---");
    const adminEmail = process.env.ADMIN_EMAIL || "yegnabetsew@gmail.com";
    const adminPass = process.env.ADMIN_PASSWORD;

    const validLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPass })
    });
    const validLoginData = await validLoginRes.json();
    assert(validLoginRes.status === 200 && validLoginData.token, "Valid admin credentials return 200 and JWT token");
    assert(validLoginData.user.role === "admin", "Admin role confirmed in login payload");

    const adminToken = validLoginData.token;

    const invalidPassRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: "WrongPassword#12345!" })
    });
    assert(invalidPassRes.status === 401, "Invalid password rejected with HTTP 401");

    const nonExistentRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "doesnotexist@nowhere.com", password: "SomePassword123!" })
    });
    assert(nonExistentRes.status === 401, "Non-existent user email rejected with HTTP 401");

    // --------------------------------------------------------------------------
    // Test 2: Expired and Invalid JWTs
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 2] Expired and Invalid JWTs ---");
    const expiredToken = jwt.sign(
      { id: validLoginData.user.id, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "0s" } // immediately expired
    );
    const expiredRes = await fetch(`${BASE_URL}/admin/overview`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    assert(expiredRes.status === 401, "Expired JWT token rejected with HTTP 401");

    const tamperedToken = adminToken.slice(0, -6) + "xyz123";
    const tamperedRes = await fetch(`${BASE_URL}/admin/overview`, {
      headers: { Authorization: `Bearer ${tamperedToken}` }
    });
    assert(tamperedRes.status === 401, "Tampered / forged JWT token signature rejected with HTTP 401");

    const noTokenRes = await fetch(`${BASE_URL}/admin/overview`);
    assert(noTokenRes.status === 401, "Missing Authorization header rejected with HTTP 401");

    // --------------------------------------------------------------------------
    // Test 3: Student Attempts to Access Admin APIs
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 3] Student Attempts to Access Admin APIs ---");
    const testStudentEmail = `sec_student_${Date.now()}@ethioacademy.et`;
    const testStudentPass = "StudentSecurePass123!";
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Test Security Student",
        email: testStudentEmail,
        password: testStudentPass,
        confirmPassword: testStudentPass,
        phone: "+251911998877"
      })
    });
    const regData = await regRes.json();
    assert(regRes.status === 201 && regData.token, "Created test student account");
    const studentToken = regData.token;
    const studentUserId = regData.user.id;

    const studentAdminOverview = await fetch(`${BASE_URL}/admin/overview`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert(studentAdminOverview.status === 403, "Student calling /api/admin/overview blocked with HTTP 403 Forbidden");

    const studentAdminApps = await fetch(`${BASE_URL}/admin/applications`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert(studentAdminApps.status === 403, "Student calling /api/admin/applications blocked with HTTP 403 Forbidden");

    const studentAdminCourseCreate = await fetch(`${BASE_URL}/admin/courses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${studentToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: "Hacked Course" })
    });
    assert(studentAdminCourseCreate.status === 403, "Student attempting course creation blocked with HTTP 403 Forbidden");

    // --------------------------------------------------------------------------
    // Test 4: Student Attempts to Access Other Student's Records & Privilege Escalation
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 4] Student Record Isolation & Role Tampering Defense ---");
    // Attempt role escalation via PUT /api/student/profile
    const escalateRes = await fetch(`${BASE_URL}/student/profile`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${studentToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fullName: "Escalated Student",
        role: "admin",
        status: "active"
      })
    });
    assert(escalateRes.status === 200, "Profile update responded 200");

    // Verify role in database was not escalated
    const [[studentDbRow]] = await pool.query("SELECT role FROM users WHERE id = ?", [studentUserId]);
    assert(studentDbRow.role === "student", "Role in database remained strictly 'student' (role tampering blocked)");

    // --------------------------------------------------------------------------
    // Test 5: Instructor Scope & Assignment Authorization
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 5] Instructor Scope & Assignment Authorization ---");
    // Create two instructor user accounts
    const salt = await bcrypt.genSalt(10);
    const instPassHash = await bcrypt.hash("InstructorPass123!", salt);

    const inst1Email = `inst1_${Date.now()}@ethioacademy.et`;
    const inst2Email = `inst2_${Date.now()}@ethioacademy.et`;

    const [inst1Result] = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role, status) VALUES (?, ?, ?, 'instructor', 'active')",
      ["Instructor Alpha", inst1Email, instPassHash]
    );
    const inst1Id = inst1Result.insertId;

    const [inst2Result] = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role, status) VALUES (?, ?, ?, 'instructor', 'active')",
      ["Instructor Beta", inst2Email, instPassHash]
    );
    const inst2Id = inst2Result.insertId;

    const inst1Token = jwt.sign(
      { id: inst1Id, email: inst1Email, name: "Instructor Alpha", role: "instructor" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    const inst2Token = jwt.sign(
      { id: inst2Id, email: inst2Email, name: "Instructor Beta", role: "instructor" },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    // Create a student and class schedule assigned to Instructor Alpha (inst1)
    const [tutStudentResult] = await pool.query(
      `INSERT INTO students (student_name, grade, parent_name, phone, status)
       VALUES ('Kidist Alemu', 8, 'Alemu Worku', '+251911122334', 'assigned')`
    );
    const tutStudentId = tutStudentResult.insertId;

    const [schedResult] = await pool.query(
      `INSERT INTO class_schedules (student_id, subject_name, class_date, start_time, teacher_name, instructor_id)
       VALUES (?, 'Advanced Python', '2026-11-10', '14:00:00', 'Instructor Alpha', ?)`,
      [tutStudentId, inst1Id]
    );
    const assignedClassId = schedResult.insertId;

    // Instructor Alpha accessing assigned class
    const inst1AccessRes = await fetch(`${BASE_URL}/instructor/classes/${assignedClassId}`, {
      headers: { Authorization: `Bearer ${inst1Token}` }
    });
    assert(inst1AccessRes.status === 200, "Assigned instructor can access their own class session");

    // Instructor Beta attempting to access Instructor Alpha's class
    const inst2AccessRes = await fetch(`${BASE_URL}/instructor/classes/${assignedClassId}`, {
      headers: { Authorization: `Bearer ${inst2Token}` }
    });
    assert(inst2AccessRes.status === 403, "Unassigned instructor blocked from accessing other instructor's class with HTTP 403");

    // Instructor attempting to access admin endpoints
    const instAdminRes = await fetch(`${BASE_URL}/admin/overview`, {
      headers: { Authorization: `Bearer ${inst1Token}` }
    });
    assert(instAdminRes.status === 403, "Instructor calling admin endpoint blocked with HTTP 403 Forbidden");

    // --------------------------------------------------------------------------
    // Test 6: Applicant Onboarding and Secure Account Activation
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 6] Applicant Onboarding & Secure Account Activation ---");
    const appEmail = `applicant_p3_${Date.now()}@academytest.et`;
    const appRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Derartu Tulu",
        phone: `+2519${Date.now().toString().slice(-8)}`,
        email: appEmail,
        gradeLevel: "Grade 11",
        programInterest: "HTML and CSS Fundamentals",
        preferredContact: "email"
      })
    });
    const appData = await appRes.json();
    assert(appRes.status === 201, "Submitted new applicant admission application");

    // Admin converts applicant to student
    const convertRes = await fetch(`${BASE_URL}/admin/applications/${appData.application.id}/convert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const convertData = await convertRes.json();
    assert(convertRes.status === 200 && convertData.success, "Admin converted applicant successfully");
    assert(convertData.isNewUser === true, "System identified new user requirement");
    assert(convertData.activationToken && convertData.activationUrl, "Generated single-use activation token and URL");
    assert(convertData.user.status === "pending_activation", "New account set to pending_activation status");
    assert(convertData.enrolledCourse !== null, "Enrolled applicant in matching curriculum course");

    // Verify token validity endpoint
    const verifyTokenRes = await fetch(
      `${BASE_URL}/auth/verify-activation-token?token=${encodeURIComponent(convertData.activationToken)}`
    );
    const verifyTokenData = await verifyTokenRes.json();
    assert(verifyTokenRes.status === 200 && verifyTokenData.valid === true, "Public token verification confirms valid token");
    assert(verifyTokenData.studentName === "Derartu Tulu", "Token verification provides verified applicant name");

    // Student activates account and sets personal password
    const studentChosenPass = "DerartuSuperSecure#2026!";
    const activateRes = await fetch(`${BASE_URL}/auth/activate-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: convertData.activationToken,
        password: studentChosenPass,
        confirmPassword: studentChosenPass
      })
    });
    const activateData = await activateRes.json();
    assert(activateRes.status === 200 && activateData.token, "Account activated successfully and session issued");

    // Verify account is now active in database
    const [[activatedDbUser]] = await pool.query("SELECT status FROM users WHERE id = ?", [convertData.user.id]);
    assert(activatedDbUser.status === "active", "Database user status transitioned to 'active'");

    // Student can now log in with the newly set password
    const studentNewLogin = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: appEmail, password: studentChosenPass })
    });
    assert(studentNewLogin.status === 200, "Student successfully logs in with their newly chosen password");

    // --------------------------------------------------------------------------
    // Test 7: Activation Token Expiration & Single-Use Enforcement
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 7] Activation Token Expiration & Single-Use Enforcement ---");
    // Attempt re-use of already consumed token
    const reuseTokenRes = await fetch(`${BASE_URL}/auth/activate-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: convertData.activationToken,
        password: "AnotherPassword123!",
        confirmPassword: "AnotherPassword123!"
      })
    });
    assert(reuseTokenRes.status === 400, "Used activation token rejected on second attempt (single-use enforced)");

    // Test expired activation token
    const rawExpiredToken = crypto.randomBytes(32).toString("hex");
    const expiredTokenHash = crypto.createHash("sha256").update(rawExpiredToken).digest("hex");
    await pool.query(
      `INSERT INTO account_activations (user_id, token_hash, expires_at)
       VALUES (?, ?, NOW() - INTERVAL 1 HOUR)`,
      [convertData.user.id, expiredTokenHash]
    );

    const expiredTokenRes = await fetch(`${BASE_URL}/auth/activate-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: rawExpiredToken,
        password: "ExpiredPassword123!",
        confirmPassword: "ExpiredPassword123!"
      })
    });
    assert(expiredTokenRes.status === 400, "Expired activation token rejected with HTTP 400");

    // --------------------------------------------------------------------------
    // Test 8: Password-Reset Security & Enumeration Defense
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 8] Password-Reset Security & Enumeration Defense ---");
    const forgotResKnown = await fetch(`${BASE_URL}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: appEmail })
    });
    const forgotDataKnown = await forgotResKnown.json();

    const forgotResUnknown = await fetch(`${BASE_URL}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "definitelynotfound@ethioacademy.et" })
    });
    const forgotDataUnknown = await forgotResUnknown.json();

    assert(
      forgotDataKnown.message === forgotDataUnknown.message,
      "Uniform response on forgot-password regardless of email presence (account enumeration prevented)"
    );

    // --------------------------------------------------------------------------
    // Test 9: Duplicate Prevention & Existing Account Linking
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 9] Duplicate Prevention & Existing Account Linking ---");
    // Submit second application for same student email
    const secondAppRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Derartu Tulu",
        phone: `+2519${Date.now().toString().slice(-8)}`,
        email: appEmail,
        gradeLevel: "Grade 11",
        programInterest: "Cloud DevOps & CI/CD Pipelines",
        preferredContact: "email"
      })
    });
    const secondAppData = await secondAppRes.json();
    assert(secondAppRes.status === 201, "Second application submitted for returning student");

    // Convert second application: should link to existing user rather than duplicating
    const secondConvertRes = await fetch(`${BASE_URL}/admin/applications/${secondAppData.application.id}/convert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const secondConvertData = await secondConvertRes.json();
    assert(secondConvertData.isNewUser === false, "Recognized existing account and linked without duplicate user creation");
    assert(secondConvertData.user.id === convertData.user.id, "Linked directly to original student user ID");

    // --------------------------------------------------------------------------
    // Test 10: Suspended Account Handling & Logout
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 10] Suspended Account Handling & Logout ---");
    // Suspend test student account
    await pool.query("UPDATE users SET status = 'suspended' WHERE id = ?", [studentUserId]);

    const suspendedAccess = await fetch(`${BASE_URL}/student/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert(suspendedAccess.status === 403, "Suspended user token immediately rejected with HTTP 403 Forbidden");

    // Restore to active
    await pool.query("UPDATE users SET status = 'active' WHERE id = ?", [studentUserId]);

    const logoutRes = await fetch(`${BASE_URL}/auth/logout`, { method: "POST" });
    assert(logoutRes.status === 200, "Logout endpoint confirms session termination");

    // --------------------------------------------------------------------------
    // Test 11: Existing Course, Quiz, Certificate, and Progress Features
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 11] Preserved Platform Features (LMS, Quiz, Certificate) ---");
    const coursesRes = await fetch(`${BASE_URL}/courses`);
    const coursesData = await coursesRes.json();
    assert(coursesRes.status === 200 && coursesData.courses.length > 0, "Public course catalog is operational");

    const certRes = await fetch(`${BASE_URL}/certificates/NON_EXISTENT_CODE`);
    assert(certRes.status === 404, "Public certificate verification correctly handles invalid code");

    // --------------------------------------------------------------------------
    // Test 12: Backend Health & System Status
    // --------------------------------------------------------------------------
    console.log("\n--- [TEST 12] Backend Health & System Status ---");
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200 && healthData.database === "connected", "API health check reports 200 OK with connected database");

    console.log("\n==================================================================");
    console.log(`PHASE 3 SECURITY SUITE: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}% success rate)`);
    console.log("==================================================================");

    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error("Test execution exception:", err);
    process.exit(1);
  }
}

runSecuritySuite();

