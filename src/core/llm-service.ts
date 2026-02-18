import * as vscode from 'vscode';
import { LLMConfig, LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk } from '../types';

/** v6.0: Request priority — boss requests get a reserved LLM slot */
type LLMPriority = 'boss' | 'normal';

interface QueuedRequest {
    request: LLMRequest;
    priority: LLMPriority;
    resolve: (value: LLMResponse) => void;
    reject: (reason: Error) => void;
    retryCount: number;
}

interface CacheEntry {
    response: LLMResponse;
    timestamp: number;
}

export class LLMService {
    private queue: QueuedRequest[] = [];
    /** v6.0: Number of currently active concurrent requests (replaces boolean `processing`) */
    private activeRequests = 0;
    /** v6.0: Max concurrent requests (LM Studio thread limit). Default: 4. */
    private maxConcurrent: number;
    /** v6.0: Slots reserved for Boss AI priority requests. Default: 1. */
    private bossReservedSlots: number;
    /** v6.0: Max retries per failed request. Default: 5. */
    private maxRetries: number;
    private maxQueueSize = 20; // v6.0: increased from 5 (4 concurrent × 5 pending each)

    // Response cache: keyed by hash of messages+options, 5-min TTL, max 100 entries
    private cache = new Map<string, CacheEntry>();
    private readonly cacheTTLMs = 5 * 60 * 1000;
    private readonly cacheMaxSize = 100;

    // Health monitoring
    private lastHealthCheck: { healthy: boolean; timestamp: number } | null = null;
    private readonly healthCheckCooldownMs = 60_000;

    constructor(
        private config: LLMConfig,
        private outputChannel: vscode.OutputChannel
    ) {
        this.maxConcurrent = config.maxConcurrentRequests ?? 4;
        this.bossReservedSlots = config.bossReservedSlots ?? 1;
        this.maxRetries = config.maxRequestRetries ?? 5;
    }

    updateConfig(config: LLMConfig): void {
        this.config = config;
        this.maxConcurrent = config.maxConcurrentRequests ?? 4;
        this.bossReservedSlots = config.bossReservedSlots ?? 1;
        this.maxRetries = config.maxRequestRetries ?? 5;
    }

    async chat(messages: LLMMessage[], options?: { maxTokens?: number; temperature?: number; stream?: boolean; priority?: LLMPriority; model?: string }): Promise<LLMResponse> {
        // Check cache first (only for non-streaming, deterministic requests)
        const cacheKey = this.computeCacheKey(messages, options);
        const cached = this.getCachedResponse(cacheKey);
        if (cached) {
            this.outputChannel.appendLine('LLM cache hit');
            return cached;
        }

        // Enforce input token limit — truncate messages if prompt is too large
        const maxInputTokens = this.config.maxInputTokens ?? 4000;
        const truncatedMessages = this.enforceInputTokenLimit(messages, maxInputTokens);

        const request: LLMRequest = {
            messages: truncatedMessages,
            max_tokens: options?.maxTokens ?? this.config.maxTokens,
            temperature: options?.temperature ?? 0.7,
            stream: options?.stream ?? true,
            model: options?.model,
        };

        const priority: LLMPriority = options?.priority ?? 'normal';

        return new Promise<LLMResponse>((resolve, reject) => {
            if (this.queue.length >= this.maxQueueSize) {
                reject(new Error(`LLM queue full (${this.maxQueueSize} requests pending). Try again later.`));
                return;
            }
            this.queue.push({
                request,
                priority,
                retryCount: 0,
                resolve: (response) => {
                    // Cache the response for non-streaming requests with low temperature
                    if (!request.stream && (request.temperature ?? 0.7) <= 0.3) {
                        this.setCachedResponse(cacheKey, response);
                    }
                    resolve(response);
                },
                reject,
            });
            this.processQueue();
        });
    }

    async classify(message: string, categories: string[]): Promise<string> {
        const systemPrompt = `You are a classifier. Given a message, classify it into exactly one of these categories: ${categories.join(', ')}. Respond with ONLY the category name, nothing else.`;
        const response = await this.chat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
        ], { maxTokens: 50, temperature: 0.1, stream: false });

        const result = response.content.trim().toLowerCase();
        const match = categories.find(c => result.includes(c.toLowerCase()));
        return match || categories[0];
    }

    async score(content: string, criteria: string): Promise<number> {
        const systemPrompt = `You are a scoring agent. Score the following content on a scale of 0-100 based on the criteria. Respond with ONLY a number between 0 and 100.`;
        const response = await this.chat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Criteria: ${criteria}\n\nContent: ${content}` }
        ], { maxTokens: 10, temperature: 0.1, stream: false });

        const score = parseInt(response.content.trim(), 10);
        return isNaN(score) ? 50 : Math.max(0, Math.min(100, score));
    }

    getQueueLength(): number {
        return this.queue.length;
    }

    isProcessing(): boolean {
        return this.activeRequests > 0;
    }

    /** v6.0: Number of currently active LLM requests */
    getActiveRequests(): number {
        return this.activeRequests;
    }

    /** v6.0: Number of available slots (total minus active) */
    getAvailableSlots(): number {
        return Math.max(0, this.maxConcurrent - this.activeRequests);
    }

    /** v6.0: Number of available slots for normal (non-boss) requests */
    getAvailableNormalSlots(): number {
        return Math.max(0, this.maxConcurrent - this.bossReservedSlots - this.activeRequests);
    }

    /**
     * v6.0: Concurrent queue processor — replaces the old serial loop.
     *
     * Fills available LLM slots with queued requests. Boss-priority requests
     * can use the reserved slot; normal requests cannot.
     *
     * Called after every enqueue and after every request completion.
     */
    private processQueue(): void {
        if (this.queue.length === 0) return;

        // Fill as many slots as possible
        while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
            // Calculate available slots for normal requests
            const normalSlotsUsed = this.activeRequests; // simplification: we don't track boss vs normal active
            const normalSlotsAvailable = this.maxConcurrent - this.bossReservedSlots - normalSlotsUsed;
            const totalSlotsAvailable = this.maxConcurrent - this.activeRequests;

            // Find the next request to dequeue
            let itemIdx = -1;

            if (totalSlotsAvailable > 0 && normalSlotsAvailable <= 0) {
                // Only reserved slots available — only boss-priority requests can go
                itemIdx = this.queue.findIndex(q => q.priority === 'boss');
            } else if (totalSlotsAvailable > 0) {
                // Normal slots available — any request can go (boss first, then FIFO)
                const bossIdx = this.queue.findIndex(q => q.priority === 'boss');
                itemIdx = bossIdx >= 0 ? bossIdx : 0;
            }

            if (itemIdx < 0) break; // No eligible request found

            // Dequeue the selected item
            const [item] = this.queue.splice(itemIdx, 1);
            this.activeRequests++;

            // Fire-and-forget: execute concurrently (don't await)
            this.executeWithRetry(item).then(
                (response) => {
                    this.activeRequests--;
                    item.resolve(response);
                    // Try to fill the freed slot
                    this.processQueue();
                },
                (error) => {
                    this.activeRequests--;
                    item.reject(error instanceof Error ? error : new Error(String(error)));
                    // Try to fill the freed slot
                    this.processQueue();
                }
            );
        }
    }

    /**
     * v6.0: Execute a request with retry logic (up to maxRetries attempts).
     */
    private async executeWithRetry(item: QueuedRequest): Promise<LLMResponse> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const response = item.request.stream
                    ? await this.executeStreaming(item.request)
                    : await this.executeNonStreaming(item.request);
                return response;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Don't retry on certain errors
                const errMsg = lastError.message.toLowerCase();
                if (errMsg.includes('queue full') || errMsg.includes('abort')) {
                    throw lastError;
                }

                if (attempt < this.maxRetries) {
                    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
                    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
                    this.outputChannel.appendLine(
                        `[LLMService] Request failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message.substring(0, 100)}`
                    );
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError ?? new Error('LLM request failed after all retries');
    }

    private async executeStreaming(request: LLMRequest): Promise<LLMResponse> {
        const controller = new AbortController();
        const url = `${this.config.endpoint}/chat/completions`;

        // Startup timeout: waiting for the first token
        const startupTimer = setTimeout(() => {
            controller.abort();
        }, this.config.startupTimeoutSeconds * 1000);

        // Total wall-clock timeout (very generous for local LLMs)
        const totalTimer = setTimeout(() => {
            controller.abort();
        }, this.config.timeoutSeconds * 1000);

        let firstTokenReceived = false;
        let fullContent = '';
        let tokensUsed = 0;
        let finishReason = 'stop';

        // Liveness check: every 60s, check if new tokens arrived since last check.
        // Only abort if ZERO tokens were generated in the check interval.
        // This tolerates slow generation (e.g. 1 token/10s) but catches true stalls.
        let lastCheckTokenCount = 0;
        let abortReason = '';
        const livenessInterval = setInterval(() => {
            if (!firstTokenReceived) return; // startup timer handles pre-first-token
            if (tokensUsed === lastCheckTokenCount) {
                // No new tokens in the last 60 seconds — stream is truly stalled
                abortReason = 'stall';
                controller.abort();
            } else {
                this.outputChannel.appendLine(`LLM liveness: ${tokensUsed - lastCheckTokenCount} new tokens (${tokensUsed} total)`);
                lastCheckTokenCount = tokensUsed;
            }
        }, 60_000);

        try {
            const body = JSON.stringify({
                model: request.model ?? this.config.model,
                messages: request.messages,
                max_tokens: request.max_tokens,
                temperature: request.temperature,
                stream: true,
            });

            this.outputChannel.appendLine(`LLM request: ${request.messages.length} messages, stream=true`);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('No response body for streaming request');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // First token received — clear startup timer
                if (!firstTokenReceived) {
                    firstTokenReceived = true;
                    clearTimeout(startupTimer);
                    this.outputChannel.appendLine('LLM: first token received');
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') {
                        finishReason = 'stop';
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullContent += delta;
                            tokensUsed++;
                        }
                        if (parsed.choices?.[0]?.finish_reason) {
                            finishReason = parsed.choices[0].finish_reason;
                        }
                    } catch {
                        // Skip malformed chunks
                    }
                }
            }

            this.outputChannel.appendLine(`LLM response: ${tokensUsed} tokens, finish=${finishReason}`);

            // Output overflow warning (not error) for streaming responses
            if (finishReason === 'length') {
                this.outputChannel.appendLine(
                    `[LLMService] WARNING: Output truncated (finish_reason=length). ` +
                    `Response was ${fullContent.length} chars. Agent may need to resume or rephrase.`
                );
            }

            return {
                content: fullContent,
                tokens_used: tokensUsed,
                model: this.config.model,
                finish_reason: finishReason,
            };

        } catch (error) {
            const errStr = String(error);
            const errName = (error as any)?.name || '';
            const errMsg = (error as any)?.message || '';
            const isAbort = errName === 'AbortError' ||
                errMsg.includes('aborted') || errMsg.includes('abort') ||
                errStr.includes('AbortError') || errStr.includes('aborted');
            if (isAbort) {
                if (!firstTokenReceived) {
                    throw new Error(`LLM startup timeout: No response within ${this.config.startupTimeoutSeconds}s`);
                } else if (abortReason === 'stall') {
                    throw new Error(`LLM stream stalled: No new tokens for 60s. Got ${tokensUsed} tokens before stall.`);
                } else {
                    // If we got content, return it as a partial response instead of throwing
                    if (fullContent.length > 0) {
                        this.outputChannel.appendLine(`LLM total timeout reached with ${tokensUsed} tokens — returning partial response`);
                        return {
                            content: fullContent,
                            tokens_used: tokensUsed,
                            model: this.config.model,
                            finish_reason: 'timeout',
                        };
                    }
                    throw new Error(`LLM total timeout exceeded (${this.config.timeoutSeconds}s). Got ${tokensUsed} tokens.`);
                }
            }
            throw error;
        } finally {
            clearTimeout(startupTimer);
            clearTimeout(totalTimer);
            clearInterval(livenessInterval);
        }
    }

    private async executeNonStreaming(request: LLMRequest): Promise<LLMResponse> {
        const controller = new AbortController();
        const url = `${this.config.endpoint}/chat/completions`;

        const timer = setTimeout(() => {
            controller.abort();
        }, this.config.timeoutSeconds * 1000);

        try {
            const body = JSON.stringify({
                model: request.model ?? this.config.model,
                messages: request.messages,
                max_tokens: request.max_tokens,
                temperature: request.temperature,
                stream: false,
            });

            this.outputChannel.appendLine(`LLM request: ${request.messages.length} messages, stream=false`);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as {
                choices: Array<{ message: { content: string }; finish_reason: string }>;
                usage?: { total_tokens: number };
            };

            const content = data.choices?.[0]?.message?.content || '';
            const tokensUsed = data.usage?.total_tokens ?? 0;
            const finishReason = data.choices?.[0]?.finish_reason || 'stop';

            this.outputChannel.appendLine(`LLM response: ${tokensUsed} tokens, finish=${finishReason}`);

            // Output overflow warning (not error) — the agent may need to resume
            if (finishReason === 'length') {
                this.outputChannel.appendLine(
                    `[LLMService] WARNING: Output truncated (finish_reason=length). ` +
                    `Response was ${content.length} chars. Agent may need to resume or rephrase.`
                );
            }

            return {
                content,
                tokens_used: tokensUsed,
                model: this.config.model,
                finish_reason: finishReason,
            };

        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`LLM timeout: No response within ${this.config.timeoutSeconds}s`);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    async testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }> {
        const start = Date.now();
        try {
            const response = await fetch(`${this.config.endpoint}/models`, {
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) {
                return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
            }
            const data = await response.json() as { data?: Array<{ id: string }> };
            const models = data.data?.map(m => m.id) || [];
            const latencyMs = Date.now() - start;
            return {
                success: true,
                message: `Connected. ${models.length} models available. Latency: ${latencyMs}ms`,
                latencyMs,
            };
        } catch (error) {
            return {
                success: false,
                message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * v6.0: Fetch model capabilities from LM Studio's /v1/models endpoint.
     *
     * LM Studio returns model info including:
     *   - id: model identifier (e.g. "mistralai/ministral-3-14b-reasoning")
     *   - max_context_length: context window size in tokens (e.g. 32768)
     *   - state: "loaded" | "not-loaded"
     *   - type: "llm" | "vlm" | "embeddings"
     *   - arch, publisher, quantization, etc.
     *
     * This eliminates the need to manually configure contextWindowTokens and
     * maxOutputTokens in the config file — the model itself tells us its limits.
     *
     * Returns info for the currently configured model, or null if unavailable.
     */
    async fetchModelInfo(): Promise<{
        id: string;
        maxContextLength: number;
        state: string;
        type: string;
        arch: string;
        publisher: string;
        quantization: string;
    } | null> {
        try {
            const response = await fetch(`${this.config.endpoint}/models`, {
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) {
                this.outputChannel.appendLine(
                    `[LLMService] fetchModelInfo: HTTP ${response.status} from /models`
                );
                return null;
            }

            const data = await response.json() as {
                data?: Array<{
                    id: string;
                    max_context_length?: number;
                    state?: string;
                    type?: string;
                    arch?: string;
                    publisher?: string;
                    quantization?: string;
                }>;
            };

            if (!data.data || data.data.length === 0) {
                this.outputChannel.appendLine('[LLMService] fetchModelInfo: no models returned');
                return null;
            }

            // Find the model matching our configured model ID
            const configModel = this.config.model;
            let match = data.data.find(m => m.id === configModel);

            // If exact match fails, try partial match (LM Studio sometimes uses different ID formats)
            if (!match) {
                match = data.data.find(m =>
                    m.id.includes(configModel) || configModel.includes(m.id)
                );
            }

            // If still no match, use the first loaded model (or first model if none loaded)
            if (!match) {
                match = data.data.find(m => m.state === 'loaded') || data.data[0];
            }

            if (!match) return null;

            const result = {
                id: match.id,
                maxContextLength: match.max_context_length ?? 0,
                state: match.state ?? 'unknown',
                type: match.type ?? 'llm',
                arch: match.arch ?? 'unknown',
                publisher: match.publisher ?? 'unknown',
                quantization: match.quantization ?? 'unknown',
            };

            this.outputChannel.appendLine(
                `[LLMService] Model detected: ${result.id} (context: ${result.maxContextLength} tokens, state: ${result.state}, type: ${result.type})`
            );

            return result;
        } catch (error) {
            this.outputChannel.appendLine(
                `[LLMService] fetchModelInfo failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    }

    // ==================== BATCH CLASSIFICATION ====================

    async batchClassify(messages: string[], categories: string[]): Promise<string[]> {
        const systemPrompt = `You are a batch classifier. For each numbered message below, classify it into exactly one of these categories: ${categories.join(', ')}. Respond with ONLY the category names, one per line, in the same order as the messages. No numbering, no explanation.`;

        const numberedMessages = messages.map((m, i) => `${i + 1}. ${m}`).join('\n');

        try {
            const response = await this.chat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: numberedMessages }
            ], { maxTokens: messages.length * 20, temperature: 0.1, stream: false });

            const results = response.content.trim().split('\n').map(line => {
                const cleaned = line.trim().toLowerCase().replace(/^\d+\.\s*/, '');
                return categories.find(c => cleaned.includes(c.toLowerCase())) || categories[0];
            });

            // Pad or trim to match input length
            while (results.length < messages.length) results.push(categories[0]);
            return results.slice(0, messages.length);
        } catch {
            // Fallback: classify individually
            this.outputChannel.appendLine('Batch classification failed, falling back to individual calls');
            const results: string[] = [];
            for (const msg of messages) {
                try {
                    results.push(await this.classify(msg, categories));
                } catch {
                    results.push(categories[0]);
                }
            }
            return results;
        }
    }

    // ==================== HEALTH MONITORING ====================

    async healthCheck(): Promise<boolean> {
        // Rate-limit: max 1 call per 60 seconds
        if (this.lastHealthCheck &&
            Date.now() - this.lastHealthCheck.timestamp < this.healthCheckCooldownMs) {
            return this.lastHealthCheck.healthy;
        }

        try {
            const result = await this.testConnection();
            this.lastHealthCheck = { healthy: result.success, timestamp: Date.now() };
            this.lastHealthReason = result.success ? undefined : this.classifyHealthReason(result.message);
            return result.success;
        } catch {
            this.lastHealthCheck = { healthy: false, timestamp: Date.now() };
            this.lastHealthReason = 'unknown';
            return false;
        }
    }

    isHealthy(): boolean {
        return this.lastHealthCheck?.healthy ?? true; // optimistic default
    }

    /**
     * v4.1 (Bug 6D): Returns structured health status with reason.
     * Callers can distinguish between LM Studio down, overloaded, or model error.
     */
    getHealthStatus(): { healthy: boolean; reason?: 'connection_refused' | 'timeout' | 'model_error' | 'unknown' } {
        return {
            healthy: this.lastHealthCheck?.healthy ?? true,
            reason: this.lastHealthReason,
        };
    }

    private lastHealthReason?: 'connection_refused' | 'timeout' | 'model_error' | 'unknown';

    private classifyHealthReason(message: string): 'connection_refused' | 'timeout' | 'model_error' | 'unknown' {
        const lower = message.toLowerCase();
        if (lower.includes('econnrefused') || lower.includes('connection refused') || lower.includes('fetch failed')) {
            return 'connection_refused';
        }
        if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('aborterror')) {
            return 'timeout';
        }
        if (lower.includes('model') || lower.includes('404') || lower.includes('500')) {
            return 'model_error';
        }
        return 'unknown';
    }

    // ==================== CACHE ====================

    /**
     * Enforce input token limit by truncating messages if they exceed the max.
     * Uses rough estimation: ~4 chars per token (English average).
     *
     * Strategy:
     *   1. System message is preserved (never truncated)
     *   2. Most recent user message is preserved
     *   3. Middle messages are trimmed from oldest-first
     *   4. If still over limit, the user message content is truncated
     *
     * This ensures the agent always sees the system prompt and latest request,
     * while older conversation context is dropped to fit the limit.
     */
    private enforceInputTokenLimit(messages: LLMMessage[], maxTokens: number): LLMMessage[] {
        const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
        const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

        if (totalTokens <= maxTokens) return messages;

        this.outputChannel.appendLine(
            `[LLMService] WARNING: Input prompt ~${totalTokens} tokens exceeds limit of ${maxTokens}. Truncating.`
        );

        // Separate system message (always keep), last user message (always keep), and middle messages
        const systemMsg = messages.find(m => m.role === 'system');
        const lastUserIdx = messages.length - 1;
        const lastMsg = messages[lastUserIdx];
        const middleMessages = messages.filter((m, i) => m !== systemMsg && i !== lastUserIdx);

        const result: LLMMessage[] = [];
        let usedTokens = 0;

        // Always include system message
        if (systemMsg) {
            usedTokens += estimateTokens(systemMsg.content);
            result.push(systemMsg);
        }

        // Reserve space for last message (at least 500 tokens)
        const reserveForLast = Math.min(estimateTokens(lastMsg.content), maxTokens - usedTokens);
        const budgetForMiddle = maxTokens - usedTokens - reserveForLast;

        // Add middle messages newest-first (reverse order), keep as many as fit
        let middleTokens = 0;
        const keptMiddle: LLMMessage[] = [];
        for (let i = middleMessages.length - 1; i >= 0; i--) {
            const msgTokens = estimateTokens(middleMessages[i].content);
            if (middleTokens + msgTokens <= budgetForMiddle) {
                keptMiddle.unshift(middleMessages[i]);
                middleTokens += msgTokens;
            }
        }
        result.push(...keptMiddle);

        // Add last message — truncate if needed
        const remainingBudget = maxTokens - usedTokens - middleTokens;
        const lastTokens = estimateTokens(lastMsg.content);
        if (lastTokens <= remainingBudget) {
            result.push(lastMsg);
        } else {
            const maxChars = remainingBudget * 4;
            this.outputChannel.appendLine(
                `[LLMService] WARNING: Truncating last message from ${lastMsg.content.length} to ${maxChars} chars`
            );
            result.push({ ...lastMsg, content: lastMsg.content.substring(0, maxChars) + '\n\n[Content truncated to fit input token limit]' });
        }

        return result;
    }

    private computeCacheKey(messages: LLMMessage[], options?: Record<string, unknown>): string {
        const payload = JSON.stringify({ messages, options });
        // Simple hash: sum of char codes mod a large prime
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
        }
        return `llm_cache_${hash}`;
    }

    private getCachedResponse(key: string): LLMResponse | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.cacheTTLMs) {
            this.cache.delete(key);
            return null;
        }
        return entry.response;
    }

    private setCachedResponse(key: string, response: LLMResponse): void {
        // Evict oldest entries if cache is full
        if (this.cache.size >= this.cacheMaxSize) {
            let oldestKey = '';
            let oldestTime = Infinity;
            for (const [k, v] of this.cache) {
                if (v.timestamp < oldestTime) {
                    oldestTime = v.timestamp;
                    oldestKey = k;
                }
            }
            if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, { response, timestamp: Date.now() });
    }

    clearCache(): void {
        this.cache.clear();
    }
}
