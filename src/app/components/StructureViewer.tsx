"use client";

import { useRef, useEffect, useState, useCallback } from "react";

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
}

const THREEDMOL_CDN = "https://3dmol.csb.pitt.edu/build/3Dmol-min.js";

export default function StructureViewer({
  pdbData,
  mutationPosition,
  mutationOriginal,
  mutationMutant,
}: StructureViewerProps) {
  // Outer wrapper ref — React owns this div and never renders children into it.
  // We imperatively create a child div for 3Dmol to own completely.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewerDivRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  const initViewer = useCallback(() => {
    if (!wrapperRef.current || !window.$3Dmol) return;

    // Tear down previous viewer + its DOM node
    if (viewerRef.current) {
      viewerRef.current.clear();
      viewerRef.current = null;
    }
    if (viewerDivRef.current && wrapperRef.current.contains(viewerDivRef.current)) {
      wrapperRef.current.removeChild(viewerDivRef.current);
    }

    // Create a fresh div that 3Dmol will fully own
    const molDiv = document.createElement("div");
    molDiv.style.width = "100%";
    molDiv.style.height = "100%";
    molDiv.style.position = "relative";
    wrapperRef.current.appendChild(molDiv);
    viewerDivRef.current = molDiv;

    const viewer = window.$3Dmol.createViewer(molDiv, {
      backgroundColor: "0x1a1a1a",
    });

    viewer.addModel(pdbData, "pdb");

    // Cartoon colored by B-factor (pLDDT)
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

    // Highlight mutation residue with red spheres
    viewer.setStyle(
      { resi: mutationPosition },
      {
        cartoon: {
          colorscheme: {
            prop: "b",
            gradient: "roygb",
            min: 50,
            max: 100,
          },
        },
        sphere: { color: "red", radius: 0.8 },
      }
    );

    viewer.zoomTo();
    viewer.render();

    viewerRef.current = viewer;
    setLoading(false);
  }, [pdbData, mutationPosition]);

  useEffect(() => {
    let cancelled = false;

    function tryInit() {
      if (cancelled) return;
      initViewer();
    }

    if (window.$3Dmol) {
      tryInit();
      return;
    }

    // Check if script tag already exists but hasn't loaded yet
    const existingScript = document.querySelector(
      `script[src="${THREEDMOL_CDN}"]`
    ) as HTMLScriptElement | null;

    if (existingScript) {
      if (window.$3Dmol) {
        tryInit();
      } else {
        existingScript.addEventListener("load", tryInit);
      }
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", tryInit);
      };
    }

    // Load the script fresh
    const script = document.createElement("script");
    script.src = THREEDMOL_CDN;
    script.addEventListener("load", tryInit);
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener("load", tryInit);
    };
  }, [initViewer]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (viewerRef.current) {
        viewerRef.current.clear();
        viewerRef.current = null;
      }
      if (
        viewerDivRef.current &&
        wrapperRef.current &&
        wrapperRef.current.contains(viewerDivRef.current)
      ) {
        wrapperRef.current.removeChild(viewerDivRef.current);
        viewerDivRef.current = null;
      }
    };
  }, []);

  return (
    <div>
      {/* Viewer area */}
      <div
        className="w-full rounded-lg bg-zinc-900 border border-zinc-700 overflow-hidden"
        style={{ height: 500, position: "relative" }}
      >
        {/* Loading overlay — positioned above the viewer div, never a child of it */}
        {loading && (
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
        )}
        {/* Informational badge — always visible */}
        <div
          className="absolute top-3 left-3 z-10 pointer-events-none rounded-md bg-black/70 backdrop-blur-sm px-3 py-1.5 text-xs text-zinc-300"
        >
          Wild-type structure &mdash; mutation site highlighted in red
        </div>
        {/*
          This div is the wrapper React owns. It has NO React children.
          3Dmol's container is appended imperatively inside useEffect.
        */}
        <div
          ref={wrapperRef}
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
            style={{ backgroundColor: "red" }}
          />
          <span>
            Mutation site ({mutationOriginal}
            {mutationPosition}
            {mutationMutant})
          </span>
        </div>
      </div>
    </div>
  );
}
