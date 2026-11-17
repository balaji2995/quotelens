# QuoteLens: kill the quote spreadsheet

**Live app:** https://quotelens-phi.vercel.app (open it and follow the green guided tour)

Draft an RFx with an AI co-pilot, read whatever vendors send back (Excel, PDF, Word, a phone photo, a one-line email), land everything in one normalized side-by-side comparison, turn every uncertainty into a vendor clarification, and interrogate the result in plain language, all the way to a defensible award.

A working prototype of an AI-assisted RFx workflow, from drafting the request to an award decision. Demo category: corrugated packaging. Buyer: Navika Foods (fictional). Five fictional vendors, 30 lines, ~₹4 cr annual spend.

## What's in the app

| Tab | What it does |
|---|---|
| 1 Draft RFx | AI co-pilot reviews and edits a structured RFx (scope, 30 lines, questionnaire, terms) |
| 2 Vendor responses | Real AI extraction of Excel, PDF, Word, a phone photo and an email, with provenance checks |
| 3 Comparison | One grid: ₹ per unit, delivered, ex-GST; click any cell for source + calculation; documents and quality knockouts alongside |
| 4 Clarifications | Every gap becomes a vendor question; the reply is re-read and merged as a traceable layer |
| 5 Ask the analyst | Plain-language analysis via tools (query, award optimiser, calculator); every ₹ figure checked |
| 6 Award decision | Turns an analyst scenario into a VP-ready memo; Excel / Markdown / PDF export |

The better problem: reading documents isn't where the days go, chasing vendors is. In the demo, the VP's question ("split it, cheapest per line, only among vendors who cleared quality") has no answer until the clarification loop clears two vendors.

## Deploy to Vercel (≈5 minutes)

**Option A: Vercel CLI (no GitHub needed)**
```bash
cd quotelens
npm install
npx vercel login            # opens browser
npx vercel link             # create a new project
npx vercel env add ANTHROPIC_API_KEY production   # paste your key
npx vercel --prod           # prints the live URL
```

**Option B: GitHub + Vercel dashboard**
1. Push this folder to a new GitHub repo.
2. vercel.com → Add New → Project → import the repo (framework auto-detected: Next.js).
3. Settings → Environment Variables → `ANTHROPIC_API_KEY` = your key.
4. Deploy.

Notes
- API routes set `maxDuration = 300`. New Vercel projects have Fluid Compute on by default, which allows this on the Hobby plan. If a long extraction times out, check Settings → Functions → Fluid Compute is enabled.
- Optional env: `QUOTELENS_MODEL` (default `claude-sonnet-5-5`).
- The key is only used server-side; it is never sent to the browser.

## Run locally
```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev     # http://localhost:3000
```

## What's real vs stubbed (summary)
| Piece | Status |
|---|---|
| Extraction from xlsx / pdf / docx / photo / email | **Real** (Claude), into a strict "record, don't calculate" schema |
| Line matching (incl. inch→mm, own naming) | **Real** (model), with match confidence + reasoning |
| Provenance checks: verbatim quote found in source, price inside quote, second independent read for photos | **Real** (code) |
| Units, FX, printing surcharges, freight, conditional discounts | **Real** (deterministic TypeScript, `src/lib/normalize.ts`) |
| Questionnaire verdicts + cross-check against attached certificates | **Real** (model judges claim, code cross-checks documents) |
| Clarification email drafting | **Real** |
| Reading a clarification reply and merging it as a new layer | **Real** (same extraction engine) |
| The vendor's reply itself | **Simulated**: AI role-plays the vendor from a fixed fact sheet (`src/data/personas.json`), because email is stubbed. Paste a real reply to bypass. |
| Analyst | **Real** tool-using agent: query/pivot, award optimiser, calculator, provenance; post-check flags any ₹ figure not traceable to a tool result |
| RFx co-pilot | **Real**, edits the RFx through typed operations |
| Sending email | **Stubbed** (outbox only) |

The app opens on a snapshot of a real extraction run (`src/data/snapshot.json`) so the demo is instant. "Re-read live" on any response calls the model again.

## Dataset & eval
- `scripts/generate_dataset.py` builds the RFx, ground truth and the five messy files from one price model.
- `scripts/run_extraction.mjs` runs live extraction against a running server and writes the snapshot.
- `npx tsx scripts/eval_extraction.ts` scores extraction + normalization against ground truth. Latest: **144/150 cells exact, 0 invented, 0 missed**. The 6 differences are a genuinely ambiguous email ("38 for the 3-ply, rest same as last year": does the per-kg rate cover partitions and pads?). The app flags all 6 as low-confidence and shows the alternative price.

## Guardrails (tested)
`npx tsx scripts/guardrail_tests.ts` feeds a deliberately broken vendor response through normalization and checks that each trap is caught: a USD price mislabelled as INR, a per-100 price read as per piece, "Rs." vs INR, an unconverted EUR price, two prices for one line, a zero price, one USD line in an INR response, GST-inclusive notes, unmatched items, short quote validity, and an exchange rate of 0. Each caught problem lowers confidence on the cell and becomes a clarification question for the vendor.

## Code map
```
src/lib/server/extract.ts   extraction prompt, schema, verification, second read
src/lib/server/files.ts     xlsx/docx/pdf/image/email → model input + checkable text
src/lib/normalize.ts        all the maths: units, FX, freight, discounts, QA verdicts, issues
src/lib/award.ts            award optimiser (vendor subsets, share caps, discount re-check)
src/lib/tables.ts           flat tables + safe query language for the analyst
src/lib/server/analyst.ts   analyst agent loop + number traceability check
src/lib/server/agents.ts    clarification drafter, vendor simulator, RFx co-pilot
src/components/*            UI
```
