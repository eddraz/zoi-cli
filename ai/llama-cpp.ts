import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import config from "~/config.json" with { type: "json" };

const gray = "\x1b[90m";
const reset = "\x1b[0m";

export type JSONSchemaType =
  | "object"
  | "array"
  | "number"
  | "boolean"
  | "string"
  | "null"
  | JSONSchemaType[];

export interface JsonSchema {
  type: "json_schema";
  json_schema: {
    name: string; // Un nombre identificador
    strict?: boolean; // Activa la validación estricta de gramática en llama.cpp
    schema: {
      type: JSONSchemaType; // Tipo de formato de la respuesta
      properties: Record<
        string,
        {
          type: JSONSchemaType; // Tipo de formato de la respuesta de la propiedad
          description?: string;
          items?: {
            type: JSONSchemaType;
          };
          enum?: string[];
        }
      >;
      required?: string[]; // Propiedades que se requieren
      additionalProperties?: boolean; // Impide que el modelo añada claves extras
    };
  };
}

export interface ModelParameters {
  model: {
    "server-path"?: string;
    main: string;
    draft?: string;
    "chat-template"?: string;
    chatTemplate?: string;
    ngl?: number;
    "n-gpu-layers"?: number;
    "flash-attn"?: "on" | "off" | "auto" | boolean;
    flashAttn?: "on" | "off" | "auto" | boolean;
  };
  temperature?: number;
  threads?: number;
  threadsBatch?: number;
  ngl?: number;
  nGl?: number;
  flashAttn?: "on" | "off" | "auto" | boolean;
  batchSize?: number;
  uBatchSize?: number;
  maxTokens?: number;
  contextSize?: number;
  specType?: string;
  chatTemplate?: string;
  cacheTypeK?:
  | "f32"
  | "f16"
  | "bf16"
  | "q8_0"
  | "q4_0"
  | "q4_1"
  | "iq4_nl"
  | "q5_0"
  | "q5_1";
  cacheTypeV?:
  | "f32"
  | "f16"
  | "bf16"
  | "q8_0"
  | "q4_0"
  | "q4_1"
  | "iq4_nl"
  | "q5_0"
  | "q5_1";
}

export interface Message {
  role: "system" | "assistant" | "user";
  content: string;
  reasoning_content?: string;
}

export interface RequestOptions {
  messages: Message[];
  json_schema?: JsonSchema;
  temperature?: number;
  maxTokens?: number;
  onChunk?: (delta: { content?: string; reasoning_content?: string }) => void;
}

export interface Config {
  port: number;
  baseUrl?: string;
  startupTimeoutMs?: number;
  leaseDrainTimeoutMs?: number;
  pollIntervalMs?: number;
}

interface ProcessLike {
  exitCode: number | null;
  stderr?: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: Deno.Signal | number): void;
}

export interface LlamaRuntime {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  spawn(command: string[]): ProcessLike;
  canonicalize(path: string): string;
  killPortProcess?(port: number): Promise<boolean>;
  isPortInUse?(port: number): Promise<boolean>;
}

export interface ServerLease {
  status: true;
  /** Present only for an app-owned server. External compatible servers are never owned. */
  subProcess?: ProcessLike;
  release(): void;
  stop(): Promise<void>;
}

interface OwnedServer {
  modelPath: string;
  command: string[];
  process: ProcessLike;
  leases: number;
  drainWaiters: Set<() => void>;
  stderrTail: string;
  stderrDone: Promise<void>;
}

interface PortState {
  gate: Promise<void>;
  owned?: OwnedServer;
  startup?: { modelPath: string; promise: Promise<OwnedServer> };
}

const portStates = new Map<number, PortState>();
let cleanupRegistered = false;
const STDERR_TAIL_LIMIT = 8_192;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isLlamaServerProcess(pid: number): boolean {
  try {
    const configuredServer = (config as any)?.ai?.["server-path"] || "llama-server";
    const serverName = configuredServer.split("/").pop()?.toLowerCase() || "llama-server";

    if (Deno.build.os === "linux") {
      try {
        const comm = Deno.readTextFileSync(`/proc/${pid}/comm`).toLowerCase();
        if (
          comm.includes("llama-server") ||
          comm.includes("llama-cli") ||
          comm.includes("llama") ||
          comm.includes(serverName)
        ) return true;
      } catch { /* proceed */ }
      try {
        const cmdline = Deno.readTextFileSync(`/proc/${pid}/cmdline`).toLowerCase();
        if (
          cmdline.includes("llama-server") ||
          cmdline.includes("llama-cli") ||
          cmdline.includes("llama") ||
          cmdline.includes(".gguf") ||
          cmdline.includes(serverName)
        ) return true;
      } catch { /* proceed */ }
    }

    const ps = new Deno.Command("ps", {
      args: ["-p", pid.toString(), "-o", "command="],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    });
    const output = ps.outputSync();
    if (output.success) {
      const cmd = new TextDecoder().decode(output.stdout).toLowerCase();
      if (
        cmd.includes("llama-server") ||
        cmd.includes("llama-cli") ||
        cmd.includes("llama") ||
        cmd.includes(".gguf") ||
        cmd.includes(serverName)
      ) return true;
    }
  } catch { /* ignore */ }
  return false;
}

const defaultRuntime: LlamaRuntime = {
  fetch: globalThis.fetch.bind(globalThis),
  spawn: (command) => {
    const binary = command[0];
    const args = command.slice(1);
    const cmd = new Deno.Command(binary!, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "piped",
    });
    const child = cmd.spawn();
    let exitCode: number | null = null;
    const exited = child.status.then((status) => {
      exitCode = status.code;
      return status.code;
    });

    return {
      get exitCode() {
        return exitCode;
      },
      stderr: child.stderr,
      exited,
      kill() {
        try {
          child.kill("SIGTERM");
        } catch {
          /* best-effort process shutdown */
        }
      },
    };
  },
  canonicalize: (path) => {
    try {
      return realpathSync.native(path);
    } catch {
      return resolve(path);
    }
  },
  isPortInUse: async (port: number) => {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      conn.close();
      return true;
    } catch {
      return false;
    }
  },
  killPortProcess: async (port: number) => {
    const isWindows = Deno.build.os === "windows";
    if (isWindows) {
      try {
        const netstat = new Deno.Command("cmd.exe", {
          args: ["/c", `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do @echo %a`],
          stdin: "null",
          stdout: "piped",
          stderr: "null",
        });
        const netstatOut = await netstat.output();
        if (netstatOut.success) {
          const pids = new TextDecoder().decode(netstatOut.stdout).trim().split(/\s+/);
          for (const pidStr of pids) {
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid) && pid > 0) {
              const tasklist = new Deno.Command("tasklist", {
                args: ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
                stdin: "null",
                stdout: "piped",
                stderr: "null",
              });
              const taskOut = await tasklist.output();
              const taskText = new TextDecoder().decode(taskOut.stdout).toLowerCase();
              if (taskText.includes("llama-server") || taskText.includes("llama")) {
                const killCmd = new Deno.Command("taskkill", {
                  args: ["/F", "/PID", pid.toString()],
                  stdin: "null",
                  stdout: "null",
                  stderr: "null",
                });
                await killCmd.output();
              }
            }
          }
        }
      } catch {
        return false;
      }
      return true;
    }

    let killedAny = false;
    // 1. Encontrar PIDs escuchando en el puerto TCP específico y verificar que sean llama-server
    try {
      const lsof = new Deno.Command("lsof", {
        args: ["-tiTCP:" + port, "-sTCP:LISTEN"],
        stdin: "null",
        stdout: "piped",
        stderr: "null",
      });
      const output = await lsof.output();
      if (output.success && output.stdout.length > 0) {
        const pids = new TextDecoder().decode(output.stdout).trim().split(/\s+/);
        for (const pidStr of pids) {
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid) && pid > 0 && isLlamaServerProcess(pid)) {
            try {
              Deno.kill(pid, "SIGTERM");
              killedAny = true;
            } catch { /* ignore */ }
            // Dar 100ms para salida limpia, de lo contrario forzar con SIGKILL
            await sleep(100);
            try {
              Deno.kill(pid, "SIGKILL");
              killedAny = true;
            } catch { /* already exited */ }
          }
        }
      }
    } catch { /* ignore */ }

    // 2. Fallback: pkill buscando exclusivamente llama-server en este puerto específico
    try {
      const pkill = new Deno.Command("pkill", {
        args: ["-f", `llama-server.*(--port|-p)[ =]+${port}(\\b|\\s)`],
        stdin: "null",
        stdout: "null",
        stderr: "null",
      });
      const pkillOut = await pkill.output();
      if (pkillOut.success) {
        killedAny = true;
        await sleep(100);
        const pkill9 = new Deno.Command("pkill", {
          args: ["-9", "-f", `llama-server.*(--port|-p)[ =]+${port}(\\b|\\s)`],
          stdin: "null",
          stdout: "null",
          stderr: "null",
        });
        await pkill9.output();
      }
    } catch { /* ignore */ }

    return killedAny;
  },
};

function stateFor(port: number) {
  let state = portStates.get(port);
  if (!state) {
    state = { gate: Promise.resolve() };
    portStates.set(port, state);
  }
  return state;
}

async function withPortLock<T>(state: PortState, operation: () => Promise<T>): Promise<T> {
  const previous = state.gate;
  let unlock!: () => void;
  state.gate = new Promise<void>((resolve) => { unlock = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    unlock();
  }
}

function stopOwnedServers() {
  for (const state of portStates.values()) {
    const owned = state.owned;
    if (owned?.process.exitCode === null) {
      try {
        (owned.process as any).kill?.(9) ?? owned.process.kill();
      } catch { /* best-effort process shutdown */ }
    }
  }
}

function registerCleanupOnce() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("beforeExit", stopOwnedServers);
  process.once("exit", stopOwnedServers);
  process.once("SIGINT", () => { stopOwnedServers(); process.exit(130); });
  process.once("SIGTERM", () => { stopOwnedServers(); process.exit(143); });
}

export function __resetLlamaServerStateForTests() {
  stopOwnedServers();
  portStates.clear();
}

export class LlamaCpp {
  private PORT: number;
  private BASE_URL: string;
  private runtime: LlamaRuntime;
  private startupTimeoutMs: number;
  private leaseDrainTimeoutMs: number;
  private pollIntervalMs: number;

  constructor(readonly config: Config, runtime: LlamaRuntime = defaultRuntime) {
    this.PORT = config.port;
    this.BASE_URL = config.baseUrl || `http://localhost:${config.port}`;
    this.runtime = runtime;
    this.startupTimeoutMs = config.startupTimeoutMs ?? 60_000;
    this.leaseDrainTimeoutMs = config.leaseDrainTimeoutMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 250;
  }

  async loadModel({
    model,
    temperature = 0.5,
    threads = (config.ai as Record<string, any>)["threads"] ?? 4,
    threadsBatch: threadsBatchParam,
    contextSize = (config.ai as Record<string, any>)["context-size"] ?? 4096,
    specType = "mtp:n_max=2",
    chatTemplate: chatTemplateParam,
    ngl: nglParam,
    nGl: nGlParam,
    flashAttn: flashAttnParam,
    batchSize: batchSizeParam,
    uBatchSize: uBatchSizeParam,
    cacheTypeK = (config.ai as Record<string, any>)["cache-type-k"] ?? "q8_0",
    cacheTypeV = (config.ai as Record<string, any>)["cache-type-v"] ?? "q8_0",
  }: ModelParameters): Promise<ServerLease> {
    const requestedPath = this.runtime.canonicalize(model.main);
    const state = stateFor(this.PORT);

    return withPortLock(state, async () => {
      const owned = state.owned;
      if (owned && owned.process.exitCode !== null) state.owned = undefined;

      if (state.owned?.modelPath === requestedPath) {
        await this.waitForOwnedReady(state.owned, state.owned.command);
        return this.lease(state.owned);
      }

      if (state.owned && state.owned.modelPath !== requestedPath) {
        await this.waitForLeases(state.owned);
        await this.stopAndWait(state.owned, "before the requested model switch");
        state.owned = undefined;
      }

      if (state.owned?.modelPath === requestedPath) {
        await this.waitForOwnedReady(state.owned, state.owned.command);
        return this.lease(state.owned);
      }

      const preflightDeadline = Date.now() + this.startupTimeoutMs;
      const portInUse = this.runtime.isPortInUse
        ? await this.runtime.isPortInUse(this.PORT)
        : await this.healthResponds(Date.now() + 500);

      if (portInUse) {
        const props = await this.getProps(Date.now() + Math.min(1500, this.startupTimeoutMs));
        if (props) {
          const externalPath = this.runtime.canonicalize(props.model_path);
          if (externalPath === requestedPath) {
            console.debug(`${gray}⚡ Modelo ya cargado en RAM (puerto ${this.PORT}). Reutilizando instancia...${reset}`);
            await this.waitForExternalReady(requestedPath);
            return {
              status: true,
              release: () => { },
              stop: async () => { await this.stop(); },
            };
          } else {
            console.debug(`${gray}🔄 Modelo diferente en RAM (${externalPath}). Tumbando servidor anterior en puerto ${this.PORT}...${reset}`);
            await this.stopExternal(preflightDeadline);
          }
        } else {
          console.debug(`${gray}🔄 Puerto ${this.PORT} ocupado o servidor no responde. Tumbando proceso anterior en puerto ${this.PORT}...${reset}`);
          await this.stopExternal(preflightDeadline);
        }
      }

      const cmd = [model["server-path"] || config.ai["server-path"], "-m", model.main];
      if (model.draft) cmd.push("--model-draft", model.draft, "--spec-type", specType);
      const chatTemplate = model["chat-template"] || model.chatTemplate || chatTemplateParam;
      if (chatTemplate) {
        cmd.push("--chat-template", chatTemplate);
      }

      const ngl = model["n-gpu-layers"] ?? model.ngl ?? nglParam ?? nGlParam ?? (config.ai as Record<string, any>)["ngl"];
      if (ngl !== undefined && ngl !== null) {
        cmd.push("-ngl", ngl.toString());
      }

      const fa = model["flash-attn"] ?? model.flashAttn ?? flashAttnParam ?? (config.ai as Record<string, any>)["flash-attn"];
      if (fa !== undefined && fa !== null) {
        cmd.push("--flash-attn", typeof fa === "boolean" ? (fa ? "on" : "off") : fa);
      }

      const tb = threadsBatchParam ?? (config.ai as Record<string, any>)["threads-batch"];
      if (tb !== undefined && tb !== null) {
        cmd.push("-tb", tb.toString());
      }

      const bs = batchSizeParam ?? (config.ai as Record<string, any>)["batch-size"];
      if (bs !== undefined && bs !== null) {
        cmd.push("-b", bs.toString());
      }

      const ubs = uBatchSizeParam ?? (config.ai as Record<string, any>)["ubatch-size"];
      if (ubs !== undefined && ubs !== null) {
        cmd.push("-ub", ubs.toString());
      }

      cmd.push(
        "-c", contextSize.toString(), "--threads", threads.toString(),
        ...(!model["server-path"] || model["server-path"] === config.ai["server-path"]
          ? ["--temperature", temperature.toString()] : []),
        "--port", this.PORT.toString(), "--cache-type-k", cacheTypeK,
        "--cache-type-v", cacheTypeV,
        ...(!model["server-path"] || model["server-path"] === config.ai["server-path"]
          ? ["--no-webui"] : ["--webui", "none", "--jinja"]),
      );

      console.debug(`${gray}$ ${cmd.join(" ")}`);
      console.debug(`⏳ Esperando a que el modelo se cargue en RAM...${reset}`);
      let child: ProcessLike;
      try {
        child = this.runtime.spawn(cmd);
      } catch (error) {
        throw new Error(this.diagnostic("failed to spawn", cmd, requestedPath, undefined, String(error)));
      }

      const created: OwnedServer = {
        modelPath: requestedPath,
        command: cmd,
        process: child,
        leases: 0,
        drainWaiters: new Set(),
        stderrTail: "",
        stderrDone: Promise.resolve(),
      };
      state.owned = created;
      registerCleanupOnce();
      created.stderrDone = this.drainStderr(created);

      const startup = this.waitForOwnedReady(created, cmd);
      state.startup = { modelPath: requestedPath, promise: startup };
      try {
        await startup;
      } catch (error) {
        try {
          await this.stopAndWait(created, "after startup failed");
          state.owned = undefined;
        } catch (shutdownError) {
          throw new Error(`${String((shutdownError as Error).message)}; startup failure: ${String((error as Error).message)}`);
        }
        throw error;
      } finally {
        state.startup = undefined;
      }

      console.debug(`${gray}✅ Servidor listo. Enviando petición fetch...${reset}`);
      return this.lease(created);
    });
  }

  async stop(): Promise<void> {
    const state = stateFor(this.PORT);
    return withPortLock(state, async () => {
      if (state.owned) {
        try {
          await this.stopAndWait(state.owned, "while stopping server");
        } catch {
          try {
            (state.owned.process as any).kill?.("SIGKILL") ?? (state.owned.process as any).kill?.(9) ?? state.owned.process.kill();
          } catch { /* ignore */ }
        } finally {
          state.owned = undefined;
        }
      }
      const preflightDeadline = Date.now() + 5000;
      const portInUse = this.runtime.isPortInUse
        ? await this.runtime.isPortInUse(this.PORT)
        : await this.healthResponds(Date.now() + 200);
      if (portInUse) {
        await this.stopExternal(preflightDeadline);
      }
    });
  }

  private lease(server: OwnedServer): ServerLease {
    server.leases++;
    let released = false;
    return {
      status: true,
      subProcess: server.process,
      release: () => {
        if (released) return;
        released = true;
        server.leases--;
        if (server.leases === 0) {
          for (const resolve of server.drainWaiters) resolve();
          server.drainWaiters.clear();
        }
      },
      stop: async () => {
        if (!released) {
          released = true;
          server.leases--;
          if (server.leases === 0) {
            for (const resolve of server.drainWaiters) resolve();
            server.drainWaiters.clear();
          }
        }
        await this.stop();
      },
    };
  }

  private async waitForLeases(server: OwnedServer) {
    if (server.leases === 0) return;
    let waiter: (() => void) | undefined;
    const drained = new Promise<void>((resolve) => {
      waiter = resolve;
      server.drainWaiters.add(resolve);
    });
    const result = await Promise.race([
      drained.then(() => "drained" as const),
      sleep(this.leaseDrainTimeoutMs).then(() => "timeout" as const),
    ]);
    if (waiter) server.drainWaiters.delete(waiter);
    if (result === "timeout") {
      throw new Error(
        `Timed out after ${this.leaseDrainTimeoutMs}ms waiting for active requests before switching ` +
        `the app-owned llama-server on port ${this.PORT}.`,
      );
    }
  }

  private async fetchBefore(path: string, deadline: number): Promise<Response | undefined> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = Promise.resolve()
      .then(() => this.runtime.fetch(`${this.BASE_URL}${path}`, { signal: controller.signal }))
      .then((response) => ({ kind: "response" as const, response }))
      .catch(() => ({ kind: "failed" as const }));
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), remaining);
    });
    const result = await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);
    if (result.kind === "timeout") {
      controller.abort(new Error(`llama-server ${path} probe timed out`));
      return undefined;
    }
    return result.kind === "response" ? result.response : undefined;
  }

  private async getProps(deadline: number): Promise<{ model_path: string } | undefined> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = Promise.resolve()
      .then(() => this.runtime.fetch(`${this.BASE_URL}/props`, { signal: controller.signal }))
      .then(async (response) => {
        if (!response.ok) return { kind: "failed" as const };
        const body = await response.json() as { model_path?: unknown };
        return typeof body.model_path === "string"
          ? { kind: "props" as const, props: { model_path: body.model_path } }
          : { kind: "failed" as const };
      })
      .catch(() => ({ kind: "failed" as const }));
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), remaining);
    });
    const result = await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);
    if (result.kind === "timeout") {
      controller.abort(new Error("llama-server /props probe timed out"));
      return undefined;
    }
    return result.kind === "props" ? result.props : undefined;
  }

  private async healthResponds(deadline: number) {
    return (await this.fetchBefore("/health", deadline)) !== undefined;
  }

  private async waitForExternalReady(modelPath: string) {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      const [health, props] = await Promise.all([
        this.fetchBefore("/health", deadline),
        this.getProps(deadline),
      ]);
      if (props && this.runtime.canonicalize(props.model_path) !== modelPath) {
        throw new Error(`The external llama-server on port ${this.PORT} changed models while waiting for readiness.`);
      }
      if (health?.ok && props) return;
      await sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
    throw new Error(
      `Timed out after ${this.startupTimeoutMs}ms waiting for the compatible external llama-server ` +
      `on port ${this.PORT} to become ready for model ${modelPath}.`,
    );
  }

  private async stopExternal(deadline: number) {
    if (this.runtime.killPortProcess) {
      await this.runtime.killPortProcess(this.PORT);
    }
    const freed = await this.waitForPortFree(deadline);
    if (!freed) {
      if (this.runtime.killPortProcess) {
        await this.runtime.killPortProcess(this.PORT);
      }
      const retryFreed = await this.waitForPortFree(Math.min(Date.now() + 2000, deadline));
      if (!retryFreed) {
        throw new Error(
          `No se pudo liberar el puerto ${this.PORT} ocupado por otro proceso de llama-server. ` +
          `Por favor asegúrate de detener el proceso manualmente.`,
        );
      }
    }
  }

  private async waitForPortFree(deadline: number): Promise<boolean> {
    const checkTimeout = Math.min(Date.now() + 5000, deadline);
    while (Date.now() < checkTimeout) {
      const inUse = this.runtime.isPortInUse
        ? await this.runtime.isPortInUse(this.PORT)
        : await this.healthResponds(Date.now() + 100);
      if (!inUse) return true;
      await sleep(Math.min(this.pollIntervalMs, 100));
    }
    return this.runtime.isPortInUse
      ? !(await this.runtime.isPortInUse(this.PORT))
      : !(await this.healthResponds(Date.now() + 100));
  }

  private async drainStderr(server: OwnedServer) {
    if (!server.process.stderr) return;
    const reader = server.process.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        server.stderrTail = (server.stderrTail + decoder.decode(value, { stream: true })).slice(-STDERR_TAIL_LIMIT);
      }
      server.stderrTail = (server.stderrTail + decoder.decode()).slice(-STDERR_TAIL_LIMIT);
    } catch {
      // Process termination can close stderr abruptly; the retained tail remains useful.
    } finally {
      reader.releaseLock();
    }
  }

  private async stopAndWait(server: OwnedServer, context: string) {
    if (server.process.exitCode !== null) return;
    try {
      server.process.kill();
    } catch (error) {
      throw new Error(`Failed to stop the app-owned llama-server on port ${this.PORT} ${context}: ${String(error)}`);
    }
    const outcome = await Promise.race([
      server.process.exited.then(() => "exited" as const).catch(() => "failed" as const),
      sleep(this.leaseDrainTimeoutMs).then(() => "timeout" as const),
    ]);
    if (outcome !== "exited") {
      throw new Error(
        `The app-owned llama-server on port ${this.PORT} did not exit within ` +
        `${this.leaseDrainTimeoutMs}ms ${context}. Refusing to start another process on the same port.`,
      );
    }
  }

  private async waitForOwnedReady(server: OwnedServer, cmd: string[]): Promise<OwnedServer> {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (server.process.exitCode !== null) {
        await Promise.race([
          server.stderrDone,
          sleep(Math.min(250, this.startupTimeoutMs)),
        ]);
        throw new Error(this.diagnostic(
          `exited early with exit code ${server.process.exitCode}`,
          cmd,
          server.modelPath,
          server.process.exitCode,
          server.stderrTail,
        ));
      }
      const [health, props] = await Promise.all([
        this.fetchBefore("/health", deadline),
        this.getProps(deadline),
      ]);
      if (props && this.runtime.canonicalize(props.model_path) !== server.modelPath) {
        throw new Error(this.diagnostic(
          `reported unexpected model_path ${props.model_path}`,
          cmd,
          server.modelPath,
          server.process.exitCode,
          server.stderrTail,
        ));
      }
      if (health?.ok && props) return server;
      await sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
    throw new Error(this.diagnostic(
      `timed out after ${this.startupTimeoutMs}ms`, cmd, server.modelPath,
      server.process.exitCode, server.stderrTail,
    ));
  }

  private diagnostic(reason: string, cmd: string[], modelPath: string, exitCode?: number | null, stderr = "") {
    const tail = stderr.trim() ? `; stderr tail: ${stderr.trim()}` : "";
    const code = exitCode === undefined ? "" : `; exit code ${exitCode}`;
    return `llama-server ${reason}; command: ${cmd.join(" ")}; model: ${modelPath}; port ${this.PORT}${code}${tail}`;
  }

  async sendRequest({
    messages,
    json_schema,
    temperature,
    maxTokens,
    onChunk,
  }: RequestOptions & {
    onChunk?: (delta: { content?: string; reasoning_content?: string }) => void;
  }): Promise<Message> {
    console.debug(`${gray}$ ${JSON.stringify(messages)}${reset}`);
    try {
      const body: {
        model: string;
        messages: Message[];
        stream: true;
        response_format?: JsonSchema;
        temperature?: number;
        max_tokens?: number;
      } = {
        model: "local",
        messages,
        stream: true,
      };

      if (json_schema) {
        body.response_format = json_schema;
      }

      if (temperature !== undefined) {
        body.temperature = temperature;
      }

      if (maxTokens !== undefined) {
        body.max_tokens = maxTokens;
      }

      const url = `${this.BASE_URL}/v1/chat/completions`;
      const response = await this.runtime.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Response error content:", errorText);
        throw new Error(
          `HTTP error! Status: ${response.status} - ${errorText}`,
        );
      }

      if (!response.body) {
        throw new Error("Response has no body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let reasoning_content = "";
      let finishReason: string | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIdx: number;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          for (const line of event.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payload);
              const delta = chunk.choices?.[0]?.delta;
              if (delta?.content) {
                content += delta.content;
                if (onChunk) onChunk({ content: delta.content });
              }
              if (delta?.reasoning_content) {
                reasoning_content += delta.reasoning_content;
                if (onChunk) onChunk({ reasoning_content: delta.reasoning_content });
              }
              if (chunk.choices?.[0]?.finish_reason) {
                finishReason = chunk.choices[0].finish_reason;
              }
            } catch {
              // ignore malformed chunks; server may send keep-alives
            }
          }
        }
      }

      const message: Message = {
        role: "assistant",
        content,
      };
      if (reasoning_content) {
        message.reasoning_content = reasoning_content;
      }
      return message;
    } catch (error) {
      throw error;
    }
  }

  async sendMessage(
    {
      messages,
      json_schema,
      model,
      temperature,
      maxTokens,
      threads,
      threadsBatch,
      ngl,
      nGl,
      flashAttn,
      batchSize,
      uBatchSize,
      contextSize,
      specType,
      chatTemplate,
      cacheTypeK,
      cacheTypeV,
      onChunk,
    }: RequestOptions & ModelParameters,
    callback?: (response: Message | undefined) => void,
  ): Promise<Message | undefined> {
    try {
      const modelResponse = await this.loadModel({
        model,
        temperature,
        threads,
        threadsBatch,
        ngl,
        nGl,
        flashAttn,
        batchSize,
        uBatchSize,
        contextSize,
        specType,
        chatTemplate,
        cacheTypeK,
        cacheTypeV,
      });

      if (modelResponse.status) {
        let response: Message | undefined = undefined;

        try {
          response = await this.sendRequest({
            messages,
            json_schema,
            temperature,
            maxTokens,
            onChunk,
          });

          const isInvalidJson = (content: string | undefined) => {
            if (!content) return true;
            try {
              JSON.parse(content);
              return false;
            } catch {
              return true;
            }
          };

          if (
            !response.content ||
            (json_schema && isInvalidJson(response.content))
          ) {
            if (response.reasoning_content) {
              // Release and stop this request before switching models.
              modelResponse.release();
              await this.stop();

              // Clear cut-off or invalid JSON content so it doesn't confuse the model in the second stage
              response.content = "";

              const llama = new LlamaCpp({
                port: this.PORT,
                baseUrl: this.config.baseUrl,
                startupTimeoutMs: this.startupTimeoutMs,
                leaseDrainTimeoutMs: this.leaseDrainTimeoutMs,
                pollIntervalMs: this.pollIntervalMs,
              }, this.runtime);

              const responseThink = await llama.sendMessage(
                {
                  messages: [
                    response,
                    {
                      role: "user",
                      content: response.reasoning_content,
                    },
                  ],
                  json_schema,
                  model: config.ai.model["granite-4.0-h-350m:BF16"],
                  temperature: 0,
                  maxTokens: 2000,
                },
                callback,
              );

              if (!responseThink) {
                throw new Error("Response has no content");
              }
              console.debug(`${gray}Response Think: ${reset}${JSON.stringify(responseThink, null, 2)}`);
              responseThink.role = "assistant";
              return responseThink;
            } else {
              throw new Error("Response has no content");
            }
          }

          if (!response) {
            throw new Error("Network response was not ok");
          }

          if (callback) {
            callback(response);
          }
          return response;
        } catch (error) {
          throw error;
        } finally {
          modelResponse.release();
          await this.stop();
        }
      } else {
        throw new Error("network-not-found");
      }
    } catch (error) {
      throw error;
    }
  }
}
