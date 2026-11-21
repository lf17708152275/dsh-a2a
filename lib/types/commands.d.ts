/**
 * The `/a2a` command surface: status, inbound/outbound server CRUD +
 * enable/disable, and task control — a text backup to the GUI (the settings
 * panel is the primary surface). All operations delegate to the same
 * `A2AServiceImpl` facade as the dashboard API.
 * @module dsh-a2a/commands
 */
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { A2AServiceImpl } from './service.ts';
/** Build the `/a2a` command definition over the service facade. */
export declare function buildA2aCommand(impl: A2AServiceImpl): CommandDefinition;
//# sourceMappingURL=commands.d.ts.map