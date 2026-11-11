# Continuous Assessment and Academic Performance Evaluation System

## Backend setup

Install the Python dependencies and configure the Flask backend with a MongoDB
Atlas connection string:

```powershell
pip install -r requirements.txt
Copy-Item .env.example .env
```

Set `MONGO_URI` and a strong `SECRET_KEY` in `.env`. Assignment uploads are
stored in the `assignment_files` GridFS bucket in the existing
`smart_attendance_system` database; no persistent backend disk is required.
The MongoDB Atlas database user needs read/write access to that database.

Run locally with:

```powershell
python -m flask --app app run --host 0.0.0.0 --port 8000
```

For Render, use `gunicorn app:app` as the start command, set the same
`MONGO_URI` and `SECRET_KEY` environment variables, and allow the Render
service to connect in the Atlas network access settings. Set `CORS_ORIGINS` to
additional frontend origins not hosted under `*.vercel.app`, comma-separated
(for example `https://assessment.example.com`). HTTPS Vercel deployment
origins and the local development origins are allowed by default.

## Frontend setup

Set the Vercel project Root Directory to `frontend` and set `VITE_API_URL` to
the Flask API origin there (use `http://localhost:8000` locally), then build
and deploy:

```powershell
cd frontend
npm install
npm run dev
```

## Assignment files

Teacher reference files and student submissions are stored in GridFS. Their
existing assignment/submission documents keep the filename and store the
associated GridFS file ID and upload metadata. The authenticated file route is
`GET /api/assignments/files/<file_id>`; append `?download=1` to force a
download. PDF, image, and text files are served inline by default; Office
documents are downloaded.

On startup, the backend migrates legacy files found under
`uploads/assignments` when a matching MongoDB record has a local path but no
GridFS ID. It updates that existing record before removing the migrated local
file. Files that are outside that directory, unsupported, or larger than the
10 MB upload limit are logged and left untouched for manual handling. Existing
database records are not deleted.
