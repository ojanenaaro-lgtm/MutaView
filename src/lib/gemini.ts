export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your-gemini-api-key-here") {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local"
    );
  }
  return key;
}

export const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
