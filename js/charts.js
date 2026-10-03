window.VG = window.VG || {};
VG.charts = (function() {
    let vitalChart = null;
    let riskChart = null;

    return {
        init: function() {
            if (typeof Chart === 'undefined') {
                const vc = document.getElementById('chart-vitals-canvas');
                const rc = document.getElementById('chart-risk-canvas');
                if (vc) vc.parentElement.innerHTML = '<div class="offline-msg">Charts unavailable offline</div>';
                if (rc) rc.parentElement.innerHTML = '<div class="offline-msg">Charts unavailable offline</div>';
                return;
            }

            const ctxVitals = document.getElementById('chart-vitals-canvas');
            if (ctxVitals) {
                vitalChart = new Chart(ctxVitals, {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [
                            {
                                label: 'Heart Rate',
                                borderColor: 'red',
                                data: [],
                                yAxisID: 'y',
                                tension: 0.4
                            },
                            {
                                label: 'SpO2',
                                borderColor: 'blue',
                                data: [],
                                yAxisID: 'y',
                                tension: 0.4
                            },
                            {
                                label: 'Temperature',
                                borderColor: 'orange',
                                data: [],
                                yAxisID: 'y1',
                                tension: 0.4
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                        scales: {
                            y: {
                                type: 'linear',
                                display: true,
                                position: 'left',
                                min: 0,
                                max: 200,
                            },
                            y1: {
                                type: 'linear',
                                display: true,
                                position: 'right',
                                min: 34,
                                max: 42,
                                grid: {
                                    drawOnChartArea: false,
                                },
                            }
                        },
                        plugins: {
                            legend: {
                                position: 'top',
                            }
                        }
                    }
                });
            }

            const ctxRisk = document.getElementById('chart-risk-canvas');
            if (ctxRisk) {
                riskChart = new Chart(ctxRisk, {
                    type: 'doughnut',
                    data: {
                        labels: ['Normal', 'Warning', 'High Risk'],
                        datasets: [{
                            data: [0, 0, 0],
                            backgroundColor: ['#28a745', '#ffc107', '#dc3545']
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: {
                                position: 'bottom',
                            }
                        }
                    }
                });
            }
        },
        updateVitalTrends: function(readings) {
            if (!vitalChart) return;
            const last20 = readings.slice(-20);
            
            vitalChart.data.labels = last20.map(r => {
                const d = new Date(r.timestamp);
                return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
            });
            vitalChart.data.datasets[0].data = last20.map(r => r.heartRate);
            vitalChart.data.datasets[1].data = last20.map(r => r.spo2);
            vitalChart.data.datasets[2].data = last20.map(r => r.temperature);
            
            vitalChart.update();
        },
        updateRiskDistribution: function(stats) {
            if (!riskChart) return;
            riskChart.data.datasets[0].data = [stats.normal || 0, stats.warning || 0, stats.critical || 0];
            riskChart.update();
        },
        destroy: function() {
            if (vitalChart) vitalChart.destroy();
            if (riskChart) riskChart.destroy();
            vitalChart = null;
            riskChart = null;
        }
    };
})();
