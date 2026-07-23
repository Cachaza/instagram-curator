---
name: Curator
description: A living archive that turns Instagram publications into illuminated, useful knowledge.
colors:
  limewash: "#F2EFEA"
  paper: "#FAF9F6"
  graphite: "#1A1D20"
  shadow-blue: "#8DA1B4"
  limestone: "#DAD6CD"
  rule: "#BFC3C7"
  sunbeam: "#E8BC4D"
typography:
  display:
    fontFamily: "Avenir Next Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(3rem, 7vw, 5.5rem)"
    fontWeight: 500
    lineHeight: 0.94
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, SF Pro Text, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, SF Pro Text, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  control: "4px"
  card: "8px"
  media: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  card-publication:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.card}"
    padding: "0"
---

# Design System: Curator

## Overview

**Creative North Star: "The Illuminated Living Archive"**

Curator behaves like a living collection rather than a generic dashboard. Every imported publication is a catalogued source with provenance, processing state, extracted knowledge, and a clear path back to the original material. The interface makes those relationships visible without turning everyday use into database administration.

Its visual language comes from architectural sections and collection catalogues: limewashed fields, graphite structure, mineral blue shadows, precise annotations, and a disciplined band of sunlight. Light is not decoration; it marks active knowledge, selection, progress, and the connection between source and insight.

**Key Characteristics:**

- A persistent lateral index for orientation.
- Publication cards remain image-led but gain archival precision.
- Annotation lines connect source, metadata, and extracted knowledge.
- Strong light-and-shadow composition without ornamental gradients.
- Calm at rest, exact and luminous in active states.

## Colors

The palette is mineral and daylight-driven, with graphite carrying structure and sunbeam yellow reserved for meaning.

### Primary

- **Section Graphite** (`#1A1D20`): navigation, primary actions, active structure, and dominant text.
- **Sunbeam** (`#E8BC4D`): selected knowledge, progress, focus, and one decisive highlight per region.

### Secondary

- **Shadow Blue** (`#8DA1B4`): secondary information, quiet states, and depth.

### Neutral

- **Limewash** (`#F2EFEA`): application ground.
- **Archive Paper** (`#FAF9F6`): reading and card surfaces.
- **Limestone** (`#DAD6CD`): quiet grouped regions.
- **Measured Rule** (`#BFC3C7`): dividers, annotation leaders, and field boundaries.

### Named Rules

**The Sunbeam Rule.** Yellow marks an active relationship or moment of discovery. It never becomes scattered decoration.

## Typography

**Display Font:** Avenir Next Condensed with Arial Narrow fallback  
**Body Font:** Inter with system UI fallbacks  
**Label Font:** Inter with system UI fallbacks

**Character:** Headlines are narrow, inclined in spirit, and spatially decisive. Body copy stays familiar and highly readable. Labels behave like measured annotations rather than technical cosplay.

### Hierarchy

- **Display** (500, `clamp(3rem, 7vw, 5.5rem)`, 0.94): page thesis and primary collection views.
- **Headline** (600, `clamp(2rem, 4vw, 3.5rem)`, 1): major page and detail headings.
- **Title** (650, `1.125–1.5rem`, 1.15): cards and task groups.
- **Body** (400, `1rem`, 1.6): explanations and extracted knowledge, limited to 70ch.
- **Label** (650, `0.75rem`, 0.04em): provenance, state, category, and annotation.

## Layout

The fixed sidebar remains the primary index on wide screens. Main surfaces use a measured column grid with visible rules and deliberate asymmetry: one dominant reading or working plane plus a narrower annotation or status plane. Dense collections keep their masonry behavior but align metadata and annotation anchors consistently.

On small screens, the index becomes bottom navigation, annotation planes stack beneath their source, and leader lines shorten rather than crossing content. Spacing follows an 8px base rhythm with larger 24px and 40px separations between distinct tasks.

## Elevation & Depth

The system is flat by default. Depth comes from tonal planes, section cuts, image crops, and overlapping light bands. Shadows appear only for transient layers or a card lifted by direct interaction.

### Named Rules

**The Section Rule.** Prefer a structural rule or tonal cut to a decorative shadow.

## Shapes

Corners are precise and restrained: 4px for controls and media, 8px for publication cards. Pills are reserved for compact filters and statuses. Large rounded containers and soft floating blobs do not belong to this system.

## Components

### Buttons

- **Shape:** compact rectangular control with 4px corners.
- **Primary:** graphite field, archive-paper text, 12px × 18px padding.
- **Hover / Focus:** a sunbeam edge or field shift plus a clearly visible outline.
- **Secondary:** transparent or paper surface with a measured graphite rule.

### Chips

- **Style:** small archival labels with restrained background colors and dark text.
- **State:** selected chips become graphite; sunbeam appears only as an active marker.

### Cards / Containers

- **Corner Style:** restrained 8px publication frame with 4px media crop.
- **Background:** archive paper on limewash.
- **Shadow Strategy:** flat at rest; slight structural lift only on hover or keyboard focus.
- **Border:** one measured rule when separation is required.
- **Internal Padding:** 16–20px.

### Inputs / Fields

- **Style:** paper or limewash field, 1px graphite or measured-rule boundary, 4px corners.
- **Focus:** graphite boundary with a sunbeam focus marker.
- **Error / Disabled:** error states name both the problem and recovery; disabled states preserve readable contrast.

### Navigation

The sidebar is the collection index. Default items are quiet graphite-on-limewash; the active destination is defined by a dark structural plane and a narrow sunbeam marker. Mobile navigation preserves the same hierarchy without reproducing the full sidebar.

### Knowledge Annotation

Metadata and extracted facts may connect to their source using thin leader lines, anchor dots, and concise labels. Lines never cross primary reading content and disappear when they do not add traceability.

## Do's and Don'ts

### Do:

- **Do** keep publication imagery and source material visually primary.
- **Do** use annotation to explain provenance, processing state, or extracted knowledge.
- **Do** reserve sunbeam yellow for active meaning.
- **Do** retain a familiar and efficient lateral navigation model.

### Don't:

- **Don't** literalize the concept with floor plans or decorative buildings.
- **Don't** recreate a generic SaaS dashboard with interchangeable rounded cards.
- **Don't** use orange as the product accent.
- **Don't** add technical labels where plain language would guide the person better.
