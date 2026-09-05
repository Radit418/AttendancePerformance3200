"""Create the existing user accounts; no registration flow exists in this project."""
from werkzeug.security import generate_password_hash
import database


def seed_users():
    database.users.update_one({"username": "admin"}, {"$set": {"username": "admin", "password_hash": generate_password_hash("Admin@123"), "role": "admin", "status": "active", "token_version": 0}}, upsert=True)
    for teacher in database.teachers.find({}):
        database.users.update_one({"username": teacher["teacher_id"]}, {"$set": {"username": teacher["teacher_id"], "password_hash": generate_password_hash("Teacher@123"), "role": "teacher", "teacher_id": teacher["teacher_id"], "status": "active", "token_version": 0}}, upsert=True)
    for student in database.students.find({}):
        database.users.update_one({"username": student["roll"]}, {"$set": {"username": student["roll"], "password_hash": generate_password_hash("Student@123"), "role": "student", "student_id": student["student_id"], "status": "active", "token_version": 0}}, upsert=True)


if __name__ == "__main__":
    database.ensure_official_courses()
    database.ensure_student_academic_data()
    database.ensure_student_assignments()
    database.ensure_indexes()
    seed_users()
    total = len(database.OFFICIAL_COURSES) * 5
    print(f"Seeded users and updated the official course catalog ({total} courses across 8 semesters).")
