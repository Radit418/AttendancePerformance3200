"""Flask REST API for the Smart Attendance teacher dashboard."""
from datetime import date, datetime, timedelta
from functools import wraps
from io import BytesIO
import mimetypes
import os
import math
import re
import time
from uuid import uuid4
from bson import ObjectId
from bson.errors import InvalidId
from flask import Flask, Response, jsonify, request, stream_with_context
from gridfs.errors import NoFile
from pymongo.errors import AutoReconnect, ConnectionFailure, NetworkTimeout, PyMongoError, ServerSelectionTimeoutError
from werkzeug.utils import secure_filename
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, A3, A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from pymongo import UpdateOne
import database

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "change-this-development-secret")
app.config["MAX_CONTENT_LENGTH"] = 11 * 1024 * 1024
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
    if origin.strip()
]
cors_origins.append(re.compile(r"^https://[a-z0-9.-]+\.vercel\.app$"))
CORS(app, resources={r"/api/*": {"origins": cors_origins}})
serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])
ALLOWED_ASSIGNMENT_EXTENSIONS = {"pdf", "doc", "docx", "txt", "ppt", "pptx", "jpg", "jpeg", "png"}
MAX_ASSIGNMENT_FILE_SIZE = 10 * 1024 * 1024
ASSIGNMENT_FILE_MIME_TYPES = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
}


class FileValidationError(ValueError):
    pass


class FileStorageUnavailable(RuntimeError):
    pass

def public(doc):
    if not doc: return doc
    doc = dict(doc)
    for key in ("_id", "password", "password_hash", "file_path", "ref_file_path"): doc.pop(key, None)
    return doc
def error(message, status=400): return jsonify({"error": message}), status
def identity():
    auth = request.headers.get("Authorization", "")
    token_str = None
    if auth.startswith("Bearer "):
        token_str = auth[7:]
    elif request.args.get("token"):
        token_str = request.args.get("token")
    if not token_str: return None
    try:
        token = serializer.loads(token_str, max_age=28800)
        user = database.users.find_one({"username": token.get("username")})
        if not user or user.get("status") != "active" or user.get("token_version", 0) != token.get("token_version", 0): return None
        return token
    except (BadSignature, SignatureExpired): return None

def validate_assignment_upload(upload):
    filename = secure_filename(upload.filename or "")
    if not filename:
        raise FileValidationError("Please select a valid filename.")
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_ASSIGNMENT_EXTENSIONS:
        raise FileValidationError(f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_ASSIGNMENT_EXTENSIONS))}")
    content_type = (upload.mimetype or "").lower()
    expected_type = ASSIGNMENT_FILE_MIME_TYPES[extension]
    if content_type != expected_type:
        raise FileValidationError(f"File content type must be {expected_type}.")
    upload.stream.seek(0, os.SEEK_END)
    size = upload.stream.tell()
    upload.stream.seek(0)
    if size > MAX_ASSIGNMENT_FILE_SIZE:
        raise FileValidationError("File size exceeds 10 MB limit.")
    header = upload.stream.read(8192)
    upload.stream.seek(0)
    signatures = {
        "pdf": lambda value: value.startswith(b"%PDF-"),
        "jpg": lambda value: value.startswith(b"\xff\xd8\xff"),
        "jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        "png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        "doc": lambda value: value.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
        "ppt": lambda value: value.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
        "docx": lambda value: value.startswith(b"PK\x03\x04"),
        "pptx": lambda value: value.startswith(b"PK\x03\x04"),
        "txt": lambda value: b"\x00" not in value,
    }
    if not signatures[extension](header):
        raise FileValidationError("File contents do not match the selected file type.")
    return filename, content_type, size


def store_gridfs_stream(stream, filename, size, metadata):
    bucket = database.assignment_files
    if bucket is None:
        raise FileStorageUnavailable("MongoDB GridFS is unavailable; configure MONGO_URI before uploading files.")
    grid_file = bucket.open_upload_stream(filename, metadata=metadata)
    try:
        written = 0
        while written < size:
            chunk = stream.read(min(64 * 1024, size - written))
            if not chunk:
                raise OSError("File ended before the expected size was read.")
            grid_file.write(chunk)
            written += len(chunk)
        if stream.read(1):
            raise OSError("File changed while it was being stored.")
        grid_file.close()
    except Exception:
        grid_file.abort()
        raise
    return str(grid_file._id)


def store_assignment_upload(upload, uploader_id, uploader_role, course_id, assignment_id):
    filename, content_type, size = validate_assignment_upload(upload)
    uploaded_at = datetime.utcnow()
    metadata = {
        "original_filename": filename,
        "content_type": content_type,
        "file_size": size,
        "uploader_id": uploader_id,
        "uploader_role": uploader_role,
        "course_id": course_id,
        "assignment_id": assignment_id,
        "uploaded_at": uploaded_at,
    }
    file_id = store_gridfs_stream(upload.stream, filename, size, metadata)
    return {
        "file_id": file_id,
        "file_name": filename,
        "file_content_type": content_type,
        "file_size": size,
        "file_uploaded_at": uploaded_at.isoformat(),
    }


def delete_gridfs_file(file_id):
    if not file_id:
        return
    bucket = database.assignment_files
    if bucket is None:
        raise FileStorageUnavailable("MongoDB GridFS is unavailable; configure MONGO_URI before deleting files.")
    try:
        parsed_id = ObjectId(str(file_id))
    except (InvalidId, TypeError):
        app.logger.warning("Skipping invalid GridFS file ID %r", file_id)
        return
    try:
        bucket.delete(parsed_id)
    except NoFile:
        app.logger.warning("GridFS file %s was already missing", parsed_id)


def open_gridfs_file(file_id, chunk_size=64 * 1024, attempts=3):
    transient_errors = (AutoReconnect, ConnectionFailure, NetworkTimeout, ServerSelectionTimeoutError)
    for attempt in range(attempts):
        grid_file = None
        try:
            grid_file = database.assignment_files.open_download_stream(file_id)
            first_chunk = grid_file.read(chunk_size)
            return grid_file, first_chunk
        except NoFile:
            if grid_file:
                try:
                    grid_file.close()
                except PyMongoError:
                    app.logger.warning("Failed to close missing GridFS file %s", file_id, exc_info=True)
            raise
        except PyMongoError as exc:
            if grid_file:
                try:
                    grid_file.close()
                except PyMongoError:
                    app.logger.warning("Failed to close GridFS file after a read error %s", file_id, exc_info=True)
            retryable = isinstance(exc, transient_errors) or exc.has_error_label("RetryableReadError")
            if not retryable or attempt == attempts - 1:
                raise
            time.sleep(0.15 * (attempt + 1))


def stream_gridfs_file(grid_file, first_chunk, chunk_size=64 * 1024):
    try:
        if first_chunk:
            yield first_chunk
        while True:
            chunk = grid_file.read(chunk_size)
            if not chunk:
                break
            yield chunk
    except PyMongoError:
        app.logger.exception("GridFS stream interrupted for %s", grid_file._id)
        raise
    finally:
        grid_file.close()


def migrate_legacy_assignment_files():
    if database.using_in_memory_database or database.assignment_files is None:
        return
    legacy_root = os.path.realpath(os.path.join(os.path.dirname(__file__), "uploads", "assignments"))
    migrations = (
        (database.assignments, "ref_file_path", "ref_file_id", "ref_file_name", "teacher_id", "ref"),
        (database.assignment_submissions, "file_path", "file_id", "file_name", "student_id", "submission"),
    )
    for collection, path_field, id_field, name_field, uploader_field, kind in migrations:
        for document in collection.find({path_field: {"$exists": True, "$ne": None}, id_field: {"$exists": False}}):
            legacy_value = document.get(path_field)
            if not isinstance(legacy_value, str):
                app.logger.warning("Skipping invalid legacy assignment file path for %s", document.get("assignment_id"))
                continue
            legacy_path = os.path.realpath(legacy_value)
            try:
                if os.path.commonpath((legacy_root, legacy_path)) != legacy_root or not os.path.isfile(legacy_path):
                    app.logger.warning("Skipping invalid legacy assignment file path for %s", document.get("assignment_id"))
                    continue
            except ValueError:
                app.logger.warning("Skipping invalid legacy assignment file path for %s", document.get("assignment_id"))
                continue
            filename = secure_filename(str(document.get(name_field) or os.path.basename(legacy_path)))
            extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            if not filename or extension not in ALLOWED_ASSIGNMENT_EXTENSIONS:
                app.logger.warning("Skipping unsupported legacy assignment file %s", legacy_path)
                continue
            try:
                size = os.path.getsize(legacy_path)
                if size > MAX_ASSIGNMENT_FILE_SIZE:
                    app.logger.warning("Skipping oversized legacy assignment file %s", legacy_path)
                    continue
                content_type = ASSIGNMENT_FILE_MIME_TYPES[extension]
                uploaded_at = datetime.utcfromtimestamp(os.path.getmtime(legacy_path))
                metadata = {
                    "original_filename": filename,
                    "content_type": content_type,
                    "file_size": size,
                    "uploader_id": document.get(uploader_field),
                    "uploader_role": "teacher" if kind == "ref" else "student",
                    "course_id": document.get("course_id"),
                    "assignment_id": document.get("assignment_id"),
                    "uploaded_at": uploaded_at,
                }
                with open(legacy_path, "rb") as legacy_file:
                    file_id = store_gridfs_stream(legacy_file, filename, size, metadata)
                update_result = collection.update_one(
                    {"_id": document["_id"]},
                    {"$set": {
                        id_field: file_id,
                        "file_content_type" if kind == "submission" else "ref_file_content_type": content_type,
                        "file_size" if kind == "submission" else "ref_file_size": size,
                        "file_uploaded_at" if kind == "submission" else "ref_file_uploaded_at": uploaded_at.isoformat(),
                    }, "$unset": {path_field: ""}},
                )
                if not update_result.matched_count:
                    delete_gridfs_file(file_id)
                    raise RuntimeError("Legacy assignment record changed during file migration.")
                os.remove(legacy_path)
                app.logger.info("Migrated legacy assignment file %s to GridFS", legacy_path)
            except Exception:
                app.logger.exception("Failed to migrate legacy assignment file %s", legacy_path)


migrate_legacy_assignment_files()


@app.get("/api/assignments/files/<path:file_key>")
def download_assignment_file(file_key):
    user = identity()
    if not user:
        return error("Authentication required to access files", 401)
    if database.assignment_files is None:
        return error("MongoDB GridFS is unavailable", 503)

    is_object_id = ObjectId.is_valid(file_key)
    file_id = str(ObjectId(file_key)) if is_object_id else None
    assignment = database.assignments.find_one({"ref_file_id": file_id}) if is_object_id else database.assignments.find_one({"ref_file_name": file_key})
    submission = database.assignment_submissions.find_one({"file_id": file_id}) if is_object_id else database.assignment_submissions.find_one({"file_name": file_key})
    if not assignment and not submission:
        return error("File not found", 404)

    role = user.get("role")
    authorized = role == "admin"
    if assignment:
        course_id = assignment.get("course_id")
        if role == "teacher":
            assigned = database.course_assignments.find_one({"course_id": course_id, "teacher_id": user.get("teacher_id"), "status": "active"})
            course = database.courses.find_one({"course_id": course_id}) or {}
            authorized = bool(assigned or course.get("teacher_id") == user.get("teacher_id"))
        elif role == "student":
            authorized = bool(
                database.enrollments.find_one({"course_id": course_id, "student_id": user.get("student_id")})
                or database.enrollments.find_one({"course_id": course_id, "roll": user.get("username")})
            )
    elif submission:
        course_id = submission.get("course_id")
        if role == "teacher":
            assigned = database.course_assignments.find_one({"course_id": course_id, "teacher_id": user.get("teacher_id"), "status": "active"})
            course = database.courses.find_one({"course_id": course_id}) or {}
            authorized = bool(assigned or course.get("teacher_id") == user.get("teacher_id"))
        elif role == "student":
            authorized = bool(
                submission.get("student_id") in (user.get("student_id"), user.get("username"))
                or submission.get("roll") == user.get("username")
            )
    if not authorized:
        return error("Unauthorized to access this file", 403)

    stored_id = (assignment or submission).get("ref_file_id" if assignment else "file_id")
    if not ObjectId.is_valid(str(stored_id or "")):
        return error("File is not stored in GridFS", 404)
    try:
        grid_file, first_chunk = open_gridfs_file(ObjectId(str(stored_id)))
    except NoFile:
        return error("File not found", 404)
    except PyMongoError:
        app.logger.exception("GridFS file retrieval failed for %s", stored_id)
        return error("File storage is temporarily unavailable. Please try again.", 503)

    metadata = grid_file.metadata or {}
    filename = metadata.get("original_filename") or grid_file.filename
    content_type = metadata.get("content_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    inline_types = {"application/pdf", "text/plain", "image/jpeg", "image/png"}
    as_attachment = request.args.get("download") == "1" or content_type not in inline_types
    response = Response(
        stream_with_context(stream_gridfs_file(grid_file, first_chunk)),
        mimetype=content_type,
    )
    response.headers.set("Content-Disposition", "attachment" if as_attachment else "inline", filename=filename)
    response.headers["Content-Length"] = str(grid_file.length)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response

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
        for day in range(1, 4):
            default = {"course_id": course["course_id"], "course_code": course.get("course_code", ""), "series": course.get("series", 22), "semester": course.get("semester", 6), "week": week, "day": day, "date": (start + timedelta(days=(week - 1) * 7 + day - 1)).isoformat(), "class_held": False, "teacher_id": course.get("teacher_id", "")}
            all_slots.append(saved.get((week, day), default))
    return all_slots
def get_attendance_marks(pct):
    if pct is None: return 0
    if pct >= 90: return 10
    elif pct >= 85: return 9
    elif pct >= 80: return 8
    elif pct >= 75: return 7
    elif pct >= 70: return 6
    elif pct >= 65: return 5
    elif pct >= 60: return 4
    else: return 0

def attendance_summary(course, course_slots=None, course_students=None):
    if course_slots is None:
        course_slots = slots(course)
    held = {(row["week"], row["day"]): row for row in course_slots if row.get("class_held")}
    stored = {(row["roll"], row["week"], row["day"]): row.get("status") for row in database.attendance.find({"course_id": course["course_id"]}, {"roll": 1, "week": 1, "day": 1, "status": 1, "_id": 0}) if "roll" in row and "week" in row and "day" in row}
    rows = []
    if course_students is None:
        course_students = students_for(course)
    for student in course_students:
        present = sum(stored.get((student["roll"], week, day)) == "Present" for week, day in held)
        total = len(held); pct = round(present * 100 / total, 2) if total else 0
        att_marks = get_attendance_marks(pct)
        cells = {f"w{week}d{day}": (stored.get((student["roll"], week, day), "") if (week, day) in held else "") for week in range(1, 14) for day in range(1, 4)}
        rows.append({**student, "attendance": cells, "total_held": total, "present": present, "absent": total-present, "attendance_percentage": pct, "attendance_marks": att_marks, "attendance_status": "Good" if pct >= 80 else "Warning" if pct >= 70 else "Critical"})
    return rows
def test_summary(course):
    values = {(row["roll"], row["test_number"]): row.get("obtained_marks") for row in database.class_test_results.find({"course_id": course["course_id"]}) if "roll" in row and "test_number" in row}
    rows = []
    for student in students_for(course):
        tests = [values.get((student["roll"], number)) for number in range(1, 5)]
        recorded = []
        for mark in tests:
            if mark is None: continue
            if isinstance(mark, str) and mark.strip().upper() == 'A':
                recorded.append(0)
            elif isinstance(mark, (int, float)):
                recorded.append(mark)
        if recorded:
            top3 = sorted(recorded, reverse=True)[:3]
            denom = 3 if len(recorded) >= 3 else len(recorded)
            avg = math.ceil(sum(top3) / denom)
        else:
            avg = None
        rows.append({**student, "ct1": tests[0], "ct2": tests[1], "ct3": tests[2], "ct4": tests[3], "best_3_average": avg})
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
    stored_tests = list(database.class_test_results.find({"course_id": course["course_id"], "student_id": student["student_id"]}))
    test_marks = []
    for row in stored_tests:
        m = row.get("obtained_marks")
        if m is None: continue
        if isinstance(m, str) and m.strip().upper() == 'A': test_marks.append(0)
        elif isinstance(m, (int, float)): test_marks.append(m)
    if test_marks:
        top3 = sorted(test_marks, reverse=True)[:3]
        denom = 3 if len(test_marks) >= 3 else len(test_marks)
        best_three = math.ceil(sum(top3) / denom)
    else:
        best_three = None
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
    if user["role"] == "teacher":
        t = database.teachers.find_one({"teacher_id": user["teacher_id"]})
        profile = dict(t) if t else {}
        if not profile.get("contact_no"):
            profile["contact_no"] = profile.get("phone", f"+880 1711-0000{user['teacher_id'][-2:] if len(user['teacher_id'])>=2 else '01'}")
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
        if not submission:
            submission = database.assignment_submissions.find_one({"assignment_id": assignment["assignment_id"], "roll": student.get("roll")})
        item = public(assignment)
        if submission:
            item.update({
                "submission_status": "Graded" if submission.get("marks") is not None else submission.get("status", "Submitted").title(),
                "submitted_at": submission.get("submitted_at"),
                "text_answer": submission.get("text_answer"),
                "file_id": submission.get("file_id"),
                "file_name": submission.get("file_name"),
                "file_content_type": submission.get("file_content_type"),
                "marks": submission.get("marks"),
                "feedback": submission.get("feedback")
            })
        else:
            item["submission_status"] = "Not Submitted"
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
    upload = request.files.get("file") or request.files.get("submission_file")
    existing = database.assignment_submissions.find_one({"assignment_id": assignment_id, "student_id": student["student_id"]})
    stored_file = None
    if upload and upload.filename:
        try:
            stored_file = store_assignment_upload(
                upload,
                student["student_id"],
                "student",
                course["course_id"],
                assignment_id,
            )
        except FileValidationError as exc:
            return error(str(exc), 400)
        except FileStorageUnavailable as exc:
            return error(str(exc), 503)
    if not stored_file and not (existing or {}).get("file_id"):
        return error("Please select an assignment file to upload.", 400)
    row = {
        "assignment_id": assignment_id,
        "course_id": course["course_id"],
        "course_code": course["course_code"],
        "student_id": student["student_id"],
        "roll": student.get("roll", student["student_id"]),
        "submitted_at": datetime.utcnow().isoformat(),
        "text_answer": "",
        "file_id": (stored_file or existing).get("file_id"),
        "file_name": (stored_file or existing).get("file_name"),
        "file_content_type": (stored_file or existing).get("file_content_type"),
        "file_size": (stored_file or existing).get("file_size"),
        "file_uploaded_at": (stored_file or existing).get("file_uploaded_at"),
        "status": "Submitted",
        "marks": existing.get("marks") if existing else None,
        "total_marks": assignment["total_marks"],
        "feedback": existing.get("feedback") if existing else None
    }
    try:
        database.assignment_submissions.update_one(
            {"assignment_id": assignment_id, "student_id": student["student_id"]},
            {"$set": row, "$unset": {"file_path": ""}},
            upsert=True,
        )
    except Exception:
        if stored_file:
            try:
                delete_gridfs_file(stored_file["file_id"])
            except Exception:
                app.logger.exception("Failed to clean up an unreferenced GridFS submission")
        raise
    if stored_file and existing and existing.get("file_id") and existing["file_id"] != stored_file["file_id"]:
        delete_gridfs_file(existing["file_id"])
    return jsonify({"message": "Assignment submitted successfully.", "status": row["status"]})


@app.route("/api/student/courses/<path:course_code>/assignments/<assignment_id>/unsubmit", methods=["POST", "DELETE"])
@require_student
def unsubmit_student_assignment(course_code, assignment_id):
    student, course, response = student_course(course_code)
    if response: return response
    existing = database.assignment_submissions.find_one({"assignment_id": assignment_id, "student_id": student["student_id"]})
    if not existing: return error("Submission not found", 404)
    if existing.get("status") == "Graded" or existing.get("marks") is not None:
        return error("Graded assignments cannot be unsubmitted.", 400)
    try:
        delete_gridfs_file(existing.get("file_id"))
    except FileStorageUnavailable as exc:
        return error(str(exc), 503)
    database.assignment_submissions.delete_one({"assignment_id": assignment_id, "student_id": student["student_id"]})
    return jsonify({"message": "Assignment unsubmitted successfully."})

@app.get("/api/admin/dashboard")
@require_admin
def admin_dashboard():
    current_series = database.series.find_one({"status": "active"}) or database.series.find_one({"series": 22})
    current_semester = database.semesters.find_one({"status": "current"}) or database.semesters.find_one({"semester": 6})
    total_courses = database.courses.count_documents({})
    assigned = database.course_assignments.count_documents({"status": "active"})
    return jsonify({
        "students": database.students.count_documents({}),
        "teachers": database.teachers.count_documents({}),
        "series": database.series.count_documents({}),
        "semesters": database.semesters.count_documents({}),
        "courses": total_courses,
        "users": database.users.count_documents({}),
        "current_series": current_series.get("series") if current_series else None,
        "current_semester": current_semester.get("semester") if current_semester else None,
        "assigned_courses": assigned,
        "unassigned_courses": max(total_courses - assigned, 0)
    })

@app.get("/api/admin/students")
@require_admin
def admin_students():
    query = {}
    if request.args.get("series"): query["series"] = int(request.args["series"])
    if request.args.get("semester"): query["semester"] = int(request.args["semester"])
    needle = request.args.get("search", "").lower()
    users_map = {u["username"]: u.get("status", "active") for u in database.users.find({"role": "student"}, {"username": 1, "status": 1})}
    rows = []
    for s in database.students.find(query):
        row = public(s)
        st = users_map.get(s.get("roll") or s.get("student_id"))
        if st: row["status"] = st
        rows.append(row)
    if needle: rows = [row for row in rows if needle in str(row.get("roll", "")).lower() or needle in row.get("name", "").lower()]
    return jsonify({"students": sorted(rows, key=lambda row: row.get("roll", ""))})

@app.get("/api/admin/teachers")
@require_admin
def admin_teachers():
    teacher_users = {u["username"]: u.get("status", "active") for u in database.users.find({"role": "teacher"}, {"username": 1, "status": 1})}
    from collections import Counter
    active_assignments = database.course_assignments.find({"status": "active"}, {"teacher_id": 1})
    counts = Counter(a.get("teacher_id") for a in active_assignments)
    rows = []
    for teacher in database.teachers.find({}):
        item = public(teacher)
        tid = teacher.get("teacher_id")
        st = teacher_users.get(tid)
        if st: item["status"] = st
        item["assigned_courses"] = counts.get(tid, 0)
        rows.append(item)
    return jsonify({"teachers": sorted(rows, key=lambda row: row.get("teacher_id", ""))})

@app.get("/api/admin/teachers/<teacher_id>/courses")
@require_admin
def admin_teacher_courses(teacher_id):
    assignments = list(database.course_assignments.find({"teacher_id": teacher_id, "status": "active"}))
    course_ids = [a["course_id"] for a in assignments if a.get("course_id")]
    courses_map = {c["course_id"]: c for c in database.courses.find({"course_id": {"$in": course_ids}})}
    result = []
    for assignment in assignments:
        course = courses_map.get(assignment.get("course_id"), {})
        result.append({**public(assignment), "course_name": course.get("course_name"), "course_type": course.get("course_type")})
    return jsonify({"courses": result})

@app.get("/api/admin/series")
@require_admin
def admin_series():
    all_students = list(database.students.find({}, {"series": 1, "current_semester": 1, "semester": 1}))
    series_groups = {}
    for s in all_students:
        ser = s.get("series")
        if ser not in series_groups: series_groups[ser] = []
        series_groups[ser].append(s)
    rows = []
    for item in database.series.find({}):
        row = public(item); ser = item.get("series")
        members = series_groups.get(ser, [])
        count = len(members)
        current_semester = row.get("current_semester") or (members[0].get("current_semester", members[0].get("semester")) if members else None)
        row.update({"student_count": count, "current_semester": current_semester, "status": "active" if count else row.get("status", "empty")})
        rows.append(row)
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
    assignments = {a["course_id"]: a for a in database.course_assignments.find({"semester": semester, "status": "active"})}
    teachers_map = {t["teacher_id"]: t for t in database.teachers.find({})}
    for row in rows:
        assignment = assignments.get(row["course_id"])
        teacher = teachers_map.get(assignment["teacher_id"]) if assignment else None
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
def list_assignments():
    assignments = list(database.course_assignments.find({"status": "active"}))
    course_map = {c["course_id"]: c for c in database.courses.find({})}
    teacher_map = {t["teacher_id"]: t for t in database.teachers.find({})}
    rows = []
    for a in assignments:
        item = public(a)
        course = course_map.get(a.get("course_id"), {})
        teacher = teacher_map.get(a.get("teacher_id"), {})
        item.update({"course_name": course.get("course_name"), "course_type": course.get("course_type"), "teacher_name": teacher.get("name")})
        rows.append(item)
    return jsonify({"assignments": rows})

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

@app.route("/api/teacher/profile", methods=["GET", "PUT"])
@require_teacher
def teacher_profile():
    teacher = database.teachers.find_one({"teacher_id": request.teacher_id})
    if not teacher: return error("Teacher profile not found", 404)
    if request.method == "GET":
        data = public(teacher)
        if not data.get("contact_no"):
            data["contact_no"] = data.get("phone", f"+880 1711-0000{request.teacher_id[-2:] if len(request.teacher_id)>=2 else '01'}")
        return jsonify({"profile": data})
    payload = request.get_json(silent=True) or {}
    updates = {}
    if "name" in payload and payload["name"].strip(): updates["name"] = payload["name"].strip()
    if "email" in payload and payload["email"].strip(): updates["email"] = payload["email"].strip()
    cno = payload.get("contact_no") or payload.get("phone")
    if cno and cno.strip():
        updates["contact_no"] = cno.strip()
        updates["phone"] = cno.strip()
    if "department" in payload and payload["department"].strip(): updates["department"] = payload["department"].strip()
    if updates:
        database.teachers.update_one({"teacher_id": request.teacher_id}, {"$set": updates})
        teacher = database.teachers.find_one({"teacher_id": request.teacher_id})
    data = public(teacher)
    if not data.get("contact_no"):
        data["contact_no"] = data.get("phone", f"+880 1711-0000{request.teacher_id[-2:] if len(request.teacher_id)>=2 else '01'}")
    return jsonify({"message": "Profile updated successfully.", "profile": data})

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
    if not isinstance(week, int) or not isinstance(day, int) or not 1 <= week <= 13 or not 1 <= day <= 3: return error("week must be 1-13 and day must be 1-3")
    session = next(row for row in slots(course) if row["week"] == week and row["day"] == day)
    session.update({"date": payload.get("date", session["date"]), "class_held": bool(payload.get("class_held")), "teacher_id": request.teacher_id})
    database.class_sessions.update_one({"course_id": course["course_id"], "week": week, "day": day}, {"$set": session}, upsert=True)
    if not session["class_held"]:
        database.attendance.delete_many({"course_id": course["course_id"], "week": week, "day": day})
    if payload.get("course_start_date"): database.courses.update_one({"course_id": course["course_id"]}, {"$set": {"course_start_date": payload["course_start_date"]}})
    return jsonify({"session": session})

@app.route("/api/teacher/courses/<path:course_code>/attendance", methods=["GET", "POST"])
@require_teacher
def attendance(course_code):
    course, response = owned_course(course_code)
    if response: return response
    if request.method == "GET":
        course_slots = slots(course)
        return jsonify({"sessions": course_slots, "students": attendance_summary(course, course_slots=course_slots)})
    payload = request.get_json(silent=True) or {}; week, day, entries = payload.get("week"), payload.get("day"), payload.get("entries")
    session = database.class_sessions.find_one({"course_id": course["course_id"], "week": week, "day": day})
    if not session or not session.get("class_held"):
        return error("Attendance cannot be submitted for a holiday or unconfirmed session", 400)
    enrolled_students = students_for(course)
    students = {row["roll"]: row for row in enrolled_students}
    if not isinstance(entries, list) or len(entries) != len(students): return error("Attendance needs one entry for every enrolled student")
    operations = []
    for entry in entries:
        roll, status = entry.get("roll"), entry.get("status")
        if roll not in students or status not in ("Present", "Absent"): return error("Use Present or Absent for enrolled students only")
        row = {"student_id": students[roll].get("student_id", roll), "roll": roll, "course_id": course["course_id"], "course_code": course["course_code"], "series": course["series"], "semester": course["semester"], "week": week, "day": day, "date": session["date"], "status": status}
        operations.append(UpdateOne({"course_id": course["course_id"], "roll": roll, "week": week, "day": day}, {"$set": row}, upsert=True))
    if operations:
        database.attendance.bulk_write(operations, ordered=False)
    course_slots = slots(course)
    summary = attendance_summary(course, course_slots=course_slots, course_students=enrolled_students)
    return jsonify({"saved": len(entries), "sessions": course_slots, "students": summary})

@app.route("/api/teacher/courses/<path:course_code>/class-tests", methods=["GET", "POST"])
@require_teacher
def class_tests(course_code):
    course, response = owned_course(course_code)
    if response: return response
    if request.method == "GET": return jsonify({"total_marks": 20, "students": test_summary(course)})
    payload = request.get_json(silent=True) or {}; results, total = payload.get("results"), payload.get("total_marks", 20)
    if not isinstance(results, list): return error("Provide results list")
    enrolled_rolls = {str(row["roll"]) for row in students_for(course)}
    operations = []
    saved_count = 0
    for item in results:
        if not isinstance(item, dict): continue
        roll = str(item.get("roll", "")).strip()
        if not roll or roll not in enrolled_rolls: continue
        try:
            number = int(item.get("test_number"))
            if number not in (1, 2, 3, 4): continue
        except (ValueError, TypeError): continue
        mark = item.get("obtained_marks")
        if mark is None: continue
        mark_val = None
        if isinstance(mark, str):
            s_mark = mark.strip().upper()
            if s_mark == 'A':
                mark_val = 'A'
            elif s_mark != '':
                try:
                    num = float(s_mark)
                    if 0 <= num <= total:
                        mark_val = int(num) if num.is_integer() else num
                except ValueError: pass
        elif isinstance(mark, (int, float)) and not isinstance(mark, bool):
            if 0 <= mark <= total:
                mark_val = int(mark) if float(mark).is_integer() else float(mark)
        if mark_val is not None:
            row = {"student_id": roll, "roll": roll, "course_id": course["course_id"], "course_code": course["course_code"], "series": course["series"], "semester": course["semester"], "test_number": number, "obtained_marks": mark_val, "total_marks": total}
            operations.append(UpdateOne({"course_id": course["course_id"], "roll": roll, "test_number": number}, {"$set": row}, upsert=True))
            saved_count += 1
    if operations:
        database.class_test_results.bulk_write(operations, ordered=False)
    return jsonify({"saved": saved_count})

@app.route("/api/teacher/courses/<path:course_code>/assignments", methods=["GET", "POST"])
@require_teacher
def assignments(course_code):
    course, response = owned_course(course_code)
    if response: return response
    
    if request.method == "GET":
        course_assignments = sorted([public(row) for row in database.assignments.find({"course_id": course["course_id"]})], key=lambda row: row.get("assignment_number", 0))
        enrolled_students = students_for(course)
        
        assign_ids = [assign["assignment_id"] for assign in course_assignments]
        raw_submissions = list(database.assignment_submissions.find({"assignment_id": {"$in": assign_ids}}))
        
        subs_map = {}
        for sub in raw_submissions:
            aid = sub.get("assignment_id")
            r = sub.get("roll")
            sid = sub.get("student_id")
            if r is not None:
                subs_map[(aid, str(r))] = sub
            if sid is not None:
                subs_map[(aid, str(sid))] = sub

        assignments_data = []
        for assign in course_assignments:
            assign_id = assign["assignment_id"]
            total_m = assign.get("total_marks", 10)
            student_submissions = []
            for student in enrolled_students:
                roll = student["roll"]
                sid = student.get("student_id", roll)
                sub = subs_map.get((assign_id, str(roll))) or subs_map.get((assign_id, str(sid)))
                
                if sub and (sub.get("file_name") or sub.get("status") in ("Submitted", "Graded") or sub.get("text_answer")):
                    status = "Submitted"
                else:
                    status = "Not Submitted"
                
                student_submissions.append({
                    "roll": roll,
                    "name": student.get("name", roll),
                    "student_id": sid,
                    "status": status,
                    "submitted_at": sub.get("submitted_at") if sub else None,
                    "text_answer": sub.get("text_answer") if sub else None,
                    "file_id": sub.get("file_id") if sub else None,
                    "file_name": sub.get("file_name") if sub else None,
                    "file_content_type": sub.get("file_content_type") if sub else None,
                    "marks": sub.get("marks") if sub else None,
                    "total_marks": total_m,
                    "feedback": sub.get("feedback") if sub else None
                })
            assignments_data.append({
                **assign,
                "submissions": student_submissions
            })
            
        return jsonify({
            "assignments": assignments_data,
            "enrolled_students": enrolled_students
        })

    # POST - Create or update assignment
    if request.form:
        title = request.form.get("title", "").strip()
        description = request.form.get("description", "").strip()
        deadline = request.form.get("deadline", "").strip()
        total_marks_raw = request.form.get("total_marks", "10")
        assign_num_raw = request.form.get("assignment_number")
    else:
        payload = request.get_json(silent=True) or {}
        title = payload.get("title", "").strip()
        description = payload.get("description", "").strip()
        deadline = payload.get("deadline", "").strip()
        total_marks_raw = payload.get("total_marks", 10)
        assign_num_raw = payload.get("assignment_number")

    try:
        total_marks = float(total_marks_raw)
    except (ValueError, TypeError):
        return error("Total marks must be a valid number", 400)

    if not title or not deadline:
        return error("Title and deadline are required", 400)

    existing_assignments = list(database.assignments.find({"course_id": course["course_id"]}))
    
    if assign_num_raw:
        try:
            number = int(assign_num_raw)
            if number not in (1, 2, 3):
                return error("Assignment number must be 1, 2, or 3", 400)
        except ValueError:
            return error("Assignment number must be 1, 2, or 3", 400)
    else:
        existing_numbers = {a.get("assignment_number") for a in existing_assignments}
        available = [n for n in (1, 2, 3) if n not in existing_numbers]
        if not available:
            return error("Each course can have exactly 3 assignments", 409)
        number = available[0]

    # Handle Reference / Instructions File Upload
    ref_upload = request.files.get("ref_file") or request.files.get("file")
    assignment_id = f"{course['course_id']}-A{number}"
    existing_doc = database.assignments.find_one({"assignment_id": assignment_id}) or {}
    stored_file = None
    if ref_upload and ref_upload.filename:
        try:
            stored_file = store_assignment_upload(
                ref_upload,
                request.teacher_id,
                "teacher",
                course["course_id"],
                assignment_id,
            )
        except FileValidationError as exc:
            return error(str(exc), 400)
        except FileStorageUnavailable as exc:
            return error(str(exc), 503)

    doc = {
        "assignment_id": assignment_id,
        "course_id": course["course_id"],
        "course_code": course["course_code"],
        "teacher_id": request.teacher_id,
        "series": course["series"],
        "semester": course["semester"],
        "assignment_number": number,
        "title": title,
        "description": description,
        "deadline": deadline,
        "total_marks": total_marks,
        "ref_file_id": (stored_file or existing_doc).get("file_id", existing_doc.get("ref_file_id")),
        "ref_file_name": (stored_file or existing_doc).get("file_name") if stored_file or existing_doc.get("ref_file_id") else None,
        "ref_file_content_type": (stored_file or existing_doc).get("file_content_type", existing_doc.get("ref_file_content_type")),
        "ref_file_size": (stored_file or existing_doc).get("file_size", existing_doc.get("ref_file_size")),
        "ref_file_uploaded_at": (stored_file or existing_doc).get("file_uploaded_at", existing_doc.get("ref_file_uploaded_at")),
        "status": "active"
    }

    try:
        database.assignments.update_one(
            {"assignment_id": assignment_id},
            {"$set": doc, "$unset": {"ref_file_path": ""}},
            upsert=True,
        )
    except Exception:
        if stored_file:
            try:
                delete_gridfs_file(stored_file["file_id"])
            except Exception:
                app.logger.exception("Failed to clean up an unreferenced GridFS reference file")
        raise
    if stored_file and existing_doc.get("ref_file_id") and existing_doc["ref_file_id"] != stored_file["file_id"]:
        delete_gridfs_file(existing_doc["ref_file_id"])
    return jsonify({"message": "Assignment created/updated successfully.", "assignment": public(doc)}), 201

@app.post("/api/teacher/courses/<path:course_code>/assignments/<assignment_id>/submissions/<roll>/grade")
@require_teacher
def grade_assignment(course_code, assignment_id, roll):
    course, response = owned_course(course_code)
    if response: return response
    
    assignment = database.assignments.find_one({"assignment_id": assignment_id, "course_id": course["course_id"]})
    if not assignment:
        return error("Assignment not found for this course", 404)

    payload = request.get_json(silent=True) or {}
    marks_raw = payload.get("marks")
    feedback = payload.get("feedback", "").strip()

    try:
        marks = float(marks_raw)
    except (ValueError, TypeError):
        return error("Marks must be a valid number", 400)

    total_marks = float(assignment.get("total_marks", 10))
    if marks < 0 or marks > total_marks:
        return error(f"Marks must be between 0 and {total_marks}", 400)

    submission = database.assignment_submissions.find_one({"assignment_id": assignment_id, "course_id": course["course_id"], "roll": roll})
    if not submission:
        student_doc = database.students.find_one({"roll": roll})
        if not student_doc:
            return error("Student not found", 404)
        submission = {
            "assignment_id": assignment_id,
            "course_id": course["course_id"],
            "course_code": course["course_code"],
            "student_id": student_doc.get("student_id", roll),
            "roll": roll,
            "submitted_at": datetime.utcnow().isoformat(),
            "text_answer": "",
            "file_name": None,
            "status": "Submitted"
        }

    update_doc = {
        "marks": marks,
        "total_marks": total_marks,
        "feedback": feedback,
        "status": "Graded",
        "graded_by": request.teacher_id,
        "graded_at": datetime.utcnow().isoformat()
    }
    
    database.assignment_submissions.update_one(
        {"assignment_id": assignment_id, "course_id": course["course_id"], "roll": roll},
        {"$set": {**submission, **update_doc}},
        upsert=True
    )
    return jsonify({"message": "Marks saved successfully.", "status": "Graded", "marks": marks, "feedback": feedback})


@app.route("/api/teacher/courses/<path:course_code>/assignments/<assignment_id>/unsubmit-file", methods=["POST", "DELETE"])
@require_teacher
def unsubmit_teacher_assignment_file(course_code, assignment_id):
    course, response = owned_course(course_code)
    if response: return response
    assignment = database.assignments.find_one({"assignment_id": assignment_id, "course_id": course["course_id"]})
    if not assignment: return error("Assignment not found", 404)
    try:
        delete_gridfs_file(assignment.get("ref_file_id"))
    except FileStorageUnavailable as exc:
        return error(str(exc), 503)
    database.assignments.update_one(
        {"assignment_id": assignment_id, "course_id": course["course_id"]},
        {
            "$set": {
                "ref_file_id": None,
                "ref_file_name": None,
                "ref_file_content_type": None,
                "ref_file_size": None,
                "ref_file_uploaded_at": None,
            },
            "$unset": {"ref_file_path": ""},
        },
    )
    return jsonify({"message": "Assignment file unsubmitted successfully."})


@app.post("/api/teacher/courses/<path:course_code>/assignments/<assignment_id>/upload-file")
@require_teacher
def upload_teacher_assignment_file(course_code, assignment_id):
    course, response = owned_course(course_code)
    if response: return response
    assignment = database.assignments.find_one({"assignment_id": assignment_id, "course_id": course["course_id"]})
    if not assignment: return error("Assignment not found", 404)
    ref_upload = request.files.get("ref_file") or request.files.get("file")
    if not ref_upload or not ref_upload.filename:
        return error("Please select a file to upload.", 400)
    try:
        stored_file = store_assignment_upload(
            ref_upload,
            request.teacher_id,
            "teacher",
            course["course_id"],
            assignment_id,
        )
    except FileValidationError as exc:
        return error(str(exc), 400)
    except FileStorageUnavailable as exc:
        return error(str(exc), 503)
    try:
        database.assignments.update_one(
            {"assignment_id": assignment_id, "course_id": course["course_id"]},
            {
                "$set": {
                    "ref_file_id": stored_file["file_id"],
                    "ref_file_name": stored_file["file_name"],
                    "ref_file_content_type": stored_file["file_content_type"],
                    "ref_file_size": stored_file["file_size"],
                    "ref_file_uploaded_at": stored_file["file_uploaded_at"],
                },
                "$unset": {"ref_file_path": ""},
            },
        )
    except Exception:
        try:
            delete_gridfs_file(stored_file["file_id"])
        except Exception:
            app.logger.exception("Failed to clean up an unreferenced GridFS reference file")
        raise
    if assignment.get("ref_file_id") and assignment["ref_file_id"] != stored_file["file_id"]:
        delete_gridfs_file(assignment["ref_file_id"])
    return jsonify({"message": "Assignment file updated successfully.", "ref_file_id": stored_file["file_id"], "ref_file_name": stored_file["file_name"]})


@app.route("/api/teacher/courses/<path:course_code>/assignments/<assignment_id>/submissions/<roll>/unsubmit", methods=["POST", "DELETE"])
@require_teacher
def teacher_unsubmit_student_submission(course_code, assignment_id, roll):
    course, response = owned_course(course_code)
    if response: return response
    sub = database.assignment_submissions.find_one({"assignment_id": assignment_id, "course_id": course["course_id"], "roll": roll}) or \
          database.assignment_submissions.find_one({"assignment_id": assignment_id, "course_id": course["course_id"], "student_id": roll})
    if not sub:
        return error("Submission not found", 404)
    try:
        delete_gridfs_file(sub.get("file_id"))
    except FileStorageUnavailable as exc:
        return error(str(exc), 503)
    query = {"_id": sub["_id"]} if "_id" in sub else {
        "assignment_id": assignment_id,
        "course_id": course["course_id"],
        "student_id": sub.get("student_id"),
        "roll": sub.get("roll"),
    }
    database.assignment_submissions.delete_one(query)
    return jsonify({"message": f"Submission for Roll {roll} has been unsubmitted successfully."})


def generate_teacher_report(course):
    att_rows = {row["roll"]: row for row in attendance_summary(course)}
    ct_rows = {row["roll"]: row for row in test_summary(course)}
    
    all_submissions = list(database.assignment_submissions.find({"course_id": course["course_id"]}))
    sub_scores_map = {}
    for sub in all_submissions:
        roll = sub.get("roll")
        sid = sub.get("student_id")
        total_m = sub.get("total_marks")
        marks = sub.get("marks")
        if total_m and marks is not None and isinstance(marks, (int, float)):
            score = (float(marks) / float(total_m)) * 10.0
            if roll is not None:
                sub_scores_map.setdefault(str(roll), []).append(score)
            if sid is not None and str(sid) != str(roll):
                sub_scores_map.setdefault(str(sid), []).append(score)

    rows = []
    for student in students_for(course):
        roll = student["roll"]
        name = student["name"]
        
        att_info = att_rows.get(roll, {})
        att_pct = att_info.get("attendance_percentage", 0)
        att_marks = get_attendance_marks(att_pct)
        
        ct_info = ct_rows.get(roll, {})
        ct_avg = ct_info.get("best_3_average")
        ct_marks = float(ct_avg) if ct_avg is not None else 0.0
        
        assign_scores = sub_scores_map.get(str(roll), [])
        assign_marks = round(sum(assign_scores) / len(assign_scores), 2) if assign_scores else 0.0
        
        total_marks = round(ct_marks + assign_marks + att_marks, 2)
        
        rows.append({
            "roll": roll,
            "name": name,
            "ct_marks": ct_marks,
            "assignment_marks": assign_marks,
            "attendance_marks": att_marks,
            "attendance_percentage": att_pct,
            "total_marks": total_marks
        })
    return rows

@app.get("/api/teacher/courses/<path:course_code>/performance")
@require_teacher
def performance(course_code):
    course, response = owned_course(course_code)
    if response: return response
    
    report_rows = generate_teacher_report(course)
    att_rows = {row["roll"]: row for row in attendance_summary(course)}
    results = []
    for r in report_rows:
        roll = r["roll"]
        att = att_rows.get(roll, {})
        total_40 = r["total_marks"]
        overall = round((total_40 / 40.0) * 100.0, 2)
        results.append({
            "roll": roll,
            "name": r["name"],
            "classes_held": att.get("total_held", 0),
            "present": att.get("present", 0),
            "absent": att.get("absent", 0),
            "attendance_percentage": r["attendance_percentage"],
            "attendance_marks": r["attendance_marks"],
            "ct_best_3_average": r["ct_marks"],
            "assignment_average": r["assignment_marks"],
            "total_marks": total_40,
            "overall_performance": overall,
            "risk_level": "Low" if overall >= 80 else "Medium" if overall >= 60 else "High"
        })
    return jsonify({"students": results})

@app.get("/api/teacher/courses/<path:course_code>/reports/<report_type>")
@require_teacher
def reports(course_code, report_type):
    course, response = owned_course(course_code)
    if response: return response
    if report_type == "attendance": return jsonify({"report": report_type, "rows": attendance_summary(course)})
    if report_type == "class-tests": return jsonify({"report": report_type, "rows": test_summary(course)})
    if report_type == "performance": return performance(course_code)
    if report_type in ("summary", "teacher-report", "final", "teacher", "evaluation"):
        rows = generate_teacher_report(course)
        return jsonify({"report": report_type, "students": rows, "rows": rows})
    return error("Unknown report type", 404)

@app.get("/api/teacher/courses/<path:course_code>/reports/<report_type>/export")
@require_teacher
def export_report(course_code, report_type):
    course, response = owned_course(course_code)
    if response: return response
    if report_type == "attendance":
        rows = attendance_summary(course)
        headers = ["Roll", "Name"] + [f"W{week}D{day}" for week in range(1,14) for day in range(1,4)] + ["Total Held", "Present", "Absent", "Attendance %", "Attendance Marks (10)"]
        values = [[row["roll"], row["name"]] + [row["attendance"][f"w{week}d{day}"] for week in range(1,14) for day in range(1,4)] + [row["total_held"], row["present"], row["absent"], row["attendance_percentage"], row.get("attendance_marks", 0)] for row in rows]
    elif report_type == "class-tests":
        rows = test_summary(course); headers = ["Roll", "Name", "CT1", "CT2", "CT3", "CT4", "Best 3 Average"]; values = [[row["roll"], row["name"], row["ct1"], row["ct2"], row["ct3"], row["ct4"], row["best_3_average"]] for row in rows]
    elif report_type in ("performance", "teacher-report", "summary", "final", "teacher", "evaluation"):
        rows = generate_teacher_report(course)
        headers = ["Student Roll", "Total Marks (out of 40)", "CT Marks (out of 20)", "Assignment Marks (out of 10)", "Attendance Marks (out of 10)"]
        values = [[row["roll"], row["total_marks"], row["ct_marks"], row["assignment_marks"], row["attendance_marks"]] for row in rows]
    else: return error("Unknown report type", 404)
    filename = f"{course['course_id']}-{report_type}"
    if request.args.get("format") == "xlsx":
        book = Workbook(); sheet = book.active; sheet.title = report_type.title()[:31]; sheet.append(headers)
        for row in values: sheet.append(row)
        stream = BytesIO(); book.save(stream)
        return app.response_class(stream.getvalue(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"})
    if request.args.get("format") == "pdf":
        stream = BytesIO()
        document = SimpleDocTemplate(
            stream,
            pagesize=A4,
            leftMargin=36,
            rightMargin=36,
            topMargin=36,
            bottomMargin=36
        )
        
        styles = getSampleStyleSheet()
        
        center_style = ParagraphStyle(
            'HeaderCenter',
            parent=styles['Normal'],
            alignment=TA_CENTER,
            fontName='Helvetica-Oblique',
            fontSize=10,
            leading=13,
            textColor=colors.HexColor('#333333')
        )
        
        univ_style = ParagraphStyle(
            'UnivHeader',
            parent=styles['Normal'],
            alignment=TA_CENTER,
            fontName='Helvetica-Bold',
            fontSize=13,
            leading=16,
            textColor=colors.HexColor('#000000')
        )
        
        dept_style = ParagraphStyle(
            'DeptHeader',
            parent=styles['Normal'],
            alignment=TA_CENTER,
            fontName='Helvetica-Bold',
            fontSize=11,
            leading=14,
            textColor=colors.HexColor('#000000')
        )
        
        box_style = ParagraphStyle(
            'BoxHeader',
            parent=styles['Normal'],
            alignment=TA_CENTER,
            fontName='Helvetica-Bold',
            fontSize=12,
            leading=16,
            textColor=colors.HexColor('#000000')
        )
        
        right_style = ParagraphStyle(
            'FooterRight',
            parent=styles['Normal'],
            alignment=TA_RIGHT,
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=colors.HexColor('#000000')
        )

        teacher_info = database.teachers.find_one({"teacher_id": course.get("teacher_id")}) or {}
        t_id = course.get("teacher_id") or teacher_info.get("teacher_id", "T01")
        t_name = teacher_info.get("name", "")

        story = []
        
        if report_type in ("performance", "teacher-report", "summary", "final", "teacher", "evaluation"):
            # 1. Header Text
            story.append(Paragraph("Heaven's light is our guide", center_style))
            story.append(Paragraph("Rajshahi University of Engineering & Technology", univ_style))
            story.append(Paragraph("Department of Electronics & Telecommunication Engineering", dept_style))
            story.append(Spacer(1, 10))
            
            # 2. Boxed Sub-Header Block
            course_text = f"Continuous Assessment Marks on<br/><font size=13><b>{course.get('course_code')} ({course.get('course_name')})</b></font>"
            box_table = Table([[Paragraph(course_text, box_style)]], colWidths=[522])
            box_table.setStyle(TableStyle([
                ('BOX', (0,0), (-1,-1), 1.5, colors.HexColor('#000000')),
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('TOPPADDING', (0,0), (-1,-1), 8),
                ('BOTTOMPADDING', (0,0), (-1,-1), 8),
            ]))
            story.append(box_table)
            story.append(Spacer(1, 15))
            
            # 3. Marks Table
            table_data = [[
                Paragraph("<b>Student Roll</b>", ParagraphStyle('TH', parent=styles['Normal'], alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=colors.white)),
                Paragraph("<b>Total Marks<br/>(out of 40)</b>", ParagraphStyle('TH', parent=styles['Normal'], alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=colors.white)),
                Paragraph("<b>CT Marks<br/>(out of 20)</b>", ParagraphStyle('TH', parent=styles['Normal'], alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=colors.white)),
                Paragraph("<b>Assignment Marks<br/>(out of 10)</b>", ParagraphStyle('TH', parent=styles['Normal'], alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=colors.white)),
                Paragraph("<b>Attendance Marks<br/>(out of 10)</b>", ParagraphStyle('TH', parent=styles['Normal'], alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=colors.white)),
            ]]
            
            for row in values:
                table_data.append([
                    str(row[0]),
                    str(row[1]),
                    str(row[2]),
                    str(row[3]),
                    str(row[4])
                ])
                
            marks_table = Table(table_data, colWidths=[95, 110, 105, 110, 102], repeatRows=1)
            marks_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0d47a1')),
                ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#444444')),
                ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                ('FONTSIZE', (0,0), (-1,-1), 9),
                ('TOPPADDING', (0,0), (-1,-1), 5),
                ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ]))
            story.append(marks_table)
            story.append(Spacer(1, 30))
            
            # 4. Footer Signature Block
            footer_html = f"Teacher ID: {t_id}<br/>"
            if t_name:
                footer_html += f"<b>{t_name}</b><br/>"
            footer_html += "Professor<br/>Dept. of ETE, RUET"
            
            footer_table = Table([["", Paragraph(footer_html, right_style)]], colWidths=[300, 222])
            footer_table.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('ALIGN', (1,0), (1,0), 'RIGHT'),
            ]))
            story.append(KeepTogether([footer_table]))
        else:
            table = Table([headers] + values, repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#0d47a1")),
                ("TEXTCOLOR", (0,0), (-1,0), colors.white),
                ("ALIGN", (0,0), (-1,-1), "CENTER"),
                ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
                ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
                ("FONTSIZE", (0,0), (-1,-1), 9)
            ]))
            story.append(table)
            
        document.build(story)
        return app.response_class(
            stream.getvalue(),
            mimetype="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}.pdf"}
        )
    return error("Use format=xlsx or format=pdf")

@app.get("/api/health")
def health(): return jsonify({"status": "ok", "database": "in-memory development fallback" if database.using_in_memory_database else "mongodb"})

if __name__ == "__main__": app.run(host="0.0.0.0", port=8000, debug=True)
