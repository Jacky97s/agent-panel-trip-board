export const AGENT_MODES = ['mock', 'claude-code', 'codex'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export function isAgentMode(value: string): value is AgentMode {
  return (AGENT_MODES as readonly string[]).includes(value);
}

/** Claude Code and Codex run on the user's own login, so the app pays no API cost. */
export function usesOwnSubscription(mode: AgentMode): boolean {
  return mode !== 'mock';
}
