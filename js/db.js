window.VG = window.VG || {};

window.VG.db = (function() {
    const DB_NAME = 'VitalGuardDB';
    const DB_VERSION = 1;
    let db = null;

    /**
     * Helper to wrap IndexedDB requests in Promises
     */
    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Initialize the database and create stores/indexes if needed
     */
    function init() {
        return new Promise((resolve, reject) => {
            if (db) {
                resolve(db);
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                const upgradeDb = event.target.result;

                // 1. 'patients' store
                if (!upgradeDb.objectStoreNames.contains('patients')) {
                    const patientsStore = upgradeDb.createObjectStore('patients', { keyPath: 'id' });
                    patientsStore.createIndex('name', 'name', { unique: false });
                    patientsStore.createIndex('location', 'location', { unique: false });
                }

                // 2. 'readings' store
                if (!upgradeDb.objectStoreNames.contains('readings')) {
                    const readingsStore = upgradeDb.createObjectStore('readings', { keyPath: 'id', autoIncrement: true });
                    readingsStore.createIndex('patientId', 'patientId', { unique: false });
                    readingsStore.createIndex('riskLevel', 'riskLevel', { unique: false });
                    readingsStore.createIndex('syncStatus', 'syncStatus', { unique: false });
                    readingsStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // 3. 'alerts' store
                if (!upgradeDb.objectStoreNames.contains('alerts')) {
                    const alertsStore = upgradeDb.createObjectStore('alerts', { keyPath: 'id', autoIncrement: true });
                    alertsStore.createIndex('patientId', 'patientId', { unique: false });
                    alertsStore.createIndex('acknowledged', 'acknowledged', { unique: false });
                }
            };
        });
    }

    // --- Patients API ---

    async function addPatient(patient) {
        if (!db) await init();
        const transaction = db.transaction(['patients'], 'readwrite');
        const store = transaction.objectStore('patients');
        return requestToPromise(store.add(patient));
    }

    async function getPatient(id) {
        if (!db) await init();
        const transaction = db.transaction(['patients'], 'readonly');
        const store = transaction.objectStore('patients');
        return requestToPromise(store.get(id));
    }

    async function getAllPatients() {
        if (!db) await init();
        const transaction = db.transaction(['patients'], 'readonly');
        const store = transaction.objectStore('patients');
        return requestToPromise(store.getAll());
    }

    async function updatePatient(patient) {
        if (!db) await init();
        const transaction = db.transaction(['patients'], 'readwrite');
        const store = transaction.objectStore('patients');
        return requestToPromise(store.put(patient));
    }

    async function deletePatient(id) {
        if (!db) await init();
        const transaction = db.transaction(['patients'], 'readwrite');
        const store = transaction.objectStore('patients');
        return requestToPromise(store.delete(id));
    }

    // --- Readings API ---

    async function addReading(reading) {
        if (!db) await init();
        if (!reading.syncStatus) {
            reading.syncStatus = 'PENDING';
        }
        const transaction = db.transaction(['readings'], 'readwrite');
        const store = transaction.objectStore('readings');
        return requestToPromise(store.add(reading));
    }

    async function getReadings(patientId = null) {
        if (!db) await init();
        const transaction = db.transaction(['readings'], 'readonly');
        const store = transaction.objectStore('readings');
        
        let readings;
        if (patientId) {
            const index = store.index('patientId');
            readings = await requestToPromise(index.getAll(patientId));
        } else {
            readings = await requestToPromise(store.getAll());
        }
        
        // Sort by timestamp desc
        return readings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    async function getReadingsByFilter(filter) {
        if (!db) await init();
        const readings = await getReadings(); // gets all, sorted desc
        
        switch (filter) {
            case 'normal':
                return readings.filter(r => r.riskLevel === 'NORMAL');
            case 'warning':
                return readings.filter(r => r.riskLevel === 'WARNING');
            case 'critical':
                return readings.filter(r => r.riskLevel === 'HIGH_RISK');
            case 'pending':
                return readings.filter(r => r.syncStatus === 'PENDING');
            case 'synced':
                return readings.filter(r => r.syncStatus === 'SYNCED');
            case 'all':
            default:
                return readings;
        }
    }

    async function getLatestReading(patientId) {
        if (!db) await init();
        const readings = await getReadings(patientId);
        return readings.length > 0 ? readings[0] : null;
    }

    async function updateSyncStatus(readingId, status) {
        if (!db) await init();
        const transaction = db.transaction(['readings'], 'readwrite');
        const store = transaction.objectStore('readings');
        
        const reading = await requestToPromise(store.get(readingId));
        if (reading) {
            reading.syncStatus = status;
            return requestToPromise(store.put(reading));
        }
        throw new Error('Reading not found');
    }

    async function syncAllPending() {
        if (!db) await init();
        const pendingReadings = await getReadingsByFilter('pending');
        
        if (pendingReadings.length === 0) return 0;

        const transaction = db.transaction(['readings'], 'readwrite');
        const store = transaction.objectStore('readings');
        
        let count = 0;
        for (const reading of pendingReadings) {
            reading.syncStatus = 'SYNCED';
            store.put(reading);
            count++;
        }
        
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve(count);
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    // --- Alerts API ---

    async function addAlert(alert) {
        if (!db) await init();
        const transaction = db.transaction(['alerts'], 'readwrite');
        const store = transaction.objectStore('alerts');
        return requestToPromise(store.add({ ...alert, acknowledged: false }));
    }

    async function getAlerts() {
        if (!db) await init();
        const transaction = db.transaction(['alerts'], 'readonly');
        const store = transaction.objectStore('alerts');
        const alerts = await requestToPromise(store.getAll());
        return alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    async function acknowledgeAlert(id) {
        if (!db) await init();
        const transaction = db.transaction(['alerts'], 'readwrite');
        const store = transaction.objectStore('alerts');
        const alert = await requestToPromise(store.get(id));
        if (alert) {
            alert.acknowledged = true;
            return requestToPromise(store.put(alert));
        }
        throw new Error('Alert not found');
    }

    // --- Stats API ---

    async function getStats() {
        if (!db) await init();
        const readings = await getReadings();
        let normal = 0, warning = 0, critical = 0;

        for (const r of readings) {
            if (r.riskLevel === 'NORMAL') normal++;
            else if (r.riskLevel === 'WARNING') warning++;
            else if (r.riskLevel === 'HIGH_RISK') critical++;
        }

        const pendingReadings = await getReadingsByFilter('pending');

        return {
            totalReadings: readings.length,
            normal,
            warning,
            critical,
            pendingSync: pendingReadings.length
        };
    }

    // --- Demo Data ---

    async function seedDemoData() {
        if (!db) await init();

        // 1. Clear existing data
        const txClear = db.transaction(['patients', 'readings', 'alerts'], 'readwrite');
        txClear.objectStore('patients').clear();
        txClear.objectStore('readings').clear();
        txClear.objectStore('alerts').clear();

        await new Promise((resolve) => txClear.oncomplete = resolve);

        // 2. Prepare seed data
        const now = new Date();
        const past = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
        const recent = now.toISOString();

        const patients = [
            { id: 'VG-MY-001', name: 'Ramesh Kumar', age: 45, gender: 'Male', location: 'Rampur Village', emergencyContact: '+91-9876543210', registeredAt: past(10) }
        ];

        const generateReadings = (patientId, name, latestReadingProps, count = 12) => {
            const readings = [];
            
            // Generate historical readings
            for (let i = count; i >= 1; i--) {
                const isNormal = Math.random() > 0.2; // mostly normal historical
                const hr = isNormal ? Math.floor(Math.random() * (90 - 70) + 70) : Math.floor(Math.random() * (110 - 95) + 95);
                const spo2 = isNormal ? Math.floor(Math.random() * (100 - 96) + 96) : Math.floor(Math.random() * (95 - 92) + 92);
                const temp = isNormal ? (Math.random() * (37.2 - 36.1) + 36.1).toFixed(1) : (Math.random() * (38.0 - 37.5) + 37.5).toFixed(1);
                
                readings.push({
                    patientId,
                    patientName: name,
                    heartRate: hr,
                    spo2: spo2,
                    temperature: parseFloat(temp),
                    bloodPressure: { systolic: isNormal ? 120 : 130, diastolic: isNormal ? 80 : 85 },
                    movement: 'Normal',
                    riskLevel: isNormal ? 'NORMAL' : 'WARNING',
                    riskFactors: isNormal ? [] : ['Slight vital irregularity'],
                    timestamp: past(i),
                    syncStatus: 'SYNCED'
                });
            }

            // Add the latest specific reading
            readings.push({
                patientId,
                patientName: name,
                timestamp: recent,
                ...latestReadingProps
            });

            return readings;
        };

        const readings = [
            ...generateReadings('VG-MY-001', 'Ramesh Kumar', {
                heartRate: 72, spo2: 98, temperature: 36.7, bloodPressure: { systolic: 120, diastolic: 80 }, movement: 'Normal',
                riskLevel: 'NORMAL', riskFactors: [], syncStatus: 'SYNCED'
            })
        ];

        // 3. Insert data
        const txInsert = db.transaction(['patients', 'readings', 'alerts'], 'readwrite');
        
        patients.forEach(p => txInsert.objectStore('patients').add(p));
        readings.forEach(r => txInsert.objectStore('readings').add(r));
        
        // Add one demo alert for Ravi Kumar
        // Not needed for single user

        return new Promise((resolve, reject) => {
            txInsert.oncomplete = () => {
                console.log('Demo data seeded successfully');
                resolve();
            };
            txInsert.onerror = (e) => {
                console.error('Failed to seed demo data', e);
                reject(e.target.error);
            };
        });
    }

    // Expose Public API
    return {
        init,
        addPatient, getPatient, getAllPatients, updatePatient, deletePatient,
        addReading, getReadings, getReadingsByFilter, getLatestReading, updateSyncStatus, syncAllPending,
        addAlert, getAlerts, acknowledgeAlert,
        getStats,
        seedDemoData
    };
})();
