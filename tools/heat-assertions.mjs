import assert from "node:assert/strict"

export function assertRenderedHeatFrame(frame, snapshot, canvas) {
  for (const region of snapshot.regions) {
    const maximum = Math.max(
      (360 * snapshot.scale) ** 2,
      Math.min((520 * snapshot.scale) ** 2, region.width * region.height * 0.3)
    )
    const edge = Math.max(
      480 * snapshot.scale,
      Math.min(700 * snapshot.scale, Math.max(region.width, region.height))
    )
    for (const id of region.ids) {
      const b = frame.find((box) => box.id === id)
      assert.ok(b, `missing rendered tile ${id}`)
      assert.ok(b.width >= 55.99 && b.height >= 55.99, "rendered minimum")
      assert.ok(b.width * b.height <= maximum + 1, "rendered maximum area")
      assert.ok(
        Math.max(b.width, b.height) <= edge + 0.1,
        "rendered maximum edge"
      )
      assert.ok(
        b.width <= 2 * b.height + 0.1 && b.height <= 2 * b.width + 0.1,
        "rendered aspect ratio"
      )
      assert.ok(
        b.width <= 3 * b.height - 112 + 0.1 &&
          b.height <= 3 * b.width - 112 + 0.1,
        "rendered small square"
      )
      assert.ok(
        b.x >= canvas.x + region.x - 0.1 &&
          b.y >= canvas.y + region.y - 0.1 &&
          b.right <= canvas.x + region.x + region.width + 0.1 &&
          b.bottom <= canvas.y + region.y + region.height + 0.1,
        "rendered region bounds"
      )
    }
  }
  for (let i = 0; i < frame.length; i++)
    for (let j = i + 1; j < frame.length; j++) {
      const a = frame[i],
        b = frame[j]
      assert.ok(
        a.right + snapshot.gap <= b.left + 0.1 ||
          b.right + snapshot.gap <= a.left + 0.1 ||
          a.bottom + snapshot.gap <= b.top + 0.1 ||
          b.bottom + snapshot.gap <= a.top + 0.1,
        "rendered overlap or collapsed gutter"
      )
    }
}

export function assertTiled(layout) {
  for (const region of layout.snapshot.regions) {
    let gutters = 0
    const visit = (tree, x, y, width, height) => {
      if ("index" in tree) {
        const b = region.boxes[tree.index]
        for (const [key, value] of Object.entries({ x, y, width, height }))
          assert.ok(
            Math.abs(b[key] - value) < 1e-4,
            `unfilled partition ${key}`
          )
        return
      }
      const cut = region.cuts[tree.cut],
        gap = layout.snapshot.gap
      gutters += gap * (tree.horizontal ? height : width)
      if (tree.horizontal) {
        visit(tree.left, x, y, cut - gap / 2 - x, height)
        visit(tree.right, cut + gap / 2, y, x + width - cut - gap / 2, height)
      } else {
        visit(tree.left, x, y, width, cut - gap / 2 - y)
        visit(tree.right, x, cut + gap / 2, width, y + height - cut - gap / 2)
      }
    }
    visit(region.tree, 0, 0, region.width, region.height)
    assert.ok(
      Math.abs(
        region.boxes.reduce((s, b) => s + b.width * b.height, 0) +
          gutters -
          region.width * region.height
      ) < 0.01
    )
  }
}

export function assertMotion(heat, motion, before, after) {
  const scale = after.snapshot.scale,
    gap = after.snapshot.gap
  for (const region of after.snapshot.regions) {
    const ids = new Set(region.ids)
    const starts = before.boxes
        .filter((b) => ids.has(b.item.id))
        .map(({ x, y, width, height }) => ({ x, y, width, height })),
      ends = after.boxes
        .filter((b) => ids.has(b.item.id))
        .map(({ x, y, width, height }) => ({ x, y, width, height }))
    const limits = heat.heatLimits(region.width, region.height, scale)
    const continuous = heat.safeHeatTransition(starts, ends, gap, scale, limits)
    for (let frame = 0; frame <= 100; frame++) {
      const sample = motion.heatMotionFrame(
        starts,
        ends,
        frame / 100,
        continuous
      )
      assert.ok(sample.opacity >= 0 && sample.opacity <= 1)
      assert.ok(
        heat.safeHeatTransition(sample.boxes, sample.boxes, gap, scale, limits),
        `invalid animation frame ${frame}`
      )
      for (const b of sample.boxes)
        assert.ok(
          b.x >= region.x - 1e-4 &&
            b.y >= region.y - 1e-4 &&
            b.x + b.width <= region.x + region.width + 1e-4 &&
            b.y + b.height <= region.y + region.height + 1e-4
        )
    }
    assert.deepEqual(
      motion.heatMotionFrame(starts, ends, 1, continuous).boxes,
      ends
    )
  }
}
