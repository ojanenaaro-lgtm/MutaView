import { NextRequest, NextResponse } from "next/server";
import { getGeminiApiKey, GEMINI_BASE_URL } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const {
    proteinName,
    geneName,
    mutation,
    domain,
    plddt,
    alphamissense,
    clinvar,
  } = body as {
    proteinName?: string;
    geneName?: string;
    mutation?: string;
    domain?: string;
    plddt?: number;
    alphamissense?: string;
    clinvar?: string;
  };

  // Validate required fields
  const missing: string[] = [];
  if (!proteinName) missing.push("proteinName");
  if (!geneName) missing.push("geneName");
  if (!mutation) missing.push("mutation");
  if (!domain) missing.push("domain");
  if (plddt === undefined || plddt === null) missing.push("plddt");
  if (!alphamissense) missing.push("alphamissense");
  if (!clinvar) missing.push("clinvar");

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // Obtain API key
  let apiKey: string;
  try {
    apiKey = getGeminiApiKey();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to retrieve Gemini API key";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Build the prompt
  const prompt = `You are a structural biology expert explaining a protein mutation to a physician. Be concise (2-3 sentences).

Protein: ${proteinName} (${geneName})
Mutation: ${mutation}
Domain: ${domain}
AlphaFold pLDDT at mutation site: ${plddt}
AlphaMissense pathogenicity: ${alphamissense}
ClinVar classification: ${clinvar}

Explain in plain language why this mutation is likely damaging to protein function. Reference the structural context (domain, confidence) and clinical significance.`;

  // Call the Gemini API
  try {
    const url = `${GEMINI_BASE_URL}/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const geminiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      return NextResponse.json(
        {
          error: `Gemini API error (${geminiResponse.status}): ${errorText}`,
        },
        { status: 500 }
      );
    }

    const data = await geminiResponse.json();
    const explanation = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!explanation) {
      return NextResponse.json(
        { error: "Gemini API returned an unexpected response structure" },
        { status: 500 }
      );
    }

    return NextResponse.json({ explanation });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error calling Gemini API";
    return NextResponse.json(
      { error: `Gemini API request failed: ${message}` },
      { status: 500 }
    );
  }
}
