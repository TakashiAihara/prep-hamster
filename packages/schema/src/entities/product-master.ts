import { z } from "zod"
import { Id, Timestamp, TimestampedFields } from "../common"

export const ProductMasterSourceSchema = z.enum([
  "YAHOO_SHOPPING",
  "RAKUTEN_ICHIBA",
  "JANCODE_LOOKUP",
  "GS1_JICFS",
  "OTHER",
])
export type ProductMasterSource = z.infer<typeof ProductMasterSourceSchema>

export const ProductMasterConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"])
export type ProductMasterConfidence = z.infer<typeof ProductMasterConfidenceSchema>

export const ProductMasterSchema = z.object({
  id: Id,
  jan: z.string().min(8).max(13),
  name: z.string().min(1),
  manufacturer: z.string().nullable(),
  brand: z.string().nullable(),
  contentAmount: z.number().nullable(),
  contentUnit: z.string().nullable(),
  categoryHint: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  source: ProductMasterSourceSchema,
  sourceRaw: z.unknown().nullable(),
  fetchedAt: Timestamp,
  confidence: ProductMasterConfidenceSchema.nullable(),
  ...TimestampedFields,
})
export type ProductMaster = z.infer<typeof ProductMasterSchema>
