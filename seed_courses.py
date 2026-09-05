from database import courses


def seed_courses():
    # create five courses like ETE3211..ETE3215
    base_code = 3211
    for i in range(5):
        cid = f"ETE{base_code + i}"
        courses.update_one({"course_id": cid}, {"$set": {"course_id": cid, "course_name": f"ETE {base_code + i}", "department": "ETE"}}, upsert=True)


if __name__ == "__main__":
    seed_courses()
    print("Seeded 5 courses ETE3211..ETE3215.")
