import * as vscode from 'vscode';
import { LLMConfig, LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk } from '../types';

interface QueuedRequest {
    request: LLMRequest;
    resolve: (value: LLMResponse) => void;
    reject: (reason: Error) => void;
}

export class LLMService {
    private queue: QueuedRequest[] = [];
    private processing = false;
    private maxQueueSize = 5;

    constructor(
        private config: LLMConfig,
        private outputChannel: vscode.OutputChannel
    ) {}

    updateConfig(config: LLMConfig): void {
        this.config = config;
    }

    async chat(messages: LLMMessage[], options?: { maxTokens?: number; temperature?: number; stream?: boolean }): Promise<LLMResponse> {
        const request: LLMRequest = {
            messages,
            max_tokens: options?.maxTokens ?? this.config.maxTokens,
            temperature: options?.temperature ?? 0.7,
            stream: options?.stream ?? true,
        };

        return new Promise<LLMResponse>((resolve, reject) => {
            if (this.queue.length >= this.maxQueueSize) {
                reject(new Error(`LLM queue full (${this.maxQueueSize} requests pending). Try again later.`));
                return;
            }
            this.queue.push({ request, resolve, reject });
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
        return this.processing;
    }

    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift()!;
            try {
                const response = item.request.stream
                    ? await this.executeStreaming(item.request)
                    : await this.executeNonStreaming(item.request);
                item.resolve(response);
            } catch (error) {
                item.reject(error instanceof Error ? error : new Error(String(error)));
            }
        }

        this.processing = false;
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
                model: this.config.model,
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
                model: this.config.model,
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
            const tokensUsed = data.usage?.total_tokens || 0;
            const finishReason = data.choices?.[0]?.finish_reason || 'stop';

            this.outputChannel.appendLine(`LLM response: ${tokensUsed} tokens, finish=${finishReason}`);
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
}
