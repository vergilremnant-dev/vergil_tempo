import React, { useState, useEffect } from 'react';
import { Users, Search, Download, FileText, Calendar, Filter, CheckCircle2, XCircle, AlertTriangle, DollarSign } from 'lucide-react';
import { timesheetService } from '../../services/timesheetService';
import { useClientCompanies } from '../../context/ClientCompanyContext';

export default function WorkforceSummaryTable({ setToast }) {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedClient, setSelectedClient] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [summaryData, setSummaryData] = useState(null);

  const { companies } = useClientCompanies();

  const yearMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const data = await timesheetService.getWorkforceSummary(selectedYear, selectedMonth, selectedClient);
      setSummaryData(data);
    } catch (err) {
      console.error(err);
      if (setToast) {
        setToast({ message: 'Failed to load workforce audit summary.', type: 'error' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [selectedYear, selectedMonth, selectedClient]);

  const handleDownloadCSV = () => {
    if (!summaryData || !summaryData.summaries) return;
    timesheetService.exportWorkforceSummaryCSV(summaryData, yearMonthStr);
    if (setToast) setToast({ message: 'Master Workforce CSV exported.', type: 'success' });
  };

  const handleDownloadPDF = async () => {
    if (!summaryData || !summaryData.summaries) return;
    try {
      await timesheetService.exportWorkforceSummaryPDF(summaryData, yearMonthStr, selectedClient);
      if (setToast) setToast({ message: 'Master Workforce Audit Report PDF downloaded.', type: 'success' });
    } catch (err) {
      console.error(err);
      if (setToast) setToast({ message: 'Failed to generate PDF report.', type: 'error' });
    }
  };

  const filteredSummaries = (summaryData?.summaries || []).filter((s) => {
    const query = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(query) ||
      s.username.toLowerCase().includes(query) ||
      s.clientCompany.toLowerCase().includes(query)
    );
  });

  const totalBillable = (filteredSummaries || []).reduce((sum, s) => sum + s.billableAmount, 0);
  const totalHours = (filteredSummaries || []).reduce((sum, s) => sum + s.totalHours, 0);

  return (
    <div className="bg-[#111111] border border-[#2A2A2A] rounded-2xl p-6 shadow-xl text-white mt-6">
      {/* Table Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#2A2A2A] pb-5">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Users className="text-[#FF7A00]" size={20} />
            <span>Master Workforce Attendance & Audit Engine</span>
          </h2>
          <p className="text-xs text-[#B3B3B3] mt-0.5">
            Uniform monthly attendance metrics, present/absent days, working hours, and billable totals.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Month Selector */}
          <div className="flex items-center gap-1.5 bg-[#1A1A1A] border border-[#333] rounded-xl px-3 py-1.5">
            <Calendar size={14} className="text-[#FF7A00]" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m} className="bg-[#1A1A1A] text-white">
                  {new Date(2000, m - 1, 1).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>

          {/* Year Selector */}
          <div className="bg-[#1A1A1A] border border-[#333] rounded-xl px-3 py-1.5">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map((y) => (
                <option key={y} value={y} className="bg-[#1A1A1A] text-white">
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Client Filter */}
          <div className="flex items-center gap-1.5 bg-[#1A1A1A] border border-[#333] rounded-xl px-3 py-1.5">
            <Filter size={14} className="text-[#FF7A00]" />
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer max-w-[140px] truncate"
            >
              <option value="ALL" className="bg-[#1A1A1A] text-white">All Clients</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#1A1A1A] text-white">
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Download Buttons */}
          <div className="flex items-center gap-2 ml-auto lg:ml-0">
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition cursor-pointer text-white"
            >
              <Download size={14} className="text-green-400" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#FF7A00] hover:bg-[#FF8C1A] rounded-xl text-xs font-bold transition cursor-pointer text-white shadow-md shadow-[#FF7A00]/20"
            >
              <FileText size={14} />
              <span>Download PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 my-5">
        <div className="bg-[#181818] border border-[#2A2A2A] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/10 text-[#FF7A00] flex items-center justify-center shrink-0">
            <Calendar size={18} />
          </div>
          <div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Working Days</div>
            <div className="text-base font-extrabold text-white">
              {summaryData ? `${summaryData.totalWorkingDays} Days` : '--'}
            </div>
          </div>
        </div>

        <div className="bg-[#181818] border border-[#2A2A2A] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Total Staff</div>
            <div className="text-base font-extrabold text-white">
              {summaryData ? `${filteredSummaries.length} Employees` : '--'}
            </div>
          </div>
        </div>

        <div className="bg-[#181818] border border-[#2A2A2A] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Cumulative Hours</div>
            <div className="text-base font-extrabold text-white">{totalHours.toFixed(1)} hrs</div>
          </div>
        </div>

        <div className="bg-[#181818] border border-[#2A2A2A] rounded-xl p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
            <DollarSign size={18} />
          </div>
          <div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Billable Amount</div>
            <div className="text-base font-extrabold text-emerald-400">${totalBillable.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
        <input
          type="text"
          placeholder="Filter employee name, username or client company..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#161616] border border-[#2E2E2E] focus:border-[#FF7A00] rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-gray-500 outline-none transition"
        />
      </div>

      {/* Data Table */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2">
          <div className="w-7 h-7 border-2 border-[#FF7A00] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Loading Workforce Audit Data...</span>
        </div>
      ) : filteredSummaries.length === 0 ? (
        <div className="py-10 text-center text-xs text-gray-400">
          No employee records found for the selected period or filters.
        </div>
      ) : (
        <div className="overflow-x-auto border border-[#222] rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#161616] text-[#A0A0A0] uppercase tracking-wider text-[10px] font-bold border-b border-[#2A2A2A]">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Client MNC</th>
                <th className="px-4 py-3 text-center">Working Days</th>
                <th className="px-4 py-3 text-center">Present</th>
                <th className="px-4 py-3 text-center">Leaves</th>
                <th className="px-4 py-3 text-center">Absent</th>
                <th className="px-4 py-3 text-right">Hours</th>
                <th className="px-4 py-3 text-right">Billable Total</th>
                <th className="px-4 py-3 text-center">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222]">
              {filteredSummaries.map((s) => (
                <tr key={s.userId} className="hover:bg-[#161616] transition">
                  <td className="px-4 py-3.5">
                    <div className="font-bold text-white">{s.name}</div>
                    <div className="text-[10px] text-gray-500">@{s.username}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-orange-500/10 text-[#FF7A00] rounded-md border border-orange-500/20">
                      {s.clientCompany}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center font-semibold text-gray-300">
                    {s.totalWorkingDays} Days
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="font-bold text-emerald-400">{s.presentDays}</span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="font-bold text-blue-400">{s.leaveDays}</span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`font-bold ${s.absentDays > 0 ? 'text-rose-400' : 'text-gray-500'}`}>
                      {s.absentDays}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono font-bold text-white">
                    {s.totalHours.toFixed(1)} hrs
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-400">
                    ${s.billableAmount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${
                        s.attendanceScore >= 95
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : s.attendanceScore >= 85
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {s.attendanceScore}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
