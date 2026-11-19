# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Mixed. Data engineers open a StreamSets pipeline to see how it moves data, extract its definition, and validate it source to Snowflake, then fix what fails. QA reviewers run and read validations. Leads and managers glance at overall health. Most people arrive looking for one specific pipeline.

## Product Purpose
Pipeline Studio, one page inside SmartHub (a J&J internal data-quality portal). It lists every StreamSets pipeline from Control Hub, shows each one as a flow, its stages and parameters, extracts one or many to a JSON report, and validates a pipeline table by table against Snowflake (rows, columns, nulls, duplicates, distinct values), keeping a history of results. Success: someone finds the pipeline they came for in seconds and knows whether it is healthy.

## Positioning
The only place that joins the StreamSets definition (stages, transformations, logins) with the IT validation result in Snowflake, so a difference the pipeline makes on purpose shows up as expected instead of as a failure.

## Operating Context
Used on Windows cloud desktops without a GPU, often at 125-150% scaling on 1366x768 or 1920x1080 screens, inside the SmartHub shell with its left sidebar. Sources are Oracle (Insight7, RIMDocs), MariaDB/MySQL (HAQ) and SQL Server (LIFT); the target is Snowflake. Result statuses: Passed, Critical, Warning, Faulty, Error, Timeout, Table not found. Validations older than 90 days count as not validated.

## Capabilities and Constraints
- Permissions: runStreamsetsExtractor (page), runITChecks (validate), viewITChecks (history and last results), viewStreamsetsSecrets (reveal logins). Locked tabs stay visible and say why.
- Up to 25 pipelines per extraction; one validation at a time per server.
- Board state (sort, grouping, label, search) lives in the URL so views can be shared.
- React 19 + Vite, plain CSS injected per page; no GPU-heavy effects (no backdrop blur, no looping decoration).

## Brand Commitments
None binding for this page: the user released the J&J fonts and red. Keep the name "Pipeline Studio".

## Evidence on Hand
Real pipeline names follow SOURCE_ENTITY_LOADTYPE_TO_SF (e.g. INSIGHT7_PRODUCT_FULL_TO_SF). No screenshots, metrics or testimonials to cite.

## Product Principles
- Find first: the fastest path is type a few letters and open the pipeline.
- State is the headline: a failing pipeline must never look like a passing one at a glance.
- Explain, don't dump: stages and settings are shown in plain words first, raw values one click away.
- One run at a time, never lost: a validation keeps going while you look elsewhere.

## Accessibility & Inclusion
WCAG AA contrast, visible keyboard focus, keyboard shortcuts (/ to search, Ctrl+K to jump), reduced motion respected. Status must not rely on colour alone.

## Design Direction (confirmed)
The user chose the category standard played straight: a clean, light SaaS tool at the craft level of Linear, Vercel and Stripe dashboards. No themed costume.
