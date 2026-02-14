import { EventBus, COEEvent, WebSocketClient, resetEventBus, getEventBus } from '../src/core/event-bus';

describe('EventBus', () => {
    let bus: EventBus;

    beforeEach(() => {
        bus = new EventBus(100);
    });

    afterEach(() => {
        bus.removeAllListeners();
        resetEventBus();
    });

    // ==================== EMIT & LISTEN ====================

    test('emit delivers event to typed listener', (done) => {
        bus.on('task:created', (event) => {
            expect(event.type).toBe('task:created');
            expect(event.source).toBe('test');
            expect(event.data.taskId).toBe('t1');
            expect(event.timestamp).toBeDefined();
            done();
        });
        bus.emit('task:created', 'test', { taskId: 't1' });
    });

    test('emit delivers to multiple listeners', () => {
        let count = 0;
        bus.on('plan:created', () => { count++; });
        bus.on('plan:created', () => { count++; });
        bus.emit('plan:created', 'test', {});
        expect(count).toBe(2);
    });

    test('wildcard listener receives all events', () => {
        const received: string[] = [];
        bus.on('*', (event) => { received.push(event.type); });
        bus.emit('task:created', 'test', {});
        bus.emit('plan:activated', 'test', {});
        bus.emit('agent:started', 'test', {});
        expect(received).toEqual(['task:created', 'plan:activated', 'agent:started']);
    });

    test('once listener fires only once', () => {
        let count = 0;
        bus.once('task:completed', () => { count++; });
        bus.emit('task:completed', 'test', {});
        bus.emit('task:completed', 'test', {});
        expect(count).toBe(1);
    });

    test('off removes a listener', () => {
        let count = 0;
        const handler = () => { count++; };
        bus.on('task:created', handler);
        bus.emit('task:created', 'test', {});
        bus.off('task:created', handler);
        bus.emit('task:created', 'test', {});
        expect(count).toBe(1);
    });

    // ==================== HISTORY ====================

    test('getHistory returns recent events', () => {
        bus.emit('task:created', 'test', { id: '1' });
        bus.emit('task:updated', 'test', { id: '2' });
        bus.emit('task:completed', 'test', { id: '3' });
        const history = bus.getHistory(10);
        expect(history).toHaveLength(3);
        expect(history[0].type).toBe('task:created');
        expect(history[2].type).toBe('task:completed');
    });

    test('getHistory respects limit', () => {
        for (let i = 0; i < 20; i++) {
            bus.emit('task:created', 'test', { i });
        }
        expect(bus.getHistory(5)).toHaveLength(5);
    });

    test('getHistory filters by type', () => {
        bus.emit('task:created', 'test', {});
        bus.emit('plan:created', 'test', {});
        bus.emit('task:updated', 'test', {});
        const filtered = bus.getHistory(50, 'task:created');
        expect(filtered).toHaveLength(1);
        expect(filtered[0].type).toBe('task:created');
    });

    test('history circular buffer evicts oldest', () => {
        const smallBus = new EventBus(5);
        for (let i = 0; i < 10; i++) {
            smallBus.emit('task:created', 'test', { i });
        }
        const history = smallBus.getHistory(10);
        expect(history).toHaveLength(5);
        expect(history[0].data.i).toBe(5); // oldest kept is index 5
    });

    // ==================== METRICS ====================

    test('getMetrics tracks emit counts', () => {
        bus.emit('task:created', 'test', {});
        bus.emit('task:created', 'test', {});
        bus.emit('plan:created', 'test', {});
        const metrics = bus.getMetrics();
        expect(metrics.totalEmitted).toBe(3);
        expect(metrics.byType['task:created']).toBe(2);
        expect(metrics.byType['plan:created']).toBe(1);
        expect(metrics.lastEvent).toBeDefined();
        expect(metrics.lastEvent!.type).toBe('plan:created');
    });

    test('resetMetrics clears all counts', () => {
        bus.emit('task:created', 'test', {});
        bus.resetMetrics();
        const metrics = bus.getMetrics();
        expect(metrics.totalEmitted).toBe(0);
        expect(metrics.lastEvent).toBeNull();
    });

    // ==================== WEBSOCKET BROADCAST ====================

    test('WebSocket clients receive broadcast', () => {
        const messages: string[] = [];
        const client: WebSocketClient = {
            readyState: 'open',
            send: (data) => { messages.push(data); }
        };
        bus.addWsClient(client);
        bus.emit('task:created', 'test', { taskId: 'abc' });
        expect(messages).toHaveLength(1);
        const parsed = JSON.parse(messages[0]);
        expect(parsed.type).toBe('task:created');
        expect(parsed.data.taskId).toBe('abc');
    });

    test('closed WebSocket clients are removed', () => {
        const client: WebSocketClient = {
            readyState: 'closed',
            send: () => { throw new Error('should not send'); }
        };
        bus.addWsClient(client);
        bus.emit('task:created', 'test', {});
        // Client should have been removed
        expect(bus.getMetrics().totalErrors).toBe(0);
    });

    test('removeWsClient stops broadcasts', () => {
        let received = false;
        const client: WebSocketClient = {
            readyState: 'open',
            send: () => { received = true; }
        };
        bus.addWsClient(client);
        bus.removeWsClient(client);
        bus.emit('task:created', 'test', {});
        expect(received).toBe(false);
    });

    test('erroring WebSocket client is removed and error counted', () => {
        const client: WebSocketClient = {
            readyState: 'open',
            send: () => { throw new Error('connection lost'); }
        };
        bus.addWsClient(client);
        bus.emit('task:created', 'test', {});
        expect(bus.getMetrics().totalErrors).toBe(1);
    });

    // ==================== EMIT ERROR HANDLING (line 122) ====================

    test('increments totalErrors when typed listener throws synchronously (line 122)', () => {
        bus.on('task:created', () => {
            throw new Error('Listener exploded');
        });

        bus.emit('task:created', 'test', { taskId: 'err1' });

        const metrics = bus.getMetrics();
        expect(metrics.totalErrors).toBe(1);
        // totalDelivered should NOT be incremented since the emit threw
        // totalEmitted should still be 1
        expect(metrics.totalEmitted).toBe(1);
    });

    // ==================== WAIT FOR ====================

    test('waitFor resolves when event fires', async () => {
        const promise = bus.waitFor('task:verified', 5000);
        setTimeout(() => bus.emit('task:verified', 'test', { id: '123' }), 50);
        const event = await promise;
        expect(event.type).toBe('task:verified');
        expect(event.data.id).toBe('123');
    });

    test('waitFor rejects on timeout', async () => {
        await expect(bus.waitFor('task:verified', 100)).rejects.toThrow('Timeout');
    });

    // ==================== LISTENER COUNT ====================

    test('listenerCount returns correct count', () => {
        bus.on('task:created', () => {});
        bus.on('task:created', () => {});
        bus.on('plan:created', () => {});
        expect(bus.listenerCount('task:created')).toBe(2);
        expect(bus.listenerCount('plan:created')).toBe(1);
        expect(bus.listenerCount('task:deleted')).toBe(0);
    });

    // ==================== REMOVE ALL ====================

    test('removeAllListeners clears everything', () => {
        bus.on('task:created', () => {});
        bus.on('plan:created', () => {});
        const client: WebSocketClient = { readyState: 'open', send: () => {} };
        bus.addWsClient(client);
        bus.removeAllListeners();
        expect(bus.listenerCount('task:created')).toBe(0);
        expect(bus.listenerCount('plan:created')).toBe(0);
    });

    // ==================== SINGLETON ====================

    test('getEventBus returns singleton', () => {
        resetEventBus();
        const bus1 = getEventBus();
        const bus2 = getEventBus();
        expect(bus1).toBe(bus2);
    });

    test('resetEventBus creates new instance', () => {
        const bus1 = getEventBus();
        bus1.emit('task:created', 'test', {});
        resetEventBus();
        const bus2 = getEventBus();
        expect(bus2.getHistory()).toHaveLength(0);
    });

    // ==================== EVENT DATA INTEGRITY ====================

    test('event data is immutable (deep copied)', () => {
        const data = { list: [1, 2, 3] };
        bus.on('task:created', (event) => {
            (event.data.list as number[]).push(4);
        });
        bus.emit('task:created', 'test', data);
        // Original data should not be modified
        expect(data.list).toEqual([1, 2, 3]);
    });

    test('all event types can be emitted', () => {
        const types: string[] = [
            'task:created', 'task:updated', 'task:deleted', 'task:started',
            'task:completed', 'task:verified', 'task:failed', 'task:blocked',
            'plan:created', 'plan:activated', 'plan:completed',
            'ticket:created', 'ticket:resolved',
            'agent:started', 'agent:completed', 'agent:error',
            'verification:started', 'verification:passed', 'verification:failed',
            'evolution:pattern_detected', 'evolution:proposal_created',
            'design:page_created', 'design:component_created',
            'coding:session_created', 'coding:message_sent',
            'system:config_updated', 'system:health_check',
        ];
        for (const type of types) {
            bus.emit(type as any, 'test', {});
        }
        expect(bus.getMetrics().totalEmitted).toBe(types.length);
    });

    // ==================== CONCURRENT EVENTS ====================

    test('handles rapid-fire events', () => {
        let count = 0;
        bus.on('task:created', () => { count++; });
        for (let i = 0; i < 1000; i++) {
            bus.emit('task:created', 'stress-test', { i });
        }
        expect(count).toBe(1000);
    });

    test('metrics track all event types separately', () => {
        bus.emit('task:created', 'a', {});
        bus.emit('task:created', 'b', {});
        bus.emit('plan:created', 'c', {});
        bus.emit('agent:started', 'd', {});
        const metrics = bus.getMetrics();
        expect(metrics.byType['task:created']).toBe(2);
        expect(metrics.byType['plan:created']).toBe(1);
        expect(metrics.byType['agent:started']).toBe(1);
    });
});
