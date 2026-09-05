const API_BASE = "http://localhost:8000";
const loginPanel = document.getElementById("login-panel");
const dashboard = document.getElementById("dashboard");
const welcomeText = document.getElementById("welcome");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const studentPanel = document.getElementById("student-panel");
const teacherPanel = document.getElementById("teacher-panel");
const adminPanel = document.getElementById("admin-panel");
const studentResults = document.getElementById("student-results");
const semesterSelect = document.getElementById("semester-select");
const courseList = document.getElementById("course-list");
const assignmentForm = document.getElementById("assignment-form");
const assignmentMessage = document.getElementById("assignment-message");
let currentCourse = null;
const attendanceForm = document.getElementById("attendance-form");
const attendanceMessage = document.getElementById("attendance-message");
const classtestForm = document.getElementById("classtest-form");
const classtestMessage = document.getElementById("classtest-message");
const teacherAssignmentsForm = document.getElementById("teacher-assignments-form");
const teacherAssignmentsResults = document.getElementById("teacher-assignments-results");
const adminAssignForm = document.getElementById("admin-assign-form");
const adminAssignMessage = document.getElementById("admin-assign-message");

let activeUser = null;

function show(element, visible) {
  element.classList.toggle("hidden", !visible);
}

function setRolePanel(role) {
  show(studentPanel, role === "student");
  show(teacherPanel, role === "teacher");
  show(adminPanel, role === "admin");
}

function renderTable(data) {
  if (!data.length) {
    return "<p>No records found.</p>";
  }

  const keys = Object.keys(data[0]);
  const header = keys.map((k) => `<th>${k}</th>`).join("");
  const rows = data
    .map((row) => {
      return `<tr>${keys
        .map((key) => `<td>${String(row[key] ?? "")}</td>`)
        .join("")}</tr>`;
    })
    .join("");

  return `<table class="result-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function setError(message) {
  loginError.textContent = message;
}

function resetMessages() {
  assignmentMessage.textContent = "";
  attendanceMessage.textContent = "";
  classtestMessage.textContent = "";
  teacherAssignmentsResults.innerHTML = "";
  adminAssignMessage.textContent = "";
  studentResults.innerHTML = "";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userId = document.getElementById("userId").value.trim();
  if (!userId) {
    setError("Please enter a user ID.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });

    if (!response.ok) {
      const error = await response.json();
      setError(error.detail || "Login failed.");
      return;
    }

    const data = await response.json();
    activeUser = { id: userId, role: data.role, profile: data.profile };
    welcomeText.textContent = `Logged in as ${data.role.toUpperCase()} (${userId})`;
    setRolePanel(data.role);
    show(loginPanel, false);
    show(dashboard, true);
    setError("");
    resetMessages();
  } catch (err) {
    setError("Unable to reach the backend. Make sure the API is running.");
  }
});

logoutBtn.addEventListener("click", () => {
  activeUser = null;
  document.getElementById("userId").value = "";
  show(loginPanel, true);
  show(dashboard, false);
  setRolePanel("");
  resetMessages();
});

async function fetchStudentData(path, targetElement) {
  if (!activeUser) return;
  try {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) {
      const error = await response.json();
      targetElement.innerHTML = `<p class="error">${error.detail || "Unable to retrieve data."}</p>`;
      return;
    }
    const data = await response.json();
    const key = Object.keys(data)[0];
    targetElement.innerHTML = renderTable(data[key]);
  } catch (err) {
    targetElement.innerHTML = `<p class="error">Failed to fetch data from backend.</p>`;
  }
}

document.getElementById("load-attendance").addEventListener("click", () => {
  fetchStudentData(`/student/${encodeURIComponent(activeUser.id)}/attendance`, studentResults);
});

document.getElementById("load-class-tests").addEventListener("click", () => {
  fetchStudentData(`/student/${encodeURIComponent(activeUser.id)}/class_tests`, studentResults);
});

async function loadCoursesForSemester(semester) {
  if (!semester) return;
  try {
    const resp = await fetch(`${API_BASE}/courses?semester=${encodeURIComponent(semester)}`);
    if (!resp.ok) {
      courseList.innerHTML = `<p class='error'>Unable to load courses.</p>`;
      return;
    }
    const data = await resp.json();
    const courses = data.courses || [];
    if (!courses.length) {
      courseList.innerHTML = `<p>No courses found for semester ${semester}.</p>`;
      return;
    }
    courseList.innerHTML = courses
      .map((c) => `<button class="small" data-course-id="${c.course_id}">${c.course_id} - ${c.course_name}</button>`)
      .join(" ");

    // attach click handlers
    Array.from(courseList.querySelectorAll("button[data-course-id]")).forEach((btn) => {
      btn.addEventListener("click", () => selectCourse(btn.dataset.courseId));
    });
  } catch (err) {
    courseList.innerHTML = `<p class='error'>Failed to load courses.</p>`;
  }
}

async function selectCourse(courseId) {
  currentCourse = courseId;
  document.getElementById("assignment-course-id").value = courseId;
  // fetch attendance and class tests for this course and active user
  try {
    const [attResp, testResp] = await Promise.all([
      fetch(`${API_BASE}/student/${encodeURIComponent(activeUser.id)}/courses/${encodeURIComponent(courseId)}/attendance`),
      fetch(`${API_BASE}/student/${encodeURIComponent(activeUser.id)}/courses/${encodeURIComponent(courseId)}/class_tests`),
    ]);
    const attData = attResp.ok ? await attResp.json() : null;
    const testData = testResp.ok ? await testResp.json() : null;
    let html = `<h4>${courseId}</h4>`;
    if (attData && attData.attendance) html += renderTable(attData.attendance);
    else html += `<p>No attendance records.</p>`;
    if (testData && testData.class_tests) html += `<h4>Class Tests</h4>` + renderTable(testData.class_tests);
    else html += `<p>No class tests.</p>`;
    studentResults.innerHTML = html;
  } catch (err) {
    studentResults.innerHTML = `<p class='error'>Unable to load course details.</p>`;
  }
}

semesterSelect?.addEventListener("change", (e) => {
  const sem = e.target.value;
  loadCoursesForSemester(sem);
});

assignmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const courseId = document.getElementById("assignment-course-id").value.trim();
  const assignmentId = document.getElementById("assignment-id").value.trim();
  const fileInput = document.getElementById("assignment-file");
  const file = fileInput.files[0];
  if (!courseId || !assignmentId || !file) {
    assignmentMessage.textContent = "Fill in all assignment fields and select a file.";
    return;
  }
  if (!activeUser) {
    assignmentMessage.textContent = "You must be logged in.";
    return;
  }

  try {
    const fd = new FormData();
    fd.append("assignment_id", assignmentId);
    fd.append("file", file);
    const resp = await fetch(`${API_BASE}/student/${encodeURIComponent(activeUser.id)}/courses/${encodeURIComponent(courseId)}/assignments`, {
      method: "POST",
      body: fd,
    });
    if (!resp.ok) {
      const err = await resp.json();
      assignmentMessage.textContent = err.detail || "Submission failed.";
      return;
    }
    const data = await resp.json();
    assignmentMessage.textContent = `Uploaded ${data.filename} successfully.`;
    assignmentForm.reset();
  } catch (err) {
    assignmentMessage.textContent = "Unable to submit assignment.";
  }
});

attendanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const courseId = document.getElementById("attendance-course-id").value.trim();
  const date = document.getElementById("attendance-date").value;
  const entries = document.getElementById("attendance-entries").value
    .split("\n")
    .map((line) => line.split(","))
    .filter((parts) => parts.length === 2)
    .map(([roll, status]) => ({ roll: roll.trim(), status: status.trim().toLowerCase() }));

  if (!courseId || entries.length === 0) {
    attendanceMessage.textContent = "Provide a course and at least one attendance entry.";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/teacher/${encodeURIComponent(activeUser.id)}/courses/${encodeURIComponent(courseId)}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: date || null, entries }),
    });
    const data = await response.json();
    if (!response.ok) {
      attendanceMessage.textContent = data.detail || "Attendance submission failed.";
      return;
    }
    attendanceMessage.textContent = `Inserted ${data.inserted} attendance records.`;
    attendanceForm.reset();
  } catch (err) {
    attendanceMessage.textContent = "Unable to submit attendance.";
  }
});

classtestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const courseId = document.getElementById("classtest-course-id").value.trim();
  const title = document.getElementById("classtest-title").value.trim();
  const totalMarks = Number(document.getElementById("classtest-total-marks").value);
  const entries = document.getElementById("classtest-entries").value
    .split("\n")
    .map((line) => line.split(","))
    .filter((parts) => parts.length === 2)
    .map(([roll, marks]) => ({ roll: roll.trim(), marks: Number(marks.trim()) }));

  if (!courseId || !title || totalMarks <= 0 || entries.length === 0) {
    classtestMessage.textContent = "Fill in all test fields and provide at least one student mark.";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/teacher/${encodeURIComponent(activeUser.id)}/courses/${encodeURIComponent(courseId)}/class_test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, total_marks: totalMarks, marks: entries }),
    });
    const data = await response.json();
    if (!response.ok) {
      classtestMessage.textContent = data.detail || "Class test submission failed.";
      return;
    }
    classtestMessage.textContent = `Inserted ${data.inserted} class test records.`;
    classtestForm.reset();
  } catch (err) {
    classtestMessage.textContent = "Unable to submit class test data.";
  }
});

teacherAssignmentsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const courseId = document.getElementById("teacher-assignments-course-id").value.trim();
  if (!courseId) {
    teacherAssignmentsResults.innerHTML = "<p class='error'>Provide a course ID.</p>";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/teacher/${encodeURIComponent(activeUser.id)}/courses/${encodeURIComponent(courseId)}/assignments`);
    const data = await response.json();
    if (!response.ok) {
      teacherAssignmentsResults.innerHTML = `<p class='error'>${data.detail || "Unable to load submissions."}</p>`;
      return;
    }
    teacherAssignmentsResults.innerHTML = renderTable(data.submissions);
  } catch (err) {
    teacherAssignmentsResults.innerHTML = "<p class='error'>Unable to reach backend.</p>";
  }
});

adminAssignForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const courseId = document.getElementById("admin-course-id").value.trim();
  const teacherId = document.getElementById("admin-teacher-id").value.trim();
  if (!courseId || !teacherId) {
    adminAssignMessage.textContent = "Provide both a course ID and teacher ID.";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/admin/${encodeURIComponent(activeUser.id)}/assign_course`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: courseId, teacher_id: teacherId }),
    });
    const data = await response.json();
    if (!response.ok) {
      adminAssignMessage.textContent = data.detail || "Course assignment failed.";
      return;
    }
    adminAssignMessage.textContent = "Course assigned successfully.";
    adminAssignForm.reset();
  } catch (err) {
    adminAssignMessage.textContent = "Unable to assign course.";
  }
});
