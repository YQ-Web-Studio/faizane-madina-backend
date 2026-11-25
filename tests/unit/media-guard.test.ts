import { describe, it, expect, vi } from "vitest";
import {
  extractTargetFileIds,
  formatBlockedDeletionMessage,
  guardMediaDeletion,
  guardUploadServiceRemoval,
  type RelatedMorphRecord
} from "../../src/utils/media-deletion-guard";

describe("Media Deletion Guard", () => {
  describe("extractTargetFileIds", () => {
    it("extracts single ID from where.id", () => {
      expect(extractTargetFileIds({ id: 42 })).toEqual([42]);
    });

    it("extracts multiple IDs from where.id.$in", () => {
      expect(extractTargetFileIds({ id: { $in: [10, 20, 30] } })).toEqual([10, 20, 30]);
    });

    it("extracts IDs from Strapi v5 where.$and clause", () => {
      const where = {
        $and: [
          { id: { $in: [44, 45] } },
          { folderPath: { $eq: "/" } }
        ]
      };
      expect(extractTargetFileIds(where)).toEqual([44, 45]);
    });

    it("returns empty array when where is empty or missing id", () => {
      expect(extractTargetFileIds(null)).toEqual([]);
      expect(extractTargetFileIds({})).toEqual([]);
      expect(extractTargetFileIds({ folderPath: "/" })).toEqual([]);
    });

    it("extracts ID from where.id.$eq operator object", () => {
      expect(extractTargetFileIds({ id: { $eq: 42 } })).toEqual([42]);
    });

    it("extracts IDs from where.$or clause", () => {
      const where = {
        $or: [
          { id: 10 },
          { id: { $eq: 20 } }
        ]
      };
      expect(extractTargetFileIds(where)).toEqual([10, 20]);
    });

    it("safely ignores non-primitive or invalid operator objects without leaking [object Object]", () => {
      expect(extractTargetFileIds({ id: {} })).toEqual([]);
      expect(extractTargetFileIds({ id: { $unsupported: "foo" } })).toEqual([]);
      expect(extractTargetFileIds({ id: null })).toEqual([]);
    });

    it("deduplicates IDs", () => {
      expect(extractTargetFileIds({ id: { $in: [5, 5, 10, 10] } })).toEqual([5, 10]);
    });
  });

  describe("formatBlockedDeletionMessage", () => {
    it("formats a friendly error message identifying related content types and fields", () => {
      const relations: RelatedMorphRecord[] = [
        { file_id: 42, related_id: 1, related_type: "api::announcement.announcement", field: "images" },
        { file_id: 42, related_id: 5, related_type: "api::gallery.gallery", field: "images" }
      ];

      const message = formatBlockedDeletionMessage(relations);
      expect(message).toContain("Announcement");
      expect(message).toContain("Gallery");
      expect(message).toContain("images");
      expect(message).toContain("Deletion blocked");
    });
  });

  describe("guardMediaDeletion", () => {
    it("throws ApplicationError when file is linked to existing content", async () => {
      const mockKnex = {
        schema: {
          hasTable: vi.fn().mockResolvedValue(true)
        },
        whereIn: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([
          { file_id: 42, related_id: 1, related_type: "api::announcement.announcement", field: "images" }
        ])
      };
      const mockDbConnection = vi.fn(() => mockKnex) as any;
      mockDbConnection.schema = mockKnex.schema;

      await expect(
        guardMediaDeletion(mockDbConnection, { id: 42 })
      ).rejects.toThrow(/Deletion blocked/);
    });

    it("allows deletion when file is orphaned (no relations)", async () => {
      const mockKnex = {
        schema: {
          hasTable: vi.fn().mockResolvedValue(true)
        },
        whereIn: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([])
      };
      const mockDbConnection = vi.fn(() => mockKnex) as any;
      mockDbConnection.schema = mockKnex.schema;

      await expect(
        guardMediaDeletion(mockDbConnection, { id: 999 })
      ).resolves.toBeUndefined();
    });

    it("allows deletion when junction table does not exist (e.g. uninitialized db)", async () => {
      const mockKnex = {
        schema: {
          hasTable: vi.fn().mockResolvedValue(false)
        }
      };
      const mockDbConnection = vi.fn(() => mockKnex) as any;
      mockDbConnection.schema = mockKnex.schema;

      await expect(
        guardMediaDeletion(mockDbConnection, { id: 1 })
      ).resolves.toBeUndefined();
    });

    it("uses resolveMatchingIds to resolve and block deletion for complex $or selectors matching linked files", async () => {
      const mockKnex = {
        schema: {
          hasTable: vi.fn().mockResolvedValue(true)
        },
        whereIn: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([
          { file_id: 101, related_id: 1, related_type: "api::announcement.announcement", field: "images" }
        ])
      };
      const mockDbConnection = vi.fn(() => mockKnex) as any;
      mockDbConnection.schema = mockKnex.schema;

      const complexWhere = {
        $or: [
          { name: { $contains: "flyer" } },
          { mime: "image/png" }
        ]
      };

      const mockResolver = vi.fn().mockResolvedValue([101, 102]);

      await expect(
        guardMediaDeletion(mockDbConnection, complexWhere, mockResolver)
      ).rejects.toThrow(/Deletion blocked/);

      expect(mockResolver).toHaveBeenCalledWith(complexWhere);
      expect(mockKnex.whereIn).toHaveBeenCalledWith("file_id", [101, 102]);
    });

    it("allows deletion with complex selector when resolveMatchingIds returns unlinked files", async () => {
      const mockKnex = {
        schema: {
          hasTable: vi.fn().mockResolvedValue(true)
        },
        whereIn: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([])
      };
      const mockDbConnection = vi.fn(() => mockKnex) as any;
      mockDbConnection.schema = mockKnex.schema;

      const mockResolver = vi.fn().mockResolvedValue([201]);

      await expect(
        guardMediaDeletion(mockDbConnection, { folder: null }, mockResolver)
      ).resolves.toBeUndefined();
    });
  });

  describe("guardUploadServiceRemoval", () => {
    it("blocks removal of a linked asset and does not invoke original uploadService.remove", async () => {
      const mockKnex = {
        schema: {
          hasTable: vi.fn().mockResolvedValue(true)
        },
        whereIn: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([
          { file_id: 50, related_id: 2, related_type: "api::gallery.gallery", field: "images" }
        ])
      };
      const mockDbConnection = vi.fn(() => mockKnex) as any;
      mockDbConnection.schema = mockKnex.schema;

      const mockRemove = vi.fn().mockResolvedValue({ id: 50 });
      const uploadService = { remove: mockRemove };

      guardUploadServiceRemoval(uploadService, mockDbConnection);

      await expect(uploadService.remove({ id: 50 })).rejects.toThrow(/Deletion blocked/);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("allows removal of an orphaned asset and calls original uploadService.remove", async () => {
      const mockKnex = {
        schema: {
          hasTable: vi.fn().mockResolvedValue(true)
        },
        whereIn: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([])
      };
      const mockDbConnection = vi.fn(() => mockKnex) as any;
      mockDbConnection.schema = mockKnex.schema;

      const mockRemove = vi.fn().mockResolvedValue({ id: 99 });
      const uploadService = { remove: mockRemove };

      guardUploadServiceRemoval(uploadService, mockDbConnection);

      const result = await uploadService.remove({ id: 99 });
      expect(result).toEqual({ id: 99 });
      expect(mockRemove).toHaveBeenCalledWith({ id: 99 });
    });

    it("is idempotent when called multiple times on the same uploadService", () => {
      const mockDbConnection = vi.fn() as any;
      const mockRemove = vi.fn();
      const uploadService = { remove: mockRemove };

      guardUploadServiceRemoval(uploadService, mockDbConnection);
      const wrappedRemove = uploadService.remove;

      guardUploadServiceRemoval(uploadService, mockDbConnection);
      expect(uploadService.remove).toBe(wrappedRemove);
    });
  });
});

