import React, { useState } from 'react';
import { FileText, Download, FileDown, Calendar, RotateCw } from 'lucide-react';
import { timesheetService } from '../services/timesheetService';
import MonthlyDownloadModal from '../components/admin/MonthlyDownloadModal';
import HolidayManagementModal from '../components/admin/HolidayManagementModal';
import WorkforceSummaryTable from '../components/admin/WorkforceSummaryTable';
import Toast from '../components/common/Toast';

export default function AdminReports() {
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [isHolidayOpen, setIsHolidayOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState(null);

  const handleExportMaster = async () => {
    setExporting(true);
    try {
      await timesheetService.exportMasterLogs();
      setToast({ message: 'Master timesheet CSV compiled and downloaded.', type: 'success' });
    } catch (err) {
      console.error(err);
      setToast({ message: 'Failed to compile master logs.', type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in text-white">
      {/* Toast Alert */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Page Header */}
      <div className="border-b border-[#2A2A2A] pb-5">
        <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
          <FileText className="text-[#FF7A00]" size={24} />
          <span>Reports & Analytics</span>
        </h1>
        <p className="text-xs text-[#B3B3B3] mt-1">
          Generate monthly attendance reports, download master spreadsheets, or manage official holiday calendars.
        </p>
      </div>

      {/* Grid of Action Panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-2">
        
        {/* Action 1: Monthly Attendance PDF Report */}
        <div className="bg-[#111111] border border-[#2A2A2A] rounded-2xl p-6 shadow-xl flex flex-col justify-between hover:border-[#FF7A00]/40 transition duration-300 min-h-[220px]">
          <div className="flex flex-col gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-500/10 text-[#FF7A00] flex items-center justify-center shrink-0">
              <FileDown size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Monthly PDF Report</h3>
              <p className="text-[11px] text-gray-500 font-medium mt-1 leading-normal">
                Compile and download official attendance summaries as professional PDFs, structured by candidate, month, and client MNC.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsDownloadOpen(true)}
            className="w-full mt-4 py-2.5 bg-[#FF7A00] hover:bg-[#FF8C1A] text-white text-xs font-bold rounded-xl transition cursor-pointer text-center"
          >
            Generate PDF
          </button>
        </div>

        {/* Action 2: Export Master CSV */}
        <div className="bg-[#111111] border border-[#2A2A2A] rounded-2xl p-6 shadow-xl flex flex-col justify-between hover:border-[#FF7A00]/40 transition duration-300 min-h-[220px]">
          <div className="flex flex-col gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-500/10 text-[#FF7A00] flex items-center justify-center shrink-0">
              {exporting ? (
                <RotateCw size={20} className="animate-spin text-[#FF7A00]" />
              ) : (
                <Download size={20} />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Export Master CSV</h3>
              <p className="text-[11px] text-gray-500 font-medium mt-1 leading-normal">
                Export all historical database timesheet records into a clean comma-separated values (CSV) spreadsheet for Excel audits.
              </p>
            </div>
          </div>
          <button
            onClick={handleExportMaster}
            disabled={exporting}
            className="w-full mt-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-[#FF7A00]/40 text-white text-xs font-bold rounded-xl transition cursor-pointer text-center"
          >
            {exporting ? 'Compiling CSV...' : 'Download CSV'}
          </button>
        </div>

        {/* Action 3: Holiday Calendar Management */}
        <div className="bg-[#111111] border border-[#2A2A2A] rounded-2xl p-6 shadow-xl flex flex-col justify-between hover:border-[#FF7A00]/40 transition duration-300 min-h-[220px]">
          <div className="flex flex-col gap-3">
            <div className="w-11 h-11 rounded-xl bg-orange-500/10 text-[#FF7A00] flex items-center justify-center shrink-0">
              <Calendar size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Holiday Management</h3>
              <p className="text-[11px] text-gray-500 font-medium mt-1 leading-normal">
                Configure calendar holiday events for automatic exclusion from absence markers, clock blockages, and email alerts.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsHolidayOpen(true)}
            className="w-full mt-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-[#FF7A00]/40 text-white text-xs font-bold rounded-xl transition cursor-pointer text-center"
          >
            Configure Holidays
          </button>
        </div>

      </div>

      {/* Workforce Audit & Attendance Summary Engine */}
      <WorkforceSummaryTable setToast={setToast} />

      {/* Modals Hooks */}
      <MonthlyDownloadModal 
        isOpen={isDownloadOpen}
        onClose={() => setIsDownloadOpen(false)}
        setToast={setToast}
      />

      <HolidayManagementModal
        isOpen={isHolidayOpen}
        onClose={() => setIsHolidayOpen(false)}
        setToast={setToast}
      />
    </div>
  );
}
