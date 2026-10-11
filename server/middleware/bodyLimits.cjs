// server/middleware/bodyLimits.cjs
//
// Request bodies are parsed AFTER the caller has been authenticated, and the unauthenticated routes (sign-in)
// get a tiny limit. Previously a 50 MB JSON parser ran in front of everything, so an anonymous caller could make the
// server buffer and parse 50 MB per request just to be told 401.
'use strict';

const express = require('express');

const SIGN_IN_LIMIT = '4kb';
const CONSOLE_LIMIT = '32kb';   // Application Intelligence: application settings, never media
const AUTHENTICATED_LIMIT = '50mb'; // unchanged for the existing, authenticated media/story routes

const signInJson = () => express.json({ limit: SIGN_IN_LIMIT });
const consoleJson = () => express.json({ limit: CONSOLE_LIMIT });
const authenticatedParsers = () => [express.json({ limit: AUTHENTICATED_LIMIT }), express.urlencoded({ limit: AUTHENTICATED_LIMIT, extended: true })];

module.exports = { signInJson, consoleJson, authenticatedParsers, SIGN_IN_LIMIT, CONSOLE_LIMIT, AUTHENTICATED_LIMIT };
