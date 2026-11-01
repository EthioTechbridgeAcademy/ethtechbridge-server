import "dotenv/config";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const BASE_URL = "http://localhost:5000/api";

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ [PASS] ${message}`);
}

async function testWorkflow() {
  console.log("==================================================================");
  console.log("   STUDENT ADMISSION WORKFLOW & RBAC VERIFICATION SUITE           ");
  console.log("==================================================================");

  const testEmail = `workflow_test_${Date.now()}@example.com`;
  const testPhone = "0981329252";
  const testPassword = "Password123!";
  let testUserId = null;
  let studentToken = null;
  let adminToken = null;
  let applicationNumber = null;
  let applicationId = null;

  try {
    // 0. Get or setup an admin token
    console.log("\n--- 1. Administrator Session ---");
    const [adminRows] = await pool.query("SELECT id, full_name, email FROM users WHERE role = 'admin' LIMIT 1");
    let adminUser = adminRows[0];
    if (!adminUser) {
      const hash = await bcrypt.hash("AdminPass123!", 10);
      const [newAdmin] = await pool.query(
        "INSERT INTO users (full_name, email, password_hash, role, status) VALUES ('System Admin', 'sysadmin@ethtechbridge.local', ?, 'admin', 'active')",
        [hash]
      );
      adminUser = { id: newAdmin.insertId, full_name: "System Admin", email: "sysadmin@ethtechbridge.local" };
    }
    adminToken = jwt.sign(
      { id: adminUser.id, email: adminUser.email, name: adminUser.full_name, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    assert(!!adminToken, "Admin session token generated");

    // 1. User Registration (Student creates an account first)
    console.log("\n--- 2. Student Account Creation (Step 1) ---");
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Test Admission Applicant",
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
        phone: testPhone
      })
    });
    const regData = await regRes.json();
    assert(regRes.status === 201, "Account created successfully with 201 Created");
    assert(!!regData.token, "Student JWT token issued on registration");
    studentToken = regData.token;
    testUserId = regData.user.id;

    // 2. Student checks initial status before applying
    console.log("\n--- 3. Initial Status Check (No Application Yet) ---");
    const statusRes1 = await fetch(`${BASE_URL}/applications/my-status`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const statusData1 = await statusRes1.json();
    assert(statusRes1.status === 200, "Checked status successfully");
    assert(statusData1.hasApplication === false, "Correctly identifies that user has no application yet");

    // 3. Student submits admission application while authenticated
    console.log("\n--- 4. Student Submits Admission Application (Step 2) ---");
    const appRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        fullName: "Test Admission Applicant",
        email: testEmail,
        phone: testPhone,
        gradeLevel: "High School (Grade 9-12)",
        programInterest: "Full-Stack Web Development",
        preferredContact: "phone",
        notes: "Excited to learn coding and modern web technologies."
      })
    });
    const appData = await appRes.json();
    assert(appRes.status === 201, "Admission application submitted with 201 Created");
    assert(appData.application.status === "pending", "Initial application status is 'pending'");
    applicationNumber = appData.applicationNumber;
    applicationId = appData.application.id;

    // Verify user_id is set in DB
    const [dbAppRows] = await pool.query("SELECT user_id, status FROM applications WHERE id = ?", [applicationId]);
    assert(dbAppRows[0].user_id == testUserId, "Application record has user_id properly attached");

    // 4. Duplicate submission prevention (Student cannot spam second pending application)
    console.log("\n--- 5. Duplicate Application Prevention ---");
    const dupRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        fullName: "Test Admission Applicant",
        email: testEmail,
        phone: testPhone,
        gradeLevel: "High School (Grade 9-12)",
        programInterest: "Full-Stack Web Development",
        preferredContact: "phone"
      })
    });
    const dupData = await dupRes.json();
    assert(dupRes.status === 409, "Second application rejected with 409 Conflict");
    assert(dupData.alreadyPending === true, "Response indicates alreadyPending is true");

    // 5. Student checks my-status endpoint
    console.log("\n--- 6. Student Checks Application Status ---");
    const statusRes2 = await fetch(`${BASE_URL}/applications/my-status`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const statusData2 = await statusRes2.json();
    assert(statusData2.hasApplication === true, "Student sees hasApplication: true");
    assert(statusData2.application.status === "pending", "Student sees status is 'pending'");

    // 6. Student views student dashboard (Shows Pending Admission Review)
    console.log("\n--- 7. Student Dashboard Pending Admission State ---");
    const dashRes = await fetch(`${BASE_URL}/student/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const dashData = await dashRes.json();
    assert(dashRes.status === 200, "Dashboard loaded successfully");
    assert(dashData.admission?.status === "pending", "Dashboard returns admission.status = 'pending'");
    assert(dashData.admission?.applicationNumber === applicationNumber, "Dashboard includes application number");

    // 7. Security: Student self-enrollment blocked while admission is pending
    console.log("\n--- 8. Gated Course Self-Enrollment While Pending ---");
    const [courseRows] = await pool.query("SELECT slug FROM courses WHERE is_published = 1 AND slug IS NOT NULL LIMIT 1");
    if (courseRows.length > 0) {
      const enrollRes = await fetch(`${BASE_URL}/courses/${courseRows[0].slug}/enroll`, {
        method: "POST",
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      const enrollData = await enrollRes.json();
      assert(enrollRes.status === 403, "Direct course self-enrollment blocked with 403 Forbidden while admission is pending");
      assert(enrollData.code === "ADMISSION_PENDING", "Returned error code ADMISSION_PENDING");
    }

    // 8. Security: Student cannot access Admin endpoints
    console.log("\n--- 9. Role-Based Access Control (Student cannot access Admin) ---");
    const adminCheckRes = await fetch(`${BASE_URL}/admin/applications`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert(adminCheckRes.status === 403, "Student access to /api/admin/applications forbidden with 403");

    // 9. Administrator reviews and approves the application
    console.log("\n--- 10. Administrator Approves Application ---");
    const approveRes = await fetch(`${BASE_URL}/admin/applications/${applicationId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        status: "approved",
        adminNotes: "Applicant meets academic requirements. Approved for admission."
      })
    });
    const approveData = await approveRes.json();
    assert(approveRes.status === 200, "Admin status update succeeded with 200 OK");
    assert(approveData.application.status === "approved", "Application status updated to 'approved'");

    // 10. Student checks status after approval
    console.log("\n--- 11. Student Checks Status After Approval ---");
    const dashResAfter = await fetch(`${BASE_URL}/student/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const dashDataAfter = await dashResAfter.json();
    assert(dashDataAfter.admission?.status === "approved", "Student dashboard reflects 'approved' admission status");

    console.log("\n==================================================================");
    console.log("   ALL ADMISSION WORKFLOW & SECURITY TESTS PASSED!                ");
    console.log("==================================================================");
  } finally {
    // Cleanup test records
    console.log("\n--- Cleanup Test Records ---");
    if (applicationId) {
      await pool.query("DELETE FROM applications WHERE id = ?", [applicationId]);
      console.log(`  Cleaned up test application id ${applicationId}`);
    }
    if (testUserId) {
      await pool.query("DELETE FROM enrollments WHERE user_id = ?", [testUserId]);
      await pool.query("DELETE FROM account_activations WHERE user_id = ?", [testUserId]);
      await pool.query("DELETE FROM users WHERE id = ?", [testUserId]);
      console.log(`  Cleaned up test user id ${testUserId}`);
    }
    await pool.end();
  }
}

testWorkflow().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
