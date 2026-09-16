import React, { useState, useEffect, useCallback } from 'react';
import { Radio, History, SlidersHorizontal, Trash2, Edit3, ChevronDown, ChevronUp, RotateCw } from 'lucide-react';
import { timesheetService } from '../services/timesheetService';
import { useClientCompanies } from '../context/ClientCompanyContext';
import api from '../services/api';
import LiveStatusWidget from '../components/admin/LiveStatusWidget';
import EditLogModal from '../components/admin/EditLogModal';
import AttendanceTimeline from '../components/common/AttendanceTimeline';
import Toast from '../components/common/Toast';

export default function AdminAttendance() {
  const { companies } = useClientCompanies();
  const [activeTab, setActiveTab] = useState('live'); // 'live' or 'history'
  const [employees, setEmployees] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Filters for History Tab
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterClient, setFilterClient] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Table selections
  const [selectedTimesheets, setSelectedTimesheets] = useState([]);
  const [expandedLogs, setExpandedLogs] = useState([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState(null);

  // Load basic data: employees & leaves
  useEffect(() => {
    async function loadMetadata() {
      try {
        const empList = await timesheetService.getEmployeesList();
        setEmployees(empList);
        const leavesRes = await api.get('/admin/leaves');
        setLeaves(leavesRes.data || []);
      } catch (err) {
        console.error(err);
      }
    }
    loadMetadata();
  }, []);

  // Main load function for timesheets
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // Build history filters
      const filters = {};
      if (filterEmployee !== 'all') filters.userId = filterEmployee;
      if (filterClient !== 'all') filters.clientCompany = filterClient;
      if (filterStartDate) filters.startDate = filterStartDate;
      if (filterEndDate) filters.endDate = filterEndDate;

      const isFiltersEmpty = Object.keys(filters).length === 0;

      if (isFiltersEmpty) {
        // Single API query fetching history (including today)
        const historyTimesheets = await timesheetService.getAdminTimesheets({});
        setLogs(historyTimesheets);

        // Extract today's logs locally
        const todayTimesheets = historyTimesheets.filter(t => t.date === todayStr);
        setTodayLogs(todayTimesheets);

        setSelectedTimesheets((prev) => prev.filter((id) => historyTimesheets.some((t) => t.id === id)));
      } else {
        // Parallel queries when filters are active
        const [todayTimesheets, historyTimesheets] = await Promise.all([
          timesheetService.getAdminTimesheets({ startDate: todayStr, endDate: todayStr }),
          timesheetService.getAdminTimesheets(filters)
        ]);

        setTodayLogs(todayTimesheets);
        setLogs(historyTimesheets);

        setSelectedTimesheets((prev) => prev.filter((id) => historyTimesheets.some((t) => t.id === id)));
      }
    } catch (err) {
      console.error(err);
      setToast({ message: 'Error retrieving timesheet logs.', type: 'error' });
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [filterEmployee, filterClient, filterStartDate, filterEndDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleClearFilters = () => {
    setFilterEmployee('all');
    setFilterClient('all');
    setFilterStartDate('');
    setFilterEndDate('');
  };

  // Log Actions
  const handleEditClick = (logId) => {
    setSelectedLogId(logId);
    setIsEditOpen(true);
  };

  const handleDeleteLog = async (logId) => {
    if (confirm('Are you sure you want to permanently delete this timesheet entry?')) {
      try {
        await timesheetService.deleteLog(logId);
        setToast({ message: 'Timesheet record deleted', type: 'success' });
        loadData(true);
      } catch {
        setToast({ message: 'Failed to delete record.', type: 'error' });
      }
    }
  };

  // Bulk deletion
  const toggleSelection = (id) => {
    setSelectedTimesheets((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (logs.length === 0) return;
    if (selectedTimesheets.length === logs.length) {
      setSelectedTimesheets([]);
    } else {
      setSelectedTimesheets(logs.map((log) => log.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTimesheets.length === 0) return;
    const count = selectedTimesheets.length;
    if (confirm(`Delete the ${count} selected timesheet records permanently?`)) {
      try {
        await timesheetService.deleteLogs(selectedTimesheets);
        setToast({ message: `${count} timesheet records deleted`, type: 'success' });
        setSelectedTimesheets([]);
        loadData(true);
      } catch {
        setToast({ message: 'Failed to delete selected records.', type: 'error' });
      }
    }
  };

  // Timeline expand toggle
  const toggleTimesheetExpand = (id) => {
    setExpandedLogs((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Date and Time formatters
  const formatDateFriendly = (dStr) => {
    const d = new Date(dStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime12h = (tStr) => {
    if (!tStr) return '-';
    const [h, m] = tStr.split(':');
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const displayHr = hr % 12 || 12;
    return `${displayHr}:${m} ${ampm}`;
  };

  // Get client company list from context

  return (
    <div className="flex flex-col gap-6 animate-fade-in text-white">
      {/* Toast Alert */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Page Header */}
      <div className="border-b border-[#2A2A2A] pb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
            <Radio className="text-[#FF7A00]" size={24} />
            <span>Attendance Center</span>
          </h1>
          <p className="text-xs text-[#B3B3B3] mt-1">
            Monitor real-time shifts, run audits on history sheets, and adjust incorrect clock logs.
          </p>
        </div>

        {/* Tab Selection */}
        <div className="flex border border-white/5 gap-1 p-1 bg-black/25 rounded-xl self-start md:self-auto">
          <button
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'live'
                ? 'bg-[#FF7A00] text-white shadow'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Radio size={13} className={activeTab === 'live' ? 'animate-pulse text-white' : ''} />
            <span>Live Attendance</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[#FF7A00] text-white shadow'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <History size={13} />
            <span>Attendance History</span>
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      {loading ? (
        <div className="min-h-[40vh] w-full flex flex-col items-center justify-center gap-3">
          <RotateCw className="w-8 h-8 text-[#FF7A00] animate-spin" />
          <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Loading attendance sheets...</span>
        </div>
      ) : activeTab === 'live' ? (
        <div className="animate-fade-in w-full">
          <LiveStatusWidget
            employees={employees}
            todayLogs={todayLogs}
            leaves={leaves}
            onRefresh={() => loadData(true)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6 animate-fade-in">
          {/* History Search Filters Form */}
          <div className="bg-[#111111] border border-[#2A2A2A] p-6 rounded-2xl shadow-xl">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-500/95 border-b border-white/5 pb-2 mb-4">
              <SlidersHorizontal size={14} />
              <span>Filter & Search History Logs</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Candidate */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Candidate</label>
                <select
                  value={filterEmployee}
                  onChange={(e) => setFilterEmployee(e.target.value)}
                  className="h-11 bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-3 text-xs outline-none focus:border-[#FF7A00] transition cursor-pointer"
                >
                  <option value="all">All Candidates</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} (Placed: {emp.clientCompany})
                    </option>
                  ))}
                </select>
              </div>

              {/* Client Company */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Client Company</label>
                <select
                  value={filterClient}
                  onChange={(e) => setFilterClient(e.target.value)}
                  className="h-11 bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-3 text-xs outline-none focus:border-[#FF7A00] transition cursor-pointer"
                >
                  <option value="all">All Clients</option>
                  {companies.map((client) => (
                    <option key={client} value={client}>{client}</option>
                  ))}
                </select>
              </div>

              {/* Start Date */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Start Date</label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="h-11 bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-3 text-xs outline-none focus:border-[#FF7A00] transition"
                />
              </div>

              {/* End Date */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">End Date</label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="h-11 bg-[#1A1A1A] border border-[#2A2A2A] text-white rounded-xl px-3 text-xs outline-none focus:border-[#FF7A00] transition"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3.5 border-t border-white/5 pt-4 mt-4">
              <button
                onClick={handleClearFilters}
                className="px-4 py-2 border border-white/5 hover:bg-white/5 text-gray-400 hover:text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Reset Filters
              </button>
              <button
                onClick={() => loadData(false)}
                className="px-6 py-2.5 bg-[#FF7A00] hover:bg-[#FF8C1A] text-white rounded-xl text-xs font-bold shadow-md shadow-[#FF7A00]/10 transition cursor-pointer"
              >
                Apply Search
              </button>
            </div>
          </div>

          {/* Master Logs Table */}
          <div className="bg-[#111111] border border-[#2A2A2A] rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4.5 border-b border-[#2A2A2A] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-black/20">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <History size={15} className="text-[#FF7A00]" />
                <span>Historical Attendance Logs Directory ({logs.length})</span>
              </h2>

              {selectedTimesheets.length > 0 && (
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1.5 px-4.5 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold shadow transition cursor-pointer self-start sm:self-auto"
                >
                  <Trash2 size={13} />
                  <span>Delete Selected ({selectedTimesheets.length})</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs md:text-sm">
                <thead>
                  <tr className="border-b border-[#2A2A2A] bg-black/40 text-gray-400 uppercase text-[9px] tracking-wider font-bold">
                    <th className="w-12 px-6 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={logs.length > 0 && selectedTimesheets.length === logs.length}
                        onChange={toggleSelectAll}
                        className="cursor-pointer rounded border-[#2A2A2A] text-[#FF7A00]"
                      />
                    </th>
                    <th className="px-6 py-4">Employee</th>
                    <th className="px-6 py-4">Client Company</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Clock In</th>
                    <th className="px-6 py-4">Clock Out</th>
                    <th className="px-6 py-4">Duration</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Task Notes</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2A2A2A] text-gray-300">
                  {logs.map((log, index) => {
                    const candidate = employees.find((emp) => emp.id === log.userId) || { name: 'Unknown Candidate' };
                    const isExpanded = expandedLogs.includes(log.id);
                    const isChecked = selectedTimesheets.includes(log.id);
                    return (
                      <React.Fragment key={log.id}>
                        <tr className={`hover:bg-white/[0.01] transition ${index % 2 === 0 ? 'bg-black/10' : ''}`}>
                          <td className="px-6 py-3.5 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelection(log.id)}
                              className="cursor-pointer rounded border-[#2A2A2A] text-[#FF7A00]"
                            />
                          </td>
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleTimesheetExpand(log.id)}
                                className="p-1 border border-white/5 hover:border-[#FF7A00]/50 hover:bg-[#FF7A00]/10 text-gray-500 hover:text-white rounded-lg transition cursor-pointer"
                              >
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                              <span className="font-bold text-white">{candidate.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 font-semibold text-[#FF7A00]">{log.clientCompany || 'N/A'}</td>
                          <td className="px-6 py-3.5 font-medium">{formatDateFriendly(log.date)}</td>
                          <td className="px-6 py-3.5 font-mono text-xs">{formatTime12h(log.clockIn)}</td>
                          <td className="px-6 py-3.5 font-mono text-xs">
                            {log.clockOut ? (
                              formatTime12h(log.clockOut)
                            ) : (
                              <span className="text-[#FF7A00] animate-pulse font-semibold">Active...</span>
                            )}
                          </td>
                          <td className="px-6 py-3.5 font-bold text-white">
                            {log.hours !== null && log.hours !== undefined ? `${Number(log.hours).toFixed(2)} hrs` : (log.clockOut ? '--' : 'In Progress')}
                          </td>
                          <td className="px-6 py-3.5">
                            <span className={`px-2 py-0.5 text-[9px] font-extrabold rounded-lg border uppercase tracking-wider whitespace-nowrap inline-block ${
                              log.status === 'ACTIVE' 
                                ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                                : log.status === 'LATE_CLOCK_IN'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  : 'bg-orange-500/10 text-[#FF7A00] border-orange-500/20'
                            }`}>
                              {log.status === 'ACTIVE' 
                                ? 'Active' 
                                : log.status === 'LATE_CLOCK_IN'
                                  ? 'Late In'
                                  : 'Completed'}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-gray-500 italic max-w-[150px] truncate" title={log.notes}>
                            {log.notes || '-'}
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <div className="inline-flex gap-2">
                              <button
                                onClick={() => handleEditClick(log.id)}
                                className="p-1.5 border border-white/5 hover:border-[#FF7A00]/50 hover:bg-[#FF7A00]/10 text-gray-400 hover:text-white rounded-xl transition cursor-pointer"
                                title="Edit Record"
                              >
                                <Edit3 size={12} />
                              </button>
                              <button
                                onClick={() => handleDeleteLog(log.id)}
                                className="p-1.5 border border-rose-500/20 hover:border-rose-500 hover:bg-rose-500/10 text-rose-400 hover:text-white rounded-xl transition cursor-pointer"
                                title="Delete Record"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-black/30">
                            <td colSpan={10} className="px-10 py-6 border-b border-[#2A2A2A]">
                              <div className="max-w-4xl mx-auto">
                                <AttendanceTimeline log={log} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-gray-500">
                        <History size={22} className="mx-auto text-gray-600 mb-2" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">No attendance history records found.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Timesheet Modal */}
      <EditLogModal 
        isOpen={isEditOpen}
        logId={selectedLogId}
        onClose={() => setIsEditOpen(false)}
        onSuccess={() => loadData(true)}
        setToast={setToast}
      />
    </div>
  );
}
