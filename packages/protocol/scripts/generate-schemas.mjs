import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMAS_DIR = resolve(__dirname, "../src/schemas");

// Dynamic import of built or ts source
const {
  envelopeSchema,
  requestSchema,
  responseSchema,
  eventSchema,
  errorSchema
} = await import("../dist/schemas/canonical-schemas.js");

const targets = [
  ["envelope.schema.json", envelopeSchema],
  ["request.schema.json", requestSchema],
  ["response.schema.json", responseSchema],
  ["event.schema.json", eventSchema],
  ["error.schema.json", errorSchema]
];

for (const [filename, schema] of targets) {
  const dest = resolve(SCHEMAS_DIR, filename);
  writeFileSync(dest, JSON.stringify(schema, null, 2) + "\n", "utf8");
}

console.log("Successfully generated protocol JSON schemas from canonical definitions.");
