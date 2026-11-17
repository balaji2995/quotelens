"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import rfxSeed from "@/data/rfx.json";
import vendorsSeed from "@/data/vendors.json";
import historySeed from "@/data/history.json";
import inboxSeed from "@/data/inbox.json";
import snapshot from "@/data/snapshot.json";
import { DEFAULT_ASSUMPTIONS, type Override } from "./normalize";
import type { Assumptions, History, Layer, Rfx, Vendor } from "./types";
import type { AwardMemo, AwardScenario, Display, TraceStep } from "./server/analyst-types";

export interface ChatMsg { role: "user" | "assistant"; content: string; displays?: Display[]; trace?: TraceStep[]; numberCheck?: { checked: number; unverified: string[] }; error?: string; ms?: number; awards?: AwardScenario[]; question?: string }
export interface Thread { status: "none" | "drafted" | "sent" | "replied" | "applied"; subject?: string; body?: string; internal_note?: string; reply?: string; reply_simulated?: boolean; change_summary?: string[] }
export interface InboxItem { vendor_id: string; received: string; channel: string; files: { name: string; kind: string; role: string; url?: string }[] }

interface State {
  rfx: Rfx;
  vendors: Vendor[];
  history: History;
  inbox: InboxItem[];
  layers: Record<string, Layer[]>;
  snapshotAt: string;
  assumptions: Assumptions;
  overrides: Override[];
  analyst: ChatMsg[];
  copilot: ChatMsg[];
  threads: Record<string, Thread>;
  rfxSent: boolean;
  awards: AwardMemo[];
  guideOpen: boolean;
  set: (p: Partial<State>) => void;
  setLayers: (vendor: string, layers: Layer[]) => void;
  addLayer: (vendor: string, layer: Layer) => void;
  setThread: (vendor: string, t: Partial<Thread>) => void;
  reset: () => void;
}

const initial = () => ({
  rfx: rfxSeed as unknown as Rfx,
  vendors: vendorsSeed as Vendor[],
  history: historySeed as History,
  inbox: (inboxSeed as InboxItem[]).map((i) => ({ ...i, files: i.files.map((f) => ({ ...f, url: `/demo/${f.name}` })) })),
  layers: (snapshot as unknown as { layers: Record<string, Layer[]> }).layers,
  snapshotAt: (snapshot as unknown as { generated_at: string }).generated_at,
  assumptions: DEFAULT_ASSUMPTIONS,
  overrides: [] as Override[],
  analyst: [] as ChatMsg[],
  copilot: [] as ChatMsg[],
  threads: {} as Record<string, Thread>,
  rfxSent: true,
  awards: [] as AwardMemo[],
  guideOpen: true,
});

export const useStore = create<State>()(
  persist(
    (set) => ({
      ...initial(),
      set: (p) => set(p),
      setLayers: (vendor, layers) => set((s) => ({ layers: { ...s.layers, [vendor]: layers } })),
      addLayer: (vendor, layer) => set((s) => ({ layers: { ...s.layers, [vendor]: [...(s.layers[vendor] || []), layer] } })),
      setThread: (vendor, t) => set((s) => ({ threads: { ...s.threads, [vendor]: { ...(s.threads[vendor] || { status: "none" }), ...t } } })),
      reset: () => set(initial()),
    }),
    {
      name: "quotelens-v1",
      merge: (persisted, current) => ({ ...current, ...(persisted as object) }),
      storage: createJSONStorage(() => {
        // localStorage can be unavailable (privacy modes); fall back to memory
        try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return localStorage; }
        catch { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; }
      }),
      partialize: (s) => ({ ...s, inbox: s.inbox.map((i) => ({ ...i, files: i.files.filter((f) => !f.url?.startsWith("blob:")) })) }),
    },
  ),
);

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let j: T & { error?: string };
  try { j = JSON.parse(text); } catch { throw new Error(res.status === 504 ? "Server timed out" : `Server error ${res.status}`); }
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

/** layers without the (large) source text, for sending to the analyst */
export const leanLayers = (layers: Record<string, Layer[]>) =>
  Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.map(({ source_text: _s, ...rest }) => rest)]));
