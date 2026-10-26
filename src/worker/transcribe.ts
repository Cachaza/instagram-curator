import { createReadStream, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import OpenAI from "openai";
import { getWorkerConfig } from "./config";
import { runCommand } from "./process";

export async function transcribe(audioPath: string, outputPath: string): Promise<string> {
  const workerConfig = getWorkerConfig();
  if (workerConfig.transcriptionProvider === "local") {
    const command = workerConfig.localTranscriptionCommand;
    if (!Array.isArray(command) || !command.length || command.some((arg) => typeof arg !== "string" || !arg)) {
      throw new Error("Local transcription requires transcription.local_command as a non-empty argv array; configure the local Python and transcribe-local.py paths. No API fallback is used.");
    }
    // The existing local CLI validates completion before exiting successfully.
    // Keep every attempt's raw response, including rejected generations.
    const directory = mkdtempSync(join(dirname(outputPath), "local-transcription-"));
    await runCommand([...command, audioPath, directory]);
    const result = JSON.parse(readFileSync(join(directory, "transcript.raw.json"), "utf8")) as { text?: unknown };
    if (typeof result.text !== "string" || !result.text.trim()) {
      throw new Error(`Local transcription returned no text; response preserved in ${directory}`);
    }
    const text = result.text.trim();
    writeFileSync(outputPath, text, "utf8");
    return text;
  }
  if (workerConfig.transcriptionProvider !== "openai") {
    throw new Error(`Unsupported transcription provider: ${workerConfig.transcriptionProvider}`);
  }
  if (!workerConfig.openaiApiKey) {
    throw new Error("OpenAI transcription is not configured in setup");
  }
  const client = new OpenAI({ apiKey: workerConfig.openaiApiKey });
  const result = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: workerConfig.transcriptionModel,
    response_format: "text",
  });
  const text = typeof result === "string" ? result : String(result);
  writeFileSync(outputPath, text, "utf8");
  return text;
}
