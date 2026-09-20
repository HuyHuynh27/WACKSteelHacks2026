# Nemotron in Better RAW

Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) over NVIDIA's
OpenAI-compatible endpoint. It is not the product — it is three stages inside a
four-step data pipeline, and the pipeline is built so that when the model is
wrong, nothing downstream is corrupted.

## Where it sits

```
  FRED API ──┐
             ├─> map ───> sync ───> alerts ───> dispatch ──> web push
  catalogue ─┘    ▲                   ▲
                  │                   │
             Nemotron            Nemotron x2
          (classification)   (research + structured copy)

                       Postgres ──> /api/query ──> Nemotron
                                                (grounded answer)
```

**1. Classification with a gate** — `ingestion/better_raw/mapper.py`

A shop types "6061 aluminium extrusion". The tracked series is `PALUMUSDM`
("Global price of Aluminum"). Nemotron picks from a 31-series seeded catalogue
and returns a calibrated confidence. Below 0.45 the material is left unmapped
rather than tracked against the wrong index. The model's prose explanation is
logged and shown to the user; it never gates the database write.

**2. Research and structured generation** — `ingestion/better_raw/alerts.py`

Two calls per alert. First a tool loop: Nemotron drives a `web_search` function
we implement against DuckDuckGo, up to three searches, then writes up what it
found. Second a schema-constrained call turning those notes into a push-sized
headline, body, and two to four drivers with sources.

**3. Query-time synthesis** — `src/lib/rag/synthesize.ts`

Answers free-text questions from the alerts and price history already in
Postgres. It does not search — that work happened once, at ingestion. Reasoning
is disabled here so a chat response returns in about a second.

## What we measured

**Structured output: schema shape matters more than we expected.**

The alert-copy schema has a nested model (`drivers: list[Driver]`), so
Pydantic's `model_json_schema()` emits `$defs` and a `$ref`. The mapping schema
is flat scalars and does not.

| Call | Schema | Reasoning | `max_tokens` | Valid JSON |
| --- | --- | --- | --- | --- |
| mapping | flat | on | 2048 | 6/6 first attempt |
| alert copy | `$ref` via `$defs` | on | 2048 | 0/2 — repair pass also failed |
| alert copy | hand-inlined | off | 4096 | 2/2 first attempt |

Two causes, both confirmed by the fix working:

- Guided decoding could not follow the `$ref`, so `response_format` was
  accepted but not constraining anything.
- `reasoning_budget: 8192` against `max_tokens: 2048` — thinking tokens come out
  of the same output budget, so the JSON was being truncated mid-object. The
  failing call took 26 seconds; the working mapping call took 4.

Takeaway: inline the schema, and treat reasoning budget as competing with the
answer rather than additive.

**Mapping quality across 6 materials.**

| Material | Series | Conf. | Outcome |
| --- | --- | --- | --- |
| 6061 Aluminum | PALUMUSDM | 0.95 | correct |
| Copper Bus Bar | PCOPPUSDM | 0.95 | correct |
| Shop Natural Gas | DHHNGSP | 0.95 | correct |
| 304 Stainless Sheet | PNICKUSDM | 0.70 | proxy — nickel is an input, not the sheet |
| Kiln-Dried Pine | WPU081 | 0.90 | correct, but an index |
| Corrugated Boxes | WPU0911 | 0.85 | proxy — wood pulp, and an index |

6/6 produced a defensible series and no abstentions. The useful signal is that
the confidence tracked the *kind* of answer: it dropped to 0.70 exactly where
the series measures an input rather than the material, which is what the UI now
discloses to the buyer.

## Five failure modes we found

**1. Fabricated justification for a correct answer.** Reproducible.

Two separate runs, same material:

> `'6061 Aluminum' -> PALUMUSDM (0.98): PALUMUSDM tracks global aluminum price and its description includes the 6061 alloy qualifier.`

> `'6061 Aluminum' -> PALUMUSDM (0.95): PALUMUSDM tracks global aluminum price and explicitly lists 6061 as a relevant qualifier.`

`PALUMUSDM`'s title is "Global price of Aluminum". There is no 6061 qualifier
anywhere in it. The series choice is right both times; the stated reason is
invented both times, at high confidence.

This is the finding that most shaped the design. A pipeline that gated on the
explanation would be gating on fiction. Ours gates on the confidence score and
logs the prose as commentary.

**2. Correct retrieval, inverted interpretation.**

From the aluminum research notes:

> "Adding to the bearish tone, LME inventories kept dropping: opening stocks fell below the psychologically important 300,000 t level..."

Falling inventories are conventionally *bullish* — tighter supply. The retrieved
fact is real and correctly quoted; the directional reading is backwards.
Retrieval grounding fixes what the model knows, not how it reasons about it.

**3. Invented citations, in a form that survives casual review.**

The research notes came back peppered with `【0†L0-L4】` and `【2†L0-L4】` —
citation markers from training data, not anything our pipeline emitted. Our
`_search()` hands the model plain `- title: body (url)` lines.

Those markers then became **URLs** in the structured pass. Confirmed in
Postgres:

```
 name                | driver                      | source
---------------------+-----------------------------+---------------------------------
 6061 Aluminum       | US-Iran peace deal          | https://www.spglobal.com/commodity...
 6061 Aluminum       | LME spot decline            | https://www.lme.com/en-GB/Metals/...
 304 Stainless Sheet | Nickel price drop           | https://example.com/L0-L4
 304 Stainless Sheet | Inventory overhang          | https://example.com/L0-L4
 304 Stainless Sheet | Eased Indonesian supply fears | https://example.com/L0-L4
```

Two real sources and three fabrications, in the same table, indistinguishable
without checking. A wrong link in a purchasing notification is worse than no
link.

**Fix: verification, not prompting.** `research()` now records every href the
search actually returned; `_verify_sources()` compares each cited URL on
`(host, path)` equality and nulls anything outside that set. Tested against the
adversarial cases:

```
KEPT   exact match, no-www, trailing slash, fragment dropped
KEPT   DDG /l/?uddg= wrapper       -> unwrapped to the real target
NULLED https://example.com/L0-L4
NULLED [1]
NULLED https://spglobal.com/       (bare origin, never actually returned)
NULLED /article-12 vs /article-123 (prefix collision)
NULLED javascript:alert(1)
```

Equality rather than prefix matching matters in both directions: a prefix match
accepts a bare origin the model never saw, and rejects legitimate citations
behind DuckDuckGo's redirect wrapper.

**4. Anchoring on a guessed hypothesis, then self-correcting.**

First search on a June–July 2026 move:

```
Searching: '6061 aluminum price drop July 2024'
Searching: 'aluminum price drop June July 2026 cause'
Searching: 'June 16 2026 aluminum price falls US-Iran deal'
```

Wrong year first, corrected on the next turn. In another run it opened with
`'Aluminum price falls on US-Iran deal June 16 2026'` — a specific causal claim
it had not yet found any evidence for, searched in order to confirm. The tool
loop recovers, but the first query is a hypothesis, not a question.

**5. The one we did not expect: the code asserted a guarantee that did not exist.**

Most of this pipeline was written with AI assistance. At one point the
verification in finding #3 was designed, reviewed, and *documented* — but the
file was never saved to disk. What shipped was three comments confidently
describing a safeguard, and no implementing code:

```tsx
{/* Only sources the search actually returned survive
    verification in the worker, so anything here is
    safe to link. */}
```

```ts
// ...along with its drivers and their verified sources.
```

```
Each alert carries drivers: ...and, where one was verified, a source.
```

The third of those is a *system prompt*, so the answering model was being told
that a source meant one had been verified. Three assertions, zero enforcement.
An independent review caught it by grepping for the function name and finding
nothing.

The lesson generalises past this project: **the confident description of a
safeguard is not the safeguard.** Which is the same lesson as finding #1, one
layer up.

## What the model is deliberately not trusted with

- **Unit arithmetic.** FRED quotes aluminum per metric ton; a shop buys 6061 by
  the pound. Conversion factors come from a hard-coded lookup table
  (`ingestion/better_raw/units.py`), not the model. A hallucinated 2204.62
  produces a plausible-looking wrong number in every cost rollup with no
  symptom. Percentage changes are invariant under the factor, which gave us a
  free correctness check: after converting, the aluminum alert still read
  −8.2%, the same as before.
- **Citations.** See finding #3.
- **Whether a price is a price.** A PPI series has no absolute level, so
  index-quoted materials are flagged and excluded from cost rollups rather than
  multiplied into a batch cost.

## Honest limitations

- Unit coverage is mass, volume, energy and board feet. A material bought by
  the sheet, roll or linear foot has no conversion and is stored as quoted.
- `n=6` on the mapping table. Enough to see the confidence signal behave, not
  enough to call it calibrated.
- We did not A/B Nemotron against another model. The comparison we have is
  configuration-to-configuration, not model-to-model.