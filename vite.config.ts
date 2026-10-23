import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACP_PRESETS } from '@agent-panel/core/acp';
import type { AgentTarget } from '@agent-panel/server';
import { createAgentServer } from '@agent-panel/server';
import react from '@vitejs/plugin-react';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vite';
import { createApi, readAgentMode, type AgentMode } from './server/api.ts';
import { createTripCapability } from './server/capability.ts';
import { dataDir, tripsDir } from './server/paths.ts';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tripDev()],
  server: {
    host: '127.0.0.1',
    // Agent writes reach the page through /api/events, so file changes must not trigger a full reload.
    watch: { ignored: ['**/data/**', '**/e2e/.data/**', '**/vendor/**'] },
  },
});

function tripDev(): Plugin {
  return {
    name: 'trip-dev',
    async configureServer(server) {
      await mount(server, dataDir());
    },
  };
}

async function mount(server: ViteDevServer, folder: string) {
  const mode = await readAgentMode(folder);
  const agentServer = createAgentServer({
    cwd: root,
    writableRoots: [tripsDir(folder)],
    agent: agentTarget(mode),
    capabilities: [createTripCapability(folder)],
  });
  server.middlewares.use(agentServer.middleware());
  server.middlewares.use(
    createApi({
      root: folder,
      onAgentChange: () => {
        setTimeout(() => {
          void server.restart();
        }, 40);
      },
    }),
  );
  const httpServer = server.httpServer;
  if (httpServer && 'maxHeadersCount' in httpServer) {
    agentServer.attach(httpServer);
    httpServer.on('close', () => {
      void agentServer.close();
    });
  }
}

function agentTarget(mode: AgentMode): AgentTarget {
  if (mode === 'claude-code' || mode === 'codex') {
    const preset = ACP_PRESETS[mode];
    return { command: preset.command, args: [...preset.args] };
  }
  const mockAgent = fileURLToPath(new URL('./server/mock-trip-agent.ts', import.meta.url));
  return { command: process.execPath, args: [mockAgent] };
}
