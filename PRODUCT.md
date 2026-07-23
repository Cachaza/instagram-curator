# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who want to install and use Curator for themselves or their household. The product must be understandable to someone who did not build it and should not assume that its users already understand its internal architecture or self-hosting terminology.

## Product Purpose

Curator turns saved Instagram publications into useful, private knowledge. It imports reels, posts, and carousels, processes their media and spoken content, and organizes the resulting information into a searchable library.

Success means that a person can move from an Instagram publication to durable, useful information they can find and act on later.

## Positioning

Curator is not another feed or bookmark list. It converts Instagram publications into structured knowledge that remains searchable and useful outside Instagram.

## Operating Context

Curator is installed by the person who owns the deployment and is used through a web interface. An administrator completes the initial setup, connects the required services, and may create accounts for other members of the household.

People use the product to import Instagram URLs, follow processing progress, review generated information, recover failed jobs, and explore their personal library.

## Capabilities and Constraints

- Imports normalized Instagram publication URLs without creating duplicates.
- Processes reels, posts, and carousels through a durable background pipeline.
- Extracts media and spoken content, then classifies and organizes publications.
- Provides a searchable library, review queue, processing history, retries, diagnostics, and household accounts.
- Uses SQLite as the source of truth and keeps credentials and downloaded media under the deployment owner's control.
- Must persist background failures with their processing stage.
- User-facing copy must support Spanish and English.
- Must never invent external facts such as ratings, locations, or prices.
- Installation and first-run guidance must be understandable to people who are not familiar with the project's internal implementation.

## Brand Commitments

- Product name: Curator.
- Primary promise: turn Instagram into useful knowledge.
- Voice: direct, understandable, and helpful in both Spanish and English.
- Technical deployment details should appear where they help a person make a decision or complete a task, not as decorative product messaging.

## Evidence on Hand

- The repository contains working import, processing, review, library, account, setup, diagnostics, backup, and restore flows.
- Existing product screenshots are available under `docs/screenshots/`.
- No ratings, testimonials, customer claims, pricing claims, or third-party endorsements are available and none should be fabricated.

## Product Principles

1. Lead with the knowledge a person gains, not the machinery that produces it.
2. Make installation, setup, failure recovery, and everyday use understandable without insider terminology.
3. Preserve privacy, data ownership, and operational transparency.
4. Turn processing state into clear next actions rather than exposing raw pipeline complexity.
5. Keep every generated claim traceable to imported content or explicit user input.

## Accessibility & Inclusion

The complete interface must remain usable with keyboard navigation, visible focus, semantic labels, responsive layouts, and Spanish or English copy.
