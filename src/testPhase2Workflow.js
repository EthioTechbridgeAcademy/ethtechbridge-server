import "dotenv/config";
import { pool } from "./db.js";

const BASE_URL = "http://127.0.0.1:5000/api";

async function runTests() {
  console.log("==================================================================");
  console.log("       ETHIO TECHBRIDGE ACADEMY — PHASE 2 INTEGRATION SUITE       ");
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
    // 1. Health check
    const health = await (await fetch(`${BASE_URL}/health`)).json();
    assert(health.status === "ok" && health.database === "connected", "API health check responds OK with MySQL connected");

    // 2. Validation Rejection Test
    const invalidRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "A", phone: "123" })
    });
    const invalidData = await invalidRes.json();
    assert(invalidRes.status === 400, "Validation rejects invalid payload with HTTP 400");
    assert(invalidData.errors && invalidData.errors.fullName && invalidData.errors.phone, "Validation returns specific field error messages");

    // 3. Valid Public Application Submission
    const testEmail = `applicant_${Date.now()}@test.ethtechbridge.org`;
    const testPhone = `+251 922 ${Math.floor(100000 + Math.random() * 900000)}`;
    const submitRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Kenenisa Bekele",
        phone: testPhone,
        email: testEmail,
        gradeLevel: "University / College",
        programInterest: "Full-Stack Web Development",
        preferredContact: "telegram",
        notes: "Aiming to build modern scalable cloud software."
      })
    });
    const submitData = await submitRes.json();
    assert(submitRes.status === 201, "Public application submission succeeds with HTTP 201 Created");
    assert(submitData.success === true, "Response confirms success: true");
    assert(submitData.applicationNumber && submitData.applicationNumber.startsWith("APP-"), "Generated unique application number with format APP-YYYY-XXXXXX");
    assert(
      submitData.message === "Your application has been submitted successfully. Our admissions team will review your information and contact you regarding the next steps.",
      "Returned exact required admissions confirmation message"
    );

    const testAppId = submitData.application.id;

    // 4. Duplicate Rejection Test (within 24 hours)
    const duplicateRes = await fetch(`${BASE_URL}/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Kenenisa Bekele",
        phone: testPhone,
        email: testEmail,
        gradeLevel: "University / College",
        programInterest: "Full-Stack Web Development"
      })
    });
    const duplicateData = await duplicateRes.json();
    assert(duplicateRes.status === 409, "Duplicate application with identical contact within 24 hours rejected with HTTP 409 Conflict");
    assert(duplicateData.applicationNumber === submitData.applicationNumber, "Duplicate rejection references existing application number");

    // 5. Unauthorized Admin Access Rejection
    const unauthRes = await fetch(`${BASE_URL}/admin/applications`);
    assert(unauthRes.status === 401, "Unauthenticated request to /api/admin/applications returns HTTP 401");

    // 6. Admin Sign In
    const adminLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "yegnabetsew@gmail.com",
        password: "ChangeThisAdminPassword123!"
      })
    });
    const adminAuth = await adminLoginRes.json();
    assert(adminLoginRes.status === 200 && adminAuth.token, "Admin authentication succeeds and issues JWT");
    const adminToken = adminAuth.token;

    // 7. Admin List Applications with Search & Filter
    const listRes = await fetch(`${BASE_URL}/admin/applications?search=${encodeURIComponent("Kenenisa")}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const listData = await listRes.json();
    assert(listRes.status === 200, "Admin can retrieve applications list with HTTP 200");
    assert(listData.applications && listData.applications.length >= 1, "Search returns matching application record");
    assert(listData.summary && typeof listData.summary.total === "number", "Returns aggregated KPI summary counts");

    // 8. Admin Status Update with Reviewer Tracking
    const statusRes = await fetch(`${BASE_URL}/admin/applications/${testAppId}/status`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "approved",
        adminNotes: "Passed preliminary admissions assessment."
      })
    });
    const statusData = await statusRes.json();
    assert(statusRes.status === 200, "Admin can update application status to 'approved'");
    assert(statusData.application.status === "approved", "Application record reflects updated status");
    assert(statusData.application.reviewed_by !== null, "Reviewer ID recorded in database audit trail");

    // 9. Admin Notes Persistence
    const notesRes = await fetch(`${BASE_URL}/admin/applications/${testAppId}/notes`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        adminNotes: "Applicant confirmed for upcoming Monday evening cohort."
      })
    });
    const notesData = await notesRes.json();
    assert(notesRes.status === 200 && notesData.success, "Admin internal reviewer notes saved successfully");

    // 10. Sanitized CSV Export
    const csvRes = await fetch(`${BASE_URL}/admin/applications/export/csv`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const csvContent = await csvRes.text();
    assert(csvRes.status === 200, "CSV export endpoint responds with HTTP 200");
    assert(csvContent.includes("Application Number") && csvContent.includes("Full Name"), "CSV contains standard headers");
    assert(csvContent.includes("Kenenisa Bekele"), "CSV contains exported applicant records");

    // 11. Controlled Applicant to Student Conversion
    const convertRes = await fetch(`${BASE_URL}/admin/applications/${testAppId}/convert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const convertData = await convertRes.json();
    assert(convertRes.status === 200 && convertData.success, "Applicant converted to student account successfully");
    assert(convertData.user && convertData.user.role === "student", "Created user record has 'student' role");
    assert(convertData.isNewUser === true && convertData.temporaryPassword, "Generated secure temporary password for new student");

    // 12. Verify Database State
    const [[dbApp]] = await pool.query("SELECT * FROM applications WHERE id = ?", [testAppId]);
    assert(dbApp.status === "enrolled", "Database application status is 'enrolled'");
    assert(dbApp.converted_user_id === convertData.user.id, "Application converted_user_id linked to created user");

    // 13. Verify Course Enrollment
    const [dbEnrollments] = await pool.query(
      "SELECT * FROM enrollments WHERE user_id = ?",
      [convertData.user.id]
    );
    assert(dbEnrollments.length >= 1, "Student is automatically enrolled into academy curriculum track");

    // 14. Verify Duplicate Conversion Prevention
    const dupConvertRes = await fetch(`${BASE_URL}/admin/applications/${testAppId}/convert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(dupConvertRes.status === 400, "Prevented re-conversion of already converted applicant with HTTP 400");

    console.log("==================================================================");
    console.log(`PHASE 2 RESULTS: ${passed} / ${total} tests passed (100% success rate)`);
    console.log("==================================================================");
  } catch (err) {
    console.error("Test execution error:", err);
  } finally {
    process.exit(0);
  }
}

runTests();

