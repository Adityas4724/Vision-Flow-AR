const videoElement = document.querySelector('.input_video');
const bgCanvas = document.getElementById('bgCanvas');
const mainCanvas = document.getElementById('mainCanvas');
const bgCtx = bgCanvas.getContext('2d');
const ctx = mainCanvas.getContext('2d');

let width = window.innerWidth;
let height = window.innerHeight;

let time = 0;
let lastTime = performance.now();
let framesThisSecond = 0;
let lastFpsTime = performance.now();

let currentHands = [];
let handVelocities = 0;
let currentTheme = 'Rainbow';

const themes = {
    Rainbow: (t, index, total) => `hsl(${(t * 100 + index * (360 / total)) % 360}, 100%, 60%)`,
    Cyberpunk: (t, index) => index % 2 === 0 ? '#ff003c' : '#00f0ff',
    Lava: (t, index) => `hsl(${(10 + (index * 10)) % 40}, 100%, ${50 + Math.sin(t) * 10}%)`,
    Ocean: (t, index) => `hsl(${180 + (index * 20)}, 100%, 60%)`,
    Galaxy: (t, index) => `hsl(${260 + Math.sin(t * 2 + index) * 40}, 100%, 65%)`,
    AI: (t, index) => `hsl(${200 + Math.sin(t + index) * 40}, 80%, 60%)`
};

const FINGER_TIPS = [4, 8, 12, 16, 20];
let particles = [];
let ripples = [];
let lastPinchState = [false, false];

let audioCtx = null;
let humOsc = null;
let humGain = null;

const uiHands = document.getElementById('ui-hands');
const uiFps = document.getElementById('ui-fps');
const uiGesture = document.getElementById('ui-gesture');
const uiSpread = document.getElementById('ui-spread');
const uiAiMode = document.getElementById('ui-ai-mode');
const uiAiConfidence = document.getElementById('ui-ai-confidence');
const uiAiInsight = document.getElementById('ui-ai-insight');
const uiAiScore = document.getElementById('ui-ai-score');

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    bgCanvas.width = width;
    bgCanvas.height = height;
    mainCanvas.width = width;
    mainCanvas.height = height;
}

window.addEventListener('resize', resize);
resize();

function getDist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function mapToCanvas(point) {
    return { x: point.x * width, y: point.y * height };
}

function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        humOsc = audioCtx.createOscillator();
        humGain = audioCtx.createGain();
        humOsc.type = 'triangle';
        humOsc.frequency.value = 100;
        humGain.gain.value = 0.02;
        humOsc.connect(humGain);
        humGain.connect(audioCtx.destination);
        humOsc.start();
    } catch (error) {
        console.error('Web Audio API failed', error);
    }
}

function triggerZap() {
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
}

function updateHum(activeHands) {
    if (!audioCtx || !humGain) return;

    if (activeHands.length < 2) {
        humGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        return;
    }

    const p1 = activeHands[0][8];
    const p2 = activeHands[1][8];
    const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    const targetFreq = 100 + (1 - Math.min(dist, 1)) * 300;
    const targetVolume = 0.05 + (1 - Math.min(dist, 1)) * 0.15;

    humOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
    humGain.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.1);
}

function createParticles(pos, color, count = 3) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: pos.x,
            y: pos.y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 1,
            color,
            size: Math.random() * 3 + 1
        });
    }
}

function createShockwave(pos, color) {
    for (let i = 0; i < 20; i++) {
        particles.push({
            x: pos.x,
            y: pos.y,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15,
            life: 1,
            color,
            size: 3 + Math.random() * 4
        });
    }
}

function drawBackground() {
    bgCtx.clearRect(0, 0, width, height);

    const spacing = 40;
    for (let x = 0; x < width; x += spacing) {
        for (let y = 0; y < height; y += spacing) {
            const offset = Math.sin((x + y + time * 200) * 0.01);
            bgCtx.beginPath();
            bgCtx.arc(x, y + offset * 5, 1.5, 0, Math.PI * 2);
            bgCtx.fillStyle = themes[currentTheme](time, x, y);
            bgCtx.fill();
        }
    }
}

function updatePhysics() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= 0.02;
        particle.vy += 0.1;

        if (particle.life <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = particle.life;
        ctx.fill();
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i];
        ripple.radius += (ripple.maxRadius - ripple.radius) * 0.1;
        ripple.life -= 0.03;

        if (ripple.life <= 0) {
            ripples.splice(i, 1);
            continue;
        }

        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.strokeStyle = ripple.color;
        ctx.lineWidth = 4 * ripple.life;
        ctx.globalAlpha = ripple.life;
        ctx.stroke();
    }

    ctx.globalAlpha = 1;
}

function updateAIInsights(spreadPct = 0) {
    let mode = 'Standby';
    let insight = 'Waiting for movement data to begin analysis.';
    let confidence = 0;
    let score = 0;

    if (currentHands.length === 0) {
        mode = 'Presence Scan';
        insight = 'No hands detected. Move your hands into frame to activate AI motion analysis.';
        confidence = 24;
    } else if (currentHands.length === 1) {
        mode = spreadPct > 55 ? 'Creative Expansion' : 'Precision Control';
        insight = spreadPct > 55
            ? 'The AI coach sees an open expressive pose. Great for bigger gestures and visual flourishes.'
            : 'The AI coach sees compact control. Open your hand a bit more to amplify the effect range.';
        confidence = Math.min(94, 48 + spreadPct);
        score = Math.min(100, Math.round(spreadPct * 0.9 + handVelocities * 120));
    } else {
        const syncDistance = Math.min(getDist(currentHands[0][8], currentHands[1][8]), 1);
        const synchronicity = 100 - Math.round(syncDistance * 100);
        mode = syncDistance < 0.22 ? 'Dual-Hand Sync' : 'Energy Bridge';
        insight = syncDistance < 0.22
            ? 'Both hands are moving in sync. The AI engine reads this as coordinated intent.'
            : 'Two-hand interaction detected. Bring both hands closer to strengthen the energy bridge.';
        confidence = Math.max(58, synchronicity);
        score = Math.min(100, Math.round(synchronicity * 0.7 + Math.min(handVelocities * 180, 30)));
    }

    if (currentTheme === 'AI') {
        insight = `${insight} AI Mode is active, so the scene is emphasizing machine-vision style feedback.`;
        confidence = Math.min(99, confidence + 4);
        score = Math.min(100, score + 8);
    }

    uiAiMode.innerText = mode;
    uiAiConfidence.innerText = `${confidence}%`;
    uiAiInsight.innerText = insight;
    uiAiScore.innerText = score;

    if (window.trackAIUpdate) {
        window.trackAIUpdate({ mode, insight, confidence, score });
    }
}

function detectGestures() {
    if (!currentHands.length) {
        updateAIInsights(0);
        return;
    }

    currentHands.forEach((hand, index) => {
        const thumb = hand[4];
        const finger = hand[8];
        const pinchDistance = getDist(thumb, finger);
        const isPinching = pinchDistance < 0.05;

        if (isPinching && !lastPinchState[index]) {
            const midpoint = {
                x: (thumb.x + finger.x) / 2,
                y: (thumb.y + finger.y) / 2
            };
            createShockwave(mapToCanvas(midpoint), themes[currentTheme](time, 1, 1));
            triggerZap();
            if (window.trackPinch) window.trackPinch();
            uiGesture.innerText = 'PINCH!';
        }

        lastPinchState[index] = isPinching;
    });

    let spreadPct = 0;
    if (currentHands[0]) {
        const spread = getDist(currentHands[0][8], currentHands[0][20]);
        spreadPct = Math.min(Math.round(spread * 300), 100);
        uiSpread.innerText = `${spreadPct}%`;
        if (window.trackSpread) window.trackSpread(spreadPct);

        if (!lastPinchState.includes(true)) {
            uiGesture.innerText = spreadPct > 50 ? 'Open Hand' : 'Fist';
        }
    }

    updateAIInsights(spreadPct);
}

function renderLoop(timestamp) {
    requestAnimationFrame(renderLoop);

    const dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    time += dt;

    framesThisSecond++;
    if (timestamp > lastFpsTime + 1000) {
        uiFps.innerText = framesThisSecond;
        if (framesThisSecond < 20) uiFps.style.color = '#ff7a7a';
        else if (framesThisSecond < 40) uiFps.style.color = '#ffe16b';
        else uiFps.style.color = '#89ffba';
        framesThisSecond = 0;
        lastFpsTime = timestamp;
    }

    drawBackground();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'screen';

    updatePhysics();

    if (currentHands.length > 0) {
        currentHands.forEach((hand, handIndex) => {
            const glowColor = themes[currentTheme](time, handIndex, 2);

            drawConnectors(ctx, hand, HAND_CONNECTIONS, {
                color: glowColor,
                lineWidth: 2
            });

            ctx.shadowBlur = 15;
            ctx.shadowColor = glowColor;

            FINGER_TIPS.forEach((tipIndex, tipOrder) => {
                const point = mapToCanvas(hand[tipIndex]);
                const tipColor = themes[currentTheme](time, tipOrder, FINGER_TIPS.length);

                ctx.beginPath();
                ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();

                if (Math.random() > 0.6) createParticles(point, tipColor, 1);
            });

            ctx.shadowBlur = 0;
        });

        if (currentHands.length >= 2) {
            const leftHand = currentHands[0];
            const rightHand = currentHands[1];

            FINGER_TIPS.forEach((tipIndex, tipOrder) => {
                const leftPoint = mapToCanvas(leftHand[tipIndex]);
                const rightPoint = mapToCanvas(rightHand[tipIndex]);
                const dist = getDist(leftPoint, rightPoint);
                const color = themes[currentTheme](time, tipOrder, FINGER_TIPS.length);

                if (dist < 150 && Math.random() > 0.5) {
                    ctx.beginPath();
                    ctx.moveTo(leftPoint.x, leftPoint.y);
                    ctx.lineTo((leftPoint.x + rightPoint.x) / 2 + (Math.random() - 0.5) * 50, (leftPoint.y + rightPoint.y) / 2 + (Math.random() - 0.5) * 50);
                    ctx.lineTo(rightPoint.x, rightPoint.y);
                    ctx.strokeStyle = '#ffffff';
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = color;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.moveTo(leftPoint.x, leftPoint.y);
                ctx.lineTo(rightPoint.x, rightPoint.y);

                const gradient = ctx.createLinearGradient(leftPoint.x, leftPoint.y, rightPoint.x, rightPoint.y);
                gradient.addColorStop(0, themes[currentTheme](time, tipOrder, 5));
                gradient.addColorStop(0.5, themes[currentTheme](time, tipOrder + 1, 5));
                gradient.addColorStop(1, themes[currentTheme](time, tipOrder + 2, 5));

                ctx.strokeStyle = gradient;
                ctx.lineWidth = 4;
                ctx.shadowBlur = 10;
                ctx.shadowColor = color;
                ctx.stroke();
                ctx.shadowBlur = 0;
            });
        }

        detectGestures();
    } else {
        updateAIInsights(0);
    }

    ctx.globalCompositeOperation = 'source-over';
}

function initMediaPipe() {
    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults((results) => {
        if (!audioCtx) return;

        uiHands.innerText = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

        if (currentHands.length > 0 && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const oldPoint = currentHands[0][8];
            const newPoint = results.multiHandLandmarks[0][8];
            handVelocities = oldPoint && newPoint ? getDist(oldPoint, newPoint) : 0;
        } else {
            handVelocities = 0;
        }

        currentHands = results.multiHandLandmarks || [];
        if (currentHands.length > 0 && window.trackHandDetected) window.trackHandDetected();
        updateHum(currentHands);
    });

    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720,
        facingMode: 'user'
    });

    camera.start();
}

document.querySelectorAll('.theme-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
        document.querySelectorAll('.theme-btn').forEach((item) => item.classList.remove('active'));
        event.target.classList.add('active');
        currentTheme = event.target.getAttribute('data-theme');
        document.documentElement.style.setProperty('--accent', themes[currentTheme](0, 1, 1));
        if (window.trackThemeChange) window.trackThemeChange(currentTheme);
        updateAIInsights(parseInt(uiSpread.innerText, 10) || 0);
    });
});

document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startOverlay').classList.add('hidden');
    document.getElementById('topbar').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('themes').classList.remove('hidden');
    if (window.notifyExperienceStarted) window.notifyExperienceStarted();
    initAudio();
    initMediaPipe();
    requestAnimationFrame(renderLoop);
});
