import React, { useState, useEffect } from 'react';
import { CalendarPlus, UserCheck, RotateCw } from 'lucide-react';
import { timesheetService } from '../services/timesheetService';
import Autocomplete from '../components/Autocomplete';
import Toast from '../components/common/Toast';
import { calculateHours, validateTimesheetForm } from '../utils/dateUtils';

export default function AdminManualEntry() {
  const [employees, setEmployees] = useState([]);
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [notes, setNotes] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);



  // Fetch candidate list on mount
  useEffect(() => {
    async function loadCandidates() {
      try {
        const list = await timesheetService.getEmployeesList();
        setEmployees(list);
      } catch (err) {
        console.error(err);
        setToast({ message: 'Error retrieving candidates.', type: 'error' });
      } finally {
        setLoading(false);
      }
    }
    loadCandidates();
  }, []);

  // Auto-populate client company based on selected candidate
  useEffect(() => {
    if (!userId) {
      setClientCompany('');
      return;
    }
    const selectedEmp = employees.find((emp) => emp.id === userId);
    if (selectedEmp) {
      setClientCompany(selectedEmp.clientCompany || 'N/A');
    }
  }, [userId, employees]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validation = validateTimesheetForm(userId, clientCompany, clockIn, clockOut);
    if (!validation.isValid) {
      setToast({ message: validation.error, type: 'error' });
      return;
    }

    const trimmedClientCompany = (clientCompany || '').trim();

    setSubmitting(true);
    try {
      const payload = {
        userId,
        date,
        clockIn: clockIn || null,
        clockOut: clockOut || null,
        notes,
        clientCompany: trimmedClientCompany,
      };

      await timesheetService.createManualLog(payload);
      setToast({ message: 'Manual timesheet entry saved successfully.', type: 'success' });
      
      // Reset form fields
      setUserId('');
      setClockIn('');
      setClockOut('');
      setNotes('');
      setClientCompany('');
    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.error || err.message || 'Failed to save timesheet record.';
      setToast({ message: errMsg, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in text-white max-w-xl mx-auto">
      {/* Toast Alerts */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Page Header */}
      <div className="border-b border-[#2A2A2A] pb-5">
        <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
          <CalendarPlus className="text-[#FF7A00]" size={24} />
          <span>Manual Entry Form</span>
        </h1>
        <p className="text-xs text-[#B3B3B3] mt-1">
          Record attendance data offline or append missed timesheet entries for candidates.
        </p>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3">
          <RotateCw className="w-8 h-8 text-[#FF7A00] animate-spin" />
          <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Loading form...</span>
        </div>
      ) : (
        <div className="bg-[#111111] border border-[#2A2A2A] rounded-2xl shadow-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#2A2A2A] bg-black/20">
            <h3 className="text-sm font-bold flex items-center gap-2 text-white">
              <UserCheck size={14} className="text-[#FF7A00]" />
              <span>Timesheet Entry Form</span>
            </h3>
          </div>

          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
            {/* Candidate Autocomplete */}
            <div className="flex flex-col gap-1.5 relative">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Candidate</label>
              <Autocomplete
                id="manual-candidate-autocomplete"
                placeholder="Select or search Candidate..."
                heightClass="h-11"
                items={employees.map((emp) => ({
                  value: emp.id,
                  label: emp.name,
                  subtext: emp.clientCompany || 'No Client Assigned'
                }))}
                selectedValue={userId}
                onSelect={(val) => setUserId(val)}
              />
            </div>

            {/* Date Input */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="manual-date-input" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Date</label>
              <input
                id="manual-date-input"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-4 h-11 text-xs focus:outline-none focus:border-[#FF7A00] transition"
              />
            </div>

            {/* Shift Times */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="manual-in-input" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Clock In Time</label>
                <input
                  id="manual-in-input"
                  type="time"
                  step="1"
                  value={clockIn}
                  onChange={(e) => setClockIn(e.target.value)}
                  className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-4 h-11 text-xs focus:outline-none focus:border-[#FF7A00] transition"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="manual-out-input" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Clock Out Time</label>
                <input
                  id="manual-out-input"
                  type="time"
                  step="1"
                  value={clockOut}
                  onChange={(e) => setClockOut(e.target.value)}
                  className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-4 h-11 text-xs focus:outline-none focus:border-[#FF7A00] transition"
                />
              </div>
            </div>

            {/* Dynamic Duration Alert */}
            {(() => {
              if (clockIn && clockOut) {
                const hrs = calculateHours(clockIn, clockOut);
                if (hrs === null) {
                  return (
                    <div className="text-[10px] text-rose-400 font-semibold flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 px-3.5 py-2 rounded-xl">
                      <span>Clock-out time cannot be earlier than clock-in time.</span>
                    </div>
                  );
                }
                return (
                  <div className="text-[10px] text-emerald-400 font-semibold flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 rounded-xl">
                    <span>Calculated Duration:</span>
                    <span className="text-xs font-bold text-white">{hrs} hours</span>
                  </div>
                );
              } else if (clockIn) {
                return (
                  <div className="text-[10px] text-[#FF7A00] font-semibold flex items-center justify-between bg-[#FF7A00]/10 border border-[#FF7A00]/20 px-3.5 py-2.5 rounded-xl">
                    <span>Calculated Duration:</span>
                    <span>Active / Ongoing Shift</span>
                  </div>
                );
              } else if (clockOut) {
                return (
                  <div className="text-[10px] text-[#0ea5e9] font-semibold flex items-center justify-between bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 px-3.5 py-2.5 rounded-xl">
                    <span>Calculated Duration:</span>
                    <span>Awaiting Clock In match</span>
                  </div>
                );
              }
              return null;
            })()}

            {/* Work Notes */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="manual-notes-input" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Work Notes / Tasks</label>
              <textarea
                id="manual-notes-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter details of tasks accomplished..."
                rows={3}
                className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl p-3.5 text-xs focus:outline-none focus:border-[#FF7A00] transition resize-none"
              />
            </div>

            {/* Client Display */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="manual-client-display" className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Client Company</label>
              <input
                id="manual-client-display"
                type="text"
                readOnly
                disabled
                value={clientCompany || 'N/A'}
                className="w-full h-11 bg-[#1A1A1A] border border-[#2A2A2A] text-gray-400 rounded-xl px-4 text-xs cursor-not-allowed opacity-75 focus:ring-0 focus:border-[#2A2A2A]"
              />
            </div>

            <div className="border-t border-white/5 pt-4 mt-2 flex justify-end gap-3 bg-black/10 -mx-6 -mb-6 p-6 rounded-b-2xl">
              <button
                type="button"
                onClick={() => {
                  setUserId('');
                  setClockIn('');
                  setClockOut('');
                  setNotes('');
                  setClientCompany('');
                }}
                className="px-5 py-2.5 border border-white/10 hover:border-gray-500 text-gray-300 hover:text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Clear Form
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 bg-[#FF7A00] hover:bg-[#FF8C1A] disabled:bg-[#FF7A00]/50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-[#FF7A00]/20 transition cursor-pointer"
              >
                {submitting ? 'Saving...' : 'Submit Entry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
