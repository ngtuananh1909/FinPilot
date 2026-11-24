import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AiRuntimeConfig } from "@/lib/ai/config";

export const FAKE_KEY = "sk-test-SECRET-0123456789abcdef";

export interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

export type Handler = (req: Recorded, res: ServerResponse) => void;

/** Local OpenAI-compatible fake bound to 127.0.0.1 on a random port. No external network. */
export async function startFakeProvider(handler: Handler): Promise<{
  url: string;
  requests: Recorded[];
  setHandler: (h: Handler) => void;
  close: () => Promise<void>;
}> {
  let current = handler;
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const rec: Recorded = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: text ? JSON.parse(text) : {} };
      requests.push(rec);
      current(rec, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1/`,
    requests,
    setHandler: (h) => {
      current = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

export const completion = (message: Record<string, unknown>, finish = "stop") => ({
  id: "cmpl-1",
  choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

export function configFor(url: string, over: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    provider: "openrouter",
    baseUrl: url,
    apiKey: FAKE_KEY,
    model: "test/model",
    visionModel: "test/vision",
    timeoutMs: 2_000,
    maxToolSteps: 4,
    appUrl: "http://localhost:3000",
    ...over,
  };
}
