#!/usr/bin/env node

/**
 * Restore Spine Annotator labels from an exported JSON file.
 *
 * Supported inputs:
 *   1) Raw export from /api/export?format=raw
 *      { ok: true, format: 'raw', items: [{ filename, view_type, start_label, polygons, ... }] }
 *   2) COCO export from /api/export?format=coco
 *      { images: [...], annotations: [...], categories: [...] }
 *
 * Usage:
 *   node scripts/restore-labels.mjs <export.json> <app-url> <auth-password>
 *
 * Example:
 *   node scripts/restore-labels.mjs .\backup.json https://spine-annotator.pages.dev my-password
 */

import fs from 'node:fs/promises'
import path from 'node:path'

function usage() {
  console.error(`Usage:\n  node scripts/restore-labels.mjs <export.json> <app-url> <auth-password>\n\nExample:\n  node scripts/restore-labels.mjs .\\backup.json https://spine-annotator.pages.dev my-password`)
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '')
}

function labelFromCategory(categories, categoryId) {
  const category = categories.find((c) => Number(c.id) === Number(categoryId))
  return category?.name || null
}

function normalizePoints(segmentation) {
  if (!segmentation) return []

  // COCO polygon: [[x1, y1, x2, y2, ...]]
  if (Array.isArray(segmentation) && Array.isArray(segmentation[0])) {
    return segmentation[0].map(Number).filter((v) => Number.isFinite(v))
  }

  // Already flat: [x1, y1, ...]
  if (Array.isArray(segmentation)) {
    return segmentation.map(Number).filter((v) => Number.isFinite(v))
  }

  return []
}

function fromRawExport(data) {
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : null
  if (!items) return null

  return items
    .filter((item) => item && item.filename)
    .map((item) => ({
      filename: item.filename,
      body: {
        view_type: item.view_type ?? null,
        start_label: item.start_label ?? null,
        image_width: item.image_width ?? null,
        image_height: item.image_height ?? null,
        polygons: Array.isArray(item.polygons) ? item.polygons : [],
        labeler_id: item.labeler_id ?? null,
      },
    }))
}

function fromCocoExport(data) {
  if (!Array.isArray(data.images) || !Array.isArray(data.annotations)) return null

  const categories = Array.isArray(data.categories) ? data.categories : []
  const imageById = new Map(data.images.map((img) => [Number(img.id), img]))
  const grouped = new Map()

  for (const annotation of data.annotations) {
    const imageId = Number(annotation.image_id)
    const image = imageById.get(imageId)
    if (!image || !image.file_name) continue

    const points = normalizePoints(annotation.segmentation)
    if (points.length < 6) continue

    const label = annotation.label || labelFromCategory(categories, annotation.category_id)
    if (!label) continue

    if (!grouped.has(imageId)) grouped.set(imageId, [])
    grouped.get(imageId).push({
      id: annotation.id ? String(annotation.id) : `${image.file_name}-${grouped.get(imageId).length + 1}`,
      label,
      points,
    })
  }

  return Array.from(grouped.entries()).map(([imageId, polygons]) => {
    const image = imageById.get(Number(imageId))
    return {
      filename: image.file_name,
      body: {
        view_type: image.view_type ?? null,
        start_label: null,
        image_width: image.width ?? null,
        image_height: image.height ?? null,
        polygons,
        labeler_id: image.labeler_id ?? null,
      },
    }
  })
}

async function main() {
  const [, , jsonPath, rawBaseUrl, authPassword] = process.argv
  if (!jsonPath || !rawBaseUrl || !authPassword) {
    usage()
    process.exit(1)
  }

  const baseUrl = normalizeBaseUrl(rawBaseUrl)
  const fullPath = path.resolve(jsonPath)
  const jsonText = await fs.readFile(fullPath, 'utf8')
  const data = JSON.parse(jsonText)

  const records = fromRawExport(data) || fromCocoExport(data)
  if (!records || records.length === 0) {
    throw new Error('No restorable records found. Expected raw export with items[] or COCO export with images[] and annotations[].')
  }

  console.log(`Restoring ${records.length} file label records to ${baseUrl} ...`)

  let restored = 0
  let failed = 0

  for (const record of records) {
    const url = `${baseUrl}/api/labels/${encodeURIComponent(record.filename)}`
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': authPassword,
      },
      body: JSON.stringify(record.body),
    })

    if (!response.ok) {
      failed += 1
      const text = await response.text().catch(() => '')
      console.error(`FAILED ${record.filename}: HTTP ${response.status} ${text}`)
      continue
    }

    restored += 1
    console.log(`OK ${record.filename} (${record.body.polygons.length} polygons)`)
  }

  console.log(`\nDone. Restored: ${restored}, Failed: ${failed}`)
  if (failed > 0) process.exit(2)
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
})
