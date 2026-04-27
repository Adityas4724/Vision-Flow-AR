/**
 * GLOBALS & CONFIG
 */
const videoElement = document.querySelector('.input_video');
const bgCanvas     = document.getElementById('bgCanvas');
const mainCanvas   = document.getElementById('mainCanvas');
const bgCtx        = bgCanvas.getContext('2d');
const ctx          = mainCanvas.getContext('2d');

let width  = window.innerWidth;
let height = window.innerHeight;

let time             = 0;
let lastTime         = performance.now();
let framesThisSecond = 0;
let lastFpsTime      = performance.now();

let currentHands   = [];
let handVelocities = 0;

// Theme Config
let currentTheme = 'Rainbow';
const themes = {
    'Rainbow':   (t, index, total) => `hsl(${(t * 100 + index * (360 / total)) % 360}, 100%, 60%)`,
    'Cyberpunk': (t, index, total) => (index % 2 === 0) ? '#ff003c' : '#00f0ff',
    'Lava':      (t, index, total) => `hsl(${(10 + (index * 10)) % 40}, 100%, ${50 + Math.sin(t) * 10}%)`,
    'Ocean':     (t, index, total) => `hsl(${180 + (index * 20)}, 100%, 60%)`,
    'Galaxy':    (t, index, total) => `hsl(${260 + Math.sin(t * 2 + index) * 40}, 100%, 65%)`,
    'AI':        (t, index, total) => `hsl(${200 + Math.sin(t + index) * 40}, 80%, 60%)`
};

let particles = [];
let ripples   = [];
const FINGER_TIPS = [4, 8, 12, 16, 20];

let matrixColumns = [];
const fontSize  = 16;
let maxColumns  = 0;

// Audio
let audioCtx = null;
let humOsc   = null;
let humGain  = null;

// UI Elements
const uiHands   = document.getElementById('ui-hands');
const uiFps     = document.getElementById('ui-fps');
const uiGesture = document.getElementById('ui-gesture');
const uiSpread  = document.getElementById('ui-spread');

/**
 * INITIALIZATION
 */
function resize() {
    width  = window.innerWidth;
    height = window.innerHeight;

    bgCanvas.width    = width;
    bgCanvas.height   = height;
    mainCanvas.width  = width;
    mainCanvas.height = height;

    maxColumns    = Math.floor(width / fontSize);
    matrixColumns = new Array(maxColumns).fill(1).map(() => Math.random() * height / fontSize);
}
window.addEventListener('resize', resize);
resize();

// UI Theme Switcher
document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTheme = e.target.getAttribute('data-theme');
        document.documentElement.style.setProperty('--accent', themes[currentTheme](0, 1, 1));
    });
});

// Start Button
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startOverlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('themes').classList.remove('hidden');
    initAudio();
    initMediaPipe();
    requestAnimationFrame(renderLoop);
});

/**
 * AUDIO ENGINE
 */
function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        humOsc  = audioCtx.createOscillator();
        humGain = audioCtx.createGain();

        humOsc.type            = 'triangle';
        humOsc.frequency.value = 100;
        humGain.gain.value     = 0.02;

        humOsc.connect(humGain);
        humGain.connect(audioCtx.destination);
        humOsc.start();
    } catch (e) {
        console.error("Web Audio API failed", e);
    }
}

function triggerZap() {
    if (!audioCtx) return;
    const osc      = audioCtx.createOscillator();
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

    const p1   = activeHands[0][8];
    const p2   = activeHands[1][8];
    const dx   = p1.x - p2.x;
    const dy   = p1.y - p2.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const targetFreq   = 100 + (1 - Math.min(dist, 1)) * 300;
    const targetVolume = 0.05 + (1 - Math.min(dist, 1)) * 0.15;

    humOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
    humGain.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.1);
}

/**
 * MATH & GESTURE LOGIC
 */
function getDist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function mapToCanvas(point) {
    return { x: point.x * width, y: point.y * height };
}

let lastPinchState = [false, false];

function detectGestures() {
    if (!currentHands.length) return;

    currentHands.forEach((hand, idx) => {
        const thumb = hand[4];
        const index = hand[8];
        const dist  = getDist(thumb, index);

        const isPinching = dist < 0.05;

        if (isPinching && !lastPinchState[idx]) {
            const midpoint = {
                x: (thumb.x + index.x) / 2,
                y: (thumb.y + index.y) / 2
            };
            createShockwave(mapToCanvas(midpoint), themes[currentTheme](time, 1, 1));
            triggerZap();

            // --- TRACKER HOOK: pinch ---
            if (window.trackPinch) window.trackPinch();

            uiGesture.innerText = "PINCH !";
        }
        lastPinchState[idx] = isPinching;
    });

    if (currentHands[0]) {
        const spread    = getDist(currentHands[0][8], currentHands[0][20]);
        const spreadPct = Math.min(Math.round(spread * 300), 100);
        uiSpread.innerText = spreadPct + '%';

        // --- TRACKER HOOK: spread ---
        if (window.trackSpread) window.trackSpread(spreadPct);

        if (!lastPinchState.includes(true)) {
            uiGesture.innerText = spreadPct > 50 ? "Open Hand" : "Fist";
        }
    }
}

/**
 * EFFECTS & PHYSICS
 */
function createParticles(pos, color, count = 3) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x:     pos.x,
            y:     pos.y,
            vx:    (Math.random() - 0.5) * 8,
            vy:    (Math.random() - 0.5) * 8,
            life:  1.0,
            color: color,
            size:  Math.random() * 3 + 1
        });
    }
}

function createShockwave(pos, color) {
    for (let i = 0; i < 20; i++) {
        particles.push({
            x:     pos.x,
            y:     pos.y,
            vx:    (Math.random() - 0.5) * 15,
            vy:    (Math.random() - 0.5) * 15,
            life:  1,
            color: color,
            size:  3 + Math.random() * 4
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
        let p = particles[i];
        p.x    += p.vx;
        p.y    += p.vy;
        p.life -= 0.02;
        p.vy   += 0.1;

        if (p.life <= 0) {
            particles.splice(i, 1);
        } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle   = p.color;
            ctx.globalAlpha = p.life;
            ctx.fill();
        }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
        let r    = ripples[i];
        r.radius += (r.maxRadius - r.radius) * 0.1;
        r.life   -= 0.03;

        if (r.life <= 0) {
            ripples.splice(i, 1);
        } else {
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
            ctx.strokeStyle = r.color;
            ctx.lineWidth   = 4 * r.life;
            ctx.globalAlpha = r.life;
            ctx.stroke();
        }
    }

    ctx.globalAlpha = 1.0;
}

/**
 * MAIN RENDER PIPELINE
 */
function renderLoop(timestamp) {
    requestAnimationFrame(renderLoop);

    const dt = (timestamp - lastTime) / 1000;
    lastTime  = timestamp;
    time     += dt;

    // FPS Counter
    framesThisSecond++;
    if (timestamp > lastFpsTime + 1000) {
        uiFps.innerText = framesThisSecond;

        if (framesThisSecond < 20)      uiFps.style.color = 'red';
        else if (framesThisSecond < 40) uiFps.style.color = 'yellow';
        else                             uiFps.style.color = 'lime';

        framesThisSecond = 0;
        lastFpsTime      = timestamp;
    }

    drawBackground();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';

    updatePhysics();

    if (currentHands.length > 0) {

        // 1. Skeleton
        currentHands.forEach((hand, handIndex) => {
            const glowColor = themes[currentTheme](time, handIndex, 2);

            drawConnectors(ctx, hand, HAND_CONNECTIONS, {
                color:     glowColor,
                lineWidth: 2
            });

            ctx.shadowBlur  = 15;
            ctx.shadowColor = glowColor;

            FINGER_TIPS.forEach((tipIndex, idx) => {
                const pt     = mapToCanvas(hand[tipIndex]);
                const tipCol = themes[currentTheme](time, idx, FINGER_TIPS.length);

                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();

                if (Math.random() > 0.6) createParticles(pt, tipCol, 1);
            });

            ctx.shadowBlur = 0;
        });

        // 2. Cross-Hand Interactions
        if (currentHands.length >= 2) {
            const h1 = currentHands[0];
            const h2 = currentHands[1];

            FINGER_TIPS.forEach((tipIndex, idx) => {
                const pt1  = mapToCanvas(h1[tipIndex]);
                const pt2  = mapToCanvas(h2[tipIndex]);
                const dist = getDist(pt1, pt2);
                const col  = themes[currentTheme](time, idx, FINGER_TIPS.length);

                if (dist < 150 && Math.random() > 0.5) {
                    ctx.beginPath();
                    ctx.moveTo(pt1.x, pt1.y);
                    const midX = (pt1.x + pt2.x) / 2 + (Math.random() - 0.5) * 50;
                    const midY = (pt1.y + pt2.y) / 2 + (Math.random() - 0.5) * 50;
                    ctx.lineTo(midX, midY);
                    ctx.lineTo(pt2.x, pt2.y);
                    ctx.strokeStyle = '#ffffff';
                    ctx.shadowBlur  = 20;
                    ctx.shadowColor = col;
                    ctx.lineWidth   = 3;
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.moveTo(pt1.x, pt1.y);
                ctx.lineTo(pt2.x, pt2.y);

                const grad = ctx.createLinearGradient(pt1.x, pt1.y, pt2.x, pt2.y);
                grad.addColorStop(0,   themes[currentTheme](time, idx,     5));
                grad.addColorStop(0.5, themes[currentTheme](time, idx + 1, 5));
                grad.addColorStop(1,   themes[currentTheme](time, idx + 2, 5));

                ctx.strokeStyle = grad;
                ctx.lineWidth   = 4;
                ctx.shadowBlur  = 10;
                ctx.shadowColor = col;
                ctx.stroke();
                ctx.shadowBlur  = 0;
            });

            // Mandala
            if (h1 && h2) {
                const allTips = FINGER_TIPS.map(t => mapToCanvas(h1[t]))
                                           .concat(FINGER_TIPS.map(t => mapToCanvas(h2[t])));

                const cx = allTips.reduce((sum, p) => sum + p.x, 0) / 10;
                const cy = allTips.reduce((sum, p) => sum + p.y, 0) / 10;

                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(time * 0.5);

                ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const t1 = { x: allTips[i].x - cx,             y: allTips[i].y - cy };
                    const t2 = { x: allTips[(i + 3) % 10].x - cx,  y: allTips[(i + 3) % 10].y - cy };
                    ctx.moveTo(t1.x, t1.y);
                    ctx.lineTo(t2.x, t2.y);
                }
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth   = 1;
                ctx.stroke();
                ctx.restore();
            }
        }

        detectGestures();
    }

    ctx.globalCompositeOperation = 'source-over';
}

/**
 * MEDIAPIPE INITIALIZATION
 */
function initMediaPipe() {
    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands:            2,
        modelComplexity:        1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence:  0.7
    });

    hands.onResults((results) => {
        if (!audioCtx) return;

        uiHands.innerText = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

        if (currentHands.length > 0 && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const oldP = currentHands[0][8];
            const newP = results.multiHandLandmarks[0][8];
            if (oldP && newP) handVelocities = getDist(oldP, newP);
        } else {
            handVelocities = 0;
        }

        currentHands = results.multiHandLandmarks || [];

        // --- TRACKER HOOK: hand detected ---
        if (currentHands.length > 0 && window.trackHandDetected) window.trackHandDetected();

        updateHum(currentHands);
    });

    const camera = new Camera(videoElement, {
        onFrame: async () => { await hands.send({ image: videoElement }); },
        width:      1280,
        height:     720,
        facingMode: 'user'
    });

    camera.start();
}
