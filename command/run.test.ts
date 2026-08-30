import { describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { runCommand, resolveSpawnCommand } from "./run.ts";

describe("resolveSpawnCommand", () => {
    test("wraps string command in shell execution", () => {
        const cmd = resolveSpawnCommand("ls /home");
        expect(cmd.length).toBe(3);
        expect(cmd[2]).toBe("ls /home");
    });

    test("wraps single-element array with spaces in shell execution", () => {
        const cmd = resolveSpawnCommand(["ls /home"]);
        expect(cmd.length).toBe(3);
        expect(cmd[2]).toBe("ls /home");
    });

    test("keeps multi-argument array intact when no shell characters are present", () => {
        const cmd = resolveSpawnCommand(["echo", "hello"]);
        expect(cmd).toEqual(["echo", "hello"]);
    });

    test("wraps in shell when shell: true is specified", () => {
        const cmd = resolveSpawnCommand(["echo", "hello"], true);
        expect(cmd.length).toBe(3);
        expect(cmd[2]).toBe("echo hello");
    });
});

describe("runCommand", () => {
    test("runs command with single string containing arguments", async () => {
        const output = await runCommand({
            commands: "echo 'hello world'",
        });
        expect(typeof output).toBe("string");
        expect((output as string).trim()).toBe("hello world");
    });

    test("runs command with array containing single command string with spaces", async () => {
        const output = await runCommand({
            commands: ["echo 'from array'"],
        });
        expect(typeof output).toBe("string");
        expect((output as string).trim()).toBe("from array");
    });

    test("runs command with binary and args array", async () => {
        const output = await runCommand({
            commands: ["echo", "direct"],
        });
        expect(typeof output).toBe("string");
        expect((output as string).trim()).toBe("direct");
    });

    test("runs command with pipes in shell mode", async () => {
        const output = await runCommand({
            commands: "echo 'bun rocks' | tr a-z A-Z",
        });
        expect(typeof output).toBe("string");
        expect((output as string).trim()).toBe("BUN ROCKS");
    });

    test("returns subprocess instance in blob mode", async () => {
        const proc = await runCommand({
            commands: ["echo", "background"],
            response: "blob",
        });
        expect(typeof proc).toBe("object");
        if (typeof proc === "object" && proc !== null && "status" in proc) {
            await (proc as Deno.ChildProcess).status;
        }
    });

    test("terminates hanging command when timeout is exceeded", async () => {
        let error: Error | undefined;
        try {
            await runCommand({
                commands: ["sleep", "5"],
                timeout: 50,
            });
        } catch (e) {
            error = e as Error;
        }
        expect(error).toBeDefined();
        expect(error?.message).toContain("timed out after 50ms");
    });
});
