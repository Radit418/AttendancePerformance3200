# Frontend for Smart Attendance System

This is a static frontend for the Smart Attendance System API.

## Run Locally

1. Start the backend API:

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

2. Serve the frontend folder:

```bash
cd frontend
python -m http.server 3000
```

3. Open the browser:

```
http://localhost:3000
```

## Notes

- Login with a student roll like `2204001`, teacher ID like `1201`, or admin ID `2104`.
- Student can view attendance and class test marks, and submit assignments.
- Teacher can record attendance, class tests, and view assignment submissions.
- Admin can assign courses to teachers.
