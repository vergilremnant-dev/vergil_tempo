import api, { isMockMode } from './api';
import { getTimesheets, saveTimesheets, getUsers, saveUsers, getHolidays, saveHolidays } from './mockDb';
// eslint-disable-next-line no-unused-vars
import { API_URL } from '../config/api';
import { getDeviceMetadata } from '../utils/deviceMetadata';

// Offline Queue Helpers
export const getOfflineQueue = () => {
  try {
    const queue = localStorage.getItem('vt_offline_queue');
    return queue ? JSON.parse(queue) : [];
  } catch (e) {
    console.error("Error reading offline queue", e);
    return [];
  }
};

export const saveOfflineQueue = (queue) => {
  try {
    localStorage.setItem('vt_offline_queue', JSON.stringify(queue));
  } catch (e) {
    console.error("Error saving offline queue", e);
  }
};

export const getEmployeeCurrency = (userId) => {
  try {
    const stored = localStorage.getItem('vt_user_currencies');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed[userId]) {
        return parsed[userId];
      }
    }
  } catch (e) {
    console.error('Error reading currency from localStorage', e);
  }
  return 'USD';
};

export const getCurrencySymbol = (userId) => {
  const currency = getEmployeeCurrency(userId);
  if (currency === 'INR') return '₹';
  if (currency === 'EUR') return '€';
  return '$';
};

export const setEmployeeCurrency = (userId, currency) => {
  try {
    const stored = localStorage.getItem('vt_user_currencies') || '{}';
    const parsed = JSON.parse(stored);
    parsed[userId] = currency;
    localStorage.setItem('vt_user_currencies', JSON.stringify(parsed));
  } catch (e) {
    console.error('Error writing currency to localStorage', e);
  }
};

export const triggerSync = () => {
  try {
    localStorage.setItem('vt_sync_trigger', Date.now().toString());
  } catch (e) {
    console.error('Error triggering sync', e);
  }
};

export const timesheetService = {
  // --- EMPLOYEE TIMESHEET FUNCTIONS ---
  getActiveClockIn: async (userId) => {
    // If offline, read active shift from localStorage fallback
    if (!navigator.onLine) {
      try {
        const active = localStorage.getItem('vt_active_shift');
        if (active) {
          const parsed = JSON.parse(active);
          if (parsed.userId === userId) {
            return { hasActive: true, log: parsed };
          }
        }
      } catch (e) {
        console.error("Error reading offline active shift", e);
      }
      return { hasActive: false, log: null };
    }

    if (isMockMode()) {
      const logs = getTimesheets();
      const active = logs.find((t) => t.userId === userId && t.clockOut === null);
      if (active) {
        localStorage.setItem('vt_active_shift', JSON.stringify(active));
      } else {
        localStorage.removeItem('vt_active_shift');
      }
      return { hasActive: !!active, log: active || null };
    } else {
      try {
        const response = await api.get('/timesheets/active');
        if (response.data.hasActive) {
          localStorage.setItem('vt_active_shift', JSON.stringify(response.data.log));
        } else {
          localStorage.removeItem('vt_active_shift');
        }
        return response.data;
      } catch (err) {
        // Fallback if API request fails
        const active = localStorage.getItem('vt_active_shift');
        if (active) {
          const parsed = JSON.parse(active);
          if (parsed.userId === userId) {
            return { hasActive: true, log: parsed };
          }
        }
        throw err;
      }
    }
  },

  clockIn: async (userId) => {
    const metadata = getDeviceMetadata();

    // If offline, queue request
    if (!navigator.onLine) {
      const queue = getOfflineQueue();
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0];

      // Check active
      const activeStr = localStorage.getItem('vt_active_shift');
      if (activeStr) {
        const active = JSON.parse(activeStr);
        if (active.clockOut === null) {
          throw new Error('Active shift already exists');
        }
      }


      let clientCompany = 'N/A';
      try {
        const storedUser = localStorage.getItem('vt_user');
        if (storedUser) {
          clientCompany = JSON.parse(storedUser).clientCompany || 'N/A';
        }
      } catch (e) {
        console.warn('Error reading stored user for clientCompany fallback', e);
      }

      const tempLog = {
        id: `offline-log-${Date.now()}`,
        userId: userId,
        date: todayStr,
        clockIn: timeStr,
        clockOut: null,
        hours: 0,
        notes: '',
        clientCompany: clientCompany,
        status: 'ACTIVE',
        isOfflinePending: true
      };

      queue.push({
        id: `q-${Date.now()}`,
        action: 'CLOCK_IN',
        userId: userId,
        deviceTime: Date.now(),
        deviceMetadata: metadata,
        clientCompany: clientCompany
      });
      saveOfflineQueue(queue);

      localStorage.setItem('vt_active_shift', JSON.stringify(tempLog));

      if (isMockMode()) {
        const logs = getTimesheets();
        logs.push(tempLog);
        saveTimesheets(logs);
      }

      triggerSync();
      return { message: 'Clocked in locally (Offline)', log: tempLog };
    }

    if (isMockMode()) {
      const logs = getTimesheets();
      const users = getUsers();
      const currentUser = users.find((u) => u.id === userId || String(u.id) === String(userId));
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0];

      // Find if we already have a timesheet for today
      let todayLog = logs.find((t) => t.userId === userId && t.date === todayStr);

      if (todayLog) {
        const hasActive = todayLog.sessions && todayLog.sessions.some(s => s.clockOut === null);
        if (hasActive || todayLog.clockOut === null) {
          throw new Error('Active shift already exists');
        }

        const newSession = {
          id: `sess-${Date.now()}`,
          clockIn: timeStr,
          clockOut: null,
          hours: 0
        };

        if (!todayLog.sessions) todayLog.sessions = [];
        todayLog.sessions.push(newSession);
        todayLog.clockOut = null; // Set active again
        todayLog.status = 'ACTIVE';

        const idx = logs.findIndex((t) => t.id === todayLog.id);
        logs[idx] = todayLog;
        saveTimesheets(logs);
        localStorage.setItem('vt_active_shift', JSON.stringify(todayLog));
        triggerSync();
        return { message: 'Clocked in successfully', log: todayLog };
      } else {
        const hasAnyActive = logs.some((t) => t.userId === userId && t.clockOut === null);
        if (hasAnyActive) {
          throw new Error('Active shift already exists');
        }

        const newSession = {
          id: `sess-${Date.now()}`,
          clockIn: timeStr,
          clockOut: null,
          hours: 0
        };

        const newLog = {
          id: `log-${Date.now()}`,
          userId: userId,
          date: todayStr,
          clockIn: timeStr,
          clockOut: null,
          hours: 0,
          notes: '',
          clientCompany: currentUser ? currentUser.clientCompany : 'N/A',
          status: 'ACTIVE',
          browser: metadata.browser,
          operatingSystem: metadata.operatingSystem,
          deviceType: metadata.deviceType,
          screenResolution: metadata.screenResolution,
          ipAddress: '127.0.0.1',
          userAgent: navigator.userAgent,
          sessions: [newSession]
        };

        logs.push(newLog);
        saveTimesheets(logs);
        localStorage.setItem('vt_active_shift', JSON.stringify(newLog));
        triggerSync();
        return { message: 'Clocked in successfully', log: newLog };
      }
    } else {
      const response = await api.post('/timesheets/clock-in', {
        browser: metadata.browser,
        operatingSystem: metadata.operatingSystem,
        deviceType: metadata.deviceType,
        screenResolution: metadata.screenResolution,
        timezoneOffset: new Date().getTimezoneOffset()
      });
      if (response.data && response.data.log) {
        localStorage.setItem('vt_active_shift', JSON.stringify(response.data.log));
      }
      triggerSync();
      return response.data;
    }
  },

  clockOut: async (activeClockId, notes, recoveryClockOut, recoveryClockOutDate) => {
    const metadata = getDeviceMetadata();

    // If offline, queue request
    if (!navigator.onLine) {
      const queue = getOfflineQueue();
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0];

      const activeStr = localStorage.getItem('vt_active_shift');
      if (!activeStr) {
        throw new Error('No active shift found');
      }

      const log = JSON.parse(activeStr);
      log.clockOut = timeStr;
      log.notes = notes.trim();
      log.status = 'COMPLETED';
      delete log.isOfflinePending;

      const inTime = new Date(`${log.date}T${log.clockIn}`);
      const outTime = new Date(`${todayStr}T${timeStr}`);
      let diffHours = (outTime - inTime) / 3600000;
      if (diffHours < 0) diffHours = 0;
      log.hours = parseFloat(diffHours.toFixed(2));

      queue.push({
        id: `q-${Date.now()}`,
        action: 'CLOCK_OUT',
        activeClockId: activeClockId || log.id,
        userId: log.userId,
        notes: notes,
        deviceTime: Date.now(),
        deviceMetadata: metadata
      });
      saveOfflineQueue(queue);

      localStorage.removeItem('vt_active_shift');

      if (isMockMode()) {
        const logs = getTimesheets();
        const idx = logs.findIndex(t => t.id === activeClockId || (t.userId === log.userId && t.clockOut === null));
        if (idx !== -1) {
          logs[idx] = log;
          saveTimesheets(logs);
        }
      }

      triggerSync();
      return { message: 'Clocked out locally (Offline)', log };
    }

    if (isMockMode()) {
      const logs = getTimesheets();
      const logIndex = logs.findIndex((t) => t.id === activeClockId || t.clockOut === null);
      if (logIndex !== -1) {
        const log = logs[logIndex];
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0];

        if (!log.sessions) log.sessions = [];
        const activeSessIdx = log.sessions.findIndex(s => s.clockOut === null);
        if (activeSessIdx === -1) {
          throw new Error('No active session found');
        }

        const activeSess = log.sessions[activeSessIdx];
        activeSess.clockOut = recoveryClockOut || timeStr;

        const inTime = new Date(`${log.date}T${activeSess.clockIn}`);
        const outTime = new Date(`${recoveryClockOutDate || todayStr}T${recoveryClockOut || timeStr}`);
        let diffHours = (outTime - inTime) / 3600000;
        if (diffHours < 0) diffHours = 0;
        activeSess.hours = parseFloat(diffHours.toFixed(2));

        log.clockOut = recoveryClockOut || timeStr;
        log.status = 'COMPLETED';
        log.browser = metadata.browser;
        log.operatingSystem = metadata.operatingSystem;
        log.deviceType = metadata.deviceType;
        log.screenResolution = metadata.screenResolution;

        if (notes && notes.trim()) {
          log.notes = log.notes ? log.notes + ' | ' + notes.trim() : notes.trim();
        }

        const totalHours = log.sessions
          .filter(s => s.clockOut !== null)
          .reduce((sum, s) => sum + (s.hours || 0), 0);
        log.hours = parseFloat(totalHours.toFixed(2));

        logs[logIndex] = log;
        saveTimesheets(logs);
        localStorage.removeItem('vt_active_shift');
        triggerSync();
        return { message: 'Clocked out successfully', log };
      }
      throw new Error('Active clock session not found');
    } else {
      const response = await api.post('/timesheets/clock-out', {
        notes,
        browser: metadata.browser,
        operatingSystem: metadata.operatingSystem,
        deviceType: metadata.deviceType,
        screenResolution: metadata.screenResolution,
        timezoneOffset: new Date().getTimezoneOffset(),
        recoveryClockOut: recoveryClockOut || undefined,
        recoveryClockOutDate: recoveryClockOutDate || undefined
      });
      localStorage.removeItem('vt_active_shift');
      triggerSync();
      return response.data;
    }
  },

  getMyLogs: async (userId) => {
    // If offline, read from cache and overlay offline pending items
    if (!navigator.onLine) {
      try {
        const stored = localStorage.getItem('vt_cached_logs');
        let logs = stored ? JSON.parse(stored) : [];
        const queue = getOfflineQueue().filter(q => q.userId === userId);

        queue.forEach(item => {
          const itemDate = new Date(item.deviceTime).toISOString().split('T')[0];
          const itemTime = new Date(item.deviceTime).toTimeString().split(' ')[0];

          if (item.action === 'CLOCK_IN') {
            const todayIdx = logs.findIndex(l => l.date === itemDate);
            if (todayIdx !== -1) {
              const log = logs[todayIdx];
              if (!log.sessions) log.sessions = [];
              log.sessions.push({
                id: `pending-sess-${item.id}`,
                clockIn: itemTime,
                clockOut: null,
                hours: 0
              });
              log.clockOut = null;
              log.status = 'ACTIVE';
              log.isOfflinePending = true;
            } else {
              logs.unshift({
                id: `pending-${item.id}`,
                userId: item.userId,
                date: itemDate,
                clockIn: itemTime,
                clockOut: null,
                hours: 0,
                notes: '',
                clientCompany: item.clientCompany || 'N/A',
                status: 'ACTIVE',
                isOfflinePending: true,
                sessions: [{
                  id: `pending-sess-${item.id}`,
                  clockIn: itemTime,
                  clockOut: null,
                  hours: 0
                }]
              });
            }
          } else if (item.action === 'CLOCK_OUT') {
            const activeIdx = logs.findIndex(l => l.clockOut === null || (l.date === itemDate && l.sessions && l.sessions.some(s => s.clockOut === null)));
            if (activeIdx !== -1) {
              const log = logs[activeIdx];
              if (!log.sessions) log.sessions = [];
              const sessIdx = log.sessions.findIndex(s => s.clockOut === null);
              if (sessIdx !== -1) {
                const sess = log.sessions[sessIdx];
                sess.clockOut = itemTime;
                
                const inTime = new Date(`${log.date}T${sess.clockIn}`);
                const outTime = new Date(`${itemDate}T${itemTime}`);
                let diffHours = (outTime - inTime) / 3600000;
                if (diffHours < 0) diffHours = 0;
                sess.hours = parseFloat(diffHours.toFixed(2));
              }

              log.clockOut = itemTime;
              log.status = 'COMPLETED';
              log.isOfflinePending = true;
              if (item.notes && item.notes.trim()) {
                log.notes = log.notes ? log.notes + ' | ' + item.notes.trim() : item.notes.trim();
              }

              const totalHours = log.sessions
                .filter(s => s.clockOut !== null)
                .reduce((sum, s) => sum + (s.hours || 0), 0);
              log.hours = parseFloat(totalHours.toFixed(2));
            }
          }
        });
        return logs;
      } catch (e) {
        console.error("Error overlaying offline queue in getMyLogs", e);
      }
      return [];
    }

    if (isMockMode()) {
      const logs = getTimesheets();
      const users = getUsers();
      const filtered = logs
        .filter((t) => t.userId === userId || String(t.userId) === String(userId))
        .map((t) => {
          const user = users.find((u) => u.id === t.userId) || { clientCompany: 'N/A' };
          return { ...t, clientCompany: t.clientCompany || user.clientCompany || 'N/A' };
        })
        .sort((a, b) => new Date(b.date + 'T' + b.clockIn) - new Date(a.date + 'T' + a.clockIn));
      localStorage.setItem('vt_cached_logs', JSON.stringify(filtered));
      return filtered;
    } else {
      const response = await api.get('/timesheets/my-logs');
      localStorage.setItem('vt_cached_logs', JSON.stringify(response.data));
      return response.data;
    }
  },

  syncOfflineQueue: async () => {
    if (!navigator.onLine) return { status: 'offline', syncedCount: 0 };

    const queue = getOfflineQueue();
    if (queue.length === 0) return { status: 'idle', syncedCount: 0 };

    if (localStorage.getItem('vt_syncing') === 'true') {
      return { status: 'syncing', syncedCount: 0 };
    }
    localStorage.setItem('vt_syncing', 'true');

    let syncedCount = 0;
    const remainingQueue = [];

    try {
      for (const item of queue) {
        try {
          const clientElapsedMs = Date.now() - item.deviceTime;
          if (item.action === 'CLOCK_IN') {
            if (isMockMode()) {
              const logs = getTimesheets();
              const todayStr = new Date(item.deviceTime).toISOString().split('T')[0];
              const timeStr = new Date(item.deviceTime).toTimeString().split(' ')[0];

              let todayLog = logs.find((t) => t.userId === item.userId && t.date === todayStr);

              if (todayLog) {
                const hasActive = todayLog.sessions && todayLog.sessions.some(s => s.clockOut === null);
                if (hasActive || todayLog.clockOut === null) {
                  throw new Error('Active shift already exists');
                }

                const newSession = {
                  id: `sess-${Date.now()}`,
                  clockIn: timeStr,
                  clockOut: null,
                  hours: 0
                };

                if (!todayLog.sessions) todayLog.sessions = [];
                todayLog.sessions.push(newSession);
                todayLog.clockOut = null; // Set active again
                todayLog.status = 'ACTIVE';

                const idx = logs.findIndex((t) => t.id === todayLog.id);
                logs[idx] = todayLog;
                saveTimesheets(logs);
              } else {
                const hasAnyActive = logs.some((t) => t.userId === item.userId && t.clockOut === null);
                if (hasAnyActive) {
                  throw new Error('Active shift already exists');
                }

                const newSession = {
                  id: `sess-${Date.now()}`,
                  clockIn: timeStr,
                  clockOut: null,
                  hours: 0
                };

                logs.push({
                  id: `log-${Date.now()}`,
                  userId: item.userId,
                  date: todayStr,
                  clockIn: timeStr,
                  clockOut: null,
                  hours: 0,
                  notes: '',
                  clientCompany: item.clientCompany || 'N/A',
                  status: 'ACTIVE',
                  browser: item.deviceMetadata?.browser,
                  operatingSystem: item.deviceMetadata?.operatingSystem,
                  deviceType: item.deviceMetadata?.deviceType,
                  screenResolution: item.deviceMetadata?.screenResolution,
                  sessions: [newSession]
                });
                saveTimesheets(logs);
              }
            } else {
              await api.post('/timesheets/clock-in', {
                clientElapsedMs,
                browser: item.deviceMetadata?.browser,
                operatingSystem: item.deviceMetadata?.operatingSystem,
                deviceType: item.deviceMetadata?.deviceType,
                screenResolution: item.deviceMetadata?.screenResolution
              });
            }
          } else if (item.action === 'CLOCK_OUT') {
            if (isMockMode()) {
              const logs = getTimesheets();
              const logIndex = logs.findIndex(t => t.userId === item.userId && t.clockOut === null);
              if (logIndex === -1) throw new Error('No active shift found');

              const log = logs[logIndex];
              const todayStr = new Date(item.deviceTime).toISOString().split('T')[0];
              const timeStr = new Date(item.deviceTime).toTimeString().split(' ')[0];

              if (!log.sessions) log.sessions = [];
              const activeSessIdx = log.sessions.findIndex(s => s.clockOut === null);
              if (activeSessIdx === -1) {
                throw new Error('No active session found');
              }

              const activeSess = log.sessions[activeSessIdx];
              activeSess.clockOut = timeStr;

              const inTime = new Date(`${log.date}T${activeSess.clockIn}`);
              const outTime = new Date(`${todayStr}T${timeStr}`);
              let diffHours = (outTime - inTime) / 3600000;
              if (diffHours < 0) diffHours = 0;
              activeSess.hours = parseFloat(diffHours.toFixed(2));

              log.clockOut = timeStr;
              log.status = 'COMPLETED';
              log.browser = item.deviceMetadata?.browser;
              log.operatingSystem = item.deviceMetadata?.operatingSystem;
              log.deviceType = item.deviceMetadata?.deviceType;
              log.screenResolution = item.deviceMetadata?.screenResolution;

              if (item.notes && item.notes.trim()) {
                log.notes = log.notes ? log.notes + ' | ' + item.notes.trim() : item.notes.trim();
              }

              const totalHours = log.sessions
                .filter(s => s.clockOut !== null)
                .reduce((sum, s) => sum + (s.hours || 0), 0);
              log.hours = parseFloat(totalHours.toFixed(2));

              logs[logIndex] = log;
              saveTimesheets(logs);
            } else {
              await api.post('/timesheets/clock-out', {
                notes: item.notes,
                clientElapsedMs,
                browser: item.deviceMetadata?.browser,
                operatingSystem: item.deviceMetadata?.operatingSystem,
                deviceType: item.deviceMetadata?.deviceType,
                screenResolution: item.deviceMetadata?.screenResolution
              });
            }
          }
          syncedCount++;
        } catch (err) {
          console.error("Error syncing item", item, err);
          if (!err.response || err.response.status >= 500) {
            remainingQueue.push(item);
            const currentIndex = queue.indexOf(item);
            remainingQueue.push(...queue.slice(currentIndex + 1));
            break;
          }
        }
      }
      saveOfflineQueue(remainingQueue);
      triggerSync();
    } finally {
      localStorage.removeItem('vt_syncing');
    }

    return { status: remainingQueue.length > 0 ? 'partial' : 'success', syncedCount };
  },

  // --- ADMIN TIMESHEET & MANAGEMENT FUNCTIONS ---
  getAdminStats: async () => {
    if (isMockMode()) {
      const logs = getTimesheets();
      const users = getUsers();
      const employees = users.filter((u) => u.role === 'employee' || u.role === 'EMPLOYEE');

      const activeClockins = logs.filter((t) => t.clockOut === null).length;
      
      const storedCompanies = localStorage.getItem('vt_client_companies');
      let clientCount = 5;
      if (storedCompanies) {
        try {
          clientCount = JSON.parse(storedCompanies).length;
        } catch {
          // ignore
        }
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const submittedToday = new Set(
        logs
          .filter((t) => t.date === todayStr && (t.clockOut !== null || (t.hours !== null && t.hours > 0)))
          .map((t) => t.userId)
      ).size;

      return {
        currentlyClockedIn: activeClockins,
        activeEmployees: activeClockins,
        totalEmployees: employees.length,
        activeClients: clientCount,
        totalClients: clientCount,
        timesheetsSubmittedToday: submittedToday
      };
    } else {
      const response = await api.get('/admin/stats');
      console.log(response.data);
      return response.data;
    }
  },

  getAdminTimesheets: async (filters = {}) => {
    if (isMockMode()) {
      const logs = getTimesheets();
      let filtered = [...logs];

      if (filters.userId && filters.userId !== 'all') {
        filtered = filtered.filter((t) => t.userId === filters.userId || String(t.userId) === String(filters.userId));
      }
      if (filters.client && filters.client !== 'all') {
        filtered = filtered.filter((t) => t.clientCompany === filters.client);
      }
      if (filters.startDate) {
        filtered = filtered.filter((t) => t.date >= filters.startDate);
      }
      if (filters.endDate) {
        filtered = filtered.filter((t) => t.date <= filters.endDate);
      }

      // Sort newest first
      filtered.sort((a, b) => new Date(b.date + 'T' + b.clockIn) - new Date(a.date + 'T' + a.clockIn));
      return filtered;
    } else {
      const response = await api.get('/admin/timesheets', { params: filters });
      return response.data;
    }
  },

  createManualLog: async (logEntry) => {
    if (isMockMode()) {
      const logs = getTimesheets();
      const users = getUsers();
      const employee = users.find((u) => u.id === logEntry.userId || String(u.id) === String(logEntry.userId));

      let hours = null;
      if (logEntry.clockOut) {
        const inTime = new Date(`${logEntry.date}T${logEntry.clockIn}`);
        const outTime = new Date(`${logEntry.date}T${logEntry.clockOut}`);
        let diffHours = (outTime - inTime) / 3600000;
        if (diffHours < 0) diffHours = 0;
        hours = parseFloat(diffHours.toFixed(2));
      }

      const newLog = {
        id: `log-${Date.now()}`,
        userId: logEntry.userId,
        date: logEntry.date,
        clockIn: logEntry.clockIn,
        clockOut: logEntry.clockOut,
        hours: hours,
        notes: logEntry.notes,
        clientCompany: logEntry.clientCompany || (employee ? employee.clientCompany : 'N/A'),
        status: logEntry.clockOut ? 'COMPLETED' : 'ACTIVE'
      };

      logs.push(newLog);
      saveTimesheets(logs);
      triggerSync();
      return { message: 'Manual entry created', id: newLog.id };
    } else {
      const response = await api.post('/admin/timesheets', logEntry);
      triggerSync();
      return response.data;
    }
  },

  updateLog: async (logId, logEntry) => {
    if (isMockMode()) {
      const logs = getTimesheets();
      const index = logs.findIndex((t) => t.id === logId);
      if (index !== -1) {
        let hours = null;
        if (logEntry.clockOut) {
          const inTime = new Date(`${logEntry.date}T${logEntry.clockIn}`);
          const outTime = new Date(`${logEntry.date}T${logEntry.clockOut}`);
          let diffHours = (outTime - inTime) / 3600000;
          if (diffHours < 0) diffHours = 0;
          hours = parseFloat(diffHours.toFixed(2));
        }

        logs[index] = {
          ...logs[index],
          ...logEntry,
          hours,
          status: logEntry.clockOut ? 'COMPLETED' : 'ACTIVE'
        };
        saveTimesheets(logs);
        triggerSync();
        return { message: 'Timesheet record updated' };
      }
      throw new Error('Timesheet entry not found');
    } else {
      const response = await api.put(`/admin/timesheets/${logId}`, logEntry);
      triggerSync();
      return response.data;
    }
  },

  deleteLog: async (logId) => {
    if (isMockMode()) {
      const logs = getTimesheets();
      const filtered = logs.filter((t) => t.id !== logId);
      saveTimesheets(filtered);
      triggerSync();
      return { message: 'Timesheet record deleted' };
    } else {
      const response = await api.delete(`/admin/timesheets/${logId}`);
      triggerSync();
      return response.data;
    }
  },
  
  deleteLogs: async (logIds) => {
    if (isMockMode()) {
      const logs = getTimesheets();
      const filtered = logs.filter((t) => !logIds.includes(t.id));
      saveTimesheets(filtered);
      triggerSync();
      return { message: 'Timesheet records deleted' };
    } else {
      const response = await api.post('/admin/timesheets/bulk-delete', { ids: logIds });
      triggerSync();
      return response.data;
    }
  },

  createEmployee: async (employeeData) => {
    if (isMockMode()) {
      const users = getUsers();
      const userExists = users.find((u) => u.username.toLowerCase() === employeeData.username.toLowerCase());
      if (userExists) {
        throw new Error('Username already taken');
      }

      const newUser = {
        id: `u-${Date.now()}`,
        name: employeeData.name,
        username: employeeData.username,
        password: employeeData.password,
        role: employeeData.role || 'employee',
        clientCompany: employeeData.clientCompany,
        rate: parseFloat(employeeData.rate || 0)
      };

      users.push(newUser);
      saveUsers(users);

      if (employeeData.currency) {
        setEmployeeCurrency(newUser.id, employeeData.currency);
      }

      triggerSync();
      return { message: 'User account created successfully', userId: newUser.id };
    } else {
      console.log("Payload:", employeeData);
      console.log("Endpoint:", "/admin/candidates");
      const response = await api.post('/admin/candidates', employeeData);
      const data = response.data;
      if (employeeData.currency && data && data.id) {
        setEmployeeCurrency(data.id, employeeData.currency);
      }
      triggerSync();
      return data;
    }
  },

  getEmployeesList: async () => {
    if (isMockMode()) {
      const users = getUsers();
      return users.filter((u) => u.role === 'employee' || u.role === 'EMPLOYEE');
    } else {
      const response = await api.get('/admin/employees');
      return response.data;
    }
  },

  getAdminExceptions: async () => {
    if (isMockMode()) {
      const logs = getTimesheets();
      const todayStr = new Date().toISOString().split('T')[0];
      return logs.filter((log) => log.clockOut === null && log.date < todayStr);
    } else {
      const response = await api.get('/admin/timesheets/exceptions');
      return response.data;
    }
  },

  deleteEmployee: async (userId) => {
    if (isMockMode()) {
      const users = getUsers();
      const filteredUsers = users.filter((u) => u.id !== userId);
      saveUsers(filteredUsers);

      // Clean up mock timesheets for that user too
      const logs = getTimesheets();
      const filteredLogs = logs.filter((t) => t.userId !== userId);
      saveTimesheets(filteredLogs);

      triggerSync();
      return { message: 'Candidate account removed' };
    } else {
      const response = await api.delete(`/admin/employees/${userId}`);
      triggerSync();
      return response.data;
    }
  },

  // --- CSV REPORTS & EXPORTS ---
  exportMasterCSV: async (filters = {}) => {
    if (isMockMode()) {
      const timesheets = getTimesheets();
      const users = getUsers();
      let filtered = [...timesheets];

      if (filters.userId && filters.userId !== 'all') {
        filtered = filtered.filter((t) => t.userId === filters.userId || String(t.userId) === String(filters.userId));
      }
      if (filters.client && filters.client !== 'all') {
        filtered = filtered.filter((t) => t.clientCompany === filters.client);
      }
      if (filters.startDate) {
        filtered = filtered.filter((t) => t.date >= filters.startDate);
      }
      if (filters.endDate) {
        filtered = filtered.filter((t) => t.date <= filters.endDate);
      }

      let csv = 'Candidate Name,Client Company,Date,Clock In,Clock Out,Total Hours,Work Notes\n';
      filtered.forEach((log) => {
        const user = users.find((u) => u.id === log.userId || String(u.id) === String(log.userId)) || { name: 'Unknown' };
        const cleanNotes = log.notes ? `"${log.notes.replace(/"/g, '""')}"` : '""';
        const hoursStr = log.clockOut ? log.hours : 'Active Clock';
        const clockOutTime = log.clockOut || 'N/A';
        csv += `"${user.name}","${log.clientCompany || 'N/A'}","${log.date}","${log.clockIn}","${clockOutTime}",${hoursStr},${cleanNotes}\n`;
      });

      triggerFileDownload(csv, `Vergil_Tempo_Timesheets_${new Date().toISOString().slice(0, 10)}.csv`);
      return true;
    } else {
      const response = await api.get('/reports/export-master', { params: filters, responseType: 'blob' });
      triggerBlobDownload(response.data, `Vergil_Tempo_Timesheets_${new Date().toISOString().slice(0, 10)}.csv`);
      return true;
    }
  },

  exportMonthlyBillingReport: async (userId, yearMonth, candidateName = null) => {
    if (isMockMode()) {
      const timesheets = getTimesheets();
      const users = getUsers();
      const candidate = users.find((u) => u.id === userId || String(u.id) === String(userId));
      if (!candidate) throw new Error('Candidate not found');

      const monthlyLogs = timesheets
        .filter((t) => (t.userId === userId || String(t.userId) === String(userId)) && t.date.startsWith(yearMonth) && t.clockOut !== null)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      const parts = yearMonth.split('-');
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      const daysInMonth = new Date(year, month, 0).getDate();

      const labelDate = new Date(year, month - 1, 1);
      const monthLabel = labelDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      // Fetch active mock holidays
      const activeHolidays = getHolidays().filter(h => h.active);
      const holidayDates = new Set(activeHolidays.map(h => h.holidayDate));
      const holidayNames = {};
      activeHolidays.forEach(h => {
        holidayNames[h.holidayDate] = h.holidayName;
      });

      // Generate a mock text PDF content
      let pdfContent = `%PDF-1.4\n`;
      pdfContent += `% VERGIL REMNANT STAFFING SERVICES - MONTHLY ATTENDANCE PDF REPORT MOCK\n`;
      pdfContent += `Month: ${monthLabel}\n`;
      pdfContent += `Employee Name: ${candidate.name}\n`;
      pdfContent += `Client Company: ${candidate.clientCompany || 'N/A'}\n\n`;
      pdfContent += `Date | Day | Log In | Log Out | Total Hours | Employee Name | Client Company | Status\n`;
      pdfContent += `------------------------------------------------------------------------------------------\n`;
      
      const logMap = {};
      monthlyLogs.forEach((log) => {
        logMap[log.date] = log;
      });

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      for (let dayVal = 1; dayVal <= daysInMonth; dayVal++) {
        const dateObj = new Date(year, month - 1, dayVal);
        const dayName = dayNames[dateObj.getDay()];
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        const dateStr = `${String(dayVal).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
        
        const dateStrIso = `${year}-${String(month).padStart(2, '0')}-${String(dayVal).padStart(2, '0')}`;
        
        if (isWeekend) {
          pdfContent += `${dateStr} | ${dayName} | - | - | - | - | - | \n`;
        } else if (holidayDates.has(dateStrIso)) {
          pdfContent += `${dateStr} | ${dayName} | - | - | - | - | - | ${holidayNames[dateStrIso]}\n`;
        } else {
          const log = logMap[dateStrIso];
          if (log) {
            const hoursFormatted = log.hours !== null && log.hours !== undefined ? Number(log.hours).toFixed(2) : '0.00';
            pdfContent += `${dateStr} | ${dayName} | ${log.clockIn || '-'} | ${log.clockOut || '-'} | ${hoursFormatted} | ${candidate.name} | ${candidate.clientCompany || 'N/A'} | Present\n`;
          } else {
            pdfContent += `${dateStr} | ${dayName} | - | - | - | ${candidate.name} | ${candidate.clientCompany || 'N/A'} | ABSENT\n`;
          }
        }
      }

      const pdfBlob = new Blob([pdfContent], { type: 'application/pdf' });
      triggerBlobDownload(pdfBlob, `Vergil_Tempo_Attendance_${candidate.name.replace(/\s+/g, '_')}_${yearMonth}.pdf`);
      return true;
    } else {
      const parts = yearMonth.split('-');
      const yearVal = parseInt(parts[0]);
      const monthVal = parseInt(parts[1]);

      const response = await api.get('/reports/monthly-attendance', {
        params: { employeeId: userId, month: monthVal, year: yearVal },
        responseType: 'blob'
      });
      const safeName = candidateName ? candidateName.replace(/\s+/g, '_') : userId;
      triggerBlobDownload(response.data, `Vergil_Tempo_Attendance_${safeName}_${yearMonth}.pdf`);
      return true;
    }
  },

  // --- HOLIDAY MANAGEMENT FUNCTIONS ---
  getHolidaysList: async () => {
    if (isMockMode()) {
      return getHolidays();
    } else {
      const response = await api.get('/admin/holidays');
      return response.data;
    }
  },

  getActiveHolidaysList: async () => {
    if (isMockMode()) {
      return getHolidays().filter(h => h.active);
    } else {
      const response = await api.get('/holidays');
      return response.data;
    }
  },

  createHoliday: async (holidayData) => {
    if (isMockMode()) {
      const holidays = getHolidays();
      const exists = holidays.some(h => h.holidayDate === holidayData.holidayDate);
      if (exists) {
        throw new Error(`A holiday already exists on date ${holidayData.holidayDate}`);
      }
      const newHoliday = {
        id: 'h_' + Date.now(),
        ...holidayData
      };
      holidays.push(newHoliday);
      saveHolidays(holidays);
      triggerSync();
      return newHoliday;
    } else {
      const response = await api.post('/admin/holidays', holidayData);
      triggerSync();
      return response.data;
    }
  },

  updateHoliday: async (id, holidayData) => {
    if (isMockMode()) {
      const holidays = getHolidays();
      const exists = holidays.some(h => h.holidayDate === holidayData.holidayDate && h.id !== id);
      if (exists) {
        throw new Error(`A holiday already exists on date ${holidayData.holidayDate}`);
      }
      const index = holidays.findIndex(h => h.id === id);
      if (index === -1) throw new Error('Holiday not found');
      
      const updatedHoliday = {
        ...holidays[index],
        ...holidayData
      };
      holidays[index] = updatedHoliday;
      saveHolidays(holidays);
      triggerSync();
      return updatedHoliday;
    } else {
      const response = await api.put(`/admin/holidays/${id}`, holidayData);
      triggerSync();
      return response.data;
    }
  },

  deleteHoliday: async (id) => {
    if (isMockMode()) {
      const holidays = getHolidays();
      const filtered = holidays.filter(h => h.id !== id);
      saveHolidays(filtered);
      triggerSync();
      return { message: 'Holiday deleted successfully' };
    } else {
      const response = await api.delete(`/admin/holidays/${id}`);
      triggerSync();
      return response.data;
    }
  },
  getWorkforceSummary: async (year, month, clientId = 'ALL') => {
    if (USE_MOCK_API) {
      // Mock summary fallback
      return {
        year,
        month,
        totalWorkingDays: 21,
        totalEmployees: 2,
        summaries: [
          {
            userId: 'emp-1',
            name: 'Sarah Jenkins',
            username: 'sarah.jenkins',
            clientCompany: 'Microsoft',
            hourlyRate: 45.0,
            totalWorkingDays: 21,
            presentDays: 20,
            leaveDays: 1,
            absentDays: 0,
            totalHours: 160.0,
            billableAmount: 7200.0,
            lateCount: 1,
            earlyLeaveCount: 0,
            attendanceScore: 100,
          },
          {
            userId: 'emp-2',
            name: 'David Ross',
            username: 'david.ross',
            clientCompany: 'Google',
            hourlyRate: 50.0,
            totalWorkingDays: 21,
            presentDays: 19,
            leaveDays: 0,
            absentDays: 2,
            totalHours: 152.0,
            billableAmount: 7600.0,
            lateCount: 0,
            earlyLeaveCount: 1,
            attendanceScore: 90,
          },
        ],
      };
    } else {
      const response = await api.get('/reports/workforce-summary', {
        params: { year, month, clientId },
      });
      return response.data;
    }
  },

  exportWorkforceSummaryCSV: (data, yearMonth) => {
    const headers = ['Employee Name', 'Username', 'Client MNC', 'Working Days', 'Present Days', 'Leave Days', 'Absent Days', 'Total Hours', 'Rate ($/hr)', 'Billable Total ($)', 'Late Count', 'Early Leave', 'Score (%)'];
    let csvContent = headers.join(',') + '\n';

    data.summaries.forEach((s) => {
      const row = [
        `"${s.name}"`,
        `"${s.username}"`,
        `"${s.clientCompany}"`,
        s.totalWorkingDays,
        s.presentDays,
        s.leaveDays,
        s.absentDays,
        s.totalHours,
        s.hourlyRate.toFixed(2),
        s.billableAmount.toFixed(2),
        s.lateCount,
        s.earlyLeaveCount,
        `${s.attendanceScore}%`,
      ];
      csvContent += row.join(',') + '\n';
    });

    triggerFileDownload(csvContent, `Vergil_Tempo_Workforce_Audit_${yearMonth}.csv`);
  },

  exportWorkforceSummaryPDF: (data, yearMonth) => {
    let pdfText = `VERGIL TEMPO - WORKFORCE ATTENDANCE & AUDIT REPORT\n`;
    pdfText += `Period: ${yearMonth} | Uniform Working Days: ${data.totalWorkingDays} Days | Total Staff: ${data.totalEmployees}\n`;
    pdfText += `Generated At: ${new Date().toLocaleString()}\n`;
    pdfText += `----------------------------------------------------------------------------------------------------\n\n`;

    pdfText += `Employee Name | Client MNC | Working Days | Present | Leave | Absent | Total Hours | Billable ($) | Score\n`;
    pdfText += `----------------------------------------------------------------------------------------------------\n`;

    data.summaries.forEach((s) => {
      pdfText += `${s.name} | ${s.clientCompany} | ${s.totalWorkingDays} | ${s.presentDays} | ${s.leaveDays} | ${s.absentDays} | ${s.totalHours} hrs | $${s.billableAmount.toFixed(2)} | ${s.attendanceScore}%\n`;
    });

    pdfText += `\n----------------------------------------------------------------------------------------------------\n`;
    pdfText += `End of Report - Vergil Tempo Workforce Audit Engine\n`;

    const blob = new Blob([pdfText], { type: 'text/plain;charset=utf-8' });
    triggerBlobDownload(blob, `Vergil_Tempo_Workforce_Audit_${yearMonth}.txt`);
  },
};

// Helpers to initiate downloads
function triggerFileDownload(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(blob, filename);
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
