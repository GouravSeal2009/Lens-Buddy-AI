const { app, BrowserWindow, globalShortcut, ipcMain, screen, nativeImage } = require('electron');
const { spawn } = require('child_process');

const fs = require('fs');
const os = require('os');
const path = require('path');
const screenshot = require('screenshot-desktop');

// Helper function to check if running in dev mode
function isDevelopment() {
  return !app.isPackaged;
}

// Helper function to get the correct path based on environment
function getAppPath() {
  return isDevelopment() ? __dirname : path.join(process.resourcesPath, 'app.asar');
}

function getWindowIconPath() {
  const candidatePaths = isDevelopment()
    ? [
        path.join(__dirname, '..', 'assets', 'lensbuddy.png'),
        path.join(__dirname, '..', 'icon.png')
      ]
    : [
        path.join(process.resourcesPath, 'assets', 'lensbuddy.png'),
        path.join(process.resourcesPath, 'icon.png')
      ];

  return candidatePaths.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolvePythonExecutable() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    process.env.PYTHON_EXECUTABLE,
    path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
    'py',
    'python'
  ].filter(Boolean);

  return candidates.find((candidate) => {
    if (candidate.endsWith('.exe')) {
      return fs.existsSync(candidate);
    }
    return true;
  }) || 'python';
}

// Load .env from the correct location (handles both dev and production)
// Do this after app is ready
const isDev = !app.isPackaged;
let envPath;

if (isDev) {
  envPath = path.join(__dirname, '..', '.env');
} else {
  envPath = path.join(process.resourcesPath, '.env');
}

require('dotenv').config({ path: envPath });

console.log('Loaded .env from:', envPath);
console.log('GEMINI_API_KEY_FREE:', process.env.GEMINI_API_KEY_FREE ? 'Found' : 'Missing');
console.log('GEMINI_API_KEY_PAID:', process.env.GEMINI_API_KEY_PAID ? 'Found' : 'Missing');
console.log('GEMINI_API_KEY_PAID_FALLBACK:', process.env.GEMINI_API_KEY_PAID_FALLBACK ? 'Found' : 'Missing');
console.log('GEMINI_API_KEY_PAID_FALLBACK_2:', process.env.GEMINI_API_KEY_PAID_FALLBACK_2 ? 'Found' : 'Missing');
console.log('GEMINI_API_KEY_PAID_FALLBACK_3:', process.env.GEMINI_API_KEY_PAID_FALLBACK_3 ? 'Found' : 'Missing');
console.log('GEMINI_API_KEY_PAID_FALLBACK_4:', process.env.GEMINI_API_KEY_PAID_FALLBACK_4 ? 'Found' : 'Missing');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Found' : '❌ Missing');


require('dotenv').config({ path: envPath });

const GeminiService = require('./gemini-service');

(async () => {

let mainWindow;
let screenshots = [];
let chatContext = [];
const MAX_SCREENSHOTS = 3;
const MIN_WINDOW_WIDTH = 180;
const MIN_WINDOW_HEIGHT = 80;
const WINDOW_TRACK_INTERVAL_MS = 16;
const MAX_IMAGE_WIDTH = 1280;
const JPEG_QUALITY = 80;
const MCQ_STANDARD_PROFILE = [
  'PAT 2026 style aptitude paper',
  'primary focus: mathematics and logical reasoning',
  'common patterns: number series, arithmetic, ratio, percentages, tables, patterns, coding-decoding, arrangement, analogy, grammar/verbal MCQs',
  'questions are usually short, option-based, and require exact calculation rather than descriptive explanation'
].join('; ');
const MAX_VOICE_HISTORY_CHARS = 180;

// Vosk live transcription process
let voskProcess = null;
let isVoskRunning = false;

// Initialize Gemini Service with rate limiting
let geminiService = null;

function getActiveApiSlotKey() {
  if (!geminiService || !geminiService.providerConfigs) {
    return null;
  }

  const activeProvider = geminiService.providerConfigs[geminiService.activeProviderIndex];
  const providerLabel = activeProvider ? activeProvider.label : null;

  switch (providerLabel) {
    case 'base':
      return 'base';
    case 'free':
      return process.env.GEMINI_API_KEY_FREE ? 'free' : 'base';
    case 'paid':
      return process.env.GEMINI_API_KEY_PAID ? 'paid' : 'base';
    case 'paid-fallback':
      return 'paid-fallback';
    case 'paid-fallback-2':
      return 'paid-fallback-2';
    case 'paid-fallback-3':
      return 'paid-fallback-3';
    case 'paid-fallback-4':
      return 'paid-fallback-4';
    default:
      return null;
  }
}

function buildApiSlotStatus() {
  const slotNameByProviderLabel = {
    base: 'Base',
    free: 'Free',
    paid: 'Paid',
    'paid-fallback': 'F1',
    'paid-fallback-2': 'F2',
    'paid-fallback-3': 'F3',
    'paid-fallback-4': 'F4'
  };

  const activeSlotKey = getActiveApiSlotKey();
  const liveChain = geminiService && typeof geminiService.getProviderChainStatus === 'function'
    ? geminiService.getProviderChainStatus()
    : [];

  const chain = liveChain.map((item, index) => ({
    slotKey: item.providerLabel,
    slotName: slotNameByProviderLabel[item.providerLabel] || item.providerLabel || `API ${index + 1}`,
    configured: true,
    stepLabel: `${index + 1}`,
    active: Boolean(item.active),
    isLast: index === liveChain.length - 1,
    modelName: item.modelName,
    providerLabel: item.providerLabel
  }));

  return {
    tier: geminiService ? geminiService.getPreferenceProfile() : 'fast',
    activeSlotKey,
    activeModelName: geminiService ? geminiService.modelName : null,
    chain
  };
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const contents = mainWindow.webContents;
  if (!contents || contents.isDestroyed()) {
    return false;
  }

  try {
    contents.send(channel, payload);
    return true;
  } catch (error) {
    console.warn(`Skipped renderer send for ${channel}: ${error.message}`);
    return false;
  }
}

try {
  const baseApiKey = process.env.GEMINI_API_KEY;
  const freeApiKey = process.env.GEMINI_API_KEY_FREE;
  const paidApiKey = process.env.GEMINI_API_KEY_PAID;
  const secondaryFallbackApiKey = process.env.GEMINI_API_KEY_PAID_FALLBACK;
  const tertiaryFallbackApiKey = process.env.GEMINI_API_KEY_PAID_FALLBACK_2;
  const quaternaryFallbackApiKey = process.env.GEMINI_API_KEY_PAID_FALLBACK_3;
  const quinaryFallbackApiKey = process.env.GEMINI_API_KEY_PAID_FALLBACK_4;

  if (!baseApiKey && !freeApiKey && !paidApiKey) {
    console.error('No Gemini API key found in environment variables');
  } else {
    console.log('Initializing Gemini AI Service with rate limiting...');
    geminiService = new GeminiService({
      baseApiKey,
      freeApiKey,
      paidApiKey,
      secondaryFallbackApiKey,
      tertiaryFallbackApiKey,
      quaternaryFallbackApiKey,
      quinaryFallbackApiKey,
      onRoutingWarning: (warning) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }

        const message = warning?.message || 'Final paid fallback is next.';
        mainWindow.webContents.send('status-message', message);
        mainWindow.webContents.send('ai-routing-warning', warning);
      },
      onProviderChange: (status) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }

        mainWindow.webContents.send('ai-provider-status', buildApiSlotStatus());
      }
    });
    console.log('Gemini AI Service initialized successfully');
  }
} catch (error) {
  console.error('Failed to initialize Gemini AI Service:', error);
}

function createStealthWindow() {
  console.log('Creating stealth window...');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Short and wide window dimensions (resizable)
  const windowWidth = 900;
  const windowHeight = 400;
  const x = Math.floor((width - windowWidth) / 2);
  const y = 40;

  console.log(`Window position: ${x}, ${y}, size: ${windowWidth}x${windowHeight}`);

  const windowIconPath = getWindowIconPath();

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    maxWidth: width,
    maxHeight: height,
    x: x,
    y: y,
    webPreferences: {
      nodeIntegration: false,          // Disable for security
      contextIsolation: true,          // Enable for security
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      offscreen: false,
      webSecurity: false,              // CHANGED: Disable for microphone access
      allowRunningInsecureContent: true, // CHANGED: Allow for media access
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: false                   // Keep disabled for dynamic imports
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,                  // Use only the custom resize handle to avoid drag/resize conflicts
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true,
    show: false,
    opacity: 1.0,
    type: 'toolbar',
    acceptFirstMouse: false,
    disableAutoHideCursor: true,
    enableLargerThanScreen: false,
    hasShadow: false,
    thickFrame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#00000000',
    icon: windowIconPath || undefined
  });

  console.log('BrowserWindow created');
  
  const htmlPath = path.join(__dirname, 'renderer.html');
  console.log('Loading HTML from:', htmlPath);
  mainWindow.loadFile(htmlPath);
  
  // ADDED: Set up microphone permissions
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('Permission requested:', permission);
    if (permission === 'microphone' || permission === 'media') {
      console.log('Granting microphone permission');
      callback(true);
    } else {
      console.log('Denying permission:', permission);
      callback(false);
    }
  });

  // ADDED: Set permissions policy for media access
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    console.log('Permission check:', permission, requestingOrigin);
    if (permission === 'microphone' || permission === 'media') {
      return true;
    }
    return false;
  });

  // ADDED: Override permissions for media devices
  mainWindow.webContents.session.protocol.registerFileProtocol('file', (request, callback) => {
    const pathname = decodeURI(request.url.replace('file:///', ''));
    callback(pathname);
  });
  
  // Apply stealth settings
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { 
      visibleOnFullScreen: true,
      skipTransformProcessType: true 
    });
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu', 1);
    app.dock.hide();
    mainWindow.setHiddenInMissionControl(true);
  } else if (process.platform === 'win32') {
    console.log('Applying Windows stealth settings');
    mainWindow.setSkipTaskbar(true);
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.setAppDetails({
      appId: 'SystemProcess',
      appIconPath: windowIconPath || '',
      relaunchCommand: '',
      relaunchDisplayName: ''
    });
  }
  
  mainWindow.setContentProtection(true);
  console.log('Content protection enabled for stealth');
  
  mainWindow.setIgnoreMouseEvents(false);
  
  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM is ready');
  });

  mainWindow.webContents.on('before-input-event', async (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.alt &&
      !input.control &&
      !input.shift &&
      !input.meta
    ) {
      const handled = await runAltShortcut(input.key);
      if (handled) {
        event.preventDefault();
      }
    }
  });
  
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('HTML finished loading');
    
    mainWindow.webContents.executeJavaScript(`
      console.log('Content check...');
      console.log('Document title:', document.title);
      console.log('Body exists:', !!document.body);
      console.log('App element exists:', !!document.getElementById('app'));
      console.log('Glass container exists:', !!document.querySelector('.glass-container'));
      
      document.body.style.background = 'transparent';
      
      if (document.body) {
        document.body.style.visibility = 'visible';
        document.body.style.display = 'block';
        console.log('Body made visible');
      }
      
      const app = document.getElementById('app');
      if (app) {
        app.style.visibility = 'visible';
        app.style.display = 'block';
        console.log('App container made visible');
      }
      
      'Content visibility check complete';
    `).then((result) => {
      console.log('JavaScript result:', result);
      mainWindow.show();
      mainWindow.focus();
      setWindowClickThrough(manualClickThrough);
      mainWindow.webContents.send('click-through-changed', manualClickThrough);
      geminiService?.startBackgroundWarmup();
      console.log('Window shown with transparent background');
    }).catch((error) => {
      console.log('JavaScript execution failed:', error);
      mainWindow.show();
      setWindowClickThrough(manualClickThrough);
      mainWindow.webContents.send('click-through-changed', manualClickThrough);
      geminiService?.startBackgroundWarmup();
    });
  });
  
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
  
  // Handle console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`Renderer console.${level}: ${message}`);
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

function registerStealthShortcuts() {
  globalShortcut.register('Alt+B', () => {
    runAltShortcut('b');
  });

  globalShortcut.register('Alt+C', () => {
    runAltShortcut('c');
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+H', () => {
    toggleStealthMode();
  });

  globalShortcut.register('Alt+S', async () => {
    await runAltShortcut('s');
  });

  globalShortcut.register('Alt+A', async () => {
    await runAltShortcut('a');
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+X', () => {
    emergencyHide();
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+V', () => {
    mainWindow.webContents.send('toggle-voice-recognition');
  });

  globalShortcut.register('CommandOrControl+Alt+Shift+Left', () => {
    moveToPosition('left');
  });
  
  globalShortcut.register('CommandOrControl+Alt+Shift+Right', () => {
    moveToPosition('right');
  });
  
  globalShortcut.register('CommandOrControl+Alt+Shift+Up', () => {
    moveToPosition('top');
  });
  
  globalShortcut.register('CommandOrControl+Alt+Shift+Down', () => {
    moveToPosition('bottom');
  });
}

let isVisible = true;
let autoHideTimer = null;
let clickThroughEnabled = false;
let manualClickThrough = true;
let dragTracking = null;
let dragTrackingInterval = null;
let resizeTracking = null;
let resizeTrackingInterval = null;
let lastShortcutTrigger = { accelerator: '', timestamp: 0 };

function triggerShortcutOnce(accelerator, handler) {
  const now = Date.now();
  if (
    lastShortcutTrigger.accelerator === accelerator &&
    now - lastShortcutTrigger.timestamp < 300
  ) {
    return;
  }

  lastShortcutTrigger = { accelerator, timestamp: now };
  handler();
}

async function runAltShortcut(key) {
  const normalizedKey = String(key || '').toLowerCase();

  switch (normalizedKey) {
    case 'a':
      triggerShortcutOnce('Alt+A', async () => {
        await takeStealthScreenshot({ replaceExisting: true });
        await analyzeForMeeting();
      });
      return true;
    case 'b':
      triggerShortcutOnce('Alt+B', () => {
        toggleWindowVisibility();
      });
      return true;
    case 'c':
      triggerShortcutOnce('Alt+C', () => {
        toggleClickThroughMode();
      });
      return true;
    case 's':
      triggerShortcutOnce('Alt+S', async () => {
        await takeStealthScreenshot();
      });
      return true;
    default:
      return false;
  }
}

function setWindowClickThrough(enabled) {
  if (!mainWindow || mainWindow.isDestroyed() || clickThroughEnabled === enabled) {
    return;
  }

  clickThroughEnabled = enabled;

  if (process.platform === 'win32') {
    mainWindow.setIgnoreMouseEvents(enabled, { forward: enabled });
  } else {
    mainWindow.setIgnoreMouseEvents(enabled);
  }
}

function toggleClickThroughMode() {
  manualClickThrough = !manualClickThrough;
  setWindowClickThrough(manualClickThrough);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('click-through-changed', manualClickThrough);
    mainWindow.webContents.send('status-message', manualClickThrough ? 'Click-through ON' : 'Click-through OFF');
  }
}

function toggleWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  setWindowClickThrough(manualClickThrough);
}

function toggleStealthMode() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  if (isVisible) {
    mainWindow.setOpacity(0.6);
    mainWindow.webContents.send('set-stealth-mode', true);
    isVisible = false;
  } else {
    mainWindow.setOpacity(1.0);
    mainWindow.webContents.send('set-stealth-mode', false);
    isVisible = true;
  }
}

function emergencyHide() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  mainWindow.setOpacity(0.01);
  mainWindow.webContents.send('emergency-clear');
  
  autoHideTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setOpacity(1.0);
      isVisible = true;
    }
    autoHideTimer = null;
  }, 2000);
}

function moveToPosition(position) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowBounds = mainWindow.getBounds();
  
  let x, y;
  
  switch (position) {
    case 'left':
      x = 20;
      y = windowBounds.y;
      break;
    case 'right':
      x = width - windowBounds.width - 20;
      y = windowBounds.y;
      break;
    case 'top':
      x = Math.floor((width - windowBounds.width) / 2);
      y = 40;
      break;
    case 'bottom':
      x = Math.floor((width - windowBounds.width) / 2);
      y = height - windowBounds.height - 40;
      break;
    default:
      return;
  }
  
  mainWindow.setPosition(x, y);
}

function stopWindowDragTracking() {
  if (dragTrackingInterval) {
    clearInterval(dragTrackingInterval);
    dragTrackingInterval = null;
  }

  dragTracking = null;
}

function stopWindowResizeTracking() {
  resizeTracking = null;
}

function startWindowDragTracking() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false };
  }

  stopWindowResizeTracking();
  stopWindowDragTracking();

  dragTracking = {
    startCursor: screen.getCursorScreenPoint(),
    startBounds: mainWindow.getBounds()
  };

  dragTrackingInterval = setInterval(() => {
    if (!dragTracking || !mainWindow || mainWindow.isDestroyed()) {
      stopWindowDragTracking();
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const deltaX = cursor.x - dragTracking.startCursor.x;
    const deltaY = cursor.y - dragTracking.startCursor.y;
    mainWindow.setPosition(
      Math.round(dragTracking.startBounds.x + deltaX),
      Math.round(dragTracking.startBounds.y + deltaY)
    );
  }, WINDOW_TRACK_INTERVAL_MS);

  return { success: true };
}

function startWindowResizeTracking() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false };
  }

  stopWindowDragTracking();
  stopWindowResizeTracking();

  resizeTracking = {
    startCursor: screen.getCursorScreenPoint(),
    startBounds: mainWindow.getBounds()
  };

  return { success: true };
}

function updateWindowResizeTracking(cursorX, cursorY) {
  if (!resizeTracking || !mainWindow || mainWindow.isDestroyed()) {
    return { success: false };
  }

  const hasExplicitCursor = Number.isFinite(cursorX) && Number.isFinite(cursorY);
  const cursor = hasExplicitCursor
    ? { x: cursorX, y: cursorY }
    : screen.getCursorScreenPoint();

  const deltaX = cursor.x - resizeTracking.startCursor.x;
  const deltaY = cursor.y - resizeTracking.startCursor.y;
  const nextWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(resizeTracking.startBounds.width + deltaX));
  const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(resizeTracking.startBounds.height + deltaY));

  mainWindow.setBounds({
    x: resizeTracking.startBounds.x,
    y: resizeTracking.startBounds.y,
    width: nextWidth,
    height: nextHeight
  });

  return { success: true, width: nextWidth, height: nextHeight };
}

function detectActiveMode(context = '') {
  const match = context.match(/ACTIVE_MODE:\s*([A-Z]+)/i);
  return match ? match[1].toUpperCase() : 'GENERAL';
}

function detectAiTier(context = '') {
  const match = context.match(/AI_TIER:\s*([A-Z]+)/i);
  const tier = match ? match[1].toUpperCase() : 'FAST';
  return tier === 'DEEP' ? 'DEEP' : 'FAST';
}

function addVoiceTranscriptToHistory(transcript) {
  if (!geminiService || !transcript) {
    return;
  }

  const normalized = String(transcript).replace(/\s+/g, ' ').trim().slice(0, MAX_VOICE_HISTORY_CHARS);
  if (!normalized) {
    return;
  }

  const history = Array.isArray(geminiService.conversationHistory)
    ? geminiService.conversationHistory
    : [];
  const lastEntry = history[history.length - 1];
  const taggedTranscript = `[voice] ${normalized}`;

  if (lastEntry && lastEntry.role === 'user' && lastEntry.content === taggedTranscript) {
    return;
  }

  geminiService.addToHistory('user', taggedTranscript);
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.map(item => String(item).trim()).filter(Boolean) : [];
  } catch (error) {
    console.error('Failed to parse JSON array:', error.message);
    return [];
  }
}

function buildImagePartFromPath(imagePath) {
  const image = nativeImage.createFromPath(imagePath);

  if (image.isEmpty()) {
    throw new Error(`Failed to load screenshot: ${imagePath}`);
  }

  const size = image.getSize();
  const shouldResize = size.width > MAX_IMAGE_WIDTH;
  const processedImage = shouldResize
    ? image.resize({ width: MAX_IMAGE_WIDTH, quality: 'good' })
    : image;
  const processedSize = processedImage.getSize();
  const imageBuffer = processedImage.toJPEG(JPEG_QUALITY);

  console.log(
    `Prepared screenshot ${path.basename(imagePath)}: ${size.width}x${size.height} -> ${processedSize.width}x${processedSize.height}, ${imageBuffer.length} bytes`
  );

  return {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType: 'image/jpeg'
    }
  };
}

function getScreenshotPathsForAnalysis(activeMode) {
  return screenshots.slice(-MAX_SCREENSHOTS);
}

async function solveGeneralProductivityFast(imageParts, contextPrompt, geminiService) {
  const prompt = `You are a helpful general productivity assistant using the current screenshots and recent voice/context.

Task:
1. Understand what is visible on screen before answering.
2. If the user asked a direct question in the context, answer it directly using the visible screen content and the latest spoken question if one exists.
3. Be good at questions like:
   - what is this?
   - what is happening on this screen?
   - how do I tabulate this?
   - how should I organize this information?
   - what should I do next?
4. If the screen shows data, convert it into a simple table, bullet structure, or step-by-step plan when helpful.
5. If the screen shows a tool, document, form, dashboard, or spreadsheet, explain it in clear practical language.
6. If important information is missing or cropped, say exactly what is unclear instead of guessing.
7. Do not force MCQ formatting.
8. Keep the answer direct, useful, and easy to act on.
9. Write in complete sentences.
10. Break to a new line only after a full sentence or finished thought.
11. Leave a blank line between major points, steps, or sections.

Preferred response shape:
- Direct answer first
- Then short steps, table, or summary if useful

${contextPrompt}`.trim();

  console.log('Running fast general-productivity pass...');
  return geminiService.generateMultimodal([prompt, ...imageParts]);
}

async function solveGeneralProductivityWithVerification(imageParts, contextPrompt, geminiService) {
  const solvePrompt = `You are a helpful general productivity assistant using the current screenshots and recent voice/context.

Task:
1. Understand what is visible on screen before answering.
2. If the user asked a direct question in the context, answer it directly using the visible screen content and the latest spoken question if one exists.
3. Be good at questions like:
   - what is this?
   - what is happening on this screen?
   - how do I tabulate this?
   - how should I organize this information?
   - what should I do next?
4. If the screen shows data, convert it into a simple table, bullet structure, or step-by-step plan when helpful.
5. If the screen shows a tool, document, form, dashboard, or spreadsheet, explain it in clear practical language.
6. If important information is missing or cropped, say exactly what is unclear instead of guessing.
7. Keep the answer clear, practical, and reasonably concise.
8. Write in complete sentences.
9. Break to a new line only after a full sentence or finished thought.
10. Leave a blank line between major points, steps, or sections.

${contextPrompt}`.trim();

  console.log('Running deep general-productivity solve pass...');
  const firstDraft = await geminiService.generateMultimodal([solvePrompt, ...imageParts]);

  const verifyPrompt = `You are verifying and improving a general productivity answer based on screenshots and user context.

Rules:
1. Re-check that the answer matches what is actually visible on screen.
2. If the user asked a direct question, answer it directly in the first line.
3. If a table, checklist, or structured summary would help, include it.
4. Remove vague statements and replace them with practical guidance.
5. If something is not visible enough to confirm, say so clearly instead of guessing.
6. Keep the answer clear and useful, not verbose.
7. Preserve clean sentence-based line breaks with a blank line between major sections.

First draft:
${firstDraft}

Return the corrected final answer.`.trim();

  console.log('Running deep general-productivity verification pass...');
  return geminiService.generateMultimodal([verifyPrompt, ...imageParts]);
}

async function solveMcqQuestionsFast(imageParts, contextPrompt, geminiService) {
  const prompt = `You are solving visible MCQ questions from screenshots.

Task:
1. Identify every fully or partially visible question in top-to-bottom order.
2. Treat each question independently so nearby questions do not get mixed together.
3. Assume the standard paper format is numbered MCQs with A/B/C/D options.
4. Treat the paper as this standard unless the screenshot clearly contradicts it: ${MCQ_STANDARD_PROFILE}
5. Extract only the text and options necessary to answer each question.
6. Prioritize a correct final answer, but use a single-pass response.
7. For mathematics and logical reasoning, calculate explicitly before choosing an option.
8. If a visible worked solution exists on screen, trust it over guessing.
9. If a question is cropped or unclear, output exactly: the question is not visible fully
10. Do NOT restate the question text.
11. Do NOT include reasoning.

Return only answers in this format:
Q1: A
Q2: the question is not visible fully
Q3: C

${contextPrompt}`.trim();

  console.log('Running fast MCQ solve pass...');
  return geminiService.generateMultimodal([prompt, ...imageParts]);
}

async function solveMcqQuestionsWithVerification(imageParts, contextPrompt, geminiService) {
  const solvePrompt = `You are solving visible MCQ questions from screenshots.

Task:
1. Identify every fully or partially visible question in top-to-bottom order.
2. Treat each question independently so nearby questions do not get mixed together.
3. Assume the standard paper format is numbered MCQs with A/B/C/D options.
4. Treat the paper as this standard unless the screenshot clearly contradicts it: ${MCQ_STANDARD_PROFILE}
5. Extract only the text and options necessary to answer each question.
6. Prioritize logical reasoning and mathematics accuracy over speed.
7. For mathematics and logical reasoning, calculate explicitly before choosing an option.
8. If a visible worked solution exists on screen, trust it over guessing.
9. If a question is cropped or unclear, output exactly: the question is not visible fully
10. Do NOT restate the question text.
11. Do NOT include reasoning.

Return only answers in this format:
Q1: A
Q2: the question is not visible fully
Q3: C

${contextPrompt}`.trim();

  console.log('Running batched MCQ solve pass...');
  const firstDraft = await geminiService.generateMultimodal([solvePrompt, ...imageParts]);

  const verifyPrompt = `You are verifying MCQ answers from screenshots.

Re-check every visible question carefully.

Rules:
1. Keep questions separated and in top-to-bottom order.
2. Assume this aptitude-paper standard unless the screenshot clearly contradicts it: ${MCQ_STANDARD_PROFILE}
3. Recalculate math and logical reasoning exactly.
4. Prefer any visible on-screen worked solution or explanation if present.
5. Do NOT repeat the question text.
6. Do NOT add reasoning.
7. If a question is not fully visible, output exactly: the question is not visible fully

First draft:
${firstDraft}

Return only the corrected final answers in this format:
Q1: A
Q2: the question is not visible fully
Q3: C`.trim();

  console.log('Running batched MCQ verification pass...');
  return geminiService.generateMultimodal([verifyPrompt, ...imageParts]);
}

async function solveExplainedQuestionsFast(imageParts, contextPrompt, geminiService) {
  const prompt = `You are solving visible questions from screenshots in Explain mode.

Task:
1. Identify every visible question in top-to-bottom order.
2. Treat each question independently so nearby questions do not get mixed together.
3. Detect the answer style from what is shown:
   - option letter (A/B/C/D)
   - option number (1/2/3/4 or similar)
   - numeric answer
   - short answer text if there are no visible options
4. Choose the correct answer carefully.
5. Explain clearly why that answer is correct.
6. Show the key logic, arithmetic, comparison, or option elimination that leads to the answer.
7. Make the explanation understandable and direct.
8. Do NOT rewrite the full question text.
9. If a question is cropped or unclear, output exactly: the question is not visible fully

Return only answers in this format:
Q1: ANSWER: 3
EXPLANATION: [clear explanation with the key logic or calculation]

Q2: ANSWER: 42
EXPLANATION: [clear explanation with the key logic or calculation]

${contextPrompt}`.trim();

  console.log('Running fast explained-question solve pass...');
  return geminiService.generateMultimodal([prompt, ...imageParts]);
}

async function solveExplainedQuestionsWithVerification(imageParts, contextPrompt, geminiService) {
  const solvePrompt = `You are solving visible questions from screenshots in Explain mode.

Task:
1. Identify every visible question in top-to-bottom order.
2. Treat each question independently so nearby questions do not get mixed together.
3. Detect the answer style from what is shown:
   - option letter (A/B/C/D)
   - option number (1/2/3/4 or similar)
   - numeric answer
   - short answer text if there are no visible options
  4. Choose the correct answer carefully.
  5. Then explain clearly why that answer is correct.
  6. Show the actual logic, arithmetic, comparison, or option elimination that leads to the answer.
  7. Make the explanation understandable to a student reading it for the first time.
  8. Keep the explanation concise, but not vague.
  9. Do NOT rewrite the full question text.
  10. If a question is cropped or unclear, output exactly: the question is not visible fully

Return only answers in this format:
Q1: ANSWER: 3
EXPLANATION: [clear explanation with the key logic or calculation]

Q2: ANSWER: 42
EXPLANATION: [clear explanation with the key logic or calculation]

${contextPrompt}`.trim();

  console.log('Running explained-question solve pass...');
  const firstDraft = await geminiService.generateMultimodal([solvePrompt, ...imageParts]);

  const verifyPrompt = `You are verifying explained answers from screenshots.

Re-check every visible question carefully.

Rules:
1. Keep questions separated and in top-to-bottom order.
2. Preserve the correct answer type:
   - option letter
   - option number
   - numeric answer
   - short answer text
  3. Verify arithmetic, logic, and option matching exactly.
  4. Make each explanation clear enough that the reasoning can be followed easily.
  5. Mention the decisive step, comparison, calculation, or elimination that proves the answer.
  6. Do NOT repeat the question text.
  7. If a question is not fully visible, output exactly: the question is not visible fully

First draft:
${firstDraft}

Return only the corrected final answers in this format:
Q1: ANSWER: 3
EXPLANATION: [clear explanation with the key logic or calculation]

Q2: ANSWER: 42
EXPLANATION: [clear explanation with the key logic or calculation]`.trim();

  console.log('Running explained-question verification pass...');
  return geminiService.generateMultimodal([verifyPrompt, ...imageParts]);
}

async function takeStealthScreenshot(options = {}) {
  try {
    const replaceExisting = Boolean(options.replaceExisting);
    console.log('Taking stealth screenshot...');
    const currentOpacity = mainWindow.getOpacity();
    
    mainWindow.setOpacity(0.01);
    
    await new Promise(resolve => setTimeout(resolve, 200));

    // Use app data directory for screenshots in production
    const screenshotsDir = isDevelopment()
      ? path.join(__dirname, '..', '.stealth_screenshots')
      : path.join(app.getPath('userData'), '.stealth_screenshots');

    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    
    const screenshotPath = path.join(screenshotsDir, `stealth-${Date.now()}.png`);
    await screenshot({ filename: screenshotPath });

    if (replaceExisting) {
      screenshots.forEach((existingPath) => {
        if (fs.existsSync(existingPath)) {
          fs.unlinkSync(existingPath);
        }
      });
      screenshots = [];
    }

    screenshots.push(screenshotPath);
    if (screenshots.length > MAX_SCREENSHOTS) {
      const oldPath = screenshots.shift();
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }
    
    mainWindow.setOpacity(currentOpacity);
    
    console.log(`Screenshot saved: ${screenshotPath}`);
    console.log(`Total screenshots: ${screenshots.length}`);
    
    mainWindow.webContents.send('screenshot-taken-stealth', screenshots.length);
    
    return screenshotPath;
  } catch (error) {
    mainWindow.setOpacity(1.0);
    console.error('Stealth screenshot error:', error);
    throw error;
  }
}

async function analyzeForMeetingWithContext(context = '') {
  console.log('Starting context-aware analysis...');
  console.log('Context length:', context.length);
  const hasAnyGeminiKey = Boolean(
    process.env.GEMINI_API_KEY_FREE ||
    process.env.GEMINI_API_KEY_PAID ||
    process.env.GEMINI_API_KEY
  );
  console.log('API Key exists:', hasAnyGeminiKey);
  console.log('Model initialized:', !!(geminiService && geminiService.model));
  console.log('Screenshots count:', screenshots.length);
  const activeMode = detectActiveMode(context);
  const aiTier = detectAiTier(context);
  console.log('Active mode:', activeMode);
  console.log('AI tier:', aiTier);

  if (!hasAnyGeminiKey) {
    console.error('No Gemini API key found');
    mainWindow.webContents.send('analysis-result', {
      error: 'No API key configured. Please add GEMINI_API_KEY_FREE or GEMINI_API_KEY_PAID to your .env file.'
    });
    return;
  }

  if (!geminiService || !geminiService.model) {
    console.error('Gemini model not initialized');
    mainWindow.webContents.send('analysis-result', {
      error: 'AI model not initialized. Please check your API key.'
    });
    return;
  }

  if (screenshots.length === 0) {
    console.error('No screenshots to analyze');
    mainWindow.webContents.send('analysis-result', {
      error: 'No screenshots to analyze. Take a screenshot first.'
    });
    return;
  }

  try {
    console.log('Sending analysis start signal...');
    mainWindow.webContents.send('analysis-start');
    
    const screenshotPaths = getScreenshotPathsForAnalysis(activeMode);

    console.log('Processing screenshots...');
    const imageParts = await Promise.all(
      screenshotPaths.map(async (imagePath) => {
        console.log(`Processing screenshot: ${imagePath}`);
        
        if (!fs.existsSync(imagePath)) {
          console.error(`Screenshot file not found: ${imagePath}`);
          throw new Error(`Screenshot file not found: ${imagePath}`);
        }

        return buildImagePartFromPath(imagePath);
      })
    );

    console.log(`Prepared ${imageParts.length} image parts for analysis`);

    const contextPrompt = context ? `
    
CONVERSATION CONTEXT:
${context}

Based on the conversation context above and the screenshots provided, please:
1. Answer any questions that were asked in the conversation
2. Provide relevant insights about what's shown in the screenshots
3. If there are specific questions in the context, focus on answering those
4. Be concise but comprehensive

FORMAT YOUR RESPONSE AS:
    ` : '';

    const prompt = `You are an expert multimodal AI assistant for productivity, question answering, coding, and meeting support. Analyze the provided screenshots and conversation context.

${contextPrompt}

Respect the ACTIVE_MODE provided in the conversation context.

Mode rules:
- ACTIVE_MODE: GENERAL -> answer general productivity questions using the visible screen plus recent voice/context. Be useful for requests like "what is this?", "how do I tabulate this?", "how should I organize this?", and "what should I do next?". Listen carefully to the latest spoken request. Prefer direct explanation, practical steps, and simple tables/checklists when helpful. Make the response detailed when needed, but break lines only at complete sentence boundaries and leave a blank line between major points.
- ACTIVE_MODE: INTERVIEW -> treat this as Explain mode. Extract only the visible questions and necessary options/context, then for each visible question return the correct option letter, option number, numeric answer, or short answer text followed by a clear explanation that shows the key logic, calculation, or elimination.
- ACTIVE_MODE: CODING -> extract only the coding question, code, errors, constraints, and required input-output details, then answer.
- ACTIVE_MODE: MEETING -> use the visible screen plus recent voice/context to listen for both or all sides of the conversation. Capture speaker positions, decisions, action items, disagreements, follow-ups, and important details. Keep different sides separated when possible. Break lines only after complete sentences and leave a blank line between sections.

If the screenshot contains one or more questions, answer ALL visible questions in top-to-bottom order.
Do NOT restate or rewrite the question text.
Do not include reasoning unless the mode explicitly asks for it.
If a question is unclear, cropped, or not fully visible, output exactly:
the question is not visible fully

For MCQs, format the response exactly like this:
Q1: [option letter]
Q2: [option letter]
[continue for every visible question]

If the screenshot contains direct questions, return only the answers in order without repeating the questions.
If the screenshot contains a coding problem, provide the complete working solution.

**CODE SOLUTION:**
\`\`\`[language]
[Your complete, working code solution here - if applicable]
\`\`\`

**ANALYSIS:**
[Clear explanation of what you see in the screenshots and answers to any questions from the conversation]

**KEY INSIGHTS:**
• [Important insight 1]
• [Important insight 2]
• [Important insight 3]

Rules:
1. If there are questions in the conversation context, answer them directly
2. If questions are visible in the screenshot, answer every visible question in order
3. Do not repeat the question text back to the user
4. Put the question number beside each answer when multiple questions are visible
5. If any question is not fully visible, output exactly "the question is not visible fully"
6. For logical reasoning and mathematics, verify the pattern and arithmetic before answering
7. Treat MCQ screenshots as PAT 2026 style aptitude questions by default unless clearly contradicted by the screen
8. If a visible on-screen solution or explanation exists, prefer it over guessing
9. For standard MCQ papers, return only the option letter, not the option text
10. Provide code solutions if the screenshots show coding problems
11. Keep the response short and answer-first
12. Focus on actionable insights
13. If it's a meeting/presentation, summarize key points
14. Include time/space complexity for coding solutions
15. Do not break lines in the middle of a sentence unless a word must wrap visually in the UI

Analyze the screenshots and conversation context:`;

    console.log('Sending request to Gemini with rate limiting...');
    let text;

      if (activeMode === 'GENERAL') {
        text = aiTier === 'DEEP'
          ? await solveGeneralProductivityWithVerification(imageParts, contextPrompt, geminiService)
          : await solveGeneralProductivityFast(imageParts, contextPrompt, geminiService);
      } else if (activeMode === 'MCQ') {
        text = aiTier === 'DEEP'
          ? await solveMcqQuestionsWithVerification(imageParts, contextPrompt, geminiService)
          : await solveMcqQuestionsFast(imageParts, contextPrompt, geminiService);
      } else if (activeMode === 'INTERVIEW') {
        text = aiTier === 'DEEP'
          ? await solveExplainedQuestionsWithVerification(imageParts, contextPrompt, geminiService)
          : await solveExplainedQuestionsFast(imageParts, contextPrompt, geminiService);
      }

      if (!text) {
        const firstPassText = await geminiService.generateMultimodal([prompt, ...imageParts]);
        text = firstPassText;

        if (activeMode === 'MCQ' && aiTier === 'DEEP') {
          const verificationPrompt = `You are verifying answers for MCQ, logical reasoning, and mathematics questions.

Your job:
1. Re-check EVERY visible question carefully.
2. Prioritize visible on-screen solutions, explanations, formulas, and worked steps if present.
3. Recalculate arithmetic exactly.
4. Re-check pattern logic before finalizing.
5. Do NOT repeat the question text.
6. Keep the output short.
7. If a question is not fully visible, output exactly: the question is not visible fully

First draft:
${firstPassText}

Return only the corrected final answers in this format:
Q1: A
Q2: C
`;

        console.log('Running MCQ verification pass...');
        text = await geminiService.generateMultimodal([verificationPrompt, ...imageParts]);
      }
    }
    console.log('Received response from Gemini');
    
    console.log('Generated text length:', text.length);
    console.log('Generated text preview:', text.substring(0, 200) + '...');

    chatContext.push({
      type: 'analysis',
      content: text,
      timestamp: new Date().toISOString(),
      screenshotCount: screenshots.length
    });

    mainWindow.webContents.send('analysis-result', { text });
    console.log('Analysis result sent to renderer');
    
  } catch (error) {
    console.error('Analysis error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    let errorMessage = 'Analysis failed';
    
    if (error.message.includes('API_KEY')) {
      errorMessage = 'Invalid API key. Please check your Gemini keys in .env.';
    } else if (
      error.message.includes('quota') ||
      error.message.includes('429') ||
      error.message.includes('rate limit') ||
      error.message.includes('RESOURCE_EXHAUSTED') ||
      error.message.includes('OpenRouter 429')
    ) {
      errorMessage = 'API limit exceeded. If Gemini free quota is exhausted, add OPENROUTER_API_KEY in .env to enable the OpenRouter free fallback.';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMessage = 'Network error. Please check your internet connection.';
    } else if (error.message.includes('model')) {
      errorMessage = 'AI model error. Please try a different model.';
    } else {
      errorMessage = `Analysis failed: ${error.message}`;
    }
    
    mainWindow.webContents.send('analysis-result', {
      error: errorMessage
    });
  }
}

async function analyzeForMeeting() {
  await analyzeForMeetingWithContext();
}

// IPC handlers
ipcMain.handle('get-screenshots-count', () => {
  console.log('IPC: get-screenshots-count called, returning:', screenshots.length);
  return screenshots.length;
});

ipcMain.handle('toggle-stealth', () => {
  console.log('IPC: toggle-stealth called');
  return toggleStealthMode();
});

ipcMain.handle('emergency-hide', () => {
  console.log('IPC: emergency-hide called');
  return emergencyHide();
});

ipcMain.handle('take-stealth-screenshot', async (event, options = {}) => {
  console.log('IPC: take-stealth-screenshot called');
  return await takeStealthScreenshot(options);
});

ipcMain.handle('analyze-stealth', async () => {
  console.log('IPC: analyze-stealth called');
  return await analyzeForMeeting();
});

ipcMain.handle('analyze-stealth-with-context', async (event, context) => {
  console.log('IPC: analyze-stealth-with-context called with context length:', context.length);
  return await analyzeForMeetingWithContext(context);
});

ipcMain.handle('set-ai-tier', async (event, tier) => {
  console.log('IPC: set-ai-tier called:', tier);
  if (!geminiService) {
    return { error: 'Gemini service not initialized' };
  }

  const activeTier = geminiService.setPreferenceProfile(tier);
  return { success: true, tier: activeTier };
});

ipcMain.handle('get-ai-tier', async () => {
  if (!geminiService) {
    return 'fast';
  }

  return geminiService.getPreferenceProfile();
});

ipcMain.handle('get-ai-routing-plan', async () => {
  if (!geminiService) {
    return [];
  }

  return geminiService.getExecutionPlan().map((descriptor) => ({
    providerLabel: descriptor.providerLabel,
    modelName: descriptor.name
  }));
});

ipcMain.handle('get-ai-provider-status', async () => {
  return buildApiSlotStatus();
});

ipcMain.handle('clear-stealth', () => {
  console.log('IPC: clear-stealth called');
  screenshots.forEach(path => {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
      console.log(`Deleted screenshot: ${path}`);
    }
  });
  screenshots = [];
  chatContext = [];
  console.log('All screenshots and context cleared');
  return { success: true };
});

ipcMain.handle('close-app', () => {
  console.log('IPC: close-app called');

  if (voskProcess) {
    try {
      voskProcess.kill();
    } catch (error) {
      console.error('Failed to stop Vosk during close:', error.message);
    }
    voskProcess = null;
    isVoskRunning = false;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  setTimeout(() => {
    app.exit(0);
  }, 100);

  return { success: true };
});

ipcMain.handle('set-click-through', (event, enabled) => {
  console.log('IPC: set-click-through called:', enabled);
  setWindowClickThrough(Boolean(enabled));
  return { success: true, enabled: clickThroughEnabled };
});

ipcMain.handle('toggle-window-visibility', () => {
  toggleWindowVisibility();
  return {
    success: true,
    visible: mainWindow ? mainWindow.isVisible() : false
  };
});

ipcMain.handle('get-window-bounds', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  return mainWindow.getBounds();
});

ipcMain.handle('resize-window', (event, width, height) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false };
  }

  const nextWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(width));
  const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(height));
  mainWindow.setSize(nextWidth, nextHeight);
  return { success: true, bounds: mainWindow.getBounds() };
});

ipcMain.on('resize-window-live', (event, width, height) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const nextWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(width));
  const nextHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(height));
  mainWindow.setSize(nextWidth, nextHeight);
});

ipcMain.on('move-window-live', (event, x, y) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.handle('start-window-drag', () => {
  return startWindowDragTracking();
});

ipcMain.handle('stop-window-drag', () => {
  stopWindowDragTracking();
  return { success: true };
});

ipcMain.handle('start-window-resize', () => {
  return startWindowResizeTracking();
});

ipcMain.handle('update-window-resize', (event, cursorX, cursorY) => {
  return updateWindowResizeTracking(cursorX, cursorY);
});

ipcMain.handle('stop-window-resize', () => {
  stopWindowResizeTracking();
  return { success: true };
});

// Start Vosk live transcription
ipcMain.handle('start-voice-recognition', () => {
  console.log('IPC: start-voice-recognition called');

  if (isVoskRunning) {
    console.log('Vosk already running');
    return { success: true, message: 'Already running' };
  }

  try {
    const pythonScript = isDevelopment()
      ? path.join(__dirname, '..', 'vosk_live.py')
      : path.join(process.resourcesPath, 'vosk_live.py');
    const pythonExecutable = resolvePythonExecutable();
    console.log('Starting Vosk live transcription:', pythonScript);
    console.log('Using Python executable:', pythonExecutable);

    voskProcess = spawn(pythonExecutable, [pythonScript]);
    isVoskRunning = true;

    // Handle stdout (JSON transcription results)
    voskProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');

      lines.forEach(line => {
        if (!line.trim()) return;

        try {
          const result = JSON.parse(line);

          switch (result.type) {
            case 'status':
              console.log(`Vosk status: ${result.status} - ${result.message}`);
              sendToRenderer('vosk-status', result);
              break;

            case 'partial':
              // Real-time partial result
              sendToRenderer('vosk-partial', { text: result.text });
              break;

            case 'final':
              // Final transcription result
              console.log('Vosk transcription:', result.text);
              sendToRenderer('vosk-final', { text: result.text });

              // Add to Gemini history
              addVoiceTranscriptToHistory(result.text);
              break;

            case 'error':
              console.error('Vosk error:', result.error);
              sendToRenderer('vosk-error', { error: result.error });
              break;
          }
        } catch (parseError) {
          console.error('Failed to parse Vosk output:', line);
        }
      });
    });

    voskProcess.stderr.on('data', (data) => {
      console.error('Vosk stderr:', data.toString());
    });

    voskProcess.on('close', (code) => {
      console.log('Vosk process exited with code:', code);
      isVoskRunning = false;
      voskProcess = null;
      sendToRenderer('vosk-stopped');
    });

    voskProcess.on('error', (error) => {
      console.error('Failed to start Vosk:', error.message);
      isVoskRunning = false;
      voskProcess = null;
      sendToRenderer('vosk-error', {
        error: `Python or Vosk not installed. ${error.message}`
      });
    });

    return { success: true };

  } catch (error) {
    console.error('Error starting Vosk:', error.message);
    isVoskRunning = false;
    return { success: false, error: error.message };
  }
});

// Stop Vosk live transcription (just pause, don't kill process)
ipcMain.handle('stop-voice-recognition', () => {
  console.log('IPC: stop-voice-recognition called');

  // Don't kill the process - just send a stop signal
  // The Python script will keep running with model in memory
  // and send a 'stopped' status

  if (!isVoskRunning || !voskProcess) {
    return { success: true, message: 'Not running' };
  }

  try {
    // Send stop command to Python process via stdin
    // For now, just mark as stopped in renderer
    // The Python process keeps running with model loaded
    sendToRenderer('vosk-status', {
      status: 'stopped',
      message: 'Paused listening'
    });
    return { success: true };
  } catch (error) {
    console.error('Error stopping Vosk:', error.message);
    return { success: false, error: error.message };
  }
});

// REMOVED: convert-audio handler - not needed with direct AudioContext approach!
// The renderer will handle audio conversion directly using AudioContext.decodeAudioData()
// This is much more reliable and simpler than FFmpeg

// New Cluely-style feature handlers

// Transcribe audio using Python Whisper subprocess (FAST & OFFLINE!)
ipcMain.handle('transcribe-audio', async (event, base64Audio, mimeType) => {
  console.log('IPC: transcribe-audio called, size:', base64Audio.length);

  const tmpDir = path.join(app.getPath('temp'), 'cluely-audio');

  try {
    // Create temp directory
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Save base64 audio to temp file
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    const tempAudioPath = path.join(tmpDir, `audio_${Date.now()}.webm`);
    fs.writeFileSync(tempAudioPath, audioBuffer);

    console.log('Saved temp audio:', tempAudioPath, audioBuffer.length, 'bytes');

    // Spawn Python process
    return new Promise((resolve, reject) => {
      const pythonScript = isDevelopment()
        ? path.join(__dirname, '..', 'transcribe.py')
        : path.join(process.resourcesPath, 'transcribe.py');
      console.log('Running Python script:', pythonScript);

      const python = spawn('python', [pythonScript, tempAudioPath]);

      let output = '';
      let errorOutput = '';

      python.stdout.on('data', (data) => {
        output += data.toString();
      });

      python.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      python.on('close', (code) => {
        // Clean up temp file
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (e) {
          console.error('Failed to delete temp file:', e);
        }

        if (code !== 0) {
          console.error('Python exited with code:', code);
          console.error('Error:', errorOutput);
          resolve({ success: false, error: `Python error: ${errorOutput || 'Unknown error'}` });
          return;
        }

        try {
          const result = JSON.parse(output.trim());
          console.log('Transcription:', result.text || result.error);

          // Add to Gemini history if successful
          if (result.success && result.text) {
            addVoiceTranscriptToHistory(result.text);
          }

          resolve({
            success: result.success,
            transcript: result.text || '',
            error: result.error
          });

        } catch (parseError) {
          console.error('Failed to parse output:', output);
          resolve({ success: false, error: 'Failed to parse result' });
        }
      });

      python.on('error', (error) => {
        console.error('Failed to start Python:', error.message);

        // Clean up
        try {
          fs.unlinkSync(tempAudioPath);
        } catch (e) {}

        resolve({
          success: false,
          error: 'Python not found. Install Python and run: pip install openai-whisper'
        });
      });
    });

  } catch (error) {
    console.error('Error in transcribe-audio:', error.message);
    return { success: false, error: error.message };
  }
});

// Add voice transcript to history
ipcMain.handle('add-voice-transcript', async (event, transcript) => {
  console.log('IPC: add-voice-transcript called');
  addVoiceTranscriptToHistory(transcript);
  return { success: true };
});

// "What should I say?" feature
ipcMain.handle('suggest-response', async (event, context) => {
  console.log('IPC: suggest-response called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const suggestions = await geminiService.suggestResponse(context);
    return { success: true, suggestions };
  } catch (error) {
    console.error('Error generating suggestions:', error);
    return { success: false, error: error.message };
  }
});

// Generate meeting notes
ipcMain.handle('generate-meeting-notes', async () => {
  console.log('IPC: generate-meeting-notes called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const notes = await geminiService.generateMeetingNotes();
    return { success: true, notes };
  } catch (error) {
    console.error('Error generating meeting notes:', error);
    return { success: false, error: error.message };
  }
});

// Generate follow-up email
ipcMain.handle('generate-follow-up-email', async () => {
  console.log('IPC: generate-follow-up-email called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const email = await geminiService.generateFollowUpEmail();
    return { success: true, email };
  } catch (error) {
    console.error('Error generating email:', error);
    return { success: false, error: error.message };
  }
});

// Answer specific question
ipcMain.handle('answer-question', async (event, question) => {
  console.log('IPC: answer-question called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const answer = await geminiService.answerQuestion(question);
    return { success: true, answer };
  } catch (error) {
    console.error('Error answering question:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('answer-voice-input', async (event, payload = {}) => {
  console.log('IPC: answer-voice-input called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }

    const transcript = String(payload.transcript || '').replace(/\s+/g, ' ').trim();
    const mode = String(payload.mode || 'general').toLowerCase();

    if (!transcript) {
      throw new Error('No voice transcript captured');
    }

    const promptByMode = {
      general: `You are Lens Buddy AI answering a voice-only user query with no screenshot.

User transcript:
${transcript}

Task:
1. Answer the spoken question directly.
2. Do not ask for a screenshot unless the question clearly depends on something visual.
3. For simple questions like arithmetic or factual help, answer immediately.
4. Keep the response clear, conversational, and helpful.
5. Break lines only after complete sentences or finished thoughts, with a blank line between major points when useful.`,
      meeting: `You are Lens Buddy AI processing a voice-only meeting transcript with no screenshot.

Meeting transcript:
${transcript}

Task:
1. Listen for both or all sides of the conversation.
2. Summarize key discussion points.
3. Separate speaker positions when possible.
4. List decisions, action items, and follow-ups.
5. Keep the response detailed, structured, and easy to scan with clean sentence-based line breaks.`,
      interview: `You are Lens Buddy AI answering a voice-only question in Explain mode.

User transcript:
${transcript}

Task:
1. Answer the spoken question directly.
2. Give a clear explanation of why.
3. If it is numerical, show the key calculation.
4. Keep the explanation readable and well structured.`,
      coding: `You are Lens Buddy AI answering a voice-only coding query with no screenshot.

User transcript:
${transcript}

Task:
1. Answer the coding question directly.
2. If code is needed, provide a complete usable solution.
3. Explain key logic briefly and clearly.
4. Ask for a screenshot only if the user clearly refers to code or an error that is not included in the transcript.`
    };

    const prompt = promptByMode[mode] || promptByMode.general;
    const answer = await geminiService.generateText(prompt);

    addVoiceTranscriptToHistory(transcript);
    geminiService.addToHistory('assistant', `[voice-answer] ${answer}`);

    return { success: true, answer };
  } catch (error) {
    console.error('Error answering voice input:', error);
    return { success: false, error: error.message };
  }
});

// Get conversation insights
ipcMain.handle('get-conversation-insights', async () => {
  console.log('IPC: get-conversation-insights called');
  try {
    if (!geminiService) {
      throw new Error('Gemini service not initialized');
    }
    const insights = await geminiService.getConversationInsights();
    return { success: true, insights };
  } catch (error) {
    console.error('Error getting insights:', error);
    return { success: false, error: error.message };
  }
});

// Clear conversation history
ipcMain.handle('clear-conversation-history', async () => {
  console.log('IPC: clear-conversation-history called');
  try {
    if (geminiService) {
      geminiService.clearHistory();
    }
    chatContext = [];
    return { success: true };
  } catch (error) {
    console.error('Error clearing history:', error);
    return { success: false, error: error.message };
  }
});

// Get conversation history
ipcMain.handle('get-conversation-history', async () => {
  console.log('IPC: get-conversation-history called');
  try {
    if (!geminiService) {
      return { success: true, history: [] };
    }
    return { success: true, history: geminiService.conversationHistory };
  } catch (error) {
    console.error('Error getting history:', error);
    return { success: false, error: error.message };
  }
});

// App event handlers
app.whenReady().then(() => {
  console.log('App is ready, creating window...');
  createStealthWindow();
  registerStealthShortcuts();
  // Add to app.whenReady() or before createWindow
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('allow-running-insecure-content');
  app.commandLine.appendSwitch('disable-web-security');
  app.commandLine.appendSwitch('enable-media-stream');
  
  isVisible = true;
  
  console.log('Window setup complete - will show after content loads');

  setWindowClickThrough(manualClickThrough);
});

app.on('window-all-closed', () => {
  // Keep running in background for stealth operation
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createStealthWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  
  screenshots.forEach(path => {
    if (fs.existsSync(path)) fs.unlinkSync(path);
  });
});

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });
  
  contents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== mainWindow.webContents.getURL()) {
      event.preventDefault();
    }
  });
});

process.title = 'SystemIdleProcess';
})();
