import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gene = searchParams.get("gene");

  if (!gene) {
    return NextResponse.json(
      { error: "Missing required query parameter: gene" },
      { status: 400 },
    );
  }

  const uniprotUrl =
    `https://rest.uniprot.org/uniprotkb/search?` +
    `query=(gene:${encodeURIComponent(gene)})+AND+(organism_id:9606)+AND+(reviewed:true)` +
    `&format=json` +
    `&fields=accession,gene_names,protein_name,ft_domain,cc_function`;

  try {
    const response = await fetch(uniprotUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `UniProt API request failed with status ${response.status}` },
        { status: 500 },
      );
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return NextResponse.json(
        { error: `No results found for gene: ${gene}` },
        { status: 404 },
      );
    }

    const entry = data.results[0];

    // Extract the primary accession
    const uniprotId: string = entry.primaryAccession ?? "";

    // Extract the recommended protein name
    const proteinName: string =
      entry.proteinDescription?.recommendedName?.fullName?.value ?? "";

    // Extract the primary gene name
    const geneName: string = entry.genes?.[0]?.geneName?.value ?? "";

    // Extract the function description from comments (cc_function)
    const functionComment = (entry.comments ?? []).find(
      (c: { commentType?: string }) => c.commentType === "FUNCTION",
    );
    const functionText: string =
      functionComment?.texts?.[0]?.value ?? "";

    // Extract domain annotations from features (ft_domain)
    const domains: { name: string; start: number; end: number }[] = (
      entry.features ?? []
    )
      .filter((f: { type?: string }) => f.type === "Domain")
      .map((f: { description?: string; location?: { start?: { value?: number }; end?: { value?: number } } }) => ({
        name: f.description ?? "",
        start: f.location?.start?.value ?? 0,
        end: f.location?.end?.value ?? 0,
      }));

    return NextResponse.json({
      uniprotId,
      proteinName,
      geneName,
      function: functionText,
      domains,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch from UniProt API: ${message}` },
      { status: 500 },
    );
  }
}
