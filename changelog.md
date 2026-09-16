# Changelog

## 5.0.0

- Replace `@agilesyndrome/cf-genai-base/authorization` imports with `/auth`.
- Replace direct `src/core.js` imports with `src/core/index.js` or the package `/core` entrypoint.
- Replace direct `src/data.js` imports with `src/data/index.js` or the package `/data` entrypoint.
- Replace direct `src/api/router.js` imports with `src/api/contracts.js` for route definitions and dispatch.
- Update internal imports to the canonical folder modules; the old facade files are removed.
- Update package consumers and lockfiles to version `5.0.0`.
