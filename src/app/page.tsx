"use client";

import { useState, FormEvent, useEffect } from "react";
import StructureViewer from "./components/StructureViewer";

interface ParsedMutation {
  gene: string;
  original: string;
  position: number;
  mutant: string;
}

interface ProteinInfo {
  uniprotId: string;
  proteinName: string;
  geneName: string;
  function: string;
  domains: { name: string; start: number; end: number }[];
}

interface StructureData {
  pdbData: string;
  avgPlddt: number;
  modelUrl: string;
}

function parseMutation(input: string): ParsedMutation | null {
  const trimmed = input.trim();
  const match = trimmed.match(
    /^([A-Za-z][A-Za-z0-9]*)\s+([A-Za-z])(\d+)([A-Za-z])$/
  );
  if (!match) return null;
  return {
    gene: match[1].toUpperCase(),
    original: match[2].toUpperCase(),
    position: parseInt(match[3], 10),
    mutant: match[4].toUpperCase(),
  };
}

/** Extract average B-factor (pLDDT) for a specific residue from PDB text */
function getResiduePlddt(pdbData: string, resi: number): number | null {
  let sum = 0;
  let count = 0;
  for (const line of pdbData.split("\n")) {
    if (!line.startsWith("ATOM  ")) continue;
    const resSeq = parseInt(line.substring(22, 26).trim(), 10);
    if (resSeq !== resi) continue;
    const bFactor = parseFloat(line.substring(60, 66).trim());
    if (!isNaN(bFactor)) {
      sum += bFactor;
      count++;
    }
  }
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

/** Find which domain a position falls in */
function findDomain(
  domains: { name: string; start: number; end: number }[],
  position: number
): string | null {
  const d = domains.find((d) => position >= d.start && position <= d.end);
  return d ? d.name : null;
}

const AMINO_ACIDS: Record<string, string> = {
  A: "Alanine", R: "Arginine", N: "Asparagine", D: "Aspartic acid",
  C: "Cysteine", E: "Glutamic acid", Q: "Glutamine", G: "Glycine",
  H: "Histidine", I: "Isoleucine", L: "Leucine", K: "Lysine",
  M: "Methionine", F: "Phenylalanine", P: "Proline", S: "Serine",
  T: "Threonine", W: "Tryptophan", Y: "Tyrosine", V: "Valine",
};

// Hardcoded pathogenicity data for TP53 R175H
const KNOWN_ANNOTATIONS: Record<
  string,
  { alphamissense: string; clinvar: string }
> = {
  "TP53_R175H": {
    alphamissense: "0.9461 (likely_pathogenic)",
    clinvar: "Pathogenic — Li-Fraumeni syndrome",
  },
};

function getAnnotations(gene: string, mutation: string) {
  const key = `${gene}_${mutation}`;
  return KNOWN_ANNOTATIONS[key] || null;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [mutation, setMutation] = useState<ParsedMutation | null>(null);
  const [protein, setProtein] = useState<ProteinInfo | null>(null);
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [explainLoading, setExplainLoading] = useState(false);

  // Derived values
  const mutationNotation = mutation
    ? `${mutation.original}${mutation.position}${mutation.mutant}`
    : "";
  const domainName =
    mutation && protein
      ? findDomain(protein.domains, mutation.position)
      : null;
  const residuePlddt =
    mutation && structure
      ? getResiduePlddt(structure.pdbData, mutation.position)
      : null;
  const annotations = mutation
    ? getAnnotations(mutation.gene, mutationNotation)
    : null;

  // Fetch AI explanation once all data is ready
  useEffect(() => {
    if (!mutation || !protein || !structure) return;

    const notation = `${mutation.original}${mutation.position}${mutation.mutant}`;
    const ann = getAnnotations(mutation.gene, notation);
    const domain = findDomain(protein.domains, mutation.position);
    const plddt = getResiduePlddt(structure.pdbData, mutation.position);

    setExplainLoading(true);
    setExplanation("");

    fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proteinName: protein.proteinName,
        geneName: protein.geneName,
        mutation: notation,
        domain: domain ?? "No annotated domain",
        plddt: plddt ?? structure.avgPlddt,
        alphamissense: ann?.alphamissense ?? "Not available",
        clinvar: ann?.clinvar ?? "Not available",
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.explanation) setExplanation(data.explanation);
        else setExplanation("Could not generate explanation.");
      })
      .catch(() => setExplanation("Failed to connect to AI service."))
      .finally(() => setExplainLoading(false));
  }, [mutation, protein, structure]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMutation(null);
    setProtein(null);
    setStructure(null);
    setExplanation("");

    if (!query.trim()) {
      setError("Please enter a mutation.");
      return;
    }

    const parsed = parseMutation(query);
    if (!parsed) {
      setError(
        'Invalid format. Expected something like "TP53 R175H" (gene name + amino acid change).'
      );
      return;
    }

    setMutation(parsed);
    setLoading(true);

    try {
      const lookupRes = await fetch(
        `/api/lookup?gene=${encodeURIComponent(parsed.gene)}`
      );
      const lookupData = await lookupRes.json();

      if (!lookupRes.ok) {
        setError(lookupData.error || "Failed to look up gene.");
        setLoading(false);
        return;
      }

      setProtein(lookupData);

      const structRes = await fetch(
        `/api/structure?uniprotId=${encodeURIComponent(lookupData.uniprotId)}`
      );
      const structData = await structRes.json();

      if (!structRes.ok) {
        setError(structData.error || "Failed to fetch structure.");
        setLoading(false);
        return;
      }

      setStructure(structData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-12">
      {/* Header + Search */}
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-white">
          MutaView
        </h1>
        <p className="mb-8 text-zinc-400">
          Parse and explore protein mutations
        </p>

        <form onSubmit={handleSubmit} className="mx-auto w-full max-w-lg">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter mutation (e.g. TP53 R175H)"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Search"}
            </button>
          </div>
        </form>

        {error && (
          <div className="mx-auto mt-6 max-w-lg rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-left text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {mutation && (
        <div className="mx-auto mt-10 max-w-7xl space-y-6">
          {/* Mutation summary bar */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
              <div>
                <span className="text-zinc-400">Gene </span>
                <span className="font-mono text-lg font-semibold text-emerald-400">
                  {mutation.gene}
                </span>
              </div>
              <div>
                <span className="text-zinc-400">Mutation </span>
                <span className="font-mono text-lg font-semibold text-white">
                  {mutationNotation}
                </span>
              </div>
              <div>
                <span className="text-zinc-400">
                  {AMINO_ACIDS[mutation.original] ?? mutation.original} &rarr;{" "}
                  {AMINO_ACIDS[mutation.mutant] ?? mutation.mutant}
                </span>
              </div>
              {protein && (
                <div className="ml-auto">
                  <span className="text-zinc-400">UniProt </span>
                  <a
                    href={`https://www.uniprot.org/uniprot/${protein.uniprotId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-blue-400 hover:text-blue-300"
                  >
                    {protein.uniprotId}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Loading indicator */}
          {loading && (
            <div className="flex items-center justify-center gap-3 py-12 text-zinc-400">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>
                {!protein
                  ? "Looking up protein on UniProt..."
                  : "Fetching AlphaFold structure..."}
              </span>
            </div>
          )}

          {/* 3D Viewer + Verdict Panel side by side */}
          {structure && (
            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              {/* 3D Viewer — main visual */}
              <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">
                    3D Structure
                    <span className="ml-2 text-sm font-normal text-zinc-400">
                      AlphaFold &middot; avg pLDDT {structure.avgPlddt}
                    </span>
                  </h2>
                  <a
                    href={structure.modelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    View on AlphaFold &rarr;
                  </a>
                </div>
                <StructureViewer
                  pdbData={structure.pdbData}
                  mutationPosition={mutation.position}
                  mutationOriginal={mutation.original}
                  mutationMutant={mutation.mutant}
                />
              </div>

              {/* Verdict Panel sidebar */}
              <div className="space-y-4">
                {/* Verdict card */}
                <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    Verdict
                  </h2>
                  <dl className="space-y-4 text-sm">
                    {/* Protein */}
                    <div>
                      <dt className="text-zinc-500 text-xs uppercase tracking-wider">
                        Protein
                      </dt>
                      <dd className="mt-1 text-white">
                        {protein?.proteinName ?? mutation.gene}
                      </dd>
                    </div>

                    {/* Domain */}
                    <div>
                      <dt className="text-zinc-500 text-xs uppercase tracking-wider">
                        Domain
                      </dt>
                      <dd className="mt-1">
                        {domainName ? (
                          <span className="rounded bg-red-950/50 border border-red-800 px-2 py-0.5 text-red-300">
                            {domainName}
                          </span>
                        ) : (
                          <span className="text-zinc-400">
                            No annotated domain
                          </span>
                        )}
                      </dd>
                    </div>

                    {/* pLDDT at site */}
                    <div>
                      <dt className="text-zinc-500 text-xs uppercase tracking-wider">
                        pLDDT at position {mutation.position}
                      </dt>
                      <dd className="mt-1">
                        {residuePlddt !== null ? (
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-lg font-semibold text-white">
                              {residuePlddt}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {residuePlddt >= 90
                                ? "Very high confidence"
                                : residuePlddt >= 70
                                  ? "Confident"
                                  : residuePlddt >= 50
                                    ? "Low confidence"
                                    : "Very low confidence"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-zinc-400">N/A</span>
                        )}
                      </dd>
                    </div>

                    {/* AlphaMissense */}
                    <div>
                      <dt className="text-zinc-500 text-xs uppercase tracking-wider">
                        AlphaMissense
                      </dt>
                      <dd className="mt-1">
                        {annotations ? (
                          <span className="rounded bg-red-950/50 border border-red-800 px-2 py-0.5 text-red-300">
                            {annotations.alphamissense}
                          </span>
                        ) : (
                          <span className="text-zinc-500 italic">
                            No data available
                          </span>
                        )}
                      </dd>
                    </div>

                    {/* ClinVar */}
                    <div>
                      <dt className="text-zinc-500 text-xs uppercase tracking-wider">
                        ClinVar
                      </dt>
                      <dd className="mt-1">
                        {annotations ? (
                          <span className="rounded bg-red-950/50 border border-red-800 px-2 py-0.5 text-red-300">
                            {annotations.clinvar}
                          </span>
                        ) : (
                          <span className="text-zinc-500 italic">
                            No data available
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* AI Explanation card */}
                <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white">
                      AI
                    </div>
                    <h2 className="text-sm font-semibold text-white">
                      Clinical Interpretation
                    </h2>
                  </div>
                  {explainLoading ? (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generating explanation...
                    </div>
                  ) : explanation ? (
                    <p className="text-sm leading-relaxed text-zinc-300">
                      {explanation}
                    </p>
                  ) : null}
                  <p className="mt-3 text-[10px] text-zinc-600">
                    Generated by Gemini &middot; Not a clinical diagnosis
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Protein info + Domains */}
          {protein && (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  Protein Info
                </h2>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-zinc-400">Protein name</dt>
                    <dd className="mt-0.5 text-white">{protein.proteinName}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Gene</dt>
                    <dd className="mt-0.5 font-mono text-emerald-400">
                      {protein.geneName}
                    </dd>
                  </div>
                  {protein.function && (
                    <div>
                      <dt className="text-zinc-400">Function</dt>
                      <dd className="mt-0.5 leading-relaxed text-zinc-300">
                        {protein.function}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  Domains
                </h2>
                {protein.domains.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {protein.domains.map((d, i) => {
                      const mutInDomain =
                        mutation.position >= d.start &&
                        mutation.position <= d.end;
                      return (
                        <li
                          key={i}
                          className={`flex items-center justify-between rounded px-3 py-2 ${
                            mutInDomain
                              ? "border border-red-800 bg-red-950/30"
                              : "bg-zinc-800"
                          }`}
                        >
                          <span className="text-zinc-200">{d.name}</span>
                          <span className="font-mono text-xs text-zinc-400">
                            {d.start}–{d.end}
                            {mutInDomain && (
                              <span className="ml-2 text-red-400">
                                mutation site
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-500">
                    No domain annotations available.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
