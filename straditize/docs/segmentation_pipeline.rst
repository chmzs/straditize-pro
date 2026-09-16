Segmentation Pipeline
=====================

The segmentation logic for reader digitization is centralized in
``straditize.segmentation``.

Responsibilities
----------------

- ``segmentation.py``: foreground extraction, guided color masks, same-hue
  exaggeration split, and geometry traces (area profile / line center).
- ``binary.py``: reader state, serialization, and compatibility wrappers that
  delegate segmentation logic to ``segmentation.py``.

Foreground flow
---------------

1. Build auto foreground from extraction mode and local RGBA values.
2. If ``guided`` mode is active, intersect auto foreground with target-color
   mask.
3. If the intersection is too small, use a conservative fallback that keeps
   target-color components touching auto foreground.

Exaggeration split flow
-----------------------

1. Detect same-hue families within each column section.
2. Split dark primary and pale candidate layers by score
   (brightness - saturation weighted).
3. Enforce spatial constraints:

   - same column / same hue family
   - adjacency to the primary layer
   - outer-layer consistency along rows

4. Remove tiny components and fill tiny holes.

Failure recovery
----------------

- Empty or invalid color sets return an empty guided mask and keep the UI
  recoverable.
- Exaggeration merge requires explicit preview confirmation before writing data.
