import Anthropic from "@anthropic-ai/sdk";
import Journal, {
  IJournal,
  JournalProperty,
  JournalRow,
} from "../models/journal.model";
import { AppError } from "../middleware/errorHandler";
import { env } from "../config/env";
import mongoose from "mongoose";

// Default to Haiku 4.5 — fast & cheap for short cell content. Sonnet 4.6 / Opus
// 4.7 can be opted into per-column via JournalAiConfig.model.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Cost guardrails — summary/key-info are short, custom/translation can be longer.
const MAX_TOKENS: Record<string, number> = {
  summary: 1024,
  "key-info": 1024,
  custom: 4096,
  translation: 4096,
};

let cachedClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (cachedClient) return cachedClient;
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(
      503,
      "AI generation is not configured. Set ANTHROPIC_API_KEY on the server.",
    );
  }
  cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cachedClient;
}

function normalizeObjectId(id: string, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(400, `${label} is invalid`);
  }
  return new mongoose.Types.ObjectId(id);
}

/** Render row cells as labeled context for the prompt. Skips empty + AI cells. */
function renderRowContext(
  row: JournalRow,
  properties: JournalProperty[],
  sourcePropertyIds: string[] | undefined,
  excludePropertyId: string,
): string {
  const include = (prop: JournalProperty): boolean => {
    if (prop.id === excludePropertyId) return false;
    if (prop.type === "ai") return false; // never feed AI output back as context (avoid loops)
    if (sourcePropertyIds && sourcePropertyIds.length > 0) {
      return sourcePropertyIds.includes(prop.id);
    }
    return true;
  };

  const lines: string[] = [];
  for (const prop of properties) {
    if (!include(prop)) continue;
    const raw = row.cells[prop.id];
    if (raw == null || raw === "") continue;
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (!value.trim()) continue;
    lines.push(`- ${prop.name}: ${value}`);
  }
  return lines.join("\n");
}

function buildPrompt(
  property: JournalProperty,
  row: JournalRow,
  properties: JournalProperty[],
): { system: string; user: string } {
  const config = property.ai!;
  const context = renderRowContext(
    row,
    properties,
    config.sourcePropertyIds,
    property.id,
  );

  const baseSystem =
    "You generate concise, factual content for a trader's journal entry. " +
    "Output only the requested content — no preamble, no markdown headers, no quotes around the answer.";

  switch (config.kind) {
    case "summary":
      return {
        system: baseSystem,
        user:
          (config.prompt?.trim() ||
            "Summarize this trade in one paragraph (2–4 sentences).") +
          "\n\nTrade details:\n" +
          (context || "(no other fields filled yet)"),
      };
    case "key-info":
      return {
        system: baseSystem,
        user:
          (config.prompt?.trim() ||
            "Extract the 3 most important takeaways from this trade as a short bullet list (use '-' as the bullet).") +
          "\n\nTrade details:\n" +
          (context || "(no other fields filled yet)"),
      };
    case "custom": {
      const prompt = config.prompt?.trim();
      if (!prompt) {
        throw new AppError(
          400,
          "AI custom autofill requires a prompt to be configured on the column.",
        );
      }
      return {
        system: baseSystem,
        user: `${prompt}\n\nTrade details:\n${context || "(no other fields filled yet)"}`,
      };
    }
    case "translation": {
      const targetLanguage = config.targetLanguage?.trim();
      if (!targetLanguage) {
        throw new AppError(
          400,
          "AI translation requires a target language to be configured on the column.",
        );
      }
      const sourceId = config.sourcePropertyIds?.[0];
      if (!sourceId) {
        throw new AppError(
          400,
          "AI translation requires a source column to be configured.",
        );
      }
      const sourceProp = properties.find((p) => p.id === sourceId);
      const sourceRaw = row.cells[sourceId];
      if (sourceRaw == null || sourceRaw === "") {
        throw new AppError(
          400,
          `Source column "${sourceProp?.name ?? sourceId}" is empty — fill it before generating the translation.`,
        );
      }
      const sourceValue = Array.isArray(sourceRaw)
        ? sourceRaw.join(", ")
        : String(sourceRaw);
      return {
        system: baseSystem,
        user: `Translate the following text into ${targetLanguage}. Output only the translation, nothing else.\n\nText:\n${sourceValue}`,
      };
    }
  }
}

interface GenerateArgs {
  userId: string;
  journalId: string;
  rowId: string;
  propertyId: string;
}

export interface GenerateResult {
  journal: IJournal;
  value: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

interface AskArgs {
  userId: string;
  journalId: string;
  question: string;
}

export interface AskResult {
  answer: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

const ASK_MAX_ROWS = 100;
const ASK_MAX_CELL_CHARS = 200;

function summarizeJournalForAsk(journal: IJournal): string {
  const columnList = journal.properties
    .filter((p) => !p.hidden)
    .map((p) => `- ${p.name} (${p.type})`)
    .join("\n");

  // Take the most-recent rows (rows are appended chronologically in v1).
  const recent = journal.rows.slice(-ASK_MAX_ROWS);

  const rowsRendered = recent
    .map((row, idx) => {
      const lines = journal.properties
        .filter((p) => !p.hidden)
        .map((p) => {
          const raw = row.cells[p.id];
          if (raw == null || raw === "") return null;
          const value = Array.isArray(raw)
            ? raw.join(", ")
            : String(raw);
          const truncated =
            value.length > ASK_MAX_CELL_CHARS
              ? `${value.slice(0, ASK_MAX_CELL_CHARS)}…`
              : value;
          return `  ${p.name}: ${truncated}`;
        })
        .filter(Boolean);
      return `Row ${idx + 1}:\n${lines.join("\n")}`;
    })
    .join("\n\n");

  return `Columns:\n${columnList}\n\nRows (${recent.length} most recent of ${journal.rows.length} total):\n\n${rowsRendered || "(no rows)"}`;
}

export class AiColumnService {
  static async askJournal(args: AskArgs): Promise<AskResult> {
    const question = args.question.trim();
    if (!question) {
      throw new AppError(400, "question is required");
    }
    const userObjectId = normalizeObjectId(args.userId, "userId");
    const journalObjectId = normalizeObjectId(args.journalId, "journalId");

    const journal = await Journal.findOne({
      _id: journalObjectId,
      userId: userObjectId,
    });
    if (!journal) throw new AppError(404, "Journal not found");

    const context = summarizeJournalForAsk(journal);
    const system =
      "You are a trading-journal analyst. Answer the user's question using ONLY the journal data below. Be concise (1–4 sentences unless a list is more appropriate). If the data doesn't contain the answer, say so plainly.";
    const user = `Journal data:\n\n${context}\n\nQuestion: ${question}`;

    const client = getAnthropic();
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });

    const answer = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!answer) {
      throw new AppError(502, "AI returned an empty answer");
    }

    return {
      answer,
      model: DEFAULT_MODEL,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };
  }

  static async generateAiCell(args: GenerateArgs): Promise<GenerateResult> {
    const userObjectId = normalizeObjectId(args.userId, "userId");
    const journalObjectId = normalizeObjectId(args.journalId, "journalId");

    const journal = await Journal.findOne({
      _id: journalObjectId,
      userId: userObjectId,
    });
    if (!journal) throw new AppError(404, "Journal not found");

    const property = journal.properties.find((p) => p.id === args.propertyId);
    if (!property) throw new AppError(404, "Property not found");
    if (property.type !== "ai" || !property.ai) {
      throw new AppError(400, "Property is not an AI column");
    }

    const row = journal.rows.find((r) => r.id === args.rowId);
    if (!row) throw new AppError(404, "Journal row not found");

    const { system, user } = buildPrompt(property, row, journal.properties);
    const model = property.ai.model || DEFAULT_MODEL;
    const maxTokens = MAX_TOKENS[property.ai.kind] ?? 1024;

    const client = getAnthropic();
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });

    // Concatenate text blocks (Claude can return multiple content blocks).
    const value = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!value) {
      throw new AppError(502, "AI generation returned an empty response");
    }

    // Persist the generated value into the cell.
    row.cells = { ...row.cells, [args.propertyId]: value };
    row.updatedAt = new Date();
    await journal.save();

    return {
      journal,
      value,
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };
  }
}
