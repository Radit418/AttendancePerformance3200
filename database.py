"""MongoDB connection and a development-safe in-memory fallback."""
from copy import deepcopy
from datetime import date, timedelta
import os

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from werkzeug.security import generate_password_hash

load_dotenv()
COLLECTION_NAMES = ("users", "departments", "series", "semesters", "teachers", "students", "courses", "course_assignments", "enrollments", "class_sessions", "attendance", "assignments", "assignment_submissions", "class_tests", "class_test_results", "predictions")

OFFICIAL_COURSES = {
    1: [("ETE 1111", "Electrical Circuit Theory"), ("ETE 1113", "Computer Fundamental and Programming with C"), ("PHY 1115", "Physics"), ("MATH 1115", "Calculus and Differential Equation"), ("HUM 1115", "Communicative English")],
    2: [("ETE 1211", "Analog Electronics 1"), ("ETE 1213", "Digital Electronics"), ("EEE 1253", "Electrical Machine"), ("MATH 1215", "Linear Algebra and 3D Geometry"), ("HUM 1215", "Financial Account and Economic Analysis")],
    3: [("ETE 2111", "Analog Electronics 2"), ("ETE 2113", "Analog Communication"), ("ETE 2115", "Signal and System"), ("CSE 2153", "Data Structure and Algorithm"), ("MATH 2115", "Transformation Techniques and Partial Differential Equation")],
    4: [("ETE 2211", "Power Electronics"), ("ETE 2213", "Electromagnetic Field and Waves"), ("MATH 2215", "Complex Variable and Statistical Analysis"), ("CSE 2253", "Data Structure and Algorithm"), ("HUM 2215", "Engineering Ethics and Sociology")],
    5: [("ETE 3111", "Digital Communication"), ("ETE 3113", "Microwave Engineering"), ("ETE 3115", "Numerical Method in Engineering"), ("ETE 3117", "Control System"), ("EEE 3153", "Power System")],
    6: [("ETE 3211", "Fiber Optic Communication System"), ("ETE 3213", "Antenna and Propagation"), ("ETE 3215", "Digital Signal Processing"), ("ETE 3217", "Information Theory"), ("ETE 3229", "Renewable Energy")],
    7: [("ETE 4111", "Wireless and Mobile Communication"), ("ETE 4113", "VLSI Design"), ("ETE 4115", "Microprocessor and Interfacing"), ("ETE 4117", "Data Communication and Computer Networks"), ("ETE 4139", "Data Science")],
    8: [("ETE 4211", "Telecommunication Engineering"), ("ETE 4213", "Satellite Communication and Radar"), ("ETE 4215", "Machine Learning"), ("HUM 4215", "Project Management and Legal Issue"), ("ETE 4225", "Neural Network and Fuzzy System")],
}

SERIES_SEMESTERS = {21: 8, 22: 6, 23: 4, 24: 3, 25: 1}
SERIES_ROLL_PREFIXES = {21: "2104", 22: "2204", 23: "2304", 24: "2401", 25: "2504"}


class UpdateResult:
    def __init__(self, matched_count=0, modified_count=0, upserted_id=None):
        self.matched_count, self.modified_count, self.upserted_id = matched_count, modified_count, upserted_id


class InMemoryCollection:
    """Subset of PyMongo used by the application, for offline local development."""
    def __init__(self):
        self.documents = []

    @staticmethod
    def _matches(document, query):
        for key, expected in (query or {}).items():
            value = document.get(key)
            if isinstance(expected, dict) and "$in" in expected:
                if value not in expected["$in"]: return False
            elif isinstance(expected, dict) and "$nin" in expected:
                if value in expected["$nin"]: return False
            elif value != expected:
                return False
        return True

    def find(self, query=None, projection=None):
        rows = [deepcopy(row) for row in self.documents if self._matches(row, query)]
        if projection:
            included = [key for key, show in projection.items() if show and key != "_id"]
            if included: rows = [{key: row[key] for key in included if key in row} for row in rows]
        return rows

    def find_one(self, query=None):
        rows = self.find(query)
        return rows[0] if rows else None

    def insert_one(self, document): self.documents.append(deepcopy(document))
    def insert_many(self, documents):
        for document in documents: self.insert_one(document)

    def update_one(self, query, update, upsert=False):
        for row in self.documents:
            if self._matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return UpdateResult(1, 1)
        if upsert:
            row = deepcopy(query); row.update(deepcopy(update.get("$setOnInsert", {}))); row.update(deepcopy(update.get("$set", {}))); self.documents.append(row)
            return UpdateResult(0, 0, True)
        return UpdateResult()

    def delete_one(self, query):
        for index, row in enumerate(self.documents):
            if self._matches(row, query):
                self.documents.pop(index)
                return UpdateResult(1, 1)
        return UpdateResult()

    def delete_many(self, query):
        previous = len(self.documents)
        self.documents = [row for row in self.documents if not self._matches(row, query)]
        return UpdateResult(previous - len(self.documents), previous - len(self.documents))

    def update_many(self, query, update):
        count = 0
        for row in self.documents:
            if self._matches(row, query):
                row.update(deepcopy(update.get("$set", {}))); count += 1
        return UpdateResult(count, count)


using_in_memory_database = False
MONGO_URI = os.getenv("MONGO_URI")
try:
    if not MONGO_URI: raise ValueError("MONGO_URI is missing")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    client.admin.command("ping")
    db = client["smart_attendance_system"]
    collections = {name: db[name] for name in COLLECTION_NAMES}
    print("MongoDB connected successfully")
except (PyMongoError, ValueError) as error:
    using_in_memory_database = True
    collections = {name: InMemoryCollection() for name in COLLECTION_NAMES}
    print(f"MongoDB unavailable; using temporary development data ({error})")
globals().update(collections)


def ensure_official_courses():
    """Safely migrate the catalog to the department's 40 official courses."""
    official_codes = []
    for semester, entries in OFFICIAL_COURSES.items():
        for code, name in entries:
            official_codes.append(code)
            existing = courses.find_one({"course_code": code}) or courses.find_one({"course_id": code.replace(" ", "")})
            course_id = existing.get("course_id") if existing else code.replace(" ", "")
            document = {"course_id": course_id, "course_code": code, "course_name": name, "course_type": existing.get("course_type", "Theory") if existing else "Theory", "department": "ETE", "semester": semester, "credits": existing.get("credits") if existing else None, "status": "active"}
            courses.update_one({"course_id": course_id}, {"$set": document}, upsert=True)
    retired_ids = [row.get("course_id") for row in courses.find({"course_code": {"$nin": official_codes}}) if row.get("course_id")]
    if retired_ids:
        course_assignments.update_many({"course_id": {"$in": retired_ids}, "status": "active"}, {"$set": {"status": "inactive"}})
        courses.delete_many({"course_id": {"$in": retired_ids}})
    return len(official_codes)


def ensure_student_academic_data():
    """Create/update the five student series without duplicate accounts."""
    # All development student accounts use the documented initial password.
    # Reuse its securely derived value so local fallback startup does not spend
    # minutes deriving the same password hash 300 times.
    student_password_hash = generate_password_hash("Student@123")
    for series_no, semester_no in SERIES_SEMESTERS.items():
        for number in range(1, 61):
            roll = f"{SERIES_ROLL_PREFIXES[series_no]}{number:03d}"
            student = {"student_id": roll, "roll": roll, "name": f"Student {series_no}-{number:02d}", "series": series_no, "semester": semester_no, "current_semester": semester_no, "email": f"{roll}@student.ete.edu", "status": "active", "department": "ETE"}
            students.update_one({"student_id": roll}, {"$set": student}, upsert=True)
            users.update_one({"username": roll}, {"$set": {"username": roll, "password_hash": student_password_hash, "role": "student", "student_id": roll, "status": "active", "token_version": 0}}, upsert=True)
        for course in courses.find({"semester": semester_no}):
            for student in students.find({"series": series_no}):
                enrollments.update_one({"course_id": course["course_id"], "roll": student["roll"]}, {"$set": {"course_id": course["course_id"], "course_code": course["course_code"], "roll": student["roll"], "student_id": student["student_id"], "series": series_no, "semester": semester_no}}, upsert=True)


def ensure_student_assignments():
    """Ensure the student panel has the required three assignments per course."""
    deadlines = [date.today() + timedelta(days=14), date.today() + timedelta(days=28), date.today() + timedelta(days=42)]
    for course in courses.find({}):
        for number, deadline in enumerate(deadlines, start=1):
            assignment_id = f"{course['course_id']}-A{number}"
            assignments.update_one(
                {"assignment_id": assignment_id},
                {"$setOnInsert": {"assignment_id": assignment_id, "course_id": course["course_id"], "course_code": course["course_code"], "semester": course["semester"], "assignment_number": number, "title": f"Assignment {number}", "description": "", "deadline": deadline.isoformat(), "total_marks": 10, "status": "active"}},
                upsert=True,
            )


def ensure_indexes():
    """Create safe uniqueness protections when connected to MongoDB."""
    if using_in_memory_database:
        return
    assignment_submissions.create_index([("assignment_id", 1), ("student_id", 1)], unique=True, name="unique_student_assignment_submission")


def seed_development_data():
    if not using_in_memory_database or students.find_one({}): return
    for series_no in range(21, 26): series.insert_one({"series": series_no, "department": "ETE", "status": "active" if series_no == 22 else "empty"})
    for number in range(1, 9): semesters.insert_one({"semester": number, "department": "ETE", "status": "current" if number == 6 else "completed" if number < 6 else "upcoming"})
    for number in range(1, 16):
        teacher_id = f"T{number:02d}"
        teachers.insert_one({"teacher_id": teacher_id, "username": teacher_id, "name": f"Dr. Teacher {number:02d}", "email": f"{teacher_id.lower()}@ete.edu", "status": "active", "department": "ETE"})
    users.insert_one({"username": "admin", "password_hash": generate_password_hash("Admin@123"), "role": "admin", "status": "active", "token_version": 0})
    for teacher in teachers.find({}):
        users.insert_one({"username": teacher["teacher_id"], "password_hash": generate_password_hash("Teacher@123"), "role": "teacher", "teacher_id": teacher["teacher_id"], "status": "active", "token_version": 0})
    ensure_official_courses()
    ensure_student_academic_data()
    ensure_student_assignments()
    sem6_courses = courses.find({"semester": 6})
    for idx, course in enumerate(sem6_courses):
        tid = f"T{idx+1:02d}"
        course_assignments.update_one(
            {"course_id": course["course_id"]},
            {"$set": {"assignment_id": f"assign-{course['course_id']}", "course_id": course["course_id"], "course_code": course["course_code"], "teacher_id": tid, "teacher_code": tid, "teacher_name": f"Dr. Teacher {idx+1:02d}", "series": 22, "semester": 6, "course_type": course.get("course_type", "Theory"), "status": "active"}},
            upsert=True
        )


seed_development_data()
