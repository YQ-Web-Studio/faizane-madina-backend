import { errors } from "@strapi/utils";

export interface RelatedMorphRecord {
  file_id: number;
  related_id: number;
  related_type: string;
  field: string;
}

/**
 * Resolves a raw ID value or operator object into an array of primitive IDs (numbers or non-empty strings).
 * Handles primitives (e.g. 42, "42"), `$in` arrays (e.g. { $in: [1, 2] }), and `$eq` objects (e.g. { $eq: 42 }).
 */
function resolveIdValue(rawId: unknown): (number | string)[] {
  if (rawId === null || rawId === undefined) return [];
  if (typeof rawId === "number" || (typeof rawId === "string" && rawId.trim() !== "")) {
    return [rawId];
  }
  if (typeof rawId === "object") {
    const obj = rawId as Record<string, unknown>;
    const extracted: (number | string)[] = [];
    if (Array.isArray(obj.$in)) {
      for (const item of obj.$in) {
        if (typeof item === "number" || (typeof item === "string" && item.trim() !== "")) {
          extracted.push(item);
        }
      }
    }
    if (
      typeof obj.$eq === "number" ||
      (typeof obj.$eq === "string" && obj.$eq.trim() !== "")
    ) {
      extracted.push(obj.$eq);
    }
    return extracted;
  }
  return [];
}

/**
 * Extracts all target file IDs from Strapi v5 `where` parameter clause.
 * Supports `{ id: 42 }`, `{ id: { $eq: 42 } }`, `{ id: { $in: [...] } }`,
 * and Strapi nested `$and` / `$or` query clauses.
 */
export function extractTargetFileIds(where: any): (number | string)[] {
  if (!where || typeof where !== "object") return [];

  const ids: (number | string)[] = [];

  const processCondition = (condition: any) => {
    if (!condition || typeof condition !== "object") return;
    if (condition.id !== undefined) {
      ids.push(...resolveIdValue(condition.id));
    }
  };

  if (Array.isArray(where.$and)) {
    for (const condition of where.$and) {
      processCondition(condition);
    }
  } else if (Array.isArray(where.$or)) {
    for (const condition of where.$or) {
      processCondition(condition);
    }
  } else {
    processCondition(where);
  }

  // Deduplicate and filter out non-primitive or invalid items
  return [...new Set(ids)];
}

/**
 * Formats a clean, human-readable error message explaining why asset deletion was prevented.
 */
export function formatBlockedDeletionMessage(
  relations: RelatedMorphRecord[]
): string {
  const contentTypes = [
    ...new Set(
      relations.map((r) => {
        // e.g. "api::announcement.announcement" -> "Announcement"
        const clean = r.related_type.replace("api::", "").split(".")[0];
        return clean.charAt(0).toUpperCase() + clean.slice(1);
      })
    ),
  ].join(", ");

  const fields = [...new Set(relations.map((r) => r.field))].join(", ");

  return `Deletion blocked: This media file is currently in active use by: ${contentTypes} (field: ${fields}). Please remove or unlink the image from the corresponding entry before deleting it from the Media Library.`;
}

/**
 * Resolves the file IDs a delete selector actually matches (any `where` shape).
 */
export type MatchingFileIdResolver = (where: any) => Promise<(number | string)[]>;

export interface GuardMediaDeletionOptions {
  /**
   * When true (bulk deletes), an omitted (`undefined` / `null`) selector is
   * normalized to `{}` so `resolveMatchingIds` inspects all targeted records
   * instead of bypassing the guard.
   */
  isBulk?: boolean;
}

/**
 * Checks whether the targeted file(s) are actively linked to any content type
 * in the `files_related_mph` junction table. If linked, throws an ApplicationError
 * to abort the deletion transaction.
 *
 * When `resolveMatchingIds` is supplied it is used to find the files the selector
 * really matches, so selectors the static extractor cannot parse (e.g. mixed `$or`
 * clauses) cannot bypass the guard. Without it, IDs are extracted statically.
 */
export async function guardMediaDeletion(
  dbConnection: any,
  where: any,
  resolveMatchingIds?: MatchingFileIdResolver,
  options?: GuardMediaDeletionOptions
): Promise<void> {
  const effectiveWhere =
    (where === undefined || where === null) && options?.isBulk ? {} : where;

  if (!effectiveWhere || typeof effectiveWhere !== "object") return;

  const fileIds = resolveMatchingIds
    ? [...new Set(await resolveMatchingIds(effectiveWhere))]
    : extractTargetFileIds(effectiveWhere);
  if (fileIds.length === 0) return;

  const hasTable = await dbConnection.schema.hasTable("files_related_mph");
  if (!hasTable) return;

  const relations: RelatedMorphRecord[] = await dbConnection("files_related_mph")
    .whereIn("file_id", fileIds)
    .select("file_id", "related_id", "related_type", "field");

  if (relations && relations.length > 0) {
    throw new errors.ApplicationError(formatBlockedDeletionMessage(relations));
  }
}

const GUARDED = Symbol.for("fmms.mediaDeletionGuard");

/**
 * Wraps the Strapi upload service's `remove` so the guard runs BEFORE the upload
 * provider deletes the binary and its formats. Strapi's `upload.remove()` calls
 * `provider.delete()` before the database delete, so a database lifecycle hook
 * alone would reject the request only after the asset is already gone.
 * Safe to call more than once.
 */
export function guardUploadServiceRemoval(
  uploadService: { remove: (file: any, ...rest: any[]) => Promise<any> },
  dbConnection: any
): void {
  if ((uploadService as any)[GUARDED]) return;

  const originalRemove = uploadService.remove.bind(uploadService);
  uploadService.remove = async (file: any, ...rest: any[]) => {
    await guardMediaDeletion(dbConnection, { id: file?.id });
    return originalRemove(file, ...rest);
  };
  (uploadService as any)[GUARDED] = true;
}

