// @ts-ignore
import type { Core } from '@strapi/strapi';
import { guardMediaDeletion, guardUploadServiceRemoval } from './utils/media-deletion-guard';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  // @ts-ignore
  register({ strapi }: { strapi: Core.Strapi }) {
    // This is the new code from the GitHub fix
    // It forces the socket to be treated as encrypted for proxy setups
    strapi.server.use(async (ctx, next) => {
      if (ctx.req?.socket) {
        // @ts-ignore
        (ctx.req.socket).encrypted = true;
      }
      await next();
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // FMMS-2: Guard against accidental deletion of media assets linked to active content

    // Primary guard: runs before the upload provider deletes the binary/formats.
    guardUploadServiceRemoval(
      strapi.plugin('upload').service('upload'),
      strapi.db.connection
    );

    // Secondary guard: database-level protection for any delete path that bypasses
    // the upload service. IDs are resolved from the real selector so any `where`
    // shape is covered.
    const resolveMatchingFileIds = async (where: any) => {
      const rows = await strapi.db
        .query('plugin::upload.file')
        .findMany({ where, select: ['id'] });
      return rows.map((row: { id: number | string }) => row.id);
    };

    strapi.db.lifecycles.subscribe({
      models: ['plugin::upload.file'],

      async beforeDelete(event) {
        await guardMediaDeletion(
          strapi.db.connection,
          event.params?.where,
          resolveMatchingFileIds
        );
      },

      async beforeDeleteMany(event) {
        await guardMediaDeletion(
          strapi.db.connection,
          event.params?.where,
          resolveMatchingFileIds
        );
      },
    });
  },
};