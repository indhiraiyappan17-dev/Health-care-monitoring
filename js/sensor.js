window.VG = window.VG || {};
VG.sensor = (function() {
    let mode = 'demo'; // 'demo' or 'real'
    let connected = false;
    let monitoring = false;
    let ws = null;
    let latestReading = null;
    let listeners = [];
    let monitorInterval = null;
    let esp32Url = 'ws://192.168.4.1/ws';
    let currentProfile = 'normal';

    const profiles = {
        'normal': { hr: [68, 78], spo2: [96, 99], temp: [36.4, 37.0], bpsys: [115, 125], bpdia: [75, 82], movement: 'Normal' },
        'warning': { hr: [100, 112], spo2: [92, 95], temp: [37.5, 38.2], bpsys: [130, 140], bpdia: [85, 90], movement: 'Normal' },
        'critical': { hr: [120, 135], spo2: [85, 90], temp: [38.8, 39.5], bpsys: [140, 160], bpdia: [90, 100], movement: 'Reduced' }
    };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    function generateReading(type) {
        const p = profiles[type] || profiles['normal'];
        const reading = {
            heartRate: Math.round(randomInRange(p.hr[0], p.hr[1])),
            spo2: Math.round(randomInRange(p.spo2[0], p.spo2[1])),
            temperature: parseFloat(randomInRange(p.temp[0], p.temp[1]).toFixed(1)),
            bloodPressure: {
                systolic: Math.round(randomInRange(p.bpsys[0], p.bpsys[1])),
                diastolic: Math.round(randomInRange(p.bpdia[0], p.bpdia[1]))
            },
            movement: p.movement,
            timestamp: new Date().toISOString()
        };
        latestReading = reading;
        return reading;
    }

    function notifyListeners(reading) {
        listeners.forEach(cb => cb(reading));
    }

    return {
        setMode: function(newMode) {
            mode = newMode;
            if (mode === 'real') {
                this.connect();
            } else {
                this.disconnect();
                connected = true; // In demo mode, we're always "connected" to the simulation
            }
        },
        getMode: function() {
            return mode;
        },
        connect: function(config) {
            if (mode === 'real') {
                try {
                    ws = new WebSocket(esp32Url);
                    ws.onopen = () => { connected = true; };
                    ws.onmessage = (e) => {
                        try {
                            const data = JSON.parse(e.data);
                            latestReading = {
                                heartRate: data.hr,
                                spo2: data.spo2,
                                temperature: data.temp,
                                bloodPressure: data.bp || null,
                                movement: data.movement || 'Normal',
                                timestamp: new Date().toISOString()
                            };
                            notifyListeners(latestReading);
                        } catch (err) {
                            console.error('Error parsing WS message', err);
                        }
                    };
                    ws.onclose = () => { connected = false; };
                    ws.onerror = () => { connected = false; };
                } catch (err) {
                    console.error('WebSocket connection failed', err);
                    connected = false;
                }
            } else {
                connected = true;
            }
        },
        disconnect: function() {
            if (ws) {
                ws.close();
                ws = null;
            }
            if (monitorInterval) {
                clearInterval(monitorInterval);
                monitorInterval = null;
            }
            connected = false;
            monitoring = false;
        },
        isConnected: function() {
            return connected;
        },
        startMonitoring: function() {
            monitoring = true;
            if (mode === 'demo') {
                if (!monitorInterval) {
                    monitorInterval = setInterval(() => {
                        const reading = generateReading(currentProfile);
                        notifyListeners(reading);
                    }, 3000);
                }
            } else if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ cmd: 'start' }));
            }
        },
        stopMonitoring: function() {
            monitoring = false;
            if (monitorInterval) {
                clearInterval(monitorInterval);
                monitorInterval = null;
            }
            if (mode === 'real' && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ cmd: 'stop' }));
            }
        },
        simulateSingle: function(type) {
            const reading = generateReading(type);
            notifyListeners(reading);
            return reading;
        },
        simulateContinuous: function(type) {
            currentProfile = type;
        },
        onReading: function(callback) {
            listeners.push(callback);
            return () => {
                listeners = listeners.filter(cb => cb !== callback);
            };
        },
        getLatestReading: function() {
            return latestReading;
        }
    };
})();
