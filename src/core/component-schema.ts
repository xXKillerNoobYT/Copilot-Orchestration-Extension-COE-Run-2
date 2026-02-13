// ============================================================
// ComponentSchemaService
// Manages the component library definitions for the Visual
// Program Designer. Deterministic — no LLM calls.
// ============================================================

import { Database } from './database';
import { ComponentSchema, ComponentSchemaProperty, ComponentSchemaEvent, ComponentStyles } from '../types';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type SchemaCategory = ComponentSchema['category'];

interface ValidationResult {
    valid: boolean;
    errors: string[];
}

interface SeedComponentDef {
    type: string;
    display_name: string;
    category: SchemaCategory;
    description: string;
    properties: ComponentSchemaProperty[];
    events: ComponentSchemaEvent[];
    default_styles: Partial<ComponentStyles>;
    default_size: { width: number; height: number };
    code_templates: { react_tsx: string; html: string; css: string };
    icon: string;
    is_container: boolean;
    allowed_children: string[] | null;
    instance_limits: { min: number; max: number | null };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ComponentSchemaService {
    constructor(
        private database: Database,
        private outputChannel: { appendLine(msg: string): void }
    ) {}

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /** Retrieve a schema by its type identifier. */
    getSchema(type: string): ComponentSchema | null {
        return this.database.getComponentSchema(type);
    }

    /** Retrieve all registered component schemas. */
    getAllSchemas(): ComponentSchema[] {
        return this.database.getAllComponentSchemas();
    }

    /** Retrieve schemas for a given category. */
    getByCategory(category: SchemaCategory): ComponentSchema[] {
        return this.database.getComponentSchemasByCategory(category);
    }

    /** Validate and register a new component schema. */
    registerSchema(schema: Partial<ComponentSchema> & { type: string; display_name: string }): ComponentSchema {
        // Prevent duplicate types
        const existing = this.database.getComponentSchema(schema.type);
        if (existing) {
            throw new Error(`Component schema with type '${schema.type}' already exists (id: ${existing.id})`);
        }
        const created = this.database.createComponentSchema(schema);
        this.outputChannel.appendLine(`[ComponentSchema] Registered: ${created.type} (${created.display_name})`);
        return created;
    }

    /** Update an existing schema by type identifier. Returns null if not found. */
    updateSchema(type: string, updates: Partial<ComponentSchema>): ComponentSchema | null {
        const existing = this.database.getComponentSchema(type);
        if (!existing) { return null; }
        const updated = this.database.updateComponentSchema(existing.id, updates);
        if (updated) {
            this.outputChannel.appendLine(`[ComponentSchema] Updated: ${type}`);
        }
        return updated;
    }

    /**
     * Get a code template for a component type in the specified format.
     * Interpolates `{{variable}}` placeholders with the provided props.
     */
    getCodeTemplate(type: string, format: 'react_tsx' | 'html' | 'css', props?: Record<string, unknown>): string | null {
        const schema = this.database.getComponentSchema(type);
        if (!schema) { return null; }
        let template = schema.code_templates[format];
        if (!template) { return null; }
        if (props) {
            template = this.interpolateTemplate(template, props);
        }
        return template;
    }

    /** Get the default property values from a schema, keyed by property name. */
    getDefaultProps(type: string): Record<string, unknown> {
        const schema = this.database.getComponentSchema(type);
        if (!schema) { return {}; }
        const defaults: Record<string, unknown> = {};
        for (const prop of schema.properties) {
            defaults[prop.name] = prop.default_value;
        }
        return defaults;
    }

    /** Get the events a component type can emit. */
    getEvents(type: string): ComponentSchemaEvent[] {
        const schema = this.database.getComponentSchema(type);
        return schema ? schema.events : [];
    }

    /**
     * Validate a set of component props against a schema.
     * Checks: required props present, types match, validation constraints.
     */
    validateComponentProps(type: string, props: Record<string, unknown>): ValidationResult {
        const schema = this.database.getComponentSchema(type);
        if (!schema) {
            return { valid: false, errors: [`Unknown component type: '${type}'`] };
        }
        const errors: string[] = [];

        for (const schemaProp of schema.properties) {
            const value = props[schemaProp.name];

            // Required check
            if (schemaProp.required && (value === undefined || value === null)) {
                errors.push(`Missing required property: '${schemaProp.name}'`);
                continue;
            }

            // Skip validation if the value is absent and not required
            if (value === undefined || value === null) { continue; }

            // Type check
            if (!this.checkPropType(value, schemaProp.type)) {
                errors.push(`Property '${schemaProp.name}' expected type '${schemaProp.type}' but got '${typeof value}'`);
                continue;
            }

            // Enum check
            if (schemaProp.type === 'enum' && schemaProp.enum_values) {
                if (!schemaProp.enum_values.includes(value as string)) {
                    errors.push(`Property '${schemaProp.name}' value '${value}' is not in allowed values: [${schemaProp.enum_values.join(', ')}]`);
                }
            }

            // Validation constraints
            if (schemaProp.validation) {
                const v = schemaProp.validation;

                if (v.min !== undefined && typeof value === 'number' && value < v.min) {
                    errors.push(`Property '${schemaProp.name}' value ${value} is below minimum ${v.min}`);
                }
                if (v.max !== undefined && typeof value === 'number' && value > v.max) {
                    errors.push(`Property '${schemaProp.name}' value ${value} exceeds maximum ${v.max}`);
                }
                if (v.max_length !== undefined && typeof value === 'string' && value.length > v.max_length) {
                    errors.push(`Property '${schemaProp.name}' length ${value.length} exceeds max_length ${v.max_length}`);
                }
                if (v.pattern !== undefined && typeof value === 'string') {
                    const regex = new RegExp(v.pattern);
                    if (!regex.test(value)) {
                        errors.push(`Property '${schemaProp.name}' value does not match pattern '${v.pattern}'`);
                    }
                }
            }
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * Seed the 37 default component schemas into the database.
     * Only inserts if the component_schemas table is empty.
     */
    seedDefaultSchemas(): void {
        const existing = this.database.getAllComponentSchemas();
        if (existing.length > 0) {
            this.outputChannel.appendLine(`[ComponentSchema] Seed skipped — ${existing.length} schemas already registered`);
            return;
        }

        this.outputChannel.appendLine('[ComponentSchema] Seeding 37 default component schemas...');
        const defs = this.buildDefaultSchemas();
        let count = 0;
        for (const def of defs) {
            try {
                this.database.createComponentSchema(def);
                count++;
            } catch (err) {
                this.outputChannel.appendLine(`[ComponentSchema] Seed error for '${def.type}': ${err}`);
            }
        }
        this.outputChannel.appendLine(`[ComponentSchema] Seeded ${count} / ${defs.length} schemas`);
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /** Simple {{variable}} template interpolation. */
    private interpolateTemplate(template: string, props: Record<string, unknown>): string {
        return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
            const val = props[key];
            if (val === undefined || val === null) { return ''; }
            return String(val);
        });
    }

    /** Check if a value's JS type matches the schema property type. */
    private checkPropType(value: unknown, schemaType: ComponentSchemaProperty['type']): boolean {
        switch (schemaType) {
            case 'string':
            case 'color':
            case 'expression':
                return typeof value === 'string';
            case 'number':
                return typeof value === 'number';
            case 'boolean':
                return typeof value === 'boolean';
            case 'enum':
                return typeof value === 'string';
            case 'json':
                return typeof value === 'object' || typeof value === 'string';
            default:
                return true;
        }
    }

    // -----------------------------------------------------------------------
    // Shorthand helpers to reduce repetition in seed definitions
    // -----------------------------------------------------------------------

    private prop(name: string, type: ComponentSchemaProperty['type'], defaultValue: unknown, required: boolean, description: string, extra?: { enum_values?: string[]; validation?: ComponentSchemaProperty['validation'] }): ComponentSchemaProperty {
        return { name, type, default_value: defaultValue, required, description, ...extra };
    }

    private evt(name: string, description: string, payloadType: string, exampleHandler: string): ComponentSchemaEvent {
        return { name, description, payload_type: payloadType, example_handler: exampleHandler };
    }

    // -----------------------------------------------------------------------
    // Default schema definitions (37 components)
    // -----------------------------------------------------------------------

    private buildDefaultSchemas(): SeedComponentDef[] {
        return [
            // ================================================================
            // PRIMITIVE INPUTS (11)
            // ================================================================
            {
                type: 'text_box',
                display_name: 'TextBox',
                category: 'primitive_input',
                description: 'Single-line text input field.',
                properties: [
                    this.prop('label', 'string', 'Label', false, 'Field label text'),
                    this.prop('placeholder', 'string', 'Enter text...', false, 'Placeholder text', { validation: { max_length: 200 } }),
                    this.prop('value', 'string', '', false, 'Current value'),
                    this.prop('maxLength', 'number', 255, false, 'Maximum character length', { validation: { min: 1, max: 10000 } }),
                    this.prop('disabled', 'boolean', false, false, 'Whether the field is disabled'),
                ],
                events: [
                    this.evt('onChange', 'Fires when the value changes', 'string', 'handleChange(e.target.value)'),
                    this.evt('onBlur', 'Fires when the field loses focus', 'void', 'handleBlur()'),
                ],
                default_styles: { padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' },
                default_size: { width: 240, height: 40 },
                code_templates: {
                    react_tsx: '<input\n  type="text"\n  placeholder="{{placeholder}}"\n  value={{{value}}}\n  onChange={(e) => set{{Name}}(e.target.value)}\n  maxLength={{{maxLength}}}\n  disabled={{{disabled}}}\n  className="coe-textbox"\n/>',
                    html: '<label>{{label}}</label>\n<input type="text" placeholder="{{placeholder}}" value="{{value}}" maxlength="{{maxLength}}">',
                    css: '.coe-textbox {\n  padding: 8px 12px;\n  border: 1px solid #ccc;\n  border-radius: 4px;\n  font-size: 14px;\n  width: 100%;\n}',
                },
                icon: 'symbol-string',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'secure_field',
                display_name: 'SecureField',
                category: 'primitive_input',
                description: 'Password / secret input field with optional visibility toggle.',
                properties: [
                    this.prop('label', 'string', 'Password', false, 'Field label text'),
                    this.prop('placeholder', 'string', 'Enter password...', false, 'Placeholder text'),
                    this.prop('showToggle', 'boolean', true, false, 'Show/hide password toggle button'),
                ],
                events: [
                    this.evt('onChange', 'Fires when the value changes', 'string', 'handleChange(e.target.value)'),
                ],
                default_styles: { padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' },
                default_size: { width: 240, height: 40 },
                code_templates: {
                    react_tsx: '<div className="coe-secure-field">\n  <input\n    type={showPassword ? "text" : "password"}\n    placeholder="{{placeholder}}"\n    className="coe-secure-input"\n  />\n  {{{showToggle}} && <button onClick={() => setShowPassword(!showPassword)}>👁</button>}\n</div>',
                    html: '<label>{{label}}</label>\n<div class="coe-secure-field">\n  <input type="password" placeholder="{{placeholder}}">\n  <button class="coe-toggle-visibility">Show</button>\n</div>',
                    css: '.coe-secure-field {\n  position: relative;\n  display: flex;\n  align-items: center;\n}\n.coe-secure-input {\n  padding: 8px 12px;\n  border: 1px solid #ccc;\n  border-radius: 4px;\n  font-size: 14px;\n  width: 100%;\n}',
                },
                icon: 'lock',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'number_field',
                display_name: 'NumberField',
                category: 'primitive_input',
                description: 'Numeric input field with optional min/max/step.',
                properties: [
                    this.prop('label', 'string', 'Number', false, 'Field label'),
                    this.prop('min', 'number', 0, false, 'Minimum value'),
                    this.prop('max', 'number', 100, false, 'Maximum value'),
                    this.prop('step', 'number', 1, false, 'Step increment'),
                    this.prop('value', 'number', 0, false, 'Current value'),
                ],
                events: [
                    this.evt('onChange', 'Fires when the value changes', 'number', 'handleChange(Number(e.target.value))'),
                ],
                default_styles: { padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' },
                default_size: { width: 160, height: 40 },
                code_templates: {
                    react_tsx: '<input\n  type="number"\n  min={{{min}}}\n  max={{{max}}}\n  step={{{step}}}\n  value={{{value}}}\n  onChange={(e) => set{{Name}}(Number(e.target.value))}\n  className="coe-number-field"\n/>',
                    html: '<label>{{label}}</label>\n<input type="number" min="{{min}}" max="{{max}}" step="{{step}}" value="{{value}}">',
                    css: '.coe-number-field {\n  padding: 8px 12px;\n  border: 1px solid #ccc;\n  border-radius: 4px;\n  font-size: 14px;\n  width: 120px;\n}',
                },
                icon: 'symbol-number',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'toggle',
                display_name: 'Toggle',
                category: 'primitive_input',
                description: 'On/off switch input.',
                properties: [
                    this.prop('label', 'string', 'Toggle', false, 'Label text'),
                    this.prop('checked', 'boolean', false, false, 'Whether the toggle is on'),
                    this.prop('disabled', 'boolean', false, false, 'Whether the toggle is disabled'),
                ],
                events: [
                    this.evt('onChange', 'Fires when toggled', 'boolean', 'handleToggle(!checked)'),
                ],
                default_styles: {},
                default_size: { width: 60, height: 32 },
                code_templates: {
                    react_tsx: '<label className="coe-toggle">\n  <input\n    type="checkbox"\n    role="switch"\n    checked={{{checked}}}\n    disabled={{{disabled}}}\n    onChange={(e) => set{{Name}}(e.target.checked)}\n  />\n  <span className="coe-toggle-slider" />\n  {{label}}\n</label>',
                    html: '<label class="coe-toggle">\n  <input type="checkbox" role="switch">\n  <span class="coe-toggle-slider"></span>\n  {{label}}\n</label>',
                    css: '.coe-toggle {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  cursor: pointer;\n}\n.coe-toggle-slider {\n  width: 40px;\n  height: 22px;\n  background: #ccc;\n  border-radius: 11px;\n  position: relative;\n  transition: background 0.2s;\n}',
                },
                icon: 'activate-breakpoints',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'checkbox',
                display_name: 'Checkbox',
                category: 'primitive_input',
                description: 'Standard checkbox input.',
                properties: [
                    this.prop('label', 'string', 'Checkbox', false, 'Label text'),
                    this.prop('checked', 'boolean', false, false, 'Whether checked'),
                    this.prop('disabled', 'boolean', false, false, 'Whether disabled'),
                ],
                events: [
                    this.evt('onChange', 'Fires when checked state changes', 'boolean', 'handleCheck(e.target.checked)'),
                ],
                default_styles: {},
                default_size: { width: 160, height: 28 },
                code_templates: {
                    react_tsx: '<label className="coe-checkbox">\n  <input\n    type="checkbox"\n    checked={{{checked}}}\n    disabled={{{disabled}}}\n    onChange={(e) => set{{Name}}(e.target.checked)}\n  />\n  {{label}}\n</label>',
                    html: '<label class="coe-checkbox">\n  <input type="checkbox"> {{label}}\n</label>',
                    css: '.coe-checkbox {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  cursor: pointer;\n  font-size: 14px;\n}',
                },
                icon: 'check',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'radio',
                display_name: 'Radio',
                category: 'primitive_input',
                description: 'Radio button group for single selection.',
                properties: [
                    this.prop('label', 'string', 'Options', false, 'Group label'),
                    this.prop('options', 'json', ['Option A', 'Option B', 'Option C'], true, 'Array of option labels'),
                    this.prop('selected', 'string', '', false, 'Currently selected option'),
                    this.prop('name', 'string', 'radio-group', true, 'Radio group name attribute'),
                ],
                events: [
                    this.evt('onChange', 'Fires when selection changes', 'string', 'handleSelect(e.target.value)'),
                ],
                default_styles: { display: 'flex', flexDirection: 'column', gap: '6px' },
                default_size: { width: 200, height: 100 },
                code_templates: {
                    react_tsx: '<fieldset className="coe-radio-group">\n  <legend>{{label}}</legend>\n  {options.map((opt) => (\n    <label key={opt}>\n      <input type="radio" name="{{name}}" value={opt} checked={selected === opt} onChange={(e) => setSelected(e.target.value)} />\n      {opt}\n    </label>\n  ))}\n</fieldset>',
                    html: '<fieldset class="coe-radio-group">\n  <legend>{{label}}</legend>\n  <label><input type="radio" name="{{name}}" value="Option A"> Option A</label>\n  <label><input type="radio" name="{{name}}" value="Option B"> Option B</label>\n</fieldset>',
                    css: '.coe-radio-group {\n  border: none;\n  padding: 0;\n  margin: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.coe-radio-group label {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  cursor: pointer;\n}',
                },
                icon: 'circle-filled',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'slider',
                display_name: 'Slider',
                category: 'primitive_input',
                description: 'Range slider input.',
                properties: [
                    this.prop('label', 'string', 'Slider', false, 'Label text'),
                    this.prop('min', 'number', 0, false, 'Minimum value'),
                    this.prop('max', 'number', 100, false, 'Maximum value'),
                    this.prop('step', 'number', 1, false, 'Step size'),
                    this.prop('value', 'number', 50, false, 'Current value'),
                    this.prop('showValue', 'boolean', true, false, 'Display current value next to slider'),
                ],
                events: [
                    this.evt('onChange', 'Fires when slider value changes', 'number', 'handleSlide(Number(e.target.value))'),
                ],
                default_styles: {},
                default_size: { width: 240, height: 40 },
                code_templates: {
                    react_tsx: '<div className="coe-slider">\n  <label>{{label}}</label>\n  <input\n    type="range"\n    min={{{min}}}\n    max={{{max}}}\n    step={{{step}}}\n    value={{{value}}}\n    onChange={(e) => set{{Name}}(Number(e.target.value))}\n  />\n  {{{showValue}} && <span>{value}</span>}\n</div>',
                    html: '<label>{{label}}</label>\n<input type="range" min="{{min}}" max="{{max}}" step="{{step}}" value="{{value}}">\n<span>{{value}}</span>',
                    css: '.coe-slider {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.coe-slider input[type="range"] {\n  flex: 1;\n  cursor: pointer;\n}',
                },
                icon: 'settings',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'dropdown',
                display_name: 'Dropdown',
                category: 'primitive_input',
                description: 'Select dropdown for choosing from a list.',
                properties: [
                    this.prop('label', 'string', 'Select', false, 'Label text'),
                    this.prop('options', 'json', ['Option A', 'Option B', 'Option C'], true, 'Array of option labels'),
                    this.prop('selected', 'string', '', false, 'Currently selected option'),
                    this.prop('placeholder', 'string', 'Choose...', false, 'Placeholder text'),
                ],
                events: [
                    this.evt('onChange', 'Fires when selection changes', 'string', 'handleSelect(e.target.value)'),
                ],
                default_styles: { padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' },
                default_size: { width: 200, height: 40 },
                code_templates: {
                    react_tsx: '<select\n  value={{{selected}}}\n  onChange={(e) => setSelected(e.target.value)}\n  className="coe-dropdown"\n>\n  <option value="" disabled>{{placeholder}}</option>\n  {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}\n</select>',
                    html: '<label>{{label}}</label>\n<select class="coe-dropdown">\n  <option value="" disabled selected>{{placeholder}}</option>\n  <option>Option A</option>\n  <option>Option B</option>\n</select>',
                    css: '.coe-dropdown {\n  padding: 8px 12px;\n  border: 1px solid #ccc;\n  border-radius: 4px;\n  font-size: 14px;\n  background: #fff;\n  cursor: pointer;\n  width: 100%;\n}',
                },
                icon: 'list-flat',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'date_picker',
                display_name: 'DatePicker',
                category: 'primitive_input',
                description: 'Date selection input.',
                properties: [
                    this.prop('label', 'string', 'Date', false, 'Label text'),
                    this.prop('value', 'string', '', false, 'Selected date (ISO format)'),
                    this.prop('min', 'string', '', false, 'Earliest selectable date'),
                    this.prop('max', 'string', '', false, 'Latest selectable date'),
                ],
                events: [
                    this.evt('onChange', 'Fires when date changes', 'string', 'handleDateChange(e.target.value)'),
                ],
                default_styles: { padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' },
                default_size: { width: 200, height: 40 },
                code_templates: {
                    react_tsx: '<input\n  type="date"\n  value={{{value}}}\n  min="{{min}}"\n  max="{{max}}"\n  onChange={(e) => set{{Name}}(e.target.value)}\n  className="coe-date-picker"\n/>',
                    html: '<label>{{label}}</label>\n<input type="date" value="{{value}}" min="{{min}}" max="{{max}}">',
                    css: '.coe-date-picker {\n  padding: 8px 12px;\n  border: 1px solid #ccc;\n  border-radius: 4px;\n  font-size: 14px;\n}',
                },
                icon: 'calendar',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'time_picker',
                display_name: 'TimePicker',
                category: 'primitive_input',
                description: 'Time selection input.',
                properties: [
                    this.prop('label', 'string', 'Time', false, 'Label text'),
                    this.prop('value', 'string', '', false, 'Selected time (HH:MM)'),
                ],
                events: [
                    this.evt('onChange', 'Fires when time changes', 'string', 'handleTimeChange(e.target.value)'),
                ],
                default_styles: { padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' },
                default_size: { width: 160, height: 40 },
                code_templates: {
                    react_tsx: '<input\n  type="time"\n  value={{{value}}}\n  onChange={(e) => set{{Name}}(e.target.value)}\n  className="coe-time-picker"\n/>',
                    html: '<label>{{label}}</label>\n<input type="time" value="{{value}}">',
                    css: '.coe-time-picker {\n  padding: 8px 12px;\n  border: 1px solid #ccc;\n  border-radius: 4px;\n  font-size: 14px;\n}',
                },
                icon: 'clock',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'color_picker',
                display_name: 'ColorPicker',
                category: 'primitive_input',
                description: 'Color selection input.',
                properties: [
                    this.prop('label', 'string', 'Color', false, 'Label text'),
                    this.prop('value', 'color', '#000000', false, 'Selected color hex'),
                ],
                events: [
                    this.evt('onChange', 'Fires when color changes', 'string', 'handleColorChange(e.target.value)'),
                ],
                default_styles: {},
                default_size: { width: 80, height: 40 },
                code_templates: {
                    react_tsx: '<div className="coe-color-picker">\n  <label>{{label}}</label>\n  <input\n    type="color"\n    value={{{value}}}\n    onChange={(e) => set{{Name}}(e.target.value)}\n  />\n</div>',
                    html: '<label>{{label}}</label>\n<input type="color" value="{{value}}">',
                    css: '.coe-color-picker {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.coe-color-picker input[type="color"] {\n  width: 40px;\n  height: 32px;\n  border: 1px solid #ccc;\n  border-radius: 4px;\n  cursor: pointer;\n}',
                },
                icon: 'symbol-color',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },

            // ================================================================
            // CONTAINERS & LAYOUTS (9)
            // ================================================================
            {
                type: 'panel',
                display_name: 'Panel',
                category: 'container',
                description: 'Basic panel container with optional title.',
                properties: [
                    this.prop('title', 'string', 'Panel', false, 'Panel header title'),
                    this.prop('collapsible', 'boolean', false, false, 'Whether the panel can collapse'),
                ],
                events: [
                    this.evt('onToggle', 'Fires when panel is collapsed/expanded', 'boolean', 'handleToggle(isOpen)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' },
                default_size: { width: 400, height: 300 },
                code_templates: {
                    react_tsx: '<div className="coe-panel">\n  {{{title}} && <div className="coe-panel-header">{{title}}</div>}\n  <div className="coe-panel-body">{children}</div>\n</div>',
                    html: '<div class="coe-panel">\n  <div class="coe-panel-header">{{title}}</div>\n  <div class="coe-panel-body"></div>\n</div>',
                    css: '.coe-panel {\n  border: 1px solid #e0e0e0;\n  border-radius: 8px;\n  overflow: hidden;\n}\n.coe-panel-header {\n  padding: 12px 16px;\n  font-weight: 600;\n  border-bottom: 1px solid #e0e0e0;\n}',
                },
                icon: 'window',
                is_container: true,
                allowed_children: [],
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'section',
                display_name: 'Section',
                category: 'container',
                description: 'Semantic section container.',
                properties: [
                    this.prop('title', 'string', 'Section', false, 'Section heading'),
                ],
                events: [],
                default_styles: { padding: '16px' },
                default_size: { width: 600, height: 400 },
                code_templates: {
                    react_tsx: '<section className="coe-section">\n  {{{title}} && <h2>{{title}}</h2>}\n  {children}\n</section>',
                    html: '<section class="coe-section">\n  <h2>{{title}}</h2>\n</section>',
                    css: '.coe-section {\n  padding: 16px;\n  margin-bottom: 16px;\n}\n.coe-section h2 {\n  font-size: 18px;\n  font-weight: 600;\n  margin-bottom: 12px;\n}',
                },
                icon: 'layout',
                is_container: true,
                allowed_children: [],
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'tab_view',
                display_name: 'TabView',
                category: 'container',
                description: 'Tabbed container for switching between content panels.',
                properties: [
                    this.prop('tabs', 'json', ['Tab 1', 'Tab 2', 'Tab 3'], true, 'Array of tab labels'),
                    this.prop('activeTab', 'number', 0, false, 'Index of active tab'),
                ],
                events: [
                    this.evt('onTabChange', 'Fires when active tab changes', 'number', 'handleTabChange(index)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '8px' },
                default_size: { width: 500, height: 350 },
                code_templates: {
                    react_tsx: '<div className="coe-tab-view">\n  <div className="coe-tab-bar">\n    {tabs.map((tab, i) => (\n      <button key={i} className={i === activeTab ? "active" : ""} onClick={() => setActiveTab(i)}>{tab}</button>\n    ))}\n  </div>\n  <div className="coe-tab-content">{children}</div>\n</div>',
                    html: '<div class="coe-tab-view">\n  <div class="coe-tab-bar">\n    <button class="active">Tab 1</button>\n    <button>Tab 2</button>\n  </div>\n  <div class="coe-tab-content"></div>\n</div>',
                    css: '.coe-tab-view {\n  border: 1px solid #e0e0e0;\n  border-radius: 8px;\n}\n.coe-tab-bar {\n  display: flex;\n  border-bottom: 1px solid #e0e0e0;\n}\n.coe-tab-bar button {\n  padding: 10px 16px;\n  border: none;\n  background: none;\n  cursor: pointer;\n}\n.coe-tab-bar button.active {\n  border-bottom: 2px solid #0078d4;\n  font-weight: 600;\n}\n.coe-tab-content {\n  padding: 16px;\n}',
                },
                icon: 'split-horizontal',
                is_container: true,
                allowed_children: [],
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'split_view',
                display_name: 'SplitView',
                category: 'container',
                description: 'Resizable split container (horizontal or vertical).',
                properties: [
                    this.prop('direction', 'enum', 'horizontal', false, 'Split direction', { enum_values: ['horizontal', 'vertical'] }),
                    this.prop('ratio', 'number', 50, false, 'Split ratio in percent', { validation: { min: 10, max: 90 } }),
                ],
                events: [
                    this.evt('onResize', 'Fires when the splitter is dragged', 'number', 'handleResize(newRatio)'),
                ],
                default_styles: { display: 'flex' },
                default_size: { width: 600, height: 400 },
                code_templates: {
                    react_tsx: '<div className="coe-split-view coe-split-{{direction}}">\n  <div style={{ flex: {{ratio}} / 100 }}>{leftOrTop}</div>\n  <div className="coe-split-divider" />\n  <div style={{ flex: 1 - {{ratio}} / 100 }}>{rightOrBottom}</div>\n</div>',
                    html: '<div class="coe-split-view coe-split-{{direction}}">\n  <div class="coe-split-pane" style="flex: 0.5;"></div>\n  <div class="coe-split-divider"></div>\n  <div class="coe-split-pane" style="flex: 0.5;"></div>\n</div>',
                    css: '.coe-split-view {\n  display: flex;\n  height: 100%;\n}\n.coe-split-horizontal {\n  flex-direction: row;\n}\n.coe-split-vertical {\n  flex-direction: column;\n}\n.coe-split-divider {\n  width: 4px;\n  background: #ddd;\n  cursor: col-resize;\n}\n.coe-split-vertical .coe-split-divider {\n  width: auto;\n  height: 4px;\n  cursor: row-resize;\n}',
                },
                icon: 'split-vertical',
                is_container: true,
                allowed_children: [],
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'collapsible',
                display_name: 'Collapsible',
                category: 'container',
                description: 'Expandable / collapsible content section.',
                properties: [
                    this.prop('title', 'string', 'Details', true, 'Section heading'),
                    this.prop('expanded', 'boolean', false, false, 'Whether section is initially expanded'),
                ],
                events: [
                    this.evt('onToggle', 'Fires when expanded/collapsed', 'boolean', 'handleToggle(isExpanded)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '6px' },
                default_size: { width: 400, height: 200 },
                code_templates: {
                    react_tsx: '<details className="coe-collapsible" open={{{expanded}}}>\n  <summary>{{title}}</summary>\n  <div className="coe-collapsible-body">{children}</div>\n</details>',
                    html: '<details class="coe-collapsible">\n  <summary>{{title}}</summary>\n  <div class="coe-collapsible-body"></div>\n</details>',
                    css: '.coe-collapsible {\n  border: 1px solid #e0e0e0;\n  border-radius: 6px;\n}\n.coe-collapsible summary {\n  padding: 12px 16px;\n  cursor: pointer;\n  font-weight: 600;\n}\n.coe-collapsible-body {\n  padding: 12px 16px;\n  border-top: 1px solid #e0e0e0;\n}',
                },
                icon: 'chevron-down',
                is_container: true,
                allowed_children: [],
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'modal',
                display_name: 'Modal',
                category: 'container',
                description: 'Overlay dialog / modal.',
                properties: [
                    this.prop('title', 'string', 'Dialog', false, 'Modal title'),
                    this.prop('open', 'boolean', false, false, 'Whether the modal is visible'),
                    this.prop('backdrop', 'boolean', true, false, 'Show backdrop overlay'),
                ],
                events: [
                    this.evt('onClose', 'Fires when modal is dismissed', 'void', 'handleClose()'),
                    this.evt('onOpen', 'Fires when modal is opened', 'void', 'handleOpen()'),
                ],
                default_styles: { backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' },
                default_size: { width: 480, height: 320 },
                code_templates: {
                    react_tsx: '{{{open}} && (\n  <div className="coe-modal-backdrop" onClick={onClose}>\n    <div className="coe-modal" onClick={(e) => e.stopPropagation()}>\n      <div className="coe-modal-header">\n        <h3>{{title}}</h3>\n        <button onClick={onClose}>&times;</button>\n      </div>\n      <div className="coe-modal-body">{children}</div>\n    </div>\n  </div>\n)}',
                    html: '<div class="coe-modal-backdrop">\n  <div class="coe-modal">\n    <div class="coe-modal-header">\n      <h3>{{title}}</h3>\n      <button>&times;</button>\n    </div>\n    <div class="coe-modal-body"></div>\n  </div>\n</div>',
                    css: '.coe-modal-backdrop {\n  position: fixed;\n  inset: 0;\n  background: rgba(0,0,0,0.4);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 1000;\n}\n.coe-modal {\n  background: #fff;\n  border-radius: 12px;\n  box-shadow: 0 8px 32px rgba(0,0,0,0.2);\n  min-width: 320px;\n  max-width: 90vw;\n}\n.coe-modal-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 16px;\n  border-bottom: 1px solid #e0e0e0;\n}\n.coe-modal-body {\n  padding: 16px;\n}',
                },
                icon: 'browser',
                is_container: true,
                allowed_children: [],
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'side_drawer',
                display_name: 'SideDrawer',
                category: 'container',
                description: 'Slide-in side panel.',
                properties: [
                    this.prop('side', 'enum', 'left', false, 'Which side the drawer slides from', { enum_values: ['left', 'right'] }),
                    this.prop('open', 'boolean', false, false, 'Whether the drawer is visible'),
                    this.prop('width', 'string', '300px', false, 'Drawer width'),
                ],
                events: [
                    this.evt('onClose', 'Fires when drawer is closed', 'void', 'handleClose()'),
                ],
                default_styles: { backgroundColor: '#fff', boxShadow: '2px 0 12px rgba(0,0,0,0.15)' },
                default_size: { width: 300, height: 600 },
                code_templates: {
                    react_tsx: '<div className={`coe-drawer coe-drawer-{{side}} ${{{open}} ? "open" : ""}`} style={{ width: "{{width}}" }}>\n  <div className="coe-drawer-content">{children}</div>\n</div>',
                    html: '<div class="coe-drawer coe-drawer-{{side}}" style="width: {{width}}">\n  <div class="coe-drawer-content"></div>\n</div>',
                    css: '.coe-drawer {\n  position: fixed;\n  top: 0;\n  bottom: 0;\n  background: #fff;\n  box-shadow: 2px 0 12px rgba(0,0,0,0.15);\n  transform: translateX(-100%);\n  transition: transform 0.3s ease;\n  z-index: 999;\n}\n.coe-drawer-left { left: 0; }\n.coe-drawer-right { right: 0; transform: translateX(100%); }\n.coe-drawer.open { transform: translateX(0); }\n.coe-drawer-content {\n  padding: 16px;\n  height: 100%;\n  overflow-y: auto;\n}',
                },
                icon: 'layout-sidebar-left',
                is_container: true,
                allowed_children: [],
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'data_grid',
                display_name: 'DataGrid',
                category: 'container',
                description: 'Data table with sorting, filtering, and pagination.',
                properties: [
                    this.prop('columns', 'json', [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }], true, 'Column definitions'),
                    this.prop('data', 'json', [], false, 'Row data array'),
                    this.prop('sortable', 'boolean', true, false, 'Enable column sorting'),
                    this.prop('filterable', 'boolean', false, false, 'Enable column filtering'),
                    this.prop('pageSize', 'number', 10, false, 'Rows per page', { validation: { min: 1, max: 100 } }),
                ],
                events: [
                    this.evt('onSort', 'Fires when column sort changes', '{ column: string; direction: "asc" | "desc" }', 'handleSort(column, direction)'),
                    this.evt('onRowClick', 'Fires when a row is clicked', 'Record<string, unknown>', 'handleRowClick(row)'),
                    this.evt('onPageChange', 'Fires when page changes', 'number', 'handlePageChange(page)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' },
                default_size: { width: 600, height: 400 },
                code_templates: {
                    react_tsx: '<div className="coe-data-grid">\n  <table>\n    <thead>\n      <tr>{columns.map((col) => <th key={col.key} onClick={() => handleSort(col.key)}>{col.label}</th>)}</tr>\n    </thead>\n    <tbody>\n      {data.map((row, i) => (\n        <tr key={i} onClick={() => handleRowClick(row)}>\n          {columns.map((col) => <td key={col.key}>{row[col.key]}</td>)}\n        </tr>\n      ))}\n    </tbody>\n  </table>\n</div>',
                    html: '<div class="coe-data-grid">\n  <table>\n    <thead><tr><th>Name</th><th>Value</th></tr></thead>\n    <tbody><tr><td>Row 1</td><td>Value 1</td></tr></tbody>\n  </table>\n</div>',
                    css: '.coe-data-grid {\n  border: 1px solid #e0e0e0;\n  border-radius: 8px;\n  overflow: hidden;\n}\n.coe-data-grid table {\n  width: 100%;\n  border-collapse: collapse;\n}\n.coe-data-grid th,\n.coe-data-grid td {\n  padding: 10px 14px;\n  text-align: left;\n  border-bottom: 1px solid #eee;\n}\n.coe-data-grid th {\n  background: #f5f5f5;\n  font-weight: 600;\n  cursor: pointer;\n}\n.coe-data-grid tbody tr:hover {\n  background: #f9f9f9;\n}',
                },
                icon: 'table',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'table',
                display_name: 'Table',
                category: 'container',
                description: 'Simple HTML table.',
                properties: [
                    this.prop('columns', 'json', [{ key: 'col1', label: 'Column 1' }, { key: 'col2', label: 'Column 2' }], true, 'Column definitions'),
                    this.prop('data', 'json', [], false, 'Row data array'),
                    this.prop('bordered', 'boolean', true, false, 'Show cell borders'),
                    this.prop('striped', 'boolean', false, false, 'Alternate row background'),
                ],
                events: [
                    this.evt('onRowClick', 'Fires when a row is clicked', 'Record<string, unknown>', 'handleRowClick(row)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '6px' },
                default_size: { width: 500, height: 300 },
                code_templates: {
                    react_tsx: '<table className={`coe-table ${{{bordered}} ? "bordered" : ""} ${{{striped}} ? "striped" : ""}`}>\n  <thead>\n    <tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}</tr>\n  </thead>\n  <tbody>\n    {data.map((row, i) => (\n      <tr key={i}>{columns.map((col) => <td key={col.key}>{row[col.key]}</td>)}</tr>\n    ))}\n  </tbody>\n</table>',
                    html: '<table class="coe-table bordered">\n  <thead><tr><th>Column 1</th><th>Column 2</th></tr></thead>\n  <tbody><tr><td>Data</td><td>Data</td></tr></tbody>\n</table>',
                    css: '.coe-table {\n  width: 100%;\n  border-collapse: collapse;\n}\n.coe-table th,\n.coe-table td {\n  padding: 8px 12px;\n  text-align: left;\n}\n.coe-table.bordered th,\n.coe-table.bordered td {\n  border: 1px solid #e0e0e0;\n}\n.coe-table th {\n  background: #f5f5f5;\n  font-weight: 600;\n}\n.coe-table.striped tbody tr:nth-child(even) {\n  background: #fafafa;\n}',
                },
                icon: 'symbol-structure',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },

            // ================================================================
            // INTERACTIVE LOGIC (6)
            // ================================================================
            {
                type: 'if_then_rule',
                display_name: 'IFTHENRuleBlock',
                category: 'interactive_logic',
                description: 'Visual if/then/else logic block.',
                properties: [
                    this.prop('condition', 'expression', '', true, 'Boolean condition expression'),
                    this.prop('thenAction', 'string', '', true, 'Action when condition is true'),
                    this.prop('elseAction', 'string', '', false, 'Action when condition is false'),
                ],
                events: [
                    this.evt('onEvaluate', 'Fires when the rule is evaluated', 'boolean', 'handleEvaluate(result)'),
                ],
                default_styles: { border: '2px solid #4caf50', borderRadius: '8px', padding: '12px' },
                default_size: { width: 320, height: 180 },
                code_templates: {
                    react_tsx: '<div className="coe-if-then">\n  <div className="coe-condition">IF: {{condition}}</div>\n  <div className="coe-then">THEN: {{thenAction}}</div>\n  {{{elseAction}} && <div className="coe-else">ELSE: {{elseAction}}</div>}\n</div>',
                    html: '<div class="coe-if-then">\n  <div class="coe-condition">IF: {{condition}}</div>\n  <div class="coe-then">THEN: {{thenAction}}</div>\n  <div class="coe-else">ELSE: {{elseAction}}</div>\n</div>',
                    css: '.coe-if-then {\n  border: 2px solid #4caf50;\n  border-radius: 8px;\n  padding: 12px;\n  font-family: monospace;\n}\n.coe-condition {\n  color: #1565c0;\n  margin-bottom: 8px;\n}\n.coe-then {\n  color: #2e7d32;\n  margin-bottom: 4px;\n}\n.coe-else {\n  color: #c62828;\n}',
                },
                icon: 'git-compare',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'validation_block',
                display_name: 'ValidationBlock',
                category: 'interactive_logic',
                description: 'Form validation rule block.',
                properties: [
                    this.prop('rules', 'json', [], true, 'Array of validation rule objects'),
                    this.prop('errorMessages', 'json', {}, false, 'Custom error messages by rule name'),
                ],
                events: [
                    this.evt('onValidate', 'Fires when validation runs', '{ valid: boolean; errors: string[] }', 'handleValidate(result)'),
                ],
                default_styles: { border: '2px dashed #ff9800', borderRadius: '8px', padding: '12px' },
                default_size: { width: 280, height: 140 },
                code_templates: {
                    react_tsx: '<div className="coe-validation-block">\n  <h4>Validation Rules</h4>\n  <ul>{rules.map((r, i) => <li key={i}>{r.field}: {r.rule}</li>)}</ul>\n</div>',
                    html: '<div class="coe-validation-block">\n  <h4>Validation Rules</h4>\n  <ul><li>Rule 1</li></ul>\n</div>',
                    css: '.coe-validation-block {\n  border: 2px dashed #ff9800;\n  border-radius: 8px;\n  padding: 12px;\n}\n.coe-validation-block h4 {\n  margin: 0 0 8px;\n  font-size: 14px;\n}\n.coe-validation-block ul {\n  margin: 0;\n  padding-left: 20px;\n}',
                },
                icon: 'pass',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'trigger_on_event',
                display_name: 'TriggerOnEventBlock',
                category: 'interactive_logic',
                description: 'Event listener trigger block.',
                properties: [
                    this.prop('eventName', 'string', 'onClick', true, 'Event name to listen for'),
                    this.prop('handler', 'expression', '', true, 'Handler expression or function name'),
                ],
                events: [
                    this.evt('onTrigger', 'Fires when the event is triggered', 'Event', 'handleTrigger(event)'),
                ],
                default_styles: { border: '2px solid #9c27b0', borderRadius: '8px', padding: '12px' },
                default_size: { width: 260, height: 100 },
                code_templates: {
                    react_tsx: '<div className="coe-trigger" onClick={{{handler}}}>\n  <span className="coe-trigger-icon">&#9889;</span>\n  <span>on {{eventName}}</span>\n</div>',
                    html: '<div class="coe-trigger">\n  <span>&#9889; on {{eventName}}</span>\n</div>',
                    css: '.coe-trigger {\n  border: 2px solid #9c27b0;\n  border-radius: 8px;\n  padding: 12px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-family: monospace;\n}\n.coe-trigger-icon {\n  font-size: 18px;\n}',
                },
                icon: 'zap',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'script_block',
                display_name: 'ScriptBlock',
                category: 'interactive_logic',
                description: 'Custom code / script execution block.',
                properties: [
                    this.prop('code', 'string', '// Your code here', true, 'Script code content'),
                    this.prop('language', 'enum', 'typescript', false, 'Script language', { enum_values: ['typescript', 'javascript', 'python'] }),
                ],
                events: [
                    this.evt('onExecute', 'Fires when the script runs', 'unknown', 'handleExecute(result)'),
                    this.evt('onError', 'Fires on script error', 'Error', 'handleError(error)'),
                ],
                default_styles: { backgroundColor: '#1e1e1e', color: '#d4d4d4', borderRadius: '8px', padding: '12px', fontFamily: 'monospace' },
                default_size: { width: 400, height: 200 },
                code_templates: {
                    react_tsx: '<pre className="coe-script-block">\n  <code>{{{code}}}</code>\n</pre>',
                    html: '<pre class="coe-script-block"><code>{{code}}</code></pre>',
                    css: '.coe-script-block {\n  background: #1e1e1e;\n  color: #d4d4d4;\n  border-radius: 8px;\n  padding: 12px;\n  font-family: monospace;\n  font-size: 13px;\n  overflow-x: auto;\n  white-space: pre;\n}',
                },
                icon: 'code',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'sync_status_widget',
                display_name: 'SyncStatusWidget',
                category: 'interactive_logic',
                description: 'Displays current sync status and progress.',
                properties: [
                    this.prop('showDetails', 'boolean', false, false, 'Show detailed sync information'),
                ],
                events: [
                    this.evt('onSyncRequest', 'Fires when manual sync is requested', 'void', 'handleSyncRequest()'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '8px', padding: '12px' },
                default_size: { width: 280, height: 120 },
                code_templates: {
                    react_tsx: '<div className="coe-sync-status">\n  <div className="coe-sync-indicator">{syncState.status}</div>\n  <span>Last sync: {syncState.last_sync_at || "Never"}</span>\n  {{{showDetails}} && <div className="coe-sync-details">\n    <span>Pending: {syncState.pending_changes}</span>\n    <span>Conflicts: {syncState.unresolved_conflicts}</span>\n  </div>}\n  <button onClick={handleSyncRequest}>Sync Now</button>\n</div>',
                    html: '<div class="coe-sync-status">\n  <div class="coe-sync-indicator">Idle</div>\n  <span>Last sync: Never</span>\n  <button>Sync Now</button>\n</div>',
                    css: '.coe-sync-status {\n  border: 1px solid #e0e0e0;\n  border-radius: 8px;\n  padding: 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.coe-sync-indicator {\n  font-weight: 600;\n  text-transform: uppercase;\n  font-size: 12px;\n}\n.coe-sync-details {\n  font-size: 12px;\n  color: #666;\n}',
                },
                icon: 'sync',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: 1 },
            },
            {
                type: 'conflict_resolution_widget',
                display_name: 'ConflictResolutionWidget',
                category: 'interactive_logic',
                description: 'UI for resolving sync conflicts.',
                properties: [
                    this.prop('conflictId', 'string', '', true, 'ID of the conflict to resolve'),
                ],
                events: [
                    this.evt('onResolve', 'Fires when a resolution is chosen', '{ strategy: string; conflictId: string }', 'handleResolve(strategy, conflictId)'),
                ],
                default_styles: { border: '2px solid #f44336', borderRadius: '8px', padding: '16px' },
                default_size: { width: 500, height: 350 },
                code_templates: {
                    react_tsx: '<div className="coe-conflict-widget">\n  <h3>Conflict: {{conflictId}}</h3>\n  <div className="coe-conflict-versions">\n    <div className="coe-version-local"><h4>Local</h4><pre>{localVersion}</pre></div>\n    <div className="coe-version-remote"><h4>Remote</h4><pre>{remoteVersion}</pre></div>\n  </div>\n  <div className="coe-conflict-actions">\n    <button onClick={() => onResolve("keep_local")}>Keep Local</button>\n    <button onClick={() => onResolve("keep_remote")}>Keep Remote</button>\n    <button onClick={() => onResolve("merge")}>Merge</button>\n  </div>\n</div>',
                    html: '<div class="coe-conflict-widget">\n  <h3>Conflict</h3>\n  <div class="coe-conflict-versions">\n    <div><h4>Local</h4><pre></pre></div>\n    <div><h4>Remote</h4><pre></pre></div>\n  </div>\n  <div class="coe-conflict-actions">\n    <button>Keep Local</button>\n    <button>Keep Remote</button>\n    <button>Merge</button>\n  </div>\n</div>',
                    css: '.coe-conflict-widget {\n  border: 2px solid #f44336;\n  border-radius: 8px;\n  padding: 16px;\n}\n.coe-conflict-versions {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 12px;\n  margin: 12px 0;\n}\n.coe-conflict-versions pre {\n  background: #f5f5f5;\n  padding: 8px;\n  border-radius: 4px;\n  font-size: 12px;\n  overflow: auto;\n}\n.coe-conflict-actions {\n  display: flex;\n  gap: 8px;\n}\n.coe-conflict-actions button {\n  padding: 8px 16px;\n  border-radius: 4px;\n  border: 1px solid #ccc;\n  cursor: pointer;\n}',
                },
                icon: 'git-merge',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },

            // ================================================================
            // DATA & SYNC (6)
            // ================================================================
            {
                type: 'local_storage_binding',
                display_name: 'LocalStorageBinding',
                category: 'data_sync',
                description: 'Binds a value to local storage for persistence.',
                properties: [
                    this.prop('key', 'string', 'my-key', true, 'Local storage key'),
                    this.prop('defaultValue', 'string', '', false, 'Default value if key does not exist'),
                ],
                events: [
                    this.evt('onChange', 'Fires when the stored value changes', 'string', 'handleStorageChange(newValue)'),
                ],
                default_styles: { border: '1px dashed #2196f3', borderRadius: '6px', padding: '10px' },
                default_size: { width: 240, height: 80 },
                code_templates: {
                    react_tsx: '<div className="coe-local-storage">\n  <span className="coe-storage-icon">&#128190;</span>\n  <span>localStorage[&quot;{{key}}&quot;]</span>\n  <code>{value ?? "{{defaultValue}}"}</code>\n</div>',
                    html: '<div class="coe-local-storage">\n  <span>Key: {{key}}</span>\n  <span>Default: {{defaultValue}}</span>\n</div>',
                    css: '.coe-local-storage {\n  border: 1px dashed #2196f3;\n  border-radius: 6px;\n  padding: 10px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  font-family: monospace;\n}',
                },
                icon: 'database',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'cloud_sync_module',
                display_name: 'CloudSyncModule',
                category: 'data_sync',
                description: 'Cloud sync configuration and status.',
                properties: [
                    this.prop('endpoint', 'string', '', true, 'Cloud endpoint URL'),
                    this.prop('interval', 'number', 60, false, 'Sync interval in seconds', { validation: { min: 10, max: 3600 } }),
                ],
                events: [
                    this.evt('onSync', 'Fires when sync completes', '{ success: boolean; timestamp: string }', 'handleSync(result)'),
                    this.evt('onError', 'Fires on sync error', 'Error', 'handleError(error)'),
                ],
                default_styles: { border: '1px solid #4caf50', borderRadius: '8px', padding: '12px', backgroundColor: '#f1f8e9' },
                default_size: { width: 300, height: 140 },
                code_templates: {
                    react_tsx: '<div className="coe-cloud-sync">\n  <h4>Cloud Sync</h4>\n  <span>Endpoint: {{endpoint}}</span>\n  <span>Interval: {{interval}}s</span>\n  <div className="coe-sync-status">{status}</div>\n</div>',
                    html: '<div class="coe-cloud-sync">\n  <h4>Cloud Sync</h4>\n  <span>Endpoint: {{endpoint}}</span>\n  <span>Interval: {{interval}}s</span>\n</div>',
                    css: '.coe-cloud-sync {\n  border: 1px solid #4caf50;\n  border-radius: 8px;\n  padding: 12px;\n  background: #f1f8e9;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.coe-cloud-sync h4 {\n  margin: 0;\n  font-size: 14px;\n}',
                },
                icon: 'cloud-upload',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: 1 },
            },
            {
                type: 'nas_sync_module',
                display_name: 'NASSyncModule',
                category: 'data_sync',
                description: 'NAS (Network Attached Storage) sync configuration.',
                properties: [
                    this.prop('path', 'string', '', true, 'NAS share path'),
                    this.prop('protocol', 'enum', 'smb', false, 'Network protocol', { enum_values: ['smb', 'nfs', 'webdav'] }),
                ],
                events: [
                    this.evt('onSync', 'Fires when sync completes', '{ success: boolean; timestamp: string }', 'handleSync(result)'),
                    this.evt('onError', 'Fires on sync error', 'Error', 'handleError(error)'),
                ],
                default_styles: { border: '1px solid #ff9800', borderRadius: '8px', padding: '12px', backgroundColor: '#fff3e0' },
                default_size: { width: 300, height: 120 },
                code_templates: {
                    react_tsx: '<div className="coe-nas-sync">\n  <h4>NAS Sync</h4>\n  <span>Path: {{path}}</span>\n  <span>Protocol: {{protocol}}</span>\n  <div className="coe-sync-status">{status}</div>\n</div>',
                    html: '<div class="coe-nas-sync">\n  <h4>NAS Sync</h4>\n  <span>Path: {{path}}</span>\n  <span>Protocol: {{protocol}}</span>\n</div>',
                    css: '.coe-nas-sync {\n  border: 1px solid #ff9800;\n  border-radius: 8px;\n  padding: 12px;\n  background: #fff3e0;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.coe-nas-sync h4 {\n  margin: 0;\n  font-size: 14px;\n}',
                },
                icon: 'server',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: 1 },
            },
            {
                type: 'p2p_sync_module',
                display_name: 'P2PSyncModule',
                category: 'data_sync',
                description: 'Peer-to-peer sync configuration.',
                properties: [
                    this.prop('port', 'number', 8080, false, 'P2P listening port', { validation: { min: 1024, max: 65535 } }),
                    this.prop('peers', 'json', [], false, 'Array of known peer addresses'),
                ],
                events: [
                    this.evt('onPeerConnect', 'Fires when a peer connects', '{ peerId: string; address: string }', 'handlePeerConnect(peer)'),
                    this.evt('onSync', 'Fires when sync with a peer completes', '{ peerId: string; success: boolean }', 'handleSync(result)'),
                ],
                default_styles: { border: '1px solid #9c27b0', borderRadius: '8px', padding: '12px', backgroundColor: '#f3e5f5' },
                default_size: { width: 300, height: 140 },
                code_templates: {
                    react_tsx: '<div className="coe-p2p-sync">\n  <h4>P2P Sync</h4>\n  <span>Port: {{port}}</span>\n  <span>Peers: {peers.length}</span>\n  <ul>{peers.map((p, i) => <li key={i}>{p}</li>)}</ul>\n</div>',
                    html: '<div class="coe-p2p-sync">\n  <h4>P2P Sync</h4>\n  <span>Port: {{port}}</span>\n  <span>Peers: 0</span>\n</div>',
                    css: '.coe-p2p-sync {\n  border: 1px solid #9c27b0;\n  border-radius: 8px;\n  padding: 12px;\n  background: #f3e5f5;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.coe-p2p-sync h4 {\n  margin: 0;\n  font-size: 14px;\n}',
                },
                icon: 'globe',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: 1 },
            },
            {
                type: 'state_viewer',
                display_name: 'StateViewer',
                category: 'data_sync',
                description: 'Debug state viewer for inspecting application state.',
                properties: [
                    this.prop('stateKey', 'string', '', false, 'Specific state key to display (empty = all)'),
                    this.prop('format', 'enum', 'json', false, 'Display format', { enum_values: ['json', 'table', 'tree'] }),
                ],
                events: [],
                default_styles: { backgroundColor: '#263238', color: '#aed581', borderRadius: '8px', padding: '12px', fontFamily: 'monospace' },
                default_size: { width: 360, height: 240 },
                code_templates: {
                    react_tsx: '<div className="coe-state-viewer">\n  <h4>State: {{stateKey}}</h4>\n  <pre>{JSON.stringify(state, null, 2)}</pre>\n</div>',
                    html: '<div class="coe-state-viewer">\n  <h4>State: {{stateKey}}</h4>\n  <pre>{}</pre>\n</div>',
                    css: '.coe-state-viewer {\n  background: #263238;\n  color: #aed581;\n  border-radius: 8px;\n  padding: 12px;\n  font-family: monospace;\n  font-size: 12px;\n  overflow: auto;\n}\n.coe-state-viewer h4 {\n  margin: 0 0 8px;\n  color: #80cbc4;\n  font-size: 13px;\n}\n.coe-state-viewer pre {\n  margin: 0;\n  white-space: pre-wrap;\n}',
                },
                icon: 'debug',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'change_history_viewer',
                display_name: 'ChangeHistoryViewer',
                category: 'data_sync',
                description: 'Displays change history for an entity.',
                properties: [
                    this.prop('entityType', 'string', '', true, 'Entity type to show history for'),
                    this.prop('entityId', 'string', '', true, 'Entity ID to show history for'),
                ],
                events: [
                    this.evt('onRevert', 'Fires when user requests a revert to a previous version', '{ changeId: string }', 'handleRevert(changeId)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '8px', padding: '12px' },
                default_size: { width: 400, height: 300 },
                code_templates: {
                    react_tsx: '<div className="coe-change-history">\n  <h4>History: {{entityType}} / {{entityId}}</h4>\n  <ul>{changes.map((c) => (\n    <li key={c.id}>\n      <span>{c.change_type}</span>\n      <span>{c.created_at}</span>\n      <button onClick={() => handleRevert(c.id)}>Revert</button>\n    </li>\n  ))}</ul>\n</div>',
                    html: '<div class="coe-change-history">\n  <h4>History: {{entityType}} / {{entityId}}</h4>\n  <ul><li>No changes recorded</li></ul>\n</div>',
                    css: '.coe-change-history {\n  border: 1px solid #e0e0e0;\n  border-radius: 8px;\n  padding: 12px;\n}\n.coe-change-history h4 {\n  margin: 0 0 12px;\n  font-size: 14px;\n}\n.coe-change-history ul {\n  list-style: none;\n  padding: 0;\n  margin: 0;\n}\n.coe-change-history li {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 6px 0;\n  border-bottom: 1px solid #eee;\n  font-size: 13px;\n}',
                },
                icon: 'history',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },

            // ================================================================
            // ETHICS & RIGHTS (5)
            // ================================================================
            {
                type: 'freedom_module_card',
                display_name: 'FreedomModuleCard',
                category: 'ethics_rights',
                description: 'Displays an ethics / FreedomGuard module with its rules.',
                properties: [
                    this.prop('moduleId', 'string', '', true, 'Ethics module ID'),
                    this.prop('showRules', 'boolean', true, false, 'Whether to display the module rules'),
                ],
                events: [
                    this.evt('onToggle', 'Fires when module is enabled/disabled', '{ moduleId: string; enabled: boolean }', 'handleModuleToggle(moduleId, enabled)'),
                ],
                default_styles: { border: '1px solid #1565c0', borderRadius: '10px', padding: '16px', backgroundColor: '#e3f2fd' },
                default_size: { width: 360, height: 260 },
                code_templates: {
                    react_tsx: '<div className="coe-freedom-card">\n  <div className="coe-freedom-header">\n    <h4>{module.name}</h4>\n    <label><input type="checkbox" checked={module.enabled} onChange={(e) => handleModuleToggle("{{moduleId}}", e.target.checked)} /> Enabled</label>\n  </div>\n  <p>{module.description}</p>\n  {{{showRules}} && <ul className="coe-freedom-rules">\n    {module.rules.map((r) => <li key={r.id}>{r.name}: {r.action}</li>)}\n  </ul>}\n</div>',
                    html: '<div class="coe-freedom-card">\n  <div class="coe-freedom-header">\n    <h4>Module Name</h4>\n    <label><input type="checkbox"> Enabled</label>\n  </div>\n  <p>Module description</p>\n  <ul><li>Rule 1</li></ul>\n</div>',
                    css: '.coe-freedom-card {\n  border: 1px solid #1565c0;\n  border-radius: 10px;\n  padding: 16px;\n  background: #e3f2fd;\n}\n.coe-freedom-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  margin-bottom: 8px;\n}\n.coe-freedom-header h4 {\n  margin: 0;\n}\n.coe-freedom-rules {\n  margin: 8px 0 0;\n  padding-left: 20px;\n  font-size: 13px;\n}',
                },
                icon: 'shield',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'sensitivity_slider',
                display_name: 'SensitivitySlider',
                category: 'ethics_rights',
                description: 'Controls the sensitivity level of an ethics module.',
                properties: [
                    this.prop('moduleId', 'string', '', true, 'Ethics module ID'),
                    this.prop('levels', 'json', ['low', 'medium', 'high', 'maximum'], false, 'Sensitivity level labels'),
                ],
                events: [
                    this.evt('onChange', 'Fires when sensitivity level changes', '{ moduleId: string; level: string }', 'handleSensitivityChange(moduleId, level)'),
                ],
                default_styles: { padding: '12px' },
                default_size: { width: 280, height: 80 },
                code_templates: {
                    react_tsx: '<div className="coe-sensitivity-slider">\n  <label>Sensitivity</label>\n  <input\n    type="range"\n    min={0}\n    max={levels.length - 1}\n    value={levels.indexOf(currentLevel)}\n    onChange={(e) => handleSensitivityChange("{{moduleId}}", levels[e.target.value])}\n  />\n  <span>{currentLevel}</span>\n</div>',
                    html: '<div class="coe-sensitivity-slider">\n  <label>Sensitivity</label>\n  <input type="range" min="0" max="3" value="1">\n  <span>Medium</span>\n</div>',
                    css: '.coe-sensitivity-slider {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 12px;\n}\n.coe-sensitivity-slider input[type="range"] {\n  flex: 1;\n}\n.coe-sensitivity-slider span {\n  font-weight: 600;\n  min-width: 70px;\n  text-transform: capitalize;\n}',
                },
                icon: 'dashboard',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'rule_exceptions_table',
                display_name: 'RuleExceptionsTable',
                category: 'ethics_rights',
                description: 'Manages exception rules for an ethics module.',
                properties: [
                    this.prop('moduleId', 'string', '', true, 'Ethics module ID'),
                ],
                events: [
                    this.evt('onAddException', 'Fires when a new exception is added', '{ moduleId: string; exception: object }', 'handleAddException(moduleId, exception)'),
                    this.evt('onRemoveException', 'Fires when an exception is removed', '{ moduleId: string; exceptionId: string }', 'handleRemoveException(moduleId, exceptionId)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' },
                default_size: { width: 500, height: 280 },
                code_templates: {
                    react_tsx: '<div className="coe-rule-exceptions">\n  <h4>Rule Exceptions</h4>\n  <table>\n    <thead><tr><th>Rule</th><th>Exception</th><th>Actions</th></tr></thead>\n    <tbody>\n      {exceptions.map((ex) => (\n        <tr key={ex.id}>\n          <td>{ex.ruleName}</td>\n          <td>{ex.reason}</td>\n          <td><button onClick={() => handleRemoveException("{{moduleId}}", ex.id)}>Remove</button></td>\n        </tr>\n      ))}\n    </tbody>\n  </table>\n  <button onClick={() => handleAddException("{{moduleId}}", {})}>Add Exception</button>\n</div>',
                    html: '<div class="coe-rule-exceptions">\n  <h4>Rule Exceptions</h4>\n  <table>\n    <thead><tr><th>Rule</th><th>Exception</th><th>Actions</th></tr></thead>\n    <tbody><tr><td colspan="3">No exceptions</td></tr></tbody>\n  </table>\n  <button>Add Exception</button>\n</div>',
                    css: '.coe-rule-exceptions {\n  border: 1px solid #e0e0e0;\n  border-radius: 8px;\n  overflow: hidden;\n}\n.coe-rule-exceptions h4 {\n  padding: 12px 16px;\n  margin: 0;\n  background: #f5f5f5;\n  border-bottom: 1px solid #e0e0e0;\n}\n.coe-rule-exceptions table {\n  width: 100%;\n  border-collapse: collapse;\n}\n.coe-rule-exceptions th,\n.coe-rule-exceptions td {\n  padding: 8px 16px;\n  text-align: left;\n  border-bottom: 1px solid #eee;\n}\n.coe-rule-exceptions button {\n  margin: 12px 16px;\n  padding: 6px 12px;\n  border-radius: 4px;\n  border: 1px solid #ccc;\n  cursor: pointer;\n}',
                },
                icon: 'law',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'monitoring_opt_in_out',
                display_name: 'MonitoringOptInOut',
                category: 'ethics_rights',
                description: 'Consent toggle for monitoring/telemetry.',
                properties: [
                    this.prop('moduleId', 'string', '', true, 'Ethics module ID'),
                    this.prop('consentText', 'string', 'I agree to allow monitoring for this module.', false, 'Consent description text'),
                ],
                events: [
                    this.evt('onChange', 'Fires when consent state changes', '{ moduleId: string; consented: boolean }', 'handleConsentChange(moduleId, consented)'),
                ],
                default_styles: { border: '1px solid #ff9800', borderRadius: '8px', padding: '14px', backgroundColor: '#fff8e1' },
                default_size: { width: 340, height: 120 },
                code_templates: {
                    react_tsx: '<div className="coe-monitoring-opt">\n  <label>\n    <input\n      type="checkbox"\n      checked={consented}\n      onChange={(e) => handleConsentChange("{{moduleId}}", e.target.checked)}\n    />\n    {{consentText}}\n  </label>\n</div>',
                    html: '<div class="coe-monitoring-opt">\n  <label>\n    <input type="checkbox">\n    {{consentText}}\n  </label>\n</div>',
                    css: '.coe-monitoring-opt {\n  border: 1px solid #ff9800;\n  border-radius: 8px;\n  padding: 14px;\n  background: #fff8e1;\n}\n.coe-monitoring-opt label {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  font-size: 14px;\n  cursor: pointer;\n  line-height: 1.4;\n}',
                },
                icon: 'eye',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
            {
                type: 'transparency_log_viewer',
                display_name: 'TransparencyLogViewer',
                category: 'ethics_rights',
                description: 'Displays the global action/transparency log.',
                properties: [
                    this.prop('limit', 'number', 50, false, 'Maximum number of log entries to display', { validation: { min: 1, max: 500 } }),
                    this.prop('filters', 'json', {}, false, 'Filter criteria (category, source, severity)'),
                ],
                events: [
                    this.evt('onEntryClick', 'Fires when a log entry is clicked for detail', '{ logId: string }', 'handleEntryClick(logId)'),
                ],
                default_styles: { border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' },
                default_size: { width: 600, height: 400 },
                code_templates: {
                    react_tsx: '<div className="coe-transparency-log">\n  <h4>Transparency Log</h4>\n  <div className="coe-log-filters">{/* filter UI */}</div>\n  <table>\n    <thead><tr><th>Time</th><th>Source</th><th>Action</th><th>Severity</th></tr></thead>\n    <tbody>\n      {entries.map((e) => (\n        <tr key={e.id} onClick={() => handleEntryClick(e.id)} className={`severity-${e.severity}`}>\n          <td>{e.created_at}</td>\n          <td>{e.source}</td>\n          <td>{e.action}</td>\n          <td>{e.severity}</td>\n        </tr>\n      ))}\n    </tbody>\n  </table>\n</div>',
                    html: '<div class="coe-transparency-log">\n  <h4>Transparency Log</h4>\n  <table>\n    <thead><tr><th>Time</th><th>Source</th><th>Action</th><th>Severity</th></tr></thead>\n    <tbody><tr><td colspan="4">No entries</td></tr></tbody>\n  </table>\n</div>',
                    css: '.coe-transparency-log {\n  border: 1px solid #e0e0e0;\n  border-radius: 8px;\n  overflow: hidden;\n}\n.coe-transparency-log h4 {\n  padding: 12px 16px;\n  margin: 0;\n  background: #f5f5f5;\n  border-bottom: 1px solid #e0e0e0;\n}\n.coe-transparency-log table {\n  width: 100%;\n  border-collapse: collapse;\n}\n.coe-transparency-log th,\n.coe-transparency-log td {\n  padding: 8px 14px;\n  text-align: left;\n  border-bottom: 1px solid #eee;\n  font-size: 13px;\n}\n.coe-transparency-log th {\n  background: #fafafa;\n  font-weight: 600;\n}\n.coe-transparency-log .severity-error { color: #c62828; }\n.coe-transparency-log .severity-warning { color: #e65100; }\n.coe-transparency-log .severity-critical { color: #b71c1c; font-weight: 600; }',
                },
                icon: 'output',
                is_container: false,
                allowed_children: null,
                instance_limits: { min: 0, max: null },
            },
        ];
    }
}
