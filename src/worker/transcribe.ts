import { createReadStream, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { getWorkerConfig } from "./config";

export async function transcribe(audioPath: string, outputPath: string): Promise<string> {
  const workerConfig = getWorkerConfig();
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
