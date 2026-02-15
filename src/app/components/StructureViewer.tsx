"use client";

import { useRef, useEffect, useState } from "react";

declare global {
  interface Window {
    $3Dmol: any;
  }
}

interface StructureViewerProps {
  pdbData: string;
  mutationPosition: number;
  mutationOriginal: string;
  mutationMutant: string;
  mutantPdbData?: string | null;
}

const THREEDMOL_CDN = "https://3dmol.csb.pitt.edu/build/3Dmol-min.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parse CA atom positions from a PDB string, keyed by residue number. */
function parseCaAtoms(pdb: string): Map<number, { x: number; y: number; z: number }> {
  const atoms = new Map<number, { x: number; y: number; z: number }>();
  const lines = pdb.split("\n");
  for (const line of lines) {
    if (!line.startsWith("ATOM  ")) continue;
    const atomName = line.substring(12, 16).trim();
    if (atomName !== "CA") continue;
    const resi = parseInt(line.substring(22, 26).trim(), 10);
    const x = parseFloat(line.substring(30, 38).trim());
    const y = parseFloat(line.substring(38, 46).trim());
    const z = parseFloat(line.substring(46, 54).trim());
    if (!isNaN(resi) && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
      atoms.set(resi, { x, y, z });
    }
  }
  return atoms;
}

/** Compute per-residue RMSD (really just distance for single CA pairs). */
function computePerResidueRmsd(
  wildCa: Map<number, { x: number; y: number; z: number }>,
  mutantCa: Map<number, { x: number; y: number; z: number }>
): Map<number, number> {
  const rmsdMap = new Map<number, number>();
  for (const [resi, wCoord] of wildCa) {
    const mCoord = mutantCa.get(resi);
    if (!mCoord) continue;
    const dx = wCoord.x - mCoord.x;
    const dy = wCoord.y - mCoord.y;
    const dz = wCoord.z - mCoord.z;
    rmsdMap.set(resi, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return rmsdMap;
}

/** Ensure the 3Dmol script is loaded. Returns a cleanup function. */
function load3Dmol(onReady: () => void): () => void {
  let cancelled = false;

  const fire = () => {
    if (!cancelled) onReady();
  };

  if (window.$3Dmol) {
    fire();
    return () => { cancelled = true; };
  }

  const existingScript = document.querySelector(
    `script[src="${THREEDMOL_CDN}"]`
  ) as HTMLScriptElement | null;

  if (existingScript) {
    if (window.$3Dmol) {
      fire();
    } else {
      existingScript.addEventListener("load", fire);
    }
    return () => {
      cancelled = true;
      existingScript.removeEventListener("load", fire);
    };
  }

  const script = document.createElement("script");
  script.src = THREEDMOL_CDN;
  script.addEventListener("load", fire);
  document.head.appendChild(script);

  return () => {
    cancelled = true;
    script.removeEventListener("load", fire);
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StructureViewer({
  pdbData,
  mutationPosition,
  mutationOriginal,
  mutationMutant,
  mutantPdbData,
}: StructureViewerProps) {
  const isDual = Boolean(mutantPdbData);

  // Refs for single-mode
  const singleWrapperRef = useRef<HTMLDivElement>(null);

  // Refs for dual-mode
  const wildWrapperRef = useRef<HTMLDivElement>(null);
  const mutantWrapperRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);

  /* ---- Main effect: build viewers whenever props change ---- */
  useEffect(() => {
    let cancelled = false;

    // Track imperative DOM nodes and viewer instances for cleanup
    let singleMolDiv: HTMLDivElement | null = null;
    let wildMolDiv: HTMLDivElement | null = null;
    let mutantMolDiv: HTMLDivElement | null = null;
    let singleViewer: any = null;
    let wildViewer: any = null;
    let mutantViewer: any = null;

    setLoading(true);

    const cleanup = load3Dmol(() => {
      if (cancelled) return;
      const $3Dmol = window.$3Dmol;
      if (!$3Dmol) return;

      /* ---------- helper: create an imperative div inside a wrapper ---------- */
      function makeMolDiv(wrapper: HTMLDivElement): HTMLDivElement {
        const div = document.createElement("div");
        div.style.width = "100%";
        div.style.height = "100%";
        div.style.position = "relative";
        wrapper.appendChild(div);
        return div;
      }

      /* ---------- helper: apply wild-type styling ---------- */
      function styleWildType(viewer: any, pos: number) {
        // Cartoon colored by pLDDT (B-factor)
        viewer.setStyle(
          {},
          {
            cartoon: {
              colorscheme: {
                prop: "b",
                gradient: "roygb",
                min: 50,
                max: 100,
              },
            },
          }
        );

        // Mutation residue: magenta spheres + sticks layered on cartoon
        viewer.setStyle(
          { resi: pos },
          {
            cartoon: {
              colorscheme: {
                prop: "b",
                gradient: "roygb",
                min: 50,
                max: 100,
              },
            },
            sphere: { color: "magenta", radius: 1.2 },
            stick: { color: "magenta", radius: 0.2 },
          }
        );
      }

      /* ==================== SINGLE MODE ==================== */
      if (!isDual) {
        const wrapper = singleWrapperRef.current;
        if (!wrapper) return;

        singleMolDiv = makeMolDiv(wrapper);
        const viewer = $3Dmol.createViewer(singleMolDiv, {
          backgroundColor: "0x1a1a1a",
        });

        viewer.addModel(pdbData, "pdb");
        styleWildType(viewer, mutationPosition);

        viewer.render();
        viewer.zoomTo({ resi: mutationPosition });
        viewer.zoom(0.6);
        viewer.render();

        singleViewer = viewer;
        if (!cancelled) setLoading(false);
        return;
      }

      /* ==================== DUAL MODE ==================== */
      const wildWrapper = wildWrapperRef.current;
      const mutantWrapper = mutantWrapperRef.current;
      if (!wildWrapper || !mutantWrapper || !mutantPdbData) return;

      // --- Left panel: Wild-type ---
      wildMolDiv = makeMolDiv(wildWrapper);
      const wViewer = $3Dmol.createViewer(wildMolDiv, {
        backgroundColor: "0x1a1a1a",
      });

      wViewer.addModel(pdbData, "pdb");
      styleWildType(wViewer, mutationPosition);

      wViewer.render();
      wViewer.zoomTo({ resi: mutationPosition });
      wViewer.zoom(0.6);
      wViewer.render();

      wildViewer = wViewer;

      // --- Right panel: Mutant with RMSD coloring ---
      const wildCa = parseCaAtoms(pdbData);
      const mutantCa = parseCaAtoms(mutantPdbData);
      const rmsdMap = computePerResidueRmsd(wildCa, mutantCa);

      mutantMolDiv = makeMolDiv(mutantWrapper);
      const mViewer = $3Dmol.createViewer(mutantMolDiv, {
        backgroundColor: "0x1a1a1a",
      });

      mViewer.addModel(mutantPdbData, "pdb");

      // Cartoon colored by per-residue RMSD
      mViewer.setStyle(
        {},
        {
          cartoon: {
            colorfunc: function (atom: any) {
              const rmsd = rmsdMap.get(atom.resi) ?? 0;
              // white (0) -> yellow (2A) -> red (5A+)
              if (rmsd < 2) {
                const t = rmsd / 2;
                const r = Math.round(255);
                const g = Math.round(255);
                const b = Math.round(255 * (1 - t));
                return "rgb(" + r + "," + g + "," + b + ")";
              } else {
                const t = Math.min((rmsd - 2) / 3, 1);
                const r = 255;
                const g = Math.round(255 * (1 - t));
                const b = 0;
                return "rgb(" + r + "," + g + "," + b + ")";
              }
            },
          },
        }
      );

      // Mutation residue: magenta spheres + sticks on top of RMSD cartoon
      mViewer.setStyle(
        { resi: mutationPosition },
        {
          cartoon: {
            colorfunc: function (atom: any) {
              const rmsd = rmsdMap.get(atom.resi) ?? 0;
              if (rmsd < 2) {
                const t = rmsd / 2;
                const r = Math.round(255);
                const g = Math.round(255);
                const b = Math.round(255 * (1 - t));
                return "rgb(" + r + "," + g + "," + b + ")";
              } else {
                const t = Math.min((rmsd - 2) / 3, 1);
                const r = 255;
                const g = Math.round(255 * (1 - t));
                const b = 0;
                return "rgb(" + r + "," + g + "," + b + ")";
              }
            },
          },
          sphere: { color: "magenta", radius: 1.2 },
          stick: { color: "magenta", radius: 0.2 },
        }
      );

      mViewer.render();
      mViewer.zoomTo({ resi: mutationPosition });
      mViewer.zoom(0.6);
      mViewer.render();

      mutantViewer = mViewer;

      if (!cancelled) setLoading(false);
    });

    /* ---- Cleanup ---- */
    return () => {
      cancelled = true;
      cleanup();

      // Destroy viewers
      if (singleViewer) { singleViewer.clear(); singleViewer = null; }
      if (wildViewer) { wildViewer.clear(); wildViewer = null; }
      if (mutantViewer) { mutantViewer.clear(); mutantViewer = null; }

      // Remove imperative DOM nodes
      if (singleMolDiv && singleWrapperRef.current?.contains(singleMolDiv)) {
        singleWrapperRef.current.removeChild(singleMolDiv);
      }
      if (wildMolDiv && wildWrapperRef.current?.contains(wildMolDiv)) {
        wildWrapperRef.current.removeChild(wildMolDiv);
      }
      if (mutantMolDiv && mutantWrapperRef.current?.contains(mutantMolDiv)) {
        mutantWrapperRef.current.removeChild(mutantMolDiv);
      }
    };
  }, [pdbData, mutantPdbData, mutationPosition, isDual]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const mutationLabel = `${mutationOriginal}${mutationPosition}${mutationMutant}`;

  /* Loading overlay shared between modes */
  const loadingOverlay = loading ? (
    <div
      className="flex items-center justify-center text-zinc-400 text-sm"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        pointerEvents: "none",
      }}
    >
      Loading 3D viewer...
    </div>
  ) : null;

  /* ==================== SINGLE MODE JSX ==================== */
  if (!isDual) {
    return (
      <div>
        {/* Viewer area */}
        <div
          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 overflow-hidden"
          style={{ height: 500, position: "relative" }}
        >
          {loadingOverlay}

          {/* Wild-type badge */}
          <div className="absolute top-3 left-3 z-10 pointer-events-none rounded-md bg-black/70 backdrop-blur-sm px-3 py-1.5 text-xs text-zinc-300">
            Wild-type structure &mdash; mutation site highlighted
          </div>

          {/* Wrapper for imperative 3Dmol div */}
          <div
            ref={singleWrapperRef}
            style={{ width: "100%", height: "100%", position: "relative" }}
          />
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-6 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-32 rounded-sm"
              style={{
                background:
                  "linear-gradient(to right, #0000ff, #00ff00, #ffff00, #ff8800, #ff0000)",
              }}
            />
            <span>pLDDT: 50 (low) &rarr; 100 (high)</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: "magenta" }}
            />
            <span>Mutation site ({mutationLabel})</span>
          </div>
        </div>
      </div>
    );
  }

  /* ==================== DUAL MODE JSX ==================== */
  return (
    <div>
      {/* Side-by-side viewer panels */}
      <div className="grid grid-cols-2 gap-4">
        {/* LEFT: Wild-type (AlphaFold) */}
        <div
          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 overflow-hidden"
          style={{ height: 500, position: "relative" }}
        >
          {loadingOverlay}

          {/* Blue badge */}
          <div className="absolute top-3 left-3 z-10 pointer-events-none rounded-md bg-blue-600/80 backdrop-blur-sm px-3 py-1.5 text-xs text-white font-medium">
            Wild-type (AlphaFold)
          </div>

          {/* Wrapper for imperative 3Dmol div */}
          <div
            ref={wildWrapperRef}
            style={{ width: "100%", height: "100%", position: "relative" }}
          />
        </div>

        {/* RIGHT: Mutant (ESMFold) */}
        <div
          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 overflow-hidden"
          style={{ height: 500, position: "relative" }}
        >
          {loadingOverlay}

          {/* Orange badge */}
          <div className="absolute top-3 left-3 z-10 pointer-events-none rounded-md bg-orange-600/80 backdrop-blur-sm px-3 py-1.5 text-xs text-white font-medium">
            Mutant (ESMFold)
          </div>

          {/* Wrapper for imperative 3Dmol div */}
          <div
            ref={mutantWrapperRef}
            style={{ width: "100%", height: "100%", position: "relative" }}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-6 text-xs text-zinc-400">
        {/* pLDDT color bar */}
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-32 rounded-sm"
            style={{
              background:
                "linear-gradient(to right, #0000ff, #00ff00, #ffff00, #ff8800, #ff0000)",
            }}
          />
          <span>pLDDT: 50 (low) &rarr; 100 (high)</span>
        </div>

        {/* RMSD color bar */}
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-32 rounded-sm"
            style={{
              background:
                "linear-gradient(to right, #ffffff, #ffff00 40%, #ff0000)",
            }}
          />
          <span>RMSD: 0 &rarr; 2 &rarr; 5+ &Aring;</span>
        </div>

        {/* Mutation site indicator */}
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: "magenta" }}
          />
          <span>Mutation site ({mutationLabel})</span>
        </div>
      </div>
    </div>
  );
}
