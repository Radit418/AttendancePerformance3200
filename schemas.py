from pydantic import BaseModel
from typing import List, Optional


class LoginRequest(BaseModel):
    user_id: str


class LoginResponse(BaseModel):
    role: str
    profile: dict


class AttendanceEntry(BaseModel):
    roll: str
    status: str  # present/absent


class AttendanceInput(BaseModel):
    date: Optional[str]
    entries: List[AttendanceEntry]


class ClassTestMark(BaseModel):
    roll: str
    marks: float


class ClassTestInput(BaseModel):
    title: str
    total_marks: float
    marks: List[ClassTestMark]


class AssignmentSubmission(BaseModel):
    course_id: str
    assignment_id: str
    content: str


class AssignCourseInput(BaseModel):
    course_id: str
    teacher_id: str


class PredictionResponse(BaseModel):
    roll: str
    predicted_score: float
    details: dict
