/**
 * VitalGuard AI — Main Application Orchestrator
 * Handles SPA routing, event wiring, UI rendering, and global state.
 * Loaded LAST after all other VG modules.
 */
window.VG = window.VG || {};
VG.app = (function () {
    // ─── Internal State ──────────────────────────────────────────
    let online = navigator.onLine;
    let currentPage = 'landing';
    let selectedPatientId = null;
    let selectedPatient = null;
    let monitoringActive = false;

    // ─── Utility Helpers ─────────────────────────────────────────

    function formatDateTime(iso) {
        if (!iso) return '--';
        return new Date(iso).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    function formatRelativeTime(iso) {
        if (!iso) return '--';
        const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 5)    return 'Just now';
        if (s < 60)   return s + 's ago';
        if (s < 3600) return Math.floor(s / 60) + ' min ago';
        if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
        return Math.floor(s / 86400) + ' days ago';
    }

    function getRiskBadgeHTML(level) {
        const map = {
            NORMAL:    { bg: 'var(--success)',  text: 'white', label: 'Normal' },
            WARNING:   { bg: 'var(--warning)',  text: '#1e293b', label: 'Warning' },
            HIGH_RISK: { bg: 'var(--danger)',   text: 'white', label: 'High Risk' }
        };
        const m = map[level] || { bg: '#94a3b8', text: 'white', label: level || '--' };
        return `<span style="background:${m.bg};color:${m.text};padding:3px 10px;border-radius:12px;font-size:.78rem;font-weight:600;white-space:nowrap">${m.label}</span>`;
    }

    function getSyncBadgeHTML(status) {
        if (status === 'SYNCED')  return '<span style="color:var(--success);font-weight:600;font-size:.78rem">🟢 SYNCED</span>';
        if (status === 'PENDING') return '<span style="color:var(--sync-pending);font-weight:600;font-size:.78rem">🟠 PENDING</span>';
        return '<span style="color:#94a3b8;font-size:.78rem">--</span>';
    }

    // ─── Toast Notifications ─────────────────────────────────────

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.pointerEvents = 'auto';
        toast.innerHTML = message;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    // ─── Online / Offline ────────────────────────────────────────

    function setOnline(isOnline) {
        online = isOnline;

        // Sidebar status dot
        const cDot = document.getElementById('connectivity-status');
        if (cDot) {
            cDot.className = 'status-dot ' + (online ? 'status-online' : 'status-offline');
        }

        // Top‑bar status pill — find the first status‑pill containing connectivity info
        document.querySelectorAll('.status-pill').forEach(pill => {
            if (pill.textContent.includes('Online') || pill.textContent.includes('Offline')) {
                pill.innerHTML = `<span class="status-dot ${online ? 'status-online' : 'status-offline'}"></span> ${online ? 'Online' : 'Offline'}`;
            }
        });

        // Sync center
        const syncDot = document.getElementById('sync-connectivity-status');
        if (syncDot) {
            syncDot.className = online
                ? 'w-16 h-16 rounded-full mb-3 flex items-center justify-center text-3xl shadow-inner bg-green-100 text-green-600 animate-pulse'
                : 'w-16 h-16 rounded-full mb-3 flex items-center justify-center text-3xl shadow-inner bg-red-100 text-red-600';
            syncDot.textContent = online ? '📶' : '📵';
        }
        const syncText = document.getElementById('sync-status-text');
        if (syncText) syncText.textContent = online
            ? 'Online — Ready to Sync'
            : '🔴 Internet unavailable. New health records are being stored locally.';

        // Toggle button
        const btn = document.getElementById('btn-toggle-offline');
        if (btn) btn.textContent = online ? 'Simulate Offline' : 'Go Online';

        // Notify user about pending records when coming back online
        if (online && VG.db) {
            VG.db.getStats().then(s => {
                if (s.pendingSync > 0) showToast(`📡 ${s.pendingSync} records pending sync`, 'info');
            });
        }
        if (currentPage === 'sync') refreshSync();
    }

    function isOnline() { return online; }

    // ─── SPA Routing ─────────────────────────────────────────────

    function navigate(page) {
        // Hide all page sections
        document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));
        const target = document.getElementById('page-' + page);
        if (target) {
            target.classList.remove('hidden');
            currentPage = page;
        }

        // Update sidebar active link
        document.querySelectorAll('#sidebar .nav-links a').forEach(a => a.classList.remove('active'));
        const link = document.querySelector(`#sidebar .nav-links a[data-page="${page}"]`);
        if (link) link.classList.add('active');

        // Update mobile nav active
        document.querySelectorAll('#mobile-nav a').forEach(a => a.classList.remove('active'));
        const mlink = document.querySelector(`#mobile-nav a[data-page="${page}"]`);
        if (mlink) mlink.classList.add('active');

        // Page title
        const titles = {
            landing: 'VitalGuard AI',
            dashboard: 'Dashboard',
            register: 'Register Patient',
            patient: 'Patient Monitoring',
            history: 'Patient History',
            workers: 'Health Workers',
            sync: 'Sync Center'
        };
        const titleEl = document.getElementById('page-title');
        if (titleEl) titleEl.textContent = titles[page] || 'VitalGuard AI';

        window.location.hash = page;

        // Refresh page content
        switch (page) {
            case 'dashboard': refreshDashboard(); break;
            case 'register':  refreshRegister();  break;
            case 'patient':   refreshPatient();   break;
            case 'history':   refreshHistory();   break;
            case 'workers':   refreshWorkers();   break;
            case 'sync':      refreshSync();      break;
        }
    }

    // ─── Dashboard ───────────────────────────────────────────────

    async function refreshDashboard() {
        if (!VG.db) return;
        try {
            const stats = await VG.db.getStats();
            setText('stat-total-readings', stats.totalReadings);
            setText('stat-normal',        stats.normal);
            setText('stat-warning',       stats.warning);
            setText('stat-critical',      stats.critical);
            setText('stat-pending-sync',  stats.pendingSync);

            // Patient dropdown
            const patients = await VG.db.getAllPatients();
            const sel = document.getElementById('monitoring-patient-select');
            if (sel) {
                const cur = sel.value;
                sel.innerHTML = '<option value="">Select a patient…</option>';
                patients.forEach(p => {
                    const o = document.createElement('option');
                    o.value = p.id;
                    o.textContent = `${p.name} (${p.id})`;
                    sel.appendChild(o);
                });
                if (cur) sel.value = cur;
            }

            // Charts
            const readings = await VG.db.getReadings();
            if (VG.charts) {
                VG.charts.updateVitalTrends(readings);
                VG.charts.updateRiskDistribution({ normal: stats.normal, warning: stats.warning, critical: stats.critical });
            }

            // Recent readings table
            const tbody = document.getElementById('recent-readings-body');
            if (tbody) {
                tbody.innerHTML = '';
                readings.slice(0, 12).forEach(r => tbody.appendChild(readingRow(r)));
            }
        } catch (e) { console.error('refreshDashboard:', e); }
    }

    // ─── Patient Registration ────────────────────────────────────

    function refreshRegister() {
        const form = document.getElementById('form-register');
        if (form) form.reset();
        autoGenerateId();
    }

    async function autoGenerateId() {
        if (!VG.db) return;
        const patients = await VG.db.getAllPatients();
        const seq = String(patients.length + 1).padStart(3, '0');
        const idField = document.getElementById('reg-patient-id');
        if (idField && !idField.value) idField.value = `VG-${new Date().getFullYear()}-${seq}`;
    }

    // ─── Patient Monitoring ──────────────────────────────────────

    async function selectPatient(patientId) {
        selectedPatientId = patientId;
        if (VG.db) selectedPatient = await VG.db.getPatient(patientId);
        const sel = document.getElementById('monitoring-patient-select');
        if (sel) sel.value = patientId;
        // Only navigate if we aren't already on the dashboard doing a demo
        if (currentPage !== 'dashboard' || !VG.demo || !VG.demo.isRunning()) {
            navigate('patient');
        }
    }

    async function refreshPatient() {
        if (!selectedPatientId || !VG.db) return;
        const p = await VG.db.getPatient(selectedPatientId);
        if (!p) return;
        selectedPatient = p;

        setText('patient-name',       p.name);
        setText('patient-id-display', p.id);
        setText('patient-age',        p.age);
        setText('patient-gender',     p.gender);
        setText('patient-location',   p.location);
        setText('patient-emergency',  p.emergencyContact || '--');

        // Latest vitals
        const latest = await VG.db.getLatestReading(selectedPatientId);
        const vitalsDiv = document.getElementById('patient-vitals');
        if (vitalsDiv && latest) {
            vitalsDiv.innerHTML = vitalCardsHTML(latest);
            // Show assessment
            const panel = document.getElementById('patient-assessment');
            if (panel) {
                panel.classList.remove('hidden');
                const riskResult = VG.riskEngine
                    ? VG.riskEngine.analyze(latest)
                    : { level: latest.riskLevel, factors: latest.riskFactors, suggestedAction: '' };
                panel.innerHTML = assessmentHTML(riskResult);
            }
            const rfList = document.getElementById('patient-risk-factors');
            if (rfList) rfList.innerHTML = '';
        }

        // Patient history mini-table
        const readings = await VG.db.getReadings(selectedPatientId);
        const ptbody = document.getElementById('patient-history-body');
        if (ptbody) {
            ptbody.innerHTML = '';
            readings.slice(0, 20).forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="p-2 text-sm">${formatDateTime(r.timestamp)}</td>
                    <td class="p-2">${r.heartRate} <small>BPM</small></td>
                    <td class="p-2">${r.spo2}%</td>
                    <td class="p-2">${r.temperature}°C</td>
                    <td class="p-2">${r.bloodPressure ? r.bloodPressure.systolic + '/' + r.bloodPressure.diastolic : '--'}</td>
                    <td class="p-2">${getRiskBadgeHTML(r.riskLevel)}</td>
                    <td class="p-2">${getSyncBadgeHTML(r.syncStatus)}</td>`;
                ptbody.appendChild(tr);
            });
        }
    }

    // ─── History ─────────────────────────────────────────────────

    async function refreshHistory(filter) {
        if (!VG.db) return;
        if (!filter) {
            const active = document.querySelector('.filter-btn.active');
            filter = active ? active.dataset.filter : 'all';
        }
        let readings = await VG.db.getReadingsByFilter(filter);
        
        // Filter by specific patient if selected
        const patientFilterSelect = document.getElementById('history-patient-filter');
        if (patientFilterSelect && patientFilterSelect.value && patientFilterSelect.value !== 'all') {
            readings = readings.filter(r => r.patientId === patientFilterSelect.value);
        }

        const tbody = document.getElementById('history-table-body');
        if (tbody) {
            tbody.innerHTML = '';
            readings.forEach(r => {
                const tr = readingRow(r);
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => selectPatient(r.patientId));
                tbody.appendChild(tr);
            });
        }
    }

    // ─── Health Workers ──────────────────────────────────────────

    async function refreshWorkers() {
        if (!VG.db) return;
        const stats = await VG.db.getStats();
        setText('worker-stat-total',    stats.totalReadings);
        setText('worker-stat-active',   stats.totalReadings);  // prototype: all registered = active
        setText('worker-stat-warning',  stats.warning);
        setText('worker-stat-critical', stats.critical);
        setText('worker-stat-pending',  stats.pendingSync);

        const patients = await VG.db.getAllPatients();
        const tbody = document.getElementById('worker-patient-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        for (const p of patients) {
            const latest = await VG.db.getLatestReading(p.id);
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => selectPatient(p.id));
            if (latest) {
                tr.innerHTML = `
                    <td class="p-3"><strong>${p.name}</strong><br><small class="text-muted">${p.id}</small></td>
                    <td class="p-3"><span>HR ${latest.heartRate}</span> · <span>SpO₂ ${latest.spo2}%</span> · <span>${latest.temperature}°C</span></td>
                    <td class="p-3">${getRiskBadgeHTML(latest.riskLevel)}</td>
                    <td class="p-3 text-sm text-muted">${formatRelativeTime(latest.timestamp)}</td>
                    <td class="p-3">${getSyncBadgeHTML(latest.syncStatus)}</td>`;
            } else {
                tr.innerHTML = `
                    <td class="p-3"><strong>${p.name}</strong><br><small class="text-muted">${p.id}</small></td>
                    <td class="p-3 text-muted">No readings yet</td>
                    <td class="p-3">--</td><td class="p-3">--</td><td class="p-3">--</td>`;
            }
            tbody.appendChild(tr);
        }
    }

    // ─── Sync Center ─────────────────────────────────────────────

    async function refreshSync() {
        if (!VG.db) return;
        const stats = await VG.db.getStats();
        setText('sync-pending-count', stats.pendingSync);
    }

    async function runSyncSimulation() {
        const prog   = document.getElementById('sync-progress');
        const bar    = document.getElementById('sync-progress-bar');
        const stepTx = document.getElementById('sync-step-text');
        const res    = document.getElementById('sync-results');
        const logUl  = document.getElementById('sync-log-list');

        if (prog) prog.classList.remove('hidden');
        if (res)  res.classList.add('hidden');

        const steps = [
            { text: 'Preparing records…',   pct: '25%',  delay: 800 },
            { text: 'Validating records…',   pct: '50%',  delay: 1000 },
            { text: 'Synchronizing…',        pct: '75%',  delay: 1200 },
            { text: 'Complete.',             pct: '100%', delay: 800 }
        ];

        for (const step of steps) {
            if (bar)    bar.style.width = step.pct;
            if (stepTx) stepTx.textContent = step.text;
            await delay(step.delay);
        }

        // Actually sync
        let count = 0;
        if (VG.db) count = await VG.db.syncAllPending();

        if (prog) prog.classList.add('hidden');
        if (res)  res.classList.remove('hidden');
        if (logUl) {
            logUl.innerHTML = '';
            const li = document.createElement('li');
            li.textContent = `✅ ${count} record${count !== 1 ? 's' : ''} synchronized successfully.`;
            li.style.color = 'var(--success)';
            logUl.appendChild(li);
            const li2 = document.createElement('li');
            li2.textContent = `Completed at ${new Date().toLocaleTimeString()}`;
            logUl.appendChild(li2);
        }

        showToast(`✅ ${count} records synchronized successfully`, 'success');
        await refreshSync();
        await refreshDashboard();
    }

    // ─── Vital Display ───────────────────────────────────────────

    function updateVitalDisplay(vitals) {
        const riskDetails = VG.riskEngine ? VG.riskEngine.analyze(vitals).details : {};

        setVital('hr',       vitals.heartRate, riskDetails.heartRate);
        setVital('spo2',     vitals.spo2,      riskDetails.spo2);
        setVital('temp',     vitals.temperature !== undefined ? Number(vitals.temperature).toFixed(1) : '--', riskDetails.temperature);
        setVital('bp',       vitals.bloodPressure ? `${vitals.bloodPressure.systolic}/${vitals.bloodPressure.diastolic}` : '--', riskDetails.bloodPressure);
        setVital('movement', vitals.movement || '--', riskDetails.movement);
    }

    function setVital(key, value, detail) {
        const el = document.getElementById(`vital-${key}-value`);
        if (el) el.textContent = value;
        const dot = document.getElementById(`vital-${key}-status`);
        if (dot) {
            dot.className = 'status-dot';
            if (detail) {
                if (detail.status === 'CRITICAL') dot.classList.add('status-offline');   // red
                else if (detail.status === 'WARNING') dot.classList.add('status-warning'); 
                else dot.classList.add('status-online');  // green
            } else {
                dot.classList.add('status-online');
            }
        }
        const time = document.getElementById(`vital-${key}-time`);
        if (time) time.textContent = 'Just now';
    }

    // ─── Assessment Display ──────────────────────────────────────

    function showAssessment(riskResult) {
        const panel = document.getElementById('assessment-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        panel.style.borderLeftColor =
            riskResult.level === 'HIGH_RISK' ? 'var(--danger)' :
            riskResult.level === 'WARNING'   ? 'var(--warning)' : 'var(--success)';

        const rl = document.getElementById('assessment-risk-level');
        if (rl) {
            const styles = {
                NORMAL:    { bg: 'var(--success)', label: '🟢 NORMAL' },
                WARNING:   { bg: 'var(--warning)', label: '🟡 WARNING' },
                HIGH_RISK: { bg: 'var(--danger)',  label: '🔴 HIGH RISK' }
            };
            const s = styles[riskResult.level] || styles.NORMAL;
            rl.style.background = s.bg;
            rl.style.color = riskResult.level === 'WARNING' ? '#1e293b' : 'white';
            rl.textContent = s.label;
        }

        const fList = document.getElementById('assessment-factors');
        if (fList) {
            fList.innerHTML = '';
            (riskResult.factors || []).forEach(f => {
                const li = document.createElement('li');
                li.textContent = f;
                fList.appendChild(li);
            });
            if (!riskResult.factors || riskResult.factors.length === 0) {
                const li = document.createElement('li');
                li.textContent = 'All readings within normal ranges.';
                li.style.color = 'var(--success)';
                fList.appendChild(li);
            }
        }

        const action = document.getElementById('assessment-action');
        if (action) action.textContent = riskResult.suggestedAction || 'Continue monitoring.';
    }

    // ─── Process a New Vital Reading ─────────────────────────────

    async function processReading(vitals) {
        updateVitalDisplay(vitals);

        const riskResult = VG.riskEngine
            ? VG.riskEngine.analyze(vitals)
            : { level: 'NORMAL', factors: [], suggestedAction: 'Continue monitoring.' };

        showAssessment(riskResult);

        // Save to DB if a patient is selected
        if (selectedPatientId && VG.db) {
            const p = selectedPatient || await VG.db.getPatient(selectedPatientId);
            if (p) {
                await VG.db.addReading({
                    patientId:    p.id,
                    patientName:  p.name,
                    heartRate:    vitals.heartRate,
                    spo2:         vitals.spo2,
                    temperature:  vitals.temperature,
                    bloodPressure: vitals.bloodPressure || null,
                    movement:     vitals.movement || null,
                    riskLevel:    riskResult.level,
                    riskFactors:  riskResult.factors,
                    timestamp:    vitals.timestamp || new Date().toISOString(),
                    syncStatus:   online ? 'SYNCED' : 'PENDING'
                });

                if (riskResult.level === 'HIGH_RISK' && VG.alerts) {
                    VG.alerts.check(p, vitals, riskResult);
                }
                if (!online) showToast('💾 Reading saved locally (offline)', 'info');
            }
        } else if (!selectedPatientId) {
            showToast('⚠ Select a patient to save readings', 'warning');
        }

        // Refresh visible data
        if (currentPage === 'dashboard') refreshDashboard();
    }

    // ─── HTML Generators ─────────────────────────────────────────

    function readingRow(r) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="p-2 text-sm">${formatDateTime(r.timestamp)}</td>
            <td class="p-2">${r.patientName || '--'}</td>
            <td class="p-2">${r.heartRate} <small class="text-muted">BPM</small></td>
            <td class="p-2">${r.spo2}%</td>
            <td class="p-2">${r.temperature}°C</td>
            <td class="p-2">${r.bloodPressure ? r.bloodPressure.systolic + '/' + r.bloodPressure.diastolic : '--'}</td>
            <td class="p-2">${getRiskBadgeHTML(r.riskLevel)}</td>
            <td class="p-2">${getSyncBadgeHTML(r.syncStatus)}</td>`;
        return tr;
    }

    function vitalCardsHTML(vitals) {
        const items = [
            { icon: '❤️', label: 'Heart Rate', value: vitals.heartRate, unit: 'BPM' },
            { icon: '🫁', label: 'SpO₂', value: vitals.spo2, unit: '%' },
            { icon: '🌡️', label: 'Temperature', value: vitals.temperature, unit: '°C' },
            { icon: '🩸', label: 'Blood Pressure', value: vitals.bloodPressure ? `${vitals.bloodPressure.systolic}/${vitals.bloodPressure.diastolic}` : '--', unit: 'mmHg' },
            { icon: '🚶', label: 'Movement', value: vitals.movement || '--', unit: '' }
        ];
        return items.map(i => `
            <div class="vital-card">
                <div class="vital-header"><span class="vital-icon">${i.icon}</span></div>
                <div class="vital-body text-center my-2">
                    <div class="vital-value-wrapper"><span class="vital-value">${i.value}</span> <span class="vital-unit">${i.unit}</span></div>
                    <div class="vital-label text-muted">${i.label}</div>
                </div>
            </div>`).join('');
    }

    function assessmentHTML(riskResult) {
        const colors = { NORMAL: 'var(--success)', WARNING: 'var(--warning)', HIGH_RISK: 'var(--danger)' };
        const labels = { NORMAL: '🟢 NORMAL', WARNING: '🟡 WARNING', HIGH_RISK: '🔴 HIGH RISK' };
        const factors = (riskResult.factors || []).map(f => `<li>${f}</li>`).join('') || '<li style="color:var(--success)">All readings within normal ranges.</li>';
        return `
            <h3 class="mb-2">Offline AI Risk Assessment</h3>
            <div class="flex items-start gap-4">
                <div style="background:${colors[riskResult.level]};color:${riskResult.level === 'WARNING' ? '#1e293b' : 'white'};padding:8px 16px;border-radius:8px;font-weight:700;font-size:1rem;white-space:nowrap">${labels[riskResult.level]}</div>
                <div class="flex-1">
                    <h4 class="font-bold mb-1">Detected Factors</h4>
                    <ul class="list-disc pl-5 mb-2" style="color:var(--danger)">${factors}</ul>
                    <div class="bg-info-light p-2 rounded"><p class="italic mb-0" style="color:var(--primary)">${riskResult.suggestedAction}</p></div>
                </div>
            </div>
            <div class="disclaimer-text text-xs text-muted italic mt-3 pt-2 border-t">${riskResult.disclaimer || 'VitalGuard AI is a screening tool, not a diagnostic device. Always consult a healthcare professional.'}</div>`;
    }

    // ─── Tiny Helpers ────────────────────────────────────────────

    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val ?? '--';
    }

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function selectPatient(id) {
        if (!id) return;
        selectedPatientId = id;
        selectedPatient = await VG.db.getPatient(id);
        
        const patSelect = document.getElementById('monitoring-patient-select');
        if (patSelect && patSelect.value !== id) patSelect.value = id;
        
        await refreshPatientDetails();
        
        if (VG.demo && VG.demo.isRunning()) return;
        navigate('patient');
    }

    // ─── Initialisation ──────────────────────────────────────────

    async function init() {
        // 1. Database
        if (VG.db) {
            await VG.db.init();
            const pts = await VG.db.getAllPatients();
            if (pts.length === 0) await VG.db.seedDemoData();
            const allPts = await VG.db.getAllPatients();
            if (allPts.length > 0) {
                selectedPatientId = allPts[0].id;
                selectedPatient = allPts[0];
            }
        }

        // 2. Charts
        if (VG.charts) VG.charts.init();
        
        // ───── Role Switcher ─────
        const roleSelector = document.getElementById('role-selector');
        if (roleSelector) {
            roleSelector.addEventListener('change', async (e) => {
                const role = e.target.value;
                const docEls = document.querySelectorAll('.role-doc');
                const patEls = document.querySelectorAll('.role-pat');
                
                if (role === 'patient') {
                    docEls.forEach(el => el.style.display = 'none');
                    patEls.forEach(el => el.style.display = '');
                    
                    const pts = await VG.db.getAllPatients();
                    if (pts.length > 0) await selectPatient(pts[0].id);
                    navigate('patient');
                } else {
                    patEls.forEach(el => el.style.display = 'none');
                    docEls.forEach(el => el.style.display = '');
                    navigate('dashboard');
                }
            });
        }
        
        // Populate Patient Dropdowns (monitoring and history)
        const patSelect = document.getElementById('monitoring-patient-select');
        const histSelect = document.getElementById('history-patient-filter');
        if (patSelect || histSelect) {
            const allPts = await VG.db.getAllPatients();
            if (patSelect) {
                patSelect.innerHTML = '<option value="">Select a patient to monitor...</option>';
                allPts.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `${p.name} (${p.id})`;
                    patSelect.appendChild(opt);
                });
                patSelect.addEventListener('change', (e) => {
                    if (e.target.value) selectPatient(e.target.value);
                });
            }
            if (histSelect) {
                histSelect.innerHTML = '<option value="all">All Patients</option>';
                allPts.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `${p.name} (${p.id})`;
                    histSelect.appendChild(opt);
                });
                histSelect.addEventListener('change', () => refreshHistory());
            }
        }

        // 3. Sub‑module event listeners
        if (VG.alerts) VG.alerts.setupEventListeners();
        if (VG.demo)   VG.demo.setupEventListeners();

        // ───── Navigation (sidebar + mobile) ─────
        document.querySelectorAll('#sidebar .nav-links a, #mobile-nav a').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault();
                const page = a.dataset.page;
                if (page) navigate(page);
            });
        });

        // ───── Hash‑based routing ─────
        window.addEventListener('hashchange', () => {
            const h = window.location.hash.substring(1);
            if (h) navigate(h);
        });

        // ───── Online / Offline ─────
        window.addEventListener('online',  () => setOnline(true));
        window.addEventListener('offline', () => setOnline(false));
        const btnToggle = document.getElementById('btn-toggle-offline');
        if (btnToggle) btnToggle.addEventListener('click', () => setOnline(!online));

        // ───── Sensor Controls ─────
        const btnStart = document.getElementById('btn-start-monitor');
        const btnStop  = document.getElementById('btn-stop-monitor');

        if (btnStart) btnStart.addEventListener('click', () => {
            if (!selectedPatientId) {
                showToast('⚠ Please select a patient first', 'warning');
                return;
            }
            VG.sensor.startMonitoring();
            btnStart.classList.add('hidden');
            if (btnStop) btnStop.classList.remove('hidden');
            monitoringActive = true;
        });
        if (btnStop) btnStop.addEventListener('click', () => {
            VG.sensor.stopMonitoring();
            btnStop.classList.add('hidden');
            if (btnStart) btnStart.classList.remove('hidden');
            monitoringActive = false;
        });

        // Sensor reading callback
        if (VG.sensor) VG.sensor.onReading(vitals => processReading(vitals));

        // Demo preset buttons
        const presets = { 'btn-demo-normal': 'normal', 'btn-demo-warning': 'warning', 'btn-demo-critical': 'critical' };
        Object.entries(presets).forEach(([id, type]) => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', () => {
                const reading = VG.sensor.simulateSingle(type);
                processReading(reading);
            });
        });

        // Manual input dialog
        const btnManual = document.getElementById('btn-manual-input');
        const manualDlg = document.getElementById('manual-input-dialog');
        if (btnManual && manualDlg) {
            btnManual.addEventListener('click', () => manualDlg.showModal());
        }
        const formManual = document.getElementById('form-manual-input');
        if (formManual) {
            formManual.addEventListener('submit', e => {
                e.preventDefault();
                const vitals = {
                    heartRate:     Number(document.getElementById('manual-hr').value),
                    spo2:          Number(document.getElementById('manual-spo2').value),
                    temperature:   Number(document.getElementById('manual-temp').value),
                    bloodPressure: {
                        systolic:  Number(document.getElementById('manual-bp-sys').value),
                        diastolic: Number(document.getElementById('manual-bp-dia').value)
                    },
                    movement:      document.getElementById('manual-movement')?.value || 'Normal',
                    timestamp:     new Date().toISOString()
                };
                processReading(vitals);
                manualDlg.close();
                showToast('Manual reading applied', 'success');
            });
        }

        // Sensor mode toggle
        const modeToggle = document.getElementById('sensor-mode-toggle');
        const modeLabel  = document.getElementById('sensor-mode-label');
        if (modeToggle) {
            modeToggle.addEventListener('change', e => {
                const real = e.target.checked;
                VG.sensor.setMode(real ? 'real' : 'demo');
                if (modeLabel) modeLabel.textContent = real ? 'Real' : 'Demo';
                // Update sensor status in sidebar
                const sDot = document.getElementById('sensor-status');
                if (sDot) sDot.className = 'status-dot ' + (real ? 'status-online' : 'status-demo');
                // Show/hide demo controls
                document.querySelectorAll('.demo-controls').forEach(d => d.style.display = real ? 'none' : 'flex');
                // Update top-bar sensor pill
                document.querySelectorAll('.status-pill').forEach(pill => {
                    if (pill.textContent.includes('Sensor')) {
                        pill.innerHTML = `<span class="status-dot ${real ? 'status-online' : 'status-demo'}"></span> Sensor: ${real ? 'Connected' : 'Demo'}`;
                    }
                });
            });
        }

        // ───── Patient Selector ─────
        const pSel = document.getElementById('monitoring-patient-select');
        if (pSel) pSel.addEventListener('change', e => {
            if (e.target.value) {
                selectedPatientId = e.target.value;
                VG.db.getPatient(e.target.value).then(p => { selectedPatient = p; });
                showToast(`Monitoring: ${e.target.selectedOptions[0]?.textContent}`, 'info');
            }
        });

        // ───── Registration Form ─────
        const formReg = document.getElementById('form-register');
        if (formReg) {
            formReg.addEventListener('submit', async e => {
                e.preventDefault();
                const patient = {
                    id:               document.getElementById('reg-patient-id').value || `VG-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`,
                    name:             document.getElementById('reg-name').value,
                    age:              Number(document.getElementById('reg-age').value),
                    gender:           document.getElementById('reg-gender').value,
                    location:         document.getElementById('reg-location').value,
                    emergencyContact: document.getElementById('reg-emergency-contact').value,
                    registeredAt:     new Date().toISOString()
                };
                try {
                    await VG.db.addPatient(patient);
                    showToast('✅ Patient registered successfully!', 'success');
                    refreshRegister();
                } catch (err) {
                    showToast('❌ Registration failed: ' + err.message, 'error');
                }
            });
        }

        // Auto-generate ID button
        const btnGenId = document.getElementById('btn-generate-id');
        if (btnGenId) {
            btnGenId.addEventListener('click', async () => {
                const patients = await VG.db.getAllPatients();
                const seq = String(patients.length + 1).padStart(3, '0');
                const idField = document.getElementById('reg-patient-id');
                if (idField) idField.value = `VG-${new Date().getFullYear()}-${seq}`;
            });
        }

        // ───── History Filters ─────
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                document.querySelectorAll('.filter-btn').forEach(b => {
                    b.classList.remove('active', 'btn-primary');
                    b.classList.add('btn-outline');
                });
                e.currentTarget.classList.add('active', 'btn-primary');
                e.currentTarget.classList.remove('btn-outline');
                refreshHistory(e.currentTarget.dataset.filter);
            });
        });

        // ───── Sync Button ─────
        const btnSync = document.getElementById('btn-sync-now');
        if (btnSync) btnSync.addEventListener('click', () => runSyncSimulation());

        // ───── Initial Route ─────
        const initialHash = window.location.hash.substring(1);
        navigate(initialHash || 'landing');
        setOnline(navigator.onLine);
    }

    // ─── Public API ──────────────────────────────────────────────
    return {
        init,
        navigate,
        setOnline,
        isOnline,
        showToast,
        processReading,
        selectPatient,
        refreshDashboard
    };
})();

// Boot the application
document.addEventListener('DOMContentLoaded', () => VG.app.init());
