import { describe, it as test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  LlamaCpp,
  __resetLlamaServerStateForTests,
  type LlamaRuntime,
} from "./llama-cpp.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const modelA = "/models/a.gguf";
const modelB = "/models/b.gguf";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function processMock({ stderr = "", exitCode = null as number | null } = {}) {
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const process = {
    exitCode,
    stderr: new Response(stderr).body,
    exited,
    killCalls: 0,
    kill() {
      this.killCalls++;
      this.exitCode = 0;
      resolveExit(0);
    },
    resolveExit(code: number) {
      this.exitCode = code;
      resolveExit(code);
    },
  };
  if (exitCode !== null) queueMicrotask(() => resolveExit(exitCode));
  return process;
}

function runtime(options: {
  externalModel?: string;
  spawnedProcess?: ReturnType<typeof processMock>;
  neverReady?: boolean;
} = {}) {
  const spawned: string[][] = [];
  let child = options.spawnedProcess;
  let externalModel = options.externalModel;
  const value: LlamaRuntime = {
    canonicalize: (path) => path,
    killPortProcess: async (_port) => {
      externalModel = undefined;
      return true;
    },
    isPortInUse: async (_port) => {
      return externalModel !== undefined || (spawned.length > 0 && child !== undefined && child.exitCode === null);
    },
    fetch: async (input) => {
      const url = String(input);
      const activeModel = child && child.exitCode === null
        ? spawned.at(-1)?.[spawned.at(-1)!.indexOf("-m") + 1]
        : externalModel;
      if (!activeModel) throw new TypeError("connection refused");
      if (url.endsWith("/props")) return jsonResponse({ model_path: activeModel });
      if (url.endsWith("/health")) {
        return jsonResponse({ status: options.neverReady ? "loading model" : "ok" }, options.neverReady ? 503 : 200);
      }
      throw new Error(`Unexpected URL ${url}`);
    },
    spawn: (command) => {
      spawned.push([...command]);
      if (!child || (child.exitCode !== null && !options.spawnedProcess)) child = processMock();
      return child;
    },
  };
  return { value, spawned, get child() { return child; } };
}

const parameters = (main: string) => ({ model: { main } });

afterEach(() => __resetLlamaServerStateForTests());

describe("LlamaCpp server lifecycle", () => {
  test("deduplicates concurrent startup and leases the shared owned server", async () => {
    const mock = runtime();
    const first = new LlamaCpp({ port: 18080, pollIntervalMs: 1 }, mock.value);
    const second = new LlamaCpp({ port: 18080, pollIntervalMs: 1 }, mock.value);

    const [leaseA, leaseB] = await Promise.all([
      first.loadModel(parameters(modelA)),
      second.loadModel(parameters(modelA)),
    ]);

    expect(mock.spawned).toHaveLength(1);
    leaseA.release();
    expect(mock.child?.killCalls).toBe(0);
    leaseB.release();
    expect(mock.child?.killCalls).toBe(0);
  });

  test("reuses a compatible external server without taking ownership", async () => {
    const mock = runtime({ externalModel: modelA });
    const llama = new LlamaCpp({ port: 18080 }, mock.value);

    const lease = await llama.loadModel(parameters(modelA));
    lease.release();

    expect(mock.spawned).toHaveLength(0);
    expect(lease.subProcess).toBeUndefined();
  });

  test("replaces an incompatible external server and spawns the requested model", async () => {
    const mock = runtime({ externalModel: modelA });
    const llama = new LlamaCpp({ port: 18080, pollIntervalMs: 1 }, mock.value);

    const lease = await llama.loadModel(parameters(modelB));
    lease.release();

    expect(mock.spawned).toHaveLength(1);
    expect(mock.spawned[0]).toContain(modelB);
  });

  test("reuses loaded model in RAM and replaces only when model changes", async () => {
    const mock = runtime({ externalModel: modelA });
    const llama = new LlamaCpp({ port: 18080, pollIntervalMs: 1 }, mock.value);

    // 1. Request modelA: already in RAM (external), should reuse without spawning
    const lease1 = await llama.loadModel(parameters(modelA));
    expect(mock.spawned).toHaveLength(0);
    lease1.release();

    // 2. Request modelB: not loaded, should kill previous and spawn modelB
    const lease2 = await llama.loadModel(parameters(modelB));
    expect(mock.spawned).toHaveLength(1);
    expect(mock.spawned[0]).toContain(modelB);
    lease2.release();

    // 3. Request modelB again: already in RAM (owned), should reuse without new spawn
    const lease3 = await llama.loadModel(parameters(modelB));
    expect(mock.spawned).toHaveLength(1);
    lease3.release();

    // 4. Request modelA again: different model, should kill modelB and spawn modelA
    const lease4 = await llama.loadModel(parameters(modelA));
    expect(mock.spawned).toHaveLength(2);
    expect(mock.spawned[1]).toContain(modelA);
    lease4.release();
  });

  test("waits for active leases before replacing an app-owned model", async () => {
    const mock = runtime();
    const llama = new LlamaCpp({ port: 18080, pollIntervalMs: 1 }, mock.value);
    const leaseA = await llama.loadModel(parameters(modelA));
    const firstChild = mock.child;

    const switching = llama.loadModel(parameters(modelB));
    await sleep(5);
    expect(mock.spawned).toHaveLength(1);
    expect(mock.child?.killCalls).toBe(0);

    leaseA.release();
    const leaseB = await switching;
    expect(mock.spawned).toHaveLength(2);
    expect(firstChild?.killCalls).toBe(1);
    leaseB.release();
  });

  test("includes model, port, and command context in startup timeout errors", async () => {
    const mock = runtime({ neverReady: true });
    const llama = new LlamaCpp(
      { port: 18080, startupTimeoutMs: 5, pollIntervalMs: 1 },
      mock.value,
    );

    let error: Error | undefined;
    try {
      await llama.loadModel(parameters(modelA));
    } catch (value) {
      error = value as Error;
    }
    expect(error!.message).toContain("timed out after 5ms");
    expect(error!.message).toContain("command: llama-server");
    expect(error!.message).toContain(modelA);
    expect(error!.message).toContain("port 18080");
  });

  test("reports bounded stderr and command context when startup exits early", async () => {
    const child = processMock({ stderr: "fatal: cannot load tensor", exitCode: 42 });
    const mock = runtime({ spawnedProcess: child });
    const llama = new LlamaCpp(
      { port: 18080, startupTimeoutMs: 100, pollIntervalMs: 1 },
      mock.value,
    );

    let error: Error | undefined;
    try {
      await llama.loadModel(parameters(modelA));
    } catch (value) {
      error = value as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("exit code 42");
    expect(error!.message).toContain(modelA);
    expect(error!.message).toContain("port 18080");
    expect(error!.message).toContain("fatal: cannot load tensor");
  });

  test("bounds stalled /props body parsing with the readiness deadline", async () => {
    const child = processMock();
    let aborted = 0;
    const value: LlamaRuntime = {
      canonicalize: (path) => path,
      spawn: () => child,
      fetch: async (input, init) => {
        if (String(input).endsWith("/props")) {
          init?.signal?.addEventListener("abort", () => aborted++, { once: true });
          return {
            ok: true,
            json: () => new Promise<never>(() => {}),
          } as unknown as Response;
        }
        throw new TypeError("connection refused");
      },
    };
    const llama = new LlamaCpp(
      { port: 18080, startupTimeoutMs: 10, pollIntervalMs: 1 },
      value,
    );

    const outcome = await Promise.race([
      llama.loadModel(parameters(modelA)).then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      sleep(100).then(() => "hung" as const),
    ]);

    expect(outcome).toBe("rejected");
    expect(aborted).toBeGreaterThan(0);
  });

  test("bounds stalled readiness probes and aborts them", async () => {
    const child = processMock();
    let aborted = 0;
    let spawned = false;
    const value: LlamaRuntime = {
      canonicalize: (path) => path,
      isPortInUse: async () => spawned && child.exitCode === null,
      spawn: () => {
        spawned = true;
        return child;
      },
      fetch: async (_input, init) => {
        if (child.exitCode !== null) throw new TypeError("connection refused");
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted++;
            reject(init.signal?.reason);
          }, { once: true });
        });
      },
    };
    const llama = new LlamaCpp(
      { port: 18080, startupTimeoutMs: 10, leaseDrainTimeoutMs: 30, pollIntervalMs: 1 },
      value,
    );

    const started = Date.now();
    await expect(llama.loadModel(parameters(modelA))).rejects.toThrow("timed out after 10ms");

    expect(Date.now() - started).toBeLessThan(100);
    expect(aborted).toBeGreaterThan(0);
    expect(child.killCalls).toBe(1);
  });

  test("does not wait forever for stderr to close after an early exit", async () => {
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("fatal before stream stalled"));
      },
    });
    const child = processMock({ exitCode: 42 });
    child.stderr = stderr as any;
    const mock = runtime({ spawnedProcess: child });
    const llama = new LlamaCpp(
      { port: 18080, startupTimeoutMs: 10, leaseDrainTimeoutMs: 10, pollIntervalMs: 1 },
      mock.value,
    );

    const started = Date.now();
    await expect(llama.loadModel(parameters(modelA))).rejects.toThrow("fatal before stream stalled");
    expect(Date.now() - started).toBeLessThan(100);
  });

  test("waits for process exit after startup failure before releasing the spawn lock", async () => {
    const first = processMock();
    first.kill = function () { this.killCalls++; };
    const second = processMock();
    const spawned: string[][] = [];
    const children = [first, second];
    const value: LlamaRuntime = {
      canonicalize: (path) => path,
      spawn: (command) => {
        spawned.push(command);
        return children[spawned.length - 1]!;
      },
      fetch: async () => {
        if (spawned.length === 0) throw new TypeError("connection refused");
        const active = children[spawned.length - 1]!;
        if (active.exitCode !== null) throw new TypeError("connection refused");
        return jsonResponse({ status: "loading" }, 503);
      },
    };
    const llama = new LlamaCpp(
      { port: 18080, startupTimeoutMs: 5, leaseDrainTimeoutMs: 50, pollIntervalMs: 1 },
      value,
    );

    const firstLoad = llama.loadModel(parameters(modelA));
    const secondLoad = llama.loadModel(parameters(modelB)).then(
      () => undefined,
      (error) => error as Error,
    );
    await sleep(15);
    expect(first.killCalls).toBe(1);
    expect(spawned).toHaveLength(1);

    first.resolveExit(0);
    await expect(firstLoad).rejects.toThrow("timed out after 5ms");
    await sleep(10);
    expect(spawned).toHaveLength(2);
    second.resolveExit(0);
    expect(await secondLoad).toBeInstanceOf(Error);
  });

  test("reports a bounded actionable error when failed startup cannot shut down", async () => {
    const child = processMock();
    child.kill = function () { this.killCalls++; };
    const mock = runtime({ spawnedProcess: child, neverReady: true });
    const llama = new LlamaCpp(
      { port: 18080, startupTimeoutMs: 5, leaseDrainTimeoutMs: 5, pollIntervalMs: 1 },
      mock.value,
    );

    await expect(llama.loadModel(parameters(modelA))).rejects.toThrow(
      "did not exit within 5ms after startup failed",
    );
    expect(child.killCalls).toBe(1);
    expect(mock.spawned).toHaveLength(1);
  });

  test("stops the AI model after sendMessage finishes its request", async () => {
    const sseResponse = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello World\"}}]}\n\ndata: [DONE]\n\n";
    const spawned: string[][] = [];
    let child = processMock();
    const value: LlamaRuntime = {
      canonicalize: (path) => path,
      isPortInUse: async () => spawned.length > 0 && child.exitCode === null,
      spawn: (command) => {
        spawned.push(command);
        child = processMock();
        return child;
      },
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/props")) return jsonResponse({ model_path: modelA });
        if (url.endsWith("/health")) return jsonResponse({ status: "ok" });
        if (url.endsWith("/v1/chat/completions")) {
          return new Response(sseResponse, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    };

    const llama = new LlamaCpp({ port: 18080, pollIntervalMs: 1 }, value);
    const result = await llama.sendMessage({
      messages: [{ role: "user", content: "Hi" }],
      model: { main: modelA },
    });

    expect(result?.content).toBe("Hello World");
    expect(child.killCalls).toBe(1);
    expect(child.exitCode).toBe(0);
  });

  test("tumbar and kill any process on the port when a new model starts", async () => {
    let killPortCalled = 0;
    let externalModel: string | undefined = modelA;
    let spawnedChild: ReturnType<typeof processMock> | undefined;
    let spawnedModel: string | undefined;
    const value: LlamaRuntime = {
      canonicalize: (path) => path,
      killPortProcess: async (_port) => {
        killPortCalled++;
        externalModel = undefined;
        return true;
      },
      isPortInUse: async () => externalModel !== undefined || (spawnedChild !== undefined && spawnedChild.exitCode === null),
      fetch: async (input) => {
        const url = String(input);
        const active = (spawnedChild && spawnedChild.exitCode === null) ? spawnedModel : externalModel;
        if (!active) throw new TypeError("connection refused");
        if (url.endsWith("/props")) return jsonResponse({ model_path: active });
        if (url.endsWith("/health")) return jsonResponse({ status: "ok" });
        throw new Error(`Unexpected URL ${url}`);
      },
      spawn: (command) => {
        spawnedModel = command[command.indexOf("-m") + 1];
        spawnedChild = processMock();
        return spawnedChild;
      },
    };

    const llama = new LlamaCpp({ port: 18080, pollIntervalMs: 1 }, value);
    // Requesting modelB while modelA exists on port 18080:
    const lease = await llama.loadModel(parameters(modelB));
    expect(killPortCalled).toBe(1);
    expect(externalModel).toBeUndefined();
    expect(spawnedModel).toBe(modelB);
    await lease.stop();
  });
});

