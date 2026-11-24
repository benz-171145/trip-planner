# Project memory

## Product intent & audience

- Trip planning & management web app for individual travelers.
- UI language: Thai.
- Core entities: trips stored as Firestore documents; each trip has planned budget, checklist, and actual spend.
- Features added this session: pre-trip checklist with progress tracking, planned-vs-actual budget comparison.

## Brand personality & voice

- Practical, helpful, travel-focused.
- Thai-language labels and auto-generated summary phrases (e.g., "ประหยัดกว่างบ X ฿", "เกินงบไป X ฿").

## Visual design & UX direction

- Card-based trip list; each card shows actions and inline status.
- Modals/in-line panels for editing trip details, checklist, and actual spend.
- Checklist progress badge on card (e.g., 3/5); turns green when complete.
- Horizontal comparison bar for planned vs actual budget.
- Color semantics: green = saved/complete, red = over-budget.
- Icons from lucide-react; Tailwind classes for styling.
- Auto-save UX: edits persist immediately to Firestore without explicit save button for checklist.

## Decisions, constraints & rationale

- Stack: Vite + React, Tailwind CSS, lucide-react, `@/` path alias → `src/`.
- Persistence: Firebase Firestore; all new feature data saved into the existing trip document (no separate collections).
- New trips receive 4 default checklist items (tire/engine oil, charger, personal meds, accommodation booked); pre-existing trips start with empty checklist to avoid overwriting.
- Actual spend entered via card button or save modal; comparison summary auto-calculated from planned vs actual.
- No extra UI packages installed; only existing stack used.

## Open questions & assumptions

- Firestore collection path and document field names inferred from existing code; confirm exact schema if further schema changes needed.
- Authentication/user-scoped queries not discussed; assumed handled elsewhere.
- Currency assumed to be THB (฿) based on UI labels.