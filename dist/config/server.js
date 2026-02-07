"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
exports.default = ({ env }) => ({
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    url: 'https://portal.faizanemadinasouthend.co.uk',
    proxy: true,
    app: {
        keys: env.array('APP_KEYS'),
    },
});
