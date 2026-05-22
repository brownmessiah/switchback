# AI feature guardrails

## Context

The plan commits to four AI features — review summaries, vendor listing drafts, vendor inbox reply suggestions, and an inventory-constrained trip planner — without specifying how each is grounded or labelled. The risk surface is real: a hallucinated "the guide is safety-certified" claim in a review summary is defamation if false and a hazard if Customers act on it; a trip planner that suggests an Experience outside the live inventory turns into a checkout 404; an AI-drafted Vendor reply that goes out unsupervised attributes the Vendor's voice to a model. India's incoming Digital India Act and the EU AI Act both push toward AI-content labelling and provenance auditability.

## Decision

### Per-surface guardrails

- **Review summarisation — extractive with mandatory citations.** Model output is structured JSON validated by a Zod schema; each bullet point references source review IDs. Server-side, the citation list is dereferenced and the cited reviews are checked for content supporting the bullet; bullets without verifiable support are dropped before render. No free-text generation in the summary path.

- **Vendor listing drafts — generative, human-signed.** AI suggestions appear as editable drafts in the Vendor onboarding wizard. Publish is the Vendor's action; on publish, the content becomes the Vendor's content and the AI provenance is recorded in audit logs but not surfaced to Customers.

- **Vendor inbox reply suggestions — drafts only.** Never auto-send. Vendor must edit-and-send or reject. The Vendor is the principal of any outbound Customer message.

- **Trip planner — RAG-only, Experience-ID-grounded.** The LLM is constrained to recommend only Experiences returned by the retrieval step (`pgvector` over the live Experiences index). Output is structured JSON with `experience_id` per recommendation; recommendations without a valid `experience_id` are dropped at the response layer before reaching the UI. No free-text "you might also like" without an inventory anchor.

### Cross-cutting

- **Labelling.** Every AI-generated or AI-assisted surface carries a visible label. Customer toggles to "show raw reviews" wherever AI summaries appear.
- **Provenance audit.** Every AI generation writes an `ai_generations` row: `model`, `model_version`, `prompt_template_hash`, `input_fingerprint`, `output`, `retrieval_set` (for RAG), `citation_traces` (for review summaries), `requested_by_user_id`, `created_at`. This is what makes the pre-launch "200-review fact-check" gate from PLAN.md mechanically reproducible as a regression test.
- **Model routing.** Review summaries and trip planner use the strongest available model (justified by stakes); inbox drafts and listing drafts use cheaper models. Router lives in `lib/ai/router.ts` and reads model assignments from config; concrete model IDs deferred to launch-time configuration, not hardcoded.

## Why not the alternatives

- **Generative review summaries without citations** — fastest path, lowest cost, but precisely the failure mode this ADR exists to prevent. The 200-review pre-launch sample catches first-launch issues; ongoing safety needs structural constraints, not periodic spot-checks.
- **Auto-send Vendor inbox replies** — attributes the model's voice to the Vendor without consent and ruins the Vendor's response-time SLA score interpretation (you can't tell who actually replied).
- **Free-text trip planner output** — model will hallucinate Experiences that look plausible but don't exist in inventory. Anchoring to retrieved IDs is the cheapest reliability gain in the entire AI stack.

## Consequences

- The Reviews module schema needs a stable `reviews.id` (no soft-delete that retains the ID) because Review IDs are referenced from `ai_generations.citation_traces`.
- The Experiences search index (Meilisearch) is the surface for trip planner retrieval; the `pgvector` extension is the embedding store. Both must be kept in sync with the canonical Postgres `experiences` table — covered by the same `after()` hook pattern PLAN.md specifies for Meilisearch.
- AI generation latency budget per surface (review summary nightly batch can be slow; trip planner is interactive and must stream) belongs in M4 implementation, not this ADR.
- The labelling requirement applies to UI surfaces *and* to outbound messages: a WhatsApp message containing an AI-summarised bullet must carry the label too. Don't strip labelling at the channel boundary.
- Fact-check sampling cadence post-launch is an ops question — recommend weekly random sample of 50 review summaries reviewed by admin, with disagreement rate tracked over time as an AI-quality metric.
