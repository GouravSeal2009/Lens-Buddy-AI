// Renderer with Vosk Live Transcription - Real-time & Accurate!
// Uses Vosk model vosk-model-en-us-0.22 for offline, accurate transcription

let screenshotsCount = 0;
let isAnalyzing = false;
let stealthModeActive = false;
let stealthHideTimeout = null;
let isRecording = false;
let voiceBackend = null;
let browserRecognition = null;
let browserVoiceStopRequested = false;
let chatMessagesArray = [];
let currentPartialText = '';
let lastPartialMessageDiv = null;
let currentVoiceSessionTranscripts = [];
let isDraggingChatScrollbar = false;
let isResizing = false;
let resizeStart = null;
let isDraggingWindow = false;
let dragStart = null;
let isInteractiveHover = false;
let clickThroughPreferred = true;
let pendingResize = null;
let resizeFramePending = false;
let pendingMove = null;
let moveFramePending = false;
let currentMode = 'general';
let currentAiTier = 'fast';
const MAX_ANALYSIS_CONTEXT_TOTAL = 4;
const MAX_ANALYSIS_VOICE_ITEMS = 2;
const MAX_ANALYSIS_AI_ITEMS = 2;
const MAX_VOICE_CONTEXT_CHARS = 180;
const MAX_AI_CONTEXT_CHARS = 220;

// DOM elements
const statusText = document.getElementById('status-text');
const screenshotCount = document.getElementById('screenshot-count');
const processingIndicator = document.getElementById('processing-indicator');
const resultsPanel = document.getElementById('results-panel');
const resultText = document.getElementById('result-text');
const loadingOverlay = document.getElementById('loading-overlay');
const emergencyOverlay = document.getElementById('emergency-overlay');
const chatContainer = document.getElementById('chat-container');
const chatMessagesElement = document.getElementById('chat-messages');
const chatScrollBar = document.getElementById('chat-scrollbar');
const chatScrollUpBtn = document.getElementById('chat-scroll-up');
const chatScrollDownBtn = document.getElementById('chat-scroll-down');
const chatScrollTrack = document.getElementById('chat-scroll-track');
const chatScrollThumb = document.getElementById('chat-scroll-thumb');
const voiceToggle = document.getElementById('voice-toggle');

const screenshotBtn = document.getElementById('screenshot-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const clearBtn = document.getElementById('clear-btn');
const hideBtn = document.getElementById('hide-btn');
const copyBtn = document.getElementById('copy-btn');
const closeResultsBtn = document.getElementById('close-results');
const closeAppBtn = document.getElementById('close-app-btn');
const resizeHandle = document.getElementById('resize-handle');
const topDragZone = document.getElementById('top-drag-zone');
const hideWindowBtn = document.getElementById('hide-window-btn');
const apiMilestonesElement = document.getElementById('api-milestones');
const modeButtons = {
    general: document.getElementById('mode-general'),
    interview: document.getElementById('mode-interview'),
    coding: document.getElementById('mode-coding'),
    meeting: document.getElementById('mode-meeting')
};
const tierButtons = {
    fast: document.getElementById('tier-fast'),
    deep: document.getElementById('tier-deep')
};

// New Cluely-style buttons
const suggestBtn = document.getElementById('suggest-btn');
const notesBtn = document.getElementById('notes-btn');
const insightsBtn = document.getElementById('insights-btn');

// Timer
let startTime = Date.now();
let timerInterval;

// Initialize
async function init() {
    console.log('Initializing renderer with Vosk Live Transcription...');

    if (typeof window.electronAPI !== 'undefined') {
        console.log('electronAPI is available');
    } else {
        console.error('electronAPI not available');
        showFeedback('electronAPI not available', 'error');
    }

    setupEventListeners();
    setupIpcListeners();
    setupClickThroughBehavior();
    setupDragHandle();
    setupResizeHandle();
    setupChatScrollbar();
    updateModeUI();
    await loadAiTier();
    await loadApiProviderStatus();
    updateUI();
    startTimer();
    stealthModeActive = false;

    document.body.style.visibility = 'visible';
    document.body.style.display = 'block';
    const app = document.getElementById('app');
    if (app) {
        app.style.visibility = 'visible';
        app.style.display = 'block';
    }

    console.log('Renderer initialized - Ready for live transcription!');
    showFeedback('Vosk ready - click microphone to start real-time transcription', 'success');
}

async function loadAiTier() {
    if (!window.electronAPI || !window.electronAPI.getAiTier) {
        updateTierUI();
        return;
    }

    try {
        const tier = await window.electronAPI.getAiTier();
        if (tier === 'fast' || tier === 'deep') {
            currentAiTier = tier;
        }
    } catch (error) {
        console.error('Failed to load AI tier:', error);
    }

    updateTierUI();
}

async function loadApiProviderStatus() {
    if (!window.electronAPI || !window.electronAPI.getAiProviderStatus) {
        updateApiMilestones();
        return;
    }

    try {
        const status = await window.electronAPI.getAiProviderStatus();
        updateApiMilestones(status);
    } catch (error) {
        console.error('Failed to load AI provider status:', error);
    updateApiMilestones();
  }
}

function getBrowserSpeechRecognition() {
    if (browserRecognition) return browserRecognition;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        return null;
    }

    browserRecognition = new SpeechRecognition();
    browserRecognition.continuous = true;
    browserRecognition.interimResults = true;
    browserRecognition.lang = 'en-US';
    browserRecognition.maxAlternatives = 1;

    browserRecognition.onstart = () => {
        voiceBackend = 'browser';
        isRecording = true;
        updateVoiceUI();
    };

    browserRecognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const transcript = result[0]?.transcript?.trim();
            if (!transcript) continue;

            if (result.isFinal) {
                appendVoiceTranscript(transcript);
                if (window.electronAPI?.addVoiceTranscript) {
                    window.electronAPI.addVoiceTranscript(transcript).catch((error) => {
                        console.error('Failed to add browser transcript to history:', error);
                    });
                }
            }
        }
    };

    browserRecognition.onerror = (event) => {
        console.error('Browser speech recognition error:', event.error);
        voiceBackend = null;
        isRecording = false;
        updateVoiceUI();
        showFeedback(`Speech recognition error: ${event.error}`, 'error');
    };

    browserRecognition.onend = () => {
        if (voiceBackend === 'browser' && !browserVoiceStopRequested) {
            try {
                browserRecognition.start();
                return;
            } catch (error) {
                console.error('Failed to restart browser speech recognition:', error);
            }
        }

        voiceBackend = null;
        isRecording = false;
        updateVoiceUI();
    };

    return browserRecognition;
}

async function startBrowserVoiceRecording(reason = '') {
    const recognition = getBrowserSpeechRecognition();
    if (!recognition) {
        return false;
    }

    browserVoiceStopRequested = false;

    try {
        recognition.start();
        addChatMessage('system', reason
            ? `Using browser speech recognition because local Vosk was unavailable: ${reason}`
            : 'Using browser speech recognition.');
        showFeedback('Listening with browser speech recognition...', 'success');
        return true;
    } catch (error) {
        console.error('Failed to start browser speech recognition:', error);
        return false;
    }
}

// Start Vosk voice recognition
async function startVoiceRecording() {
    if (isRecording) {
        console.log('Already recording');
        return;
    }

    try {
        currentVoiceSessionTranscripts = [];
        console.log('Starting Vosk live transcription...');

        // Call main process to start Vosk Python process
        const result = await window.electronAPI.startVoiceRecognition();

        if (result && result.error) {
            throw new Error(result.error);
        }

        voiceBackend = 'vosk';
        isRecording = true;
        updateVoiceUI();

        addChatMessage('system', 'Live transcription started - speak now!');
        showFeedback('Listening with Vosk...', 'success');

    } catch (error) {
        console.error('Failed to start Vosk:', error);
        const fallbackStarted = await startBrowserVoiceRecording(error.message);
        if (!fallbackStarted) {
            showFeedback(`Failed to start: ${error.message}`, 'error');
            voiceBackend = null;
            isRecording = false;
            updateVoiceUI();
        }
    }
}

// Stop Vosk voice recognition
async function stopVoiceRecording() {
    if (!isRecording) return;

    try {
        if (voiceBackend === 'browser') {
            browserVoiceStopRequested = true;
            if (browserRecognition) {
                browserRecognition.stop();
            }
        } else {
            console.log('Pausing Vosk transcription (model stays loaded)...');
            await window.electronAPI.stopVoiceRecognition();
        }

        isRecording = false;
        voiceBackend = null;
        updateVoiceUI();

        // Clear any partial text display
        if (lastPartialMessageDiv) {
            lastPartialMessageDiv.remove();
            lastPartialMessageDiv = null;
        }
        currentPartialText = '';

        addChatMessage('system', 'Paused - Click mic to resume');
        showFeedback('Paused (model ready)', 'info');

        await new Promise((resolve) => setTimeout(resolve, 250));
        await processVoiceSessionQuery();

    } catch (error) {
        console.error('Failed to pause Vosk:', error);
        showFeedback('Pause failed', 'error');
    }
}

// Toggle voice recognition
async function toggleVoiceRecognition() {
    if (isRecording) {
        await stopVoiceRecording();
        voiceToggle.classList.remove('active');
    } else {
        await startVoiceRecording();
        if (isRecording) {
            voiceToggle.classList.add('active');
        }
    }
}

// Update voice UI
function updateVoiceUI() {
    if (!voiceToggle) return;

    if (isRecording) {
        voiceToggle.classList.add('active', 'listening');
    } else {
        voiceToggle.classList.remove('active', 'listening');
    }
}

// Handle Vosk partial results (real-time display)
function handleVoskPartial(data) {
    // Only process if we're actively recording
    if (!isRecording) return;
    if (!data.text || data.text.trim().length === 0) return;

    currentPartialText = data.text.trim();
    console.log('Partial:', currentPartialText);

    // Update or create partial message div
    if (!lastPartialMessageDiv) {
        lastPartialMessageDiv = document.createElement('div');
        lastPartialMessageDiv.className = 'chat-message voice-message partial';

        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        lastPartialMessageDiv.innerHTML = `
            <div class="message-header">
                <span class="message-icon">🎤</span>
                <span class="message-time">${timestamp}</span>
                <span class="partial-indicator">⏱️ Live</span>
            </div>
            <div class="message-content partial-text">${currentPartialText}</div>
        `;

        chatMessagesElement.appendChild(lastPartialMessageDiv);
    } else {
        // Update existing partial message
        const contentDiv = lastPartialMessageDiv.querySelector('.message-content');
        if (contentDiv) {
            contentDiv.textContent = currentPartialText;
        }
    }

    // Auto-scroll to bottom
    chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}

// Handle Vosk final results
function handleVoskFinal(data) {
    // Only process if we're actively recording
    if (!isRecording) return;
    if (!data.text || data.text.trim().length === 0) return;

    const finalText = data.text.trim();
    console.log('Final:', finalText);

    // Remove partial message if exists
    if (lastPartialMessageDiv) {
        lastPartialMessageDiv.remove();
        lastPartialMessageDiv = null;
    }
    currentPartialText = '';

    // Add as final message
    appendVoiceTranscript(finalText);
    showFeedback('Voice captured', 'success');
}

function appendVoiceTranscript(transcript) {
    const normalized = String(transcript || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    const lastTranscript = currentVoiceSessionTranscripts[currentVoiceSessionTranscripts.length - 1];
    if (lastTranscript === normalized) {
        return;
    }

    currentVoiceSessionTranscripts.push(normalized);
    addChatMessage('voice', normalized);
}

async function processVoiceSessionQuery() {
    const transcript = currentVoiceSessionTranscripts.join(' ').replace(/\s+/g, ' ').trim();
    currentVoiceSessionTranscripts = [];

    if (!transcript || !window.electronAPI?.answerVoiceInput) {
        return;
    }

    try {
        setAnalyzing(true);
        showFeedback('Processing voice query...', 'info');

        const result = await window.electronAPI.answerVoiceInput({
            mode: currentMode,
            transcript
        });

        if (result?.success && result.answer) {
            addChatMessage('ai-response', result.answer);
            showFeedback('Voice answer ready', 'success');
        } else if (result?.error) {
            addChatMessage('system', `Voice query error: ${result.error}`);
            showFeedback('Voice query failed', 'error');
        }
    } catch (error) {
        console.error('Voice query processing failed:', error);
        showFeedback('Voice query failed', 'error');
    } finally {
        setAnalyzing(false);
    }
}

// Screenshot functions
async function takeStealthScreenshot() {
    try {
        showFeedback('Taking screenshot...', 'info');
        await window.electronAPI.takeStealthScreenshot();
    } catch (error) {
        console.error('Screenshot error:', error);
        showFeedback('Screenshot failed', 'error');
    }
}

async function analyzeScreenshots() {
    try {
        showFeedback('Capturing current page and analyzing...', 'info');
        await window.electronAPI.takeStealthScreenshot({ replaceExisting: true });
        setAnalyzing(true);

        const modeContext = [
            `ACTIVE_MODE: ${currentMode.toUpperCase()}`,
            `MODE_GUIDANCE: ${getModeGuidance(currentMode)}`,
            `AI_TIER: ${currentAiTier.toUpperCase()}`
        ].join('\n');

        const context = [modeContext, ...getAnalysisContextLines()].join('\n\n');

        await window.electronAPI.analyzeStealthWithContext(context);
    } catch (error) {
        console.error('Analysis error:', error);
        showFeedback('Analysis failed', 'error');
        setAnalyzing(false);
    }
}

function getAnalysisContextLines() {
    const selected = [];
    let voiceCount = 0;
    let aiCount = 0;

    for (let index = chatMessagesArray.length - 1; index >= 0; index -= 1) {
        const msg = chatMessagesArray[index];
        if (msg.type === 'voice') {
            if (voiceCount >= MAX_ANALYSIS_VOICE_ITEMS) continue;
            voiceCount += 1;
            selected.push(msg);
        } else if (msg.type === 'ai-response') {
            if (aiCount >= MAX_ANALYSIS_AI_ITEMS) continue;
            aiCount += 1;
            selected.push(msg);
        }

        if (selected.length >= MAX_ANALYSIS_CONTEXT_TOTAL) {
            break;
        }
    }

    return selected
        .reverse()
        .map((msg) => {
            const maxChars = msg.type === 'voice' ? MAX_VOICE_CONTEXT_CHARS : MAX_AI_CONTEXT_CHARS;
            const compactContent = String(msg.content).replace(/\s+/g, ' ').trim().slice(0, maxChars);
            return `${msg.type}: ${compactContent}`;
        });
}

async function clearStealthData() {
    try {
        await window.electronAPI.clearStealth();
        screenshotsCount = 0;
        chatMessagesArray = [];
        chatMessagesElement.innerHTML = '';
        updateUI();
        showFeedback('Cleared', 'success');
    } catch (error) {
        console.error('Clear error:', error);
        showFeedback('Clear failed', 'error');
    }
}

async function emergencyHide() {
    try {
        await window.electronAPI.emergencyHide();
        showEmergencyOverlay();
    } catch (error) {
        console.error('Emergency hide error:', error);
    }
}

async function closeApplication() {
    try {
        console.log('Closing application...');
        await window.electronAPI.closeApp();
    } catch (error) {
        console.error('Close application error:', error);
    }
}

async function toggleWindowVisibility() {
    try {
        await window.electronAPI.toggleWindowVisibility();
    } catch (error) {
        console.error('Toggle window visibility error:', error);
    }
}

function getModeGuidance(mode) {
    switch (mode) {
        case 'general':
            return 'Use the visible screen plus recent voice context to answer general productivity questions. Explain what is on screen, identify the current app/document/table if possible, answer direct questions like "what is this?" or "how do I tabulate this?", and give practical next steps or a clean table/template when useful. Listen carefully to the latest spoken request. Make the answer detailed but readable, and break lines only at complete sentence boundaries with a blank line between major points.';
        case 'interview':
            return 'Extract only the visible questions, options, and necessary context. For each visible question, identify whether the answer should be an option letter, option number, option text, or direct numerical answer, then return the answer followed by a clear explanation that shows the logic, calculation, or elimination used. Keep the explanation readable and direct, but detailed enough that the answer is easy to understand. Do not rewrite the full question text.';
        case 'coding':
            return 'Extract only the coding questions, code, errors, constraints, and required input-output details. Then answer each visible question in order without repeating the prompt text.';
        case 'meeting':
            return 'Listen carefully for both or all sides of the conversation in the recent voice context and combine that with what is visible on screen. Extract key discussion points, speaker positions, decisions, disagreements, action items, and follow-ups. When possible, separate what each side is saying. Make the answer detailed, structured, and easy to scan, with clean sentence-by-sentence line breaks and blank lines between sections.';
        default:
            return 'Use the visible screen plus recent voice context to answer general productivity questions. Explain what is on screen, identify the current app/document/table if possible, answer direct questions like "what is this?" or "how do I tabulate this?", and give practical next steps or a clean table/template when useful. Keep the answer clear, helpful, and conversational rather than MCQ-style.';
    }
}

function getModeLabel(mode) {
    const button = modeButtons[mode];
    return button ? button.textContent.trim() : mode.toUpperCase();
}

function setMode(mode) {
    currentMode = mode;
    updateModeUI();
    showFeedback(`Mode: ${getModeLabel(mode)}`, 'info');
}

function updateModeUI() {
    Object.entries(modeButtons).forEach(([mode, button]) => {
        if (!button) return;
        button.classList.toggle('active', mode === currentMode);
    });
}

async function setAiTier(tier) {
    if (tier !== 'fast' && tier !== 'deep') return;

    currentAiTier = tier;
    updateTierUI();

    if (window.electronAPI && window.electronAPI.setAiTier) {
        const result = await window.electronAPI.setAiTier(tier);
        if (result && result.error) {
            showFeedback(result.error, 'error');
            return;
        }
    }

    const tierDescription = tier === 'fast'
        ? 'single-pass answering on the Flash-first path'
        : 'verified answering on the Flash-first path';
    showFeedback(`AI Mode: ${tier.toUpperCase()}`, 'info');
    addChatMessage('system', `${tier.toUpperCase()} mode will now use ${tierDescription}.`);
}

function updateTierUI() {
    Object.entries(tierButtons).forEach(([tier, button]) => {
        if (!button) return;
        button.classList.toggle('active', tier === currentAiTier);
    });
}

function updateApiMilestones(status = { chain: [] }) {
    if (!apiMilestonesElement) return;

    const chain = Array.isArray(status.chain) ? status.chain : [];

    if (chain.length === 0) {
        apiMilestonesElement.innerHTML = '';
        return;
    }

    apiMilestonesElement.innerHTML = chain.map((item, index) => {
        const classNames = ['api-milestone'];
        if (item.active) classNames.push('active');
        if (item.isLast) classNames.push('is-last');

        const title = `${item.stepLabel}: ${item.slotName} / ${item.modelName || 'standby'}`;
        const lineClass = index === chain.length - 2 ? 'api-milestone-line is-last-segment' : 'api-milestone-line';
        const connector = index < chain.length - 1 ? `<span class="${lineClass}"></span>` : '';

        return `
            <div class="api-milestone-step" title="${title}">
                <span class="${classNames.join(' ')}"></span>
                ${connector}
            </div>
        `;
    }).join('');
}

function setupResizeHandle() {
    if (!resizeHandle || !window.electronAPI) return;

    const handleResizeMove = async (event) => {
        if (!isResizing) return;
        await window.electronAPI.updateWindowResize(event.screenX, event.screenY);
    };

    resizeHandle.addEventListener('pointerdown', async (event) => {
        if (event.button !== 0) return;

        event.preventDefault();
        event.stopPropagation();

        isResizing = true;
        resizeHandle.setPointerCapture(event.pointerId);
        await window.electronAPI.startWindowResize();
        isInteractiveHover = true;
        applyClickThroughState();
    });

    const stopResize = async (event) => {
        if (event && resizeHandle.hasPointerCapture && resizeHandle.hasPointerCapture(event.pointerId)) {
            resizeHandle.releasePointerCapture(event.pointerId);
        }

        await window.electronAPI.stopWindowResize();
        isResizing = false;
        resizeStart = null;
        pendingResize = null;
        resizeFramePending = false;
        applyClickThroughState();
    };

    window.addEventListener('pointermove', handleResizeMove);
    resizeHandle.addEventListener('pointerup', stopResize);
    resizeHandle.addEventListener('pointercancel', stopResize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
}

function setupDragHandle() {
    if (!topDragZone || !window.electronAPI) return;

    topDragZone.addEventListener('pointerdown', async (event) => {
        if (event.button !== 0) return;

        event.preventDefault();
        event.stopPropagation();

        isDraggingWindow = true;
        topDragZone.setPointerCapture(event.pointerId);
        await window.electronAPI.startWindowDrag();
        isInteractiveHover = true;
        applyClickThroughState();
    });

    const stopDrag = async (event) => {
        if (event && topDragZone.hasPointerCapture && topDragZone.hasPointerCapture(event.pointerId)) {
            topDragZone.releasePointerCapture(event.pointerId);
        }

        await window.electronAPI.stopWindowDrag();
        isDraggingWindow = false;
        dragStart = null;
        pendingMove = null;
        moveFramePending = false;
        applyClickThroughState();
    };

    topDragZone.addEventListener('pointerup', stopDrag);
    topDragZone.addEventListener('pointercancel', stopDrag);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
}

function applyClickThroughState() {
    if (!window.electronAPI || !window.electronAPI.setClickThrough) return;
    const shouldPassThrough = clickThroughPreferred
        && !isInteractiveHover
        && !isDraggingWindow
        && !isResizing;
    window.electronAPI.setClickThrough(shouldPassThrough);
}

function setupClickThroughBehavior() {
    const interactiveSelector = [
        '.top-drag-zone',
        '.hide-window-btn',
        '.mode-btn',
        '.tier-btn',
        '.close-app-btn',
        '.resize-handle',
        '.chat-scrollbar',
        '.chat-scroll-btn',
        '.chat-scroll-track',
        '.chat-scroll-thumb',
        '.action-btn',
        '.copy-btn',
        '.close-btn',
    ].join(', ');

    document.addEventListener('mousemove', (event) => {
        isInteractiveHover = Boolean(event.target.closest(interactiveSelector));
        applyClickThroughState();
    });

    document.addEventListener('mouseleave', () => {
        isInteractiveHover = false;
        applyClickThroughState();
    });

    [
        topDragZone,
        hideWindowBtn,
        resizeHandle,
        closeAppBtn,
        voiceToggle,
        screenshotBtn,
        analyzeBtn,
        suggestBtn,
        notesBtn,
        insightsBtn,
        clearBtn,
        hideBtn,
        copyBtn,
        closeResultsBtn,
        ...Object.values(tierButtons),
        ...Object.values(modeButtons)
    ].filter(Boolean).forEach((element) => {
        element.addEventListener('mouseenter', () => {
            isInteractiveHover = true;
            applyClickThroughState();
        });

        element.addEventListener('mouseleave', (event) => {
            if (event.relatedTarget && event.relatedTarget.closest(interactiveSelector)) {
                return;
            }

            isInteractiveHover = false;
            applyClickThroughState();
        });
    });

    applyClickThroughState();
}

// NEW CLUELY-STYLE FEATURES

async function getResponseSuggestions() {
    if (!window.electronAPI || !window.electronAPI.suggestResponse) {
        showFeedback('Feature not available', 'error');
        return;
    }

    try {
        showFeedback('Generating suggestions...', 'info');

        const recentMessages = chatMessagesArray
            .slice(-5)
            .map(m => `${m.type}: ${m.content}`)
            .join('\n');

        const context = recentMessages || 'Current meeting conversation';

        const result = await window.electronAPI.suggestResponse(context);

        if (result.success && result.suggestions) {
            addChatMessage('ai-response', `💡 **What should I say?**\n\n${result.suggestions}`);
            showFeedback('Suggestions generated', 'success');
        } else {
            throw new Error(result.error || 'Failed to generate suggestions');
        }
    } catch (error) {
        console.error('Error getting suggestions:', error);
        showFeedback('Failed to generate suggestions', 'error');
        addChatMessage('system', `Error: ${error.message}`);
    }
}

async function generateMeetingNotes() {
    if (!window.electronAPI || !window.electronAPI.generateMeetingNotes) {
        showFeedback('Feature not available', 'error');
        return;
    }

    try {
        showFeedback('Generating meeting notes...', 'info');
        setAnalyzing(true);

        const result = await window.electronAPI.generateMeetingNotes();

        setAnalyzing(false);

        if (result.success && result.notes) {
            addChatMessage('ai-response', `📝 **Meeting Notes**\n\n${result.notes}`);
            showFeedback('Meeting notes generated', 'success');
        } else {
            throw new Error(result.error || 'Failed to generate notes');
        }
    } catch (error) {
        console.error('Error generating notes:', error);
        setAnalyzing(false);
        showFeedback('Failed to generate notes', 'error');
        addChatMessage('system', `Error: ${error.message}`);
    }
}

async function getConversationInsights() {
    if (!window.electronAPI || !window.electronAPI.getConversationInsights) {
        showFeedback('Feature not available', 'error');
        return;
    }

    try {
        showFeedback('Analyzing conversation...', 'info');
        setAnalyzing(true);

        const result = await window.electronAPI.getConversationInsights();

        setAnalyzing(false);

        if (result.success && result.insights) {
            addChatMessage('ai-response', `📊 **Conversation Insights**\n\n${result.insights}`);
            showFeedback('Insights generated', 'success');
        } else {
            throw new Error(result.error || 'Failed to get insights');
        }
    } catch (error) {
        console.error('Error getting insights:', error);
        setAnalyzing(false);
        showFeedback('Failed to get insights', 'error');
        addChatMessage('system', `Error: ${error.message}`);
    }
}

// UI Helper functions
function setAnalyzing(analyzing) {
    isAnalyzing = analyzing;
    updateUI();
}

function updateUI() {
    if (screenshotCount) {
        screenshotCount.textContent = screenshotsCount;
    }

    if (analyzeBtn) {
        analyzeBtn.disabled = isAnalyzing;
        analyzeBtn.textContent = isAnalyzing ? 'Thinking...' : 'Ask AI';
    }

    if (processingIndicator) {
        processingIndicator.classList.toggle('hidden', !isAnalyzing);
    }
}

function showFeedback(message, type = 'info') {
    console.log(`Feedback (${type}):`, message);

    if (statusText) {
        statusText.textContent = message;
        statusText.className = `status-text ${type} show`;
        statusText.style.display = 'block';

        setTimeout(() => {
            statusText.classList.remove('show');
            setTimeout(() => {
                statusText.style.display = 'none';
            }, 300);
        }, 3000);
    }
}

function showLoadingOverlay(message = 'Analyzing screen...') {
    if (loadingOverlay) {
        // Update the loading text if custom message provided
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.innerHTML = message;
        }
        loadingOverlay.classList.remove('hidden');
    }
}

function hideLoadingOverlay() {
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        // Reset to default text
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.innerHTML = 'Analyzing screen...';
        }
    }
}

function showEmergencyOverlay() {
    if (emergencyOverlay) {
        emergencyOverlay.classList.remove('hidden');
        setTimeout(() => {
            emergencyOverlay.classList.add('hidden');
        }, 2000);
    }
}

function hideResults() {
    if (resultsPanel) {
        resultsPanel.classList.add('hidden');
    }
}

async function copyToClipboard() {
    const lastAiMessage = chatMessagesArray
        .slice()
        .reverse()
        .find(msg => msg.type === 'ai-response');

    if (!lastAiMessage) {
        showFeedback('No AI response to copy', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(lastAiMessage.content);
        showFeedback('Copied to clipboard', 'success');
    } catch (error) {
        console.error('Copy error:', error);
        showFeedback('Copy failed', 'error');
    }
}

// Chat message management
function applySentenceBreaks(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return '';

    const lines = normalized.split('\n');
    const processedLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (/^Q\d+:/i.test(trimmed)) return trimmed;
        if (/^(ANSWER|EXPLANATION|DIRECT ANSWER|SUMMARY|ACTION ITEMS|KEY POINTS|NEXT STEPS|SPEAKER|WHY)\b/i.test(trimmed)) {
            return trimmed;
        }
        if (/^[-*•]/.test(trimmed)) return trimmed;
        return trimmed.replace(/([.!?])\s+(?=[A-Z0-9])/g, '$1\n\n');
    });

    return processedLines.join('\n');
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatResponse(text) {
    const codeBlocks = [];
    const withPlaceholders = String(text || '').replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
        const placeholder = `@@CODEBLOCK_${codeBlocks.length}@@`;
        codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
        return placeholder;
    });

    let formatted = escapeHtml(applySentenceBreaks(withPlaceholders))
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

    codeBlocks.forEach((block, index) => {
        formatted = formatted.replace(`@@CODEBLOCK_${index}@@`, block);
    });

    return formatted;
}

function updateChatScrollbar() {
    if (!chatMessagesElement || !chatScrollBar || !chatScrollTrack || !chatScrollThumb) return;

    const scrollHeight = chatMessagesElement.scrollHeight;
    const clientHeight = chatMessagesElement.clientHeight;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const hasOverflow = maxScrollTop > 2;

    chatScrollBar.classList.toggle('hidden', !hasOverflow);
    if (!hasOverflow) {
        chatScrollThumb.style.height = '24px';
        chatScrollThumb.style.transform = 'translateY(0)';
        return;
    }

    const trackHeight = chatScrollTrack.clientHeight;
    const thumbHeight = Math.max(24, Math.round((clientHeight / scrollHeight) * trackHeight));
    const maxThumbOffset = Math.max(0, trackHeight - thumbHeight);
    const thumbOffset = maxScrollTop === 0
        ? 0
        : Math.round((chatMessagesElement.scrollTop / maxScrollTop) * maxThumbOffset);

    chatScrollThumb.style.height = `${thumbHeight}px`;
    chatScrollThumb.style.transform = `translateY(${thumbOffset}px)`;
}

function setupChatScrollbar() {
    if (!chatMessagesElement || !chatScrollBar || !chatScrollTrack || !chatScrollThumb) return;

    const scrollByStep = (direction) => {
        const step = Math.max(80, Math.round(chatMessagesElement.clientHeight * 0.35));
        chatMessagesElement.scrollBy({
            top: direction * step,
            behavior: 'smooth'
        });
    };

    if (chatScrollUpBtn) {
        chatScrollUpBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            scrollByStep(-1);
        });
    }

    if (chatScrollDownBtn) {
        chatScrollDownBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            scrollByStep(1);
        });
    }

    chatScrollTrack.addEventListener('click', (event) => {
        if (event.target === chatScrollThumb) return;

        const rect = chatScrollTrack.getBoundingClientRect();
        const clickRatio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
        const maxScrollTop = Math.max(0, chatMessagesElement.scrollHeight - chatMessagesElement.clientHeight);
        chatMessagesElement.scrollTo({
            top: Math.max(0, Math.min(maxScrollTop, maxScrollTop * clickRatio)),
            behavior: 'smooth'
        });
    });

    chatScrollThumb.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        isDraggingChatScrollbar = true;
        chatScrollThumb.setPointerCapture(event.pointerId);
    });

    const stopThumbDrag = (event) => {
        if (event && chatScrollThumb.hasPointerCapture && chatScrollThumb.hasPointerCapture(event.pointerId)) {
            chatScrollThumb.releasePointerCapture(event.pointerId);
        }
        isDraggingChatScrollbar = false;
    };

    chatScrollThumb.addEventListener('pointerup', stopThumbDrag);
    chatScrollThumb.addEventListener('pointercancel', stopThumbDrag);
    window.addEventListener('pointerup', stopThumbDrag);
    window.addEventListener('pointercancel', stopThumbDrag);

    window.addEventListener('pointermove', (event) => {
        if (!isDraggingChatScrollbar) return;

        const rect = chatScrollTrack.getBoundingClientRect();
        const thumbHeight = chatScrollThumb.offsetHeight;
        const maxThumbOffset = Math.max(1, rect.height - thumbHeight);
        const offset = Math.max(0, Math.min(maxThumbOffset, event.clientY - rect.top - (thumbHeight / 2)));
        const ratio = offset / maxThumbOffset;
        const maxScrollTop = Math.max(0, chatMessagesElement.scrollHeight - chatMessagesElement.clientHeight);
        chatMessagesElement.scrollTop = ratio * maxScrollTop;
    });

    chatMessagesElement.addEventListener('scroll', updateChatScrollbar);
    window.addEventListener('resize', updateChatScrollbar);
    updateChatScrollbar();
}

function addChatMessage(type, content) {
    if (!chatMessagesElement) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}-message`;

    const timestamp = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });

    let messageContent = '';

    switch (type) {
        case 'voice':
            messageContent = `<div class="message-header"><span class="message-icon">🎤</span><span class="message-time">${timestamp}</span></div><div class="message-content">${content}</div>`;
            break;

        case 'screenshot':
            messageContent = `<div class="message-header"><span class="message-icon">📸</span><span class="message-time">${timestamp}</span></div><div class="message-content">${content}</div>`;
            break;

        case 'ai-response':
            messageContent = `<div class="message-header"><span class="message-icon">🤖</span><span class="message-time">${timestamp}</span></div><div class="message-content ai-response">${formatResponse(content)}</div>`;
            break;

        case 'system':
            messageContent = `<div class="message-header"><span class="message-icon">ℹ️</span><span class="message-time">${timestamp}</span></div><div class="message-content system-message">${content}</div>`;
            break;
    }

    messageDiv.innerHTML = messageContent;
    chatMessagesElement.appendChild(messageDiv);
    requestAnimationFrame(() => {
        messageDiv.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
        updateChatScrollbar();
    });

    chatMessagesArray.push({
        type,
        content,
        timestamp: new Date()
    });

    // Update UI to enable/disable buttons based on content
    updateUI();
    updateChatScrollbar();
}

// Timer
function startTimer() {
    const timerElement = document.querySelector('.timer');
    if (!timerElement) return;

    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        timerElement.textContent = `${minutes}:${seconds}`;
    }, 1000);
}

// Event listeners
function setupEventListeners() {
    if (screenshotBtn) screenshotBtn.addEventListener('click', takeStealthScreenshot);
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeScreenshots);
    if (clearBtn) clearBtn.addEventListener('click', clearStealthData);
    if (hideBtn) hideBtn.addEventListener('click', emergencyHide);
    if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
    if (closeResultsBtn) closeResultsBtn.addEventListener('click', hideResults);
    if (voiceToggle) voiceToggle.addEventListener('click', toggleVoiceRecognition);
    if (closeAppBtn) closeAppBtn.addEventListener('click', closeApplication);
    if (hideWindowBtn) hideWindowBtn.addEventListener('click', toggleWindowVisibility);
    Object.entries(modeButtons).forEach(([mode, button]) => {
        if (button) {
            button.addEventListener('click', () => setMode(mode));
        }
    });
    Object.entries(tierButtons).forEach(([tier, button]) => {
        if (button) {
            button.addEventListener('click', () => {
                setAiTier(tier);
            });
        }
    });

    // New feature buttons
    if (suggestBtn) suggestBtn.addEventListener('click', getResponseSuggestions);
    if (notesBtn) notesBtn.addEventListener('click', generateMeetingNotes);
    if (insightsBtn) insightsBtn.addEventListener('click', getConversationInsights);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'a':
                    e.preventDefault();
                    analyzeScreenshots();
                    break;
                case 'b':
                    e.preventDefault();
                    toggleWindowVisibility();
                    break;
                case 's':
                    e.preventDefault();
                    takeStealthScreenshot();
                    break;
            }
            return;
        }

        if (e.ctrlKey && e.altKey && e.shiftKey) {
            switch (e.key.toLowerCase()) {
                case 'h':
                    e.preventDefault();
                    if (window.electronAPI) window.electronAPI.toggleStealth();
                    break;
                case 'x':
                    e.preventDefault();
                    emergencyHide();
                    break;
                case 'v':
                    e.preventDefault();
                    toggleVoiceRecognition();
                    break;
            }
        }
    });

    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('selectstart', e => e.preventDefault());
    document.addEventListener('dragstart', e => e.preventDefault());
}

// IPC listeners
function setupIpcListeners() {
    if (!window.electronAPI) {
        console.error('electronAPI not available');
        return;
    }

    window.electronAPI.onScreenshotTakenStealth((count) => {
        screenshotsCount = count;
        updateUI();
        addChatMessage('screenshot', 'Screenshot captured');
        showFeedback('Screenshot captured', 'success');
    });

    window.electronAPI.onAnalysisStart(() => {
        setAnalyzing(true);
        addChatMessage('system', 'Analyzing screenshots and context...');
    });

    window.electronAPI.onAnalysisResult((data) => {
        setAnalyzing(false);

        if (data.error) {
            addChatMessage('system', `Error: ${data.error}`);
            showFeedback('Analysis failed', 'error');
        } else {
            addChatMessage('ai-response', data.text);
            showFeedback('Analysis complete', 'success');
        }
    });

    window.electronAPI.onSetStealthMode((enabled) => {
        stealthModeActive = enabled;
        showFeedback(enabled ? 'Stealth mode ON' : 'Stealth mode OFF', 'info');
    });

    window.electronAPI.onEmergencyClear(() => {
        showEmergencyOverlay();
    });

    window.electronAPI.onError((message) => {
        showFeedback(message, 'error');
    });

    window.electronAPI.onStatusMessage((message) => {
        showFeedback(message, 'info');
    });

    window.electronAPI.onClickThroughChanged((enabled) => {
        clickThroughPreferred = enabled;
        applyClickThroughState();
    });

    window.electronAPI.onAiRoutingWarning((warning) => {
        const warningMessage = warning?.message || 'Final paid fallback is next.';
        addChatMessage('system', warningMessage);
        showFeedback(warningMessage, 'info');
    });

    window.electronAPI.onAiProviderStatus((status) => {
        updateApiMilestones(status);
    });

    // Vosk live transcription event listeners
    window.electronAPI.onVoskStatus((data) => {
        console.log('Vosk status:', data.status, '-', data.message);

        switch (data.status) {
            case 'downloading':
                showFeedback(`Preparing voice model... ${data.message}`, 'info');
                break;
            case 'extracting':
                showFeedback('Preparing voice model...', 'info');
                break;
            case 'loading':
                showFeedback('Loading voice model...', 'info');
                break;
            case 'ready':
                if (voiceBackend && voiceBackend !== 'vosk') {
                    hideLoadingOverlay();
                    break;
                }
                hideLoadingOverlay();
                showFeedback('✓ Model loaded! Click mic again to start speaking', 'success');
                // Keep button in "ready to record" state
                if (voiceToggle) {
                    voiceToggle.classList.remove('active');
                    voiceToggle.style.background = 'rgba(52, 199, 89, 0.2)';
                }
                break;
            case 'listening':
                if (voiceBackend && voiceBackend !== 'vosk') {
                    hideLoadingOverlay();
                    break;
                }
                hideLoadingOverlay();
                showFeedback('🎤 Listening... Speak now!', 'success');
                if (voiceToggle) {
                    voiceToggle.classList.add('active');
                    voiceToggle.style.background = 'rgba(255, 59, 48, 0.3)';
                }
                break;
            case 'stopped':
                if (voiceBackend && voiceBackend !== 'vosk') {
                    hideLoadingOverlay();
                    break;
                }
                hideLoadingOverlay();
                showFeedback('Stopped listening', 'info');
                if (voiceToggle) {
                    voiceToggle.classList.remove('active');
                    voiceToggle.style.background = '';
                }
                break;
        }
    });

    window.electronAPI.onVoskPartial((data) => {
        handleVoskPartial(data);
    });

    window.electronAPI.onVoskFinal((data) => {
        handleVoskFinal(data);
    });

    window.electronAPI.onVoskError(async (data) => {
        console.error('Vosk error:', data.error);
        hideLoadingOverlay();
        showFeedback(`Vosk error: ${data.error}`, 'error');
        addChatMessage('system', `Vosk error: ${data.error}`);

        const shouldFallback = voiceBackend === 'vosk' || !voiceBackend;
        if (shouldFallback) {
            const fallbackStarted = await startBrowserVoiceRecording(data.error);
            if (fallbackStarted) {
                return;
            }
        }

        if (isRecording) {
            voiceBackend = null;
            isRecording = false;
            updateVoiceUI();
            if (voiceToggle) {
                voiceToggle.classList.remove('active');
            }
        }
    });

    window.electronAPI.onVoskStopped(() => {
        console.log('Vosk stopped');
        if (voiceBackend === 'browser') {
            return;
        }
        if (isRecording) {
            isRecording = false;
            voiceBackend = null;
            updateVoiceUI();
            if (voiceToggle) {
                voiceToggle.classList.remove('active');
            }
        }
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
