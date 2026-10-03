/**
 * VitalGuard AI — Guided Demo Module
 * Runs a 9-step automatic demonstration in ~2–3 minutes.
 */
window.VG = window.VG || {};
VG.demo = (function () {
    let running = false;
    let paused  = false;
    let currentStep = 0;
    let stepTimer   = null;

    const steps = [
        {
            title: 'Connecting to Demo Patient',
            description: 'Initializing sensor connection and loading patient profile…',
            duration: 5000,
            action: async () => {
                VG.app.navigate('dashboard');
                VG.sensor.setMode('demo');
                // Select Ramesh Kumar in the dropdown
                const sel = document.getElementById('monitoring-patient-select');
                if (sel) {
                    for (let i = 0; i < sel.options.length; i++) {
                        if (sel.options[i].text.includes('Ramesh Kumar')) { sel.selectedIndex = i; break; }
                    }
                    sel.dispatchEvent(new Event('change'));
                }
                await VG.app.selectPatient('VG-MY-001');
                VG.app.navigate('dashboard');
                VG.app.showToast('App started for: Ramesh Kumar', 'info');
            }
        },
        {
            title: 'Normal Vital Signs',
            description: 'Reading normal vital signs from sensors…',
            duration: 6000,
            action: () => {
                const reading = VG.sensor.simulateSingle('normal');
                VG.app.processReading(reading);
                VG.app.showToast('✅ Reading: All vitals normal', 'success');
            }
        },
        {
            title: 'Warning Indicators Detected',
            description: 'Vital signs showing borderline readings…',
            duration: 6000,
            action: async () => {
                await VG.app.selectPatient('VG-MY-001');
                VG.app.navigate('dashboard');
                const reading = VG.sensor.simulateSingle('warning');
                VG.app.processReading(reading);
                VG.app.showToast('⚠️ Warning: Borderline readings detected', 'warning');
            }
        },
        {
            title: 'Critical Vital Signs',
            description: 'Multiple concerning readings detected…',
            duration: 6000,
            action: async () => {
                await VG.app.selectPatient('VG-MY-001');
                VG.app.navigate('dashboard');
                const reading = VG.sensor.simulateSingle('critical');
                VG.app.processReading(reading);
            }
        },
        {
            title: 'Critical Health Alert',
            description: 'System generating emergency alert…',
            duration: 7000,
            action: () => {
                VG.app.showToast('🚨 Critical alert generated!', 'error');
                // Alert dialog should already be showing from the HIGH_RISK processReading
            }
        },
        {
            title: 'Going Offline',
            description: 'Simulating loss of internet connectivity…',
            duration: 5000,
            action: () => {
                if (VG.alerts) VG.alerts.dismiss();
                VG.app.setOnline(false);
                VG.app.showToast('🔴 Internet connection lost', 'error');
            }
        },
        {
            title: 'Offline Data Storage',
            description: 'Continuing monitoring without internet. Data saved locally.',
            duration: 6000,
            action: () => {
                const reading = VG.sensor.simulateSingle('warning');
                VG.app.processReading(reading);
                VG.app.showToast('💾 Reading saved locally (offline)', 'info');
            }
        },
        {
            title: 'Restoring Connectivity',
            description: 'Internet connection restored…',
            duration: 5000,
            action: () => {
                VG.app.setOnline(true);
                VG.app.showToast('🟢 Internet connection restored', 'success');
                VG.app.navigate('sync');
            }
        },
        {
            title: 'Data Synchronized',
            description: 'Syncing locally stored records to the server…',
            duration: 6000,
            action: () => {
                const btn = document.getElementById('btn-sync-now');
                if (btn) btn.click();
            }
        }
    ];

    function updateOverlay() {
        const overlay = document.getElementById('demo-overlay');
        if (!overlay) return;

        if (running) {
            overlay.classList.remove('hidden');
            // The overlay uses display:flex (from CSS) when not hidden
            const stepNum = document.getElementById('demo-step-number');
            if (stepNum) stepNum.textContent = currentStep + 1;
            const title = document.getElementById('demo-step-title');
            if (title) title.textContent = steps[currentStep]?.title || 'Demo Complete';
            const desc = document.getElementById('demo-step-description');
            if (desc) desc.textContent = steps[currentStep]?.description || '';
            const bar = document.getElementById('demo-progress-bar');
            if (bar) bar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
        } else {
            overlay.classList.add('hidden');
        }
    }

    function runStep() {
        if (!running || paused) return;
        if (currentStep >= steps.length) {
            stop();
            VG.app.showToast('🎉 Demo completed successfully!', 'success');
            return;
        }

        updateOverlay();

        // Execute the step action
        const result = steps[currentStep].action();
        // Handle async actions
        Promise.resolve(result).then(() => {
            stepTimer = setTimeout(() => {
                currentStep++;
                runStep();
            }, steps[currentStep]?.duration || 3000);
        });
    }

    function start() {
        running = true;
        paused = false;
        currentStep = 0;
        // Small delay so the dashboard can load first
        setTimeout(() => runStep(), 500);
    }

    function stop() {
        running = false;
        paused = false;
        if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
        updateOverlay();
    }

    function pause() {
        paused = true;
        if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
        const btn = document.getElementById('btn-demo-pause');
        if (btn) btn.textContent = 'Resume';
    }

    function resume() {
        paused = false;
        const btn = document.getElementById('btn-demo-pause');
        if (btn) btn.textContent = 'Pause';
        runStep();
    }

    return {
        start,
        pause,
        resume,
        skip: stop,
        isRunning: () => running,
        setupEventListeners: function () {
            // Top bar Start Demo button
            const btnStart = document.getElementById('btn-demo-start');
            if (btnStart) btnStart.addEventListener('click', () => start());

            // Overlay controls
            const btnSkip = document.getElementById('btn-demo-skip');
            if (btnSkip) btnSkip.addEventListener('click', () => stop());

            const btnPause = document.getElementById('btn-demo-pause');
            if (btnPause) {
                btnPause.addEventListener('click', () => {
                    if (paused) resume(); else pause();
                });
            }

            // "Next Step" button in overlay (manual advance)
            const btnNext = document.getElementById('btn-demo-next');
            if (btnNext) {
                btnNext.addEventListener('click', () => {
                    if (!running) { start(); return; }
                    // Skip to next step immediately
                    if (stepTimer) clearTimeout(stepTimer);
                    currentStep++;
                    runStep();
                });
            }
        }
    };
})();
