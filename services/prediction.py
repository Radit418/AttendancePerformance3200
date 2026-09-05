from typing import List, Dict


def compute_prediction(attendance_records: List[Dict], assignment_subs: List[Dict], class_tests: List[Dict]) -> Dict:
    """Compute a simple predicted academic score (0-100) using a heuristic:
    - attendance rate: 40%
    - assignments submission rate: 20%
    - average class test marks (normalized): 40%
    Returns details and final predicted_score.
    """
    # Attendance rate
    total_days = len(attendance_records)
    present = sum(1 for r in attendance_records if r.get("status") == "present")
    attendance_rate = (present / total_days) if total_days > 0 else 0.0

    # Assignment submission rate — count unique assignment_ids submitted
    total_assignments = 0
    submitted = 0
    if assignment_subs:
        assignment_ids = set(a.get("assignment_id") for a in assignment_subs)
        total_assignments = len(assignment_ids)
        submitted = len(assignment_subs)
    assignment_rate = (submitted / total_assignments) if total_assignments > 0 else 0.0

    # Class tests average (assume marks already as numbers and total_marks normalized to 100)
    avg_test = 0.0
    if class_tests:
        marks = []
        for t in class_tests:
            # each t may be {'title':..., 'roll':..., 'marks':x, 'total_marks':y}
            if "marks" in t and t.get("total_marks"):
                tm = t.get("total_marks")
                if tm > 0:
                    marks.append((t.get("marks") / tm) * 100)
            elif "marks" in t:
                marks.append(float(t.get("marks")))
        if marks:
            avg_test = sum(marks) / len(marks) / 100.0

    # Weighted sum
    predicted = (attendance_rate * 0.4 + assignment_rate * 0.2 + avg_test * 0.4) * 100.0

    return {
        "predicted_score": round(predicted, 2),
        "attendance_rate": round(attendance_rate, 3),
        "assignment_rate": round(assignment_rate, 3),
        "avg_test_rate": round(avg_test, 3),
    }
