import { NextResponse } from "next/server";

interface ESMFoldRequest {
  sequence: string;
  position: number;
  original: string;
  mutant: string;
}

export async function POST(request: Request) {
  try {
    const body: ESMFoldRequest = await request.json();
    const { sequence, position, original, mutant } = body;

    // 1. Validate all fields are present
    if (!sequence || position === undefined || position === null || !original || !mutant) {
      return NextResponse.json(
        { error: "Missing required fields: sequence, position, original, mutant" },
        { status: 400 }
      );
    }

    // 2. Validate position is >= 1 and <= sequence.length
    if (position < 1 || position > sequence.length) {
      return NextResponse.json(
        {
          error: `Position ${position} is out of range. Must be between 1 and ${sequence.length}.`,
        },
        { status: 400 }
      );
    }

    // 3. Resolve the actual position — handle clinical vs UniProt numbering offsets
    let resolvedPosition = position;
    let correctedPosition: number | null = null;
    let note: string | null = null;

    const actual = sequence[position - 1];
    if (actual.toUpperCase() !== original.toUpperCase()) {
      // Search within ±5 positions for the expected amino acid
      let found = false;
      for (let offset = -5; offset <= 5; offset++) {
        if (offset === 0) continue;
        const idx = position - 1 + offset;
        if (idx < 0 || idx >= sequence.length) continue;
        if (sequence[idx].toUpperCase() === original.toUpperCase()) {
          resolvedPosition = idx + 1; // back to 1-indexed
          correctedPosition = resolvedPosition;
          note = `Note: ${original} found at position ${resolvedPosition} instead of ${position} (common numbering offset).`;
          found = true;
          break;
        }
      }
      if (!found) {
        return NextResponse.json(
          {
            error: `Expected ${original} at position ${position} but found ${actual}. Could not find ${original} within ±5 positions.`,
          },
          { status: 400 }
        );
      }
    }

    // 4. Check sequence length limit
    if (sequence.length > 400) {
      return NextResponse.json(
        {
          error: `Sequence is ${sequence.length} residues. ESMFold server limit is 400.`,
        },
        { status: 400 }
      );
    }

    // 5. Create mutant sequence by replacing character at resolvedPosition-1 with mutant amino acid (uppercase)
    const mutantSequence =
      sequence.substring(0, resolvedPosition - 1) +
      mutant.toUpperCase() +
      sequence.substring(resolvedPosition);

    // 6. POST the raw mutant sequence string to ESMFold API
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let response: Response;
    try {
      response = await fetch(
        "https://api.esmatlas.com/foldSequence/v1/pdb/",
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: mutantSequence,
          signal: controller.signal,
        }
      );
    } catch (fetchError: unknown) {
      clearTimeout(timeout);
      // Catch AbortError (timeout) separately
      if (
        fetchError instanceof DOMException &&
        fetchError.name === "AbortError"
      ) {
        return NextResponse.json(
          { error: "ESMFold prediction timed out after 2 minutes" },
          { status: 500 }
        );
      }
      // Catch other fetch errors
      const message =
        fetchError instanceof Error ? fetchError.message : String(fetchError);
      return NextResponse.json(
        {
          error: `Failed to connect to ESMFold API: ${message}. The server may be temporarily unavailable.`,
        },
        { status: 500 }
      );
    }

    clearTimeout(timeout);

    // 7. If the ESMFold API returns non-ok, return 500 with the error text
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: errorText },
        { status: 500 }
      );
    }

    // 8. Calculate avgPlddt from the returned PDB data
    const pdbData = await response.text();

    const atomLines = pdbData
      .split("\n")
      .filter((line) => line.startsWith("ATOM  "));

    let bFactorSum = 0;
    let bFactorCount = 0;
    for (const line of atomLines) {
      const bFactorStr = line.substring(60, 66).trim();
      const bFactor = parseFloat(bFactorStr);
      if (!isNaN(bFactor)) {
        bFactorSum += bFactor;
        bFactorCount++;
      }
    }

    const avgPlddt =
      bFactorCount > 0
        ? Math.round((bFactorSum / bFactorCount) * 10) / 10
        : 0;

    // 9. Return JSON response
    return NextResponse.json({
      pdbData,
      avgPlddt,
      mutantSequence,
      sequenceLength: mutantSequence.length,
      correctedPosition,
      note,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
