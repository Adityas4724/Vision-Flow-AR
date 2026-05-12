(function () {
    const SESSION_URL = 'http://localhost:8080/api/session';
    const VISITOR_KEY = 'vf_visitor_id';
    const VISITS_KEY = 'vf_visit_history';

    let visitorId = localStorage.getItem(VISITOR_KEY);
    if (!visitorId) {
        visitorId = `v_${Math.random().toString(36).slice(2, 12)}_${Date.now()}`;
        localStorage.setItem(VISITOR_KEY, visitorId);
    }

    const sessionId = `s_${Math.random().toString(36).slice(2, 11)}`;
    const sessionStart = Date.now();
    let visibleStart = Date.now();
    let hiddenMs = 0;
    let blurStart = null;
    let inactiveMs = 0;

    let handsUsed = false;
    let totalHandDetections = 0;
    let maxSpread = 0;
    let pinchCount = 0;
    let experienceStarted = false;
    let themeChanges = 0;
    let lastTheme = 'Rainbow';
    let aiMode = 'Standby';
    let aiInsight = 'Waiting for movement data to begin analysis.';
    let aiConfidence = 0;
    let aiScore = 0;
    let aiUpdates = 0;

    const visitHistory = JSON.parse(localStorage.getItem(VISITS_KEY) || '[]');
    visitHistory.push({
        sessionId,
        startedAt: new Date(sessionStart).toISOString()
    });
    localStorage.setItem(VISITS_KEY, JSON.stringify(visitHistory.slice(-20)));

    const totalVisits = visitHistory.length;

    const visitorEl = document.getElementById('ui-visitor');
    const sessionTimeEl = document.getElementById('ui-session-time');
    const activeTimeEl = document.getElementById('ui-active-time');
    const totalVisitsEl = document.getElementById('ui-total-visits');
    const pinchCountEl = document.getElementById('ui-pinch-count');
    const visibilityEl = document.getElementById('ui-visibility');
    const lastThemeEl = document.getElementById('ui-last-theme');

    function formatSeconds(totalSeconds) {
        const seconds = Math.max(0, Math.round(totalSeconds));
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins === 0 ? `${secs}s` : `${mins}m ${secs}s`;
    }

    function getVisibleSeconds() {
        const runningVisibleMs = document.hidden ? 0 : Date.now() - visibleStart;
        return Math.round((hiddenMs + runningVisibleMs) / 1000);
    }

    function getActiveSeconds() {
        const runningInactiveMs = blurStart ? Date.now() - blurStart : 0;
        return Math.max(0, Math.round((Date.now() - sessionStart - inactiveMs - runningInactiveMs) / 1000));
    }

    function updateDashboard() {
        if (visitorEl) visitorEl.innerText = visitorId.slice(0, 12);
        if (sessionTimeEl) sessionTimeEl.innerText = formatSeconds((Date.now() - sessionStart) / 1000);
        if (activeTimeEl) activeTimeEl.innerText = formatSeconds(getActiveSeconds());
        if (totalVisitsEl) totalVisitsEl.innerText = totalVisits;
        if (pinchCountEl) pinchCountEl.innerText = pinchCount;
        if (visibilityEl) visibilityEl.innerText = document.hidden ? 'Hidden' : 'Visible';
        if (lastThemeEl) lastThemeEl.innerText = lastTheme;
    }

    function buildPayload(reason) {
        return JSON.stringify({
            visitorId,
            sessionId,
            pageTitle: document.title,
            userAgent: navigator.userAgent,
            durationSeconds: Math.round((Date.now() - sessionStart) / 1000),
            activeSeconds: getActiveSeconds(),
            visibleSeconds: getVisibleSeconds(),
            totalVisits,
            experienceStarted,
            handsUsed,
            totalHandDetections,
            pinchCount,
            maxSpread,
            themeChanges,
            lastTheme,
            aiMode,
            aiInsight,
            aiConfidence,
            aiScore,
            aiUpdates,
            reason,
            timestamp: new Date().toISOString()
        });
    }

    function sendBeaconSession() {
        const payload = buildPayload('unload');
        const body = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(SESSION_URL, body);
    }

    function sendFetchSession(reason) {
        fetch(SESSION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: buildPayload(reason)
        }).catch(() => {});
    }

    window.notifyExperienceStarted = function () {
        experienceStarted = true;
        updateDashboard();
        sendFetchSession('experience_started');
    };

    window.trackHandDetected = function () {
        handsUsed = true;
        totalHandDetections++;
    };

    window.trackPinch = function () {
        pinchCount++;
        updateDashboard();
    };

    window.trackSpread = function (pct) {
        if (pct > maxSpread) maxSpread = pct;
    };

    window.trackThemeChange = function (theme) {
        lastTheme = theme;
        themeChanges++;
        updateDashboard();
    };

    window.trackAIUpdate = function (payload) {
        aiMode = payload.mode;
        aiInsight = payload.insight;
        aiConfidence = payload.confidence;
        aiScore = payload.score;
        aiUpdates++;
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hiddenMs += Date.now() - visibleStart;
        } else {
            visibleStart = Date.now();
        }
        updateDashboard();
    });

    window.addEventListener('blur', () => {
        if (!blurStart) blurStart = Date.now();
        updateDashboard();
    });

    window.addEventListener('focus', () => {
        if (blurStart) {
            inactiveMs += Date.now() - blurStart;
            blurStart = null;
        }
        updateDashboard();
    });

    window.addEventListener('beforeunload', sendBeaconSession);
    window.addEventListener('pagehide', sendBeaconSession);

    setInterval(updateDashboard, 1000);
    setInterval(() => sendFetchSession('heartbeat'), 60000);

    updateDashboard();
    sendFetchSession('pageview');

    console.log('[VisionFlow Tracker] session started:', sessionId, '| visitor:', visitorId);
})();
