import { Readable, Writable } from 'stream';

interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

interface JSONRPCRequest {
    jsonrpc: string;
    id: number | string | null;
    method: string;
    params?: Record<string, unknown>;
}

interface JSONRPCResponse {
    jsonrpc: '2.0';
    id: number | string | null;
    result?: unknown;
    error?: { code: number; message: string };
}

/**
 * Stdio MCP transport — reads JSON-RPC from stdin, writes responses to stdout.
 * Shares the same tool definitions and handlers as the HTTP server.
 */
export class StdioMCPTransport {
    private tools: Map<string, MCPToolDefinition>;
    private handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>;
    private buffer = '';
    private running = false;

    constructor(
        tools: Map<string, MCPToolDefinition>,
        handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>,
        private input: Readable = process.stdin,
        private output: Writable = process.stdout,
    ) {
        this.tools = tools;
        this.handlers = handlers;
    }

    start(): void {
        this.running = true;
        this.input.setEncoding('utf8');
        this.input.on('data', (chunk: string) => {
            this.buffer += chunk;
            this.processBuffer();
        });
        this.input.on('end', () => {
            this.running = false;
        });
    }

    stop(): void {
        this.running = false;
    }

    private processBuffer(): void {
        // JSON-RPC messages are newline-delimited
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const request = JSON.parse(trimmed) as JSONRPCRequest;
                this.handleRequest(request).then(response => {
                    if (response) {
                        this.send(response);
                    }
                });
            } catch {
                this.send({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' },
                });
            }
        }
    }

    private async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse | null> {
        if (request.jsonrpc !== '2.0') {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' },
            };
        }

        switch (request.method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: { name: 'coe-mcp-server', version: '1.0.0' },
                    },
                };

            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: Array.from(this.tools.values()).map(t => ({
                            name: t.name,
                            description: t.description,
                            inputSchema: t.inputSchema,
                        })),
                    },
                };

            case 'tools/call': {
                const toolName = request.params?.name as string;
                const toolArgs = (request.params?.arguments as Record<string, unknown>) || {};
                const handler = this.handlers.get(toolName);

                if (!handler) {
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: { code: -32602, message: `Tool not found: ${toolName}` },
                    };
                }

                try {
                    const result = await handler(toolArgs);
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        result: {
                            content: [{ type: 'text', text: JSON.stringify(result) }],
                        },
                    };
                } catch (err) {
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: {
                            code: -32603,
                            message: err instanceof Error ? err.message : String(err),
                        },
                    };
                }
            }

            case 'notifications/initialized':
                // Notification — no response needed
                return null;

            default:
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: { code: -32601, message: `Method not found: ${request.method}` },
                };
        }
    }

    private send(response: JSONRPCResponse): void {
        try {
            this.output.write(JSON.stringify(response) + '\n');
        } catch {
            // Output stream may be closed
        }
    }
}
