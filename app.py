"""Flask REST API for the Smart Attendance teacher dashboard."""
from datetime import date, datetime, timedelta
from functools import wraps
from io import BytesIO
import os
from uuid import uuid4
from flask import Flask, jsonify, request
from werkzeug.utils import secure_filename
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, A3
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
import database

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "change-this-development-secret")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
app.config["UPLOAD_FOLDER"] = os.path.join(os.path.dirname(__file__), "uploads", "assignments")
CORS(app)
serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])
ALLOWED_ASSIGNMENT_EXTENSIONS = {"pdf", "doc", "docx", "txt", "ppt", "pptx"}

def public(doc):
    if not doc: return doc
    doc = dict(doc)
    for key in ("_id", "password", "password_hash"): doc.pop(key, None)
    return doc
def error(message, status=400): return jsonify({"error": message}), status
def identity():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "): return None
    try:
        token = serializer.loads(auth[7:], max_age=28800)
        user = database.users.find_one({"username": token.get("username")})
        if not user or user.get("status") != "active" or user.get("token_version", 0) != token.get("token_version", 0): return None
        return token
    except (BadSignature, SignatureExpired): return None
def require_role(required_role):
    """Authorize only the role encoded in the signed login token."""
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = identity()
            if not user or user.get("role") != required_role:
                return error("Authentication is required", 401)
            request.user = user
            request.teacher_id = user.get("teacher_id")
            request.student_id = user.get("student_id")
            return fn(*args, **kwargs)
        return wrapped
    return decorator

def require_teacher(fn):
    return require_role("teacher")(fn)

def require_student(fn):
    return require_role("student")(fn)

def require_admin(fn):
    return require_role("admin")(fn)

def legacy_require_teacher(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        user = identity()
        if not user or user.get("role") != "teacher": return error("Teacher authentication is required", 401)
        request.teacher_id = user["teacher_id"]
        return fn(*args, **kwargs)
    return wrapped
def owned_course(course_code):
    course = database.courses.find_one({"course_id": course_code.replace(" ", "")}) or database.courses.find_one({"course_code": course_code})
    if not course: return None, error("Course not found", 404)
    assigned = database.course_assignments.find_one({"course_id": course["course_id"], "teacher_id": request.teacher_id, "status": "active"})
    if not assigned and course.get("teacher_id") != request.teacher_id: return None, error("You are not assigned to this course", 403)
    if assigned:
        course = {**course, "series": assigned["series"], "semester": assigned["semester"], "teacher_id": request.teacher_id}
    return course, None
def students_for(course):
    rolls = [row["roll"] for row in database.enrollments.find({"course_id": course["course_id"]})]
    return sorted([public(row) for row in database.students.find({"roll": {"$in": rolls}})], key=lambda row: row["roll"])
def slots(course):
    try: start = date.fromisoformat(course.get("course_start_date", ""))
    except ValueError: start = date.today()
    start -= timedelta(days=start.weekday())
    saved = {(row["week"], row["day"]): public(row) for row in database.class_sessions.find({"course_id": course["course_id"]})}
    all_slots = []
    for week in range(1, 14):
        for day in range(1, 6):
            default = {"course_id": course["course_id"], "course_code": course["course_code"], "series": course["series"], "semester": course["semester"], "week": week, "day": day, "date": (start + timedelta(days=(week - 1) * 7 + day - 1)).isoformat(), "class_held": False, "teacher_id": course["teacher_id"]}
            all_slots.append(saved.get((week, day), default))
    return all_slots
def attendance_summary(course):
    held = {(row["week"], row["day"]): row for row in slots(course) if row.get("class_held")}
    stored = {(row["roll"], row["week"], row["day"]): row.get("status") for row in database.attendance.find({"course_id": course["course_id"]}) if "roll" in row and "week" in row and "day" in row}
    rows = []
    for student in students_for(course):
        present = sum(stored.get((student["roll"], week, day)) == "Present" for week, day in held)
        total = len(held); pct = round(present * 100 / total, 2) if total else 0
        cells = {f"w{week}d{day}": stored.get((student["roll"], week, day), "") for week in range(1, 14) for day in range(1, 6)}
        rows.append({**student, "attendance": cells, "total_held": total, "present": present, "absent": total-present, "attendance_percentage": pct, "attendance_status": "Good" if pct >= 80 else "Warning" if pct >= 70 else "Critical"})
    return rows
def test_summary(course):
    values = {(row["roll"], row["test_number"]): row.get("obtained_marks") for row in database.class_test_results.find({"course_id": course["course_id"]}) if "roll" in row and "test_number" in row}
    rows = []
    for student in students_for(course):
        tests = [values.get((student["roll"], number)) for number in range(1, 5)]
        seen = [mark for mark in tests if isinstance(mark, (int, float))]
        rows.append({**student, "ct1": tests[0], "ct2": tests[1], "ct3": tests[2], "ct4": tests[3], "best_3_average": round(sum(sorted(seen, reverse=True)[:3]) / 3, 2) if len(seen) >= 3 else None})
    return rows

def current_student():
    student = database.students.find_one({"student_id": request.student_id, "status": "active"})
    if not student:
        return None, error("Student profile was not found", 404)
    return student, None

def student_course(course_code):
    """Load an authorized course using the authenticated student's database profile."""
    student, response = current_student()
    if response:
        return None, None, response
    course = database.courses.find_one({"course_id": course_code.replace(" ", "")}) or database.courses.find_one({"course_code": course_code})
    if not course:
        return None, None, error("Course not found", 404)
    semester = student.get("current_semester", student.get("semester"))
    if course.get("semester") != semester:
        return None, None, error("You are not authorized to access this course.", 403)
    # If enrollment records exist, this student must have one for the course.
    if database.enrollments.find_one({}) and not database.enrollments.find_one({"course_id": course["course_id"], "student_id": student["student_id"]}):
        return None, None, error("You are not enrolled in this course.", 403)
    return student, course, None

def student_course_summary(student, course):
    held = [row for row in database.class_sessions.find({"course_id": course["course_id"]}) if row.get("class_held")]
    records = {(row.get("week"), row.get("day")): row for row in database.attendance.find({"course_id": course["course_id"], "student_id": student["student_id"]})}
    present = sum(records.get((row.get("week"), row.get("day")), {}).get("status") == "Present" for row in held)
    total = len(held); percentage = round(present * 100 / total, 2) if total else 0
    marks = [row.get("obtained_marks") for row in database.class_test_results.find({"course_id": course["course_id"], "student_id": student["student_id"]}) if isinstance(row.get("obtained_marks"), (int, float))]
    best_three = round(sum(sorted(marks, reverse=True)[:3]) / 3, 2) if len(marks) >= 3 else None
    assignment_count = len(list(database.assignments.find({"course_id": course["course_id"]})))
    submitted = len(list(database.assignment_submissions.find({"course_id": course["course_id"], "student_id": student["student_id"]})))
    return {"attendance": {"total_classes_held": total, "present": present, "absent": total - present, "percentage": percentage, "status": "Good" if percentage >= 80 else "Warning" if percentage >= 70 else "Critical"}, "class_tests": {"best_3_average": best_three, "total_marks": 20}, "assignments": {"submitted": submitted, "total": assignment_count}}

@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    selected_role = payload.get("role")
    username = str(payload.get("username", payload.get("user_id", ""))).strip()
    password = payload.get("password", "")
    user = database.users.find_one({"username": username})
    if not user or user.get("role") != selected_role or not check_password_hash(user.get("password_hash", ""), password):
        return error("Invalid User ID or Password.", 401)
    if user.get("status") != "active":
        return error("Your account is inactive. Please contact the administrator.", 403)
    token_data = {"role": user["role"], "username": user["username"], "teacher_id": user.get("teacher_id"), "student_id": user.get("student_id"), "token_version": user.get("token_version", 0)}
    if user["role"] == "teacher": profile = database.teachers.find_one({"teacher_id": user["teacher_id"]})
    elif user["role"] == "student": profile = database.students.find_one({"student_id": user["student_id"]})
    else: profile = {"username": "admin", "name": "System Administrator"}
    return jsonify({"token": serializer.dumps(token_data), "role": user["role"], "profile": public(profile), "dashboard_path": f"/{user['role']}/dashboard"})

@app.post("/api/auth/change-password")
def change_password():
    token = identity()
    if not token: return error("Authentication is required", 401)
    payload = request.get_json(silent=True) or {}
    current, new, confirm = payload.get("current_password", ""), payload.get("new_password", ""), payload.get("confirm_password", "")
    user = database.users.find_one({"username": token["username"]})
    if not check_password_hash(user.get("password_hash", ""), current): return error("Current password is incorrect.", 400)
    if new != confirm: return error("New passwords do not match.", 400)
    if len(new) < 8 or not any(char.isupper() for char in new) or not any(char.islower() for char in new) or not any(char.isdigit() for char in new):
        return error("Password does not meet the requirements.", 400)
    database.users.update_one({"username": token["username"]}, {"$set": {"password_hash": generate_password_hash(new), "token_version": user.get("token_version", 0) + 1}}, upsert=False)
    return jsonify({"message": "Password changed successfully. Please log in again."})

@app.post("/api/auth/logout")
def logout():
    # Tokens are stateless; the browser clears its token. This endpoint keeps logout explicit.
    return jsonify({"status": "logged_out"})

@app.get("/api/student/profile")
@require_student
def student_profile():
    student, response = current_student()
    if response: return response
    return jsonify({"student_id": student["student_id"], "roll": student.get("roll", student["student_id"]), "name": student.get("name"), "series": student.get("series"), "current_semester": student.get("current_semester", student.get("semester")), "email": student.get("email"), "status": student.get("status")})

@app.get("/api/student/courses")
@require_student
def student_courses():
    student, response = current_student()
    if response: return response
    semester = student.get("current_semester", student.get("semester"))
    courses = []
    for course in database.courses.find({"semester": semester, "status": "active"}):
        courses.append({**public(course), **student_course_summary(student, course)})
    return jsonify({"series": student.get("series"), "semester": semester, "courses": sorted(courses, key=lambda row: row["course_code"])})

@app.get("/api/student/dashboard")
@require_student
def student_dashboard():
    student, response = current_student()
    if response: return response
    semester = student.get("current_semester", student.get("semester"))
    courses = [{**public(course), **student_course_summary(student, course)} for course in database.courses.find({"semester": semester, "status": "active"})]
    return jsonify({"profile": public(student), "series": student.get("series"), "semester": semester, "courses": sorted(courses, key=lambda row: row["course_code"])})

@app.get("/api/student/courses/<path:course_code>")
@require_student
def student_course_details(course_code):
    student, course, response = student_course(course_code)
    if response: return response
    return jsonify({"course": public(course), "series": student.get("series"), "semester": student.get("current_semester", student.get("semester")), **student_course_summary(student, course)})

@app.get("/api/student/courses/<path:course_code>/attendance")
@require_student
def student_attendance(course_code):
    student, course, response = student_course(course_code)
    if response: return response
    held = sorted((row for row in database.class_sessions.find({"course_id": course["course_id"]}) if row.get("class_held")), key=lambda row: (row.get("week", 0), row.get("day", 0)))
    recorded = {(row.get("week"), row.get("day")): row for row in database.attendance.find({"course_id": course["course_id"], "student_id": student["student_id"]})}
    details = [{"week": session.get("week"), "day": session.get("day"), "date": session.get("date"), "status": recorded.get((session.get("week"), session.get("day")), {}).get("status", "Absent")} for session in held]
    return jsonify({"summary": student_course_summary(student, course)["attendance"], "details": details})

@app.get("/api/student/courses/<path:course_code>/class-tests")
@require_student
def student_class_tests(course_code):
    student, course, response = student_course(course_code)
    if response: return response
    stored = {row.get("test_number"): row for row in database.class_test_results.find({"course_id": course["course_id"], "student_id": student["student_id"]})}
    tests = [{"test_number": number, "label": f"CT {number}", "obtained_marks": stored.get(number, {}).get("obtained_marks"), "total_marks": stored.get(number, {}).get("total_marks", 20)} for number in range(1, 5)]
    return jsonify({"tests": tests, **student_course_summary(student, course)["class_tests"]})

@app.get("/api/student/courses/<path:course_code>/assignments")
@require_student
def student_assignments(course_code):
    student, course, response = student_course(course_code)
    if response: return response
    result = []
    for assignment in sorted(database.assignments.find({"course_id": course["course_id"]}), key=lambda row: row.get("assignment_number", 0)):
        submission = database.assignment_submissions.find_one({"assignment_id": assignment["assignment_id"], "student_id": student["student_id"]})
        item = public(assignment)
        if submission:
            item.update({"submission_status": "Graded" if submission.get("marks") is not None else submission.get("status", "Submitted").title(), "submitted_at": submission.get("submitted_at"), "marks": submission.get("marks"), "file_name": submission.get("file_name")})
        else: item["submission_status"] = "Not Submitted"
        result.append(item)
    return jsonify({"assignments": result})

@app.post("/api/student/courses/<path:course_code>/assignments/<assignment_id>/submit")
@require_student
def submit_student_assignment(course_code, assignment_id):
    student, course, response = student_course(course_code)
    if response: return response
    assignment = database.assignments.find_one({"assignment_id": assignment_id, "course_id": course["course_id"]})
    if not assignment: return error("Assignment not found", 404)
    try: deadline = datetime.fromisoformat(str(assignment["deadline"])).date()
    except (TypeError, ValueError): return error("Assignment has an invalid deadline", 400)
    if date.today() > deadline: return error("Assignment submission deadline has passed.", 400)
    text_answer = request.form.get("text_answer", "").strip() if request.form else (request.get_json(silent=True) or {}).get("text_answer", "").strip()
    upload = request.files.get("file")
    file_name = None
    if upload and upload.filename:
        extension = upload.filename.rsplit(".", 1)[-1].lower() if "." in upload.filename else ""
        if extension not in ALLOWED_ASSIGNMENT_EXTENSIONS: return error("Unsupported file type. Upload PDF, DOC, DOCX, TXT, PPT, or PPTX.")
        file_name = secure_filename(upload.filename)
        os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
        stored_name = f"{uuid4()}_{file_name}"
        upload.save(os.path.join(app.config["UPLOAD_FOLDER"], stored_name))
        file_name = stored_name
    if not text_answer and not file_name: return error("Provide a text answer or an allowed assignment file.")
    existing = database.assignment_submissions.find_one({"assignment_id": assignment_id, "student_id": student["student_id"]})
    row = {"assignment_id": assignment_id, "course_id": course["course_id"], "course_code": course["course_code"], "student_id": student["student_id"], "roll": student.get("roll", student["student_id"]), "submitted_at": datetime.utcnow().isoformat(), "text_answer": text_answer, "file_name": file_name or (existing or {}).get("file_name"), "file_path": os.path.join(app.config["UPLOAD_FOLDER"], file_name) if file_name else (existing or {}).get("file_path"), "status": "Submitted", "marks": existing.get("marks") if existing else None, "total_marks": assignment["total_marks"], "feedback": existing.get("feedback") if existing else None}
    database.assignment_submissions.update_one({"assignment_id": assignment_id, "student_id": student["student_id"]}, {"$set": row}, upsert=True)
    return jsonify({"message": "Assignment submitted successfully.", "status": row["status"]})

@app.get("/api/admin/dashboard")
@require_admin
def admin_dashboard():
    current_series = database.series.find_one({"status": "active"}) or database.series.find_one({"series": 22})
    current_semester = database.semesters.find_one({"status": "current"}) or database.semesters.find_one({"semester": 6})
    total_courses = len(list(database.courses.find({})))
    assigned = len(list(database.course_assignments.find({"status": "active"})))
    return jsonify({"students": len(list(database.students.find({}))), "teachers": len(list(database.teachers.find({}))), "series": len(list(database.series.find({}))), "semesters": len(list(database.semesters.find({}))), "courses": total_courses, "users": len(list(database.users.find({}))), "current_series": current_series.get("series") if current_series else None, "current_semester": current_semester.get("semester") if current_semester else None, "assigned_courses": assigned, "unassigned_courses": max(total_courses - assigned, 0)})

@app.get("/api/admin/students")
@require_admin
def admin_students():
    query = {}
    if request.args.get("series"): query["series"] = int(request.args["series"])
    if request.args.get("semester"): query["semester"] = int(request.args["semester"])
    needle = request.args.get("search", "").lower()
    rows = []
    for s in database.students.find(query):
        row = public(s)
        u = database.users.find_one({"username": s.get("roll") or s.get("student_id")})
        if u and u.get("status"): row["status"] = u.get("status")
        rows.append(row)
    if needle: rows = [row for row in rows if needle in str(row.get("roll", "")).lower() or needle in row.get("name", "").lower()]
    return jsonify({"students": sorted(rows, key=lambda row: row.get("roll", ""))})

@app.get("/api/admin/teachers")
@require_admin
def admin_teachers():
    rows = []
    for teacher in database.teachers.find({}):
        item = public(teacher)
        u = database.users.find_one({"username": teacher["teacher_id"]})
        if u and u.get("status"): item["status"] = u.get("status")
        item["assigned_courses"] = len(list(database.course_assignments.find({"teacher_id": teacher["teacher_id"], "status": "active"})))
        rows.append(item)
    return jsonify({"teachers": sorted(rows, key=lambda row: row.get("teacher_id", ""))})

@app.get("/api/admin/teachers/<teacher_id>/courses")
@require_admin
def admin_teacher_courses(teacher_id):
    result = []
    for assignment in database.course_assignments.find({"teacher_id": teacher_id, "status": "active"}):
        course = database.courses.find_one({"course_id": assignment["course_id"]}) or {}
        result.append({**public(assignment), "course_name": course.get("course_name"), "course_type": course.get("course_type")})
    return jsonify({"courses": result})

@app.get("/api/admin/series")
@require_admin
def admin_series():
    rows = []
    for item in database.series.find({}):
        row = public(item); members = list(database.students.find({"series": item["series"]})); count = len(members)
        current_semester = row.get("current_semester") or (members[0].get("current_semester", members[0].get("semester")) if members else None)
        row.update({"student_count": count, "current_semester": current_semester, "status": "active" if count else row.get("status", "empty")}); rows.append(row)
    return jsonify({"series": sorted(rows, key=lambda row: row["series"])})

@app.route("/api/admin/series", methods=["POST", "PUT"])
@require_admin
def save_series():
    payload = request.get_json(silent=True) or {}; number = payload.get("series")
    if not isinstance(number, int): return error("series must be a number")
    database.series.update_one({"series": number}, {"$set": {"series": number, "department": payload.get("department", "ETE"), "status": payload.get("status", "empty")}}, upsert=True)
    return jsonify({"message": "Series saved successfully."})

@app.get("/api/admin/series/<int:series_id>/students")
@require_admin
def series_students(series_id):
    return jsonify({"students": [public(row) for row in database.students.find({"series": series_id})]})

@app.put("/api/admin/series/<int:series_id>/semester")
@require_admin
def update_series_semester(series_id):
    """Advance or correct one series without affecting any other series."""
    payload = request.get_json(silent=True) or {}
    semester = payload.get("semester")
    if not isinstance(semester, int) or not 1 <= semester <= 8:
        return error("semester must be between 1 and 8")
    if not database.series.find_one({"series": series_id}):
        return error("Series not found", 404)
    if not database.semesters.find_one({"semester": semester}):
        return error("Semester not found", 404)
    students = database.students.find({"series": series_id})
    database.students.update_many({"series": series_id}, {"$set": {"semester": semester, "current_semester": semester}})
    # Enrollment remains authoritative when present, so replace only this
    # series' old rows with the five courses belonging to its new semester.
    database.enrollments.delete_many({"series": series_id})
    courses = database.courses.find({"semester": semester, "status": "active"})
    for student in students:
        for course in courses:
            database.enrollments.update_one(
                {"course_id": course["course_id"], "student_id": student["student_id"]},
                {"$set": {"course_id": course["course_id"], "course_code": course["course_code"], "student_id": student["student_id"], "roll": student.get("roll", student["student_id"]), "series": series_id, "semester": semester}},
                upsert=True,
            )
    database.series.update_one({"series": series_id}, {"$set": {"current_semester": semester, "status": "active"}})
    return jsonify({"message": f"Series {series_id} updated to Semester {semester}.", "series": series_id, "semester": semester, "student_count": len(students)})

@app.get("/api/admin/semesters")
@require_admin
def admin_semesters(): return jsonify({"semesters": sorted([public(row) for row in database.semesters.find({})], key=lambda row: row["semester"])})

@app.route("/api/admin/semesters", methods=["POST", "PUT"])
@require_admin
def save_semester():
    payload = request.get_json(silent=True) or {}; number, status = payload.get("semester"), payload.get("status", "upcoming")
    if not isinstance(number, int) or status not in ("completed", "current", "upcoming"): return error("Valid semester and status are required")
    if status == "current": database.semesters.update_one({"status": "current"}, {"$set": {"status": "completed"}})
    database.semesters.update_one({"semester": number}, {"$set": {"semester": number, "status": status, "department": "ETE"}}, upsert=True)
    return jsonify({"message": "Semester saved successfully."})

@app.get("/api/admin/courses")
@require_admin
def admin_courses():
    query = {}
    semester = request.args.get("semester")
    if semester is None: return jsonify({"courses": [], "message": "Select a semester to view its courses."})
    try: semester = int(semester)
    except ValueError: return error("semester must be between 1 and 8")
    if not 1 <= semester <= 8: return error("semester must be between 1 and 8")
    query["semester"] = semester
    if request.args.get("course_type"): query["course_type"] = request.args["course_type"]
    rows = [public(row) for row in database.courses.find(query)]
    teacher_id, code = request.args.get("teacher_id"), request.args.get("course_code", "").lower()
    if teacher_id:
        ids = {row["course_id"] for row in database.course_assignments.find({"teacher_id": teacher_id, "status": "active"})}; rows = [row for row in rows if row["course_id"] in ids]
    if code: rows = [row for row in rows if code in row.get("course_code", "").lower()]
    for row in rows:
        assignment = database.course_assignments.find_one({"course_id": row["course_id"], "semester": semester, "status": "active"})
        teacher = database.teachers.find_one({"teacher_id": assignment["teacher_id"]}) if assignment else None
        row["assigned_teacher"] = {"teacher_id": teacher["teacher_id"], "name": teacher.get("name")} if teacher else None
    return jsonify({"courses": rows})

@app.route("/api/admin/courses", methods=["POST", "PUT"])
@require_admin
def save_course():
    payload = request.get_json(silent=True) or {}
    required = ("course_code", "course_name", "course_type", "semester")
    if any(not payload.get(key) for key in required) or payload.get("course_type") not in ("Theory", "Lab"): return error("Course code, name, type, and semester are required")
    if not isinstance(payload.get("semester"), int) or not 1 <= payload["semester"] <= 8: return error("semester must be between 1 and 8")
    code = payload["course_code"].strip().upper(); course_id = payload.get("course_id") or code.replace(" ", "")
    duplicate = database.courses.find_one({"course_code": code})
    if duplicate and duplicate.get("course_id") != course_id: return error("Course code already exists", 409)
    if not duplicate and len(list(database.courses.find({"semester": payload["semester"]}))) >= 5: return error("Each semester must contain exactly 5 courses", 409)
    course_id = payload.get("course_id") or code.replace(" ", "")
    course = {"course_id": course_id, "course_code": code, "course_name": payload["course_name"].strip(), "course_type": payload["course_type"], "semester": payload["semester"], "credits": payload.get("credits"), "status": payload.get("status", "active"), "department": "ETE"}
    database.courses.update_one({"course_id": course_id}, {"$set": course}, upsert=True)
    return jsonify({"message": "Course saved successfully.", "course": course})

def assignment_details(assignment):
    item = public(assignment); course = database.courses.find_one({"course_id": assignment["course_id"]}) or {}; teacher = database.teachers.find_one({"teacher_id": assignment["teacher_id"]}) or {}
    item.update({"course_name": course.get("course_name"), "course_type": course.get("course_type"), "teacher_name": teacher.get("name")}); return item

@app.get("/api/admin/course-assignments")
@require_admin
def list_assignments(): return jsonify({"assignments": [assignment_details(row) for row in database.course_assignments.find({"status": "active"})]})

@app.post("/api/admin/course-assignments")
@require_admin
def create_assignment():
    payload = request.get_json(silent=True) or {}; teacher_id, course_id = payload.get("teacher_id"), payload.get("course_id")
    series, semester = payload.get("series"), payload.get("semester")
    if not all((teacher_id, course_id)) or not isinstance(series, int) or not isinstance(semester, int): return error("teacher_id, course_id, series, and semester are required")
    teacher, course = database.teachers.find_one({"teacher_id": teacher_id}), database.courses.find_one({"course_id": course_id})
    if not teacher or not course or not database.series.find_one({"series": series}) or not database.semesters.find_one({"semester": semester}): return error("Teacher, course, series, or semester was not found", 404)
    if course.get("semester") != semester:
        return error("Select a course that belongs to the chosen semester")
    if database.course_assignments.find_one({"teacher_id": teacher_id, "course_id": course_id, "series": series, "semester": semester, "status": "active"}): return error("Course is already assigned to this teacher.", 409)
    database.course_assignments.update_one({"course_id": course_id, "series": series, "semester": semester, "status": "active"}, {"$set": {"status": "inactive"}})
    assignment = {"assignment_id": str(uuid4()), "teacher_id": teacher_id, "teacher_code": teacher_id, "course_id": course_id, "course_code": course.get("course_code"), "series": series, "semester": semester, "status": "active"}
    database.course_assignments.insert_one(assignment)
    return jsonify({"message": "Course assigned successfully.", "assignment": assignment_details(assignment)}), 201

@app.put("/api/admin/course-assignments/<assignment_id>")
@require_admin
def update_assignment(assignment_id):
    existing = database.course_assignments.find_one({"assignment_id": assignment_id, "status": "active"})
    if not existing: return error("Assignment not found", 404)
    payload = request.get_json(silent=True) or {}; teacher_id = payload.get("teacher_id")
    if not teacher_id or not database.teachers.find_one({"teacher_id": teacher_id}): return error("Teacher not found", 404)
    duplicate = database.course_assignments.find_one({"teacher_id": teacher_id, "course_id": existing["course_id"], "series": existing["series"], "semester": existing["semester"], "status": "active"})
    if duplicate and duplicate.get("assignment_id") != assignment_id: return error("Course is already assigned to this teacher.", 409)
    database.course_assignments.update_one({"assignment_id": assignment_id}, {"$set": {"teacher_id": teacher_id, "teacher_code": teacher_id}})
    return jsonify({"message": "Course assignment updated successfully."})

@app.delete("/api/admin/course-assignments/<assignment_id>")
@require_admin
def remove_assignment(assignment_id):
    result = database.course_assignments.update_one({"assignment_id": assignment_id, "status": "active"}, {"$set": {"status": "inactive"}})
    if not result.matched_count: return error("Assignment not found", 404)
    return jsonify({"message": "Course unassigned successfully."})

@app.get("/api/admin/users")
@require_admin
def admin_users(): return jsonify({"users": [public(row) for row in database.users.find({})]})

@app.put("/api/admin/users/<username>")
@require_admin
def update_user(username):
    payload = request.get_json(silent=True) or {}; status = payload.get("status")
    if status not in ("active", "inactive"): return error("status must be active or inactive")
    user = database.users.find_one({"username": username})
    if not user: return error("User not found", 404)
    new_version = user.get("token_version", 0) + 1
    database.users.update_one({"username": username}, {"$set": {"status": status, "token_version": new_version}})
    if user.get("role") == "teacher":
        database.teachers.update_one({"teacher_id": username}, {"$set": {"status": status}})
    elif user.get("role") == "student":
        database.students.update_one({"student_id": username}, {"$set": {"status": status}})
        database.students.update_one({"roll": username}, {"$set": {"status": status}})
    return jsonify({"message": "User status updated successfully."})

@app.get("/api/teacher/courses")
@require_teacher
def teacher_courses():
    result = []
    assignments = database.course_assignments.find({"teacher_id": request.teacher_id, "status": "active"})
    course_rows = []
    for assignment in assignments:
        course = database.courses.find_one({"course_id": assignment["course_id"]})
        if course: course_rows.append({**course, "series": assignment["series"], "semester": assignment["semester"], "teacher_id": request.teacher_id})
    if not course_rows: course_rows = database.courses.find({"teacher_id": request.teacher_id})
    for course in course_rows:
        item = public(course); sessions = [row for row in database.class_sessions.find({"course_id": course["course_id"]}) if row.get("class_held")]
        item.update({"student_count": len(list(database.enrollments.find({"course_id": course["course_id"]}))), "attendance_progress": len(sessions), "last_class_date": max((row.get("date") for row in sessions), default=None)})
        result.append(item)
    return jsonify({"courses": result})

@app.get("/api/teacher/courses/<path:course_code>/students")
@require_teacher
def course_students(course_code):
    course, response = owned_course(course_code)
    return response or jsonify({"students": students_for(course)})

@app.route("/api/teacher/courses/<path:course_code>/sessions", methods=["GET", "POST"])
@require_teacher
def sessions(course_code):
    course, response = owned_course(course_code)
    if response: return response
    if request.method == "GET": return jsonify({"course_start_date": course.get("course_start_date"), "sessions": slots(course)})
    payload = request.get_json(silent=True) or {}; week, day = payload.get("week"), payload.get("day")
    if not isinstance(week, int) or not isinstance(day, int) or not 1 <= week <= 13 or not 1 <= day <= 5: return error("week must be 1-13 and day must be 1-5")
    session = next(row for row in slots(course) if row["week"] == week and row["day"] == day)
    session.update({"date": payload.get("date", session["date"]), "class_held": bool(payload.get("class_held")), "teacher_id": request.teacher_id})
    database.class_sessions.update_one({"course_id": course["course_id"], "week": week, "day": day}, {"$set": session}, upsert=True)
    if payload.get("course_start_date"): database.courses.update_one({"course_id": course["course_id"]}, {"$set": {"course_start_date": payload["course_start_date"]}})
    return jsonify({"session": session})

@app.route("/api/teacher/courses/<path:course_code>/attendance", methods=["GET", "POST"])
@require_teacher
def attendance(course_code):
    course, response = owned_course(course_code)
    if response: return response
    if request.method == "GET": return jsonify({"sessions": slots(course), "students": attendance_summary(course)})
    payload = request.get_json(silent=True) or {}; week, day, entries = payload.get("week"), payload.get("day"), payload.get("entries")
    session = database.class_sessions.find_one({"course_id": course["course_id"], "week": week, "day": day})
    if not session or not session.get("class_held"):
        slot = next((row for row in slots(course) if row["week"] == week and row["day"] == day), None)
        slot_date = (session or {}).get("date") or (slot["date"] if slot else date.today().isoformat())
        session_doc = {"course_id": course["course_id"], "course_code": course["course_code"], "series": course["series"], "semester": course["semester"], "week": week, "day": day, "date": slot_date, "class_held": True, "teacher_id": request.teacher_id}
        database.class_sessions.update_one({"course_id": course["course_id"], "week": week, "day": day}, {"$set": session_doc}, upsert=True)
        session = session_doc
    students = {row["roll"]: row for row in students_for(course)}
    if not isinstance(entries, list) or len(entries) != len(students): return error("Attendance needs one entry for every enrolled student")
    for entry in entries:
        roll, status = entry.get("roll"), entry.get("status")
        if roll not in students or status not in ("Present", "Absent"): return error("Use Present or Absent for enrolled students only")
        row = {"student_id": students[roll].get("student_id", roll), "roll": roll, "course_id": course["course_id"], "course_code": course["course_code"], "series": course["series"], "semester": course["semester"], "week": week, "day": day, "date": session["date"], "status": status}
        database.attendance.update_one({"course_id": course["course_id"], "roll": roll, "week": week, "day": day}, {"$set": row}, upsert=True)
    return jsonify({"saved": len(entries)})

@app.route("/api/teacher/courses/<path:course_code>/class-tests", methods=["GET", "POST"])
@require_teacher
def class_tests(course_code):
    course, response = owned_course(course_code)
    if response: return response
    if request.method == "GET": return jsonify({"total_marks": 20, "students": test_summary(course)})
    payload = request.get_json(silent=True) or {}; results, total = payload.get("results"), payload.get("total_marks", 20)
    if not isinstance(total, (int, float)) or total <= 0 or not isinstance(results, list): return error("Provide results and positive total_marks")
    enrolled = {row["roll"] for row in students_for(course)}
    for item in results:
        roll, number, mark = item.get("roll"), item.get("test_number"), item.get("obtained_marks")
        if roll not in enrolled or number not in (1,2,3,4) or not isinstance(mark, (int,float)) or not 0 <= mark <= total: return error("Invalid class-test result")
        row = {"student_id": roll, "roll": roll, "course_id": course["course_id"], "course_code": course["course_code"], "series": course["series"], "semester": course["semester"], "test_number": number, "obtained_marks": mark, "total_marks": total}
        database.class_test_results.update_one({"course_id": course["course_id"], "roll": roll, "test_number": number}, {"$set": row}, upsert=True)
    return jsonify({"saved": len(results)})

@app.route("/api/teacher/courses/<path:course_code>/assignments", methods=["GET", "POST"])
@require_teacher
def assignments(course_code):
    course, response = owned_course(course_code)
    if response: return response
    if request.method == "GET": return jsonify({"assignments": [public(row) for row in database.assignments.find({"course_id": course["course_id"]})], "submissions": [public(row) for row in database.assignment_submissions.find({"course_id": course["course_id"]})]})
    payload = request.get_json(silent=True) or {}
    if not payload.get("title") or not payload.get("deadline") or not isinstance(payload.get("total_marks"), (int,float)): return error("title, deadline, total_marks are required")
    number = len(list(database.assignments.find({"course_id": course["course_id"]}))) + 1
    if number > 3: return error("Each course can have exactly 3 assignments", 409)
    row = {"assignment_id": f"{course['course_id']}-A{number}", "course_id": course["course_id"], "course_code": course["course_code"], "teacher_id": request.teacher_id, "series": course["series"], "semester": course["semester"], "assignment_number": number, "title": payload["title"], "deadline": payload["deadline"], "total_marks": payload["total_marks"], "status": "active"}
    database.assignments.insert_one(row); return jsonify({"assignment": row}), 201

@app.post("/api/teacher/courses/<path:course_code>/assignments/<assignment_id>/submissions/<roll>/grade")
@require_teacher
def grade_assignment(course_code, assignment_id, roll):
    course, response = owned_course(course_code)
    if response: return response
    payload = request.get_json(silent=True) or {}; submission = database.assignment_submissions.find_one({"assignment_id": assignment_id, "course_id": course["course_id"], "roll": roll})
    if not submission: return error("Submission not found", 404)
    assignment = database.assignments.find_one({"assignment_id": assignment_id})
    marks = payload.get("marks")
    if not isinstance(marks, (int, float)) or not 0 <= marks <= assignment["total_marks"]: return error("Marks must be within the assignment total")
    database.assignment_submissions.update_one({"assignment_id": assignment_id, "course_id": course["course_id"], "roll": roll}, {"$set": {"marks": marks, "total_marks": assignment["total_marks"], "graded_by": request.teacher_id}}, upsert=False)
    return jsonify({"status": "graded", "marks": marks})

@app.get("/api/teacher/courses/<path:course_code>/performance")
@require_teacher
def performance(course_code):
    course, response = owned_course(course_code)
    if response: return response
    tests = {row["roll"]: row for row in test_summary(course)}; results = []
    for att in attendance_summary(course):
        ct = tests[att["roll"]]["best_3_average"] or 0
        scores = [row.get("marks", 0) / row.get("total_marks", 1) * 20 for row in database.assignment_submissions.find({"course_id": course["course_id"], "roll": att["roll"]}) if row.get("total_marks")]
        assignment = round(sum(scores)/len(scores), 2) if scores else 0; overall = round(att["attendance_percentage"]*.5 + ct/20*35 + assignment/20*15, 2)
        results.append({"roll": att["roll"], "name": att["name"], "classes_held": att["total_held"], "present": att["present"], "absent": att["absent"], "attendance_percentage": att["attendance_percentage"], "ct_best_3_average": ct, "assignment_average": assignment, "overall_performance": overall, "risk_level": "Low" if overall >= 80 else "Medium" if overall >= 60 else "High"})
    return jsonify({"students": results})

@app.get("/api/teacher/courses/<path:course_code>/reports/<report_type>")
@require_teacher
def reports(course_code, report_type):
    course, response = owned_course(course_code)
    if response: return response
    if report_type == "attendance": return jsonify({"report": report_type, "rows": attendance_summary(course)})
    if report_type == "class-tests": return jsonify({"report": report_type, "rows": test_summary(course)})
    if report_type == "performance": return performance(course_code)
    return error("Unknown report type", 404)

@app.get("/api/teacher/courses/<path:course_code>/reports/<report_type>/export")
@require_teacher
def export_report(course_code, report_type):
    course, response = owned_course(course_code)
    if response: return response
    if report_type == "attendance":
        rows = attendance_summary(course)
        headers = ["Roll", "Name"] + [f"W{week}D{day}" for week in range(1,14) for day in range(1,6)] + ["Total Held", "Present", "Absent", "Attendance %"]
        values = [[row["roll"], row["name"]] + [row["attendance"][f"w{week}d{day}"] for week in range(1,14) for day in range(1,6)] + [row["total_held"], row["present"], row["absent"], row["attendance_percentage"]] for row in rows]
    elif report_type == "class-tests":
        rows = test_summary(course); headers = ["Roll", "Name", "CT1", "CT2", "CT3", "CT4", "Best 3 Average"]; values = [[row["roll"], row["name"], row["ct1"], row["ct2"], row["ct3"], row["ct4"], row["best_3_average"]] for row in rows]
    elif report_type == "performance":
        rows = attendance_summary(course); test_rows = {row["roll"]: row for row in test_summary(course)}; headers = ["Roll", "Name", "Held", "Present", "Absent", "Attendance %", "CT Best 3 Avg"]
        values = [[row["roll"], row["name"], row["total_held"], row["present"], row["absent"], row["attendance_percentage"], test_rows[row["roll"]]["best_3_average"]] for row in rows]
    else: return error("Unknown report type", 404)
    filename = f"{course['course_id']}-{report_type}"
    if request.args.get("format") == "xlsx":
        book = Workbook(); sheet = book.active; sheet.title = report_type.title(); sheet.append(headers)
        for row in values: sheet.append(row)
        stream = BytesIO(); book.save(stream)
        return app.response_class(stream.getvalue(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"})
    if request.args.get("format") == "pdf":
        stream = BytesIO(); document = SimpleDocTemplate(stream, pagesize=landscape(A3)); table = Table([headers] + values, repeatRows=1)
        table.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), colors.HexColor("#0d47a1")), ("TEXTCOLOR", (0,0), (-1,0), colors.white), ("GRID", (0,0), (-1,-1), .25, colors.grey), ("FONTSIZE", (0,0), (-1,-1), 5)])); document.build([table])
        return app.response_class(stream.getvalue(), mimetype="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}.pdf"})
    return error("Use format=xlsx or format=pdf")

@app.get("/api/health")
def health(): return jsonify({"status": "ok", "database": "in-memory development fallback" if database.using_in_memory_database else "mongodb"})

if __name__ == "__main__": app.run(host="0.0.0.0", port=8000, debug=False)
