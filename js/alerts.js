window.VG = window.VG || {};
VG.alerts = (function() {
    return {
        check: function(patient, vitals, riskResult) {
            if (riskResult.level === 'HIGH_RISK') {
                const alertData = {
                    patientId: patient.id,
                    patientName: patient.name,
                    vitals: vitals,
                    factors: riskResult.factors,
                    timestamp: new Date().toISOString()
                };
                this.show(alertData);
                return alertData;
            }
            return null;
        },
        show: function(alertData) {
            const dialog = document.getElementById('alert-dialog');
            if (!dialog) return;
            
            document.getElementById('alert-patient-name').textContent = alertData.patientName;
            document.getElementById('alert-patient-id').textContent = alertData.patientId;
            document.getElementById('alert-datetime').textContent = new Date(alertData.timestamp).toLocaleString();
            
            const vList = document.getElementById('alert-vitals-list');
            if (vList) vList.innerHTML = `
                <div><strong>❤️ Heart Rate</strong><br>${alertData.vitals.heartRate} BPM</div>
                <div><strong>🫁 SpO₂</strong><br>${alertData.vitals.spo2}%</div>
                <div><strong>🌡️ Temperature</strong><br>${alertData.vitals.temperature}°C</div>
                <div><strong>🩸 Blood Pressure</strong><br>${alertData.vitals.bloodPressure ? alertData.vitals.bloodPressure.systolic + '/' + alertData.vitals.bloodPressure.diastolic + ' mmHg' : '--'}</div>
            `;
            
            const fList = document.getElementById('alert-factors-list');
            fList.innerHTML = '';
            if (alertData.factors && alertData.factors.length > 0) {
                alertData.factors.forEach(f => {
                    const li = document.createElement('li');
                    li.textContent = f;
                    fList.appendChild(li);
                });
            } else {
                fList.innerHTML = '<li>Unknown critical factors</li>';
            }
            
            // Add pulsing effect
            dialog.classList.add('pulsing-red-border');
            
            dialog.showModal();
            
            // Store alert in DB
            if (VG.db && VG.db.addAlert) {
                VG.db.addAlert(alertData).then(id => {
                    dialog.dataset.alertId = id;
                });
            }
        },
        dismiss: function() {
            const dialog = document.getElementById('alert-dialog');
            if (dialog) {
                dialog.close();
                dialog.classList.remove('pulsing-red-border');
            }
        },
        acknowledge: function(alertId) {
            this.dismiss();
            if (VG.db && VG.db.acknowledgeAlert) {
                VG.db.acknowledgeAlert(alertId);
            }
        },
        getHistory: function() {
            if (VG.db && VG.db.getAlerts) {
                return VG.db.getAlerts();
            }
            return Promise.resolve([]);
        },
        setupEventListeners: function() {
            const btnAck = document.getElementById('btn-alert-acknowledge');
            if (btnAck) {
                btnAck.addEventListener('click', () => {
                    const dialog = document.getElementById('alert-dialog');
                    if (dialog && dialog.dataset.alertId) {
                        this.acknowledge(Number(dialog.dataset.alertId));
                    } else {
                        this.dismiss();
                    }
                });
            }
            
            const btnView = document.getElementById('btn-alert-view-patient');
            if (btnView) {
                btnView.addEventListener('click', () => {
                    const dialog = document.getElementById('alert-dialog');
                    const pid = document.getElementById('alert-patient-id').textContent;
                    this.dismiss();
                    if (VG.app && VG.app.selectPatient) {
                        VG.app.selectPatient(pid);
                    }
                });
            }
            
            const btnHistory = document.getElementById('btn-alert-view-history');
            if (btnHistory) {
                btnHistory.addEventListener('click', () => {
                    this.dismiss();
                    if (VG.app && VG.app.navigate) {
                        VG.app.navigate('history');
                    }
                });
            }
        }
    };
})();
