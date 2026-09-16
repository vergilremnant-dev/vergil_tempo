import { useState, useEffect } from 'react';
import { CalendarPlus, Edit3, X } from 'lucide-react';
import { timesheetService } from '../../services/timesheetService';
import Autocomplete from '../Autocomplete';
import { calculateHours, validateTimesheetForm } from '../../utils/dateUtils';

export default function EditLogModal({ isOpen, logId, onClose, onSuccess, setToast }) {
  const [employees, setEmployees] = useState([]);
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState('');
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [notes, setNotes] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);



  // Fetch candidate list on open
  useEffect(() => {
    if (!isOpen) return;
    async function loadCandidates() {
      try {
        const list = await timesheetService.getEmployeesList();
        setEmployees(list);
        if (list.length > 0 && !logId) {
          // Keep empty initially for manual creation
          setUserId('');
        }
      } catch (err) {
        console.error(err);
      }
    }
    loadCandidates();
  }, [isOpen, logId]);

  // Load log details if editing
  useEffect(() => {
    if (!isOpen || !logId) {
      // Manual Add Defaults
      setDate(new Date().toISOString().split('T')[0]);
      setClockIn('');
      setClockOut('');
      setNotes('');
      setClientCompany('');
      return;
    }

    async function loadLogDetails() {
      setLoading(true);
      try {
        const list = await timesheetService.getAdminTimesheets({ userId: 'all' });
        const log = list.find((t) => t.id === logId);
        if (log) {
          setUserId(log.userId);
          setDate(log.date);
          setClockIn(log.clockIn || '');
          setClockOut(log.clockOut || '');
          setNotes(log.notes || '');
          setClientCompany(log.clientCompany || '');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadLogDetails();
  }, [isOpen, logId]);

  // Auto-populate client company based on selected candidate during creation
  useEffect(() => {
    if (logId) return; // Skip overwrite when editing an existing log
    if (!userId) {
      setClientCompany('');
      return;
    }
    const selectedEmp = employees.find((emp) => emp.id === userId);
    if (selectedEmp) {
      setClientCompany(selectedEmp.clientCompany || 'N/A');
    }
  }, [userId, employees, logId]);

  if (!isOpen) return null;

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

      if (logId) {
        await timesheetService.updateLog(logId, payload);
        setToast({ message: 'Timesheet record adjusted successfully.', type: 'success' });
      } else {
        await timesheetService.createManualLog(payload);
        setToast({ message: 'Manual timesheet entry saved successfully.', type: 'success' });
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      const errMsg = err.response?.data?.error || err.message || 'Failed to save timesheet record.';
      setToast({ message: errMsg, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay backdrop */}
      <div className="absolute inset-0 bg-[#0b0f19]/80 backdrop-blur-sm" onClick={onClose}></div>

      {/* Card panel (max-w-md, high-density professional layout) */}
      <div className="relative z-10 w-full max-w-md glass bg-[#121826]/95 border border-white/5 rounded-2xl overflow-visible shadow-2xl animate-scale-in mx-auto">
        <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between rounded-t-2xl bg-black/10">
          <h3 className="text-sm font-bold flex items-center gap-2 text-white">
            {logId ? (
              <>
                <Edit3 size={15} className="text-[#FF7A00]" />
                <span>Adjust Timesheet Record</span>
              </>
            ) : (
              <>
                <CalendarPlus size={15} className="text-[#FF7A00]" />
                <span>Add Manual Timesheet Entry</span>
              </>
            )}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white rounded transition cursor-pointer" aria-label="Close modal">
            <X size={15} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-[#FF7A00] border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs text-gray-400">Loading details...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="p-5 flex flex-col gap-3.5">
              
              <div className="flex flex-col gap-1 relative">
                <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Candidate</label>
                <Autocomplete
                  id="edit-log-candidate"
                  placeholder="Select or search Candidate..."
                  heightClass="h-11"
                  items={employees.map((emp) => ({
                    value: emp.id,
                    label: emp.name,
                    subtext: emp.clientCompany || 'No Client Assigned'
                  }))}
                  selectedValue={userId}
                  onSelect={(val) => setUserId(val)}
                  disabled={!!logId}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="edit-log-date" className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Date</label>
                <input
                  id="edit-log-date"
                  name="date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-4 h-11 text-sm focus:outline-none focus:border-[#FF7A00] focus:ring-1 focus:ring-[#FF7A00] transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div className="flex flex-col gap-1">
                  <label htmlFor="edit-log-clockin" className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Clock In Time</label>
                  <input
                    id="edit-log-clockin"
                    name="clockIn"
                    type="time"
                    step="1"
                    value={clockIn}
                    onChange={(e) => setClockIn(e.target.value)}
                    className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-4 h-11 text-sm focus:outline-none focus:border-[#FF7A00] focus:ring-1 focus:ring-[#FF7A00] transition"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="edit-log-clockout" className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Clock Out Time</label>
                  <input
                    id="edit-log-clockout"
                    name="clockOut"
                    type="time"
                    step="1"
                    value={clockOut}
                    onChange={(e) => setClockOut(e.target.value)}
                    placeholder="Leave blank"
                    className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-4 h-11 text-sm focus:outline-none focus:border-[#FF7A00] focus:ring-1 focus:ring-[#FF7A00] transition"
                  />
                </div>
              </div>

              {/* Dynamic duration alerts based on scenario */}
              {(() => {
                if (clockIn && clockOut) {
                  const hrs = calculateHours(clockIn, clockOut);
                  if (hrs === null) {
                    return (
                      <div className="text-[10px] text-rose-400 font-semibold flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-xl">
                        <span>Clock-out time cannot be earlier than clock-in time.</span>
                      </div>
                    );
                  }
                  return (
                    <div className="text-[10px] text-emerald-400 font-semibold flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-xl">
                      <span>Calculated Duration:</span>
                      <span className="text-xs font-bold text-white">{hrs} hours</span>
                    </div>
                  );
                } else if (clockIn) {
                  return (
                    <div className="text-[10px] text-[#FF7A00] font-semibold flex items-center justify-between bg-[#FF7A00]/10 border border-[#FF7A00]/20 px-3 py-2 rounded-xl">
                      <span>Calculated Duration:</span>
                      <span>Active / Ongoing</span>
                    </div>
                  );
                } else if (clockOut) {
                  return (
                    <div className="text-[10px] text-[#0ea5e9] font-semibold flex items-center justify-between bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 px-3 py-2 rounded-xl">
                      <span>Calculated Duration:</span>
                      <span>Pending Clock In lookup</span>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="flex flex-col gap-1">
                <label htmlFor="edit-log-notes" className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Work Notes / Tasks</label>
                <textarea
                  id="edit-log-notes"
                  name="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter details of tasks accomplished..."
                  rows={2}
                  className="bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl p-3 text-sm focus:outline-none focus:border-[#FF7A00] focus:ring-1 focus:ring-[#FF7A00] transition resize-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="edit-log-client-display" className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Client Company</label>
                <input
                  id="edit-log-client-display"
                  type="text"
                  readOnly
                  disabled
                  value={clientCompany || 'N/A'}
                  className="w-full h-11 bg-[#1A1A1A] border border-[#2A2A2A] text-gray-400 rounded-xl px-4 text-sm cursor-not-allowed opacity-75 focus:ring-0 focus:border-[#2A2A2A]"
                />
              </div>

            </div>

            <div className="px-5 py-3.5 border-t border-white/5 flex justify-end gap-3 bg-black/10 rounded-b-2xl">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-white/10 hover:border-gray-500 text-gray-300 hover:text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-[#FF7A00] hover:bg-[#FF8C1A] disabled:bg-[#FF7A00]/50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-[#FF7A00]/20 transition cursor-pointer"
              >
                {submitting ? 'Saving...' : logId ? 'Save Changes' : 'Save Entry'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
