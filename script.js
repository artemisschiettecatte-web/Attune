/**
 * N·Attune — Assistive Communication MVP
 * Luxury, calm, on-device signal detection
 * 
 * Features:
 * - MediaPipe Face Landmarker for facial detection
 * - Microphone input for sound detection
 * - Calm commit system (800ms stable, 4s lock)
 * - Text-to-speech
 * - LocalStorage persistence
 * - Export to JSON
 */

// ============================================
// AUDIO - Soft chime sound
// ============================================

let audioContext = null;

function playChime() {
    try {
        // Create audio context on first use (required by browsers)
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const now = audioContext.currentTime;
        
        // Create oscillator for main tone
        const osc1 = audioContext.createOscillator();
        const osc2 = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        // Soft, pleasant frequencies (C6 and E6 - major third)
        osc1.frequency.value = 1047; // C6
        osc2.frequency.value = 1319; // E6
        
        // Sine wave for soft, pure tone
        osc1.type = 'sine';
        osc2.type = 'sine';
        
        // Connect oscillators to gain
        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Envelope: quick attack, gentle decay (like iOS)
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.15, now + 0.02);  // Quick attack
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4); // Gentle decay
        
        // Play
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.5);
        osc2.stop(now + 0.5);
        
    } catch (e) {
        console.log('Chime not available:', e);
    }
}

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Commit system
    STABILITY_TIME: 800,      // ms to wait before committing
    LOCK_TIME: 4000,          // ms to lock after commit
    TTS_COOLDOWN: 4000,       // ms between TTS calls
    REPEAT_COOLDOWN: 10000,   // ms before repeating same message
    
    // Detection thresholds
    SMILE_THRESHOLD: 0.3,
    MOUTH_OPEN_THRESHOLD: 0.15,
    MOVEMENT_THRESHOLD: 0.02,
    SOUND_SPIKE_THRESHOLD: 0.4,
    
    // Head gesture
    NOD_THRESHOLD: 0.015,
    SHAKE_THRESHOLD: 0.02,
    GESTURE_FRAMES: 10,
    
    // Log
    MAX_LOG_ITEMS: 50,
    
    // LocalStorage keys
    STORAGE_PREFIX: 'nattune_'
};

// ============================================
// STATE
// ============================================

const state = {
    // Patient
    currentPatient: null,
    
    // Camera
    cameraRunning: false,
    faceLandmarker: null,
    lastVideoTime: -1,
    
    // Mic
    micRunning: false,
    audioContext: null,
    analyser: null,
    micStream: null,
    soundLevel: 0,
    
    // Detection
    smileScore: 0,
    mouthOpenScore: 0,
    movementScore: 0,
    headGesture: 'still',
    noseHistory: [],
    
    // Emotion detection
    currentEmotion: 'neutral',
    emotionScores: {
        happy: 0,
        sad: 0,
        surprised: 0,
        neutral: 0
    },
    browScore: 0,
    eyeOpenScore: 0,
    _loggedBlendshapes: false,
    _loggedFirstResult: false,
    
    // Commit system
    currentSuggestion: null,
    suggestionStartTime: null,
    isLocked: false,
    lockEndTime: null,
    lastCommitTime: 0,
    lastTTSTime: 0,
    lastTTSMessage: null,
    
    // Output
    currentOutput: '—',
    outputTime: null,
    signalTone: 'neutral',
    
    // Log
    conversationLog: [],
    
    // Settings
    soundEnabled: true
};

// ============================================
// DOM ELEMENTS
// ============================================

const DOM = {
    // Welcome modal
    welcomeModal: document.getElementById('welcomeModal'),
    patientNameInput: document.getElementById('patientNameInput'),
    inputError: document.getElementById('inputError'),
    beginSessionBtn: document.getElementById('beginSessionBtn'),
    useDemoBtn: document.getElementById('useDemoBtn'),
    newPatientForm: document.getElementById('newPatientForm'),
    continueForm: document.getElementById('continueForm'),
    existingName: document.getElementById('existingName'),
    continueAsBtn: document.getElementById('continueAsBtn'),
    switchPatientBtn: document.getElementById('switchPatientBtn'),
    
    // Main app
    mainApp: document.getElementById('mainApp'),
    sessionName: document.getElementById('sessionName'),
    changePatientBtn: document.getElementById('changePatientBtn'),
    
    // Camera
    webcam: document.getElementById('webcam'),
    outputCanvas: document.getElementById('outputCanvas'),
    cameraPlaceholder: document.getElementById('cameraPlaceholder'),
    toggleCameraBtn: document.getElementById('toggleCameraBtn'),
    cameraButtonText: document.getElementById('cameraButtonText'),
    
    // Signal bars
    smileBar: document.getElementById('smileBar'),
    mouthBar: document.getElementById('mouthBar'),
    movementBar: document.getElementById('movementBar'),
    emotionBar: document.getElementById('emotionBar'),
    headGesture: document.getElementById('headGesture'),
    emotionIndicator: document.getElementById('emotionIndicator'),
    debugValues: document.getElementById('debugValues'),
    
    // Mic
    micToggle: document.getElementById('micToggle'),
    micLevel: document.getElementById('micLevel'),
    micStatus: document.getElementById('micStatus'),
    
    // Output
    outputText: document.getElementById('outputText'),
    outputTime: document.getElementById('outputTime'),
    signalTone: document.getElementById('signalTone'),
    stabilityDot: document.getElementById('stabilityDot'),
    stabilityText: document.getElementById('stabilityText'),
    suggestionText: document.getElementById('suggestionText'),
    speakBtn: document.getElementById('speakBtn'),
    soundToggle: document.getElementById('soundToggle'),
    
    // Summary card
    totalMessages: document.getElementById('totalMessages'),
    lastCommTime: document.getElementById('lastCommTime'),
    topLabel: document.getElementById('topLabel'),
    
    // Mood buttons
    moodBtns: document.querySelectorAll('.mood-btn'),
    
    // Needs buttons
    needBtns: document.querySelectorAll('.need-btn'),
    
    // Log
    logList: document.getElementById('logList'),
    exportLogBtn: document.getElementById('exportLogBtn'),
    clearLogBtn: document.getElementById('clearLogBtn')
};

// ============================================
// INITIALIZATION
// ============================================

async function init() {
    // Check for existing patient
    const savedPatient = localStorage.getItem(CONFIG.STORAGE_PREFIX + 'currentPatient');
    
    if (savedPatient) {
        state.currentPatient = savedPatient;
        DOM.existingName.textContent = savedPatient;
        DOM.newPatientForm.classList.add('hidden');
        DOM.continueForm.classList.remove('hidden');
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize MediaPipe
    await initFaceLandmarker();
    
    // Animate modal in
    setTimeout(() => {
        DOM.welcomeModal.classList.remove('slide-up');
    }, 100);
}

function setupEventListeners() {
    // Welcome modal
    DOM.beginSessionBtn.addEventListener('click', handleBeginSession);
    DOM.useDemoBtn.addEventListener('click', () => {
        DOM.patientNameInput.value = 'Nathaniel';
        DOM.inputError.classList.remove('visible');
    });
    DOM.continueAsBtn.addEventListener('click', handleContinueSession);
    DOM.switchPatientBtn.addEventListener('click', handleSwitchPatient);
    DOM.patientNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleBeginSession();
    });
    
    // Main app
    DOM.changePatientBtn.addEventListener('click', handleChangePatient);
    DOM.toggleCameraBtn.addEventListener('click', toggleCamera);
    DOM.micToggle.addEventListener('change', toggleMic);
    DOM.soundToggle.addEventListener('change', (e) => {
        state.soundEnabled = e.target.checked;
    });
    DOM.speakBtn.addEventListener('click', () => {
        if (state.currentOutput && state.currentOutput !== '—') {
            speak(state.currentOutput);
        }
    });
    
    // Mood buttons
    DOM.moodBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mood = btn.dataset.mood;
            commitMessage(mood, 'mood');
        });
    });
    
    // Needs buttons
    DOM.needBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const need = btn.dataset.need;
            commitMessage(`Needs ${need}`, 'need');
        });
    });
    
    // Log actions
    DOM.exportLogBtn.addEventListener('click', exportLog);
    DOM.clearLogBtn.addEventListener('click', clearLog);
}

// ============================================
// PATIENT / SESSION MANAGEMENT
// ============================================

function handleBeginSession() {
    const name = DOM.patientNameInput.value.trim();
    
    if (!name) {
        DOM.patientNameInput.classList.add('shake');
        DOM.inputError.classList.add('visible');
        setTimeout(() => DOM.patientNameInput.classList.remove('shake'), 300);
        return;
    }
    
    startSession(name);
}

function handleContinueSession() {
    startSession(state.currentPatient);
}

function handleSwitchPatient() {
    DOM.newPatientForm.classList.remove('hidden');
    DOM.continueForm.classList.add('hidden');
    DOM.patientNameInput.value = '';
    DOM.patientNameInput.focus();
}

function handleChangePatient() {
    // Stop camera and mic
    if (state.cameraRunning) toggleCamera();
    if (state.micRunning) {
        DOM.micToggle.checked = false;
        toggleMic();
    }
    
    // Show modal
    DOM.mainApp.classList.add('hidden');
    DOM.welcomeModal.classList.remove('hidden');
    
    // Reset forms
    const savedPatient = localStorage.getItem(CONFIG.STORAGE_PREFIX + 'currentPatient');
    if (savedPatient) {
        state.currentPatient = savedPatient;
        DOM.existingName.textContent = savedPatient;
        DOM.newPatientForm.classList.add('hidden');
        DOM.continueForm.classList.remove('hidden');
    } else {
        DOM.newPatientForm.classList.remove('hidden');
        DOM.continueForm.classList.add('hidden');
    }
}

function startSession(patientName) {
    state.currentPatient = patientName;
    localStorage.setItem(CONFIG.STORAGE_PREFIX + 'currentPatient', patientName);
    
    // Load patient's log
    loadPatientLog();
    
    // Update UI
    DOM.sessionName.textContent = patientName;
    
    // Transition to main app
    DOM.welcomeModal.classList.add('hidden');
    DOM.mainApp.classList.remove('hidden');
    
    // Render log
    renderLog();
}

// ============================================
// MEDIAPIPE FACE LANDMARKER
// ============================================

async function initFaceLandmarker() {
    try {
        const { FaceLandmarker, FilesetResolver } = await import(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8'
        );
        
        const filesetResolver = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
        );
        
        state.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'GPU'
            },
            outputFaceBlendshapes: true,
            runningMode: 'VIDEO',
            numFaces: 1
        });
        
        console.log('FaceLandmarker initialized');
    } catch (error) {
        console.error('Failed to initialize FaceLandmarker:', error);
    }
}

// ============================================
// CAMERA
// ============================================

async function toggleCamera() {
    if (state.cameraRunning) {
        stopCamera();
    } else {
        await startCamera();
    }
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 }
        });
        
        DOM.webcam.srcObject = stream;
        await DOM.webcam.play();
        
        state.cameraRunning = true;
        DOM.cameraPlaceholder.classList.add('hidden');
        DOM.toggleCameraBtn.classList.add('active');
        DOM.cameraButtonText.textContent = 'Stop Camera';
        DOM.toggleCameraBtn.querySelector('.btn-icon').textContent = '■';
        
        // Start detection loop
        detectFace();
        
    } catch (error) {
        console.error('Camera error:', error);
        alert('Could not access camera. Please allow camera permissions.');
    }
}

function stopCamera() {
    const stream = DOM.webcam.srcObject;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    DOM.webcam.srcObject = null;
    
    state.cameraRunning = false;
    DOM.cameraPlaceholder.classList.remove('hidden');
    DOM.toggleCameraBtn.classList.remove('active');
    DOM.cameraButtonText.textContent = 'Start Camera';
    DOM.toggleCameraBtn.querySelector('.btn-icon').textContent = '▶';
    
    // Reset signals
    state.smileScore = 0;
    state.mouthOpenScore = 0;
    state.movementScore = 0;
    state.headGesture = 'still';
    updateSignalBars();
}

function detectFace() {
    if (!state.cameraRunning) {
        return;
    }
    
    if (!state.faceLandmarker) {
        console.log('Waiting for FaceLandmarker to initialize...');
        requestAnimationFrame(detectFace);
        return;
    }
    
    const video = DOM.webcam;
    
    if (video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
        state.lastVideoTime = video.currentTime;
        
        try {
            const results = state.faceLandmarker.detectForVideo(video, performance.now());
            
            // Debug: log if we got results
            if (!state._loggedFirstResult && results) {
                console.log('Got detection results:', {
                    hasLandmarks: results.faceLandmarks?.length > 0,
                    hasBlendshapes: results.faceBlendshapes?.length > 0,
                    blendshapeCount: results.faceBlendshapes?.[0]?.categories?.length || 0
                });
                state._loggedFirstResult = true;
            }
            
            processResults(results);
        } catch (error) {
            console.error('Detection error:', error);
        }
    }
    
    if (state.cameraRunning) {
        requestAnimationFrame(detectFace);
    }
}

function processResults(results) {
    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
        state.smileScore = 0;
        state.mouthOpenScore = 0;
        state.movementScore = 0;
        state.headGesture = 'still';
        state.currentEmotion = 'neutral';
        state.emotionScores = { happy: 0, sad: 0, surprised: 0, neutral: 1 };
        updateSignalBars();
        updateEmotionDisplay();
        return;
    }
    
    const landmarks = results.faceLandmarks[0];
    const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
    
    // Debug: Check if blendshapes exist
    if (blendshapes.length === 0) {
        console.warn('No blendshapes detected - using landmark-based detection');
        // Fall back to landmark-based smile detection
        detectSmileFromLandmarks(landmarks);
        return;
    }
    
    // Extract blendshape scores
    const getBlendshape = (name) => {
        const shape = blendshapes.find(b => b.categoryName === name);
        return shape ? shape.score : 0;
    };
    
    // Log all blendshapes once to see what's available
    if (!state._loggedBlendshapes) {
        console.log('=== BLENDSHAPES AVAILABLE ===');
        blendshapes.forEach(b => console.log(`  ${b.categoryName}: ${b.score.toFixed(3)}`));
        state._loggedBlendshapes = true;
    }
    
    // Smile detection (mouth corners up) - blendshapes
    const smileLeft = getBlendshape('mouthSmileLeft');
    const smileRight = getBlendshape('mouthSmileRight');
    let blendshapeSmile = (smileLeft + smileRight) / 2;
    
    // ALSO calculate from landmarks as backup
    const leftCorner = landmarks[61];
    const rightCorner = landmarks[291];
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    
    const mouthWidth = Math.abs(rightCorner.x - leftCorner.x);
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    const mouthRatio = mouthWidth / (mouthHeight + 0.001);
    const mouthCenterY = (upperLip.y + lowerLip.y) / 2;
    const avgCornerLift = ((mouthCenterY - leftCorner.y) + (mouthCenterY - rightCorner.y)) / 2;
    const landmarkSmile = Math.max(0, Math.min(1, (mouthRatio - 2.5) / 2 + avgCornerLift * 15));
    
    // Use whichever is higher (more sensitive)
    state.smileScore = Math.max(blendshapeSmile, landmarkSmile);
    
    // Log smile values every second roughly
    if (Math.random() < 0.03) {
        console.log(`SMILE: blend=${blendshapeSmile.toFixed(3)} landmark=${landmarkSmile.toFixed(3)} FINAL=${state.smileScore.toFixed(3)}`);
    }
    
    // Frown/sad detection (mouth corners down)
    const frownLeft = getBlendshape('mouthFrownLeft');
    const frownRight = getBlendshape('mouthFrownRight');
    const frownScore = (frownLeft + frownRight) / 2;
    
    // Brow detection
    const browDownLeft = getBlendshape('browDownLeft');
    const browDownRight = getBlendshape('browDownRight');
    const browInnerUp = getBlendshape('browInnerUp');
    const browOuterUpLeft = getBlendshape('browOuterUpLeft');
    const browOuterUpRight = getBlendshape('browOuterUpRight');
    state.browScore = (browInnerUp + browOuterUpLeft + browOuterUpRight) / 3;
    const browDown = (browDownLeft + browDownRight) / 2;
    
    // Eye detection
    const eyeWideLeft = getBlendshape('eyeWideLeft');
    const eyeWideRight = getBlendshape('eyeWideRight');
    state.eyeOpenScore = (eyeWideLeft + eyeWideRight) / 2;
    
    const eyeSquintLeft = getBlendshape('eyeSquintLeft');
    const eyeSquintRight = getBlendshape('eyeSquintRight');
    const eyeSquint = (eyeSquintLeft + eyeSquintRight) / 2;
    
    // Mouth open detection
    const jawOpen = getBlendshape('jawOpen');
    state.mouthOpenScore = jawOpen;
    
    // ---- EMOTION DETECTION ----
    // Calculate emotion scores (using combined smile score which includes landmarks)
    state.emotionScores.happy = Math.min(1, state.smileScore * 2);  // More sensitive
    state.emotionScores.sad = Math.min(1, frownScore * 1.5 + browDown * 0.5);
    state.emotionScores.surprised = Math.min(1, state.browScore * 0.8 + state.eyeOpenScore * 0.8 + jawOpen * 0.4);
    state.emotionScores.neutral = Math.max(0, 1 - state.emotionScores.happy - state.emotionScores.sad - state.emotionScores.surprised);
    
    // Determine dominant emotion - lower threshold
    if (state.smileScore > 0.1) {
        state.currentEmotion = 'happy';
    } else if (state.emotionScores.sad > 0.15) {
        state.currentEmotion = 'sad';
    } else if (state.emotionScores.surprised > 0.2) {
        state.currentEmotion = 'surprised';
    } else {
        state.currentEmotion = 'neutral';
    }
    
    // Head gesture detection using nose position
    const noseTip = landmarks[4]; // Nose tip landmark
    state.noseHistory.push({ x: noseTip.x, y: noseTip.y, time: Date.now() });
    
    // Keep only recent history
    const cutoff = Date.now() - 500;
    state.noseHistory = state.noseHistory.filter(p => p.time > cutoff);
    
    if (state.noseHistory.length >= CONFIG.GESTURE_FRAMES) {
        const gesture = detectHeadGesture();
        state.headGesture = gesture;
        
        // Calculate movement score
        const first = state.noseHistory[0];
        const last = state.noseHistory[state.noseHistory.length - 1];
        const dx = Math.abs(last.x - first.x);
        const dy = Math.abs(last.y - first.y);
        state.movementScore = Math.min(1, (dx + dy) * 5);
    }
    
    updateSignalBars();
    updateEmotionDisplay();
    updateSuggestion();
}

function detectHeadGesture() {
    if (state.noseHistory.length < CONFIG.GESTURE_FRAMES) return 'still';
    
    const points = state.noseHistory.slice(-CONFIG.GESTURE_FRAMES);
    
    // Calculate directional changes
    let xChanges = 0;
    let yChanges = 0;
    let lastXDir = 0;
    let lastYDir = 0;
    
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i-1].x;
        const dy = points[i].y - points[i-1].y;
        
        const xDir = dx > CONFIG.SHAKE_THRESHOLD ? 1 : dx < -CONFIG.SHAKE_THRESHOLD ? -1 : 0;
        const yDir = dy > CONFIG.NOD_THRESHOLD ? 1 : dy < -CONFIG.NOD_THRESHOLD ? -1 : 0;
        
        if (xDir !== 0 && xDir !== lastXDir && lastXDir !== 0) xChanges++;
        if (yDir !== 0 && yDir !== lastYDir && lastYDir !== 0) yChanges++;
        
        if (xDir !== 0) lastXDir = xDir;
        if (yDir !== 0) lastYDir = yDir;
    }
    
    // Determine gesture
    if (yChanges >= 2) return 'nod';
    if (xChanges >= 2) return 'shake';
    return 'still';
}

// Fallback: detect smile from face landmarks when blendshapes unavailable
function detectSmileFromLandmarks(landmarks) {
    // Key landmark indices for smile detection
    // Mouth corners: 61 (left), 291 (right)
    // Upper lip top: 13, Lower lip bottom: 14
    // Nose tip: 4
    
    const leftCorner = landmarks[61];
    const rightCorner = landmarks[291];
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    const noseTip = landmarks[4];
    
    // Calculate mouth width relative to height (smile = wider mouth)
    const mouthWidth = Math.abs(rightCorner.x - leftCorner.x);
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    const mouthRatio = mouthWidth / (mouthHeight + 0.001);
    
    // Calculate if corners are lifted (above mouth center)
    const mouthCenterY = (upperLip.y + lowerLip.y) / 2;
    const cornerLiftLeft = mouthCenterY - leftCorner.y;
    const cornerLiftRight = mouthCenterY - rightCorner.y;
    const avgCornerLift = (cornerLiftLeft + cornerLiftRight) / 2;
    
    // Normalize scores
    state.smileScore = Math.max(0, Math.min(1, (mouthRatio - 2) / 3 + avgCornerLift * 10));
    state.mouthOpenScore = Math.max(0, Math.min(1, mouthHeight * 5));
    
    // Set emotions based on landmark analysis
    state.emotionScores.happy = state.smileScore;
    state.emotionScores.sad = Math.max(0, -avgCornerLift * 10);
    state.emotionScores.surprised = state.mouthOpenScore * 0.5;
    state.emotionScores.neutral = Math.max(0, 1 - state.smileScore - state.emotionScores.sad);
    
    // Determine emotion
    if (state.smileScore > 0.2) {
        state.currentEmotion = 'happy';
    } else if (state.emotionScores.sad > 0.2) {
        state.currentEmotion = 'sad';
    } else {
        state.currentEmotion = 'neutral';
    }
    
    // Head gesture from nose position
    state.noseHistory.push({ x: noseTip.x, y: noseTip.y, time: Date.now() });
    const cutoff = Date.now() - 500;
    state.noseHistory = state.noseHistory.filter(p => p.time > cutoff);
    
    if (state.noseHistory.length >= CONFIG.GESTURE_FRAMES) {
        state.headGesture = detectHeadGesture();
        const first = state.noseHistory[0];
        const last = state.noseHistory[state.noseHistory.length - 1];
        state.movementScore = Math.min(1, (Math.abs(last.x - first.x) + Math.abs(last.y - first.y)) * 5);
    }
    
    // Log periodically
    if (Math.random() < 0.05) {
        console.log(`LANDMARK SMILE: ratio=${mouthRatio.toFixed(2)} lift=${avgCornerLift.toFixed(4)} score=${state.smileScore.toFixed(3)}`);
    }
    
    updateSignalBars();
    updateEmotionDisplay();
    updateSuggestion();
}

function updateSignalBars() {
    DOM.smileBar.style.width = `${state.smileScore * 100}%`;
    DOM.mouthBar.style.width = `${state.mouthOpenScore * 100}%`;
    DOM.movementBar.style.width = `${state.movementScore * 100}%`;
    DOM.headGesture.textContent = capitalize(state.headGesture);
    
    // Update emotion bar if it exists
    if (DOM.emotionBar) {
        const emotionValue = Math.max(
            state.emotionScores.happy,
            state.emotionScores.sad,
            state.emotionScores.surprised
        );
        DOM.emotionBar.style.width = `${emotionValue * 100}%`;
    }
}

function updateEmotionDisplay() {
    if (!DOM.emotionIndicator) return;
    
    const emotionConfig = {
        happy: { emoji: '😊', label: 'Happy', color: '#9DB88C' },
        sad: { emoji: '😢', label: 'Sad', color: '#8B9DC3' },
        surprised: { emoji: '😮', label: 'Surprised', color: '#D4A574' },
        neutral: { emoji: '😐', label: 'Neutral', color: '#C9BFB8' }
    };
    
    const config = emotionConfig[state.currentEmotion] || emotionConfig.neutral;
    
    DOM.emotionIndicator.innerHTML = `
        <span class="emotion-emoji">${config.emoji}</span>
        <span class="emotion-label">${config.label}</span>
    `;
    DOM.emotionIndicator.style.background = config.color + '20';
    
    // Update debug values - always show current scores
    if (DOM.debugValues) {
        DOM.debugValues.textContent = `Smile: ${state.smileScore.toFixed(3)} | Emotion: ${state.currentEmotion} | Happy: ${state.emotionScores.happy.toFixed(2)}`;
    }
}

// ============================================
// MICROPHONE
// ============================================

async function toggleMic() {
    if (DOM.micToggle.checked) {
        await startMic();
    } else {
        stopMic();
    }
}

async function startMic() {
    try {
        state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        
        const source = state.audioContext.createMediaStreamSource(state.micStream);
        source.connect(state.analyser);
        
        state.analyser.fftSize = 256;
        state.micRunning = true;
        DOM.micStatus.textContent = 'Listening...';
        
        monitorMic();
        
    } catch (error) {
        console.error('Mic error:', error);
        DOM.micToggle.checked = false;
        alert('Could not access microphone.');
    }
}

function stopMic() {
    if (state.micStream) {
        state.micStream.getTracks().forEach(track => track.stop());
    }
    if (state.audioContext) {
        state.audioContext.close();
    }
    
    state.micRunning = false;
    state.soundLevel = 0;
    DOM.micLevel.style.width = '0%';
    DOM.micStatus.textContent = 'Mic off';
}

function monitorMic() {
    if (!state.micRunning) return;
    
    const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    state.soundLevel = average / 255;
    
    DOM.micLevel.style.width = `${state.soundLevel * 100}%`;
    
    requestAnimationFrame(monitorMic);
}

// ============================================
// SUGGESTION ENGINE
// ============================================

function updateSuggestion() {
    const now = Date.now();
    
    // Check if locked
    if (state.isLocked && now < state.lockEndTime) {
        DOM.stabilityDot.className = 'stability-dot locked';
        DOM.stabilityText.textContent = 'Output locked';
        return;
    } else if (state.isLocked) {
        state.isLocked = false;
    }
    
    // Generate suggestion based on signals
    const suggestion = generateSuggestion();
    DOM.suggestionText.textContent = suggestion || '—';
    
    // Update signal tone
    updateSignalTone();
    
    // Check stability
    if (suggestion && suggestion !== state.currentSuggestion) {
        state.currentSuggestion = suggestion;
        state.suggestionStartTime = now;
        DOM.stabilityDot.className = 'stability-dot stabilizing';
        DOM.stabilityText.textContent = 'Stabilizing...';
    } else if (suggestion && suggestion === state.currentSuggestion) {
        const elapsed = now - state.suggestionStartTime;
        
        if (elapsed >= CONFIG.STABILITY_TIME) {
            // Commit the suggestion
            commitMessage(suggestion, 'signal');
            state.currentSuggestion = null;
            state.suggestionStartTime = null;
        } else {
            DOM.stabilityDot.className = 'stability-dot stabilizing';
            DOM.stabilityText.textContent = `Stabilizing... ${Math.round((elapsed / CONFIG.STABILITY_TIME) * 100)}%`;
        }
    } else {
        state.currentSuggestion = null;
        state.suggestionStartTime = null;
        DOM.stabilityDot.className = 'stability-dot';
        DOM.stabilityText.textContent = 'Waiting for signal...';
    }
}

function generateSuggestion() {
    const hasSound = state.soundLevel > CONFIG.SOUND_SPIKE_THRESHOLD;
    
    // Priority-based rules
    if (state.headGesture === 'nod') {
        return 'Yes';
    }
    
    if (state.headGesture === 'shake') {
        return 'No';
    }
    
    if (state.mouthOpenScore > CONFIG.MOUTH_OPEN_THRESHOLD && hasSound) {
        return 'Needs attention';
    }
    
    if (state.movementScore > 0.5 && hasSound) {
        return 'Needs a break';
    }
    
    // Emotion-based messages (very sensitive thresholds)
    if (state.smileScore > 0.08) {  // Very low threshold - any smile triggers
        return 'Feeling happy';
    }
    
    if (state.emotionScores.sad > 0.15) {
        return 'Feeling sad';
    }
    
    if (state.emotionScores.surprised > 0.2) {
        return 'Surprised';
    }
    
    return null;
}

function updateSignalTone() {
    const hasSound = state.soundLevel > CONFIG.SOUND_SPIKE_THRESHOLD;
    
    let tone = 'neutral';
    let emoji = '😐';
    let label = 'Neutral';
    
    // Emotion-based tone
    if (state.currentEmotion === 'happy' && state.emotionScores.happy > 0.3) {
        tone = 'positive';
        emoji = '😊';
        label = 'Happy';
    } else if (state.currentEmotion === 'sad' && state.emotionScores.sad > 0.3) {
        tone = 'sad';
        emoji = '😢';
        label = 'Sad';
    } else if (state.currentEmotion === 'surprised' && state.emotionScores.surprised > 0.3) {
        tone = 'surprised';
        emoji = '😮';
        label = 'Surprised';
    } else if (state.smileScore > CONFIG.SMILE_THRESHOLD) {
        tone = 'positive';
        emoji = '😊';
        label = 'Positive';
    } else if ((state.movementScore > 0.5 && hasSound) || (state.headGesture === 'shake' && hasSound)) {
        tone = 'distress';
        emoji = '⚠️';
        label = 'Needs attention';
    }
    
    state.signalTone = tone;
    DOM.signalTone.innerHTML = `
        <span class="tone-emoji">${emoji}</span>
        <span class="tone-label">${label}</span>
    `;
}

// ============================================
// COMMIT SYSTEM
// ============================================

function commitMessage(message, type = 'signal') {
    const now = Date.now();
    
    // Lock output
    state.isLocked = true;
    state.lockEndTime = now + CONFIG.LOCK_TIME;
    
    // Play soft chime
    playChime();
    
    // Haptic feedback
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // Update output with fade
    DOM.outputText.classList.add('fade');
    
    setTimeout(() => {
        state.currentOutput = message;
        state.outputTime = now;
        DOM.outputText.textContent = message;
        DOM.outputText.classList.remove('fade');
        updateOutputTime();
    }, 200);
    
    // Speak if enabled and not repeating too soon
    if (state.soundEnabled) {
        const timeSinceLastTTS = now - state.lastTTSTime;
        const isSameMessage = message === state.lastTTSMessage;
        const timeSinceRepeat = now - (state.lastTTSTime || 0);
        
        if (timeSinceLastTTS >= CONFIG.TTS_COOLDOWN && 
            (!isSameMessage || timeSinceRepeat >= CONFIG.REPEAT_COOLDOWN)) {
            speak(message);
            state.lastTTSTime = now;
            state.lastTTSMessage = message;
        }
    }
    
    // Haptic feedback
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // Add to log
    addToLog(message, type);
    
    // Update stability indicator
    DOM.stabilityDot.className = 'stability-dot locked';
    DOM.stabilityText.textContent = 'Output locked';
}

function updateOutputTime() {
    if (!state.outputTime) {
        DOM.outputTime.textContent = '';
        return;
    }
    
    const elapsed = Date.now() - state.outputTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    
    let timeText = '';
    if (seconds < 5) {
        timeText = 'Just now';
    } else if (seconds < 60) {
        timeText = `${seconds} seconds ago`;
    } else if (minutes === 1) {
        timeText = '1 minute ago';
    } else {
        timeText = `${minutes} minutes ago`;
    }
    
    DOM.outputTime.textContent = `${state.currentPatient} said ${state.currentOutput} · ${timeText}`;
}

// Update output time every second
setInterval(updateOutputTime, 1000);

// ============================================
// TEXT-TO-SPEECH
// ============================================

function speak(text) {
    if (!('speechSynthesis' in window)) return;
    
    // Cancel any current speech
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    
    // Try to use a nice voice
    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen') || v.lang.startsWith('en'));
    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }
    
    speechSynthesis.speak(utterance);
}

// ============================================
// CONVERSATION LOG
// ============================================

function loadPatientLog() {
    const key = CONFIG.STORAGE_PREFIX + 'log_' + state.currentPatient;
    const saved = localStorage.getItem(key);
    state.conversationLog = saved ? JSON.parse(saved) : [];
}

function savePatientLog() {
    const key = CONFIG.STORAGE_PREFIX + 'log_' + state.currentPatient;
    localStorage.setItem(key, JSON.stringify(state.conversationLog.slice(-CONFIG.MAX_LOG_ITEMS)));
}

function addToLog(message, type) {
    const entry = {
        id: Date.now(),
        message,
        type,
        timestamp: new Date().toISOString(),
        patient: state.currentPatient
    };
    
    state.conversationLog.unshift(entry);
    
    // Limit log size
    if (state.conversationLog.length > CONFIG.MAX_LOG_ITEMS) {
        state.conversationLog = state.conversationLog.slice(0, CONFIG.MAX_LOG_ITEMS);
    }
    
    savePatientLog();
    renderLog();
}

function renderLog() {
    if (state.conversationLog.length === 0) {
        DOM.logList.innerHTML = '<p class="log-empty">No messages yet</p>';
        updateSummary();
        return;
    }
    
    DOM.logList.innerHTML = state.conversationLog.map(entry => {
        const time = formatLogTime(new Date(entry.timestamp));
        const icon = getLogIcon(entry.type, entry.message);
        
        return `
            <div class="log-item">
                <div class="log-icon">${icon}</div>
                <div class="log-content">
                    <p class="log-message">${entry.message}</p>
                    <p class="log-meta">${entry.patient} · ${time}</p>
                </div>
            </div>
        `;
    }).join('');
    
    // Update summary after rendering log
    updateSummary();
}

function updateSummary() {
    // Get today's messages only
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todaysMessages = state.conversationLog.filter(entry => {
        const entryDate = new Date(entry.timestamp);
        return entryDate >= today;
    });
    
    // Total messages today
    const total = todaysMessages.length;
    if (DOM.totalMessages) {
        DOM.totalMessages.textContent = total;
    }
    
    // Last communication time
    if (DOM.lastCommTime) {
        if (todaysMessages.length > 0) {
            const lastTime = new Date(todaysMessages[0].timestamp);
            const now = new Date();
            const diffMins = Math.floor((now - lastTime) / 60000);
            
            if (diffMins < 1) {
                DOM.lastCommTime.textContent = 'Just now';
            } else if (diffMins < 60) {
                DOM.lastCommTime.textContent = `${diffMins}m ago`;
            } else {
                const hours = Math.floor(diffMins / 60);
                DOM.lastCommTime.textContent = `${hours}h ago`;
            }
        } else {
            DOM.lastCommTime.textContent = '—';
        }
    }
    
    // Most frequent label
    if (DOM.topLabel) {
        if (todaysMessages.length > 0) {
            const counts = {};
            todaysMessages.forEach(entry => {
                counts[entry.message] = (counts[entry.message] || 0) + 1;
            });
            
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const topMessage = sorted[0][0];
            
            // Shorten long messages
            const shortLabels = {
                'Feeling happy': '😊 Happy',
                'Feeling sad': '😢 Sad',
                'Feeling tired': '😴 Tired',
                'Feeling okay': '🙂 Okay',
                'Needs Water': '💧 Water',
                'Needs Break': '☕ Break',
                'Needs Reposition': '🔄 Repos.',
                'Needs Bathroom': '🚻 Bath.',
                'Needs Help': '🆘 Help',
                'Needs attention': '⚠️ Attn.',
                'Surprised': '😮 Surprise'
            };
            
            DOM.topLabel.textContent = shortLabels[topMessage] || topMessage;
        } else {
            DOM.topLabel.textContent = '—';
        }
    }
}

function getLogIcon(type, message) {
    if (type === 'need') {
        const needIcons = {
            'Needs Water': '💧',
            'Needs Break': '☕',
            'Needs Reposition': '🔄',
            'Needs Bathroom': '🚻',
            'Needs Help': '🆘'
        };
        return needIcons[message] || '📌';
    }
    
    if (type === 'mood') {
        const moodIcons = {
            'Feeling happy': '😊',
            'Feeling sad': '😢',
            'Feeling tired': '😴',
            'Feeling okay': '🙂'
        };
        return moodIcons[message] || '💭';
    }
    
    // Signal icons
    if (message === 'Yes') return '✓';
    if (message === 'No') return '✗';
    if (message === 'Check-in') return '😊';
    if (message === 'Feeling happy') return '😊';
    if (message === 'Feeling sad') return '😢';
    if (message === 'Surprised') return '😮';
    if (message === 'Needs attention') return '⚠️';
    if (message === 'Needs a break') return '☕';
    return '💬';
}

function formatLogTime(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    
    return date.toLocaleDateString();
}

function exportLog() {
    if (state.conversationLog.length === 0) {
        alert('No log entries to export.');
        return;
    }
    
    const data = {
        patient: state.currentPatient,
        exportedAt: new Date().toISOString(),
        entries: state.conversationLog
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `nattune-log-${state.currentPatient}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function clearLog() {
    if (!confirm('Clear all log entries for this session?')) return;
    
    state.conversationLog = [];
    savePatientLog();
    renderLog();
}

// ============================================
// UTILITIES
// ============================================

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// INITIALIZE
// ============================================

document.addEventListener('DOMContentLoaded', init);

// Load voices for TTS
if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// Update summary "last active" time every minute
setInterval(() => {
    if (state.conversationLog.length > 0) {
        updateSummary();
    }
}, 60000);
