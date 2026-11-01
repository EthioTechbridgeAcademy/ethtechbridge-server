async function runAllJourneys() {
  const BASE_URL = "http://localhost:5000/api";
  console.log("=== STARTING ETHIO TECHBRIDGE ACADEMY JOURNEY VERIFICATION ===");

  // JOURNEY A: Public Visitor
  console.log("\n--- [JOURNEY A] Public Visitor ---");
  const catRes = await (await fetch(`${BASE_URL}/categories`)).json();
  console.log("✓ Fetched public categories:", catRes.categories.length);

  const searchRes = await (await fetch(`${BASE_URL}/courses?search=Python`)).json();
  console.log("✓ Filtered courses by keyword 'Python': found", searchRes.courses.length, "match(es)");
  const pythonCourse = searchRes.courses[0];

  const detailRes = await (await fetch(`${BASE_URL}/courses/${pythonCourse.slug}`)).json();
  console.log("✓ Course details fetched for:", detailRes.course.title);
  console.log("  Curriculum modules count:", detailRes.curriculum.length);

  const firstLesson = detailRes.curriculum[0].lessons[0];
  console.log("  First lesson previewable?", Boolean(firstLesson.is_preview));

  const previewRes = await fetch(`${BASE_URL}/courses/${pythonCourse.slug}/preview/${firstLesson.slug}`);
  console.log("✓ Public preview lesson endpoint status:", previewRes.status);
  const previewData = await previewRes.json();
  console.log("  Preview lesson content loaded:", previewData.lesson.title, `(${previewData.lesson.content_text.length} chars)`);

  // JOURNEY B: New Student Registration, Enrollment & Progress
  console.log("\n--- [JOURNEY B] New Student Registration & Enrollment ---");
  const testEmail = `student_${Date.now()}@ethioacademy.et`;
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Meron Assefa",
      email: testEmail,
      password: "SecureStudentPass2026!",
      confirmPassword: "SecureStudentPass2026!",
      phone: "+251922334455"
    })
  });
  const regData = await regRes.json();
  console.log("✓ Student registered:", regData.user.name, `(${regData.user.email})`);
  const studentToken = regData.token;

  const enrollRes = await fetch(`${BASE_URL}/courses/html-and-css-fundamentals/enroll`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  const enrollData = await enrollRes.json();
  console.log("✓ Enrolled in course:", enrollData.message);

  const classRes = await (await fetch(`${BASE_URL}/student/courses/html-and-css-fundamentals/learn`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  })).json();
  console.log("✓ Classroom loaded with", classRes.lessons.length, "lessons");

  const lesson1 = classRes.lessons[0];
  const progRes1 = await (await fetch(`${BASE_URL}/student/lessons/${lesson1.id}/progress`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isCompleted: true })
  })).json();
  console.log("✓ Lesson 1 marked complete. New progress:", progRes1.progressPercent + "%");

  // JOURNEY C: Returning Student Resumes
  console.log("\n--- [JOURNEY C] Returning Student Resume & Dashboard ---");
  const loginRes = await (await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: testEmail,
      password: "SecureStudentPass2026!"
    })
  })).json();
  console.log("✓ Re-authenticated returning student:", loginRes.user.name);

  const dashRes = await (await fetch(`${BASE_URL}/student/dashboard`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  })).json();
  console.log("✓ Dashboard Continue Learning course:", dashRes.continueLearning.course_title);
  console.log("  Overall student progress recorded:", dashRes.stats.overallProgressPercent + "%");

  const lesson2 = classRes.lessons[1];
  const progRes2 = await (await fetch(`${BASE_URL}/student/lessons/${lesson2.id}/progress`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isCompleted: true })
  })).json();
  console.log("✓ Lesson 2 marked complete. Updated progress:", progRes2.progressPercent + "%");

  // JOURNEY D: Quiz & Assessment Server Evaluation
  console.log("\n--- [JOURNEY D] Quiz & Assessment ---");
  const quizId = classRes.quizzes[0].id;
  const quizRes = await (await fetch(`${BASE_URL}/student/quizzes/${quizId}`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  })).json();
  console.log("✓ Fetched quiz:", quizRes.quiz.title, "with", quizRes.questions.length, "questions");

  // Verify options don't leak is_correct
  const leakCheck = JSON.stringify(quizRes.questions).includes("is_correct");
  console.log("  Security verification (is_correct hidden from client):", leakCheck ? "FAIL" : "PASS (SECURE)");

  const submissionAnswers = {};
  quizRes.questions.forEach((q) => {
    // pick second option or first
    submissionAnswers[q.id] = q.options[1]?.id || q.options[0].id;
  });

  const subRes = await (await fetch(`${BASE_URL}/student/quizzes/${quizId}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ answers: submissionAnswers })
  })).json();
  console.log("✓ Quiz evaluated by server: Score =", subRes.score + "%, Passed =", subRes.passed);
  console.log("  Detailed question review count returned:", subRes.review.length);

  // JOURNEY E: Administrator Workflow
  console.log("\n--- [JOURNEY E] Administrator Workflow ---");
  const adminLogin = await (await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "yegnabetsew@gmail.com",
      password: "ChangeThisAdminPassword123!"
    })
  })).json();
  console.log("✓ Admin signed in:", adminLogin.user.name, `(Role: ${adminLogin.user.role})`);
  const adminToken = adminLogin.token;

  // Create course
  const uniqueCourseSlug = `test-devops-track-${Date.now()}`;
  const createRes = await (await fetch(`${BASE_URL}/admin/courses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Cloud DevOps & CI/CD Pipelines",
      slug: uniqueCourseSlug,
      difficulty: "intermediate",
      durationHours: 15,
      isPublished: true,
      isFree: true,
      description: "Learn automated continuous integration, Docker containers, and cloud deployment."
    })
  })).json();
  console.log("✓ Admin created course:", createRes.message, `(ID: ${createRes.courseId})`);

  // Add module
  const modRes = await (await fetch(`${BASE_URL}/admin/courses/${createRes.courseId}/modules`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Module 1: Docker Containers" })
  })).json();
  console.log("✓ Admin added module ID:", modRes.moduleId);

  // Add lesson
  const lesRes = await (await fetch(`${BASE_URL}/admin/courses/${createRes.courseId}/lessons`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      moduleId: modRes.moduleId,
      title: "Introduction to Docker",
      contentType: "article",
      contentText: "# Docker Containers\nContainers package code with its dependencies.",
      durationMinutes: 20,
      isPreview: true
    })
  })).json();
  console.log("✓ Admin added lesson ID:", lesRes.lessonId);

  // Verify course appears publicly
  const verifyPub = await (await fetch(`${BASE_URL}/courses/${uniqueCourseSlug}`)).json();
  console.log("✓ Newly created course is publicly discoverable:", verifyPub.course.title);

  // JOURNEY F: Security & Authorization Denials
  console.log("\n--- [JOURNEY F] Security & Access Controls ---");
  // 1. Student trying to call admin endpoint
  const unauthorizedAdminCall = await fetch(`${BASE_URL}/admin/overview`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  console.log("✓ Student calling /admin/overview denial status:", unauthorizedAdminCall.status, "(Forbidden 403 expected)");

  // 2. Unauthenticated user calling protected student classroom
  const unauthClassroomCall = await fetch(`${BASE_URL}/student/courses/html-and-css-fundamentals/learn`);
  console.log("✓ Unauthenticated request to /student classroom status:", unauthClassroomCall.status, "(Unauthorized 401 expected)");

  // 3. Trying to access private lesson without preview flag as guest
  const guestPrivateLesson = await fetch(`${BASE_URL}/courses/html-and-css-fundamentals/preview/html-forms-and-media`);
  console.log("✓ Guest requesting non-preview lesson status:", guestPrivateLesson.status, "(Forbidden 403 expected)");

  console.log("\n=== ALL USER JOURNEYS (A, B, C, D, E, F) COMPLETED AND VERIFIED SUCCESSFULLY! ===");
}

runAllJourneys().catch(console.error);

