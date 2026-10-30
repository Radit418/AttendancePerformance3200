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
/**
 * Fetches a file via the API (with Bearer auth) and opens it as a blob:// URL
 * in a new browser tab. blob:// URLs are NOT intercepted by IDM / download managers.
 */
const viewFileInBrowser = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load file (${response.status})`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');
    // Revoke after 60 s so memory is freed
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    if (!win) alert('Please allow popups for this site to view files online.');
  } catch (err) {
    alert(`Could not open file: ${err.message}`);
  }
};
const Status = ({ value }) => <span className={`badge ${value === 'Good' || value === 'Low' ? 'text-bg-success' : value === 'Warning' || value === 'Medium' ? 'text-bg-warning' : 'text-bg-danger'}`}>{value}</span>;
function PasswordInput({label,value,onChange}){const [visible,setVisible]=useState(false);return <><label className="form-label">{label}</label><div className="input-group mb-3"><input className="form-control" type={visible?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} required/><button type="button" className="btn btn-outline-secondary" aria-label={visible?'Hide password':'Show password'} onClick={()=>setVisible(!visible)}>{visible?'Hide':'Show'}</button></div></>}

function Login({ onLogin }) {
  const [role, setRole] = useState('student'), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [message, setMessage] = useState('');
  const chooseRole = value => { setRole(value); setUsername(''); setPassword(''); };
  const submit = async e => { e.preventDefault(); try { setMessage(''); const result=await call('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ role, username, password }) }); sessionStorage.setItem('authToken',result.token); onLogin(result); } catch (err) { setMessage(err.message); } };
  return <main className="login-shell"><form className="card shadow-sm login-card" onSubmit={submit}><div className="card-body p-4"><p className="text-primary fw-bold mb-1">CONTINUOUS ASSESSMENT AND</p><h1 className="h3">Academic Performance Evaluation System</h1><label className="form-label">User Type</label><select className="form-select mb-3" value={role} onChange={e=>chooseRole(e.target.value)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select><label className="form-label">User ID</label><input className="form-control mb-3" value={username} onChange={e => setUsername(e.target.value)} required /><PasswordInput label="Password" value={password} onChange={setPassword}/>{message && <div className="alert alert-danger py-2">{message}</div>}<button className="btn btn-primary w-100">Login</button></div></form></main>;
}
function ChangePassword({token,onDone}){const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);const submit=async e=>{e.preventDefault();if(next!==confirm){setMessage('New passwords do not match.');return}try{setSaving(true);setMessage('');const r=await call('/api/auth/change-password',token,{method:'POST',body:JSON.stringify({current_password:current,new_password:next,confirm_password:confirm})});setMessage(r.message);setTimeout(onDone,900)}catch(e){setMessage(e.message)}finally{setSaving(false)}};return <div className="card card-body"><h5>Change Password</h5><form onSubmit={submit}><PasswordInput label="Current Password" value={current} onChange={setCurrent}/><PasswordInput label="New Password" value={next} onChange={setNext}/><small className="d-block text-muted mb-3">At least 8 characters, including uppercase, lowercase, and a number.</small><PasswordInput label="Confirm New Password" value={confirm} onChange={setConfirm}/>{message&&<div className={`alert ${message.startsWith('Password changed')?'alert-success':'alert-danger'} py-2`}>{message}</div>}<button className="btn btn-primary" disabled={saving}>{saving?'Changing Password...':'Change Password'}</button></form></div>}

function Attendance({ course, token, notify }) {
  const [data, setData] = useState(null);
  const [week, setWeek] = useState(1);
  const [day, setDay] = useState(1);
  const [entries, setEntries] = useState({});
  const [dirty, setDirty] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const numWeek = Number(week) || 1;
  const numDay = Number(day) || 1;

  const applyAttendanceData = (result, targetWeek = numWeek, targetDay = numDay) => {
    setData(result);
    const w = Number(targetWeek) || 1;
    const d = Number(targetDay) || 1;
    const currentSession = (result.sessions || []).find(s => s.week === w && s.day === d);
    const isHeld = Boolean(currentSession && currentSession.class_held);

    if (!isHeld) {
      // Holiday / not held session: records remain blank
      setEntries({});
    } else {
      const key = `w${w}d${d}`;
      const hasSaved = (result.students || []).some(s => s.attendance?.[key] === 'Present' || s.attendance?.[key] === 'Absent');
      if (hasSaved) {
        setEntries(Object.fromEntries((result.students || []).map(s => [s.roll, s.attendance?.[key] || 'Present'])));
      } else {
        setEntries(Object.fromEntries((result.students || []).map(s => [s.roll, 'Present'])));
      }
    }
    setDirty(false);
    setIsEditing(false);
  };

  const load = async (targetWeek = numWeek, targetDay = numDay) => {
    const result = await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/attendance`, token);
    applyAttendanceData(result, targetWeek, targetDay);
  };

  useEffect(() => {
    load().catch(e => notify(e.message, 'danger'));
  }, [course.course_code]);

  useEffect(() => {
    setStartDate('');
    setDirty(false);
    setIsEditing(false);
    if (data?.students) {
      const currentSession = (data.sessions || []).find(s => s.week === numWeek && s.day === numDay);
      const isHeld = Boolean(currentSession && currentSession.class_held);
      if (!isHeld) {
        setEntries({});
      } else {
        const key = `w${numWeek}d${numDay}`;
        const hasSaved = data.students.some(s => s.attendance?.[key] === 'Present' || s.attendance?.[key] === 'Absent');
        if (hasSaved) {
          setEntries(Object.fromEntries(data.students.map(s => [s.roll, s.attendance?.[key] || 'Present'])));
        } else {
          setEntries(Object.fromEntries(data.students.map(s => [s.roll, 'Present'])));
        }
      }
    }
  }, [week, day]);

  if (!data) return <div className="spinner-border text-primary my-4" />;

  const session = (data.sessions || []).find(s => s.week === numWeek && s.day === numDay) || {
    week: numWeek,
    day: numDay,
    date: '',
    class_held: false
  };

  const isConfirmed = Boolean(session.class_held);
  const sessionKey = `w${numWeek}d${numDay}`;
  const hasSavedAttendance = Boolean(isConfirmed && (data.students || []).some(s => s.attendance?.[sessionKey] === 'Present' || s.attendance?.[sessionKey] === 'Absent'));

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
      notify(held ? `Week ${numWeek}, Day ${numDay} confirmed as class held.` : `Week ${numWeek}, Day ${numDay} marked as Holiday. Attendance disabled & cleared.`);
      await load(numWeek, numDay);
    } catch (e) {
      notify(e.message, 'danger');
    }
  };

  const saveAttendance = async () => {
    if (!isConfirmed) {
      notify('Attendance cannot be submitted for a holiday session.', 'danger');
      return;
    }
    try {
      setSaving(true);
      const res = await call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/attendance`, token, {
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
      setIsEditing(false);
      notify(`Attendance saved successfully for Week ${numWeek}, Day ${numDay}.`);
      if (res && res.sessions && res.students) {
        applyAttendanceData(res, numWeek, numDay);
      } else {
        await load(numWeek, numDay);
      }
    } catch (e) {
      notify(e.message, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const isAttendanceInteractive = isConfirmed && (!hasSavedAttendance || isEditing);

  return (
    <div className="attendance-main-flex-wrapper">
      {/* ── Flexbox Container 1: Quick Attendance ── */}
      <section className="attendance-flex-container quick-attendance-flexbox">
        <div className="attendance-flex-header">
          <div className="attendance-header-info">
            <h4 className="attendance-header-title">
              <span className="header-icon">📋</span> Quick Attendance
            </h4>
            <p className="attendance-header-sub">
              Mark session attendance for confirmed classes. Holiday sessions remain inactive and blank.
            </p>
          </div>
          <div className="attendance-header-badges">
            <span className={`badge px-3 py-2 ${isConfirmed ? 'bg-success-subtle text-success border border-success' : 'bg-secondary-subtle text-secondary border border-secondary'}`}>
              {isConfirmed ? '✓ Confirmed Session' : '🏖️ Holiday / Not Held'}
            </span>
            {isConfirmed && (
              <span className={`badge px-3 py-2 ${hasSavedAttendance ? 'bg-primary-subtle text-primary border border-primary' : 'bg-warning-subtle text-warning-emphasis border border-warning'}`}>
                {hasSavedAttendance ? '✓ Attendance Saved' : '⏳ Awaiting Attendance'}
              </span>
            )}
            {dirty && <span className="badge text-bg-warning px-3 py-2">Unsaved Changes</span>}
          </div>
        </div>

        {/* Session Toolbar */}
        <div className="attendance-session-toolbar">
          <div className="attendance-session-field">
            <label>Week</label>
            <select
              className="form-select form-select-sm"
              value={week}
              onChange={e => {
                const v = parseInt(e.target.value, 10) || 1;
                setWeek(v);
              }}
            >
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Week {i + 1}</option>
              ))}
            </select>
          </div>

          <div className="attendance-session-field">
            <label>Day</label>
            <select
              className="form-select form-select-sm"
              value={day}
              onChange={e => {
                const v = parseInt(e.target.value, 10) || 1;
                setDay(v);
              }}
            >
              {[1, 2, 3].map(n => (
                <option key={n} value={n}>Day {n}</option>
              ))}
            </select>
          </div>

          <div className="attendance-session-field" style={{ minWidth: '180px' }}>
            <label>Actual Class Date</label>
            <input
              type="date"
              className="form-control form-control-sm"
              value={startDate || session.date || ''}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>

          <div className="attendance-session-actions">
            <button
              type="button"
              className={`btn btn-sm ${isConfirmed ? 'btn-success text-white' : 'btn-outline-success'}`}
              onClick={() => saveSession(true)}
              title="Confirm that class was held for this date"
            >
              ✓ Confirm Class Held
            </button>
            <button
              type="button"
              className={`btn btn-sm ${!isConfirmed ? 'btn-secondary text-white' : 'btn-outline-secondary'}`}
              onClick={() => saveSession(false)}
              title="Mark this session as holiday (attendance inactive and blank)"
            >
              🏖️ Mark Holiday
            </button>
          </div>
        </div>

        {/* Quick Attendance Interactive Box */}
        <div className={`quick-attendance-card ${!isConfirmed ? 'holiday-inactive' : ''}`}>
          <div className="quick-attendance-card-header">
            <div>
              <strong>Quick Attendance: Week {numWeek}, Day {numDay}</strong>
              <small className="text-muted ms-2">({session.date || 'No Date Specified'})</small>
            </div>
            <div>
              {!isConfirmed ? (
                <span className="badge text-bg-secondary">Inactive (Holiday)</span>
              ) : hasSavedAttendance && !isEditing ? (
                <span className="badge text-bg-success">Saved in Database</span>
              ) : isEditing ? (
                <span className="badge text-bg-warning">Authorized Edit Mode</span>
              ) : (
                <span className="badge text-bg-primary">Ready to Mark</span>
              )}
            </div>
          </div>

          {/* Contextual Status Alerts */}
          {!isConfirmed && (
            <div className="alert alert-secondary d-flex align-items-center gap-2 m-3 mb-0 py-2">
              <span style={{ fontSize: '1.2rem' }}>🏖️</span>
              <div>
                <strong>Holiday Session:</strong> Quick Attendance is inactive. Attendance records remain blank, no student is marked Present or Absent, and submission is disabled.
              </div>
            </div>
          )}

          {isConfirmed && hasSavedAttendance && !isEditing && (
            <div className="alert alert-success d-flex flex-wrap align-items-center justify-content-between gap-2 m-3 mb-0 py-2">
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: '1.2rem' }}>✓</span>
                <div>
                  <strong>Attendance Saved:</strong> Attendance records have been saved for this session. Save Attendance is disabled to prevent duplicate submissions.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-warning text-dark fw-bold"
                onClick={() => setIsEditing(true)}
              >
                ✏️ Modify Attendance
              </button>
            </div>
          )}

          {isConfirmed && isEditing && (
            <div className="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2 m-3 mb-0 py-2">
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: '1.2rem' }}>✏️</span>
                <div>
                  <strong>Authorized Editing in Progress:</strong> Modify student attendance below and click <b>Update Attendance</b> to save changes.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  const key = `w${numWeek}d${numDay}`;
                  setEntries(Object.fromEntries((data.students || []).map(s => [s.roll, s.attendance?.[key] || 'Present'])));
                  setDirty(false);
                  setIsEditing(false);
                }}
              >
                Cancel Edit
              </button>
            </div>
          )}

          {/* Quick Table */}
          <div className="quick-table-scroll mt-2">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th style={{ width: '50px', textAlign: 'center' }}>Select</th>
                  <th style={{ width: '120px' }}>Roll</th>
                  <th>Name</th>
                  <th style={{ width: '180px' }}>Attendance Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.students || []).map(s => {
                  if (!isConfirmed) {
                    // Holiday session: records remain blank, no student Present or Absent
                    return (
                      <tr key={s.roll} className="text-muted" style={{ opacity: 0.65 }}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            disabled
                            checked={false}
                          />
                        </td>
                        <td>{s.roll}</td>
                        <td>{s.name}</td>
                        <td>
                          <span className="badge bg-light text-muted border px-2 py-1">
                            — Blank (Holiday)
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  const status = entries[s.roll] || 'Present';
                  const isAbsent = status === 'Absent';

                  const toggle = () => {
                    if (!isAttendanceInteractive) return;
                    setEntries({ ...entries, [s.roll]: isAbsent ? 'Present' : 'Absent' });
                    setDirty(true);
                  };

                  return (
                    <tr
                      key={s.roll}
                      className={isAbsent ? 'table-danger' : ''}
                      onClick={toggle}
                      style={{
                        cursor: isAttendanceInteractive ? 'pointer' : 'default',
                        userSelect: 'none'
                      }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          disabled={!isAttendanceInteractive}
                          checked={isAbsent}
                          onChange={toggle}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                      <td><b>{s.roll}</b></td>
                      <td>{s.name}</td>
                      <td>
                        <span className={`badge ${isAbsent ? 'text-bg-danger' : 'text-bg-success'} px-2 py-1`}>
                          {isAbsent ? 'Absent (A)' : 'Present (P)'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Action Bar */}
          <div className="quick-actions-bar">
            <div className="d-flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={!isAttendanceInteractive}
                onClick={() => {
                  setEntries(Object.fromEntries((data.students || []).map(s => [s.roll, 'Present'])));
                  setDirty(true);
                }}
              >
                Clear selections (All Present)
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={!isAttendanceInteractive}
                onClick={() => {
                  setEntries(Object.fromEntries((data.students || []).map(s => [s.roll, 'Absent'])));
                  setDirty(true);
                }}
              >
                Select all (Mark Absent)
              </button>
              {isConfirmed && hasSavedAttendance && !isEditing && (
                <button
                  type="button"
                  className="btn btn-outline-warning btn-sm text-dark fw-bold"
                  onClick={() => setIsEditing(true)}
                >
                  ✏️ Modify Attendance
                </button>
              )}
            </div>

            <div>
              {!isConfirmed ? (
                <button type="button" className="btn btn-secondary btn-sm px-4" disabled>
                  Save Attendance (Disabled on Holiday)
                </button>
              ) : hasSavedAttendance && !isEditing ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm px-4"
                  disabled
                  title="Attendance already saved for this session. Use 'Modify Attendance' to edit."
                >
                  ✓ Attendance Saved
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm px-4"
                  disabled={saving}
                  onClick={saveAttendance}
                >
                  {saving ? 'Saving...' : isEditing ? '💾 Update Attendance' : '💾 Save Attendance'}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Flexbox Container 2: Attendance Record ── */}
      <section className="attendance-flex-container attendance-record-flexbox">
        <div className="attendance-flex-header">
          <div className="attendance-header-info">
            <h4 className="attendance-header-title">
              <span className="header-icon">📊</span> Attendance Record
            </h4>
            <p className="attendance-header-sub">
              Official 13-week semester attendance matrix and continuous evaluation percentage.
            </p>
          </div>
          <div className="attendance-header-badges">
            <span className="badge bg-success-subtle text-success border border-success px-2 py-1">P = Present</span>
            <span className="badge bg-danger-subtle text-danger border border-danger px-2 py-1">A = Absent</span>
            <span className="badge bg-light text-muted border px-2 py-1">Blank = Holiday / Not Held</span>
          </div>
        </div>

        <Spreadsheet students={data.students} />
      </section>
    </div>
  );
}

function Spreadsheet({ students }) {
  const heldCount = (students && students[0]?.total_held) ?? 0;
  return (
    <div className="card shadow-sm border-0">
      <div className="card-header bg-light d-flex flex-wrap justify-content-between align-items-center py-2 px-3 border-bottom">
        <div>
          <b>13-Week Attendance Spreadsheet</b>
          <small className="ms-2 text-muted">Only confirmed class sessions count in percentages and continuous assessment marks.</small>
        </div>
        <span className="badge bg-primary-subtle text-primary border border-primary">
          {heldCount} Classes Held to Date
        </span>
      </div>
      <div className="sheet">
        <table className="table table-bordered table-sm mb-0">
          <thead>
            <tr>
              <th rowSpan="2" className="sticky-roll">Roll</th>
              <th rowSpan="2" className="sticky-name">Name</th>
              {Array.from({ length: 13 }, (_, i) => (
                <th colSpan="3" key={i} className="text-center">Week {i + 1}</th>
              ))}
              <th rowSpan="2">Present</th>
              <th rowSpan="2">Absent</th>
              <th rowSpan="2">Attendance %</th>
              <th rowSpan="2">Att Marks</th>
            </tr>
            <tr>
              {Array.from({ length: 39 }, (_, i) => (
                <th key={i}>D{(i % 3) + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(students || []).map(s => (
              <tr key={s.roll}>
                <td className="sticky-roll">{s.roll}</td>
                <td className="sticky-name">{s.name}</td>
                {Array.from({ length: 39 }, (_, i) => {
                  const w = Math.floor(i / 3) + 1;
                  const d = (i % 3) + 1;
                  const val = s.attendance?.[`w${w}d${d}`];
                  return (
                    <td
                      key={i}
                      className={val === 'Present' ? 'present' : val === 'Absent' ? 'absent' : ''}
                    >
                      {val === 'Present' ? 'P' : val === 'Absent' ? 'A' : ''}
                    </td>
                  );
                })}
                <td>{s.present}</td>
                <td>{s.absent}</td>
                <td><Status value={s.attendance_status} /> {s.attendance_percentage}%</td>
                <td><b>{s.attendance_marks ?? 0}/10</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
  return <div className="card shadow-sm"><div className="card-header bg-light"><b className="h6 mb-0">Performance and AI Risk Analysis</b></div>{loading?<div className="d-flex align-items-center gap-2 p-4 text-muted"><div className="spinner-border spinner-border-sm" role="status"/><span>Calculating performance and risk metrics...</span></div>:<div className="table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Roll</th><th>Name</th><th>Held</th><th>Present</th><th>Absent</th><th>Attendance %</th><th>Att Marks</th><th>CT Avg</th><th>Assignment Avg</th><th>Total Marks</th><th>Overall %</th><th>Risk</th></tr></thead><tbody>{rows.map(r=><tr key={r.roll}><td>{r.roll}</td><td>{r.name}</td><td>{r.classes_held}</td><td>{r.present}</td><td>{r.absent}</td><td>{r.attendance_percentage}%</td><td>{r.attendance_marks??'—'}/10</td><td>{r.ct_best_3_average??'—'}/20</td><td>{r.assignment_average??'—'}/10</td><td><b className="text-primary">{r.total_marks??'—'}/40</b></td><td>{r.overall_performance}%</td><td><Status value={r.risk_level}/></td></tr>)}</tbody></table></div>}</div>
}
function TeacherReport({ course, token, notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    call(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/reports/teacher-report`, token)
      .then(d => setRows(d.students || d.rows || []))
      .catch(e => notify(e.message, 'danger'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [course.course_code]);

  const downloadPdf = () => {
    const url = `${API}/api/teacher/courses/${encodeURIComponent(course.course_code)}/reports/teacher-report/export?format=pdf&token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
  };

  const downloadXlsx = () => {
    const url = `${API}/api/teacher/courses/${encodeURIComponent(course.course_code)}/reports/teacher-report/export?format=xlsx&token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="card shadow-sm">
      <div className="card-header bg-light d-flex justify-content-between align-items-center flex-wrap gap-2">
        <b className="h6 mb-0">Teacher Evaluation Report</b>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-danger d-flex align-items-center gap-1" onClick={downloadPdf}>
            📄 Download PDF
          </button>
          <button className="btn btn-sm btn-outline-success d-flex align-items-center gap-1" onClick={downloadXlsx}>
            📊 Download Excel
          </button>
        </div>
      </div>
      <div className="card-body">
        {/* TOP HEADER SECTION */}
        <div className="text-center my-3">
          <div className="fst-italic text-secondary small">Heaven's light is our guide</div>
          <div className="fw-bold fs-5 text-dark">Rajshahi University of Engineering & Technology</div>
          <div className="fw-bold text-dark mb-3">Department of Electronics & Telecommunication Engineering</div>
          <div className="border border-dark p-2 d-inline-block rounded w-100 bg-light shadow-sm" style={{ maxWidth: '640px' }}>
            <div className="fw-bold fs-6">Continuous Assessment Marks on</div>
            <div className="fw-bold text-primary fs-5">{course.course_code} ({course.course_name})</div>
          </div>
        </div>

        {loading ? (
          <div className="d-flex align-items-center gap-2 p-4 text-muted justify-content-center">
            <div className="spinner-border spinner-border-sm" role="status" />
            <span>Generating evaluation report...</span>
          </div>
        ) : (
          <>
            <div className="table-responsive border rounded mb-3">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Student Roll</th>
                    <th className="text-center fw-bold">Total Marks (out of 40)</th>
                    <th className="text-center">CT Marks (out of 20)</th>
                    <th className="text-center">Assignment Marks (out of 10)</th>
                    <th className="text-center">Attendance Marks (out of 10)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.roll}>
                      <td className="fw-bold">{r.roll}</td>
                      <td className="text-center fw-bold text-primary">{r.total_marks} / 40</td>
                      <td className="text-center">{r.ct_marks} / 20</td>
                      <td className="text-center">{r.assignment_marks} / 10</td>
                      <td className="text-center">{r.attendance_marks} / 10</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan="5" className="text-center text-muted py-4">No student evaluation records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* FOOTER SIGNATURE SECTION */}
            <div className="d-flex justify-content-end mt-4 pt-2">
              <div className="text-end text-dark pe-3">
                <div><b>Teacher ID:</b> {course.teacher_id || 'T01'}</div>
                <div><b>Professor</b></div>
                <div>Dept. of ETE, RUET</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function Assignments({ course, token, notify }) {
  const [items, setItems] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [grades, setGrades] = useState({});
  const [savingRoll, setSavingRoll] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [iframeBlobUrl, setIframeBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch a file and display it in the modal via a blob:// URL (bypasses IDM)
  const openPreview = async (meta) => {
    setPreviewFile(meta);
    setIframeBlobUrl(null); // clear previous
    if (meta.fileName) {
      try {
        const url = getFileUrl(meta.fileName, false);
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          setIframeBlobUrl(URL.createObjectURL(blob));
        }
      } catch (_) { /* fall back to direct src */ }
    }
  };

  const closePreview = () => {
    if (iframeBlobUrl) URL.revokeObjectURL(iframeBlobUrl);
    setIframeBlobUrl(null);
    setPreviewFile(null);
  };

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
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await submitForm(`/api/teacher/courses/${encodeURIComponent(course.course_code)}/assignments`, token, form);
      notify(result.message || 'Assignment created/updated successfully.');
      if (formElement && typeof formElement.reset === 'function') {
        formElement.reset();
      }
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

  const unsubmitTeacherFile = async () => {
    if (!selectedAssignment || !selectedAssignment.ref_file_name) return;
    if (!window.confirm(`Are you sure you want to unsubmit / remove the file for Assignment ${selectedAssignment.assignment_number}? You can upload a new file if you mistakenly uploaded this one.`)) return;
    try {
      const res = await call(
        `/api/teacher/courses/${encodeURIComponent(course.course_code)}/assignments/${selectedAssignment.assignment_id}/unsubmit-file`,
        token,
        { method: 'POST' }
      );
      notify(res.message || 'Assignment file unsubmitted successfully.');
      load();
    } catch (e) {
      notify(e.message, 'danger');
    }
  };

  const changeTeacherFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAssignment) return;
    const form = new FormData();
    form.append('ref_file', file);
    try {
      const res = await submitForm(
        `/api/teacher/courses/${encodeURIComponent(course.course_code)}/assignments/${selectedAssignment.assignment_id}/upload-file`,
        token,
        form
      );
      notify(res.message || 'Assignment file updated successfully.');
      load();
    } catch (err) {
      notify(err.message, 'danger');
    } finally {
      e.target.value = '';
    }
  };

  const unsubmitStudentSubmission = async (roll) => {
    if (!selectedAssignment) return;
    if (!window.confirm(`Are you sure you want to unsubmit the submission for Roll ${roll}? The student will be able to upload a new file.`)) return;
    try {
      const res = await call(
        `/api/teacher/courses/${encodeURIComponent(course.course_code)}/assignments/${selectedAssignment.assignment_id}/submissions/${roll}/unsubmit`,
        token,
        { method: 'POST' }
      );
      notify(res.message || `Submission for Roll ${roll} unsubmitted successfully.`);
      load();
    } catch (e) {
      notify(e.message, 'danger');
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
                {selectedAssignment.ref_file_name ? (
                  <div className="d-flex flex-column align-items-end gap-2">
                    <div className="d-flex gap-2 align-items-center flex-wrap">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => viewFileInBrowser(getFileUrl(selectedAssignment.ref_file_name, false))}
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
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={unsubmitTeacherFile}
                        title="Unsubmit mistakenly uploaded file"
                      >
                        🔄 Unsubmit File
                      </button>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <label className="btn btn-sm btn-outline-secondary py-1 px-2 mb-0" style={{ cursor: 'pointer' }}>
                        ✏️ Change File
                        <input
                          type="file"
                          hidden
                          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png"
                          onChange={changeTeacherFile}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-muted small">No file attached</span>
                    <label className="btn btn-sm btn-outline-primary py-1 px-2 mb-0" style={{ cursor: 'pointer' }}>
                      📎 Upload File
                      <input
                        type="file"
                        hidden
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png"
                        onChange={changeTeacherFile}
                      />
                    </label>
                  </div>
                )}
              </div>

              <h6 className="fw-bold mb-3">Student Submissions</h6>
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: '10%' }}>Roll</th>
                      <th style={{ width: '16%' }}>Student Name</th>
                      <th style={{ width: '14%' }}>Submission</th>
                      <th style={{ width: '20%' }}>Text / File</th>
                      <th style={{ width: '14%' }}>Marks</th>
                      <th style={{ width: '14%' }}>Feedback</th>
                      <th style={{ width: '12%' }}>Action</th>
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
                                  onClick={() => viewFileInBrowser(getFileUrl(sub.file_name, false))}
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
                            <div className="d-flex gap-1 align-items-center">
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => saveMarks(roll)}
                                disabled={savingRoll === roll}
                              >
                                {savingRoll === roll ? 'Saving...' : 'Save Marks'}
                              </button>
                              {isSubmitted && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  title="Unsubmit student's submission"
                                  onClick={() => unsubmitStudentSubmission(roll)}
                                >
                                  🔄 Unsubmit
                                </button>
                              )}
                            </div>
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
                  <button type="button" className="btn-close" onClick={closePreview} aria-label="Close"></button>
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
                          src={iframeBlobUrl || getFileUrl(previewFile.fileName, false)}
                          alt="Submission Preview"
                          style={{ maxHeight: '500px', objectFit: 'contain' }}
                        />
                      </div>
                    ) : iframeBlobUrl ? (
                      <iframe
                        src={iframeBlobUrl}
                        title="Document Preview"
                        style={{ width: '100%', height: '540px', border: 'none' }}
                      />
                    ) : (
                      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '520px' }}>
                        <div className="text-center text-muted">
                          <div className="spinner-border mb-2" role="status" />
                          <div>Loading preview…</div>
                        </div>
                      </div>
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
                <button type="button" className="btn btn-secondary btn-sm" onClick={closePreview}>
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
  const unsubmit=async(assignment)=>{if(!window.confirm(`Are you sure you want to unsubmit Assignment ${assignment.assignment_number}? You can upload a new file after unsubmitting.`))return;try{const result=await call(`/api/student/courses/${encodeURIComponent(course.course_code)}/assignments/${assignment.assignment_id}/unsubmit`,auth.token,{method:'POST'});setNotice(result.message||'Assignment unsubmitted successfully.');await open(course);load();}catch(err){setNotice(err.message)}};
  const finish=()=>{sessionStorage.removeItem('authToken');logout()};
  const navItems=[
    {id:'Dashboard',icon:'🏠',label:'Dashboard'},
    {id:'My Courses',icon:'📚',label:'My Courses'},
    {id:'Profile',icon:'👤',label:'Profile'},
    {id:'Change Password',icon:'🔑',label:'Change Password'},
  ];
  const initials = data ? (data.profile.name||'S').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() : 'S';
  let body=<div className="sp-loading"><div className="sp-spinner"/><span>Loading your dashboard…</span></div>;

  if(data&&!course&&page==='Profile') body=(
    <div className="sp-profile-wrap">
      <div className="sp-profile-hero">
        <div className="sp-profile-avatar">{initials}</div>
        <div>
          <div className="sp-profile-name">{data.profile.name}</div>
          <div className="sp-profile-id">{data.profile.student_id||data.profile.roll}</div>
        </div>
      </div>
      <div className="sp-profile-grid">
        <div className="sp-profile-field">
          <span className="sp-field-icon">🎓</span>
          <div><div className="sp-field-label">Student ID</div><div className="sp-field-value">{data.profile.student_id||data.profile.roll}</div></div>
        </div>
        <div className="sp-profile-field">
          <span className="sp-field-icon">👤</span>
          <div><div className="sp-field-label">Full Name</div><div className="sp-field-value">{data.profile.name}</div></div>
        </div>
        <div className="sp-profile-field">
          <span className="sp-field-icon">📅</span>
          <div><div className="sp-field-label">Series</div><div className="sp-field-value">{data.profile.series}</div></div>
        </div>
        <div className="sp-profile-field">
          <span className="sp-field-icon">📖</span>
          <div><div className="sp-field-label">Current Semester</div><div className="sp-field-value">Semester {data.profile.current_semester||data.profile.semester}</div></div>
        </div>
        <div className="sp-profile-field">
          <span className="sp-field-icon">📞</span>
          <div><div className="sp-field-label">Contact Number</div><div className="sp-field-value sp-field-highlight">{data.profile.contact_no||data.profile.phone||('+880 1700-00'+String(data.profile.roll||'000').slice(-4))}</div></div>
        </div>
        <div className="sp-profile-field">
          <span className="sp-field-icon">✉️</span>
          <div><div className="sp-field-label">Email</div><div className="sp-field-value">{data.profile.email||'—'}</div></div>
        </div>
      </div>
    </div>
  );

  else if(data&&!course&&page==='Change Password') body=<div className="sp-page-wrap"><ChangePassword token={auth.token} onDone={finish}/></div>;

  else if(data&&!course) body=(
    <div className="sp-main-wrap">
      {/* Welcome hero */}
      <div className="sp-welcome-hero">
        <div className="sp-welcome-avatar">{initials}</div>
        <div>
          <div className="sp-welcome-greeting">Welcome back,</div>
          <div className="sp-welcome-name">{data.profile.name}</div>
          <div className="sp-welcome-meta">
            <span>ID: <b>{data.profile.student_id}</b></span>
            <span>Series: <b>{data.series}</b></span>
            <span>Semester: <b>{data.semester}</b></span>
          </div>
        </div>
      </div>

      {/* Summary stat row */}
      <div className="sp-summary-row">
        <div className="sp-summary-card sp-sum-blue">
          <div className="sp-sum-val">{data.courses.length}</div>
          <div className="sp-sum-label">Enrolled Courses</div>
        </div>
        <div className="sp-summary-card sp-sum-green">
          <div className="sp-sum-val">{data.courses.filter(c=>c.attendance.status==='Good').length}</div>
          <div className="sp-sum-label">Good Attendance</div>
        </div>
        <div className="sp-summary-card sp-sum-purple">
          <div className="sp-sum-val">{data.courses.reduce((s,c)=>s+c.assignments.submitted,0)}</div>
          <div className="sp-sum-label">Assignments Submitted</div>
        </div>
        <div className="sp-summary-card sp-sum-amber">
          <div className="sp-sum-val">{data.courses.filter(c=>c.attendance.percentage<75).length}</div>
          <div className="sp-sum-label">Low Attendance Courses</div>
        </div>
      </div>

      {/* Courses */}
      <div className="sp-courses-head">
        <h2 className="sp-section-heading">📚 My Courses</h2>
        <span className="sp-courses-count">{data.courses.length} courses</span>
      </div>
      <div className="sp-courses-grid">
        {data.courses.map(item=>{
          const attPct=item.attendance.percentage;
          const attColor=attPct>=75?'#22c55e':attPct>=60?'#f59e0b':'#ef4444';
          return (
            <div className="sp-course-card" key={item.course_id}>
              <div className="sp-course-card-top">
                <span className="sp-course-code">{item.course_code}</span>
                <Status value={item.attendance.status}/>
              </div>
              <h3 className="sp-course-name">{item.course_name}</h3>
              <div className="sp-course-stats">
                <div className="sp-cstat">
                  <div className="sp-cstat-label">Attendance</div>
                  <div className="sp-cstat-bar-wrap">
                    <div className="sp-cstat-bar-track"><div className="sp-cstat-bar-fill" style={{width:`${Math.min(attPct,100)}%`,background:attColor}}/></div>
                    <span className="sp-cstat-val" style={{color:attColor}}>{attPct}%</span>
                  </div>
                </div>
                <div className="sp-cstat-row">
                  <div className="sp-cstat-pill sp-pill-indigo">CT Avg: <b>{item.class_tests.best_3_average??'—'}/20</b></div>
                  <div className="sp-cstat-pill sp-pill-teal">Assign: <b>{item.assignments.submitted}/{item.assignments.total}</b></div>
                </div>
              </div>
              <button className="sp-view-btn" onClick={()=>open(item)}>View Course →</button>
            </div>
          );
        })}
      </div>
    </div>
  );
  else if(detail)body=(
    <div className="cd-wrap">
      {/* ── Back + Course Hero ─────────────────────────────── */}
      <button className="cd-back-btn" onClick={()=>{setCourse(null);setDetail(null)}}>
        <span className="cd-back-arrow">←</span> My Courses
      </button>

      <div className="cd-hero">
        <div className="cd-hero-left">
          <span className="cd-code-pill">{course.course_code}</span>
          <h1 className="cd-title">{course.course_name}</h1>
          <div className="cd-meta-row">
            <span className="cd-meta-chip">📚 Series {detail.series}</span>
            <span className="cd-meta-chip">🗓️ Semester {detail.semester}</span>
          </div>
        </div>
        <div className="cd-stat-grid">
          <div className="cd-stat-box cd-stat-blue">
            <div className="cd-stat-value">{detail.attendance.percentage}%</div>
            <div className="cd-stat-label">Attendance</div>
            <Status value={detail.attendance.status}/>
          </div>
          <div className="cd-stat-box cd-stat-purple">
            <div className="cd-stat-value">{detail.testsData.best_3_average??'—'}<span className="cd-stat-sub">/20</span></div>
            <div className="cd-stat-label">CT Best-3 Avg</div>
          </div>
          <div className="cd-stat-box cd-stat-teal">
            <div className="cd-stat-value">{detail.assignmentsData.assignments.filter(a=>a.submission_status!=='Not Submitted').length}<span className="cd-stat-sub">/{detail.assignmentsData.assignments.length}</span></div>
            <div className="cd-stat-label">Assignments Done</div>
          </div>
        </div>
      </div>

      {/* ── Two-column: Attendance + Class Tests ───────────── */}
      <div className="cd-grid-2">

        {/* Attendance */}
        <section className="cd-section">
          <div className="cd-section-header">
            <span className="cd-section-icon cd-icon-blue">📋</span>
            <h2 className="cd-section-title">Attendance Record</h2>
            <span className="cd-section-badge">{detail.attendance.present} / {detail.attendance.total_classes_held} classes</span>
          </div>
          <div className="cd-att-bar-wrap">
            <div className="cd-att-bar-track">
              <div className="cd-att-bar-fill" style={{width:`${Math.min(detail.attendance.percentage,100)}%`, background: detail.attendance.percentage>=75?'#22c55e':detail.attendance.percentage>=60?'#f59e0b':'#ef4444'}}/>
            </div>
            <span className="cd-att-pct">{detail.attendance.percentage}%</span>
          </div>
          <div className="cd-table-wrap">
            <table className="cd-table">
              <thead><tr><th>Week</th><th>Day</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {detail.attendanceData.details.map((x,i)=>(
                  <tr key={i}>
                    <td>W{x.week}</td><td>D{x.day}</td><td>{x.date||'—'}</td>
                    <td><span className={`cd-att-status ${x.status==='Present'?'cd-present':x.status==='Absent'?'cd-absent':'cd-na'}`}>{x.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Class Tests */}
        <section className="cd-section">
          <div className="cd-section-header">
            <span className="cd-section-icon cd-icon-purple">📝</span>
            <h2 className="cd-section-title">Class Test Marks</h2>
          </div>
          <div className="cd-ct-list">
            {detail.testsData.tests.map((x,i)=>{
              const scored = x.obtained_marks!==null&&x.obtained_marks!==undefined;
              const pct = scored ? Math.round((x.obtained_marks/x.total_marks)*100) : null;
              return (
                <div className="cd-ct-row" key={i}>
                  <span className="cd-ct-label">{x.label}</span>
                  <div className="cd-ct-bar-wrap">
                    {scored
                      ? <div className="cd-ct-bar-track"><div className="cd-ct-bar-fill" style={{width:`${pct}%`,background:pct>=75?'#6366f1':pct>=50?'#f59e0b':'#ef4444'}}/></div>
                      : <span className="cd-ct-na">Not held yet</span>}
                  </div>
                  <span className="cd-ct-score">{scored?`${x.obtained_marks}/${x.total_marks}`:'—'}</span>
                </div>
              );
            })}
          </div>
          <div className="cd-ct-summary">
            <span>Best 3 Average</span>
            <strong className="cd-ct-avg">{detail.testsData.best_3_average??'—'} <span className="cd-ct-avg-denom">/ 20</span></strong>
          </div>
        </section>
      </div>

      {/* ── Assignments ──────────────────────────────────────── */}
      <section className="cd-section cd-assignments-section">
        <div className="cd-section-header">
          <span className="cd-section-icon cd-icon-teal">📂</span>
          <h2 className="cd-section-title">Assignments</h2>
          <span className="cd-section-badge">{detail.assignmentsData.assignments.length} total</span>
        </div>
        <div className="cd-asgn-list">
          {detail.assignmentsData.assignments.map(a=>{
            const statusClass = a.submission_status==='Graded'?'cd-asgn-graded':a.submission_status==='Submitted'?'cd-asgn-submitted':'cd-asgn-pending';
            return (
              <div className={`cd-asgn-card ${statusClass}`} key={a.assignment_id}>
                {/* Header row */}
                <div className="cd-asgn-head">
                  <div className="cd-asgn-info">
                    <span className="cd-asgn-num">Assignment {a.assignment_number}</span>
                    <span className="cd-asgn-title">{a.title}</span>
                  </div>
                  <div className="cd-asgn-chips">
                    <span className="cd-chip cd-chip-deadline">⏰ {a.deadline}</span>
                    <span className="cd-chip cd-chip-marks">🏆 {a.total_marks} marks</span>
                    <Status value={a.submission_status==='Not Submitted'?'Warning':a.submission_status==='Graded'?'Good':'Low'}/>
                  </div>
                </div>

                {/* Description */}
                {a.description&&<p className="cd-asgn-desc">{a.description}</p>}

                {/* Reference file */}
                {a.ref_file_name&&(
                  <div className="cd-asgn-ref-files">
                    <span className="cd-ref-label">📎 Reference File:</span>
                    <button type="button" className="cd-file-btn cd-file-btn-view" onClick={()=>viewFileInBrowser(`${API}/api/assignments/files/${encodeURIComponent(a.ref_file_name)}?token=${encodeURIComponent(auth.token)}`)}>👁️ View Online</button>
                    <a href={`${API}/api/assignments/files/${encodeURIComponent(a.ref_file_name)}?token=${encodeURIComponent(auth.token)}&download=1`} download className="cd-file-btn cd-file-btn-dl">📥 Download</a>
                  </div>
                )}

                {/* Submission result */}
                <div className="cd-asgn-result">
                  <span className="cd-result-status">{a.submission_status}</span>
                  {a.marks!==null&&a.marks!==undefined
                    ? <span className="cd-marks-badge">✅ {a.marks} / {a.total_marks} marks</span>
                    : a.submission_status==='Submitted'
                      ? <span className="cd-marks-pending">⏳ Marks pending</span>
                      : null}
                </div>

                {a.feedback&&(
                  <div className="cd-feedback-box">
                    <span className="cd-feedback-label">💬 Teacher Feedback</span>
                    <p className="cd-feedback-text">{a.feedback}</p>
                  </div>
                )}

                {a.file_name&&(
                  <div className="cd-asgn-ref-files mt-2">
                    <span className="cd-ref-label">📁 Your Submitted File:</span>
                    <button type="button" className="cd-file-btn cd-file-btn-view" onClick={()=>viewFileInBrowser(`${API}/api/assignments/files/${encodeURIComponent(a.file_name)}?token=${encodeURIComponent(auth.token)}`)}>📄 View File</button>
                  </div>
                )}

                {/* Submit form */}
                {a.submission_status==='Not Submitted'?(
                  <form className="cd-submit-form" onSubmit={e=>submit(e,a)}>
                    <label className="cd-file-label">
                      <span>📎 Upload Submission File</span>
                      <input name="file" type="file" className="cd-file-input" accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.jpg,.jpeg,.png" required />
                    </label>
                    <button className="cd-submit-btn" type="submit">🚀 Submit Assignment</button>
                  </form>
                ):(
                  a.submission_status!=='Graded'&&(
                    <div className="cd-unsubmit-wrap">
                      <button type="button" className="cd-unsubmit-btn" onClick={()=>unsubmit(a)}>🔄 Unsubmit Assignment</button>
                      <div className="cd-unsubmit-hint">Mistakenly uploaded the wrong file? Unsubmit to remove it and upload a new one.</div>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
  return (
    <div className="sp-shell">
      {/* ── Header ── */}
      <header className="sp-header">
        <div className="sp-header-brand">
          <span className="sp-header-logo">🎓</span>
          <div>
            <div className="sp-header-title">Continuous Assessment &amp; Academic Performance Evaluation</div>
            <div className="sp-header-sub">Student Portal</div>
          </div>
        </div>
        <div className="sp-header-right">
          {data&&<span className="sp-header-user">{data.profile.name}</span>}
          <button className="sp-logout-btn" onClick={finish}>⎋ Logout</button>
        </div>
      </header>

      <div className="sp-layout">
        {/* ── Sidebar ── */}
        <aside className="sp-sidebar">
          {data&&(
            <div className="sp-sidebar-profile">
              <div className="sp-sidebar-avatar">{initials}</div>
              <div className="sp-sidebar-name">{data.profile.name}</div>
              <div className="sp-sidebar-id">{data.profile.student_id||data.profile.roll}</div>
            </div>
          )}
          <nav className="sp-nav">
            {navItems.map(item=>(
              <button
                key={item.id}
                className={`sp-nav-item${page===item.id&&!course?' sp-nav-active':''}`}
                onClick={()=>{setPage(item.id);setCourse(null);setDetail(null)}}
              >
                <span className="sp-nav-icon">{item.icon}</span>
                <span className="sp-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
          <button className="sp-sidebar-logout" onClick={finish}>⎋ Logout</button>
        </aside>

        {/* ── Main ── */}
        <main className="sp-content">
          {notice&&(
            <div className="sp-notice">
              <span>{notice}</span>
              <button className="sp-notice-close" onClick={()=>setNotice('')}>✕</button>
            </div>
          )}
          {body}
        </main>
      </div>
    </div>
  )
}

function TeacherDashboard({ auth, logout }) {
  const [courses, setCourses] = useState([]);
  const [course, setCourse] = useState(null);
  const [page, setPage] = useState('Dashboard');
  const [tab, setTab] = useState('Attendance');
  const [notice, setNotice] = useState(null);
  const [profile, setProfile] = useState(auth.profile || {});
  const [editingProfile, setEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', contact_no: '', email: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  const notify = (message, type = 'success') => setNotice({ message, type });
  const finish = () => { sessionStorage.removeItem('authToken'); logout(); };

  const loadCourses = async () => {
    try {
      const d = await call('/api/teacher/courses', auth.token);
      setCourses(d.courses || []);
    } catch(e) {
      notify(e.message, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const loadProfile = async () => {
    try {
      const res = await call('/api/teacher/profile', auth.token);
      if (res.profile) setProfile(res.profile);
    } catch(e) {}
  };

  useEffect(() => {
    loadCourses();
    loadProfile();
  }, []);

  const initials = useMemo(() => {
    if (!profile.name) return 'TP';
    const parts = profile.name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }, [profile.name]);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      setSavingProfile(true);
      const res = await call('/api/teacher/profile', auth.token, {
        method: 'PUT',
        body: JSON.stringify(editForm)
      });
      setProfile(res.profile || { ...profile, ...editForm });
      setEditingProfile(false);
      notify(res.message || 'Profile updated successfully.');
    } catch(err) {
      notify(err.message, 'danger');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleNavClick = (item) => {
    if (['Attendance', 'Class Tests', 'Assignments', 'Performance', 'Reports'].includes(item)) {
      setTab(item);
    } else if (item === 'My Courses') {
      setCourse(null);
      setPage('My Courses');
    } else if (item === 'Dashboard') {
      setCourse(null);
      setPage('Dashboard');
    } else if (item === 'Profile') {
      setCourse(null);
      setPage('Profile');
    } else if (item === 'Change Password') {
      setCourse(null);
      setPage('Change Password');
    }
  };

  let body;
  if (!course) {
    if (page === 'Profile') {
      body = (
        <div className="tp-profile-wrap">
          <div className="tp-profile-hero">
            <div className="tp-profile-avatar">{initials}</div>
            <div className="tp-profile-info">
              <h1 className="tp-profile-name">{profile.name}</h1>
              <div className="tp-profile-id">Teacher ID: {profile.teacher_id}</div>
              <div className="tp-profile-dept">{profile.department || 'Electronics & Telecommunication Engineering (RUET)'}</div>
            </div>
            <span className="tp-status-badge ms-auto">{profile.status || 'Active Faculty'}</span>
          </div>

          <div className="tp-profile-grid">
            <div className="tp-profile-field">
              <span className="tp-field-icon">🏷️</span>
              <div>
                <div className="tp-field-label">Teacher ID</div>
                <div className="tp-field-value tp-field-highlight">{profile.teacher_id}</div>
              </div>
            </div>
            <div className="tp-profile-field">
              <span className="tp-field-icon">🏛️</span>
              <div>
                <div className="tp-field-label">Department</div>
                <div className="tp-field-value">{profile.department || 'Electronics & Telecommunication Engineering'}</div>
              </div>
            </div>
            <div className="tp-profile-field">
              <span className="tp-field-icon">💼</span>
              <div>
                <div className="tp-field-label">Academic Status</div>
                <div className="tp-field-value text-capitalize">{profile.status || 'Active'}</div>
              </div>
            </div>
            <div className="tp-profile-field">
              <span className="tp-field-icon">📱</span>
              <div>
                <div className="tp-field-label">Contact Phone</div>
                <div className="tp-field-value">{profile.contact_no || profile.phone || '—'}</div>
              </div>
            </div>
            <div className="tp-profile-field">
              <span className="tp-field-icon">✉️</span>
              <div>
                <div className="tp-field-label">Email Address</div>
                <div className="tp-field-value">{profile.email || '—'}</div>
              </div>
            </div>
            <div className="tp-profile-field">
              <span className="tp-field-icon">📚</span>
              <div>
                <div className="tp-field-label">Assigned Courses</div>
                <div className="tp-field-value tp-field-highlight">{courses.length} Course(s)</div>
              </div>
            </div>
          </div>

          <div className="tp-profile-card mt-4">
            {!editingProfile ? (
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                  <h6 className="fw-bold mb-1 text-dark">Contact Information</h6>
                  <p className="text-muted small mb-0">Update your phone number and email address visible in department records.</p>
                </div>
                <button
                  className="tp-btn-outline"
                  onClick={() => {
                    setEditForm({
                      name: profile.name || '',
                      contact_no: profile.contact_no || profile.phone || '',
                      email: profile.email || ''
                    });
                    setEditingProfile(true);
                  }}
                >
                  ✏️ Edit Contact Information
                </button>
              </div>
            ) : (
              <form onSubmit={saveProfile}>
                <h6 className="fw-bold mb-3 text-dark">Update Contact Information</h6>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Full Name</label>
                  <input
                    className="form-control"
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Contact Number</label>
                  <input
                    className="form-control"
                    placeholder="e.g. +880 1711-000000"
                    value={editForm.contact_no}
                    onChange={e => setEditForm({ ...editForm, contact_no: e.target.value })}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-bold">Email Address</label>
                  <input
                    type="email"
                    className="form-control"
                    value={editForm.email}
                    onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                    required
                  />
                </div>
                <div className="d-flex gap-2">
                  <button type="submit" className="tp-btn-primary" disabled={savingProfile}>
                    {savingProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button type="button" className="tp-btn-secondary" onClick={() => setEditingProfile(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      );
    } else if (page === 'Change Password') {
      body = (
        <div className="tp-page-wrap">
          <ChangePassword token={auth.token} onDone={finish} />
        </div>
      );
    } else if (page === 'Dashboard') {
      const totalStudents = courses.reduce((acc, c) => acc + (c.student_count || 0), 0);
      const totalClasses = courses.reduce((acc, c) => acc + (c.attendance_progress || 0), 0);
      body = (
        <div className="tp-main-wrap">
          {/* Welcome Hero */}
          <div className="tp-welcome-hero">
            <div className="tp-welcome-avatar">{initials}</div>
            <div className="tp-welcome-info">
              <div className="tp-welcome-greeting">Faculty Portal · Dept. of Electronics &amp; Telecommunication Engineering</div>
              <h1 className="tp-welcome-name">Welcome, {profile.name || 'Faculty Member'}</h1>
              <div className="tp-welcome-meta">
                <span>Teacher ID: <b>{profile.teacher_id}</b></span>
                <span>•</span>
                <span>Assigned Courses: <b>{courses.length}</b></span>
                <span>•</span>
                <span>Total Enrolled: <b>{totalStudents} Students</b></span>
              </div>
            </div>
          </div>

          {/* KPI Stat Cards */}
          <div className="tp-summary-row">
            <div className="tp-summary-card tp-sum-blue">
              <div className="tp-sum-icon">📚</div>
              <div className="tp-sum-val">{courses.length}</div>
              <div className="tp-sum-label">Assigned Courses</div>
            </div>
            <div className="tp-summary-card tp-sum-green">
              <div className="tp-sum-icon">👥</div>
              <div className="tp-sum-val">{totalStudents}</div>
              <div className="tp-sum-label">Enrolled Students</div>
            </div>
            <div className="tp-summary-card tp-sum-purple">
              <div className="tp-sum-icon">📅</div>
              <div className="tp-sum-val">{totalClasses}</div>
              <div className="tp-sum-label">Classes Held</div>
            </div>
            <div className="tp-summary-card tp-sum-amber">
              <div className="tp-sum-icon">🏷️</div>
              <div className="tp-sum-val" style={{ fontSize: '1.4rem' }}>{profile.teacher_id}</div>
              <div className="tp-sum-label">Faculty Code</div>
            </div>
          </div>

          {/* Teaching Courses Heading */}
          <div className="tp-courses-head">
            <h2 className="tp-section-heading">Currently Teaching Courses</h2>
            <span className="tp-courses-count">{courses.length} Active Courses</span>
          </div>

          {/* Teaching Courses Grid */}
          <div className="tp-courses-grid">
            {courses.map(c => (
              <div className="tp-course-card" key={c.course_id}>
                <div className="tp-course-card-top">
                  <span className="tp-course-code">{c.course_code}</span>
                  <span className="tp-pill-tag">Series {c.series} · Sem {c.semester}</span>
                </div>
                <h3 className="tp-course-name">{c.course_name}</h3>
                <div className="tp-course-badges">
                  <span className="tp-chip-type">{c.course_type}</span>
                  <span className="tp-chip-stat">👥 {c.student_count ?? 0} Students</span>
                  <span className="tp-chip-stat">📅 {c.attendance_progress ?? 0} Classes</span>
                </div>
                <button
                  className="tp-manage-btn"
                  onClick={() => { setCourse(c); setTab('Attendance'); }}
                >
                  Manage Course →
                </button>
              </div>
            ))}
            {!courses.length && (
              <div className="tp-empty-card">
                <div className="tp-empty-icon">📭</div>
                <div className="tp-empty-title">No Courses Assigned</div>
                <div className="tp-empty-desc">You currently do not have any courses assigned for this semester.</div>
              </div>
            )}
          </div>
        </div>
      );
    } else {
      // My Courses
      body = (
        <div className="tp-main-wrap">
          <div className="tp-courses-head">
            <div>
              <h1 className="tp-section-heading fs-4">My Assigned Courses</h1>
              <p className="tp-subheading">Manage course attendance, class test marks, assignments, and continuous assessment.</p>
            </div>
            <span className="tp-courses-count">{courses.length} Courses</span>
          </div>

          <div className="tp-courses-grid">
            {courses.map(c => (
              <div className="tp-course-card" key={c.course_id}>
                <div className="tp-course-card-top">
                  <span className="tp-course-code">{c.course_code}</span>
                  <span className="tp-pill-tag">Series {c.series} · Sem {c.semester}</span>
                </div>
                <h3 className="tp-course-name">{c.course_name}</h3>
                <div className="tp-course-badges">
                  <span className="tp-chip-type">{c.course_type}</span>
                  <span className="tp-chip-stat">👥 {c.student_count ?? 0} Students Enrolled</span>
                  <span className="tp-chip-stat">📅 {c.attendance_progress ?? 0} Classes Held</span>
                </div>
                <button
                  className="tp-manage-btn"
                  onClick={() => { setCourse(c); setTab('Attendance'); }}
                >
                  Open Course Portal →
                </button>
              </div>
            ))}
            {!courses.length && (
              <div className="tp-empty-card">
                <div className="tp-empty-icon">📭</div>
                <div className="tp-empty-title">No Courses Assigned</div>
                <div className="tp-empty-desc">No courses are currently assigned to your account.</div>
              </div>
            )}
          </div>
        </div>
      );
    }
  } else {
    // A course is selected
    body = (
      <div className="tp-course-view-wrap">
        {/* Course Header Banner */}
        <div className="tp-course-hero">
          <div className="tp-course-hero-left">
            <div className="tp-hero-code-row">
              <span className="tp-hero-code">{course.course_code}</span>
              <span className="tp-hero-badge">Series {course.series}</span>
              <span className="tp-hero-badge">Semester {course.semester}</span>
              <span className="tp-hero-badge">{course.course_type}</span>
            </div>
            <h1 className="tp-hero-title">{course.course_name}</h1>
            <div className="tp-hero-meta">
              <span>👥 <b>{course.student_count ?? 0}</b> Enrolled Students</span>
              <span>•</span>
              <span>📅 <b>{course.attendance_progress ?? 0}</b> Sessions Held</span>
            </div>
          </div>
          <button className="tp-back-btn" onClick={() => setCourse(null)}>
            ← Back to All Courses
          </button>
        </div>

        {/* Tab Navigation */}
        <nav className="tp-tabs-nav">
          {[
            { id: 'Attendance', label: 'Attendance', icon: '📋' },
            { id: 'Class Tests', label: 'Class Tests', icon: '📝' },
            { id: 'Assignments', label: 'Assignments', icon: '📁' },
            { id: 'Performance', label: 'Performance & Risk', icon: '📈' },
            { id: 'Reports', label: 'Official Reports', icon: '📄' }
          ].map(t => (
            <button
              key={t.id}
              className={`tp-tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="tp-tab-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        <div className="tp-tab-content">
          {tab === 'Attendance' && <Attendance course={course} token={auth.token} notify={notify} />}
          {tab === 'Class Tests' && <ClassTests course={course} token={auth.token} notify={notify} />}
          {tab === 'Assignments' && <Assignments course={course} token={auth.token} notify={notify} />}
          {tab === 'Performance' && <Performance course={course} token={auth.token} notify={notify} />}
          {tab === 'Reports' && <TeacherReport course={course} token={auth.token} notify={notify} />}
        </div>
      </div>
    );
  }

  return (
    <div className="tp-shell">
      {/* ── Topbar / Header ── */}
      <header className="tp-header">
        <div className="tp-header-brand">
          <span className="tp-header-logo">👨‍🏫</span>
          <div>
            <div className="tp-header-title">Continuous Assessment &amp; Academic Performance Evaluation</div>
            <div className="tp-header-sub">Faculty &amp; Instructor Portal · RUET ETE</div>
          </div>
        </div>
        <div className="tp-header-right">
          <span className="tp-header-user">
            <span className="tp-user-dot"></span>
            {profile.name || 'Faculty Member'}
          </span>
          <button className="tp-logout-btn" onClick={finish}>⎋ Logout</button>
        </div>
      </header>

      <div className="tp-layout">
        {/* ── Sidebar ── */}
        <aside className="tp-sidebar">
          <div className="tp-sidebar-profile">
            <div className="tp-sidebar-avatar">{initials}</div>
            <div className="tp-sidebar-name">{profile.name || 'Faculty Member'}</div>
            <div className="tp-sidebar-id">ID: {profile.teacher_id}</div>
          </div>

          <nav className="tp-nav">
            {course && (
              <div className="tp-sidebar-course-ctx">
                <div className="tp-ctx-label">ACTIVE COURSE</div>
                <div className="tp-ctx-code">{course.course_code}</div>
                <button className="tp-ctx-back" onClick={() => setCourse(null)}>
                  ← All Courses
                </button>
              </div>
            )}

            {course ? (
              <>
                <div className="tp-nav-section-title">COURSE MODULES</div>
                {[
                  { id: 'Attendance', label: 'Attendance', icon: '📋' },
                  { id: 'Class Tests', label: 'Class Tests', icon: '📝' },
                  { id: 'Assignments', label: 'Assignments', icon: '📁' },
                  { id: 'Performance', label: 'Performance & Risk', icon: '📈' },
                  { id: 'Reports', label: 'Official Reports', icon: '📄' }
                ].map(item => (
                  <button
                    key={item.id}
                    className={`tp-nav-item ${tab === item.id ? 'tp-nav-active' : ''}`}
                    onClick={() => handleNavClick(item.id)}
                  >
                    <span className="tp-nav-icon">{item.icon}</span>
                    <span className="tp-nav-label">{item.label}</span>
                  </button>
                ))}

                <div className="tp-nav-section-title mt-2">GENERAL</div>
                {[
                  { id: 'Dashboard', label: 'Dashboard', icon: '📊' },
                  { id: 'My Courses', label: 'My Courses', icon: '📚' },
                  { id: 'Profile', label: 'Profile', icon: '👤' },
                  { id: 'Change Password', label: 'Change Password', icon: '🔑' }
                ].map(item => (
                  <button
                    key={item.id}
                    className="tp-nav-item"
                    onClick={() => handleNavClick(item.id)}
                  >
                    <span className="tp-nav-icon">{item.icon}</span>
                    <span className="tp-nav-label">{item.label}</span>
                  </button>
                ))}
              </>
            ) : (
              [
                { id: 'Dashboard', label: 'Dashboard', icon: '📊' },
                { id: 'My Courses', label: 'My Courses', icon: '📚' },
                { id: 'Profile', label: 'Profile', icon: '👤' },
                { id: 'Change Password', label: 'Change Password', icon: '🔑' }
              ].map(item => (
                <button
                  key={item.id}
                  className={`tp-nav-item ${page === item.id ? 'tp-nav-active' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  <span className="tp-nav-icon">{item.icon}</span>
                  <span className="tp-nav-label">{item.label}</span>
                </button>
              ))
            )}
          </nav>

          <button className="tp-sidebar-logout" onClick={finish}>⎋ Logout</button>
        </aside>

        {/* ── Main Content Area ── */}
        <main className="tp-content">
          {notice && (
            <div className={`tp-notice tp-notice-${notice.type || 'info'}`}>
              <span>{notice.message}</span>
              <button className="tp-notice-close" onClick={() => setNotice(null)}>✕</button>
            </div>
          )}
          {loading ? (
            <div className="tp-loading">
              <div className="tp-spinner" />
              <span>Loading faculty dashboard…</span>
            </div>
          ) : body}
        </main>
      </div>
    </div>
  );
}

function App(){
  const [auth,setAuth]=useState(null);
  const logout=async()=>{if(auth)await call('/api/auth/logout',auth.token,{method:'POST'});setAuth(null);};
  if(!auth)return <Login onLogin={setAuth}/>;
  if(auth.role==='student')return <StudentDashboard auth={auth} logout={logout}/>;
  if(auth.role==='admin')return <SemesterAdminDashboard auth={auth} logout={logout}/>;
  if(auth.role==='teacher')return <TeacherDashboard auth={auth} logout={logout}/>;
  return <Login onLogin={setAuth}/>;
}

function SemesterAdminDashboard({auth,logout}) {
  const [page,setPage]=useState('Dashboard'),[data,setData]=useState({}),[semester,setSemester]=useState('6'),[courses,setCourses]=useState([]),[loading,setLoading]=useState(false),[courseError,setCourseError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState('');
  const [pageLoading,setPageLoading]=useState(false);

  // Instantly load initial dashboard view data
  const load=async()=>{
    try{
      const [dash, s, sem]=await Promise.all([
        call('/api/admin/dashboard',auth.token),
        call('/api/admin/series',auth.token),
        call('/api/admin/semesters',auth.token)
      ]);
      setData(prev=>({...prev, dashboard: dash, series: s, semesters: sem}));
      // Preload secondary tab data in the background without blocking the UI
      setTimeout(async()=>{
        try{
          const [st, tch, ca, usr]=await Promise.all([
            call('/api/admin/students',auth.token),
            call('/api/admin/teachers',auth.token),
            call('/api/admin/course-assignments',auth.token),
            call('/api/admin/users',auth.token)
          ]);
          setData(prev=>({
            ...prev,
            students: prev.students || st,
            teachers: prev.teachers || tch,
            'course-assignments': prev['course-assignments'] || ca,
            users: prev.users || usr
          }));
        }catch(e){}
      }, 50);
    }catch(e){setNotice(e.message)}
  };

  const loadCourses=async value=>{
    if(!value){setCourses([]);return}
    setLoading(true);
    setCourseError('');
    try{
      const result=await call(`/api/admin/courses?semester=${value}`,auth.token);
      setCourses(result.courses);
    }catch(e){
      setCourses([]);
      setCourseError('Failed to load courses. Please try again.');
    }finally{
      setLoading(false);
    }
  };

  const navigateToPage=async(newPage)=>{
    setPage(newPage);
    if(newPage==='Students' && !data.students){
      setPageLoading(true);
      try{const r=await call('/api/admin/students',auth.token);setData(prev=>({...prev,students:r}))}finally{setPageLoading(false)}
    } else if(newPage==='Teachers' && !data.teachers){
      setPageLoading(true);
      try{const r=await call('/api/admin/teachers',auth.token);setData(prev=>({...prev,teachers:r}))}finally{setPageLoading(false)}
    } else if(newPage==='Course Assignment' && !data['course-assignments']){
      setPageLoading(true);
      try{const r=await call('/api/admin/course-assignments',auth.token);setData(prev=>({...prev,'course-assignments':r}))}finally{setPageLoading(false)}
    } else if(newPage==='User Management' && !data.users){
      setPageLoading(true);
      try{const r=await call('/api/admin/users',auth.token);setData(prev=>({...prev,users:r}))}finally{setPageLoading(false)}
    }
  };

  useEffect(()=>{load()},[]);
  useEffect(()=>{loadCourses(semester)},[semester]);

  const initials = useMemo(() => {
    const name = auth.profile?.name || 'Admin';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }, [auth.profile?.name]);

  const series=data.series?.series||[], semesters=data.semesters?.semesters||[], teachers=data.teachers?.teachers||[];

  const assign=async e=>{
    e.preventDefault();
    const form=Object.fromEntries(new FormData(e.target));
    try{
      await call('/api/admin/course-assignments',auth.token,{method:'POST',body:JSON.stringify({...form,series:+form.series,semester:+form.semester})});
      setNotice('Course assigned successfully.');
      const [ca,dash]=await Promise.all([call('/api/admin/course-assignments',auth.token),call('/api/admin/dashboard',auth.token)]);
      setData(prev=>({...prev,'course-assignments':ca,dashboard:dash}));
      loadCourses(semester);
    }catch(err){setNotice(err.message)}
  };

  const unassign=async item=>{
    if(!window.confirm(`Are you sure you want to unassign ${item.teacher_code} from ${item.course_code}?`))return;
    try{
      await call(`/api/admin/course-assignments/${item.assignment_id}`,auth.token,{method:'DELETE'});
      setNotice('Course unassigned successfully.');
      const [ca,dash]=await Promise.all([call('/api/admin/course-assignments',auth.token),call('/api/admin/dashboard',auth.token)]);
      setData(prev=>({...prev,'course-assignments':ca,dashboard:dash}));
      loadCourses(semester);
    }catch(e){setNotice(e.message)}
  };

  const toggleUser = async (id, currentStatus) => {
    try {
      const target = typeof id === 'string' ? id : (id.username || id.roll || id.student_id);
      const st = currentStatus || (typeof id === 'object' ? id.status : 'active');
      const nextStatus = st === 'active' ? 'inactive' : 'active';
      await call(`/api/admin/users/${target}`, auth.token, { method: 'PUT', body: JSON.stringify({ status: nextStatus }) });
      setNotice(`User ${target} status updated to ${nextStatus}.`);
      const [uRes, tRes, sRes] = await Promise.all([call('/api/admin/users', auth.token), call('/api/admin/teachers', auth.token), call('/api/admin/students', auth.token)]);
      setData(prev => ({ ...prev, users: uRes, teachers: tRes, students: sRes }));
    } catch(e) { setNotice(e.message); }
  };

  const semesterPicker=<select className="form-select" value={semester} onChange={e=>setSemester(e.target.value)}><option value="">Select Semester</option>{semesters.map(s=><option key={s.semester} value={s.semester}>Semester {s.semester}</option>)}</select>;

  const navSections = [
    {
      title: 'OVERVIEW',
      items: [
        { id: 'Dashboard', label: 'Dashboard', icon: '📊' }
      ]
    },
    {
      title: 'DIRECTORY',
      items: [
        { id: 'Students', label: 'Students', icon: '👥' },
        { id: 'Teachers', label: 'Teachers', icon: '👨‍🏫' }
      ]
    },
    {
      title: 'ACADEMIC PROGRESSION',
      items: [
        { id: 'Semester Assignment', label: 'Semester Assignment', icon: '🗓️' }
      ]
    },
    {
      title: 'CURRICULUM',
      items: [
        { id: 'Courses', label: 'Courses', icon: '📚' },
        { id: 'Course Assignment', label: 'Course Assignment', icon: '🔗' }
      ]
    },
    {
      title: 'SYSTEM & SECURITY',
      items: [
        { id: 'User Management', label: 'User Management', icon: '🛡️' },
        { id: 'Change Password', label: 'Change Password', icon: '🔑' }
      ]
    }
  ];

  let body;
  if(pageLoading) {
    body = (
      <div className="ap-loading">
        <div className="ap-spinner" />
        <span>Loading records from database…</span>
      </div>
    );
  } else if(page==='Dashboard') {
    const statCards = [
      { label: 'Total Students', value: data.dashboard?.students, icon: '👥', color: 'blue' },
      { label: 'Faculty Members', value: data.dashboard?.teachers, icon: '👨‍🏫', color: 'green' },
      { label: 'Active Series', value: data.dashboard?.series, icon: '🎓', color: 'purple' },
      { label: 'Academic Semesters', value: data.dashboard?.semesters, icon: '📅', color: 'amber' },
      { label: 'Curriculum Courses', value: data.dashboard?.courses, icon: '📚', color: 'indigo' }
    ];

    body = (
      <div className="ap-main-wrap">
        {/* Welcome Hero */}
        <div className="ap-welcome-hero">
          <div className="ap-welcome-avatar">{initials}</div>
          <div className="ap-welcome-info">
            <div className="ap-welcome-greeting">Institutional Governance & Controller Portal</div>
            <h1 className="ap-welcome-name">Welcome, {auth.profile.name || 'System Administrator'}</h1>
            <div className="ap-welcome-meta">
              <span>Department: <b>Electronics &amp; Telecommunication Engineering (RUET)</b></span>
              <span>•</span>
              <span>Role: <b>System Administrator</b></span>
              <span>•</span>
              <span>Status: <b className="text-success">Active Controller</b></span>
            </div>
          </div>
        </div>

        {/* Metric KPI Cards */}
        <div className="ap-summary-row">
          {statCards.map(s => (
            <div className={`ap-summary-card ap-sum-${s.color}`} key={s.label}>
              <div className="ap-sum-icon">{s.icon}</div>
              <div className="ap-sum-val">{s.value ?? '—'}</div>
              <div className="ap-sum-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Curriculum Architecture & Quick Links */}
        <div className="ap-arch-card">
          <div className="ap-arch-left">
            <div className="ap-arch-badge">CURRICULUM ARCHITECTURE</div>
            <h3 className="ap-arch-title">Department Course Catalog &amp; Syllabus Structure</h3>
            <p className="ap-arch-desc">
              Continuous assessment tracking covers <b>40 courses</b> distributed across <b>8 academic semesters</b> (5 courses per semester) with automated Class Test best-3 averaging, attendance logging, and assignment management.
            </p>
            <div className="ap-arch-tags">
              <span className="ap-tag">40 Total Courses</span>
              <span className="ap-tag">8 Semesters</span>
              <span className="ap-tag">5 Courses / Semester</span>
              <span className="ap-tag">Best 3 of 4 CT Average</span>
            </div>
          </div>
          <div className="ap-arch-right">
            <div className="ap-quick-head">Quick Shortcuts</div>
            <button className="ap-quick-btn" onClick={() => navigateToPage('Course Assignment')}>
              🔗 Course Allocations →
            </button>
            <button className="ap-quick-btn" onClick={() => navigateToPage('Semester Assignment')}>
              🗓️ Semester Progression →
            </button>
            <button className="ap-quick-btn" onClick={() => navigateToPage('User Management')}>
              🛡️ User Account Controls →
            </button>
          </div>
        </div>
      </div>
    );
  } else if(page==='Students') {
    const studentList = (data.students?.students||[]).filter(s=>`${s.roll} ${s.name}`.toLowerCase().includes(search.toLowerCase()));
    body = (
      <div className="ap-main-wrap">
        <div className="ap-section-head">
          <div>
            <h1 className="ap-section-title">Student Roster &amp; Profiles</h1>
            <p className="ap-section-sub">Search and manage enrolled students, series assignments, and authentication status.</p>
          </div>
          <span className="ap-count-badge">{studentList.length} Students</span>
        </div>

        <div className="ap-search-bar">
          <span className="ap-search-icon">🔍</span>
          <input
            className="form-control"
            placeholder="Search students by roll number or name..."
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />
        </div>

        <DataTable
          headers={['Roll','Name','Series','Semester','Email','Status','Action']}
          rows={studentList.map(s=>[
            <b className="text-primary">{s.roll}</b>,
            s.name,
            `Series ${s.series}`,
            `Semester ${s.semester}`,
            s.email||'—',
            <Status value={s.status||'active'}/>,
            <button
              className={`btn btn-sm ${s.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`}
              onClick={()=>toggleUser(s.roll||s.student_id,s.status)}
            >
              {s.status==='inactive'?'Activate':'Deactivate'}
            </button>
          ])}
        />
      </div>
    );
  } else if(page==='Teachers') {
    body = (
      <div className="ap-main-wrap">
        <div className="ap-section-head">
          <div>
            <h1 className="ap-section-title">Faculty &amp; Teacher Directory</h1>
            <p className="ap-section-sub">Inspect registered faculty members, assigned course counts, and access controls.</p>
          </div>
          <span className="ap-count-badge">{teachers.length} Faculty Members</span>
        </div>

        <DataTable
          headers={['Teacher ID','Name','Email','Assigned Courses','Status','Action']}
          rows={teachers.map(t=>[
            <span className="badge text-bg-primary fs-6">{t.teacher_id}</span>,
            <b>{t.name}</b>,
            t.email||'—',
            <span className="badge text-bg-info">{t.assigned_courses} Courses</span>,
            <Status value={t.status||'active'}/>,
            <button
              className={`btn btn-sm ${t.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`}
              onClick={()=>toggleUser(t.teacher_id,t.status)}
            >
              {t.status==='inactive'?'Activate':'Deactivate'}
            </button>
          ])}
        />
      </div>
    );
  } else if(page==='Semester Assignment') {
    body = (
      <div className="ap-main-wrap">
        <div className="ap-section-head">
          <div>
            <h1 className="ap-section-title">Semester Progression &amp; Cohort Assignment</h1>
            <p className="ap-section-sub">Changing a series semester updates only that series' students and course enrollments.</p>
          </div>
          <span className="ap-count-badge">{series.length} Active Series</span>
        </div>
        <SeriesSemesterManager series={series} semesters={semesters} token={auth.token} onSaved={load}/>
      </div>
    );
  } else if(page==='Courses') {
    body = (
      <div className="ap-main-wrap">
        <div className="ap-section-head">
          <div>
            <h1 className="ap-section-title">Course Catalog &amp; Syllabus</h1>
            <p className="ap-section-sub">View syllabus courses, credit hours, semester allocations, and assigned instructors.</p>
          </div>
          <span className="ap-count-badge">{courses.length} Courses</span>
        </div>

        <div className="ap-filter-card">
          <label className="form-label fw-bold mb-1">Filter by Academic Semester</label>
          <div className="row g-2 align-items-center">
            <div className="col-md-4">{semesterPicker}</div>
            <div className="col-md-8">
              {semester && (
                <span className="text-muted small">
                  Showing courses for <b>Semester {semester}</b> · Total: <b>{courses.length} courses</b>
                </span>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="ap-loading">
            <div className="ap-spinner" />
            <span>Loading courses for Semester {semester}…</span>
          </div>
        ) : courseError ? (
          <div className="alert alert-danger">{courseError}</div>
        ) : !semester ? (
          <div className="alert alert-info">Select a semester to view its courses.</div>
        ) : (
          <DataTable
            headers={['Course Code','Course Name','Semester','Type','Credits','Assigned Teacher','Status']}
            rows={courses.map(c=>[
              <span className="badge text-bg-primary">{c.course_code}</span>,
              <b>{c.course_name}</b>,
              `Semester ${c.semester}`,
              <span className="badge text-bg-secondary">{c.course_type}</span>,
              c.credits ?? '3.0',
              c.assigned_teacher ? (
                <span className="text-success fw-bold">
                  {c.assigned_teacher.teacher_id} — {c.assigned_teacher.name}
                </span>
              ) : (
                <span className="text-danger">Unassigned</span>
              ),
              <Status value={c.status||'active'}/>
            ])}
          />
        )}
      </div>
    );
  } else if(page==='Course Assignment') {
    body = (
      <div className="ap-main-wrap">
        <div className="ap-section-head">
          <div>
            <h1 className="ap-section-title">Faculty Course Allocation</h1>
            <p className="ap-section-sub">Assign faculty members to teach specific course offerings for each series and semester.</p>
          </div>
          <span className="ap-count-badge">{(data['course-assignments']?.assignments||[]).length} Assigned</span>
        </div>

        <form className="card card-body ap-assign-form mb-4" onSubmit={assign}>
          <h6 className="fw-bold mb-3 text-dark">Allocate Teacher to Course</h6>
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label small fw-bold">Target Series</label>
              <select className="form-select" name="series">
                {series.map(s=><option key={s.series} value={s.series}>Series {s.series}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Target Semester</label>
              {semesterPicker}
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Select Course</label>
              <select className="form-select" name="course_id" required disabled={!courses.length}>
                {courses.map(c=><option key={c.course_id} value={c.course_id}>{c.course_code} — {c.course_name}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold">Select Faculty Member</label>
              <select className="form-select" name="teacher_id">
                {teachers.map(t=><option key={t.teacher_id} value={t.teacher_id}>{t.teacher_id} — {t.name}</option>)}
              </select>
            </div>
          </div>
          <input type="hidden" name="semester" value={semester}/>
          <div className="mt-3">
            <button className="btn btn-primary" disabled={!courses.length}>
              Assign Course
            </button>
            {!courses.length && <small className="text-muted ms-3">Select a semester with courses available to assign.</small>}
          </div>
        </form>

        <h5 className="fw-bold mb-3 text-dark">Active Allocations</h5>
        <DataTable
          headers={['Course','Series','Semester','Type','Assigned Faculty','Action']}
          rows={(data['course-assignments']?.assignments||[]).map(a=>[
            <span className="badge text-bg-primary">{a.course_code}</span>,
            `Series ${a.series}`,
            `Semester ${a.semester}`,
            a.course_type,
            <b>{a.teacher_code} — {a.teacher_name}</b>,
            <button className="btn btn-sm btn-outline-danger" onClick={()=>unassign(a)}>
              Unassign
            </button>
          ])}
        />
      </div>
    );
  } else if(page==='User Management') {
    const studentUsers = (data.users?.users||[]).filter(u=>u.role==='student' && u.username.toLowerCase().includes(search.toLowerCase()));
    const teacherUsers = (data.users?.users||[]).filter(u=>u.role==='teacher');

    body = (
      <div className="ap-main-wrap">
        <div className="ap-section-head">
          <div>
            <h1 className="ap-section-title">User Accounts &amp; Access Controls</h1>
            <p className="ap-section-sub">Manage system authentication, activate or suspend faculty and student credentials.</p>
          </div>
        </div>

        {/* Teacher Accounts Section */}
        <div className="ap-user-section">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="h5 mb-0 fw-bold">Faculty Accounts</h2>
            <span className="badge text-bg-secondary">{teacherUsers.length} Accounts</span>
          </div>
          <DataTable
            headers={['Teacher ID','Account Status','Action']}
            rows={teacherUsers.map(u=>[
              <span className="badge text-bg-primary fs-6">{u.username}</span>,
              <Status value={u.status}/>,
              <button
                className={`btn btn-sm ${u.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`}
                onClick={()=>toggleUser(u.username,u.status)}
              >
                {u.status==='active'?'Deactivate':'Activate'}
              </button>
            ])}
          />
        </div>

        {/* Student Accounts Section */}
        <div className="ap-user-section mt-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h2 className="h5 mb-0 fw-bold">Student Accounts</h2>
            <span className="badge text-bg-secondary">{studentUsers.length} Accounts</span>
          </div>
          <div className="ap-search-bar mb-3">
            <span className="ap-search-icon">🔍</span>
            <input
              className="form-control"
              placeholder="Filter student accounts by roll or user ID..."
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
          </div>
          <DataTable
            headers={['User ID','Role','Status','Action']}
            rows={studentUsers.map(u=>[
              <b>{u.username}</b>,
              <span className="text-capitalize">{u.role}</span>,
              <Status value={u.status}/>,
              <button
                className={`btn btn-sm ${u.status==='inactive'?'btn-outline-success':'btn-outline-danger'}`}
                onClick={()=>toggleUser(u.username,u.status)}
              >
                {u.status==='active'?'Deactivate':'Activate'}
              </button>
            ])}
          />
        </div>
      </div>
    );
  } else {
    // Change Password
    body = (
      <div className="ap-page-wrap">
        <ChangePassword token={auth.token} onDone={logout}/>
      </div>
    );
  }

  return (
    <div className="ap-shell">
      {/* ── Topbar / Header ── */}
      <header className="ap-header">
        <div className="ap-header-brand">
          <span className="ap-header-logo">🛡️</span>
          <div>
            <div className="ap-header-title">Continuous Assessment &amp; Academic Performance Evaluation</div>
            <div className="ap-header-sub">System Administration &amp; Institutional Controller · RUET</div>
          </div>
        </div>
        <div className="ap-header-right">
          <span className="ap-header-user">
            <span className="ap-user-dot"></span>
            {auth.profile.name || 'System Administrator'}
          </span>
          <button className="ap-logout-btn" onClick={logout}>⎋ Logout</button>
        </div>
      </header>

      <div className="ap-layout">
        {/* ── Sidebar ── */}
        <aside className="ap-sidebar">
          <div className="ap-sidebar-profile">
            <div className="ap-sidebar-avatar">{initials}</div>
            <div className="ap-sidebar-name">{auth.profile.name || 'System Administrator'}</div>
            <div className="ap-sidebar-id">SUPER ADMIN</div>
          </div>

          <nav className="ap-nav">
            {navSections.map(sec => (
              <React.Fragment key={sec.title}>
                <div className="ap-nav-section-title">{sec.title}</div>
                {sec.items.map(item => (
                  <button
                    key={item.id}
                    className={`ap-nav-item ${page === item.id ? 'ap-nav-active' : ''}`}
                    onClick={() => navigateToPage(item.id)}
                  >
                    <span className="ap-nav-icon">{item.icon}</span>
                    <span className="ap-nav-label">{item.label}</span>
                  </button>
                ))}
              </React.Fragment>
            ))}
          </nav>

          <button className="ap-sidebar-logout" onClick={logout}>⎋ Logout</button>
        </aside>

        {/* ── Main Content Area ── */}
        <main className="ap-content">
          {notice && (
            <div className="ap-notice">
              <span>{notice}</span>
              <button className="ap-notice-close" onClick={() => setNotice('')}>✕</button>
            </div>
          )}
          {body}
        </main>
      </div>
    </div>
  );
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

