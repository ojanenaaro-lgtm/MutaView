import { NextResponse } from "next/server";

interface AlphaFoldPrediction {
  pdbUrl?: string;
  paeImageUrl?: string;
  cifUrl?: string;
  [key: string]: unknown;
}

function calculateAveragePlddt(pdbData: string): number {
  let sum = 0;
  let count = 0;

  const lines = pdbData.split("\n");
  for (const line of lines) {
    if (line.startsWith("ATOM  ") || line.startsWith("ATOM\t")) {
      // B-factor occupies columns 61-66 (1-indexed) in PDB format
      const bFactorStr = line.substring(60, 66).trim();
      const bFactor = parseFloat(bFactorStr);
      if (!isNaN(bFactor)) {
        sum += bFactor;
        count++;
      }
    }
  }

  if (count === 0) {
    return 0;
  }

  return Math.round((sum / count) * 10) / 10;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uniprotId = searchParams.get("uniprotId");

  if (!uniprotId) {
    return NextResponse.json(
      { error: "Missing required query parameter: uniprotId" },
      { status: 400 }
    );
  }

  // Fetch prediction metadata from AlphaFold API
  let predictions: AlphaFoldPrediction[];
  try {
    const alphaFoldRes = await fetch(
      `https://alphafold.ebi.ac.uk/api/prediction/${uniprotId}`
    );

    if (alphaFoldRes.status === 404) {
      return NextResponse.json(
        { error: `No AlphaFold prediction found for UniProt ID: ${uniprotId}` },
        { status: 404 }
      );
    }

    if (!alphaFoldRes.ok) {
      return NextResponse.json(
        { error: `AlphaFold API returned status ${alphaFoldRes.status}` },
        { status: 500 }
      );
    }

    predictions = await alphaFoldRes.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch AlphaFold prediction: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  if (!Array.isArray(predictions) || predictions.length === 0) {
    return NextResponse.json(
      { error: `No AlphaFold prediction found for UniProt ID: ${uniprotId}` },
      { status: 404 }
    );
  }

  const prediction = predictions[0];
  const pdbUrl = prediction.pdbUrl;

  if (!pdbUrl) {
    return NextResponse.json(
      { error: "AlphaFold prediction does not include a PDB file URL" },
      { status: 500 }
    );
  }

  // Fetch the actual PDB file content
  let pdbData: string;
  try {
    const pdbRes = await fetch(pdbUrl);

    if (!pdbRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch PDB file: HTTP ${pdbRes.status}` },
        { status: 500 }
      );
    }

    pdbData = await pdbRes.text();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch PDB file: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const avgPlddt = calculateAveragePlddt(pdbData);
  const modelUrl = `https://alphafold.ebi.ac.uk/entry/${uniprotId}`;

  return NextResponse.json({
    pdbUrl,
    pdbData,
    avgPlddt,
    modelUrl,
  });
}
