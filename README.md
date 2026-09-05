# Smart Attendance System - Backend

Run the FastAPI backend (requires a MongoDB URI set in `.env` as `MONGO_URI`).

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the app locally:

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
python -m http.server 3000
```

Open in browser:

```bash
http://localhost:3000
```

Endpoints summary:
- `POST /login` — body `{ "user_id": "..." }`
- Student: `GET /student/{roll}/attendance`, `GET /student/{roll}/class_tests`, `POST /student/{roll}/assignments`, `GET /student/{roll}/prediction`
- Teacher: `POST /teacher/{teacher_id}/courses/{course_id}/attendance`, `POST /teacher/{teacher_id}/courses/{course_id}/class_test`, `GET /teacher/{teacher_id}/courses/{course_id}/assignments`
- Admin: `POST /admin/{admin_id}/assign_course`
