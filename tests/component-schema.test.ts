import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Database } from '../src/core/database';
import { ComponentSchemaService } from '../src/core/component-schema';

describe('ComponentSchemaService', () => {
    let db: Database;
    let service: ComponentSchemaService;
    let tmpDir: string;
    let outputChannel: { appendLine: jest.Mock };

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coe-schema-test-'));
        db = new Database(tmpDir);
        await db.initialize();
        outputChannel = { appendLine: jest.fn() };
        service = new ComponentSchemaService(db, outputChannel);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ===================== SEEDING =====================

    describe('Seeding', () => {
        test('seedDefaultSchemas creates 37 schemas', () => {
            service.seedDefaultSchemas();

            const all = service.getAllSchemas();
            expect(all.length).toBe(37);
        });

        test('seedDefaultSchemas is idempotent — second call skips', () => {
            service.seedDefaultSchemas();
            const countAfterFirst = service.getAllSchemas().length;
            expect(countAfterFirst).toBe(37);

            // Reset the mock to track second call independently
            outputChannel.appendLine.mockClear();

            service.seedDefaultSchemas();
            const countAfterSecond = service.getAllSchemas().length;
            expect(countAfterSecond).toBe(37);

            // Verify the skip message was logged
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Seed skipped')
            );
        });

        test('seeded schemas have all 5 categories', () => {
            service.seedDefaultSchemas();

            const categories = new Set(service.getAllSchemas().map(s => s.category));
            expect(categories).toContain('primitive_input');
            expect(categories).toContain('container');
            expect(categories).toContain('interactive_logic');
            expect(categories).toContain('data_sync');
            expect(categories).toContain('ethics_rights');
            expect(categories.size).toBe(5);
        });
    });

    // ===================== SCHEMA RETRIEVAL =====================

    describe('Schema retrieval', () => {
        beforeEach(() => {
            service.seedDefaultSchemas();
        });

        test('getSchema returns schema by type', () => {
            const textBox = service.getSchema('text_box');
            expect(textBox).not.toBeNull();
            expect(textBox!.type).toBe('text_box');
            expect(textBox!.display_name).toBe('TextBox');
            expect(textBox!.category).toBe('primitive_input');
        });

        test('getSchema returns null for unknown type', () => {
            const result = service.getSchema('nonexistent_component');
            expect(result).toBeNull();
        });

        test('getAllSchemas returns all registered schemas', () => {
            const all = service.getAllSchemas();
            expect(all.length).toBe(37);

            // Verify a few representative types exist
            const types = all.map(s => s.type);
            expect(types).toContain('text_box');
            expect(types).toContain('panel');
            expect(types).toContain('if_then_rule');
            expect(types).toContain('local_storage_binding');
            expect(types).toContain('freedom_module_card');
        });

        test('getByCategory filters correctly', () => {
            const primitiveInputs = service.getByCategory('primitive_input');
            expect(primitiveInputs.length).toBe(11);
            for (const schema of primitiveInputs) {
                expect(schema.category).toBe('primitive_input');
            }

            const containers = service.getByCategory('container');
            expect(containers.length).toBe(9);
            for (const schema of containers) {
                expect(schema.category).toBe('container');
            }

            const interactiveLogic = service.getByCategory('interactive_logic');
            expect(interactiveLogic.length).toBe(6);

            const dataSync = service.getByCategory('data_sync');
            expect(dataSync.length).toBe(6);

            const ethicsRights = service.getByCategory('ethics_rights');
            expect(ethicsRights.length).toBe(5);
        });
    });

    // ===================== SCHEMA REGISTRATION =====================

    describe('Schema registration', () => {
        test('registerSchema creates a new schema', () => {
            const created = service.registerSchema({
                type: 'custom_widget',
                display_name: 'CustomWidget',
                category: 'custom',
                description: 'A custom widget for testing',
                properties: [
                    { name: 'title', type: 'string', default_value: 'Widget', required: true, description: 'Widget title' },
                ],
                events: [
                    { name: 'onClick', description: 'Fires on click', payload_type: 'void', example_handler: 'handleClick()' },
                ],
                default_styles: { padding: '10px' },
                default_size: { width: 200, height: 100 },
                code_templates: {
                    react_tsx: '<div>{{title}}</div>',
                    html: '<div>{{title}}</div>',
                    css: '.widget { padding: 10px; }',
                },
                icon: 'symbol-misc',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            });

            expect(created.id).toBeDefined();
            expect(created.type).toBe('custom_widget');
            expect(created.display_name).toBe('CustomWidget');

            // Verify it is now retrievable
            const retrieved = service.getSchema('custom_widget');
            expect(retrieved).not.toBeNull();
            expect(retrieved!.type).toBe('custom_widget');

            // Verify output channel was logged
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Registered: custom_widget')
            );
        });

        test('registerSchema rejects duplicate types', () => {
            service.registerSchema({
                type: 'unique_type',
                display_name: 'UniqueType',
            });

            expect(() => {
                service.registerSchema({
                    type: 'unique_type',
                    display_name: 'UniqueType Again',
                });
            }).toThrow(/already exists/);
        });

        test('registerSchema validates required fields — type and display_name', () => {
            // type and display_name are enforced by the TypeScript signature;
            // verify that a minimal registration with just the two required fields succeeds
            const created = service.registerSchema({
                type: 'minimal_component',
                display_name: 'MinimalComponent',
            });

            expect(created.id).toBeDefined();
            expect(created.type).toBe('minimal_component');
            expect(created.display_name).toBe('MinimalComponent');

            // Defaults should be applied by the database layer
            expect(created.properties).toEqual([]);
            expect(created.events).toEqual([]);
            expect(created.is_container).toBe(false);
        });
    });

    // ===================== SCHEMA UPDATE =====================

    describe('Schema update', () => {
        test('updateSchema modifies an existing schema', () => {
            service.seedDefaultSchemas();

            const updated = service.updateSchema('text_box', {
                description: 'Updated text input field description',
                icon: 'symbol-text',
            });

            expect(updated).not.toBeNull();
            expect(updated!.description).toBe('Updated text input field description');
            expect(updated!.icon).toBe('symbol-text');
            // Ensure other fields remain unchanged
            expect(updated!.type).toBe('text_box');
            expect(updated!.display_name).toBe('TextBox');

            // Verify the output channel was logged
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Updated: text_box')
            );
        });

        test('updateSchema returns null for unknown type', () => {
            const result = service.updateSchema('does_not_exist', {
                description: 'Should not work',
            });

            expect(result).toBeNull();
        });
    });

    // ===================== CODE TEMPLATES =====================

    describe('Code templates', () => {
        beforeEach(() => {
            service.seedDefaultSchemas();
        });

        test('getCodeTemplate returns template for given format', () => {
            const reactTemplate = service.getCodeTemplate('text_box', 'react_tsx');
            expect(reactTemplate).not.toBeNull();
            expect(reactTemplate).toContain('input');
            expect(reactTemplate).toContain('type="text"');

            const htmlTemplate = service.getCodeTemplate('text_box', 'html');
            expect(htmlTemplate).not.toBeNull();
            expect(htmlTemplate).toContain('<input');

            const cssTemplate = service.getCodeTemplate('text_box', 'css');
            expect(cssTemplate).not.toBeNull();
            expect(cssTemplate).toContain('.coe-textbox');
        });

        test('getCodeTemplate interpolates {{variable}} placeholders', () => {
            const template = service.getCodeTemplate('text_box', 'html', {
                label: 'Email Address',
                placeholder: 'Enter your email',
                value: 'test@example.com',
                maxLength: 100,
            });

            expect(template).not.toBeNull();
            expect(template).toContain('Email Address');
            expect(template).toContain('Enter your email');
            expect(template).toContain('test@example.com');
            expect(template).toContain('100');
            // Ensure placeholders are replaced (no leftover {{}} for those keys)
            expect(template).not.toContain('{{label}}');
            expect(template).not.toContain('{{placeholder}}');
            expect(template).not.toContain('{{value}}');
            expect(template).not.toContain('{{maxLength}}');
        });

        test('getCodeTemplate returns null for unknown type', () => {
            const result = service.getCodeTemplate('nonexistent_type', 'react_tsx');
            expect(result).toBeNull();
        });
    });

    // ===================== PROPERTY DEFAULTS =====================

    describe('Property defaults', () => {
        beforeEach(() => {
            service.seedDefaultSchemas();
        });

        test('getDefaultProps returns default values from schema', () => {
            const defaults = service.getDefaultProps('text_box');
            expect(defaults).toEqual({
                label: 'Label',
                placeholder: 'Enter text...',
                value: '',
                maxLength: 255,
                disabled: false,
            });
        });

        test('getDefaultProps returns empty object for unknown type', () => {
            const defaults = service.getDefaultProps('nonexistent_type');
            expect(defaults).toEqual({});
        });
    });

    // ===================== EVENTS =====================

    describe('Events', () => {
        beforeEach(() => {
            service.seedDefaultSchemas();
        });

        test('getEvents returns component event definitions', () => {
            const events = service.getEvents('text_box');
            expect(events.length).toBe(2);

            const eventNames = events.map(e => e.name);
            expect(eventNames).toContain('onChange');
            expect(eventNames).toContain('onBlur');

            const onChange = events.find(e => e.name === 'onChange')!;
            expect(onChange.description).toBe('Fires when the value changes');
            expect(onChange.payload_type).toBe('string');
            expect(onChange.example_handler).toBeDefined();

            // Test a component with no events
            const sectionEvents = service.getEvents('section');
            expect(sectionEvents).toEqual([]);

            // Test unknown type returns empty array
            const unknownEvents = service.getEvents('nonexistent');
            expect(unknownEvents).toEqual([]);
        });
    });

    // ===================== VALIDATION =====================

    describe('Validation', () => {
        beforeEach(() => {
            service.seedDefaultSchemas();
        });

        test('validateComponentProps passes for valid props', () => {
            const result = service.validateComponentProps('text_box', {
                label: 'Name',
                placeholder: 'Enter your name',
                value: 'John',
                maxLength: 100,
                disabled: false,
            });

            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        test('validateComponentProps fails for missing required props', () => {
            // radio has 'options' and 'name' as required props
            const result = service.validateComponentProps('radio', {
                label: 'Pick one',
                // missing: options (required), name (required)
            });

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(2);
            expect(result.errors.some(e => e.includes("'options'"))).toBe(true);
            expect(result.errors.some(e => e.includes("'name'"))).toBe(true);
        });

        test('validateComponentProps fails for wrong types', () => {
            const result = service.validateComponentProps('text_box', {
                label: 123,       // should be string
                maxLength: 'abc', // should be number
                disabled: 'yes',  // should be boolean
            });

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(3);
            expect(result.errors.some(e => e.includes("'label'") && e.includes('string'))).toBe(true);
            expect(result.errors.some(e => e.includes("'maxLength'") && e.includes('number'))).toBe(true);
            expect(result.errors.some(e => e.includes("'disabled'") && e.includes('boolean'))).toBe(true);
        });

        test('validateComponentProps validates enum values', () => {
            // split_view has 'direction' as enum with ['horizontal', 'vertical']
            const validResult = service.validateComponentProps('split_view', {
                direction: 'horizontal',
                ratio: 50,
            });
            expect(validResult.valid).toBe(true);

            const invalidResult = service.validateComponentProps('split_view', {
                direction: 'diagonal',
                ratio: 50,
            });
            expect(invalidResult.valid).toBe(false);
            expect(invalidResult.errors.some(e => e.includes("'direction'") && e.includes('diagonal'))).toBe(true);
        });

        test('validateComponentProps validates min/max constraints', () => {
            // split_view 'ratio' has validation: { min: 10, max: 90 }
            const belowMin = service.validateComponentProps('split_view', {
                direction: 'horizontal',
                ratio: 5,
            });
            expect(belowMin.valid).toBe(false);
            expect(belowMin.errors.some(e => e.includes("'ratio'") && e.includes('below minimum'))).toBe(true);

            const aboveMax = service.validateComponentProps('split_view', {
                direction: 'horizontal',
                ratio: 95,
            });
            expect(aboveMax.valid).toBe(false);
            expect(aboveMax.errors.some(e => e.includes("'ratio'") && e.includes('exceeds maximum'))).toBe(true);

            // Within range should pass
            const withinRange = service.validateComponentProps('split_view', {
                direction: 'horizontal',
                ratio: 50,
            });
            expect(withinRange.valid).toBe(true);

            // Validate unknown type returns error
            const unknownType = service.validateComponentProps('nonexistent_type', {});
            expect(unknownType.valid).toBe(false);
            expect(unknownType.errors[0]).toContain("Unknown component type");
        });

        test('validateComponentProps checks max_length constraint (line 168)', () => {
            // Register a component with a max_length validation
            service.registerSchema({
                type: 'max_len_test',
                display_name: 'MaxLenTest',
                properties: [
                    {
                        name: 'title',
                        type: 'string',
                        default_value: '',
                        required: false,
                        description: 'Title with max length',
                        validation: { max_length: 10 },
                    },
                ],
            });

            // String within length limit
            const valid = service.validateComponentProps('max_len_test', {
                title: 'Short',
            });
            expect(valid.valid).toBe(true);

            // String exceeding max_length
            const invalid = service.validateComponentProps('max_len_test', {
                title: 'This string is way too long',
            });
            expect(invalid.valid).toBe(false);
            expect(invalid.errors.some(e => e.includes("'title'") && e.includes('max_length'))).toBe(true);
        });

        test('validateComponentProps checks pattern constraint (lines 171-173)', () => {
            // Register a component with a pattern validation
            service.registerSchema({
                type: 'pattern_test',
                display_name: 'PatternTest',
                properties: [
                    {
                        name: 'email',
                        type: 'string',
                        default_value: '',
                        required: false,
                        description: 'Email with pattern',
                        validation: { pattern: '^[a-z]+@[a-z]+\\.[a-z]+$' },
                    },
                ],
            });

            // Matching pattern
            const valid = service.validateComponentProps('pattern_test', {
                email: 'test@example.com',
            });
            expect(valid.valid).toBe(true);

            // Non-matching pattern
            const invalid = service.validateComponentProps('pattern_test', {
                email: 'INVALID',
            });
            expect(invalid.valid).toBe(false);
            expect(invalid.errors.some(e => e.includes("'email'") && e.includes('pattern'))).toBe(true);
        });
    });

    // ===================== COVERAGE GAP TESTS =====================

    describe('Seed error handling (line 201)', () => {
        test('seedDefaultSchemas logs error for individual schema failures', () => {
            // Spy on createComponentSchema to fail for one specific type
            const origCreate = db.createComponentSchema.bind(db);
            let callCount = 0;
            jest.spyOn(db, 'createComponentSchema').mockImplementation((data) => {
                callCount++;
                if (callCount === 3) {
                    throw new Error('Schema insert failed');
                }
                return origCreate(data);
            });

            service.seedDefaultSchemas();

            // Verify error was logged
            expect(outputChannel.appendLine).toHaveBeenCalledWith(
                expect.stringContaining('Seed error')
            );

            // Should have seeded all except the one that failed
            const all = service.getAllSchemas();
            expect(all.length).toBe(36); // 37 - 1 failed

            (db.createComponentSchema as jest.Mock).mockRestore();
        });
    });

    describe('checkPropType default case (lines 234-236)', () => {
        test('unknown property type defaults to true', () => {
            // Register a component with a property of unknown type
            service.registerSchema({
                type: 'unknown_type_test',
                display_name: 'UnknownTypeTest',
                properties: [
                    {
                        name: 'custom',
                        type: 'custom_type' as any,
                        default_value: null,
                        required: false,
                        description: 'A property with unknown type',
                    },
                ],
            });

            // Any value should pass validation for unknown type
            const result = service.validateComponentProps('unknown_type_test', {
                custom: 12345,
            });
            expect(result.valid).toBe(true);
        });
    });
});
