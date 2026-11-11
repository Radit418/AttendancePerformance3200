# Frontend for Continuous Assessment and Academic Performance Evaluation System

This is a static frontend for the Smart Attendance System API.

## Run Locally

1. Start the Flask backend API:

```bash
python -m flask --app app run --host 0.0.0.0 --port 8000
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

- Set `VITE_API_URL` to the backend origin. Locally it defaults to
  `http://localhost:8000`; in Vercel set it to the deployed Render API URL.
- Configure the Vercel project Root Directory as `frontend` so it builds this
  Vite app rather than the backend entry point.
- Login with a student roll like `2204001`, teacher ID like `1201`, or admin ID `2104`.
- Student can view attendance and class test marks, and submit assignments.
- Teacher can record attendance, class tests, and view assignment submissions.
- Admin can assign courses to teachers.
