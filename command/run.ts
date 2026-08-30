/**
 * Opciones de configuración para la ejecución de comandos del sistema.
 */
export interface RunCommandOptions {
    /** Comando en string (ej. `"ls /home"`) o lista con el binario y sus argumentos (ej. `["llama-server", "--version"]`). */
    commands: string[] | string;
    /** Formato de respuesta esperado. `"text"` para obtener la salida estándar como string, o `"blob"` para recibir la instancia del subproceso (`Deno.ChildProcess`). Por defecto `"text"`. */
    response?: "text" | "blob";
    /** Ejecutar dentro de un shell específico o habilitar ejecución en shell. */
    shell?: boolean | string;
    /** Directorio de trabajo actual para la ejecución. */
    cwd?: string;
    /** Variables de entorno personalizadas. */
    env?: Record<string, string | undefined>;
}

/**
 * Resuelve los argumentos adecuados para pasar a `Deno.Command`, asegurando que comandos
 * con espacios, pipes o formato string sean ejecutados a través del shell correspondiente.
 */
export function resolveSpawnCommand(
    commands: string[] | string,
    shellOption?: boolean | string,
): string[] {
    const isWindows = Deno.build.os === "windows";
    const defaultShell = isWindows
        ? (Deno.env.get("COMSPEC") || "cmd.exe")
        : (Deno.env.get("SHELL") || "/bin/sh");

    const shellBinary = typeof shellOption === "string" ? shellOption : defaultShell;
    const shellFlag = isWindows && shellBinary.toLowerCase().includes("cmd") ? "/c" : "-c";

    if (typeof commands === "string") {
        return [shellBinary, shellFlag, commands];
    }

    if (shellOption) {
        return [shellBinary, shellFlag, commands.join(" ")];
    }

    if (commands.length === 1 && commands[0]) {
        const cmd = commands[0];
        // Si el único elemento contiene espacios o caracteres especiales del shell, delegar al shell
        if (
            cmd.includes(" ") ||
            cmd.includes("|") ||
            cmd.includes(">") ||
            cmd.includes("<") ||
            cmd.includes("&") ||
            cmd.includes(";") ||
            cmd.includes("$") ||
            cmd.includes("*")
        ) {
            return [shellBinary, shellFlag, cmd];
        }
    }

    return commands;
}

/**
 * Ejecuta un comando en el sistema operativo utilizando la API `Deno.Command`.
 *
 * Permite ejecutar subprocesos de forma asíncrona y obtener su salida textual
 * (capturando stdout o stderr) o bien retornar directamente la instancia del subproceso
 * para un control manual de ciclo de vida (útil para servidores o procesos de larga duración).
 *
 * @param options - Opciones de configuración para la ejecución del comando.
 * @param options.commands - Comando como string o array con el binario y sus argumentos.
 * @param options.response - Tipo de respuesta deseada: `"text"` (por defecto) o `"blob"`.
 * @param options.shell - Ejecutar dentro de un shell o ruta a shell específico.
 * @param options.cwd - Directorio de trabajo opcional.
 * @param options.env - Variables de entorno opcionales.
 * @returns Promesa que resuelve a un `string` con la salida si `response === "text"`, o a un `Deno.ChildProcess` si `response === "blob"`.
 * @throws Propaga cualquier error ocurrido durante la creación o ejecución del proceso.
 */
export async function runCommand({
    commands,
    response = "text",
    shell,
    cwd,
    env,
}: RunCommandOptions): Promise<
    string | Deno.ChildProcess
> {
    const stdoutOpt = response === "text" ? "piped" : "null";
    const stderrOpt = response === "text" ? "piped" : "null";

    const cmdToSpawn = resolveSpawnCommand(commands, shell);
    const binary = cmdToSpawn[0];
    const args = cmdToSpawn.slice(1);

    if (!binary) {
        throw new Error("No command binary specified");
    }

    try {
        let processEnv: Record<string, string> | undefined = undefined;
        if (env) {
            processEnv = {};
            for (const [key, value] of Object.entries(env)) {
                if (value !== undefined) {
                    processEnv[key] = value;
                }
            }
        }

        const commandOptions: Deno.CommandOptions = {
            args,
            stdin: "null",
            stdout: stdoutOpt,
            stderr: stderrOpt,
            cwd,
        };

        if (processEnv) {
            commandOptions.env = processEnv;
        }

        const command = new Deno.Command(binary, commandOptions);

        if (response === "blob") {
            return command.spawn();
        }

        const result = await command.output();
        const decoder = new TextDecoder();
        const stdoutText = decoder.decode(result.stdout);
        const stderrText = decoder.decode(result.stderr);

        const output = stdoutText.trim() ? stdoutText : stderrText;
        return output;
    } catch (error) {
        throw error;
    }
}
