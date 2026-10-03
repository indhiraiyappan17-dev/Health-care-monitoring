window.VG = window.VG || {};

window.VG.riskEngine = (function() {
    // Medical Disclaimer - Must be included in all risk assessments
    const DISCLAIMER = 'This prototype provides health-risk screening only and does not provide a medical diagnosis. Consult a qualified healthcare professional for medical decisions.';

    // Default configuration thresholds
    let thresholds = {
        heartRate: {
            normal: [60, 100],
            warningLow: [50, 59],
            warningHigh: [101, 120],
            criticalLow: 50,
            criticalHigh: 120
        },
        spo2: {
            normal: [95, 100],
            warning: [90, 94],
            critical: 90
        },
        temperature: {
            normal: [36.1, 37.2],
            warningLow: [35.5, 36.0],
            warningHigh: [37.3, 38.9],
            criticalLow: 35.5,
            criticalHigh: 39.0
        },
        bloodPressure: {
            systolic: {
                normal: [90, 120],
                elevated: [121, 129],
                warning: [130, 139],
                criticalHigh: 140,
                criticalLow: 90
            },
            diastolic: {
                normal: [60, 80],
                elevated: [81, 84],
                warning: [85, 89],
                criticalHigh: 90,
                criticalLow: 60
            }
        },
        movement: {
            normal: ['Normal', 'Active'],
            warning: ['Reduced', 'Limited'],
            critical: ['Immobile', 'Fall Detected']
        }
    };

    /**
     * Weights for total score calculation
     */
    const WEIGHTS = {
        heartRate: 1.0,
        spo2: 1.5,
        temperature: 1.0,
        bloodPressure: 0.8,
        movement: 0.5
    };

    /**
     * Get current thresholds configuration
     */
    function getThresholds() {
        return JSON.parse(JSON.stringify(thresholds)); // Deep copy to prevent accidental mutation
    }

    /**
     * Override thresholds (e.g. for testing or personalized settings)
     */
    function setThresholds(newThresholds) {
        thresholds = { ...thresholds, ...newThresholds };
    }

    /**
     * Analyzes vital signs and determines a holistic risk level.
     * @param {Object} vitals - { heartRate, spo2, temperature, bloodPressure, movement }
     * @returns {Object} Comprehensive analysis result
     */
    function analyze(vitals) {
        if (!vitals) throw new Error('Vitals object is required for analysis');

        let totalScore = 0;
        let isCritical = false;
        let factors = [];
        let details = {};

        // 1. Analyze Heart Rate
        if (typeof vitals.heartRate === 'number') {
            let hr = vitals.heartRate;
            let status = 'NORMAL', points = 0, msg = null;
            
            if (hr < thresholds.heartRate.criticalLow || hr > thresholds.heartRate.criticalHigh) {
                status = 'CRITICAL'; points = 2; msg = `Heart rate is critically ${hr < 50 ? 'low' : 'high'} (${hr} BPM)`;
            } else if ((hr >= 50 && hr <= 59) || (hr >= 101 && hr <= 120)) {
                status = 'WARNING'; points = 1; msg = `Heart rate is abnormal (${hr} BPM)`;
            }
            
            if (status !== 'NORMAL') factors.push(msg);
            totalScore += points * WEIGHTS.heartRate;
            if (status === 'CRITICAL') isCritical = true;
            
            details.heartRate = { value: hr, status, points };
        }

        // 2. Analyze SpO2
        if (typeof vitals.spo2 === 'number') {
            let spo2 = vitals.spo2;
            let status = 'NORMAL', points = 0, msg = null;
            
            if (spo2 < thresholds.spo2.critical) {
                status = 'CRITICAL'; points = 2; msg = `SpO2 is critically low (${spo2}%)`;
            } else if (spo2 >= thresholds.spo2.warning[0] && spo2 <= thresholds.spo2.warning[1]) {
                status = 'WARNING'; points = 1; msg = `SpO2 is below optimal range (${spo2}%)`;
            }

            if (status !== 'NORMAL') factors.push(msg);
            totalScore += points * WEIGHTS.spo2;
            if (status === 'CRITICAL') isCritical = true;

            details.spo2 = { value: spo2, status, points };
        }

        // 3. Analyze Temperature
        if (typeof vitals.temperature === 'number') {
            let temp = vitals.temperature;
            let status = 'NORMAL', points = 0, msg = null;

            if (temp < thresholds.temperature.criticalLow || temp >= thresholds.temperature.criticalHigh) {
                status = 'CRITICAL'; points = 2; msg = `Temperature is critically ${temp < 35.5 ? 'low' : 'high'} (${temp}°C)`;
            } else if ((temp >= 35.5 && temp <= 36.0) || (temp >= 37.3 && temp <= 38.9)) {
                status = 'WARNING'; points = 1; msg = `Temperature is abnormal (${temp}°C)`;
            }

            if (status !== 'NORMAL') factors.push(msg);
            totalScore += points * WEIGHTS.temperature;
            if (status === 'CRITICAL') isCritical = true;

            details.temperature = { value: temp, status, points };
        }

        // 4. Analyze Blood Pressure
        details.bloodPressure = null;
        if (vitals.bloodPressure && typeof vitals.bloodPressure.systolic === 'number' && typeof vitals.bloodPressure.diastolic === 'number') {
            let sys = vitals.bloodPressure.systolic;
            let dia = vitals.bloodPressure.diastolic;
            let status = 'NORMAL', points = 0, msg = null;

            if (sys >= thresholds.bloodPressure.systolic.criticalHigh || sys < thresholds.bloodPressure.systolic.criticalLow || 
                dia >= thresholds.bloodPressure.diastolic.criticalHigh || dia < thresholds.bloodPressure.diastolic.criticalLow) {
                status = 'CRITICAL'; points = 2; msg = `Blood pressure is critical (${sys}/${dia} mmHg)`;
            } else if (
                (sys >= 121 && sys <= 139) || (dia >= 81 && dia <= 89)
            ) {
                status = 'WARNING'; points = 1; msg = `Blood pressure is elevated (${sys}/${dia} mmHg)`;
            }

            if (status !== 'NORMAL') factors.push(msg);
            totalScore += points * WEIGHTS.bloodPressure;
            if (status === 'CRITICAL') isCritical = true;

            details.bloodPressure = { value: `${sys}/${dia}`, status, points };
        }

        // 5. Analyze Movement
        details.movement = null;
        if (vitals.movement) {
            let mov = vitals.movement;
            let status = 'NORMAL', points = 0, msg = null;

            if (thresholds.movement.critical.includes(mov)) {
                status = 'CRITICAL'; points = 2; msg = `Critical movement event: ${mov}`;
            } else if (thresholds.movement.warning.includes(mov)) {
                status = 'WARNING'; points = 1; msg = `Reduced mobility detected (${mov})`;
            }

            if (status !== 'NORMAL') factors.push(msg);
            totalScore += points * WEIGHTS.movement;
            if (status === 'CRITICAL') isCritical = true;

            details.movement = { value: mov, status, points };
        }

        // 6. Final Evaluation
        let level = 'NORMAL';
        let suggestedAction = 'Continue routine monitoring. All readings are within expected ranges.';

        if (isCritical || totalScore >= 3.0) {
            level = 'HIGH_RISK';
            suggestedAction = 'Seek assessment from a qualified healthcare professional promptly. Multiple concerning readings detected.';
        } else if (totalScore >= 1.5) {
            level = 'WARNING';
            suggestedAction = 'Increased monitoring recommended. Consider consulting a healthcare professional if readings persist.';
        }

        return {
            level,
            score: parseFloat(totalScore.toFixed(2)),
            factors,
            suggestedAction,
            details,
            disclaimer: DISCLAIMER
        };
    }

    return {
        analyze,
        getThresholds,
        setThresholds
    };
})();
