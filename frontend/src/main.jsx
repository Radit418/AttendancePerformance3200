import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const call = async (path, token, options = {}) => {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (e) {}
  if (!response.ok) throw new Error(body.error || (response.status === 404 ? 'Endpoint not found (404)' : `Server error (${response.status})`));
  return body;
};
const submitForm = async (path, token, form) => {
  const response = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (e) {}
  if (!response.ok) throw new Error(body.error || `Server error (${response.status})`);
  return body;
};
const Status = ({ value }) => <span className={`badge ${value === 'Good' || value === 'Low' ? 'text-bg-success' : value === 'Warning' || value === 'Medium' ? 'text-bg-warning' : 'text-bg-danger'}`}>{value}</span>;
function PasswordInput({label,value,onChange}){const [visible,setVisible]=useState(false);return <><label className="form-label">{label}</label><div className="input-group mb-3"><input className="form-control" type={visible?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} required/><button type="button" className="btn btn-outline-secondary" aria-label={visible?'Hide password':'Show password'} onClick={()=>setVisible(!visible)}>{visible?'Hide':'Show'}</button></div></>}

function Login({ onLogin }) {
  const [role, setRole] = useState('student'), [username, setUsername] = useState('2204001'), [password, setPassword] = useState('Student@123'), [message, setMessage] = useState('');
  const chooseRole = value => { setRole(value); const demo = value === 'student' ? ['2204001','Student@123'] : value === 'teacher' ? ['T01','Teacher@123'] : ['admin','Admin@123']; setUsername(demo[0]); setPassword(demo[1]); };
  const submit = async e => { e.preventDefault(); try { setMessage(''); const result=await call('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ role, username, password }) }); sessionStorage.setItem('authToken',result.token); onLogin(result); } catch (err) { setMessage(err.message); } };
  return <main className="login-shell"><form className="card shadow-sm login-card" onSubmit={submit}><div className="card-body p-4"><p className="text-primary fw-bold mb-1">CONTINUOUS ASSESSMENT AND</p><h1 className="h3">Academic Performance Evaluation System</h1><label className="form-label">User Type</label><select className="form-select mb-3" value={role} onChange={e=>chooseRole(e.target.value)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select><label className="form-label">User ID</label><input className="form-control mb-3" value={username} onChange={e => setUsername(e.target.value)} required /><PasswordInput label="Password" value={password} onChange={setPassword}/>{message && <div className="alert alert-danger py-2">{message}</div>}<button className="btn btn-primary w-100">Login</button></div></form></main>;
}
function ChangePassword({token,onDone}){const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);const submit=async e=>{e.preventDefault();if(next!==confirm){setMessage('New passwords do not match.');return}try{setSaving(true);setMessage('');const r=await call('/api/auth/change-password',token,{method:'POST',body:JSON.stringify({current_password:current,new_password:next,confirm_password:confirm})});setMessage(r.message);setTimeout(onDone,900)}catch(e){setMessage(e.message)}finally{setSaving(false)}};return <div className="card card-body"><h5>Change Password</h5><form onSubmit={submit}><PasswordInput label="Current Password" value={current} onChange={setCurrent}/><PasswordInput label="New Password" value={next} onChange={setNext}/><small className="d-block text-muted mb-3">At least 8 characters, including uppercase, lowercase, and a number.</small><PasswordInput label="Confirm New Password" value={confirm} onChange={setConfirm}/>{message&&<div className={`alert ${message.startsWith('Password changed')?'alert-success':'alert-danger'} py-2`}>{message}</div>}<button className="btn btn-primary" disabled={saving}>{saving?'Changing Password...':'Change Password'}</button></form></div>}

function Attendance({ course, token, notify }) {
  const [data, setData] = useState(null), [week, setWeek] = useState(1), [day, setDay] = useState(1), [entries, setEntries] = useState({}), [dirty, setDirty] = useState(false), [startDate, setStartDate] = useState('');
  const load = async (targetWeek = week, targetDay = day) => {
    const result = await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/attendance`, token);
    setData(result);
    const w = Number(targetWeek) || 1, d = Number(targetDay) || 1;
    setEntries(Object.fromEntries((result.students || []).map(s => [s.roll, s.attendance?.[`w${w}d${d}`] || 'Present'])));
  };
  useEffect(() => { load().catch(e => notify(e.message, 'danger')); }, [course.course_code]);
  useEffect(() => {
    setStartDate('');
    setDirty(false);
    if (data?.students) {
      const w = Number(week) || 1, d = Number(day) || 1;
      setEntries(Object.fromEntries(data.students.map(s => [s.roll, s.attendance?.[`w${w}d${d}`] || 'Present'])));
    }
  }, [week, day]);
  if (!data) return <div className="spinner-border" />;
  const numWeek = Number(week) || 1, numDay = Number(day) || 1;
  const session = (data.sessions || []).find(s => s.week === numWeek && s.day === numDay) || {
    week: numWeek,
    day: numDay,
    date: '',
    class_held: false
  };
  const saveSession = async held => {
    try {
      await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/sessions`, token, {
        method: 'POST',
        body: JSON.stringify({
          week: numWeek,
          day: numDay,
          date: startDate || session.date || '',
          class_held: held,
          ...(startDate ? { course_start_date: startDate } : {})
        })
      });
      notify(held ? 'Class session confirmed.' : 'Session marked not held.');
      await load(numWeek, numDay);
    } catch (e) {
      notify(e.message, 'danger');
    }
  };
  const saveAttendance = async () => {
    try {
      if (!session.class_held) {
        await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/sessions`, token, {
          method: 'POST',
          body: JSON.stringify({
            week: numWeek,
            day: numDay,
            date: startDate || session.date || '',
            class_held: true,
            ...(startDate ? { course_start_date: startDate } : {})
          })
        });
      }
      await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/attendance`, token, {
        method: 'POST',
        body: JSON.stringify({
          week: numWeek,
          day: numDay,
          entries: (data.students || []).map(s => ({
            roll: s.roll,
            status: entries[s.roll] || 'Present'
          }))
        })
      });
      setDirty(false);
      notify(`Attendance saved successfully for Week ${numWeek}, Day ${numDay}.`);
      await load(numWeek, numDay);
    } catch (e) {
      notify(e.message, 'danger');
    }
  };
  return <>
    <div className="card mb-3">
      <div className="card-body row g-3 align-items-end">
        <div className="col-md-2">
          <label className="form-label">Week</label>
          <select className="form-select" value={week} onChange={e => { const v = parseInt(e.target.value, 10) || 1; setWeek(v); }}>
            {Array.from({ length: 13 }, (_, i) => <option key={i + 1} value={i + 1}>Week {i + 1}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <label className="form-label">Day</label>
          <select className="form-select" value={day} onChange={e => { const v = parseInt(e.target.value, 10) || 1; setDay(v); }}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Day {n}</option>)}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label">Actual class date</label>
          <input type="date" className="form-control" value={startDate || session.date || ''} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="col-md-5">
          <span className={`me-2 badge ${session.class_held ? 'text-bg-success' : 'text-bg-secondary'}`}>
            {session.class_held ? 'Class held' : 'Not held / holiday'}
          </span>
          <button className="btn btn-success btn-sm me-2" onClick={() => saveSession(true)}>Confirm class held</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => saveSession(false)}>Mark holiday</button>
        </div>
      </div>
    </div>
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between">
        <b>Quick attendance: Week {numWeek}, Day {numDay}</b>
        {dirty && <span className="text-warning">Unsaved changes</span>}
      </div>
      <div className="card-body p-0">
        <div className="quick-table">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>Select</th>
                <th>Roll</th>
                <th>Name</th>
                <th>Attendance Status</th>
              </tr>
            </thead>
            <tbody>
              {(data.students || []).map(s => {
                const isAbsent = entries[s.roll] === 'Absent';
                const toggle = () => {
                  setEntries({ ...entries, [s.roll]: isAbsent ? 'Present' : 'Absent' });
                  setDirty(true);
                };
                return (
                  <tr
                    key={s.roll}
                    className={isAbsent ? 'table-danger' : ''}
                    onClick={toggle}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={isAbsent}
                        onChange={toggle}
                        onClick={e => e.stopPropagation()}
                      />
                    </td>
                    <td>{s.roll}</td>
                    <td>{s.name}</td>
                    <td>
                      <span className={`badge ${isAbsent ? 'text-bg-danger' : 'text-bg-success'}`}>
                        {isAbsent ? 'Absent (A)' : 'Present (P)'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-3">
          <button className="btn btn-outline-primary me-2" onClick={() => { setEntries(Object.fromEntries((data.students || []).map(s => [s.roll, 'Present']))); setDirty(true); }}>Clear selections (All Present)</button>
          <button className="btn btn-outline-secondary me-2" onClick={() => { setEntries(Object.fromEntries((data.students || []).map(s => [s.roll, 'Absent']))); setDirty(true); }}>Select all (Mark Absent)</button>
          <button className="btn btn-primary" onClick={saveAttendance}>Save attendance</button>
        </div>
      </div>
    </div>
    <Spreadsheet students={data.students} />
  </>;
}
function Spreadsheet({ students }) { return <div className="card"><div className="card-header"><b>13-week attendance spreadsheet</b><small className="ms-2 text-muted">Only confirmed class sessions count in percentages.</small></div><div className="sheet"><table className="table table-bordered table-sm mb-0"><thead><tr><th rowSpan="2" className="sticky-roll">Roll</th><th rowSpan="2" className="sticky-name">Name</th>{Array.from({length:13},(_,i)=><th colSpan="5" key={i}>Week {i+1}</th>)}<th rowSpan="2">Present</th><th rowSpan="2">Absent</th><th rowSpan="2">Attendance %</th></tr><tr>{Array.from({length:65},(_,i)=><th key={i}>D{(i%5)+1}</th>)}</tr></thead><tbody>{(students || []).map(s=><tr key={s.roll}><td className="sticky-roll">{s.roll}</td><td className="sticky-name">{s.name}</td>{Array.from({length:65},(_,i)=><td key={i} className={s.attendance?.[`w${Math.floor(i/5)+1}d${(i%5)+1}`] === 'Present' ? 'present' : s.attendance?.[`w${Math.floor(i/5)+1}d${(i%5)+1}`] === 'Absent' ? 'absent' : ''}>{s.attendance?.[`w${Math.floor(i/5)+1}d${(i%5)+1}`] === 'Present' ? 'P' : s.attendance?.[`w${Math.floor(i/5)+1}d${(i%5)+1}`] === 'Absent' ? 'A' : ''}</td>)}<td>{s.present}</td><td>{s.absent}</td><td><Status value={s.attendance_status} /> {s.attendance_percentage}%</td></tr>)}</tbody></table></div></div> }

function ClassTests({ course, token, notify }) {
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const load = () => call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/class-tests`, token).then(d => setRows(d.students));
  useEffect(() => { load().catch(e => notify(e.message, 'danger')); }, [course.course_code]);

  const set = (roll, key, value) => {
    const val = String(value).trim();
    if (val === '') {
      setRows(rows.map(r => r.roll === roll ? { ...r, [key]: null } : r));
      setDirty(true);
    } else if (val.toUpperCase() === 'A') {
      setRows(rows.map(r => r.roll === roll ? { ...r, [key]: 'A' } : r));
      setDirty(true);
    } else {
      const num = Number(val);
      if (!isNaN(num) && num >= 0 && num <= 20) {
        setRows(rows.map(r => r.roll === roll ? { ...r, [key]: val } : r));
        setDirty(true);
      }
    }
  };

  const save = async () => {
    try {
      const results = rows.flatMap(r => [1, 2, 3, 4].filter(n => r[`ct${n}`] !== null && r[`ct${n}`] !== undefined && r[`ct${n}`] !== '').map(n => {
        const val = r[`ct${n}`];
        return {
          roll: r.roll,
          test_number: n,
          obtained_marks: String(val).toUpperCase() === 'A' ? 'A' : Number(val)
        };
      }));
      await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/class-tests`, token, {
        method: 'POST',
        body: JSON.stringify({ total_marks: 20, results })
      });
      setDirty(false);
      notify('Class-test marks saved.');
      load();
    } catch (e) {
      notify(e.message, 'danger');
    }
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between">
        <b>Class Tests (best 3 of 4)</b>
        {dirty && <span className="text-warning">Unsaved changes</span>}
      </div>
      <div className="table-responsive">
        <table className="table mb-0">
          <thead>
            <tr>
              <th>Roll</th>
              <th>Name</th>
              {[1, 2, 3, 4].map(n => <th key={n}>CT {n} / 20</th>)}
              <th>Best 3 Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const recorded = [1, 2, 3, 4]
                .map(n => r[`ct${n}`])
                .filter(v => v !== null && v !== undefined && v !== '')
                .map(v => (String(v).toUpperCase() === 'A' ? 0 : Number(v)))
                .filter(v => !isNaN(v));
              const top3 = recorded.sort((a, b) => b - a).slice(0, 3);
              const denom = recorded.length >= 3 ? 3 : top3.length;
              const avg = top3.length > 0 ? Math.ceil(top3.reduce((a, b) => a + b, 0) / denom) : '—';
              return (
                <tr key={r.roll}>
                  <td>{r.roll}</td>
                  <td>{r.name}</td>
                  {[1, 2, 3, 4].map(n => (
                    <td key={n}>
                      <input
                        type="text"
                        className="form-control form-control-sm marks"
                        value={r[`ct${n}`] ?? ''}
                        placeholder="0-20 or A"
                        onChange={e => set(r.roll, `ct${n}`, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="fw-bold">{avg}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="p-3">
        <button className="btn btn-primary" onClick={save}>Save class tests</button>
      </div>
    </div>
  );
}
function Performance({course,token,notify}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    setLoading(true);
    call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/performance`,token)
      .then(d=>setRows(d.students))
      .catch(e=>notify(e.message,'danger'))
      .finally(()=>setLoading(false));
  },[course.course_code]);
  return <div className="card shadow-sm"><div className="card-header bg-light"><b className="h6 mb-0">Performance and AI Risk Analysis</b></div>{loading?<div className="d-flex align-items-center gap-2 p-4 text-muted"><div className="spinner-border spinner-border-sm" role="status"/><span>Calculating performance and risk metrics...</span></div>:<div className="table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Roll</th><th>Name</th><th>Held</th><th>Present</th><th>Absent</th><th>Attendance</th><th>CT Avg</th><th>Assignment Avg</th><th>Overall</th><th>Risk</th></tr></thead><tbody>{rows.map(r=><tr key={r.roll}><td>{r.roll}</td><td>{r.name}</td><td>{r.classes_held}</td><td>{r.present}</td><td>{r.absent}</td><td>{r.attendance_percentage}%</td><td>{r.ct_best_3_average??'—'}</td><td>{r.assignment_average??'—'}</td><td>{r.overall_performance}%</td><td><Status value={r.risk_level}/></td></tr>)}</tbody></table></div>}</div>
}
function Assignments({ course, token, notify }) {
  const [items, setItems] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [grades, setGrades] = useState({});
  const [savingRoll, setSavingRoll] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/assignments`, token);
      const list = data.assignments || [];
      setItems(list);
      if (list.length > 0) {
        setSelectedAssignment(prev => {
          if (!prev) return list[0];
          const found = list.find(a => a.assignment_id === prev.assignment_id);
          return found || list[0];
        });
      } else {
        setSelectedAssignment(null);
      }
    } catch (e) {
      notify(e.message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [course.course_code]);

  useEffect(() => {
    if (selectedAssignment && selectedAssignment.submissions) {
      const initial = {};
      selectedAssignment.submissions.forEach(sub => {
        initial[sub.roll] = {
          marks: sub.marks !== null && sub.marks !== undefined ? sub.marks : '',
          feedback: sub.feedback || ''
        };
      });
      setGrades(initial);
    }
  }, [selectedAssignment]);

  const saveAssignment = async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const result = await submitForm(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/assignments`, token, form);
      notify(result.message || 'Assignment created/updated successfully.');
      e.currentTarget.reset();
      load();
    } catch (e) {
      notify(e.message, 'danger');
    }
  };

  const handleGradeChange = (roll, field, value) => {
    setGrades(prev => ({
      ...prev,
      [roll]: {
        ...prev[roll],
        [field]: value
      }
    }));
  };

  const saveMarks = async (roll) => {
    if (!selectedAssignment) return;
    const itemGrade = grades[roll] || {};
    const marksVal = itemGrade.marks;
    if (marksVal === '' || marksVal === null || isNaN(+marksVal)) {
      notify('Please enter valid marks.', 'warning');
      return;
    }
    const marksNum = +marksVal;
    if (marksNum < 0 || marksNum > selectedAssignment.total_marks) {
      notify(`Marks must be between 0 and ${selectedAssignment.total_marks}.`, 'warning');
      return;
    }
    try {
      setSavingRoll(roll);
      await call(
        `/api/teacher/courses/${encodeURIComponent(course.course_code)}/assignments/${selectedAssignment.assignment_id}/submissions/${roll}/grade`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            marks: marksNum,
            feedback: itemGrade.feedback || ''
          })
        }
      );
      notify(`Marks saved for Roll ${roll}.`);
      load();
    } catch (e) {
      notify(e.message, 'danger');
    } finally {
      setSavingRoll(null);
    }
  };

  const getFileUrl = (filename, isDownload = false) =>
    `${API}/api/assignments/files/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}${isDownload ? '&download=1' : ''}`;

  return (
    <>
      <form className="card card-body mb-4 shadow-sm" onSubmit={saveAssignment}>
        <h5 className="card-title mb-3 fw-bold">Create Assignment</h5>
        <div className="row g-3">
          <div className="col-md-4">
            <label className="form-label small text-muted">Assignment Title *</label>
            <input name="title" className="form-control" placeholder="Title" required />
          </div>
          <div className="col-md-2">
            <label className="form-label small text-muted">Assignment No. *</label>
            <select name="assignment_number" className="form-select" required defaultValue="">
              <option value="" disabled>Select</option>
              <option value="1">Assignment 1</option>
              <option value="2">Assignment 2</option>
              <option value="3">Assignment 3</option>
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted">Deadline *</label>
            <input name="deadline" type="date" className="form-control" required />
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted">Total Marks *</label>
            <input name="total_marks" type="number" step="0.5" className="form-control" defaultValue="10" required min="1" />
          </div>
          <div className="col-md-7">
            <label className="form-label small text-muted">Description / Instructions</label>
            <textarea name="description" className="form-control" rows="2" placeholder="Assignment instructions or description text..."></textarea>
          </div>
          <div className="col-md-5">
            <label className="form-label small text-muted">Reference / Assignment File (Optional)</label>
            <input name="ref_file" type="file" className="form-control" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png" />
          </div>
        </div>
        <div className="mt-3">
          <button className="btn btn-primary" disabled={items.length >= 3 && !selectedAssignment}>
            Create Assignment
          </button>
          {items.length >= 3 && <span className="ms-3 text-muted small">(Maximum 3 assignments reached for this course)</span>}
        </div>
      </form>

      <div className="card shadow-sm mb-4">
        <div className="card-header bg-light">
          <b className="h6 mb-0">Course Assignments ({items.length} / 3)</b>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="d-flex align-items-center gap-2 py-3 text-muted">
              <div className="spinner-border spinner-border-sm" role="status" />
              <span>Loading assignments...</span>
            </div>
          ) : !items.length ? (
            <p className="text-muted mb-0">No assignments created yet for this course.</p>
          ) : (
            <div className="nav nav-pills gap-2 mb-3">
              {items.map(a => (
                <button
                  key={a.assignment_id}
                  className={`nav-link ${selectedAssignment?.assignment_id === a.assignment_id ? 'active' : ''}`}
                  onClick={() => setSelectedAssignment(a)}
                >
                  Assignment {a.assignment_number}: {a.title}
                </button>
              ))}
            </div>
          )}

          {selectedAssignment && (
            <div className="border rounded p-3 bg-white">
              <div className="d-flex justify-content-between align-items-start border-bottom pb-2 mb-3">
                <div>
                  <h5 className="mb-1 text-primary fw-bold">Assignment {selectedAssignment.assignment_number}: {selectedAssignment.title}</h5>
                  {selectedAssignment.description && <p className="mb-1 text-secondary">{selectedAssignment.description}</p>}
                  <div className="small text-muted">
                    <span>Deadline: <b>{selectedAssignment.deadline}</b></span>
                    <span className="ms-3">Total Marks: <b>{selectedAssignment.total_marks}</b></span>
                  </div>
                </div>
                {selectedAssignment.ref_file_name && (
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => setPreviewFile({
                        title: `Reference File: ${selectedAssignment.title}`,
                        fileName: selectedAssignment.ref_file_name
                      })}
                    >
                      👁️ View Online
                    </button>
                    <a
                      href={getFileUrl(selectedAssignment.ref_file_name, true)}
                      className="btn btn-outline-secondary btn-sm"
                      download
                    >
                      📥 Download
                    </a>
                  </div>
                )}
              </div>

              <h6 className="fw-bold mb-3">Student Submissions</h6>
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: '10%' }}>Roll</th>
                      <th style={{ width: '18%' }}>Student Name</th>
                      <th style={{ width: '14%' }}>Submission</th>
                      <th style={{ width: '22%' }}>Text / File</th>
                      <th style={{ width: '14%' }}>Marks</th>
                      <th style={{ width: '14%' }}>Feedback</th>
                      <th style={{ width: '8%' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedAssignment.submissions || []).map(sub => {
                      const roll = sub.roll;
                      const currentGrade = grades[roll] || { marks: '', feedback: '' };
                      const isSubmitted = sub.status === 'Submitted' || sub.status === 'Graded';
                      
                      return (
                        <tr key={roll}>
                          <td className="fw-bold">{roll}</td>
                          <td>{sub.name}</td>
                          <td>
                            <Status value={sub.status === 'Graded' ? 'Good' : isSubmitted ? 'Low' : 'Warning'} />
                            <span className="ms-2 small">{sub.status}</span>
                            {sub.submitted_at && (
                              <small className="d-block text-muted">{new Date(sub.submitted_at).toLocaleString()}</small>
                            )}
                          </td>
                          <td>
                            {sub.text_answer && (
                              <div className="small bg-light p-1 rounded mb-1 text-break">
                                💬 {sub.text_answer}
                              </div>
                            )}
                            {sub.file_name ? (
                              <div className="d-flex gap-1 flex-wrap align-items-center">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary py-0 px-2"
                                  onClick={() => setPreviewFile({
                                    title: selectedAssignment.title,
                                    fileName: sub.file_name,
                                    roll: sub.roll,
                                    studentName: sub.name,
                                    textAnswer: sub.text_answer
                                  })}
                                >
                                  👁️ View Online
                                </button>
                                <a
                                  href={getFileUrl(sub.file_name, true)}
                                  className="btn btn-sm btn-outline-secondary py-0 px-2"
                                  download
                                >
                                  📥 Download
                                </a>
                              </div>
                            ) : sub.text_answer ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-info py-0 px-2"
                                onClick={() => setPreviewFile({
                                  title: selectedAssignment.title,
                                  fileName: null,
                                  roll: sub.roll,
                                  studentName: sub.name,
                                  textAnswer: sub.text_answer
                                })}
                              >
                                💬 Read Answer
                              </button>
                            ) : (
                              <span className="text-muted small">—</span>
                            )}
                          </td>
                          <td>
                            <div className="input-group input-group-sm" style={{ maxWidth: '120px' }}>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max={selectedAssignment.total_marks}
                                className="form-control"
                                value={currentGrade.marks}
                                onChange={e => handleGradeChange(roll, 'marks', e.target.value)}
                                placeholder="0"
                              />
                              <span className="input-group-text">/ {selectedAssignment.total_marks}</span>
                            </div>
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              placeholder="Feedback"
                              value={currentGrade.feedback}
                              onChange={e => handleGradeChange(roll, 'feedback', e.target.value)}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => saveMarks(roll)}
                              disabled={savingRoll === roll}
                            >
                              {savingRoll === roll ? 'Saving...' : 'Save Marks'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ONLINE FILE PREVIEW MODAL */}
      {previewFile && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1060 }} tabIndex="-1">
          <div className="modal-dialog modal-xl modal-dialog-centered">
            <div className="modal-content shadow-lg">
              <div className="modal-header bg-light">
                <h5 className="modal-title fw-bold text-truncate me-2" style={{ maxWidth: '80%' }}>
                  📄 {previewFile.title} {previewFile.roll ? `— ${previewFile.roll} (${previewFile.studentName})` : ''}
                </h5>
                <div className="d-flex align-items-center gap-2">
                  {previewFile.fileName && (
                    <a
                      href={getFileUrl(previewFile.fileName, true)}
                      className="btn btn-primary btn-sm"
                      download
                    >
                      📥 Download File
                    </a>
                  )}
                  <button type="button" className="btn-close" onClick={() => setPreviewFile(null)} aria-label="Close"></button>
                </div>
              </div>
              <div className="modal-body p-3">
                {previewFile.textAnswer && (
                  <div className="alert alert-info py-2 px-3 mb-3">
                    <b>Submitted Text Answer:</b>
                    <div className="mt-1 text-break">{previewFile.textAnswer}</div>
                  </div>
                )}
                {previewFile.fileName ? (
                  <div className="border rounded overflow-hidden bg-light" style={{ minHeight: '520px' }}>
                    {previewFile.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <div className="d-flex justify-content-center align-items-center bg-dark p-3" style={{ minHeight: '520px' }}>
                        <img
                          src={getFileUrl(previewFile.fileName, false)}
                          alt="Submission Preview"
                          style={{ maxHeight: '500px', objectFit: 'contain' }}
                        />
                      </div>
                    ) : (
                      <iframe
                        src={getFileUrl(previewFile.fileName, false)}
                        title="Document Preview"
                        style={{ width: '100%', height: '540px', border: 'none' }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-muted p-4 text-center">No file attached to this submission.</div>
                )}
              </div>
              <div className="modal-footer bg-light">
                {previewFile.fileName && (
                  <a
                    href={getFileUrl(previewFile.fileName, true)}
                    className="btn btn-primary btn-sm"
                    download
                  >
                    📥 Download File
                  </a>
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewFile(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function DataTable({headers,rows}){return <div className="card table-responsive"><table className="table table-hover mb-0"><thead><tr>{headers.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>)}{!rows.length&&<tr><td colSpan={headers.length} className="text-center text-muted py-4">No records found.</td></tr>}</tbody></table></div>}
function SeriesSemesterManager({series,semesters,token,onSaved}){const [selected,setSelected]=useState({});const [message,setMessage]=useState('');const save=async item=>{const semester=+(selected[item.series]??item.current_semester??1);try{const result=await call(`/api/admin/series/${item.series}/semester`,token,{method:'PUT',body:JSON.stringify({semester})});setMessage(result.message);onSaved();}catch(error){setMessage(error.message)}};return <><h1 className="h3">Semester Assignment</h1><p className="text-muted">Changing a series semester updates only that series' students and course enrollments.</p>{message&&<div className="alert alert-info">{message}</div>}<DataTable headers={['Series','Students','Current Semester','Change Semester','Action']} rows={series.map(item=>[item.series,item.student_count,item.current_semester??'Not set',<select className="form-select form-select-sm" value={selected[item.series]??item.current_semester??1} onChange={event=>setSelected({...selected,[item.series]:event.target.value})}>{semesters.map(semester=><option key={semester.semester} value={semester.semester}>Semester {semester.semester}</option>)}</select>,<button className="btn btn-sm btn-primary" onClick={()=>save(item)}>Save</button>])}/></>}
function StudentDashboard({auth,logout}){
  const [data,setData]=useState(null),[course,setCourse]=useState(null),[detail,setDetail]=useState(null),[notice,setNotice]=useState(''),[page,setPage]=useState('Dashboard');
  const studentCourses=Array.isArray(data?.courses)?data.courses:[];
  const load=async()=>{try{setData(await call('/api/student/dashboard',auth.token));}catch(e){setNotice(e.message||'Unable to load student information.')}};
  const open=async item=>{try{setCourse(item);const code=encodeURIComponent(item.course_code);const [overview,attendance,tests,assignments]=await Promise.all([call(`/api/student/courses/${code}`,auth.token),call(`/api/student/courses/${code}/attendance`,auth.token),call(`/api/student/courses/${code}/class-tests`,auth.token),call(`/api/student/courses/${code}/assignments`,auth.token)]);setDetail({...overview,attendanceData:attendance,testsData:tests,assignmentsData:assignments});}catch(e){setNotice(e.message);setCourse(null)}};
  useEffect(()=>{load()},[]);
  const submit=async(e,assignment)=>{e.preventDefault();const form=new FormData(e.currentTarget);try{const result=await submitForm(`/api/student/courses/${encodeURIComponent(course.course_code)}/assignments/${assignment.assignment_id}/submit`,auth.token,form);setNotice(result.message);await open(course);load();}catch(err){setNotice(err.message)}};
  const unsubmit=async(assignment)=>{if(!window.confirm(`Are you sure you want to remove your submission for Assignment ${assignment.assignment_number}?`))return;try{const result=await call(`/api/student/courses/${encodeURIComponent(course.course_code)}/assignments/${assignment.assignment_id}/unsubmit`,auth.token,{method:'DELETE'});setNotice(result.message);await open(course);load();}catch(err){setNotice(err.message)}};
  const finish=()=>{sessionStorage.removeItem('authToken');logout()};
  const nav=['Dashboard','My Courses','Profile','Change Password'];
  let body=<div className="spinner-border"/>;
  if(data&&!course&&page==='Profile')body=<div className="card card-body"><h1 className="h4">My Profile</h1><p className="mb-1"><b>Student ID:</b> {data.profile.student_id}</p><p className="mb-1"><b>Name:</b> {data.profile.name}</p><p className="mb-1"><b>Series:</b> {data.profile.series}</p><p className="mb-0"><b>Current Semester:</b> {data.profile.current_semester||data.profile.semester}</p></div>;
  else if(data&&!course&&page==='Change Password')body=<ChangePassword token={auth.token} onDone={finish}/>;
  else if(data&&!course)body=<><h1 className="h3">Welcome, {data.profile.name}</h1><div className="student-meta mb-4"><span>Student ID: <b>{data.profile.student_id}</b></span><span>Series: <b>{data.series}</b></span><span>Current Semester: <b>{data.semester}</b></span></div><h2 className="h4">My Courses</h2><div className="row g-3">{data.courses.map(item=><div className="col-md-6 col-xl-4" key={item.course_id}><div className="card course-card h-100"><div className="card-body d-flex flex-column"><span className="badge text-bg-primary align-self-start">{item.course_code}</span><h3 className="h5 mt-3">{item.course_name}</h3><p className="mb-1">Attendance: <b>{item.attendance.percentage}%</b> <Status value={item.attendance.status}/></p><p className="mb-1">CT Best 3: <b>{item.class_tests.best_3_average??'—'}/20</b></p><p>Assignments: <b>{item.assignments.submitted}/{item.assignments.total} Submitted</b></p><button className="btn btn-outline-primary mt-auto" onClick={()=>open(item)}>View Course</button></div></div></div>)}</div></>;
  else if(detail)body=<><button className="btn btn-link px-0 mb-2" onClick={()=>{setCourse(null);setDetail(null)}}>← My Courses</button><h1 className="h3">{course.course_code}</h1><p className="text-muted">{course.course_name} · Series {detail.series} · Semester {detail.semester}</p><div className="row g-3"><div className="col-lg-6"><section className="card h-100"><div className="card-body"><h2 className="h5">Attendance</h2><div className="display-6">{detail.attendance.percentage}%</div><p>{detail.attendance.present} Present / {detail.attendance.total_classes_held} Classes Held <Status value={detail.attendance.status}/></p><DataTable headers={['Week','Day','Date','Status']} rows={detail.attendanceData.details.map(x=>[x.week,x.day,x.date,x.status])}/></div></section></div><div className="col-lg-6"><section className="card h-100"><div className="card-body"><h2 className="h5">Class Test Marks</h2><DataTable headers={['Test','Marks']} rows={detail.testsData.tests.map(x=>[x.label,x.obtained_marks===null?'—':`${x.obtained_marks}/${x.total_marks}`])}/><p className="mt-3 mb-0">Best 3 Average: <b>{detail.testsData.best_3_average??'—'} / 20</b></p></div></section></div></div><section className="card mt-3"><div className="card-body"><h2 className="h5">Assignments</h2>{detail.assignmentsData.assignments.map(a=><div className="assignment-item border rounded p-3 mb-3" key={a.assignment_id}><div className="d-flex justify-content-between align-items-start"><div><b className="h6 mb-1 d-block">Assignment {a.assignment_number}: {a.title}</b>{a.description&&<p className="small text-muted mb-1">{a.description}</p>}<div className="small text-secondary">Deadline: <b>{a.deadline}</b> · Total Marks: <b>{a.total_marks}</b></div></div>{a.ref_file_name&&<a href={`${API}/api/assignments/files/${encodeURIComponent(a.ref_file_name)}?token=${encodeURIComponent(auth.token)}`} target="_blank" rel="noreferrer" className="btn btn-outline-info btn-sm">📎 Reference File</a>}</div><div className="mt-2 pt-2 border-top"><div>Status: <Status value={a.submission_status==='Not Submitted'?'Warning':a.submission_status==='Graded'?'Good':'Low'}/> <b>{a.submission_status}</b>{a.marks!==null&&a.marks!==undefined?<span className="ms-2 fw-bold text-success">Marks: {a.marks} / {a.total_marks}</span>:a.submission_status==='Submitted'?<span className="ms-2 text-muted">Marks: Pending</span>:null}</div>{a.feedback&&<div className="alert alert-success py-1 px-2 mt-2 mb-1 small">💬 <b>Teacher Feedback:</b> {a.feedback}</div>}{a.text_answer&&<div className="small bg-light p-2 rounded mt-2"><b>Your Submitted Text:</b> {a.text_answer}</div>}{a.file_name&&<div className="mt-2"><a href={`${API}/api/assignments/files/${encodeURIComponent(a.file_name)}?token=${encodeURIComponent(auth.token)}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">📄 View Your Submitted File</a></div>}{a.submission_status==='Not Submitted'?(<form className="mt-3 p-3 bg-light rounded" onSubmit={e=>submit(e,a)}><label className="form-label small fw-bold">Submit Answer / Solution</label><textarea name="text_answer" className="form-control mb-2" rows="2" placeholder="Text answer (optional if uploading a file)"/><label className="form-label small text-muted">Upload Submission File</label><input name="file" type="file" className="form-control mb-2" accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.jpg,.jpeg,.png"/><button className="btn btn-primary btn-sm">Submit Assignment</button></form>):(a.submission_status!=='Graded'&&<button className="btn btn-outline-danger btn-sm mt-2" onClick={()=>unsubmit(a)}>Remove / Delete Submission</button>)}</div></div>)}</div></section></>;
  return <div className="app"><header><b>Continuous Assessment & Academic Performance Evaluation · Student Panel</b><button className="btn btn-sm btn-outline-light" onClick={finish}>Logout</button></header><div className="course-layout"><aside><b>STUDENT PANEL</b>{nav.map(item=><button key={item} className={page===item&&!course?'active':''} onClick={()=>{setPage(item);setCourse(null);setDetail(null)}}>{item}</button>)}<button onClick={finish}>Logout</button></aside><main className="course-main">{notice&&<div className="alert alert-info alert-dismissible">{notice}<button className="btn-close" onClick={()=>setNotice('')}/></div>}{body}</main></div></div>;
}
function AdminDashboard({auth,logout}){const [page,setPage]=useState('Dashboard'),[data,setData]=useState({}),[notice,setNotice]=useState(''),[search,setSearch]=useState('');const load=async()=>{try{const p=['dashboard','students','teachers','series','semesters','courses','course-assignments','users'],r=await Promise.all(p.map(x=>call(`/api/admin/${x}`,auth.token)));setData(Object.fromEntries(p.map((x,i)=>[x,r[i]])))}catch(e){setNotice(e.message)}};useEffect(()=>{load()},[]);const series=data.series?.series||[],semesters=data.semesters?.semesters||[],courses=data.courses?.courses||[],teachers=data.teachers?.teachers||[];const assign=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));try{await call('/api/admin/course-assignments',auth.token,{method:'POST',body:JSON.stringify({...f,series:+f.series,semester:+f.semester})});setNotice('Course assigned successfully.');load()}catch(x){setNotice(x.message)}};const unassign=async a=>{if(window.confirm(`Are you sure you want to unassign ${a.teacher_code} from ${a.course_code}?`)){await call(`/api/admin/course-assignments/${a.assignment_id}`,auth.token,{method:'DELETE'});setNotice('Course unassigned successfully.');load()}};const toggle=async u=>{await call(`/api/admin/users/${u.username}`,auth.token,{method:'PUT',body:JSON.stringify({status:u.status==='active'?'inactive':'active'})});load()};const nav=['Dashboard','Students','Teachers','Series','Semesters','Courses','Course Assignment','User Management','Profile'];let body=page==='Dashboard'?<><h1 className="h3">Admin Dashboard</h1><p>Welcome, {auth.profile.name||'Administrator'}</p><div className="row g-3 mb-4">{[['Students',data.dashboard?.students],['Teachers',data.dashboard?.teachers],['Series',data.dashboard?.series],['Semesters',data.dashboard?.semesters],['Courses',data.dashboard?.courses]].map(x=><div className="col" key={x[0]}><div className="card card-body"><small>{x[0]}</small><b className="display-6">{x[1]??'—'}</b></div></div>)}</div><div className="card card-body">Current Academic Session: Series <b>{data.dashboard?.current_series}</b> · Semester <b>{data.dashboard?.current_semester}</b><hr/>Course assignments: {data.dashboard?.assigned_courses||0} assigned · {data.dashboard?.unassigned_courses||0} unassigned</div></>:page==='Students'?<><h1 className="h3">Students</h1><input className="form-control mb-3" placeholder="Search roll or name" onChange={e=>setSearch(e.target.value)}/><DataTable headers={['Roll','Name','Series','Semester','Email','Status']} rows={(data.students?.students||[]).filter(x=>`${x.roll} ${x.name}`.toLowerCase().includes(search.toLowerCase())).map(x=>[x.roll,x.name,x.series,x.semester,x.email||'—',x.status||'active'])}/></>:page==='Teachers'?<><h1 className="h3">Teachers</h1><DataTable headers={['ID','Name','Email','Assigned Courses','Status']} rows={teachers.map(x=>[x.teacher_id,x.name,x.email||'—',x.assigned_courses,x.status||'active'])}/></>:page==='Series'?<><h1 className="h3">Series</h1><DataTable headers={['Series','Students','Status']} rows={series.map(x=>[x.series,x.student_count,x.status])}/></>:page==='Semesters'?<><h1 className="h3">Semesters</h1><DataTable headers={['Semester','Status']} rows={semesters.map(x=>[x.semester,x.status])}/></>:page==='Courses'?<><h1 className="h3">Courses</h1><DataTable headers={['Code','Name','Series','Semester','Type','Assigned Teacher']} rows={courses.map(x=>[x.course_code,x.course_name,x.series,x.semester,x.course_type,x.assigned_teacher?`${x.assigned_teacher.teacher_id} - ${x.assigned_teacher.name}`:'Unassigned'])}/></>:page==='Course Assignment'?<><h1 className="h3">Course Assignment</h1><form className="card card-body mb-4" onSubmit={assign}><div className="row g-2"><select className="form-select col" name="series">{series.map(x=><option key={x.series}>{x.series}</option>)}</select><select className="form-select col" name="semester">{semesters.map(x=><option key={x.semester}>{x.semester}</option>)}</select><select className="form-select col" name="course_id">{courses.map(x=><option key={x.course_id} value={x.course_id}>{x.course_code} — {x.course_name}</option>)}</select><select className="form-select col" name="teacher_id">{teachers.map(x=><option key={x.teacher_id} value={x.teacher_id}>{x.teacher_id} — {x.name}</option>)}</select></div><button className="btn btn-primary mt-3">Assign Course</button></form><DataTable headers={['Course','Series','Semester','Type','Assigned Teacher','Action']} rows={(data['course-assignments']?.assignments||[]).map(x=>[x.course_code,x.series,x.semester,x.course_type,`${x.teacher_code} - ${x.teacher_name}`,<button className="btn btn-sm btn-outline-danger" onClick={()=>unassign(x)}>Unassign</button>])}/></>:page==='User Management'?<><h1 className="h3">User Management</h1><DataTable headers={['User ID','Role','Status','Action']} rows={(data.users?.users||[]).map(x=>[x.username,x.role,x.status,<button className="btn btn-sm btn-outline-primary" onClick={()=>toggle(x)}>{x.status==='active'?'Deactivate':'Activate'}</button>])}/></>:<ChangePassword token={auth.token} onDone={logout}/>;return <div className="app"><header><b>Continuous Assessment & Academic Performance Evaluation · Admin Panel</b><button className="btn btn-sm btn-outline-light" onClick={logout}>Logout</button></header><div className="course-layout"><aside><b>ADMIN PANEL</b>{nav.map(x=><button key={x} className={page===x?'active':''} onClick={()=>setPage(x)}>{x}</button>)}<button onClick={logout}>Logout</button></aside><main className="course-main">{notice&&<div className="alert alert-info">{notice}</div>}{body}</main></div></div>}
function StudentDashboardFallback({auth,logout}){
  const [dashboard,setDashboard]=useState(null),[message,setMessage]=useState('');
  useEffect(()=>{call('/api/student/dashboard',auth.token).then(setDashboard).catch(error=>setMessage(error.message||'Unable to load student information.'));},[auth.token]);
  const finish=()=>{sessionStorage.removeItem('authToken');logout();};
  const profile=dashboard?.profile||auth.profile||{};
  const courses=Array.isArray(dashboard?.courses)?dashboard.courses:[];
  return <div className="app"><header><b>Continuous Assessment & Academic Performance Evaluation · Student Panel</b><button className="btn btn-sm btn-outline-light" onClick={finish}>Logout</button></header><div className="course-layout"><aside><b>STUDENT PANEL</b><button className="active">Dashboard</button><button>My Courses</button><button>Profile</button><button>Change Password</button><button onClick={finish}>Logout</button></aside><main className="course-main">{message&&<div className="alert alert-danger">{message}</div>}{!dashboard?<div className="spinner-border" role="status"/>:<><h1 className="h3">Welcome, {profile.name||'Student'}</h1><div className="student-meta mb-4"><span>Student ID: <b>{profile.student_id||profile.roll||'—'}</b></span><span>Series: <b>{dashboard.series??profile.series??'—'}</b></span><span>Current Semester: <b>{dashboard.semester??profile.current_semester??profile.semester??'—'}</b></span></div>{!Array.isArray(dashboard.courses)&&<div className="alert alert-warning">The backend is still running the old version. Restart <code>app.py</code> to load student courses.</div>}<h2 className="h4">My Courses</h2><div className="row g-3">{courses.map(course=><div className="col-md-6 col-xl-4" key={course.course_id}><div className="card course-card h-100"><div className="card-body"><span className="badge text-bg-primary">{course.course_code}</span><h3 className="h5 mt-3">{course.course_name}</h3><p className="mb-1">Attendance: <b>{course.attendance?.percentage??0}%</b></p><p className="mb-1">CT Best 3: <b>{course.class_tests?.best_3_average??'—'}/20</b></p><p className="mb-0">Assignments: <b>{course.assignments?.submitted??0}/{course.assignments?.total??3} Submitted</b></p></div></div></div>)}</div>{Array.isArray(dashboard.courses)&&!courses.length&&<p className="text-muted mt-3">No courses are assigned to your current semester.</p>}</>}</main></div></div>;
}
function App(){const [auth,setAuth]=useState(null),[courses,setCourses]=useState([]),[course,setCourse]=useState(null),[tab,setTab]=useState('Attendance'),[notice,setNotice]=useState(null);const notify=(message,type='success')=>setNotice({message,type});const logout=async()=>{if(auth)await call('/api/auth/logout',auth.token,{method:'POST'});setAuth(null);setCourse(null)};useEffect(()=>{if(auth?.role==='teacher')call('/api/teacher/courses',auth.token).then(d=>setCourses(d.courses)).catch(e=>notify(e.message,'danger'))},[auth]);if(!auth)return <Login onLogin={setAuth}/>;if(auth.role==='student')return <StudentDashboard auth={auth} logout={logout}/>;if(auth.role==='admin')return <SemesterAdminDashboard auth={auth} logout={logout}/>;if(!course)return <div className="app"><header><div><b>Continuous Assessment & Academic Evaluation</b><span className="ms-3 text-muted">Welcome, {auth.profile.name}</span></div><button className="btn btn-sm btn-outline-light" onClick={logout}>Logout</button></header><main className="container py-4"><h1 className="h3">Currently Teaching Courses</h1><div className="row g-3">{courses.map(c=><div className="col-md-6" key={c.course_id}><button className="course-card card w-100 text-start" onClick={()=>setCourse(c)}><div className="card-body"><span className="badge text-bg-primary">{c.course_code}</span><h2 className="h5 mt-2">{c.course_name}</h2><p className="mb-1">{c.course_type} · {c.series} Series · Semester {c.semester}</p></div></button></div>)}</div></main></div>;return <div className="app"><header><div><b>Continuous Assessment & Academic Evaluation</b><span className="ms-3">{course.course_code} — {course.course_name}</span></div><button className="btn btn-sm btn-outline-light" onClick={()=>setCourse(null)}>My courses</button></header><div className="course-layout"><aside><b>Teacher menu</b>{['Dashboard','My Courses','Attendance','Class Tests','Assignments','Performance','Reports','Profile'].map(x=><button key={x} className={tab===x?'active':''} onClick={()=>x==='My Courses'?setCourse(null):setTab(x)}>{x}</button>)}<button onClick={logout}>Logout</button></aside><main className="course-main">{notice&&<div className={`alert alert-${notice.type} alert-dismissible`}>{notice.message}<button className="btn-close" onClick={()=>setNotice(null)}/></div>}<nav className="nav nav-tabs mb-3">{['Attendance','Class Tests','Assignments','Performance','Reports'].map(x=><button key={x} className={`nav-link ${tab===x?'active':''}`} onClick={()=>setTab(x)}>{x}</button>)}</nav>{tab==='Attendance'&&<Attendance course={course} token={auth.token} notify={notify}/>} {tab==='Class Tests'&&<ClassTests course={course} token={auth.token} notify={notify}/>} {tab==='Assignments'&&<Assignments course={course} token={auth.token} notify={notify}/>} {tab==='Performance'&&<Performance course={course} token={auth.token} notify={notify}/>} {tab==='Reports'&&<div className="card card-body">Reports are available through the authenticated report API.</div>}</main></div></div>}
function SimpleDashboard({title,profile,items,logout}){const [change,setChange]=useState(false);const finish=()=>{sessionStorage.removeItem('authToken');logout()};return <div className="app"><header><b>Continuous Assessment & Academic Evaluation</b><button className="btn btn-sm btn-outline-light" onClick={finish}>Logout</button></header><main className="container py-4"><h1 className="h3">{title}</h1><p>Welcome, {profile.name||profile.username}</p><button className="btn btn-outline-primary mb-3" onClick={()=>setChange(!change)}>Change Password</button>{change&&<ChangePassword token={sessionStorage.getItem('authToken')} onDone={finish}/>}<div className="row g-2">{items.map(item=><div className="col-md-4" key={item}><div className="card card-body">{item}</div></div>)}</div></main></div>}
function SemesterAdminDashboard({auth,logout}) {
  const [page,setPage]=useState('Dashboard'),[data,setData]=useState({}),[semester,setSemester]=useState('6'),[courses,setCourses]=useState([]),[loading,setLoading]=useState(false),[courseError,setCourseError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState('');
  const load=async()=>{try{const paths=['dashboard','students','teachers','series','semesters','course-assignments','users'];const values=await Promise.all(paths.map(x=>call(`/api/admin/${x}`,auth.token)));setData(Object.fromEntries(paths.map((x,i)=>[x,values[i]])))}catch(e){setNotice(e.message)}};
  const loadCourses=async value=>{if(!value){setCourses([]);return}setLoading(true);setCourseError('');try{const result=await call(`/api/admin/courses?semester=${value}`,auth.token);setCourses(result.courses)}catch(e){setCourses([]);setCourseError('Failed to load courses. Please try again.')}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);useEffect(()=>{loadCourses(semester)},[semester]);
  const series=data.series?.series||[], semesters=data.semesters?.semesters||[], teachers=data.teachers?.teachers||[];
  const assign=async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.target));try{await call('/api/admin/course-assignments',auth.token,{method:'POST',body:JSON.stringify({...form,series:+form.series,semester:+form.semester})});setNotice('Course assigned successfully.');load();loadCourses(semester)}catch(err){setNotice(err.message)}};
  const unassign=async item=>{if(!window.confirm(`Are you sure you want to unassign ${item.teacher_code} from ${item.course_code}?`))return;try{await call(`/api/admin/course-assignments/${item.assignment_id}`,auth.token,{method:'DELETE'});setNotice('Course unassigned successfully.');load();loadCourses(semester)}catch(e){setNotice(e.message)}};
  const toggleUser = async (id, currentStatus) => {
    try {
      const target = typeof id === 'string' ? id : (id.username || id.roll || id.student_id);
      const st = currentStatus || (typeof id === 'object' ? id.status : 'active');
      const nextStatus = st === 'active' ? 'inactive' : 'active';
      await call(`/api/admin/users/${target}`, auth.token, { method: 'PUT', body: JSON.stringify({ status: nextStatus }) });
      setNotice(`User ${target} status updated to ${nextStatus}.`);
      load();
    } catch(e) { setNotice(e.message); }
  };
  const semesterPicker=<select className="form-select" value={semester} onChange={e=>setSemester(e.target.value)}><option value="">Select Semester</option>{semesters.map(s=><option key={s.semester} value={s.semester}>Semester {s.semester}</option>)}</select>;
  const courseRows=courses.map(c=>[c.course_code,c.course_name,`Semester ${c.semester}`,c.course_type,c.credits??'—',c.assigned_teacher?`${c.assigned_teacher.teacher_id} - ${c.assigned_teacher.name}`:'Unassigned',c.status||'active','—']);
  let body;
  if(page==='Dashboard') body=<><h1 className="h3">Admin Dashboard</h1><p>Welcome, {auth.profile.name||'Administrator'}</p><div className="row g-3 mb-4">{[['Students',data.dashboard?.students],['Teachers',data.dashboard?.teachers],['Series',data.dashboard?.series],['Semesters',data.dashboard?.semesters],['Courses',data.dashboard?.courses]].map(([label,value])=><div className="col" key={label}><div className="card card-body"><small>{label}</small><b className="display-6">{value??'—'}</b></div></div>)}</div><div className="card card-body">Current Academic Session: Series <b>{data.dashboard?.current_series}</b> · Semester <b>{data.dashboard?.current_semester}</b><hr/>Course catalog: <b>40 courses</b> · <b>8 semesters</b> · <b>5 courses per semester</b></div></>;
  else if(page==='Students') body=<><h1 className="h3">Students</h1><input className="form-control mb-3" placeholder="Search roll or name" onChange={e=>setSearch(e.target.value)}/><DataTable headers={['Roll','Name','Series','Semester','Email','Status','Action']} rows={(data.students?.students||[]).filter(s=>`${s.roll} ${s.name}`.toLowerCase().includes(search.toLowerCase())).map(s=>[s.roll,s.name,s.series,s.semester,s.email||'—',<Status value={s.status||'active'}/>,<button className={`btn btn-sm ${s.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`} onClick={()=>toggleUser(s.roll||s.student_id,s.status)}>{s.status==='inactive'?'Activate':'Deactivate'}</button>])}/></>;
  else if(page==='Teachers') body=<><h1 className="h3">Teachers</h1><DataTable headers={['ID','Name','Email','Assigned Courses','Status','Action']} rows={teachers.map(t=>[t.teacher_id,t.name,t.email||'—',t.assigned_courses,<Status value={t.status||'active'}/>,<button className={`btn btn-sm ${t.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`} onClick={()=>toggleUser(t.teacher_id,t.status)}>{t.status==='inactive'?'Activate':'Deactivate'}</button>])}/></>;
  else if(page==='Semester Assignment') body=<SeriesSemesterManager series={series} semesters={semesters} token={auth.token} onSaved={load}/>;
  else if(page==='Courses') body=<><h1 className="h3">Course Management</h1><label className="form-label">Select Semester</label><div className="col-md-4 mb-3">{semesterPicker}</div>{semester&&<p className="text-muted">Selected Semester: Semester {semester} · Total Courses: {courses.length}</p>}{loading?<div className="spinner-border"/>:courseError?<div className="alert alert-danger">{courseError}</div>:!semester?<div className="alert alert-info">Select a semester to view its courses.</div>:<DataTable headers={['Course Code','Course Name','Semester','Type','Credits','Assigned Teacher','Status','Actions']} rows={courseRows}/>}</>;
  else if(page==='Course Assignment') body=<><h1 className="h3">Course Assignment</h1><form className="card card-body mb-4" onSubmit={assign}><div className="row g-3"><div className="col-md-3"><label className="form-label">Select Series</label><select className="form-select" name="series">{series.map(s=><option key={s.series}>{s.series}</option>)}</select></div><div className="col-md-3"><label className="form-label">Select Semester</label>{semesterPicker}</div><div className="col-md-3"><label className="form-label">Select Course</label><select className="form-select" name="course_id" required disabled={!courses.length}>{courses.map(c=><option key={c.course_id} value={c.course_id}>{c.course_code} — {c.course_name}</option>)}</select></div><div className="col-md-3"><label className="form-label">Select Teacher</label><select className="form-select" name="teacher_id">{teachers.map(t=><option key={t.teacher_id} value={t.teacher_id}>{t.teacher_id} — {t.name}</option>)}</select></div></div><input type="hidden" name="semester" value={semester}/><button className="btn btn-primary mt-3" disabled={!courses.length}>Assign Course</button></form><DataTable headers={['Course','Series','Semester','Type','Assigned Teacher','Action']} rows={(data['course-assignments']?.assignments||[]).map(a=>[a.course_code,a.series,a.semester,a.course_type,`${a.teacher_code} - ${a.teacher_name}`,<button className="btn btn-sm btn-outline-danger" onClick={()=>unassign(a)}>Unassign</button>])}/></>;
  else if(page==='User Management') body=<><h1 className="h3">User Management</h1><h2 className="h5 mt-4">Teacher Accounts</h2><DataTable headers={['Teacher ID','Status','Action']} rows={(data.users?.users||[]).filter(u=>u.role==='teacher').map(u=>[u.username,<Status value={u.status}/>,<button className={`btn btn-sm ${u.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`} onClick={()=>toggleUser(u.username,u.status)}>{u.status==='active'?'Deactivate':'Activate'}</button>])}/><h2 className="h5 mt-4">Student Accounts</h2><input className="form-control mb-3" placeholder="Search student ID or roll..." onChange={e=>setSearch(e.target.value)}/><DataTable headers={['User ID','Role','Status','Action']} rows={(data.users?.users||[]).filter(u=>u.role==='student' && u.username.toLowerCase().includes(search.toLowerCase())).map(u=>[u.username,u.role,<Status value={u.status}/>,<button className={`btn btn-sm ${u.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`} onClick={()=>toggleUser(u.username,u.status)}>{u.status==='active'?'Deactivate':'Activate'}</button>])}/></>;
  else body=<ChangePassword token={auth.token} onDone={logout}/>;
  const nav=['Dashboard','Students','Teachers','Semester Assignment','Courses','Course Assignment','User Management','Profile'];
  return <div className="app"><header><b>Continuous Assessment & Academic Performance Evaluation · Admin Panel</b><button className="btn btn-sm btn-outline-light" onClick={logout}>Logout</button></header><div className="course-layout"><aside><b>ADMIN PANEL</b>{nav.map(x=><button key={x} className={page===x?'active':''} onClick={()=>setPage(x)}>{x}</button>)}<button onClick={logout}>Logout</button></aside><main className="course-main">{notice&&<div className="alert alert-info">{notice}</div>}{body}</main></div></div>;
}
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('ErrorBoundary caught an error:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="container py-5 text-center">
          <div className="alert alert-danger shadow-sm p-4">
            <h4 className="alert-heading">Something went wrong</h4>
            <p className="mb-3">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button className="btn btn-outline-danger" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<ErrorBoundary><App/></ErrorBoundary>);
