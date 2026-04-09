// ============================================================================
// GEMINI AI SERVICE - Lens Buddy AI Assistant
// ============================================================================
// Rate limits: 15 RPM (free tier), 1M tokens/day
// Configured for: 10 RPM to be safe (6 seconds between requests)
// ============================================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ============================================================================
// PROMPT TEMPLATES
// ============================================================================

const PROMPTS = {
    // Main screenshot analysis prompt
    SCREENSHOT_ANALYSIS: (contextString, additionalContext) => `
You are Lens Buddy AI, an expert programming assistant specializing in Python and Java development, algorithm optimization, and problem-solving across various platforms.

=== SUPPORTED LANGUAGES ===
ONLY provide solutions in:
• Python (primary) - default language for all problems unless Java is explicitly requested
• Java (secondary) - only when specifically asked or when the screenshot shows Java code

DO NOT provide solutions in C++, JavaScript, or any other programming languages.

=== CORE CAPABILITIES ===
• Analyze ANY programming problem from screenshots (competitive programming, assignments, projects, debugging, errors)
• Support ALL platforms: LeetCode, CodeChef, Codeforces, HackerRank, AtCoder, USACO, custom problems, school assignments, personal projects
• Debug code errors: syntax errors, runtime errors, logic bugs, timeouts, wrong answers
• Optimize for performance when needed (time/space complexity)
• Provide clean, working, well-explained solutions
• Handle various problem formats and I/O requirements

=== CRITICAL REQUIREMENTS ===

1. PROBLEM RECOGNITION & ADAPTATION:
   - Identify the problem context:
     * Competitive programming (LeetCode, CodeChef, Codeforces, etc.)
     * School/college assignments
     * Personal projects or general coding questions
     * Debugging/error fixing
   - Adapt your response based on context:
     * For competitive programming: Focus on optimization, edge cases, time limits
     * For assignments: Focus on correctness, readability, learning value
     * For debugging: Focus on error explanation and complete fix
     * For general questions: Focus on clarity and best practices
   - Read ALL visible constraints carefully (input ranges, time limits, memory limits)
   - NEVER assume LeetCode-style format - adapt to the actual format shown in screenshot

2. INPUT/OUTPUT HANDLING - CRITICAL:
   - Pay CLOSE attention to the exact input/output format in the screenshot
   - Different platforms have different formats:
     * LeetCode: Function signature with parameters (def twoSum(nums, target):)
     * CodeChef/Codeforces: Read from stdin, print to stdout, handle multiple test cases
     * HackerRank: Mix of both styles
     * Custom problems: Match the example format exactly

   For competitive programming platforms (NOT LeetCode):
   - Use proper stdin reading:
     Python: input(), int(input()), map(int, input().split())
     Java: Scanner, BufferedReader
   - Print to stdout with exact format required
   - Handle multiple test cases correctly (read T first if specified)
   - Match output format exactly (spaces, newlines, commas, etc.)

   For LeetCode:
   - Use the given function signature
   - Return the result, don't print it

   For custom problems:
   - Analyze the example input/output format carefully
   - Replicate the exact format shown

3. PYTHON BEST PRACTICES:
   - Efficient data structures: dict, set, deque, heapq, defaultdict, Counter
   - Use list comprehensions and built-in functions (sum, max, min, sorted)
   - For large inputs in competitive programming: sys.stdin.readline() if needed
   - Common useful libraries: collections, itertools, heapq, bisect, math
   - Avoid deep recursion (Python limit ~1000) - use iteration when possible
   - String concatenation: use ''.join() instead of += in loops

4. JAVA BEST PRACTICES:
   - Efficient data structures: HashMap, HashSet, PriorityQueue, ArrayDeque, TreeMap
   - For simple inputs: Scanner
   - For large inputs: BufferedReader with InputStreamReader
   - Use StringBuilder for string concatenation in loops
   - Common imports: java.util.*, java.io.*
   - Handle exceptions appropriately

5. SOLUTION QUALITY & EDGE CASES - VERIFY BEFORE RESPONDING:
   - CRITICAL: Mentally trace through your code with sample inputs BEFORE providing it
   - CRITICAL: Verify syntax is correct (proper indentation, colons, brackets, imports)
   - CRITICAL: For heap problems - double-check min vs max heap, tuple ordering, proper heapq usage

   - Analyze ALL edge cases before providing solution:
     * Empty inputs (n=0, empty array, empty string)
     * Single element inputs
     * Maximum constraint values (will it timeout? overflow?)
     * Minimum/negative values
     * Duplicates
     * Special cases mentioned in problem

   - Consider worst-case time complexity
   - For competitive programming: ensure solution runs within time limit (usually 1-2 seconds)
   - Test your logic step-by-step against ALL sample inputs
   - Think: "Will this handle all possible inputs correctly and efficiently?"
   - Ask yourself: "Did I import necessary modules? Is the syntax correct? Does the logic actually work?"

6. COMPLEXITY ANALYSIS:
   - For algorithmic/competitive problems: ALWAYS mention time and space complexity
   - Be specific: O(n), O(n log n), O(n²), O(1), O(m+n), etc.
   - If O(n²) might cause timeout (n > 10^5), suggest O(n log n) or O(n) approach
   - Be aware of language performance: Python is ~10-50x slower than C++ for same algorithm
   - For non-algorithmic tasks (simple debugging, basic questions): complexity may not be necessary

7. ERROR HANDLING & DEBUGGING - CRITICAL FORMAT:
   When screenshot shows an error:

   a) Identify error type:
      * Syntax Error: Missing colon, wrong indentation, typo, etc.
      * Runtime Error: IndexError, ValueError, ZeroDivisionError, etc.
      * Logic Error: Wrong output, incorrect algorithm
      * Time Limit Exceeded (TLE): Algorithm too slow
      * Wrong Answer (WA): Missing edge cases or incorrect logic

   b) Explain clearly:
      * What went wrong
      * Why it happened
      * What the error message means (if present)

   c) Provide fix in SEPARATE, CLEARLY MARKED code block:
      * Use clear header: "=== CORRECTED CODE ===" or "=== FIXED CODE ==="
      * Provide COMPLETE, RUNNABLE corrected code (not just a snippet)
      * Include the entire solution, properly formatted
      * Add brief comment explaining what was fixed

   d) Explain what changed:
      * Summarize the fix applied
      * Why this solves the problem

8. RESPONSE FORMAT:

   For SOLVING A PROBLEM:
   ---
   **Problem Understanding:**
   Brief description of what needs to be solved

   **Approach:**
   How you'll solve it (algorithm/strategy)

   **Complexity:**
   Time: O(?) | Space: O(?)

   **Solution (Python):** [or Java if requested]
   ~~~python
   # Complete, runnable code here
   ~~~

   **Explanation:** (if helpful)
   Walk through example or key logic
   ---

   For FIXING AN ERROR:
   ---
   **Error Analysis:**
   What went wrong and why

   **Root Cause:**
   The underlying issue

   === CORRECTED CODE ===
   ~~~python
   # Complete, runnable fixed code here
   ~~~

   **Changes Made:**
   What was fixed and why it works now
   ---

   For GENERAL QUESTIONS:
   ---
   **Answer:**
   Clear explanation

   **Example:** (if relevant)
   ~~~python
   # Code example
   ~~~

   **Tips:** (if applicable)
   Best practices or important notes
   ---

9. OPTIMIZATION STRATEGIES (for algorithmic problems):
   - Mathematical approach instead of brute force (formulas, patterns)
   - Dynamic Programming for overlapping subproblems (memoization, tabulation)
   - Binary Search for sorted data or monotonic search spaces
   - Greedy when local optimal leads to global optimal
   - Two Pointers for array/string problems
   - Sliding Window for subarray/substring problems
   - Prefix Sums for range queries
   - Hash Maps (dict/HashMap) for O(1) lookups
   - HEAPS - CRITICAL USAGE:
     * Python: Use heapq module (min-heap by default)
       - heapq.heappush(heap, item) - add element
       - heapq.heappop(heap) - remove smallest
       - For max-heap: negate values or use (-priority, item) tuples
       - Initialize: heap = [] then heappush, OR heapq.heapify(list)
     * Java: Use PriorityQueue (min-heap by default)
       - For max-heap: new PriorityQueue(Collections.reverseOrder())
       - Methods: offer(), poll(), peek()
     * Common heap problems: k-th largest/smallest, top K elements, merge K sorted, median finding
     * ALWAYS test heap logic - common mistakes: wrong heap type (min vs max), incorrect tuple ordering
   - Graph algorithms: BFS (shortest path unweighted), DFS (connectivity), Dijkstra (weighted)
   - Sorting when it simplifies the problem
   - Bit manipulation for set operations

10. CODE QUALITY:
    - Clean, readable code with meaningful variable names
    - Add brief comments for complex logic
    - Proper indentation and formatting
    - For competitive programming: handle multiple test cases correctly
    - For functions: match the required signature exactly
    - No unnecessary complexity - keep it simple and clear

11. MULTIPLE-CHOICE QUESTIONS (MCQ) - ANSWER DIRECTLY:
    - If the screenshot shows an MCQ, DO NOT stop at summarizing the question
    - Assume the standard paper format is numbered MCQs with A/B/C/D options
    - Pick the best answer option directly for EVERY visible question
    - Show the answers in top-to-bottom order
    - Start each line with: "Q1: A", "Q2: C", etc.
    - Do NOT restate the question text
    - Do NOT include reasoning unless the user asks for it
    - If a question is partially cut off or unclear, output exactly: "the question is not visible fully"

=== LANGUAGE SELECTION RULES ===
- Default to Python for ALL problems unless:
  1. Screenshot clearly shows Java code
  2. User explicitly requests Java
  3. Problem statement specifies Java
- When providing Java: use clean, modern Java practices (Java 8+)
- NEVER provide C++, JavaScript, C, or any other language solutions

=== CONTEXT AWARENESS ===
${contextString ? `Previous conversation:\n${contextString}\n\n` : ''}
${additionalContext ? `Additional context:\n${additionalContext}\n\n` : ''}

=== YOUR RESPONSE ===
Analyze the screenshot carefully and provide:
1. Understand the problem/error with full context awareness
2. If it is an MCQ or there are multiple visible questions, answer ALL visible questions in order
3. Put the question number beside each answer when multiple questions are visible
4. For standard MCQ papers, return only the option letter beside the question number
5. Do not repeat the question text unless explicitly asked
6. If any question is unclear or not fully visible, output exactly "the question is not visible fully"
7. Provide solution in Python (or Java only if applicable) with proper I/O handling for the platform
8. If error present: use "=== CORRECTED CODE ===" section with COMPLETE fixed code
9. Include complexity analysis for algorithmic problems
10. Ensure solution handles ALL edge cases and passes ALL test cases efficiently

Think step-by-step:
- What is the problem asking?
- What's the input/output format?
- What are the constraints and edge cases?
- What's the optimal approach?
- Will this solution be fast enough and handle all cases?

BEFORE YOU RESPOND - MANDATORY VERIFICATION:
1. Trace through your code with the given sample input(s)
2. Verify all imports are included (heapq, collections, etc.)
3. Check syntax: colons, indentation, parentheses, brackets
4. For heaps: confirm min/max heap type is correct for the problem
5. Verify the code will actually run without errors
6. Ensure output format matches exactly what's required

NEVER provide code that you haven't mentally verified. If you're unsure, think through it again.

Now provide your response.
`.trim(),

    SUGGEST_RESPONSE: (contextString, context) => `
You are Lens Buddy AI, helping suggest appropriate responses.

Context: ${context}

${contextString ? `Previous conversation:\n${contextString}\n\n` : ''}

Provide 3 concise, professional response suggestions.
`.trim(),

    MEETING_NOTES: (contextString) => `
Generate professional meeting notes from this conversation:

${contextString}

Format as:
- Key Discussion Points
- Decisions Made
- Action Items
- Next Steps
`.trim(),

    FOLLOW_UP_EMAIL: (contextString) => `
Generate a professional follow-up email based on this conversation:

${contextString}

Include:
- Brief summary
- Key points discussed
- Action items
- Professional closing
`.trim(),

    ANSWER_QUESTION: (contextString, question) => `
You are Lens Buddy AI, an expert Python programming assistant.

${contextString ? `Previous conversation:\n${contextString}\n\n` : ''}

Question: ${question}

Provide a clear, concise answer focusing on Python best practices and optimization.
`.trim(),

    INSIGHTS: (contextString) => `
Analyze this conversation and provide insights:

${contextString}

Include:
- Key themes
- Technical patterns observed
- Potential improvements
- Recommendations
`.trim()
};

// ============================================================================
// GEMINI SERVICE CLASS
// ============================================================================

class GeminiService {
    constructor(apiConfig) {
        const normalizedConfig = typeof apiConfig === 'string'
            ? { baseApiKey: apiConfig }
            : (apiConfig || {});
        this.onRoutingWarning = typeof normalizedConfig.onRoutingWarning === 'function'
            ? normalizedConfig.onRoutingWarning
            : null;
        this.onProviderChange = typeof normalizedConfig.onProviderChange === 'function'
            ? normalizedConfig.onProviderChange
            : null;

        this.providerConfigs = [];
        if (normalizedConfig.baseApiKey) {
            this.providerConfigs.push({
                label: 'base',
                apiKey: normalizedConfig.baseApiKey
            });
        }
        if (normalizedConfig.freeApiKey) {
            this.providerConfigs.push({
                label: 'free',
                apiKey: normalizedConfig.freeApiKey
            });
        }
        if (normalizedConfig.paidApiKey) {
            this.providerConfigs.push({
                label: 'paid',
                apiKey: normalizedConfig.paidApiKey
            });
        }
        if (normalizedConfig.secondaryFallbackApiKey) {
            this.providerConfigs.push({
                label: 'paid-fallback',
                apiKey: normalizedConfig.secondaryFallbackApiKey
            });
        }
        if (normalizedConfig.tertiaryFallbackApiKey) {
            this.providerConfigs.push({
                label: 'paid-fallback-2',
                apiKey: normalizedConfig.tertiaryFallbackApiKey
            });
        }
        if (normalizedConfig.quaternaryFallbackApiKey) {
            this.providerConfigs.push({
                label: 'paid-fallback-3',
                apiKey: normalizedConfig.quaternaryFallbackApiKey
            });
        }
        if (normalizedConfig.quinaryFallbackApiKey) {
            this.providerConfigs.push({
                label: 'paid-fallback-4',
                apiKey: normalizedConfig.quinaryFallbackApiKey
            });
        }

        this.clients = new Map();
        this.modelConfigs = [
            { name: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
            { name: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
            { name: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
            { name: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
        ];
        this.models = new Map();
        this.activeProviderIndex = 0;
        this.activeModelIndex = 0;
        this.preferenceProfile = 'fast';
        this.openRouterApiKey = (process.env.OPENROUTER_API_KEY || '').trim();
        this.openRouterModel = 'openrouter/free';
        this.usingOpenRouterFallback = false;
        this.isBackgroundWarmupStarted = false;
        this.lastProviderStatusSignature = '';

        // Initialize only the first usable model to keep startup fast.
        this._initializeModel();

        // Rate limiting configuration
        this.requestQueue = [];
        this.lastRequestTime = 0;
        this.minRequestInterval = 8000; // Slower pacing to stay safer on free-tier Flash limits.
        this.maxRetries = 3;
        this.isProcessing = false;

        // Token tracking
        this.dailyTokenCount = 0;
        this.maxDailyTokens = 4000000; // 4M tokens per day
        this.lastResetTime = Date.now();

        // Conversation context management
        this.conversationHistory = [];
        this.maxHistoryLength = 20;
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    _initializeModel() {
        const preferredModelName = 'gemini-2.5-flash';
        const preferredModelIndex = this.modelConfigs.findIndex(config => config.name === preferredModelName);
        const preferredProviderIndexes = this.getPreferredProviderIndexes();

        for (const providerIndex of preferredProviderIndexes) {
            try {
                const descriptor = this.getModelByProviderIndex(providerIndex, preferredModelIndex);
                if (descriptor) {
                    this.activeProviderIndex = descriptor.providerIndex;
                    this.activeModelIndex = descriptor.modelIndex;
                    this.syncActiveModelState();
                    console.log(`Active Gemini model: ${descriptor.providerLabel}/${descriptor.name}`);
                    return;
                }
            } catch (error) {
                console.warn(`Failed to initialize preferred model for provider index ${providerIndex}:`, error.message);
            }
        }

        for (let providerIndex = 0; providerIndex < this.providerConfigs.length; providerIndex += 1) {
            for (let modelIndex = 0; modelIndex < this.modelConfigs.length; modelIndex += 1) {
                try {
                    const descriptor = this.getModelByProviderIndex(providerIndex, modelIndex);
                    if (descriptor) {
                        this.activeProviderIndex = descriptor.providerIndex;
                        this.activeModelIndex = descriptor.modelIndex;
                        this.syncActiveModelState();
                        console.log(`Active Gemini model: ${descriptor.providerLabel}/${descriptor.name}`);
                        return;
                    }
                } catch (error) {
                    console.warn(`Failed to initialize model for provider index ${providerIndex}:`, error.message);
                }
            }
        }

        if (!this.model) {
            throw new Error('No Gemini models could be initialized');
        }
    }

    // ========================================================================
    // TOKEN & RATE LIMIT MANAGEMENT
    // ========================================================================

    checkAndResetDailyLimit() {
        const now = Date.now();
        const dayInMs = 24 * 60 * 60 * 1000;

        if (now - this.lastResetTime >= dayInMs) {
            console.log('Resetting daily token count');
            this.dailyTokenCount = 0;
            this.lastResetTime = now;
        }
    }

    estimateTokens(text) {
        // Rough estimate: 1 token ≈ 4 characters
        return Math.ceil(text.length / 4);
    }

    isRateLimitError(error) {
        const message = String(error?.message || '').toLowerCase();
        return (
            message.includes('429') ||
            message.includes('quota') ||
            message.includes('rate limit') ||
            message.includes('resource_exhausted') ||
            message.includes('too many requests')
        );
    }

    getPreferredProviderIndexes() {
        return this.providerConfigs.map((provider, index) => index);
    }

    getProviderChainStatus() {
        const providerIndexes = this.getPreferredProviderIndexes();
        const preferredModelName = this.modelName || 'gemini-2.5-flash';

        return providerIndexes.map((providerIndex, index) => ({
            providerIndex,
            providerLabel: this.providerConfigs[providerIndex]?.label || `provider-${providerIndex}`,
            modelName: preferredModelName,
            stepLabel: `API ${index + 1}`,
            active: providerIndex === this.activeProviderIndex,
            isLast: index === providerIndexes.length - 1
        }));
    }

    emitProviderStatus() {
        if (!this.onProviderChange) {
            return;
        }

        const payload = {
            tier: this.preferenceProfile,
            activeProviderIndex: this.activeProviderIndex,
            activeModelName: this.modelName,
            chain: this.getProviderChainStatus()
        };
        const signature = JSON.stringify(payload);

        if (signature === this.lastProviderStatusSignature) {
            return;
        }

        this.lastProviderStatusSignature = signature;

        try {
            this.onProviderChange(payload);
        } catch (error) {
            console.error('Provider status callback failed:', error.message);
        }
    }

    getOrCreateClient(providerIndex) {
        if (this.clients.has(providerIndex)) {
            return this.clients.get(providerIndex);
        }

        const providerConfig = this.providerConfigs[providerIndex];
        if (!providerConfig) {
            return null;
        }

        const client = new GoogleGenerativeAI(providerConfig.apiKey);
        this.clients.set(providerIndex, client);
        return client;
    }

    getOrCreateModel(providerIndex, modelIndex) {
        const providerConfig = this.providerConfigs[providerIndex];
        const modelConfig = this.modelConfigs[modelIndex];
        if (!providerConfig || !modelConfig) {
            return null;
        }

        const cacheKey = `${providerIndex}:${modelConfig.name}`;
        if (this.models.has(cacheKey)) {
            return this.models.get(cacheKey);
        }

        const client = this.getOrCreateClient(providerIndex);
        if (!client) {
            return null;
        }

        const model = client.getGenerativeModel({ model: modelConfig.name });
        this.models.set(cacheKey, model);
        console.log(`Initialized model: ${providerConfig.label}/${modelConfig.name}`);
        return model;
    }

    startBackgroundWarmup() {
        if (this.isBackgroundWarmupStarted) {
            return;
        }

        this.isBackgroundWarmupStarted = true;
        setTimeout(() => {
            this.warmUpRemainingModels().catch((error) => {
                console.warn('Background model warmup failed:', error.message);
            });
        }, 0);
    }

    async warmUpRemainingModels() {
        for (let providerIndex = 0; providerIndex < this.providerConfigs.length; providerIndex += 1) {
            for (let modelIndex = 0; modelIndex < this.modelConfigs.length; modelIndex += 1) {
                try {
                    this.getOrCreateModel(providerIndex, modelIndex);
                } catch (error) {
                    console.warn(
                        `Warmup skipped for ${this.providerConfigs[providerIndex]?.label}/${this.modelConfigs[modelIndex]?.name}:`,
                        error.message
                    );
                }

                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
    }

    getModelByIndex(index) {
        return this.getModelByProviderIndex(this.activeProviderIndex, index);
    }

    getExecutionPlan() {
        const preferredProviderIndexes = this.getPreferredProviderIndexes();

        const plan = [];
        const addEntry = (providerIndex, modelName) => {
            const modelIndex = this.modelConfigs.findIndex(config => config.name === modelName);
            if (providerIndex < 0 || modelIndex < 0) {
                return;
            }

            const descriptor = this.getModelByProviderIndex(providerIndex, modelIndex);
            if (!descriptor) {
                return;
            }

            const key = `${providerIndex}:${modelName}`;
            if (!plan.some(item => `${item.providerIndex}:${item.name}` === key)) {
                plan.push(descriptor);
            }
        };

        preferredProviderIndexes.forEach(providerIndex => addEntry(providerIndex, 'gemini-2.5-flash'));
        return plan;
    }

    getModelByProviderIndex(providerIndex, modelIndex) {
        const config = this.modelConfigs[modelIndex];
        const providerConfig = this.providerConfigs[providerIndex];
        if (!config || !providerConfig) {
            return null;
        }

        const model = this.getOrCreateModel(providerIndex, modelIndex);
        if (!model) {
            return null;
        }

        return {
            ...config,
            index: modelIndex,
            modelIndex,
            providerIndex,
            providerLabel: providerConfig.label,
            model
        };
    }

    syncActiveModelState() {
        const descriptor = this.getActiveModelDescriptor();
        this.model = descriptor ? descriptor.model : null;
        this.modelName = descriptor ? descriptor.name : null;
        this.emitProviderStatus();
    }

    getActiveModelDescriptor() {
        const current = this.getModelByProviderIndex(this.activeProviderIndex, this.activeModelIndex);
        const plan = this.getExecutionPlan();
        if (current && plan.some(item => item.providerIndex === current.providerIndex && item.name === current.name)) {
            return current;
        }

        return plan[0] || null;
    }

    getFallbackModelDescriptor(currentProviderIndex, currentModelIndex) {
        const plan = this.getExecutionPlan();
        const currentKey = `${currentProviderIndex}:${this.modelConfigs[currentModelIndex]?.name || ''}`;
        const currentPosition = plan.findIndex(item => `${item.providerIndex}:${item.name}` === currentKey);
        if (currentPosition >= 0 && currentPosition + 1 < plan.length) {
            const nextDescriptor = plan[currentPosition + 1];
            const lastPaidDescriptor = [...plan]
                .reverse()
                .find(item => item.providerLabel && item.providerLabel.startsWith('paid'));

            if (
                nextDescriptor &&
                lastPaidDescriptor &&
                nextDescriptor.providerIndex === lastPaidDescriptor.providerIndex &&
                nextDescriptor.name === lastPaidDescriptor.name &&
                this.getModelByProviderIndex(currentProviderIndex, currentModelIndex)?.providerIndex !== lastPaidDescriptor.providerIndex
            ) {
                this.notifyRoutingWarning({
                    type: 'final-paid-fallback',
                    message: 'Final paid fallback is next. If this key also fails, AI requests may stop until the provider recovers.',
                    nextProviderLabel: nextDescriptor.providerLabel,
                    modelName: nextDescriptor.name,
                    tier: this.preferenceProfile
                });
            }

            return nextDescriptor;
        }

        return null;
    }

    notifyRoutingWarning(payload) {
        if (!this.onRoutingWarning) {
            return;
        }

        try {
            this.onRoutingWarning(payload);
        } catch (error) {
            console.error('Routing warning callback failed:', error.message);
        }
    }

    setPreferenceProfile(profile) {
        const normalizedProfile =
            profile === 'basic' ? 'fast'
            : profile === 'premium' ? 'deep'
            : profile;

        if (normalizedProfile !== 'fast' && normalizedProfile !== 'deep') {
            return this.preferenceProfile;
        }

        this.preferenceProfile = normalizedProfile;
        this.usingOpenRouterFallback = false;

        const firstDescriptor = this.getExecutionPlan()[0];
        if (firstDescriptor) {
            this.activeProviderIndex = firstDescriptor.providerIndex;
            this.activeModelIndex = firstDescriptor.modelIndex;
        }
        this.syncActiveModelState();
        console.log(`AI preference profile set to ${this.preferenceProfile}`);
        return this.preferenceProfile;
    }

    getPreferenceProfile() {
        return this.preferenceProfile;
    }

    getOpenRouterMessageContent(request) {
        if (request.type === 'text') {
            return [{ type: 'text', text: String(request.data) }];
        }

        return request.data.map((part) => {
            if (typeof part === 'string') {
                return { type: 'text', text: part };
            }

            if (part && typeof part.text === 'string') {
                return { type: 'text', text: part.text };
            }

            if (part && part.inlineData && part.inlineData.data) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                return {
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${part.inlineData.data}`
                    }
                };
            }

            return {
                type: 'text',
                text: JSON.stringify(part)
            };
        });
    }

    normalizeOpenRouterText(content) {
        if (typeof content === 'string') {
            return content;
        }

        if (Array.isArray(content)) {
            return content
                .map((item) => {
                    if (typeof item === 'string') {
                        return item;
                    }

                    if (item && typeof item.text === 'string') {
                        return item.text;
                    }

                    return '';
                })
                .filter(Boolean)
                .join('\n');
        }

        return '';
    }

    async executeOpenRouterRequest(request) {
        if (!this.openRouterApiKey) {
            throw new Error('OpenRouter fallback unavailable: OPENROUTER_API_KEY is missing');
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://lensbuddyai.local',
                'X-Title': 'Lens Buddy AI'
            },
            body: JSON.stringify({
                model: this.openRouterModel,
                messages: [
                    {
                        role: 'user',
                        content: this.getOpenRouterMessageContent(request)
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter ${response.status}: ${errorText}`);
        }

        const payload = await response.json();
        const messageContent = payload?.choices?.[0]?.message?.content;
        const text = this.normalizeOpenRouterText(messageContent);

        if (!text) {
            throw new Error('OpenRouter returned an empty response');
        }

        return text;
    }

    async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            console.log(`Rate limit: waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    // ========================================================================
    // REQUEST QUEUE PROCESSING
    // ========================================================================

    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift();

            try {
                await this.waitForRateLimit();
                const result = await this._executeRequest(request);
                request.resolve(result);
            } catch (error) {
                request.reject(error);
            }
        }

        this.isProcessing = false;
    }

    async _executeRequest(request, retryCount = 0) {
        if (this.usingOpenRouterFallback) {
            return this.executeOpenRouterRequest(request);
        }

        const activeDescriptor = this.getActiveModelDescriptor();
        if (!activeDescriptor) {
            throw new Error('No Gemini model available for request');
        }

        try {
            this.checkAndResetDailyLimit();

            // Check daily token limit
            const estimatedTokens = this.estimateTokens(JSON.stringify(request.data));
            if (this.dailyTokenCount + estimatedTokens > this.maxDailyTokens) {
                throw new Error('Daily token limit reached');
            }

            // Execute request based on type
            let result;
            if (request.type === 'text') {
                result = await activeDescriptor.model.generateContent(request.data);
            } else if (request.type === 'multimodal') {
                result = await activeDescriptor.model.generateContent(request.data);
            }

            // Update token count
            this.dailyTokenCount += estimatedTokens;

            return result.response.text();

        } catch (error) {
            console.error(`Request error on ${activeDescriptor.name} (attempt ${retryCount + 1}):`, error.message);

            if (this.isRateLimitError(error)) {
                const fallbackDescriptor = this.getFallbackModelDescriptor(
                    activeDescriptor.providerIndex,
                    activeDescriptor.modelIndex
                );
                if (fallbackDescriptor) {
                    console.warn(
                        `Switching Gemini model from ${activeDescriptor.providerLabel}/${activeDescriptor.name} ` +
                        `to ${fallbackDescriptor.providerLabel}/${fallbackDescriptor.name} after quota/rate-limit error`
                    );
                    this.activeProviderIndex = fallbackDescriptor.providerIndex;
                    this.activeModelIndex = fallbackDescriptor.modelIndex;
                    this.syncActiveModelState();
                    return await this._executeRequest(request, retryCount);
                }

                if (this.openRouterApiKey) {
                    console.warn(`Gemini quota exhausted. Switching to OpenRouter fallback model ${this.openRouterModel}`);
                    this.usingOpenRouterFallback = true;
                    return await this.executeOpenRouterRequest(request);
                }
            }

            // Retry logic for rate limit or server errors
            if (retryCount < this.maxRetries) {
                const isRetryable =
                    this.isRateLimitError(error) ||
                    error.message.includes('500') ||
                    error.message.includes('503') ||
                    error.message.includes('RATE_LIMIT');

                if (isRetryable) {
                    const backoffTime = Math.pow(2, retryCount) * 2000; // Exponential backoff
                    console.log(`Retrying in ${backoffTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                    return await this._executeRequest(request, retryCount + 1);
                }
            }

            throw error;
        }
    }

    // ========================================================================
    // CONVERSATION HISTORY MANAGEMENT
    // ========================================================================

    addToHistory(role, content) {
        this.conversationHistory.push({ role, content });

        // Keep only recent history to avoid token overflow
        if (this.conversationHistory.length > this.maxHistoryLength) {
            this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
        }
    }

    clearHistory() {
        this.conversationHistory = [];
    }

    getContextString() {
        return this.conversationHistory
            .map(entry => `${entry.role}: ${entry.content}`)
            .join('\n\n');
    }

    // ========================================================================
    // BASE REQUEST METHODS
    // ========================================================================

    async generateText(prompt, options = {}) {
        return new Promise((resolve, reject) => {
            const request = {
                type: 'text',
                data: prompt,
                resolve,
                reject
            };

            this.requestQueue.push(request);
            this.processQueue();
        });
    }

    async generateMultimodal(parts, options = {}) {
        return new Promise((resolve, reject) => {
            const request = {
                type: 'multimodal',
                data: parts,
                resolve,
                reject
            };

            this.requestQueue.push(request);
            this.processQueue();
        });
    }

    // ========================================================================
    // PUBLIC API METHODS
    // ========================================================================

    /**
     * Analyze screenshot with context
     * @param {string} imageBase64 - Base64 encoded image
     * @param {string} additionalContext - Additional context to provide
     * @returns {Promise<string>} - AI analysis result
     */
    async analyzeScreenshot(imageBase64, additionalContext = '') {
        const contextString = this.getContextString();
        const prompt = PROMPTS.SCREENSHOT_ANALYSIS(contextString, additionalContext);

        const parts = [
            { text: prompt },
            {
                inlineData: {
                    mimeType: 'image/png',
                    data: imageBase64
                }
            }
        ];

        const result = await this.generateMultimodal(parts);
        this.addToHistory('assistant', `Screenshot analysis: ${result}`);
        return result;
    }

    /**
     * Suggest responses based on current context
     * @param {string} context - Current situation description
     * @returns {Promise<string>} - Suggested responses
     */
    async suggestResponse(context) {
        const contextString = this.getContextString();
        const prompt = PROMPTS.SUGGEST_RESPONSE(contextString, context);
        const result = await this.generateText(prompt);
        return result;
    }

    /**
     * Generate meeting notes from conversation history
     * @returns {Promise<string>} - Formatted meeting notes
     */
    async generateMeetingNotes() {
        if (this.conversationHistory.length === 0) {
            return 'No conversation history to summarize.';
        }

        const contextString = this.getContextString();
        const prompt = PROMPTS.MEETING_NOTES(contextString);
        const result = await this.generateText(prompt);
        return result;
    }

    /**
     * Generate a professional follow-up email
     * @returns {Promise<string>} - Follow-up email content
     */
    async generateFollowUpEmail() {
        if (this.conversationHistory.length === 0) {
            return 'No conversation history to create email from.';
        }

        const contextString = this.getContextString();
        const prompt = PROMPTS.FOLLOW_UP_EMAIL(contextString);
        const result = await this.generateText(prompt);
        return result;
    }

    /**
     * Answer a specific question with context
     * @param {string} question - The question to answer
     * @returns {Promise<string>} - Answer to the question
     */
    async answerQuestion(question) {
        const contextString = this.getContextString();
        const prompt = PROMPTS.ANSWER_QUESTION(contextString, question);

        const result = await this.generateText(prompt);
        this.addToHistory('user', question);
        this.addToHistory('assistant', result);
        return result;
    }

    /**
     * Get conversation insights and analysis
     * @returns {Promise<string>} - Insights and analysis
     */
    async getConversationInsights() {
        if (this.conversationHistory.length === 0) {
            return 'Not enough conversation data for insights.';
        }

        const contextString = this.getContextString();
        const prompt = PROMPTS.INSIGHTS(contextString);
        const result = await this.generateText(prompt);
        return result;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = GeminiService;
